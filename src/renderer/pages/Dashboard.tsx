import { useEffect, useState } from 'react'
import { Copy, Check } from 'lucide-react'

interface Status {
  bitcoind: boolean
  mcp: boolean
  mcpPort: number
  cliPath: string | null
}

interface SyncInfo {
  blocks: number
  headers: number
  progress: number
  syncing: boolean
}

export default function Dashboard(): JSX.Element {
  const [status, setStatus] = useState<Status>({ bitcoind: false, mcp: false, mcpPort: 3282, cliPath: null })
  const [sync, setSync] = useState<SyncInfo | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const checkStatus = async (): Promise<void> => setStatus(await window.api.status())
    const checkSync = async (): Promise<void> => setSync(await window.api.node.syncInfo())

    checkStatus()
    checkSync()

    const statusInterval = setInterval(checkStatus, 5000)
    const syncInterval = setInterval(checkSync, 3000)
    return () => { clearInterval(statusInterval); clearInterval(syncInterval) }
  }, [])

  const stdioConfig = status.cliPath
    ? JSON.stringify({ mcpServers: { funkpayai: { command: 'node', args: [status.cliPath] } } }, null, 2)
    : JSON.stringify({ mcpServers: { funkpayai: { url: `http://127.0.0.1:${status.mcpPort}/api` } } }, null, 2)

  const copy = (): void => {
    navigator.clipboard.writeText(stdioConfig)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const pct = sync ? Math.round(sync.progress * 100) : 0
  const isSyncing = sync?.syncing ?? false

  return (
    <div>
      <h1 style={styles.title}>Dashboard</h1>

      <div style={styles.grid}>
        <Card title="Bitcoin Node" running={status.bitcoind && !isSyncing} label={
          !status.bitcoind ? 'Starting…'
          : isSyncing ? `Syncing ${pct}%`
          : 'Running'
        } />
        <Card title="Wallet API" running={status.mcp} label={status.mcp ? `Port ${status.mcpPort}` : 'Stopped'} />
      </div>

      {/* Sync progress */}
      {status.bitcoind && isSyncing && sync && (
        <div style={styles.syncBox}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 500 }}>
              Syncing Bitcoin blockchain…
            </span>
            <span style={{ fontSize: 13, color: '#f7931a', fontWeight: 700 }}>{pct}%</span>
          </div>
          <div style={styles.progressTrack}>
            <div style={{ ...styles.progressFill, width: `${pct}%` }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12, color: '#475569' }}>
            <span>{sync.blocks.toLocaleString()} / {sync.headers.toLocaleString()} blocks</span>
            <span>This may take several hours on first launch</span>
          </div>
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
  syncBox: { background: '#1a1d27', border: '1px solid #2d3048', borderRadius: 8, padding: 20, marginBottom: 16 },
  progressTrack: { height: 6, background: '#2d3048', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', background: '#f7931a', borderRadius: 3, transition: 'width 0.5s ease' },
  section: { background: '#1a1d27', border: '1px solid #2d3048', borderRadius: 8, padding: 20 },
  sectionTitle: { fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 },
  hint: { fontSize: 13, color: '#64748b', marginBottom: 14, lineHeight: 1.5 },
  code: { background: '#0f1117', border: '1px solid #2d3048', borderRadius: 6, padding: '14px 16px', fontSize: 12, color: '#94a3b8', overflowX: 'auto', margin: 0 },
  copyBtn: { position: 'absolute', top: 10, right: 10, padding: '5px 12px', background: '#2d3048', border: '1px solid #3d4068', borderRadius: 5, color: '#94a3b8', fontSize: 12, cursor: 'pointer' },
  warn: { marginTop: 12, fontSize: 12, color: '#eab308' }
}
