import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { IncomingMessage, ServerResponse, createServer } from 'http'
import { exec } from 'child_process'
import { promisify } from 'util'
import https from 'https'
import http from 'http'

const execAsync = promisify(exec)

async function freePort(port: number): Promise<void> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync(`netstat -ano | findstr :${port}`)
      const pid = stdout.trim().split(/\s+/).pop()
      if (pid) await execAsync(`taskkill /PID ${pid} /F`)
    } else {
      await execAsync(`lsof -ti :${port} | xargs kill -9`)
    }
    await new Promise((r) => setTimeout(r, 300))
  } catch {
    // nothing on the port, ignore
  }
}
import { z } from 'zod'
import { BitcoinRpc } from './rpc'
import { loadSettings } from './settings'
import { getLedger } from './payments'

type ApprovalHandler = (address: string, amountSat: number) => Promise<boolean>

export class McpServerManager {
  private server: McpServer
  private httpServer: ReturnType<typeof createServer> | null = null
  private rpc: BitcoinRpc
  private onApprovalRequired: ApprovalHandler

  constructor(rpc: BitcoinRpc, onApprovalRequired: ApprovalHandler) {
    this.rpc = rpc
    this.onApprovalRequired = onApprovalRequired
    this.server = this.buildServer()
  }

  private buildServer(): McpServer {
    const s = new McpServer({ name: 'funkpayai', version: '0.1.0' })

    s.tool('get_balance', 'Get wallet balance in satoshis', {}, async () => {
      const sat = await this.rpc.getBalance()
      return { content: [{ type: 'text', text: `${sat} sat` }] }
    })

    s.tool(
      'get_new_address',
      'Generate a new Bitcoin receive address',
      { label: z.string().optional() },
      async ({ label }) => {
        const address = await this.rpc.getNewAddress(label)
        return { content: [{ type: 'text', text: address }] }
      }
    )

    s.tool(
      'send_payment',
      'Send Bitcoin to an address (subject to user approval policy)',
      {
        address: z.string().describe('Bitcoin address'),
        amount_sat: z.number().int().positive().describe('Amount in satoshis'),
        comment: z.string().optional()
      },
      async ({ address, amount_sat, comment }) => {
        const settings = loadSettings()
        const needsApproval =
          settings.approvalMode === 'always' ||
          (settings.approvalMode === 'threshold' && amount_sat >= settings.approvalThresholdSat)

        if (needsApproval) {
          const approved = await this.onApprovalRequired(address, amount_sat)
          if (!approved) {
            return { content: [{ type: 'text', text: 'Payment rejected by user.' }], isError: true }
          }
        }

        const txid = await this.rpc.sendToAddress(address, amount_sat, comment)
        // update ledger record if we have one for this address
        const ledger = getLedger()
        const existing = ledger.list().find((r) => r.address === address && !r.txid)
        if (existing) ledger.update(existing.id, { txid })
        return { content: [{ type: 'text', text: txid }] }
      }
    )

    s.tool(
      'get_transaction',
      'Get transaction status and confirmations',
      { txid: z.string() },
      async ({ txid }) => {
        const tx = await this.rpc.getTransaction(txid)
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ txid: tx.txid, confirmations: tx.confirmations }, null, 2)
            }
          ]
        }
      }
    )

    s.tool(
      'list_transactions',
      'List recent wallet transactions',
      { limit: z.number().int().min(1).max(100).default(20) },
      async ({ limit }) => {
        const txs = await this.rpc.listTransactions(limit)
        return { content: [{ type: 'text', text: JSON.stringify(txs, null, 2) }] }
      }
    )

    s.tool(
      'create_invoice',
      'Create a FunkPay payment invoice on a merchant server. Automatically attaches user shipping/billing info from Settings. Returns address, bip21_uri and payment_id for tracking.',
      {
        merchant_url: z.string().describe('Base URL of the btcfunkpay merchant server, e.g. https://btcfunk.com/pay'),
        amount_sat: z.number().int().positive().optional().describe('Amount in satoshis (omit for open amount)'),
        label: z.string().optional().describe('Order reference or description')
      },
      async ({ merchant_url, amount_sat, label }) => {
        const settings = loadSettings()
        const base = merchant_url.replace(/\/$/, '')
        const body: Record<string, unknown> = {}
        if (amount_sat) body.amount_sat = amount_sat
        if (label) body.label = label

        const { shipping, billing } = settings
        const hasShipping = shipping && shipping.address1
        if (hasShipping) body.shipping = shipping
        const hasBilling = billing && (billing.sameAsShipping ? hasShipping : billing.address1)
        if (hasBilling) body.billing = billing

        try {
          const data = await httpPost(`${base}/invoices`, body)
          // log to ledger so we can recover if merchant goes down
          getLedger().add({
            merchant_url: base,
            payment_id: data.payment_id as string,
            address: data.address as string,
            amount_sat: (data.amount_sat as number) ?? amount_sat ?? 0,
            txid: null,
            on_chain_confs: 0,
            merchant_status: 'pending',
            needs_attention: false
          })
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    payment_id: data.payment_id,
                    address: data.address,
                    bip21_uri: data.bip21_uri,
                    amount_sat: data.amount_sat,
                    expires_at: data.expires_at
                  },
                  null,
                  2
                )
              }
            ]
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e)
          return { content: [{ type: 'text', text: `Invoice creation failed: ${msg}` }], isError: true }
        }
      }
    )

    s.tool(
      'get_invoice_status',
      'Poll the status of a FunkPay payment invoice',
      {
        merchant_url: z.string().describe('Base URL of the btcfunkpay merchant server'),
        payment_id: z.string().describe('payment_id returned by create_invoice')
      },
      async ({ merchant_url, payment_id }) => {
        const base = merchant_url.replace(/\/$/, '')
        try {
          const data = await httpGet(`${base}/invoices/${payment_id}`)
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e)
          return { content: [{ type: 'text', text: `Status check failed: ${msg}` }], isError: true }
        }
      }
    )

    s.tool(
      'wait_for_payment',
      'Wait until a FunkPay invoice is detected or confirmed, according to the user\'s confirmation setting. Blocks until the payment is received or timeout is reached. Use this after create_invoice + send_payment.',
      {
        merchant_url: z.string().describe('Base URL of the btcfunkpay merchant server'),
        payment_id: z.string().describe('payment_id returned by create_invoice'),
        timeout_seconds: z.number().int().min(30).max(3600).default(1800).describe('Max wait time in seconds (default 30 min)')
      },
      async ({ merchant_url, payment_id, timeout_seconds }) => {
        const settings = loadSettings()
        const required = settings.confirmationsRequired
        const releaseOn = required === 0 ? 'detected' : 'confirmed'
        const base = merchant_url.replace(/\/$/, '')
        const ledger = getLedger()
        const record = ledger.findByPaymentId(payment_id)
        const deadline = Date.now() + timeout_seconds * 1000
        const POLL_INTERVAL = 15_000

        while (Date.now() < deadline) {
          try {
            const inv = await httpGet(`${base}/invoices/${payment_id}`) as Record<string, unknown>
            const status = inv.status as string
            const confs = (inv.confirmations as number) ?? 0

            if (record) ledger.update(record.id, { merchant_status: status, on_chain_confs: confs, txid: (inv.txid as string) ?? record.txid })

            const done =
              required === 0
                ? status === 'detected' || status === 'confirmed' || status === 'overpaid'
                : (status === 'confirmed' || status === 'overpaid') && confs >= required

            if (done) {
              if (record) ledger.update(record.id, { needs_attention: false })
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({ payment_id, status, confirmations: confs, received_sat: inv.received_sat, txid: inv.txid }, null, 2)
                }]
              }
            }

            if (status === 'expired') {
              if (record) ledger.update(record.id, { needs_attention: true })
              return {
                content: [{ type: 'text', text: `Invoice ${payment_id} expired before payment was received.` }],
                isError: true
              }
            }
          } catch { /* merchant unreachable, keep trying */ }

          await new Promise((r) => setTimeout(r, POLL_INTERVAL))
        }

        // timeout — check on-chain directly to give agent full picture
        let onChainInfo = ''
        if (record?.txid) {
          try {
            const tx = await this.rpc.getTransaction(record.txid)
            onChainInfo = ` On-chain: ${tx.confirmations} confirmations.`
            if (record) ledger.update(record.id, { on_chain_confs: tx.confirmations, needs_attention: tx.confirmations > 0 })
          } catch { /* ignore */ }
        }

        return {
          content: [{ type: 'text', text: `Timeout: payment not ${releaseOn} within ${timeout_seconds}s.${onChainInfo} Use get_invoice_status to retry or check the Payments tab in FunkPayAI.` }],
          isError: true
        }
      }
    )

    s.tool(
      'list_merchants',
      'List trusted FunkPay merchant servers configured by the user',
      {},
      async () => {
        const { merchants } = loadSettings()
        return { content: [{ type: 'text', text: JSON.stringify(merchants, null, 2) }] }
      }
    )

    s.tool(
      'discover_merchant',
      'Auto-discover FunkPay server for a domain via /.well-known/funkpay.json. Use when the user says "buy from example.com".',
      { domain: z.string().describe('Domain to probe, e.g. btcfunk.com') },
      async ({ domain }) => {
        const clean = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
        const url = `https://${clean}/.well-known/funkpay.json`
        try {
          const data = await httpGet(url) as Record<string, unknown>
          if (!data.server) return { content: [{ type: 'text', text: `${clean} has a /.well-known/funkpay.json but missing "server" field.` }], isError: true }
          return { content: [{ type: 'text', text: JSON.stringify({ domain: clean, server: data.server, name: data.name ?? clean }, null, 2) }] }
        } catch {
          return { content: [{ type: 'text', text: `${clean} does not expose a FunkPay discovery endpoint. Ask the user for the merchant server URL directly.` }], isError: true }
        }
      }
    )

    return s
  }

  async start(port: number): Promise<void> {
    this.httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      if (!req.url?.startsWith('/mcp')) {
        res.writeHead(404)
        res.end()
        return
      }
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      await this.server.connect(transport)
      await transport.handleRequest(req, res, await bodyOf(req))
    })

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(port, '127.0.0.1', resolve)
      this.httpServer!.once('error', async (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          // free the port and retry once
          await freePort(port)
          this.httpServer!.listen(port, '127.0.0.1', resolve)
        } else {
          reject(err)
        }
      })
    })

    console.log(`[mcp] listening on http://127.0.0.1:${port}/mcp`)
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      this.httpServer ? this.httpServer.close((e) => (e ? reject(e) : resolve())) : resolve()
    )
  }
}

async function bodyOf(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function httpRequest(method: 'GET' | 'POST', url: string, body?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const payload = body ? JSON.stringify(body) : undefined
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'funkpayai/1.0',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }
    const transport = parsed.protocol === 'https:' ? https : http
    const req = transport.request(opts, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString()
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${text}`))
        } else {
          try { resolve(JSON.parse(text)) } catch { resolve(text) }
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')) })
    if (payload) req.write(payload)
    req.end()
  })
}

const httpPost = (url: string, body: unknown): Promise<Record<string, unknown>> =>
  httpRequest('POST', url, body) as Promise<Record<string, unknown>>

const httpGet = (url: string): Promise<Record<string, unknown>> =>
  httpRequest('GET', url) as Promise<Record<string, unknown>>
