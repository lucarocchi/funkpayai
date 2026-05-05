import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { BitcoindManager } from './bitcoind'
import { BitcoinRpc } from './rpc'
import { McpServerManager } from './mcp-server'
import { loadSettings, saveSettings, Settings } from './settings'

app.setName('FunkPay MCP')

let mainWindow: BrowserWindow | null = null
let bitcoind: BitcoindManager | null = null
let mcp: McpServerManager | null = null

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

async function startServices(): Promise<void> {
  const settings = loadSettings()

  bitcoind = new BitcoindManager(settings.pruneGB, settings.rpcUser, settings.rpcPassword)
  bitcoind.start()

  const rpc = new BitcoinRpc({
    url: settings.rpcUrl,
    user: settings.rpcUser,
    password: settings.rpcPassword
  })

  mcp = new McpServerManager(rpc, async (address, amountSat) => {
    // Show approval dialog in the renderer
    const result = await dialog.showMessageBox(mainWindow!, {
      type: 'question',
      buttons: ['Approve', 'Reject'],
      defaultId: 1,
      cancelId: 1,
      title: 'Payment Approval Required',
      message: `FunkPayAI wants to send a payment`,
      detail: `To: ${address}\nAmount: ${amountSat.toLocaleString()} sat`
    })
    return result.response === 0
  })

  await mcp.start(settings.mcpPort)
}

// IPC handlers
ipcMain.handle('settings:load', () => loadSettings())
ipcMain.handle('settings:save', (_, settings: Settings) => saveSettings(settings))
ipcMain.handle('bitcoind:status', () => ({ running: bitcoind?.isRunning() ?? false }))

app.whenReady().then(async () => {
  createWindow()
  await startServices()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  await mcp?.stop()
  await bitcoind?.stop()
  if (process.platform !== 'darwin') app.quit()
})
