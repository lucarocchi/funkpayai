import { useState, useEffect } from 'react'
import Dashboard from './pages/Dashboard'
import Settings from './pages/Settings'
import Install from './pages/Install'
import logo from './assets/logo.png'

type Page = 'dashboard' | 'settings'
type AppState = 'loading' | 'not_installed' | 'in_progress' | 'ready'

const nav: { id: Page; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'settings', label: 'Settings' }
]

export default function App(): JSX.Element {
  const [appState, setAppState] = useState<AppState>('loading')
  const [page, setPage] = useState<Page>('dashboard')

  useEffect(() => {
    window.api.install.getStatus().then((s) => {
      if (s === 'installed') setAppState('ready')
      else setAppState(s)
    })
  }, [])

  if (appState === 'loading') {
    return <div style={{ background: '#0f1117', height: '100vh' }} />
  }

  if (appState === 'not_installed' || appState === 'in_progress') {
    return (
      <Install
        initialStatus={appState}
        onDone={() => setAppState('ready')}
      />
    )
  }

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <aside style={styles.sidebar}>
        <div style={styles.logo}>
          <img src={logo} alt="FunkPay" style={{ width: '100%', height: 'auto' }} />
          <div style={styles.mcpLabel}>MCP</div>
        </div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              onClick={() => setPage(n.id)}
              style={{ ...styles.navBtn, ...(page === n.id ? styles.navBtnActive : {}) }}
            >
              {n.label}
            </button>
          ))}
        </nav>
      </aside>
      <main style={styles.main}>
        {page === 'dashboard' && <Dashboard />}
        {page === 'settings' && <Settings />}
      </main>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    width: 180,
    background: '#1a1d27',
    borderRight: '1px solid #2d3048',
    display: 'flex',
    flexDirection: 'column',
    padding: '24px 0'
  },
  logo: { padding: '0 16px 20px', textAlign: 'center' as const },
  mcpLabel: { fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', color: '#f7931a', marginTop: 4 },
  navBtn: {
    display: 'block', width: '100%', textAlign: 'left',
    padding: '10px 20px', background: 'none', border: 'none',
    color: '#94a3b8', fontSize: 14, cursor: 'pointer',
    borderLeft: '2px solid transparent'
  },
  navBtnActive: { color: '#f7931a', borderLeftColor: '#f7931a', background: '#f7931a11' },
  main: { flex: 1, padding: 32, overflowY: 'auto' }
}
