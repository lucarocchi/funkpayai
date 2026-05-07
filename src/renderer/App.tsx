import { useState, useEffect } from 'react'
import Dashboard, { Status, SyncInfo } from './pages/Dashboard'
import Settings from './pages/Settings'
import Wallet from './pages/Wallet'
import Payments from './pages/Payments'
import Install from './pages/Install'
import logo from './assets/logo.png'

type Page = 'dashboard' | 'wallet' | 'payments' | 'settings'
type AppState = 'loading' | 'not_installed' | 'in_progress' | 'ready'

const nav: { id: Page; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'wallet', label: 'Wallet' },
  { id: 'payments', label: 'Payments' },
  { id: 'settings', label: 'Settings' }
]

export default function App(): JSX.Element {
  const [appState, setAppState] = useState<AppState>('loading')
  const [page, setPage] = useState<Page>('dashboard')
  const [network, setNetwork] = useState<'mainnet' | 'testnet'>('mainnet')
  const [status, setStatus] = useState<Status>({ bitcoind: false, bitcoindStarted: false, mcp: false, mcpPort: 3282, cliPath: null })
  const [sync, setSync] = useState<SyncInfo | null>(null)

  useEffect(() => {
    window.api.install.getStatus().then((s) => {
      document.getElementById('splash')?.remove()
      if (s === 'installed') setAppState('ready')
      else setAppState(s)
    })
    window.api.settings.load().then((s) => setNetwork(s.network ?? 'mainnet'))
    const onSave = (e: Event): void => setNetwork((e as CustomEvent).detail?.network ?? 'mainnet')
    window.addEventListener('settings-saved', onSave)
    return () => window.removeEventListener('settings-saved', onSave)
  }, [])

  useEffect(() => {
    if (appState !== 'ready') return
    const checkStatus = async (): Promise<void> => setStatus(await window.api.status())
    const checkSync = async (): Promise<void> => setSync(await window.api.node.syncInfo())
    checkStatus(); checkSync()
    const si = setInterval(checkStatus, 5000)
    const sy = setInterval(checkSync, 3000)
    return () => { clearInterval(si); clearInterval(sy) }
  }, [appState])

  if (appState === 'loading') {
    return null
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
          <div style={network === 'testnet' ? styles.testnetBadge : styles.mainnetBadge}>
            {network === 'testnet' ? 'TESTNET' : 'MAINNET'}
          </div>
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
        {page === 'dashboard' && <Dashboard status={status} sync={sync} />}
        {page === 'wallet' && <Wallet />}
        {page === 'payments' && <Payments />}
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
  mainnetBadge: { marginTop: 8, display: 'inline-block', fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', color: '#f7931a', background: '#f7931a18', border: '1px solid #f7931a44', borderRadius: 4, padding: '2px 8px' },
  testnetBadge: { marginTop: 8, display: 'inline-block', fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', color: '#eab308', background: '#eab30818', border: '1px solid #eab30844', borderRadius: 4, padding: '2px 8px' },
  navBtn: {
    display: 'block', width: '100%', textAlign: 'left',
    padding: '10px 20px', background: 'none', border: 'none',
    color: '#94a3b8', fontSize: 14, cursor: 'pointer',
    borderLeft: '2px solid transparent'
  },
  navBtnActive: { color: '#f7931a', borderLeftColor: '#f7931a', background: '#f7931a11' },
  main: { flex: 1, padding: 32, overflowY: 'auto' }
}
