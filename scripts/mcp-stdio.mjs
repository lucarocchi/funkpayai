#!/usr/bin/env node
/**
 * FunkPay MCP — stdio proxy
 *
 * Implements the MCP stdio protocol and proxies tool calls to the
 * FunkPay MCP desktop app REST API (http://127.0.0.1:3282/api).
 * Auto-launches the desktop app if it is not already running.
 *
 * Claude Code config:
 *   { "mcpServers": { "funkpayai": { "command": "node", "args": ["~/.funkpay/mcp-stdio.mjs"] } } }
 */
import { createInterface } from 'readline'
import http from 'http'
import { spawn } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const PORT = 3282
const API = `http://127.0.0.1:${PORT}/api`

// F-01: load shared secret — written by the app at ~/.funkpay/api-token
let API_TOKEN = ''
try {
  API_TOKEN = readFileSync(join(homedir(), '.funkpay', 'api-token'), 'utf-8').trim()
} catch {
  process.stderr.write('[funkpay-mcp] Warning: API token not found — launch FunkPay MCP first\n')
}

// F-29: load app executable path written by the app at startup (more reliable than display name)
let APP_EXE_PATH = ''
try {
  APP_EXE_PATH = readFileSync(join(homedir(), '.funkpay', 'app-path'), 'utf-8').trim()
} catch { /* fall back to name-based launch */ }

// ── Auto-launch / auto-restart ────────────────────────────────────────────────

function killApp() {
  try {
    if (process.platform === 'darwin') {
      if (APP_EXE_PATH) {
        const appBundle = APP_EXE_PATH.includes('.app/')
          ? APP_EXE_PATH.split('.app/')[0] + '.app'
          : APP_EXE_PATH
        // pkill by bundle path — kills the Electron main process
        spawn('pkill', ['-f', appBundle], { stdio: 'ignore' }).unref()
      } else {
        spawn('pkill', ['-f', 'FunkPay MCP'], { stdio: 'ignore' }).unref()
      }
    } else if (process.platform === 'win32') {
      spawn('taskkill', ['/IM', 'FunkPay MCP.exe', '/F'], { stdio: 'ignore' }).unref()
    }
  } catch { /* ignore */ }
}

function launchApp() {
  if (process.platform === 'darwin') {
    // -g: do not bring app to foreground
    if (APP_EXE_PATH && APP_EXE_PATH.includes('.app/')) {
      const appBundle = APP_EXE_PATH.split('.app/')[0] + '.app'
      spawn('open', ['-g', appBundle], { detached: true, stdio: 'ignore' }).unref()
    } else {
      spawn('open', ['-g', '-a', 'FunkPay MCP'], { detached: true, stdio: 'ignore' }).unref()
    }
  } else if (process.platform === 'win32') {
    const target = APP_EXE_PATH || 'FunkPay MCP.exe'
    spawn(target, [], { detached: true, stdio: 'ignore' }).unref()
  } else {
    const target = APP_EXE_PATH || 'funkpaymcp'
    spawn(target, [], { detached: true, stdio: 'ignore' }).unref()
  }
}

async function ensureAppRunning(forceRestart = false) {
  if (!forceRestart && await isReady()) return

  if (forceRestart) {
    process.stderr.write('[funkpay-mcp] Wallet API unresponsive — restarting FunkPay MCP...\n')
    killApp()
    await sleep(2000)
  } else {
    process.stderr.write('[funkpay-mcp] App not running — launching FunkPay MCP...\n')
  }

  try {
    launchApp()
  } catch {
    process.stderr.write('[funkpay-mcp] Could not launch app.\n')
    return
  }

  for (let i = 0; i < 30; i++) {
    await sleep(1000)
    if (await isReady()) {
      process.stderr.write('[funkpay-mcp] App ready.\n')
      return
    }
  }
  process.stderr.write('[funkpay-mcp] App did not start in 30s.\n')
}

async function isReady() {
  try {
    const res = await apiGet('/health')
    return res.ok === true
  } catch {
    return false
  }
}

// ── Tool definitions (MCP schema) ─────────────────────────────────────────────

const TOOLS = [
  {
    name: 'get_balance',
    description: 'Get wallet balance in satoshis',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_new_address',
    description: 'Generate a new Bitcoin receive address',
    inputSchema: {
      type: 'object',
      properties: { label: { type: 'string', description: 'Optional label' } }
    }
  },
  {
    name: 'send_payment',
    description: 'Send Bitcoin to an address (subject to user approval policy)',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Bitcoin address' },
        amount_sat: { type: 'number', description: 'Amount in satoshis' },
        comment: { type: 'string' }
      },
      required: ['address', 'amount_sat']
    }
  },
  {
    name: 'get_transaction',
    description: 'Get transaction status and confirmations',
    inputSchema: {
      type: 'object',
      properties: { txid: { type: 'string' } },
      required: ['txid']
    }
  },
  {
    name: 'list_transactions',
    description: 'List recent wallet transactions',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max results (1-100, default 20)' } }
    }
  },
  {
    name: 'create_invoice',
    description: 'Create a FunkPay payment invoice on a merchant server. Automatically attaches shipping/billing info from Settings. Pass amount_fiat + currency when the user specifies a fiat price (e.g. "pay €25") so the exchange rate is recorded for accounting.',
    inputSchema: {
      type: 'object',
      properties: {
        merchant_url: { type: 'string', description: 'Base URL of the btcfunkpay merchant server' },
        amount_sat: { type: 'number', description: 'Amount in satoshis (omit for open amount)' },
        label: { type: 'string', description: 'Order reference or description' },
        amount_fiat: { type: 'number', description: 'Amount in fiat currency (for fiscal records, e.g. 25.00)' },
        currency: { type: 'string', description: 'ISO fiat currency code, e.g. EUR, USD, GBP' }
      },
      required: ['merchant_url']
    }
  },
  {
    name: 'get_invoice_status',
    description: 'Poll the status of a FunkPay payment invoice',
    inputSchema: {
      type: 'object',
      properties: {
        merchant_url: { type: 'string' },
        payment_id: { type: 'string' }
      },
      required: ['merchant_url', 'payment_id']
    }
  },
  {
    name: 'wait_for_payment',
    description: "Wait until a FunkPay invoice is detected or confirmed according to the user's confirmation setting. Use after create_invoice + send_payment.",
    inputSchema: {
      type: 'object',
      properties: {
        merchant_url: { type: 'string' },
        payment_id: { type: 'string' },
        timeout_seconds: { type: 'number', description: 'Max wait in seconds (default 1800)' }
      },
      required: ['merchant_url', 'payment_id']
    }
  },
  {
    name: 'list_merchants',
    description: 'List trusted FunkPay merchant servers configured by the user',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'discover_merchant',
    description: 'Auto-discover FunkPay server for a domain via /.well-known/funkpay.json. Use when the user says "buy from example.com".',
    inputSchema: {
      type: 'object',
      properties: { domain: { type: 'string', description: 'Domain to probe, e.g. btcfunk.com' } },
      required: ['domain']
    }
  }
]

// ── Tool dispatch ─────────────────────────────────────────────────────────────

async function callTool(name, args) {
  if (!await isReady()) {
    await ensureAppRunning()
    if (!await isReady()) {
      // App was running but API was down — force restart
      await ensureAppRunning(true)
      if (!await isReady()) {
        return err('FunkPay MCP could not start after restart. Check that the app is installed correctly.')
      }
    }
  }
  // Re-read token on every call — handles the case where the proxy started
  // before the app had written the token file (e.g. first launch via auto-launch).
  try {
    const t = readFileSync(join(homedir(), '.funkpay', 'api-token'), 'utf-8').trim()
    if (t) API_TOKEN = t
  } catch { /* keep whatever we loaded at startup */ }
  switch (name) {
    case 'get_balance': {
      const { sat } = await apiPost('/balance', {})
      return ok(`${sat} sat`)
    }

    case 'get_new_address': {
      const { address } = await apiPost('/address', { label: args.label })
      return ok(address)
    }

    case 'send_payment': {
      const { txid } = await apiPost('/send', args)
      return ok(txid)
    }

    case 'get_transaction': {
      const tx = await apiPost('/transaction', { txid: args.txid })
      return ok(JSON.stringify(tx, null, 2))
    }

    case 'list_transactions': {
      const txs = await apiPost('/transactions', { limit: args.limit ?? 20 })
      return ok(JSON.stringify(txs, null, 2))
    }

    case 'create_invoice': {
      const data = await apiPost('/invoice', args)
      return ok(JSON.stringify(data, null, 2))
    }

    case 'get_invoice_status': {
      const data = await apiPost('/invoice-status', args)
      return ok(JSON.stringify(data, null, 2))
    }

    case 'wait_for_payment': {
      // F-11: register the wait in the app's persistent background loop, then poll
      // the app instead of the merchant directly. If the proxy restarts, re-registering
      // is idempotent — the app keeps polling and the ledger retains the latest status.
      const { merchant_url, payment_id, timeout_seconds = 1800 } = args
      try {
        await apiPost('/wait-payment', { merchant_url, payment_id, timeout_seconds })
      } catch (e) {
        return err(`Failed to register payment wait: ${e.message}`)
      }
      const config = await apiGet('/config')
      const required = config.confirmationsRequired ?? 0
      const deadline = Date.now() + timeout_seconds * 1000
      const POLL = 5_000

      while (Date.now() < deadline) {
        await sleep(POLL)
        try {
          const inv = await apiPost('/wait-status', { payment_id })
          const status = inv.status
          const confs = inv.confirmations ?? 0
          const done = required === 0
            ? ['detected', 'confirmed', 'overpaid'].includes(status)
            : ['confirmed', 'overpaid'].includes(status) && confs >= required
          if (done) return ok(JSON.stringify({ payment_id, status, confirmations: confs, received_sat: inv.received_sat, txid: inv.txid }, null, 2))
          if (status === 'expired') return err(`Invoice ${payment_id} expired before payment was received.`)
          if (!inv.still_waiting && !done) return err(`Server-side wait expired. Check the Payments tab in FunkPay MCP for current status.`)
        } catch { /* app unreachable — keep polling */ }
      }

      return err(`Timeout: payment not confirmed within ${timeout_seconds}s. Check the Payments tab in FunkPay MCP.`)
    }

    case 'list_merchants': {
      const merchants = await apiGet('/merchants')
      return ok(JSON.stringify(merchants, null, 2))
    }

    case 'discover_merchant': {
      const data = await apiPost('/discover', { domain: args.domain })
      return ok(JSON.stringify(data, null, 2))
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

const ok = (text) => ({ content: [{ type: 'text', text }] })
const err = (text) => ({ content: [{ type: 'text', text }], isError: true })

// ── MCP JSON-RPC handler ──────────────────────────────────────────────────────

async function handleMessage(msg) {
  const { jsonrpc = '2.0', id, method, params = {} } = msg

  // Notifications have no id and expect no response
  const isNotification = id === undefined

  switch (method) {
    case 'initialize':
      return {
        jsonrpc, id,
        result: {
          protocolVersion: params.protocolVersion ?? '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'funkpay-mcp', version: '1.0.0' }
        }
      }

    case 'notifications/initialized':
      return null

    case 'ping':
      return { jsonrpc, id, result: {} }

    case 'tools/list':
      return { jsonrpc, id, result: { tools: TOOLS } }

    case 'tools/call':
      try {
        const result = await callTool(params.name, params.arguments ?? {})
        return { jsonrpc, id, result }
      } catch (e) {
        return { jsonrpc, id, result: { content: [{ type: 'text', text: e.message }], isError: true } }
      }

    default:
      if (isNotification) return null
      return { jsonrpc, id, error: { code: -32601, message: `Method not found: ${method}` } }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, terminal: false })

rl.on('line', async (line) => {
  const trimmed = line.trim()
  if (!trimmed) return

  let msg
  try {
    msg = JSON.parse(trimmed)
  } catch (e) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: `Parse error: ${e.message}` } }) + '\n')
    return
  }

  try {
    const response = await handleMessage(msg)
    if (response !== null) process.stdout.write(JSON.stringify(response) + '\n')
  } catch (e) {
    if (msg.id !== undefined) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: e.message } }) + '\n')
    }
  }
})

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function apiGet(path) {
  return httpReq('GET', API + path)
}

function apiPost(path, body) {
  return httpReq('POST', API + path, body)
}

function httpReq(method, url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const payload = body !== undefined ? JSON.stringify(body) : undefined
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parseInt(parsed.port) || 80,
        path: parsed.pathname,
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-FunkPay-Token': API_TOKEN,
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
        }
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString()
          if (res.statusCode >= 400) {
            try { reject(new Error(JSON.parse(text).error || text)) } catch { reject(new Error(`HTTP ${res.statusCode}: ${text}`)) }
          } else {
            try { resolve(JSON.parse(text)) } catch { resolve(text) }
          }
        })
      }
    )
    req.on('error', reject)
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Request timeout')) })
    if (payload) req.write(payload)
    req.end()
  })
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
