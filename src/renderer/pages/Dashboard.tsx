import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

export interface Status {
  bitcoind: boolean
  bitcoindStarted: boolean
  mcp: boolean
  mcpPort: number
  cliPath: string | null
}

export interface SyncInfo {
  blocks: number
  headers: number
  progress: number
  syncing: boolean
}

interface Props {
  status: Status
  sync: SyncInfo | null
}

export default function Dashboard({ status, sync }: Props): JSX.Element {
  const [copied, setCopied] = useState(false)

  const stdioConfig = status.cliPath
    ? JSON.stringify({ mcpServers: { funkpayai: { command: 'node', args: [status.cliPath] } } }, null, 2)
    : JSON.stringify({ mcpServers: { funkpayai: { url: `http://127.0.0.1:${status.mcpPort}/api` } } }, null, 2)

  const copy = (): void => {
    navigator.clipboard.writeText(stdioConfig)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const pct = sync ? Math.round(sync.progress * 1000) / 10 : 0
  // sync null while bitcoind is running = node busy (IBD work queue full) → still syncing
  const isSyncing = status.bitcoind && (sync ? sync.syncing : true)
  const isStarting = !status.bitcoind && status.bitcoindStarted

  // Node card label and color
  let nodeLabel = 'Not running'
  let nodeRunning = false
  if (isStarting) { nodeLabel = 'Starting up…'; nodeRunning = false }
  else if (isSyncing) { nodeLabel = sync ? `Syncing — ${pct.toFixed(1)}%` : 'Syncing…'; nodeRunning = false }
  else if (status.bitcoind) { nodeLabel = 'Running'; nodeRunning = true }

  return (
    <div>
      <h1 style={styles.title}>Dashboard</h1>

      <div style={styles.grid}>
        <Card title="Bitcoin Node" running={nodeRunning} label={nodeLabel} />
        <Card title="Wallet API" running={status.mcp} label={status.mcp ? `Port ${status.mcpPort}` : 'Stopped'} />
      </div>

      {/* Starting phase */}
      {isStarting && (
        <div style={{ ...styles.infoBox, borderColor: '#3d4068' }}>
          <div style={styles.infoTitle}>⏳ Node is starting up</div>
          <p style={styles.infoText}>
            Bitcoin Core is launching — this takes a minute on first run.
            On the very first launch, the node will then sync the blockchain,
            which <strong style={{ color: '#e2e8f0' }}>may take several hours.</strong>
          </p>
          <p style={{ ...styles.infoText, marginTop: 6 }}>
            You can leave this running in the background — the app will be ready automatically.
          </p>
        </div>
      )}

      {/* Syncing phase */}
      {isSyncing && sync && (
        <div style={styles.infoBox}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={styles.infoTitle}>Syncing Bitcoin blockchain</div>
            <span style={{ fontSize: 18, fontWeight: 700, color: '#f7931a' }}>{pct.toFixed(1)}%</span>
          </div>
          <div style={styles.progressTrack}>
            <div style={{ ...styles.progressFill, width: `${Math.min(pct, 100)}%` }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 12, color: '#475569' }}>
            <span style={{ fontFamily: 'monospace' }}>
              {sync.blocks.toLocaleString()} / {sync.headers.toLocaleString()} blocks
            </span>
            <span>{pct < 10 ? 'Many hours remaining' : pct < 50 ? 'Several hours remaining' : pct < 90 ? 'Getting closer…' : 'Almost done!'}</span>
          </div>
          <p style={{ ...styles.infoText, marginTop: 12 }}>
            The wallet will be available as soon as sync completes.
            You can safely close this window — the node keeps running in the background.
          </p>
        </div>
      )}

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Connect your AI agent</div>
        <p style={styles.hint}>
          Paste this config into your MCP client (Claude Code, Cursor, etc.) once.
          The agent will launch FunkPay automatically when needed.
        </p>
        <div style={{ position: 'relative' }}>
          <pre style={styles.code}>{stdioConfig}</pre>
          <button style={styles.copyBtn} onClick={copy}>
            {copied
              ? <><Check size={13} style={{ marginRight: 5, verticalAlign: 'middle' }} />Copied</>
              : <><Copy size={13} style={{ marginRight: 5, verticalAlign: 'middle' }} />Copy config</>
            }
          </button>
        </div>
        {!status.cliPath && (
          <p style={styles.warn}>⚠ Proxy not installed yet — restart the app to complete setup.</p>
        )}
      </div>
    </div>
  )
}

function Card({ title, running, label }: { title: string; running: boolean; label: string }): JSX.Element {
  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>{title}</div>
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 12, gap: 8 }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: running ? '#4ade80' : '#f59e0b',
          boxShadow: running ? '0 0 6px #4ade8088' : 'none',
          display: 'inline-block', flexShrink: 0
        }} />
        <span style={{ fontSize: 14, color: running ? '#e2e8f0' : '#94a3b8' }}>{label}</span>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  title: { fontSize: 20, fontWeight: 600, marginBottom: 24 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 16 },
  card: { background: '#1a1d27', border: '1px solid #2d3048', borderRadius: 8, padding: 20 },
  cardTitle: { fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' },
  infoBox: { background: '#1a1d27', border: '1px solid #f7931a33', borderRadius: 8, padding: 20, marginBottom: 16 },
  infoTitle: { fontSize: 13, fontWeight: 600, color: '#f7931a', marginBottom: 8 },
  infoText: { fontSize: 13, color: '#64748b', lineHeight: 1.6, margin: 0 },
  progressTrack: { height: 8, background: '#2d3048', borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', background: 'linear-gradient(90deg, #f7931a, #fbbf24)', borderRadius: 4, transition: 'width 0.8s ease' },
  section: { background: '#1a1d27', border: '1px solid #2d3048', borderRadius: 8, padding: 20 },
  sectionTitle: { fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 },
  hint: { fontSize: 13, color: '#64748b', marginBottom: 14, lineHeight: 1.5 },
  code: { background: '#0f1117', border: '1px solid #2d3048', borderRadius: 6, padding: '14px 16px', fontSize: 12, color: '#94a3b8', overflowX: 'auto', margin: 0 },
  copyBtn: { position: 'absolute', top: 10, right: 10, padding: '5px 12px', background: '#2d3048', border: '1px solid #3d4068', borderRadius: 5, color: '#94a3b8', fontSize: 12, cursor: 'pointer' },
  warn: { marginTop: 12, fontSize: 12, color: '#eab308' }
}
