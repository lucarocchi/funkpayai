import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'fs'
import { join } from 'path'

export type Network = 'mainnet' | 'testnet'
export type ApprovalMode = 'never' | 'threshold' | 'always'

export interface ShippingInfo {
  firstName: string; lastName: string; email: string; phone: string
  address1: string; address2: string; city: string; state: string
  zip: string; country: string
}

export interface BillingInfo {
  sameAsShipping: boolean; company: string; vatId: string
  firstName: string; lastName: string; email: string
  address1: string; city: string; zip: string; country: string
}

export interface Merchant {
  name: string
  url: string
}

export interface Settings {
  network: Network
  rpcUrl: string
  rpcUser: string
  rpcPassword: string
  mcpPort: number
  approvalMode: ApprovalMode
  approvalThresholdSat: number
  confirmationsRequired: number
  merchants: Merchant[]
  shipping: ShippingInfo
  billing: BillingInfo
}

const EMPTY_SHIPPING: ShippingInfo = {
  firstName: '', lastName: '', email: '', phone: '',
  address1: '', address2: '', city: '', state: '', zip: '', country: ''
}

const EMPTY_BILLING: BillingInfo = {
  sameAsShipping: true, company: '', vatId: '',
  firstName: '', lastName: '', email: '',
  address1: '', city: '', zip: '', country: ''
}

const DEFAULTS: Settings = {
  network: 'mainnet',
  rpcUrl: 'http://127.0.0.1:8332',
  rpcUser: 'funkpay',
  rpcPassword: 'funkpay',
  approvalMode: 'threshold',
  approvalThresholdSat: 100_000,
  confirmationsRequired: 1,
  merchants: [{ name: 'btcfunk.com', url: 'https://btcfunk.com/pay' }],
  mcpPort: 3282,
  shipping: { ...EMPTY_SHIPPING },
  billing: { ...EMPTY_BILLING }
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): Settings {
  const path = settingsPath()
  if (!existsSync(path)) return { ...DEFAULTS }
  try {
    // F-13: harden permissions on existing files (idempotent)
    try { chmodSync(path, 0o600) } catch { /* ignore on Windows */ }
    const saved = JSON.parse(readFileSync(path, 'utf-8'))
    return {
      ...DEFAULTS,
      ...saved,
      merchants: Array.isArray(saved.merchants) ? saved.merchants : DEFAULTS.merchants,
      shipping: { ...EMPTY_SHIPPING, ...saved.shipping },
      billing:  { ...EMPTY_BILLING,  ...saved.billing  }
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(settings: Settings): void {
  // F-13: restrict read permissions — prevents other users from reading RPC credentials
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), { mode: 0o600 })
}
