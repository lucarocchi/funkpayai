import { createServer, IncomingMessage, ServerResponse } from 'http'
import { exec } from 'child_process'
import { promisify } from 'util'
import https from 'https'
import http from 'http'
import { BitcoinRpc } from './rpc'
import { loadSettings } from './settings'
import { getLedger } from './payments'

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
  } catch { /* nothing on port */ }
}

type ApprovalHandler = (address: string, amountSat: number) => Promise<boolean>

export class WalletApiServer {
  private httpServer: ReturnType<typeof createServer> | null = null
  private rpc: BitcoinRpc | null = null
  private onApprovalRequired: ApprovalHandler

  constructor(onApprovalRequired: ApprovalHandler) {
    this.onApprovalRequired = onApprovalRequired
  }

  setRpc(rpc: BitcoinRpc): void {
    this.rpc = rpc
  }

  private get rpcOrThrow(): BitcoinRpc {
    if (!this.rpc) throw new Error('Bitcoin node not ready yet — please wait')
    return this.rpc
  }

  async start(port: number): Promise<void> {
    this.httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      if (!req.url?.startsWith('/api')) {
        res.writeHead(404)
        res.end()
        return
      }

      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Access-Control-Allow-Origin', '127.0.0.1')

      try {
        const body = await bodyOf(req)
        const params: Record<string, unknown> = body.length ? JSON.parse(body.toString()) : {}
        const result = await this.handle(req.method!, req.url!, params)
        res.writeHead(200)
        res.end(JSON.stringify(result))
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        res.writeHead(500)
        res.end(JSON.stringify({ error: msg }))
      }
    })

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(port, '127.0.0.1', resolve)
      this.httpServer!.once('error', async (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          await freePort(port)
          this.httpServer!.listen(port, '127.0.0.1', resolve)
        } else {
          reject(err)
        }
      })
    })

    console.log(`[api] listening on http://127.0.0.1:${port}/api`)
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      this.httpServer ? this.httpServer.close((e) => (e ? reject(e) : resolve())) : resolve()
    )
  }

  private async handle(
    method: string,
    url: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const path = url.split('?')[0]

    if (method === 'GET' && path === '/api/health') {
      return { ok: true, ready: !!this.rpc }
    }

    if (method === 'GET' && path === '/api/settings') {
      return loadSettings()
    }

    if (method === 'GET' && path === '/api/merchants') {
      return loadSettings().merchants ?? []
    }

    if (method === 'POST' && path === '/api/balance') {
      return { sat: await this.rpcOrThrow.getBalance() }
    }

    if (method === 'POST' && path === '/api/address') {
      const address = await this.rpcOrThrow.getNewAddress(params.label as string | undefined)
      return { address }
    }

    if (method === 'POST' && path === '/api/send') {
      const { address, amount_sat, comment } = params as {
        address: string
        amount_sat: number
        comment?: string
      }
      const settings = loadSettings()
      const needsApproval =
        settings.approvalMode === 'always' ||
        (settings.approvalMode === 'threshold' && amount_sat >= settings.approvalThresholdSat)

      if (needsApproval) {
        const approved = await this.onApprovalRequired(address, amount_sat)
        if (!approved) throw new Error('Payment rejected by user')
      }

      const txid = await this.rpcOrThrow.sendToAddress(address, amount_sat, comment)
      const ledger = getLedger()
      const existing = ledger.list().find((r) => r.address === address && !r.txid)
      if (existing) ledger.update(existing.id, { txid })
      return { txid }
    }

    if (method === 'POST' && path === '/api/transaction') {
      const tx = await this.rpcOrThrow.getTransaction(params.txid as string)
      return { txid: tx.txid, confirmations: tx.confirmations }
    }

    if (method === 'POST' && path === '/api/transactions') {
      return this.rpcOrThrow.listTransactions((params.limit as number) ?? 20)
    }

    if (method === 'POST' && path === '/api/invoice') {
      const { merchant_url, amount_sat, label } = params as {
        merchant_url: string
        amount_sat?: number
        label?: string
      }
      const settings = loadSettings()
      const base = merchant_url.replace(/\/$/, '')
      const body: Record<string, unknown> = {}
      if (amount_sat) body.amount_sat = amount_sat
      if (label) body.label = label
      const { shipping, billing } = settings
      if (shipping?.address1) body.shipping = shipping
      if (billing && (billing.sameAsShipping ? shipping?.address1 : billing.address1)) body.billing = billing

      const data = await httpPost(`${base}/invoices`, body)
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
      return data
    }

    if (method === 'POST' && path === '/api/invoice-status') {
      const { merchant_url, payment_id } = params as { merchant_url: string; payment_id: string }
      const base = merchant_url.replace(/\/$/, '')
      const data = await httpGet(`${base}/invoices/${payment_id}`)

      // keep ledger in sync
      const ledger = getLedger()
      const record = ledger.findByPaymentId(payment_id)
      if (record) {
        ledger.update(record.id, {
          merchant_status: (data.status as string) ?? record.merchant_status,
          on_chain_confs: (data.confirmations as number) ?? record.on_chain_confs,
          txid: (data.txid as string) ?? record.txid
        })
      }
      return data
    }

    if (method === 'POST' && path === '/api/discover') {
      const domain = (params.domain as string).replace(/^https?:\/\//, '').replace(/\/.*$/, '')
      const data = await httpGet(`https://${domain}/.well-known/funkpay.json`) as Record<string, unknown>
      if (!data.server) throw new Error(`${domain} has /.well-known/funkpay.json but missing "server" field`)
      return { domain, server: data.server, name: data.name ?? domain }
    }

    throw new Error(`Unknown endpoint: ${method} ${path}`)
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

const httpPost = (url: string, body: unknown) =>
  httpRequest('POST', url, body) as Promise<Record<string, unknown>>

const httpGet = (url: string) =>
  httpRequest('GET', url) as Promise<Record<string, unknown>>
