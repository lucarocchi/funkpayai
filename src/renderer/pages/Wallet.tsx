import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'

interface Tx {
  txid: string
  category: 'send' | 'receive' | string
  amount: number
  confirmations: number
  time: number
  address?: string
}

type Tab = 'overview' | 'receive' | 'send'

export default function Wallet(): JSX.Element {
  const [tab, setTab] = useState<Tab>('overview')
  const [balanceSat, setBalanceSat] = useState<number | null>(null)
  const [txs, setTxs] = useState<Tx[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    try {
      setError(null)
      const [bal, list] = await Promise.all([
        window.api.wallet.getBalance(),
        window.api.wallet.listTransactions(20)
      ])
      setBalanceSat(bal)
      setTxs(list as Tx[])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <div style={{ maxWidth: 600 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 24 }}>
        <h1 style={s.title}>Wallet</h1>
        <button style={s.refresh} onClick={load}>↻ Refresh</button>
      </div>

      {error && <div style={s.error}>{error}</div>}

      {/* Balance */}
      <div style={s.balanceCard}>
        <div style={s.balanceLabel}>Balance</div>
        {loading ? (
          <div style={s.balanceAmt}>—</div>
        ) : (
          <>
            <div style={s.balanceAmt}>
              {balanceSat !== null ? balanceSat.toLocaleString() : '—'} <span style={s.unit}>sat</span>
            </div>
            <div style={s.balanceBtc}>
              {balanceSat !== null ? (balanceSat / 1e8).toFixed(8) : '—'} BTC
            </div>
          </>
        )}
      </div>

      {/* Tabs */}
      <div style={s.tabs}>
        {(['overview', 'receive', 'send'] as Tab[]).map((t) => (
          <button key={t} style={{ ...s.tab, ...(tab === t ? s.tabActive : {}) }} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'overview' && <TxList txs={txs} loading={loading} />}
      {tab === 'receive' && <Receive />}
      {tab === 'send' && <Send onSent={load} balanceSat={balanceSat ?? 0} />}
    </div>
  )
}

// ─── Transaction list ────────────────────────────────────────────────────────

function TxList({ txs, loading }: { txs: Tx[]; loading: boolean }): JSX.Element {
  if (loading) return <div style={{ color: '#64748b', marginTop: 16 }}>Loading transactions…</div>
  if (!txs.length) return <div style={{ color: '#64748b', marginTop: 16 }}>No transactions yet.</div>
  return (
    <div style={s.txList}>
      {txs.map((tx, i) => {
        const satAmt = Math.round(Math.abs(tx.amount) * 1e8)
        const isReceive = tx.category === 'receive'
        return (
          <div key={`${tx.txid}-${i}`} style={s.txRow}>
            <div style={{ ...s.txDir, color: isReceive ? '#22c55e' : '#f87171' }}>
              {isReceive ? '▲ Received' : '▼ Sent'}
            </div>
            <div style={s.txDetails}>
              <div style={s.txAmt}>{satAmt.toLocaleString()} sat</div>
              <div style={s.txMeta}>
                {tx.confirmations} conf · {new Date(tx.time * 1000).toLocaleDateString()}
              </div>
              <div style={s.txId}>{tx.txid.slice(0, 16)}…</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Receive ─────────────────────────────────────────────────────────────────

function Receive(): JSX.Element {
  const [address, setAddress] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const generate = async (): Promise<void> => {
    try {
      setErr(null)
      const addr = await window.api.wallet.getNewAddress()
      setAddress(addr)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => { generate() }, [])

  useEffect(() => {
    if (address && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, `bitcoin:${address}`, {
        width: 200,
        color: { dark: '#f7931a', light: '#0f1117' }
      })
    }
  }, [address])

  const copy = (): void => {
    if (!address) return
    navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={s.panel}>
      {err && <div style={s.error}>{err}</div>}
      {!address ? (
        <div style={{ color: '#64748b', marginTop: 8 }}>Generating address…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <canvas ref={canvasRef} style={{ borderRadius: 8 }} />
          <div style={s.addressBox}>{address}</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button style={s.btn} onClick={copy}>{copied ? '✓ Copied' : 'Copy address'}</button>
            <button style={s.btnSecondary} onClick={generate}>New address</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Send ─────────────────────────────────────────────────────────────────────

function Send({ onSent, balanceSat }: { onSent: () => void; balanceSat: number }): JSX.Element {
  const [address, setAddress] = useState('')
  const [amountSat, setAmountSat] = useState('')
  const [isMax, setIsMax] = useState(false)
  const [sending, setSending] = useState(false)
  const [txid, setTxid] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const setMax = (): void => {
    setAmountSat(String(balanceSat))
    setIsMax(true)
  }

  const send = async (): Promise<void> => {
    const amt = parseInt(amountSat, 10)
    if (!address.trim() || !amt || amt < 1000) {
      setErr('Enter a valid address and amount (min 1000 sat)')
      return
    }
    setSending(true)
    setErr(null)
    setTxid(null)
    try {
      const id = await window.api.wallet.send(address.trim(), amt, isMax)
      setTxid(id)
      setAddress('')
      setAmountSat('')
      setIsMax(false)
      onSent()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  const amtNum = Number(amountSat)

  return (
    <div style={s.panel}>
      {err && <div style={s.error}>{err}</div>}
      {txid && (
        <div style={s.success}>
          Sent! TXID: <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{txid}</span>
        </div>
      )}
      <label style={s.label}>Bitcoin address</label>
      <input
        style={s.input}
        placeholder="bc1q…"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 5 }}>
        <label style={{ ...s.label, margin: 0 }}>Amount (sat)</label>
        <button
          style={s.maxBtn}
          onClick={setMax}
          disabled={balanceSat === 0}
          title={`${balanceSat.toLocaleString()} sat available`}
        >
          Max · {balanceSat.toLocaleString()} sat
        </button>
      </div>
      <input
        style={s.input}
        type="number"
        placeholder="e.g. 10000"
        min={1000}
        max={balanceSat}
        value={amountSat}
        onChange={(e) => { setAmountSat(e.target.value); setIsMax(false) }}
      />
      <div style={{ marginTop: 4, fontSize: 12, color: '#475569', minHeight: 16 }}>
        {amountSat && !isNaN(amtNum) && amtNum > 0
          ? `${(amtNum / 1e8).toFixed(8)} BTC${isMax ? ' · fee deducted automatically' : ''}`
          : ''}
      </div>
      <button style={{ ...s.btn, marginTop: 20, opacity: sending ? 0.6 : 1 }} onClick={send} disabled={sending}>
        {sending ? 'Sending…' : 'Send'}
      </button>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  title: { fontSize: 20, fontWeight: 600, margin: 0 },
  refresh: { fontSize: 12, background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 0 },
  error: { background: '#7f1d1d33', border: '1px solid #f87171', borderRadius: 6, padding: '10px 14px', color: '#f87171', fontSize: 13, marginBottom: 16 },
  success: { background: '#14532d33', border: '1px solid #22c55e', borderRadius: 6, padding: '10px 14px', color: '#22c55e', fontSize: 13, marginBottom: 16 },

  balanceCard: {
    background: '#1a1d27', border: '1px solid #2d3048', borderRadius: 10,
    padding: '20px 24px', marginBottom: 20
  },
  balanceLabel: { fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 },
  balanceAmt: { fontSize: 32, fontWeight: 700, color: '#f7931a' },
  balanceBtc: { fontSize: 13, color: '#64748b', marginTop: 4 },
  unit: { fontSize: 16, fontWeight: 400, color: '#94a3b8' },

  tabs: { display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid #2d3048', paddingBottom: 0 },
  tab: {
    background: 'none', border: 'none', color: '#64748b', fontSize: 14,
    padding: '8px 16px', cursor: 'pointer', borderBottom: '2px solid transparent',
    marginBottom: -1
  },
  tabActive: { color: '#f7931a', borderBottomColor: '#f7931a' },

  panel: { paddingTop: 16 },

  txList: { display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 },
  txRow: {
    display: 'flex', gap: 12, padding: '12px 14px',
    background: '#1a1d27', border: '1px solid #2d3048', borderRadius: 8
  },
  txDir: { fontSize: 12, fontWeight: 600, minWidth: 72, paddingTop: 2 },
  txDetails: { flex: 1, minWidth: 0 },
  txAmt: { fontSize: 15, fontWeight: 600, color: '#e2e8f0' },
  txMeta: { fontSize: 12, color: '#64748b', marginTop: 2 },
  txId: { fontSize: 11, color: '#475569', marginTop: 2, fontFamily: 'monospace' },

  addressBox: {
    background: '#0f1117', border: '1px solid #2d3048', borderRadius: 6,
    padding: '10px 14px', fontSize: 12, fontFamily: 'monospace',
    color: '#e2e8f0', wordBreak: 'break-all', textAlign: 'center', maxWidth: 360
  },

  label: { display: 'block', fontSize: 12, color: '#64748b', marginBottom: 5 },
  input: {
    display: 'block', width: '100%', padding: '8px 10px',
    background: '#0f1117', border: '1px solid #2d3048', borderRadius: 6,
    color: '#e2e8f0', fontSize: 13, outline: 'none', boxSizing: 'border-box'
  },
  btn: {
    padding: '10px 24px', background: '#f7931a', border: 'none',
    borderRadius: 6, color: '#000', fontWeight: 700, fontSize: 14, cursor: 'pointer'
  },
  btnSecondary: {
    padding: '10px 24px', background: 'none', border: '1px solid #2d3048',
    borderRadius: 6, color: '#94a3b8', fontSize: 14, cursor: 'pointer'
  },
  maxBtn: {
    background: 'none', border: '1px solid #f7931a33', borderRadius: 4,
    color: '#f7931a', fontSize: 11, fontWeight: 600, padding: '2px 8px',
    cursor: 'pointer', letterSpacing: '0.02em'
  }
}
