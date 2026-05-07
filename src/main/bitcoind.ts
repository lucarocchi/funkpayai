import { app } from 'electron'
import { spawn } from 'child_process'
import { join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'

export class BitcoindManager {
  private dataDir: string
  private binaryPath: string
  private rpcPort: number
  private rpcUser: string
  private rpcPassword: string
  readonly notifyFile: string

  constructor(
    binaryPath: string,
    pruneGB: number,
    rpcUser: string,
    rpcPassword: string,
    network: 'mainnet' | 'testnet' = 'mainnet'
  ) {
    this.binaryPath = binaryPath
    this.rpcUser = rpcUser
    this.rpcPassword = rpcPassword
    this.rpcPort = network === 'testnet' ? 18332 : 8332
    const subdir = network === 'testnet' ? 'bitcoin-testnet' : 'bitcoin'
    this.dataDir = join(app.getPath('userData'), subdir)
    this.notifyFile = join(app.getPath('userData'), `wallet-notify${network === 'testnet' ? '-testnet' : ''}.txt`)
    mkdirSync(this.dataDir, { recursive: true })
    this.writeConfig(pruneGB, rpcUser, rpcPassword, network)
  }

  private writeConfig(pruneGB: number, rpcUser: string, rpcPassword: string, network: 'mainnet' | 'testnet'): void {
    const pruneMB = pruneGB * 1024
    const notifyCmd = process.platform === 'win32'
      ? `cmd /c echo %s >> "${this.notifyFile}"`
      : `/bin/sh -c 'echo %s >> "${this.notifyFile}"'`
    const lines = [
      'server=1',
      'listen=0',
      `prune=${pruneMB}`,
      `rpcuser=${rpcUser}`,
      `rpcpassword=${rpcPassword}`,
      'rpcbind=127.0.0.1',
      'rpcallowip=127.0.0.1',
      `walletnotify=${notifyCmd}`
    ]
    if (network === 'testnet') {
      lines.push('testnet=1', '[test]', 'rpcport=18332', 'port=18333')
    }
    writeFileSync(join(this.dataDir, 'bitcoin.conf'), lines.join('\n'))
  }

  start(): void {
    // Launch as daemon — detaches from this process so it survives app close/crash
    const proc = spawn(this.binaryPath, [`-datadir=${this.dataDir}`, '-daemon'], {
      detached: true,
      stdio: 'ignore'
    })
    proc.unref()
    console.log(`[bitcoind] daemon launched (port ${this.rpcPort})`)
  }

  async stop(): Promise<void> {
    try {
      await this.rpcCall('stop')
      // Wait up to 15s for it to actually shut down
      for (let i = 0; i < 15; i++) {
        await sleep(1000)
        if (!await this.isRpcReady()) return
      }
    } catch { /* already stopped or not reachable */ }
  }

  async isRpcReady(): Promise<boolean> {
    try {
      await this.rpcCall('ping')
      return true
    } catch {
      return false
    }
  }

  private async rpcCall(method: string, params: unknown[] = []): Promise<unknown> {
    const res = await fetch(`http://127.0.0.1:${this.rpcPort}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(`${this.rpcUser}:${this.rpcPassword}`).toString('base64')
      },
      body: JSON.stringify({ jsonrpc: '1.0', id: 1, method, params }),
      signal: AbortSignal.timeout(5000)
    })
    const json = await res.json() as { result: unknown; error: { message: string } | null }
    if (json.error) throw new Error(json.error.message)
    return json.result
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
