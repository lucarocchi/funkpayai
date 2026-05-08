import { app } from 'electron'
import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'

const MAX_RECORDS = 500

export interface PaymentRecord {
  id: string
  created_at: number
  merchant_url: string | null
  payment_id: string | null
  address: string
  amount_sat: number
  txid: string | null
  on_chain_confs: number
  merchant_status: string | null  // pending/detected/confirmed/expired/overpaid/unknown
  last_checked: number
  needs_attention: boolean         // on-chain confirmed but merchant unreachable/expired
}

export class PaymentLedger {
  private filePath: string
  private records: PaymentRecord[]

  constructor() {
    this.filePath = join(app.getPath('userData'), 'payments.json')
    this.records = this.load()
  }

  private load(): PaymentRecord[] {
    if (!existsSync(this.filePath)) return []
    try {
      return JSON.parse(readFileSync(this.filePath, 'utf-8'))
    } catch {
      return []
    }
  }

  private save(): void {
    // F-14: restrict permissions — financial ledger contains addresses and txids
    // F-17: non-blocking write — errors logged, never thrown into callers
    writeFile(this.filePath, JSON.stringify(this.records, null, 2), { mode: 0o600 })
      .catch((e) => console.error('[ledger] save failed:', e))
  }

  add(data: Omit<PaymentRecord, 'id' | 'created_at' | 'last_checked'>): PaymentRecord {
    const record: PaymentRecord = {
      id: randomUUID(),
      created_at: Date.now(),
      last_checked: Date.now(),
      ...data
    }
    this.records.unshift(record)
    if (this.records.length > MAX_RECORDS) this.records.splice(MAX_RECORDS)
    this.save()
    return record
  }

  update(id: string, patch: Partial<PaymentRecord>): void {
    const idx = this.records.findIndex((r) => r.id === id)
    if (idx === -1) return
    this.records[idx] = { ...this.records[idx], ...patch, last_checked: Date.now() }
    this.save()
  }

  list(): PaymentRecord[] {
    return this.records
  }

  findByPaymentId(paymentId: string): PaymentRecord | null {
    return this.records.find((r) => r.payment_id === paymentId) ?? null
  }

  findByTxid(txid: string): PaymentRecord | null {
    return this.records.find((r) => r.txid === txid) ?? null
  }
}

let _ledger: PaymentLedger | null = null
export function getLedger(): PaymentLedger {
  if (!_ledger) _ledger = new PaymentLedger()
  return _ledger
}
