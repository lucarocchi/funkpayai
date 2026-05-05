import { app } from 'electron'
import { existsSync, mkdirSync, writeFileSync, readFileSync, watch } from 'fs'
import { join } from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

const VERSION = '28.0'

const DOWNLOAD_URLS: Record<string, string> = {
  'darwin-arm64': `https://bitcoincore.org/bin/bitcoin-core-${VERSION}/bitcoin-${VERSION}-arm64-apple-darwin.tar.gz`,
  'darwin-x64':   `https://bitcoincore.org/bin/bitcoin-core-${VERSION}/bitcoin-${VERSION}-x86_64-apple-darwin.tar.gz`,
  'linux-x64':    `https://bitcoincore.org/bin/bitcoin-core-${VERSION}/bitcoin-${VERSION}-x86_64-linux-gnu.tar.gz`,
  'win32-x64':    `https://bitcoincore.org/bin/bitcoin-core-${VERSION}/bitcoin-${VERSION}-win64.zip`,
}

export type InstallStatus = 'not_installed' | 'in_progress' | 'installed'

export class BitcoindInstaller {
  private installDir: string
  private binPath: string
  private logPath: string
  private donePath: string
  private scriptPath: string

  constructor() {
    const userData = app.getPath('userData')
    this.installDir = join(userData, 'bitcoin-core')
    this.binPath    = join(this.installDir, process.platform === 'win32' ? 'bitcoind.exe' : 'bitcoind')
    this.logPath    = join(userData, 'install.log')
    this.donePath   = join(userData, 'install.done')
    this.scriptPath = join(userData, 'install.sh')
  }

  getStatus(): InstallStatus {
    if (existsSync(this.donePath) && existsSync(this.binPath)) return 'installed'
    if (existsSync(this.logPath)) return 'in_progress'
    return 'not_installed'
  }

  getBinaryPath(): string {
    return this.binPath
  }

  getExistingLog(): string[] {
    if (!existsSync(this.logPath)) return []
    return readFileSync(this.logPath, 'utf-8').split('\n').filter(Boolean)
  }

  // Watch log file for new lines — returns unsubscribe fn
  watchLog(cb: (line: string) => void): () => void {
    let lastSize = existsSync(this.logPath)
      ? readFileSync(this.logPath).length
      : 0

    const watcher = watch(app.getPath('userData'), (event, filename) => {
      if (filename === 'install.log') {
        try {
          const content = readFileSync(this.logPath, 'utf-8')
          const newContent = content.slice(lastSize)
          lastSize = content.length
          newContent.split('\n').filter(Boolean).forEach(cb)
        } catch { /* file not ready yet */ }
      }
      if (filename === 'install.done') {
        cb('__DONE__')
      }
    })

    return () => watcher.close()
  }

  async openTerminal(): Promise<void> {
    const key = `${process.platform}-${process.arch}`
    const url = DOWNLOAD_URLS[key]
    if (!url) throw new Error(`Unsupported platform: ${key}`)

    mkdirSync(this.installDir, { recursive: true })

    // Write the install script
    const script = this.buildScript(url)
    writeFileSync(this.scriptPath, script, { mode: 0o755 })

    // Open a real terminal
    if (process.platform === 'darwin') {
      await execAsync(
        `osascript -e 'tell application "Terminal" to do script "bash \\"${this.scriptPath}\\"; exit"'`
      )
      await execAsync('osascript -e \'tell application "Terminal" to activate\'')
    } else if (process.platform === 'linux') {
      await execAsync(`x-terminal-emulator -e bash "${this.scriptPath}" || gnome-terminal -- bash "${this.scriptPath}"`)
    } else {
      // Windows
      await execAsync(`start cmd /k "${this.scriptPath}"`)
    }
  }

  private buildScript(url: string): string {
    const log    = this.logPath.replace(/"/g, '\\"')
    const done   = this.donePath.replace(/"/g, '\\"')
    const binDir = this.installDir.replace(/"/g, '\\"')
    const bin    = this.binPath.replace(/"/g, '\\"')

    return `#!/bin/bash
set -e

LOG="${log}"
DONE="${done}"
BIN_DIR="${binDir}"
BIN="${bin}"
ARCHIVE="$BIN_DIR/bitcoin.tar.gz"

tee_log() { echo "$1" | tee -a "$LOG"; }

tee_log "→ FunkPay MCP — Bitcoin Core v${VERSION} installation"
tee_log "  Platform: $(uname -m)"
tee_log ""

tee_log "→ Downloading Bitcoin Core v${VERSION}..."
curl -L "${url}" -o "$ARCHIVE" --progress-bar 2>&1 | tee -a "$LOG"

tee_log ""
tee_log "→ Extracting..."
tar -xzf "$ARCHIVE" -C "$BIN_DIR" "bitcoin-${VERSION}/bin/bitcoind"
mv "$BIN_DIR/bitcoin-${VERSION}/bin/bitcoind" "$BIN"
rm -rf "$BIN_DIR/bitcoin-${VERSION}" "$ARCHIVE"

tee_log "→ Removing quarantine (macOS Gatekeeper)..."
xattr -dr com.apple.quarantine "$BIN" 2>/dev/null || true
chmod +x "$BIN"
tee_log "→ Signing binary..."
# Use Developer ID Application if available, otherwise ad-hoc (dev only)
DEV_ID=$(security find-identity -v -p codesigning 2>/dev/null | grep "Developer ID Application" | head -1 | awk -F'"' '{print $2}')
if [ -n "$DEV_ID" ]; then
  codesign --force --deep --sign "$DEV_ID" "$BIN"
  tee_log "  Signed with: $DEV_ID"
else
  codesign --force --deep --sign - "$BIN"
  tee_log "  Signed ad-hoc (dev only — get Developer ID for distribution)"
fi

tee_log ""
tee_log "✓ Bitcoin Core v${VERSION} installed successfully"
tee_log "✓ You can close this terminal"
touch "$DONE"
`
  }

  private reset(): void {
    try {
      const { execSync } = require('child_process')
      execSync(`rm -f "${this.logPath}" "${this.donePath}" "${this.binPath}"`)
    } catch { /* ignore */ }
  }
}
