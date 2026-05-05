import { app } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'

export class BitcoindManager {
  private process: ChildProcess | null = null
  private dataDir: string

  constructor(pruneGB: number, rpcUser: string, rpcPassword: string) {
    this.dataDir = join(app.getPath('userData'), 'bitcoin')
    mkdirSync(this.dataDir, { recursive: true })
    this.writeConfig(pruneGB, rpcUser, rpcPassword)
  }

  private writeConfig(pruneGB: number, rpcUser: string, rpcPassword: string): void {
    const pruneMB = pruneGB * 1024
    const conf = [
      'server=1',
      'listen=0',
      `prune=${pruneMB}`,
      `rpcuser=${rpcUser}`,
      `rpcpassword=${rpcPassword}`,
      'rpcbind=127.0.0.1',
      'rpcallowip=127.0.0.1'
    ].join('\n')
    writeFileSync(join(this.dataDir, 'bitcoin.conf'), conf)
  }

  start(): void {
    if (this.process) return

    const bin = this.binaryPath()
    try {
      this.process = spawn(bin, [`-datadir=${this.dataDir}`], {
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (e) {
      console.warn('[bitcoind] failed to spawn:', e)
      return
    }

    this.process.stdout?.on('data', (d) => console.log('[bitcoind]', d.toString().trim()))
    this.process.stderr?.on('data', (d) => {
      const msg = d.toString().trim()
      // already running is not an error in dev
      if (msg.includes('Cannot obtain a lock')) {
        console.log('[bitcoind] already running, connecting to existing node')
        this.process = null
      } else {
        console.error('[bitcoind]', msg)
      }
    })

    this.process.on('exit', (code) => {
      console.log(`[bitcoind] exited with code ${code}`)
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

  private binaryPath(): string {
    const { platform, arch } = process
    const exe = platform === 'win32' ? 'bitcoind.exe' : 'bitcoind'

    if (app.isPackaged) {
      return join(process.resourcesPath, 'bitcoind', exe)
    }

    // dev: use binaries downloaded into resources/bitcoind/ via npm run download-bitcoind
    const dir = platform === 'darwin'
      ? arch === 'arm64' ? 'mac-arm64' : 'mac-x64'
      : platform === 'win32' ? 'win-x64' : 'linux-x64'

    return join(__dirname, '../../resources/bitcoind', dir, exe)
  }
}
