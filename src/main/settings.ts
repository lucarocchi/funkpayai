import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

export type ApprovalMode = 'never' | 'threshold' | 'always'

export interface Settings {
  rpcUrl: string
  rpcUser: string
  rpcPassword: string
  approvalMode: ApprovalMode
  approvalThresholdSat: number
  mcpPort: number
  pruneGB: number
}

const DEFAULTS: Settings = {
  rpcUrl: 'http://127.0.0.1:8332',
  rpcUser: 'luca',
  rpcPassword: 'funkpay123',
  approvalMode: 'threshold',
  approvalThresholdSat: 100_000,
  mcpPort: 3282,
  pruneGB: 10
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): Settings {
  const path = settingsPath()
  if (!existsSync(path)) return { ...DEFAULTS }
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(path, 'utf-8')) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(settings: Settings): void {
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2))
}
