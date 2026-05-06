import { app, BrowserWindow, ipcMain, dialog, nativeTheme } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readdirSync, rmSync, watch, readFileSync, writeFileSync } from 'fs'
import { is } from '@electron-toolkit/utils'
import { BitcoindInstaller } from './installer'
import { BitcoindManager } from './bitcoind'
import { BitcoinRpc } from './rpc'
import { McpServerManager } from './mcp-server'
import { loadSettings, saveSettings, Settings } from './settings'
import { getLedger } from './payments'
import { dark, light } from '../shared/theme'

function themeBg(): string {
  return nativeTheme.shouldUseDarkColors ? dark.bg : light.bg
}

app.setName('FunkPay MCP')

let mainWindow: BrowserWindow | null = null
let bitcoind: BitcoindManager | null = null
let mcp: McpServerManager | null = null
let rpcGlobal: BitcoinRpc | null = null

const installer = new BitcoindInstaller()
let logUnwatch: (() => void) | null = null

const MAX_BACKUPS = 30

async function backupWallet(rpc: BitcoinRpc): Promise<void> {
  const backupDir = join(app.getPath('userData'), 'wallet-backups')
  mkdirSync(backupDir, { recursive: true })

  const existing = readdirSync(backupDir)
    .filter((f) => /^wallet-\d+\.dat$/.test(f))
    .map((f) => parseInt(f.replace('wallet-', '').replace('.dat', ''), 10))
    .sort((a, b) => a - b)

  const next = existing.length ? existing[existing.length - 1] + 1 : 1
  const dest = join(backupDir, `wallet-${String(next).padStart(3, '0')}.dat`)

  // backupwallet flushes WAL and copies atomically — safe while node is running
  await rpc.call('backupwallet', [dest])

  // prune oldest beyond MAX_BACKUPS
  if (existing.length >= MAX_BACKUPS) {
    const toDelete = existing.slice(0, existing.length - MAX_BACKUPS + 1)
    for (const idx of toDelete) {
      rmSync(join(backupDir, `wallet-${String(idx).padStart(3, '0')}.dat`), { force: true })
    }
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 700,
    minHeight: 500,
    title: 'FunkPay MCP',
    backgroundColor: themeBg(),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  nativeTheme.on('updated', () => {
    mainWindow?.setBackgroundColor(themeBg())
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

export async function startServices(): Promise<void> {
  const settings = loadSettings()

  const network = settings.network ?? 'mainnet'
  const rpcPort = network === 'testnet' ? 18332 : 8332
  const rpcUrl = `http://127.0.0.1:${rpcPort}`

  const baseRpc = new BitcoinRpc({
    url: rpcUrl,
    user: settings.rpcUser,
    password: settings.rpcPassword
  })

  bitcoind = new BitcoindManager(
    installer.getBinaryPath(),
    settings.pruneGB,
    settings.rpcUser,
    settings.rpcPassword,
    network,
    (line) => mainWindow?.webContents.send('install:log', `[node] ${line}`)
  )
  bitcoind.start()

  // MCP starts immediately — wallet connects in background when node is ready
  mcp = new McpServerManager(null, async (address, amountSat) => {
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

  // Connect wallet in background — node may take minutes on first sync
  const connectWallet = async (): Promise<void> => {
    for (let i = 0; i < 90; i++) {
      try {
        await baseRpc.ping()
        await baseRpc.ensureWallet('funkpay')
        const rpc = baseRpc.withWallet('funkpay')
        rpcGlobal = rpc
        mcp.setRpc(rpc)

        writeFileSync(bitcoind!.notifyFile, '')
        let backupDebounce: ReturnType<typeof setTimeout> | null = null
        watch(bitcoind!.notifyFile, () => {
          if (backupDebounce) clearTimeout(backupDebounce)
          backupDebounce = setTimeout(async () => {
            try {
              const content = readFileSync(bitcoind!.notifyFile, 'utf-8').trim()
              if (!content) return
              const txid = content.split('\n').pop()?.trim()
              if (!txid) return
              const tx = await rpc.getTransaction(txid).catch(() => null)
              if (tx && tx.amount > 0) await backupWallet(rpc)
            } catch { /* ignore */ }
          }, 500)
        })
        return
      } catch {
        await new Promise((r) => setTimeout(r, 3000))
      }
    }
  }
  connectWallet().catch(console.error)
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
        startServices()
          .then(() => mainWindow?.webContents.send('install:done'))
          .catch((e) => console.error('[startup] startServices failed:', e))
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

// IPC — payments ledger
ipcMain.handle('payments:list', () => getLedger().list())

ipcMain.handle('payments:reverify', async (_, id: string) => {
  const ledger = getLedger()
  const record = ledger.list().find((r) => r.id === id)
  if (!record) throw new Error('Record not found')

  const result: Record<string, unknown> = {}

  // on-chain check
  if (record.txid && rpcGlobal) {
    try {
      const tx = await rpcGlobal.getTransaction(record.txid)
      result.on_chain_confs = tx.confirmations
      ledger.update(id, { on_chain_confs: tx.confirmations })
    } catch { result.on_chain_error = 'node unreachable' }
  }

  // merchant check
  if (record.merchant_url && record.payment_id) {
    try {
      const base = record.merchant_url.replace(/\/$/, '')
      const res = await fetch(`${base}/invoices/${record.payment_id}`)
      if (res.ok) {
        const inv = await res.json() as Record<string, unknown>
        result.merchant_status = inv.status
        result.merchant_confs = inv.confirmations
        ledger.update(id, {
          merchant_status: inv.status as string,
          on_chain_confs: (inv.confirmations as number) ?? record.on_chain_confs,
          needs_attention: false
        })
      } else {
        result.merchant_error = `HTTP ${res.status}`
      }
    } catch (e: unknown) {
      result.merchant_error = e instanceof Error ? e.message : String(e)
      // on-chain confirmed but merchant failed → flag it
      if ((result.on_chain_confs as number) > 0) ledger.update(id, { needs_attention: true })
    }
  }

  return { record: ledger.list().find((r) => r.id === id), ...result }
})

// IPC — runtime
ipcMain.handle('settings:load', () => loadSettings())
ipcMain.handle('settings:save', (_, settings: Settings) => saveSettings(settings))
ipcMain.handle('app:relaunch', () => { app.relaunch(); app.exit(0) })
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
    startServices().catch((e) => console.error('[startup] startServices failed:', e))
  } else if (status === 'in_progress') {
    // resume watching — install was in progress when app was closed
    logUnwatch = installer.watchLog(async (line) => {
      if (line === '__DONE__') {
        logUnwatch?.()
        logUnwatch = null
        startServices()
          .then(() => mainWindow?.webContents.send('install:done'))
          .catch((e) => console.error('[startup] startServices failed:', e))
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
