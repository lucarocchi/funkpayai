import { app } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'

export class BitcoindManager {
  private process: ChildProcess | null = null
  private dataDir: string
  private binaryPath: string
  readonly notifyFile: string

  private onLog: (line: string) => void

  constructor(binaryPath: string, pruneGB: number, rpcUser: string, rpcPassword: string, network: 'mainnet' | 'testnet' = 'mainnet', onLog?: (line: string) => void) {
    this.binaryPath = binaryPath
    this.onLog = onLog ?? console.log
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
    if (this.process) return

    this.process = spawn(this.binaryPath, [`-datadir=${this.dataDir}`], {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    this.process.stdout?.on('data', (d) => this.onLog(d.toString().trim()))
    this.process.stderr?.on('data', (d) => this.onLog(d.toString().trim()))
    this.process.on('exit', (code) => {
      this.onLog(`bitcoind exited with code ${code}`)
      this.process = null
    })
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.process) return resolve()
      this.process.once('exit', () => resolve())
      this.process.kill('SIGTERM')
    })
  }

  isRunning(): boolean {
    return this.process !== null
  }
}
