import { useState, useEffect, useRef } from 'react'
import logo from '../assets/logo.png'

interface Props {
  initialStatus: 'not_installed' | 'in_progress'
  onDone: () => void
}

export default function Install({ initialStatus, onDone }: Props): JSX.Element {
  const [phase, setPhase] = useState<'idle' | 'waiting' | 'done'>(
    initialStatus === 'in_progress' ? 'waiting' : 'idle'
  )
  const [logs, setLogs] = useState<string[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // load existing log if resuming
    if (initialStatus === 'in_progress') {
      window.api.install.getLog().then((lines) => setLogs(lines))
    }

    window.api.install.onLog((line) => {
      setLogs((prev) => [...prev, line])
    })

    window.api.install.onDone(() => {
      setLogs((prev) => [...prev, '✓ Ready — loading dashboard…'])
      setPhase('done')
      setTimeout(onDone, 1200)
    })
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const openTerminal = async (): Promise<void> => {
    const result = await window.api.install.openTerminal()
    if (result.ok) {
      setPhase('waiting')
      setLogs(['→ Terminal opened — installation in progress…', '  This window will update automatically.', ''])
    } else {
      setLogs([`✗ Error: ${result.error}`])
    }
  }

  return (
    <div style={styles.root}>
      <div style={styles.card}>
        <img src={logo} alt="FunkPay" style={styles.logo} />
        <h1 style={styles.title}>FunkPay MCP</h1>
        <p style={styles.sub}>Bitcoin wallet for AI agents</p>

        <div style={styles.desc}>
          <p>
            FunkPay MCP lets Claude Code and other AI agents pay in Bitcoin autonomously —
            without custody and without human intervention on every transaction.
          </p>
          <p style={{ marginTop: 8 }}>
            A local <strong>Bitcoin Core</strong> node is required to validate and broadcast
            transactions. Your private keys never leave this machine.
          </p>
          <p style={{ marginTop: 8, color: '#64748b', fontSize: 13 }}>
            Bitcoin Core v28.0 · ~50 MB download · pruned node (~10 GB disk)
          </p>
        </div>

        {phase === 'idle' && (
          <button style={styles.btn} onClick={openTerminal}>
            Install Bitcoin Core
          </button>
        )}

        {phase === 'waiting' && logs.length === 0 && (
          <p style={{ color: '#64748b', fontSize: 13 }}>Waiting for terminal…</p>
        )}

        {logs.length > 0 && (
          <div style={styles.console}>
            <div style={styles.consoleBar}>
              <span style={{ color: '#4ade80' }}>●</span>
              <span style={{ color: '#fbbf24' }}>●</span>
              <span style={{ color: '#f87171' }}>●</span>
              <span style={{ marginLeft: 12, color: '#475569', fontSize: 11 }}>
                {phase === 'waiting' ? 'installing…' : 'install log'}
              </span>
            </div>
            <div style={styles.consoleBody}>
              {logs.map((line, i) => (
                <div key={i} style={{
                  color: line.startsWith('✗') ? '#f87171'
                       : line.startsWith('✓') || line.includes('successfully') ? '#4ade80'
                       : line.startsWith('→') ? '#f7931a'
                       : '#94a3b8'
                }}>
                  {line || ' '}
                </div>
              ))}
              {phase === 'waiting' && <div style={{ color: '#f7931a' }}>▌</div>}
              <div ref={bottomRef} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0f1117',
    padding: 24
  },
  card: {
    width: '100%',
    maxWidth: 560,
    background: '#1a1d27',
    border: '1px solid #2d3048',
    borderRadius: 12,
    padding: 40,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center'
  },
  logo: { width: 160, height: 'auto', marginBottom: 16 },
  title: { fontSize: 22, fontWeight: 700, color: '#e2e8f0', margin: 0 },
  sub: { fontSize: 13, color: '#64748b', marginTop: 4, marginBottom: 24 },
  desc: { fontSize: 14, color: '#94a3b8', lineHeight: 1.6, textAlign: 'left', width: '100%', marginBottom: 28 },
  btn: {
    padding: '12px 32px',
    background: '#f7931a',
    border: 'none',
    borderRadius: 8,
    color: '#000',
    fontWeight: 700,
    fontSize: 15,
    cursor: 'pointer'
  },
  console: {
    width: '100%',
    background: '#0a0c12',
    border: '1px solid #2d3048',
    borderRadius: 8,
    overflow: 'hidden',
    marginTop: 16
  },
  consoleBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 12px',
    borderBottom: '1px solid #2d3048',
    background: '#12141e'
  },
  consoleBody: {
    padding: 16,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 1.7,
    maxHeight: 220,
    overflowY: 'auto',
    textAlign: 'left'
  }
}
