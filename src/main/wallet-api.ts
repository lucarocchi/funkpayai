import { createServer, IncomingMessage, ServerResponse } from 'http'
import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import https from 'https'
import http from 'http'
import { z } from 'zod'
import { BitcoinRpc } from './rpc'
import { loadSettings } from './settings'
import { getLedger } from './payments'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

// ── Port management ───────────────────────────────────────────────────────────

// F-03: validate port as integer + no shell injection
async function freePort(port: number): Promise<void> {
  const safePort = Math.floor(Number(port))
  if (!Number.isFinite(safePort) || safePort < 1024 || safePort > 65535) return
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync(`netstat -ano | findstr LISTENING | findstr :${safePort}`)
      const pids = [...new Set(
        stdout.trim().split('\n')
          .map((l) => { const p = l.trim().split(/\s+/); return p[p.length - 1] })
          .filter((p) => /^\d+$/.test(p) && p !== '0')
      )]
      for (const pid of pids) {
        try { await execAsync(`taskkill /PID ${pid} /F`) } catch { /* ignore */ }
      }
    } else {
      // F-03: execFileAsync with array args — no shell, no injection
      const { stdout } = await execFileAsync('lsof', ['-ti', `:${safePort}`])
      const pids = stdout.trim().split('\n').filter(Boolean).map(Number).filter((n) => n > 0 && n < 4_194_304)
      for (const pid of pids) {
        try { process.kill(pid, 'SIGKILL') } catch { /* ignore */ }
      }
    }
    await new Promise((r) => setTimeout(r, 300))
  } catch { /* nothing on port */ }
}

// ── Input validation schemas (F-15) ──────────────────────────────────────────

const SAT_MAX = 21_000_000 * 100_000_000

const SAFE_ID = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/, 'Invalid ID format')

const SendSchema = z.object({
  address: z.string().min(25).max(90),
  amount_sat: z.number().int().positive().max(SAT_MAX),
  comment: z.string().max(256).optional()
})

const InvoiceSchema = z.object({
  merchant_url: z.string().url().max(256),
  amount_sat: z.number().int().positive().max(SAT_MAX).optional(),
  label: z.string().max(256).optional(),
  amount_fiat: z.number().positive().optional(),
  currency: z.string().max(10).optional(),
})

// F-09: payment_id validated as safe alphanumeric before URL construction
const InvoiceStatusSchema = z.object({
  merchant_url: z.string().url().max(256),
  payment_id: SAFE_ID
})

const WaitPaymentSchema = z.object({
  merchant_url: z.string().url().max(256),
  payment_id: SAFE_ID,
  timeout_seconds: z.number().int().min(30).max(7200).optional()
})

const WaitStatusSchema = z.object({ payment_id: SAFE_ID })

const TxSchema = z.object({
  txid: z.string().length(64).regex(/^[0-9a-fA-F]+$/, 'Invalid txid')
})

const LimitSchema = z.object({
  limit: z.number().int().min(1).max(100).optional()
})

const DiscoverSchema = z.object({ domain: z.string().min(3).max(253) })

// ── Security helpers ──────────────────────────────────────────────────────────

// F-07: validate merchant URL against the user's trusted list
function assertTrustedMerchant(url: string): void {
  const settings = loadSettings()
  const base = url.replace(/\/$/, '')
  const trusted = (settings.merchants ?? []).map((m) => m.url.replace(/\/$/, ''))
  if (!trusted.some((t) => base === t || base.startsWith(t + '/'))) {
    throw new Error('Merchant URL not in trusted list — add it in Settings → Trusted Merchants')
  }
}

// F-08: extract hostname and reject IPs, localhost, IPv6, and malformed input
function parseSafeDomain(raw: string): string {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  let hostname: string
  try {
    hostname = new URL(withScheme).hostname.toLowerCase()
  } catch {
    throw new Error('Invalid domain')
  }
  if (hostname === 'localhost' || hostname.startsWith('[') || /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
    throw new Error('IP addresses and localhost are not allowed')
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(hostname)) {
    throw new Error('Invalid domain format')
  }
  return hostname
}

// ── Types ─────────────────────────────────────────────────────────────────────

type ApprovalHandler = (address: string, amountSat: number) => Promise<boolean>

interface WaitEntry {
  merchant_url: string
  deadline: number
  required: number
}

// ── Server ────────────────────────────────────────────────────────────────────

export class WalletApiServer {
  private httpServer: ReturnType<typeof createServer> | null = null
  private rpc: BitcoinRpc | null = null
  private onApprovalRequired: ApprovalHandler
  // F-01: shared secret validated on every authenticated request
  private readonly token: string
  // F-04: prevent concurrent payments
  private sendInFlight = false
  // F-16: rate limit — max 1 payment per SEND_COOLDOWN_MS
  private lastSendAt = 0
  private readonly SEND_COOLDOWN_MS = 5_000
  // F-11: persistent wait registry — survives proxy restarts
  private waitRegistry = new Map<string, WaitEntry>()
  private pollTimer: ReturnType<typeof setInterval> | null = null

  constructor(token: string, onApprovalRequired: ApprovalHandler) {
    this.token = token
    this.onApprovalRequired = onApprovalRequired
  }

  setRpc(rpc: BitcoinRpc): void {
    this.rpc = rpc
  }

  private get rpcOrThrow(): BitcoinRpc {
    if (!this.rpc) throw new Error('Bitcoin node not ready yet — please wait')
    return this.rpc
  }

  // F-11: background loop — polls merchant for all registered waits
  private startPollLoop(): void {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => { this.tickWaits().catch(console.error) }, 15_000)
  }

  private async tickWaits(): Promise<void> {
    const now = Date.now()
    for (const [payment_id, entry] of this.waitRegistry) {
      if (now > entry.deadline) { this.waitRegistry.delete(payment_id); continue }
      try {
        const data = await httpGet(`${entry.merchant_url}/invoices/${payment_id}`) as Record<string, unknown>
        const ledger = getLedger()
        const record = ledger.findByPaymentId(payment_id)
        if (record) {
          ledger.update(record.id, {
            merchant_status: (data.status as string) ?? record.merchant_status,
            on_chain_confs: (data.confirmations as number) ?? record.on_chain_confs,
            txid: (data.txid as string) ?? record.txid
          })
        }
        const status = data.status as string
        const confs = (data.confirmations as number) ?? 0
        const done = entry.required === 0
          ? ['detected', 'confirmed', 'overpaid'].includes(status)
          : ['confirmed', 'overpaid'].includes(status) && confs >= entry.required
        if (done || status === 'expired') this.waitRegistry.delete(payment_id)
      } catch { /* merchant unreachable — keep in registry until deadline */ }
    }
    if (this.waitRegistry.size === 0 && this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  async start(port: number): Promise<void> {
    this.httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      if (!req.url?.startsWith('/api')) {
        res.writeHead(404)
        res.end()
        return
      }

      // F-12: no CORS header — API is localhost-only, browser access is not intended
      res.setHeader('Content-Type', 'application/json')

      try {
        const body = await bodyOf(req)
        const params: Record<string, unknown> = body.length ? JSON.parse(body.toString()) : {}
        const reqToken = (req.headers['x-funkpay-token'] as string) ?? ''
        const result = await this.handle(req.method!, req.url!, params, reqToken)
        res.writeHead(200)
        res.end(JSON.stringify(result))
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        res.writeHead(msg === 'Unauthorized' ? 401 : 500)
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

  get isListening(): boolean {
    return this.httpServer?.listening ?? false
  }

  async stop(): Promise<void> {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
    await new Promise<void>((resolve, reject) =>
      this.httpServer ? this.httpServer.close((e) => (e ? reject(e) : resolve())) : resolve()
    )
  }

  private async handle(
    method: string,
    url: string,
    params: Record<string, unknown>,
    reqToken: string
  ): Promise<unknown> {
    const path = url.split('?')[0]

    // Health is unauthenticated — proxy uses it to detect if the app is running
    if (method === 'GET' && path === '/api/health') {
      return { ok: true, ready: !!this.rpc }
    }

    // F-01: all other endpoints require a valid token
    if (reqToken !== this.token) throw new Error('Unauthorized')

    // F-02: minimal config — no credentials exposed
    if (method === 'GET' && path === '/api/config') {
      const s = loadSettings()
      return { confirmationsRequired: s.confirmationsRequired, network: s.network }
    }

    if (method === 'GET' && path === '/api/merchants') {
      return loadSettings().merchants ?? []
    }

    if (method === 'POST' && path === '/api/balance') {
      return { sat: await this.rpcOrThrow.getBalance() }
    }

    if (method === 'POST' && path === '/api/address') {
      const label = z.string().max(128).optional().parse(params.label)
      return { address: await this.rpcOrThrow.getNewAddress(label) }
    }

    if (method === 'POST' && path === '/api/send') {
      // F-15: validate all inputs
      const { address, amount_sat, comment } = SendSchema.parse(params)
      // F-16: rate limit
      const now = Date.now()
      const elapsed = now - this.lastSendAt
      if (elapsed < this.SEND_COOLDOWN_MS) {
        throw new Error(`Rate limit: wait ${Math.ceil((this.SEND_COOLDOWN_MS - elapsed) / 1000)}s before next payment`)
      }
      // F-04: mutex
      if (this.sendInFlight) throw new Error('A payment is already in progress — wait for it to complete')
      this.sendInFlight = true
      this.lastSendAt = Date.now()
      try {
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
      } finally {
        this.sendInFlight = false
      }
    }

    if (method === 'POST' && path === '/api/transaction') {
      const { txid } = TxSchema.parse(params)
      const tx = await this.rpcOrThrow.getTransaction(txid)
      return { txid: tx.txid, confirmations: tx.confirmations }
    }

    if (method === 'POST' && path === '/api/transactions') {
      const { limit } = LimitSchema.parse(params)
      return this.rpcOrThrow.listTransactions(limit ?? 20)
    }

    if (method === 'POST' && path === '/api/invoice') {
      // F-15: validate + F-07: merchant allowlist
      const { merchant_url, amount_sat, label, amount_fiat, currency } = InvoiceSchema.parse(params)
      assertTrustedMerchant(merchant_url)
      const settings = loadSettings()
      const base = merchant_url.replace(/\/$/, '')
      const body: Record<string, unknown> = {}
      if (amount_sat) body.amount_sat = amount_sat
      if (label) body.label = label
      if (amount_fiat) body.amount_fiat = amount_fiat
      if (currency) body.currency = currency
      const { shipping, billing } = settings
      if (shipping?.address1) body.shipping = shipping
      if (billing && (billing.sameAsShipping ? shipping?.address1 : billing.address1)) body.billing = billing
      const data = await httpPost(`${base}/invoices`, body)
      getLedger().add({
        merchant_url: base,
        payment_id: data.payment_id as string,
        address: data.address as string,
        amount_sat: (data.amount_sat as number) ?? amount_sat ?? 0,
        amount_fiat: (data.amount_fiat as number) ?? amount_fiat ?? null,
        currency: (data.currency as string) ?? currency ?? null,
        exchange_rate: (data.exchange_rate as number) ?? null,
        txid: null, on_chain_confs: 0, merchant_status: 'pending', needs_attention: false
      })
      return data
    }

    if (method === 'POST' && path === '/api/invoice-status') {
      // F-15: validate + F-09: safe payment_id + F-07: merchant allowlist
      const { merchant_url, payment_id } = InvoiceStatusSchema.parse(params)
      assertTrustedMerchant(merchant_url)
      const base = merchant_url.replace(/\/$/, '')
      const data = await httpGet(`${base}/invoices/${payment_id}`)
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

    // F-11: register a persistent server-side wait — survives proxy restarts
    if (method === 'POST' && path === '/api/wait-payment') {
      const { merchant_url, payment_id, timeout_seconds = 1800 } = WaitPaymentSchema.parse(params)
      assertTrustedMerchant(merchant_url)
      const s = loadSettings()
      // Idempotent: re-registering extends the deadline
      this.waitRegistry.set(payment_id, {
        merchant_url: merchant_url.replace(/\/$/, ''),
        deadline: Date.now() + timeout_seconds * 1000,
        required: s.confirmationsRequired ?? 0
      })
      this.startPollLoop()
      const record = getLedger().findByPaymentId(payment_id)
      return { payment_id, status: record?.merchant_status ?? 'pending', confirmations: record?.on_chain_confs ?? 0, registered: true }
    }

    // F-11: proxy polls this to check if the server-side wait resolved
    if (method === 'POST' && path === '/api/wait-status') {
      const { payment_id } = WaitStatusSchema.parse(params)
      const record = getLedger().findByPaymentId(payment_id)
      if (!record) throw new Error(`Unknown payment_id: ${payment_id}`)
      return {
        payment_id,
        status: record.merchant_status ?? 'pending',
        confirmations: record.on_chain_confs,
        txid: record.txid,
        received_sat: record.amount_sat,
        still_waiting: this.waitRegistry.has(payment_id)
      }
    }

    if (method === 'POST' && path === '/api/discover') {
      // F-08: validate domain — no IPs, no localhost, no port injection
      const { domain: rawDomain } = DiscoverSchema.parse(params)
      const hostname = parseSafeDomain(rawDomain)
      const data = await httpGet(`https://${hostname}/.well-known/funkpay.json`) as Record<string, unknown>
      if (!data.server) throw new Error(`${hostname} has /.well-known/funkpay.json but missing "server" field`)
      return { domain: hostname, server: data.server, name: data.name ?? hostname }
    }

    throw new Error(`Unknown endpoint: ${method} ${path}`)
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
