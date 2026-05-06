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

  constructor(binaryPath: string, pruneGB: number, rpcUser: string, rpcPassword: string, onLog?: (line: string) => void) {
    this.binaryPath = binaryPath
    this.onLog = onLog ?? console.log
    this.dataDir = join(app.getPath('userData'), 'bitcoin')
    this.notifyFile = join(app.getPath('userData'), 'wallet-notify.txt')
    mkdirSync(this.dataDir, { recursive: true })
    this.writeConfig(pruneGB, rpcUser, rpcPassword)
  }

  private writeConfig(pruneGB: number, rpcUser: string, rpcPassword: string): void {
    const pruneMB = pruneGB * 1024
    // walletnotify appends the txid to a file our main process watches
    const notifyCmd = process.platform === 'win32'
      ? `cmd /c echo %s >> "${this.notifyFile}"`
      : `/bin/sh -c 'echo %s >> "${this.notifyFile}"'`
    const conf = [
      'server=1',
      'listen=0',
      `prune=${pruneMB}`,
      `rpcuser=${rpcUser}`,
      `rpcpassword=${rpcPassword}`,
      'rpcbind=127.0.0.1',
      'rpcallowip=127.0.0.1',
      `walletnotify=${notifyCmd}`
    ].join('\n')
    writeFileSync(join(this.dataDir, 'bitcoin.conf'), conf)
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
