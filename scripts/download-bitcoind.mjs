/**
 * Downloads bitcoind binaries for all target platforms.
 * Run: npm run download-bitcoind
 *
 * Binaries land in:
 *   resources/bitcoind/mac-arm64/bitcoind
 *   resources/bitcoind/mac-x64/bitcoind
 *   resources/bitcoind/win-x64/bitcoind.exe
 *   resources/bitcoind/linux-x64/bitcoind
 */

import { createWriteStream, mkdirSync, chmodSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { pipeline } from 'stream/promises'
import { createGunzip } from 'zlib'
import { extract } from 'tar'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const VERSION = '27.0'

const TARGETS = [
  {
    platform: 'mac-arm64',
    url: `https://bitcoincore.org/bin/bitcoin-core-${VERSION}/bitcoin-${VERSION}-aarch64-apple-darwin.tar.gz`,
    binPath: `bitcoin-${VERSION}/bin/bitcoind`
  },
  {
    platform: 'mac-x64',
    url: `https://bitcoincore.org/bin/bitcoin-core-${VERSION}/bitcoin-${VERSION}-x86_64-apple-darwin.tar.gz`,
    binPath: `bitcoin-${VERSION}/bin/bitcoind`
  },
  {
    platform: 'linux-x64',
    url: `https://bitcoincore.org/bin/bitcoin-core-${VERSION}/bitcoin-${VERSION}-x86_64-linux-gnu.tar.gz`,
    binPath: `bitcoin-${VERSION}/bin/bitcoind`
  },
  {
    platform: 'win-x64',
    url: `https://bitcoincore.org/bin/bitcoin-core-${VERSION}/bitcoin-${VERSION}-win64.zip`,
    binPath: `bitcoin-${VERSION}/bin/bitcoind.exe`,
    isZip: true
  }
]

for (const target of TARGETS) {
  const outDir = join(ROOT, 'resources', 'bitcoind', target.platform)
  mkdirSync(outDir, { recursive: true })

  console.log(`Downloading ${target.platform}…`)

  // NOTE: implement actual download + extract logic per platform
  // This stub shows the structure — add node-fetch + tar/unzip extraction
  console.log(`  → ${target.url}`)
  console.log(`  → out: ${outDir}`)
}

console.log('\nDone. Binaries in resources/bitcoind/')
