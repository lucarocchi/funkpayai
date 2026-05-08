import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { randomBytes } from 'crypto'

const TOKEN_DIR = join(homedir(), '.funkpay')
const TOKEN_PATH = join(TOKEN_DIR, 'api-token')

export function loadOrCreateToken(): string {
  if (existsSync(TOKEN_PATH)) {
    try {
      const t = readFileSync(TOKEN_PATH, 'utf-8').trim()
      if (/^[0-9a-f]{64}$/.test(t)) return t
    } catch { /* fall through to regenerate */ }
  }
  const token = randomBytes(32).toString('hex')
  mkdirSync(TOKEN_DIR, { recursive: true })
  writeFileSync(TOKEN_PATH, token, { mode: 0o600 })
  return token
}
