import { useEffect, useState } from 'react'

interface Status {
  bitcoind: boolean
  mcp: boolean
  mcpPort: number
}

export default function Dashboard(): JSX.Element {
  const [status, setStatus] = useState<Status>({ bitcoind: false, mcp: false, mcpPort: 3282 })

  useEffect(() => {
    const check = async (): Promise<void> => setStatus(await window.api.status())
    check()
    const interval = setInterval(check, 5000)
    return () => clearInterval(interval)
  }, [])

  const mcpConfig = JSON.stringify(
    { mcpServers: { funkpayai: { url: `http://127.0.0.1:${status.mcpPort}/mcp` } } },
    null, 2
  )

  return (
    <div>
      <h1 style={styles.title}>Dashboard</h1>

      <div style={styles.grid}>
        <Card title="Bitcoin Node" running={status.bitcoind} label={status.bitcoind ? 'Running' : 'Starting…'} />
        <Card title="MCP Server" running={status.mcp} label={status.mcp ? `Port ${status.mcpPort}` : 'Stopped'} />
      </div>

      <div style={styles.hint}>
        <p style={{ marginBottom: 8, color: '#64748b', fontSize: 13 }}>
          Add to Claude Code settings to connect:
        </p>
        <pre style={styles.code}>{mcpConfig}</pre>
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
  grid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 32 },
  card: {
    background: '#1a1d27',
    border: '1px solid #2d3048',
    borderRadius: 8,
    padding: 20
  },
  cardTitle: { fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' },
  hint: { marginTop: 8 },
  code: {
    background: '#1a1d27',
    border: '1px solid #2d3048',
    borderRadius: 6,
    padding: 16,
    fontSize: 12,
    color: '#94a3b8',
    overflowX: 'auto'
  }
}
