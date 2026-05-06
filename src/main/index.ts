import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { BitcoindInstaller } from './installer'
import { BitcoindManager } from './bitcoind'
import { BitcoinRpc } from './rpc'
import { McpServerManager } from './mcp-server'
import { loadSettings, saveSettings, Settings } from './settings'

app.setName('FunkPay MCP')

let mainWindow: BrowserWindow | null = null
let bitcoind: BitcoindManager | null = null
let mcp: McpServerManager | null = null
let rpcGlobal: BitcoinRpc | null = null

const installer = new BitcoindInstaller()
let logUnwatch: (() => void) | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 700,
    minHeight: 500,
    title: 'FunkPay MCP',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

export async function startServices(): Promise<void> {
  const settings = loadSettings()

  const baseRpc = new BitcoinRpc({
    url: settings.rpcUrl,
    user: settings.rpcUser,
    password: settings.rpcPassword
  })

  bitcoind = new BitcoindManager(
    installer.getBinaryPath(),
    settings.pruneGB,
    settings.rpcUser,
    settings.rpcPassword,
    (line) => mainWindow?.webContents.send('install:log', `[node] ${line}`)
  )
  bitcoind.start()

  // Wait for node to be ready, then setup wallet
  const setupWallet = async (): Promise<BitcoinRpc> => {
    for (let i = 0; i < 30; i++) {
      try {
        await baseRpc.ping()
        await baseRpc.ensureWallet('funkpay')
        return baseRpc.withWallet('funkpay')
      } catch {
        await new Promise((r) => setTimeout(r, 2000))
      }
    }
    throw new Error('bitcoind did not start in time')
  }

  const rpc = await setupWallet()
  rpcGlobal = rpc

  mcp = new McpServerManager(rpc, async (address, amountSat) => {
    const result = await dialog.showMessageBox(mainWindow!, {
      type: 'question',
      buttons: ['Approve', 'Reject'],
      defaultId: 1,
      cancelId: 1,
      title: 'Payment Approval Required',
      message: 'FunkPay MCP wants to send a payment',
      detail: `To: ${address}\nAmount: ${amountSat.toLocaleString()} sat`
    })
    return result.response === 0
  })

  await mcp.start(settings.mcpPort)
}

// IPC — install
ipcMain.handle('install:getStatus', () => Promise.resolve(installer.getStatus()))
ipcMain.handle('install:getLog',    () => installer.getExistingLog())

ipcMain.handle('install:openTerminal', async () => {
  try {
    await installer.openTerminal()

    // start watching log file and stream to renderer
    logUnwatch?.()
    logUnwatch = installer.watchLog(async (line) => {
      if (line === '__DONE__') {
        logUnwatch?.()
        logUnwatch = null
        await startServices()
        mainWindow?.webContents.send('install:done')
      } else {
        mainWindow?.webContents.send('install:log', line)
      }
    })

    return { ok: true }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

// IPC — wallet
ipcMain.handle('wallet:getBalance', async () => {
  if (!rpcGlobal) throw new Error('Node not ready')
  return rpcGlobal.getBalance()
})

ipcMain.handle('wallet:getNewAddress', async () => {
  if (!rpcGlobal) throw new Error('Node not ready')
  return rpcGlobal.getNewAddress()
})

ipcMain.handle('wallet:send', async (_, address: string, amountSat: number, subtractFee = false) => {
  if (!rpcGlobal) throw new Error('Node not ready')
  const settings = loadSettings()
  const needsApproval =
    settings.approvalMode === 'always' ||
    (settings.approvalMode === 'threshold' && amountSat >= settings.approvalThresholdSat)

  if (needsApproval && mainWindow) {
    const detail = subtractFee
      ? `To: ${address}\nAmount: ${amountSat.toLocaleString()} sat (fee deducted from amount)`
      : `To: ${address}\nAmount: ${amountSat.toLocaleString()} sat`
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Approve', 'Reject'],
      defaultId: 1,
      cancelId: 1,
      title: 'Confirm Payment',
      message: 'Send Bitcoin?',
      detail
    })
    if (response !== 0) throw new Error('Payment rejected by user')
  }

  return rpcGlobal.sendToAddress(address, amountSat, undefined, subtractFee)
})

ipcMain.handle('wallet:listTransactions', async (_, limit = 20) => {
  if (!rpcGlobal) throw new Error('Node not ready')
  return rpcGlobal.listTransactions(limit)
})

// IPC — runtime
ipcMain.handle('settings:load', () => loadSettings())
ipcMain.handle('settings:save', (_, settings: Settings) => saveSettings(settings))
ipcMain.handle('status', async () => {
  const settings = loadSettings()
  let bitcoindRunning = false
  try {
    const rpc = new BitcoinRpc({ url: settings.rpcUrl, user: settings.rpcUser, password: settings.rpcPassword })
    await rpc.ping()
    bitcoindRunning = true
  } catch {
    bitcoindRunning = false
  }
  return { bitcoind: bitcoindRunning, mcp: mcp !== null, mcpPort: settings.mcpPort }
})

app.whenReady().then(async () => {
  createWindow()

  const status = installer.getStatus()

  if (status === 'installed') {
    await startServices()
  } else if (status === 'in_progress') {
    // resume watching — install was in progress when app was closed
    logUnwatch = installer.watchLog(async (line) => {
      if (line === '__DONE__') {
        logUnwatch?.()
        logUnwatch = null
        await startServices()
        mainWindow?.webContents.send('install:done')
      } else {
        mainWindow?.webContents.send('install:log', line)
      }
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  logUnwatch?.()
  await mcp?.stop()
  await bitcoind?.stop()
  if (process.platform !== 'darwin') app.quit()
})
