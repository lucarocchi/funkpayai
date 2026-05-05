import { useEffect, useState } from 'react'

interface NodeStatus {
  running: boolean
}

export default function Dashboard(): JSX.Element {
  const [nodeStatus, setNodeStatus] = useState<NodeStatus>({ running: false })

  useEffect(() => {
    const check = async (): Promise<void> => {
      const status = await window.api.bitcoind.status()
      setNodeStatus(status)
    }
    check()
    const interval = setInterval(check, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div>
      <h1 style={styles.title}>Dashboard</h1>

      <div style={styles.grid}>
        <Card title="Bitcoin Node">
          <StatusDot running={nodeStatus.running} />
          <span style={{ marginLeft: 8, color: nodeStatus.running ? '#4ade80' : '#f87171' }}>
            {nodeStatus.running ? 'Running' : 'Stopped'}
          </span>
        </Card>

        <Card title="MCP Server">
          <StatusDot running={nodeStatus.running} />
          <span style={{ marginLeft: 8, color: '#94a3b8', fontSize: 12 }}>
            http://127.0.0.1:3282/mcp
          </span>
        </Card>
      </div>

      <div style={{ marginTop: 32, color: '#64748b', fontSize: 13 }}>
        <p>Add this to your Claude Code settings to connect:</p>
        <pre style={styles.code}>{JSON.stringify(
          { mcpServers: { funkpayai: { url: 'http://127.0.0.1:3282/mcp' } } },
          null, 2
        )}</pre>
      </div>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>{title}</div>
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 8 }}>{children}</div>
    </div>
  )
}

function StatusDot({ running }: { running: boolean }): JSX.Element {
  return (
    <span style={{
      width: 8, height: 8, borderRadius: '50%',
      background: running ? '#4ade80' : '#f87171',
      display: 'inline-block'
    }} />
  )
}

const styles: Record<string, React.CSSProperties> = {
  title: { fontSize: 20, fontWeight: 600, marginBottom: 24 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 },
  card: {
    background: '#1a1d27',
    border: '1px solid #2d3048',
    borderRadius: 8,
    padding: 20
  },
  cardTitle: { fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' },
  code: {
    marginTop: 12,
    background: '#1a1d27',
    border: '1px solid #2d3048',
    borderRadius: 6,
    padding: 16,
    fontSize: 12,
    color: '#94a3b8',
    overflowX: 'auto'
  }
}
