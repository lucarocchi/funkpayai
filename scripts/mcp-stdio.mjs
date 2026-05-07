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

const PORT = parseInt(process.env.FUNKPAY_PORT || '3282', 10)
const API = `http://127.0.0.1:${PORT}/api`

// ── Auto-launch ───────────────────────────────────────────────────────────────

async function ensureAppRunning() {
  if (await isReady()) return

  process.stderr.write('[funkpay-mcp] App not running — launching FunkPay MCP...\n')
  try {
    if (process.platform === 'darwin') {
      spawn('open', ['-a', 'FunkPay MCP'], { detached: true, stdio: 'ignore' }).unref()
    } else if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', 'FunkPay MCP.exe'], { detached: true, shell: true, stdio: 'ignore' }).unref()
    } else {
      spawn('funkpaymcp', [], { detached: true, stdio: 'ignore' }).unref()
    }
  } catch {
    process.stderr.write('[funkpay-mcp] Could not launch app — please open FunkPay MCP manually.\n')
    return
  }

  for (let i = 0; i < 30; i++) {
    await sleep(1000)
    if (await isReady()) {
      process.stderr.write('[funkpay-mcp] App ready.\n')
      return
    }
  }
  process.stderr.write('[funkpay-mcp] App did not start in 30s — tool calls will fail until it is open.\n')
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
    description: 'Create a FunkPay payment invoice on a merchant server. Automatically attaches shipping/billing info from Settings.',
    inputSchema: {
      type: 'object',
      properties: {
        merchant_url: { type: 'string', description: 'Base URL of the btcfunkpay merchant server' },
        amount_sat: { type: 'number', description: 'Amount in satoshis (omit for open amount)' },
        label: { type: 'string', description: 'Order reference or description' }
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
      const { merchant_url, payment_id, timeout_seconds = 1800 } = args
      const settings = await apiGet('/settings')
      const required = settings.confirmationsRequired ?? 0
      const deadline = Date.now() + timeout_seconds * 1000
      const POLL = 15_000

      while (Date.now() < deadline) {
        try {
          const inv = await apiPost('/invoice-status', { merchant_url, payment_id })
          const status = inv.status
          const confs = inv.confirmations ?? 0

          const done = required === 0
            ? ['detected', 'confirmed', 'overpaid'].includes(status)
            : ['confirmed', 'overpaid'].includes(status) && confs >= required

          if (done) return ok(JSON.stringify({ payment_id, status, confirmations: confs, received_sat: inv.received_sat, txid: inv.txid }, null, 2))
          if (status === 'expired') return err(`Invoice ${payment_id} expired before payment was received.`)
        } catch { /* merchant unreachable, keep polling */ }

        await sleep(POLL)
      }

      return err(`Timeout: payment not confirmed within ${timeout_seconds}s. Use get_invoice_status to retry or check the Payments tab in FunkPay MCP.`)
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

await ensureAppRunning()

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
