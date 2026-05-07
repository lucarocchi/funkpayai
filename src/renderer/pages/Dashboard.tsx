import { useEffect, useState } from 'react'
import { Copy, Check } from 'lucide-react'

interface Status {
  nodeConnected: boolean
  mcp: boolean
  mcpPort: number
}

interface SyncInfo {
  blocks: number
  headers: number
  progress: number
  syncing: boolean
}

export default function Dashboard(): JSX.Element {
  const [status, setStatus] = useState<Status>({ nodeConnected: false, mcp: false, mcpPort: 3282 })
  const [sync, setSync] = useState<SyncInfo | null>(null)
  const [copied, setCopied] = useState(false)
  const [network, setNetwork] = useState<'mainnet' | 'testnet'>('mainnet')

  useEffect(() => {
    window.api.settings.load().then((s) => setNetwork(s.network ?? 'mainnet'))
  }, [])

  useEffect(() => {
    const checkStatus = async (): Promise<void> => setStatus(await window.api.status())
    const checkSync = async (): Promise<void> => {
      const s = await window.api.node.syncInfo()
      if (s !== null) setSync(s)
    }
    checkStatus(); checkSync()
    const si = setInterval(checkStatus, 5000)
    const sy = setInterval(checkSync, 3000)
    return () => { clearInterval(si); clearInterval(sy) }
  }, [])

  const mcpConfig = JSON.stringify(
    { mcpServers: { funkpayai: { url: `http://127.0.0.1:${status.mcpPort}/mcp` } } },
    null, 2
  )

  const copy = (): void => {
    navigator.clipboard.writeText(mcpConfig)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const pct = sync ? Math.round(sync.progress * 1000) / 10 : 0
  const isSyncing = status.nodeConnected && (sync ? sync.syncing : true)

  let nodeLabel = 'Not connected'
  let nodeRunning = false
  if (isSyncing) { nodeLabel = sync ? `Syncing — ${pct.toFixed(1)}%` : 'Syncing…'; nodeRunning = false }
  else if (status.nodeConnected) { nodeLabel = 'Running'; nodeRunning = true }

  const rpcPort = network === 'testnet' ? 18332 : 8332

  return (
    <div>
      <h1 style={styles.title}>Dashboard</h1>

      <div style={styles.grid}>
        <Card title="Bitcoin Node" running={nodeRunning} label={nodeLabel} />
        <Card title="Wallet API" running={status.mcp} label={status.mcp ? `Port ${status.mcpPort}` : 'Stopped'} />
      </div>

      {/* Node not connected — show setup instructions */}
      {!status.nodeConnected && (
        <div style={{ ...styles.infoBox, borderColor: '#3d4068', marginBottom: 16 }}>
          <div style={styles.infoTitle}>Bitcoin node not connected</div>
          <p style={styles.infoText}>
            FunkPay needs a running Bitcoin Core node with wallet support. Start one with:
          </p>
          <pre style={styles.cmdBlock}>
            {`bitcoind -server -rpcuser=funkpay -rpcpassword=funkpay -rpcport=${rpcPort}${network === 'testnet' ? ' -testnet' : ''} -daemon`}
          </pre>
          <p style={{ ...styles.infoText, marginTop: 10 }}>
            Then set the RPC credentials in <strong style={{ color: '#e2e8f0' }}>Settings</strong> to match.
            The wallet will connect automatically once the node responds.
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
          </p>
        </div>
      )}

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Connect your AI agent</div>
        <p style={styles.hint}>
          Paste this config into your MCP client (Claude Code, Cursor, etc.) once.
        </p>
        <div style={{ position: 'relative' }}>
          <pre style={styles.code}>{mcpConfig}</pre>
          <button style={styles.copyBtn} onClick={copy}>
            {copied
              ? <><Check size={13} style={{ marginRight: 5, verticalAlign: 'middle' }} />Copied</>
              : <><Copy size={13} style={{ marginRight: 5, verticalAlign: 'middle' }} />Copy config</>
            }
          </button>
        </div>
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
  cmdBlock: { background: '#0f1117', border: '1px solid #2d3048', borderRadius: 6, padding: '10px 14px', fontSize: 12, color: '#94a3b8', overflowX: 'auto', margin: '10px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
  progressTrack: { height: 8, background: '#2d3048', borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', background: 'linear-gradient(90deg, #f7931a, #fbbf24)', borderRadius: 4, transition: 'width 0.8s ease' },
  section: { background: '#1a1d27', border: '1px solid #2d3048', borderRadius: 8, padding: 20 },
  sectionTitle: { fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 },
  hint: { fontSize: 13, color: '#64748b', marginBottom: 14, lineHeight: 1.5 },
  code: { background: '#0f1117', border: '1px solid #2d3048', borderRadius: 6, padding: '14px 16px', fontSize: 12, color: '#94a3b8', overflowX: 'auto', margin: 0 },
  copyBtn: { position: 'absolute', top: 10, right: 10, padding: '5px 12px', background: '#2d3048', border: '1px solid #3d4068', borderRadius: 5, color: '#94a3b8', fontSize: 12, cursor: 'pointer' }
}
