import { app, BrowserWindow, ipcMain, dialog, nativeTheme, session } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { readdirSync, mkdirSync, rmSync, existsSync, copyFileSync, chmodSync, writeFileSync } from 'fs'
import { is } from '@electron-toolkit/utils'
import { BitcoinRpc } from './rpc'
import { WalletApiServer } from './wallet-api'
import { loadSettings, saveSettings, Settings } from './settings'
import { getLedger } from './payments'
import { loadOrCreateToken } from './api-token'
import { dark, light } from '../shared/theme'

function themeBg(): string {
  return nativeTheme.shouldUseDarkColors ? dark.bg : light.bg
}

app.setName('FunkPay MCP')
if (process.platform === 'darwin') {
  app.setPath('userData', join(homedir(), 'Library', 'Application Support', 'FunkPay MCP'))
} else if (process.platform === 'win32') {
  app.setPath('userData', join(homedir(), 'AppData', 'Roaming', 'FunkPay MCP'))
} else {
  app.setPath('userData', join(homedir(), '.config', 'FunkPay MCP'))
}

let mainWindow: BrowserWindow | null = null
let walletApi: WalletApiServer | null = null
let cliPath: string | null = null
let cliInstallFailed = false
let rpcGlobal: BitcoinRpc | null = null
let baseRpcGlobal: BitcoinRpc | null = null
let lastSyncInfo: { blocks: number; headers: number; progress: number; syncing: boolean } | null = null
let connectionExhausted = false

const MAX_BACKUPS = 30

function installCli(): void {
  try {
    const funkpayDir = join(app.getPath('home'), '.funkpay')
    mkdirSync(funkpayDir, { recursive: true })

    const src = is.dev
      ? join(__dirname, '../../scripts/mcp-stdio.mjs')
      : join(process.resourcesPath, 'mcp-stdio.mjs')
    if (!existsSync(src)) return
    const dest = join(funkpayDir, 'mcp-stdio.mjs')
    copyFileSync(src, dest)
    chmodSync(dest, 0o755)
    cliPath = dest

    // F-29: write executable path so proxy can auto-launch reliably (not by display name)
    const appPathFile = join(funkpayDir, 'app-path')
    writeFileSync(appPathFile, process.execPath, { mode: 0o600 })

    console.log(`[cli] installed stdio proxy at ${dest}`)
  } catch (e) {
    cliInstallFailed = true
    console.error('[cli] install failed:', e)
  }
}

async function backupWallet(rpc: BitcoinRpc): Promise<void> {
  const backupDir = join(app.getPath('userData'), 'wallet-backups')
  mkdirSync(backupDir, { recursive: true })

  const existing = readdirSync(backupDir)
    .filter((f) => /^wallet-\d+\.dat$/.test(f))
    .map((f) => parseInt(f.replace('wallet-', '').replace('.dat', ''), 10))
    .sort((a, b) => a - b)

  const next = existing.length ? existing[existing.length - 1] + 1 : 1
  const dest = join(backupDir, `wallet-${String(next).padStart(3, '0')}.dat`)

  await rpc.call('backupwallet', [dest])

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
      sandbox: true,
      contextIsolation: true
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
  const rpcUrl = settings.rpcUrl || `http://127.0.0.1:${rpcPort}`

  baseRpcGlobal = new BitcoinRpc({
    url: rpcUrl,
    user: settings.rpcUser,
    password: settings.rpcPassword
  })

  const apiToken = loadOrCreateToken()

  walletApi = new WalletApiServer(apiToken, async (address, amountSat) => {
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
  await walletApi.start(settings.mcpPort)

  // Connect wallet in background — node may not be ready immediately
  const connectWallet = async (): Promise<void> => {
    for (let i = 0; i < 180; i++) {
      try {
        await baseRpcGlobal!.ping()
        await baseRpcGlobal!.ensureWallet('funkpay')
        const rpc = baseRpcGlobal!.withWallet('funkpay')
        rpcGlobal = rpc
        walletApi!.setRpc(rpc)
        connectionExhausted = false
        console.log('[wallet] connected to Bitcoin node')
        return
      } catch {
        await new Promise((r) => setTimeout(r, 5000))
      }
    }
    connectionExhausted = true
    console.warn('[wallet] could not connect to Bitcoin node after 15 minutes')
  }
  connectWallet().catch(console.error)
}

// IPC — wallet
ipcMain.handle('wallet:getBalance', async () => {
  if (!rpcGlobal) throw new Error('Node not ready')
  return rpcGlobal.getBalance()
})

ipcMain.handle('wallet:getNewAddress', async () => {
  if (!rpcGlobal) throw new Error('Node not ready')
  return rpcGlobal.getNewAddress()
})

// F-04: mutex — prevent concurrent payments triggered from the UI
let sendIpcInFlight = false

ipcMain.handle('wallet:send', async (_, address: string, amountSat: number, subtractFee = false) => {
  if (!rpcGlobal) throw new Error('Node not ready')
  if (sendIpcInFlight) throw new Error('A payment is already in progress — wait for it to complete')
  sendIpcInFlight = true
  try {
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

    return await rpcGlobal.sendToAddress(address, amountSat, undefined, subtractFee)
  } finally {
    sendIpcInFlight = false
  }
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

  if (record.txid && rpcGlobal) {
    try {
      const tx = await rpcGlobal.getTransaction(record.txid)
      result.on_chain_confs = tx.confirmations
      ledger.update(id, { on_chain_confs: tx.confirmations })
    } catch { result.on_chain_error = 'node unreachable' }
  }

  if (record.merchant_url && record.payment_id) {
    // F-09: reject malformed payment_id stored by a malicious merchant before URL construction
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(record.payment_id)) {
      result.merchant_error = 'Stored payment_id has invalid format — reverify skipped'
    } else
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
      if ((result.on_chain_confs as number) > 0) ledger.update(id, { needs_attention: true })
    }
  }

  return { record: ledger.list().find((r) => r.id === id), ...result }
})

// IPC — node sync info
ipcMain.handle('node:syncInfo', async () => {
  if (!baseRpcGlobal) return lastSyncInfo
  try {
    const info = await baseRpcGlobal.getBlockchainInfo()
    lastSyncInfo = {
      blocks: info.blocks,
      headers: info.headers,
      progress: info.verificationprogress,
      syncing: info.initialblockdownload || info.verificationprogress < 0.9999
    }
    return lastSyncInfo
  } catch {
    return lastSyncInfo
  }
})

// IPC — runtime
ipcMain.handle('settings:load', () => loadSettings())
// F-05: test RPC credentials without saving them first
ipcMain.handle('settings:test', async (_, url: string, user: string, password: string) => {
  const rpc = new BitcoinRpc({ url, user, password })
  return rpc.getNodeStatus()
})
ipcMain.handle('settings:save', async (_, settings: Settings) => {
  saveSettings(settings)
  // Reconnect with new RPC settings
  const network = settings.network ?? 'mainnet'
  const rpcPort = network === 'testnet' ? 18332 : 8332
  const rpcUrl = settings.rpcUrl || `http://127.0.0.1:${rpcPort}`
  baseRpcGlobal = new BitcoinRpc({ url: rpcUrl, user: settings.rpcUser, password: settings.rpcPassword })
  rpcGlobal = null
  lastSyncInfo = null
  connectionExhausted = false
  // reconnect wallet in background
  const reconnectWallet = async (): Promise<void> => {
    for (let i = 0; i < 180; i++) {
      try {
        await baseRpcGlobal!.ping()
        await baseRpcGlobal!.ensureWallet('funkpay')
        const rpc = baseRpcGlobal!.withWallet('funkpay')
        rpcGlobal = rpc
        walletApi?.setRpc(rpc)
        connectionExhausted = false
        console.log('[wallet] reconnected after settings change')
        return
      } catch {
        await new Promise((r) => setTimeout(r, 5000))
      }
    }
    connectionExhausted = true
    console.warn('[wallet] could not reconnect after settings change')
  }
  reconnectWallet().catch(console.error)
})
// F-27: only the main window may trigger a relaunch
ipcMain.handle('app:relaunch', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return
  app.relaunch(); app.exit(0)
})
ipcMain.handle('status', async () => {
  const settings = loadSettings()
  const nodeStatus = baseRpcGlobal ? await baseRpcGlobal.getNodeStatus() : 'offline'
  const network = settings.network ?? 'mainnet'
  const dataDirName = network === 'testnet' ? 'bitcoin-testnet' : 'bitcoin'
  const dataDir = join(app.getPath('userData'), dataDirName)
  const bitcoindPath = join(app.getPath('userData'), 'bitcoin-core', 'bitcoind')
  return { nodeStatus, mcp: walletApi !== null, mcpPort: settings.mcpPort, cliPath, cliInstallFailed, bitcoindPath, dataDir, network, connectionExhausted }
})

app.whenReady().then(async () => {
  // F-06: Content Security Policy — only in production; dev mode needs WebSocket for Vite HMR
  if (!is.dev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'"
          ]
        }
      })
    })
  }

  installCli()
  createWindow()
  startServices().catch((e) => console.error('[startup] startServices failed:', e))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  await walletApi?.stop()
  if (process.platform !== 'darwin') app.quit()
})
