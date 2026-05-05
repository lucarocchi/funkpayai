import { useEffect, useState } from 'react'

interface Settings {
  rpcUrl: string
  rpcUser: string
  rpcPassword: string
  approvalMode: 'never' | 'threshold' | 'always'
  approvalThresholdSat: number
  mcpPort: number
  pruneGB: number
}

export default function Settings(): JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.api.settings.load().then(setSettings)
  }, [])

  const update = (patch: Partial<Settings>): void =>
    setSettings((s) => s ? { ...s, ...patch } : s)

  const save = async (): Promise<void> => {
    if (!settings) return
    await window.api.settings.save(settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!settings) return <div style={{ color: '#64748b' }}>Loading…</div>

  return (
    <div style={{ maxWidth: 520 }}>
      <h1 style={styles.title}>Settings</h1>

      <Section title="Payment Approval">
        <label style={styles.label}>Mode</label>
        <select
          style={styles.select}
          value={settings.approvalMode}
          onChange={(e) => update({ approvalMode: e.target.value as Settings['approvalMode'] })}
        >
          <option value="never">Never — full autonomy</option>
          <option value="threshold">Threshold — ask above limit</option>
          <option value="always">Always ask</option>
        </select>

        {settings.approvalMode === 'threshold' && (
          <>
            <label style={{ ...styles.label, marginTop: 12 }}>Threshold (sat)</label>
            <input
              style={styles.input}
              type="number"
              value={settings.approvalThresholdSat}
              onChange={(e) => update({ approvalThresholdSat: Number(e.target.value) })}
            />
          </>
        )}
      </Section>

      <Section title="Bitcoin Node (RPC)">
        <label style={styles.label}>RPC URL</label>
        <input style={styles.input} value={settings.rpcUrl}
          onChange={(e) => update({ rpcUrl: e.target.value })} />

        <label style={{ ...styles.label, marginTop: 12 }}>User</label>
        <input style={styles.input} value={settings.rpcUser}
          onChange={(e) => update({ rpcUser: e.target.value })} />

        <label style={{ ...styles.label, marginTop: 12 }}>Password</label>
        <input style={styles.input} type="password" value={settings.rpcPassword}
          onChange={(e) => update({ rpcPassword: e.target.value })} />
      </Section>

      <Section title="Advanced">
        <label style={styles.label}>MCP Port</label>
        <input style={styles.input} type="number" value={settings.mcpPort}
          onChange={(e) => update({ mcpPort: Number(e.target.value) })} />

        <label style={{ ...styles.label, marginTop: 12 }}>Prune size (GB)</label>
        <input style={styles.input} type="number" value={settings.pruneGB}
          onChange={(e) => update({ pruneGB: Number(e.target.value) })} />
      </Section>

      <button style={styles.btn} onClick={save}>
        {saved ? '✓ Saved' : 'Save'}
      </button>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>{title}</div>
      {children}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  title: { fontSize: 20, fontWeight: 600, marginBottom: 24 },
  section: {
    background: '#1a1d27',
    border: '1px solid #2d3048',
    borderRadius: 8,
    padding: 20,
    marginBottom: 16
  },
  sectionTitle: { fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 16 },
  label: { display: 'block', fontSize: 13, color: '#94a3b8', marginBottom: 6 },
  input: {
    display: 'block', width: '100%', padding: '8px 12px',
    background: '#0f1117', border: '1px solid #2d3048', borderRadius: 6,
    color: '#e2e8f0', fontSize: 14, outline: 'none'
  },
  select: {
    display: 'block', width: '100%', padding: '8px 12px',
    background: '#0f1117', border: '1px solid #2d3048', borderRadius: 6,
    color: '#e2e8f0', fontSize: 14, outline: 'none'
  },
  btn: {
    marginTop: 8, padding: '10px 24px',
    background: '#f7931a', border: 'none', borderRadius: 6,
    color: '#000', fontWeight: 600, fontSize: 14, cursor: 'pointer'
  }
}
