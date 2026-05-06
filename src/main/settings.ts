import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

export type ApprovalMode = 'never' | 'threshold' | 'always'

export interface ShippingInfo {
  firstName: string
  lastName: string
  email: string
  phone: string
  address1: string
  address2: string
  city: string
  state: string
  zip: string
  country: string
}

export interface BillingInfo {
  sameAsShipping: boolean
  company: string
  vatId: string
  firstName: string
  lastName: string
  email: string
  address1: string
  city: string
  zip: string
  country: string
}

export interface Settings {
  // Node & MCP
  rpcUrl: string
  rpcUser: string
  rpcPassword: string
  mcpPort: number
  pruneGB: number
  // Payments
  approvalMode: ApprovalMode
  approvalThresholdSat: number
  // 0 = release on detected (mempool), 1+ = wait N confirmations
  confirmationsRequired: number
  // Identity
  shipping: ShippingInfo
  billing: BillingInfo
}

const EMPTY_SHIPPING: ShippingInfo = {
  firstName: '', lastName: '', email: '', phone: '',
  address1: '', address2: '', city: '', state: '', zip: '', country: ''
}

const EMPTY_BILLING: BillingInfo = {
  sameAsShipping: true,
  company: '', vatId: '',
  firstName: '', lastName: '', email: '',
  address1: '', city: '', zip: '', country: ''
}

const DEFAULTS: Settings = {
  rpcUrl: 'http://127.0.0.1:8332',
  rpcUser: 'luca',
  rpcPassword: 'funkpay123',
  approvalMode: 'threshold',
  approvalThresholdSat: 100_000,
  confirmationsRequired: 1,
  mcpPort: 3282,
  pruneGB: 10,
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
    const saved = JSON.parse(readFileSync(path, 'utf-8'))
    return {
      ...DEFAULTS,
      ...saved,
      shipping: { ...EMPTY_SHIPPING, ...saved.shipping },
      billing:  { ...EMPTY_BILLING,  ...saved.billing  }
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(settings: Settings): void {
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2))
}
