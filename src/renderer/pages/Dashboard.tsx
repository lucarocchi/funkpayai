import { useEffect, useState } from 'react'
import { Copy, Check } from 'lucide-react'

interface Status {
  bitcoind: boolean
  mcp: boolean
  mcpPort: number
  cliPath: string | null
}

export default function Dashboard(): JSX.Element {
  const [status, setStatus] = useState<Status>({ bitcoind: false, mcp: false, mcpPort: 3282, cliPath: null })
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const check = async (): Promise<void> => setStatus(await window.api.status())
    check()
    const interval = setInterval(check, 5000)
    return () => clearInterval(interval)
  }, [])

  const stdioConfig = status.cliPath
    ? JSON.stringify({ mcpServers: { funkpayai: { command: 'node', args: [status.cliPath] } } }, null, 2)
    : JSON.stringify({ mcpServers: { funkpayai: { url: `http://127.0.0.1:${status.mcpPort}/api` } } }, null, 2)

  const copy = (): void => {
    navigator.clipboard.writeText(stdioConfig)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      <h1 style={styles.title}>Dashboard</h1>

      <div style={styles.grid}>
        <Card title="Bitcoin Node" running={status.bitcoind} label={status.bitcoind ? 'Running' : 'Starting…'} />
        <Card title="Wallet API" running={status.mcp} label={status.mcp ? `Port ${status.mcpPort}` : 'Stopped'} />
      </div>

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
          <p style={styles.warn}>
            ⚠ Proxy not installed yet — restart the app to complete setup.
          </p>
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
          display: 'inline-block',
          flexShrink: 0
        }} />
        <span style={{ fontSize: 14, color: running ? '#e2e8f0' : '#94a3b8' }}>{label}</span>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  title: { fontSize: 20, fontWeight: 600, marginBottom: 24 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 24 },
  card: { background: '#1a1d27', border: '1px solid #2d3048', borderRadius: 8, padding: 20 },
  cardTitle: { fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' },
  section: { background: '#1a1d27', border: '1px solid #2d3048', borderRadius: 8, padding: 20 },
  sectionTitle: { fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 },
  hint: { fontSize: 13, color: '#64748b', marginBottom: 14, lineHeight: 1.5 },
  code: {
    background: '#0f1117', border: '1px solid #2d3048', borderRadius: 6,
    padding: '14px 16px', fontSize: 12, color: '#94a3b8',
    overflowX: 'auto', margin: 0
  },
  copyBtn: {
    position: 'absolute', top: 10, right: 10,
    padding: '5px 12px', background: '#2d3048', border: '1px solid #3d4068',
    borderRadius: 5, color: '#94a3b8', fontSize: 12, cursor: 'pointer'
  },
  warn: { marginTop: 12, fontSize: 12, color: '#eab308' }
}
