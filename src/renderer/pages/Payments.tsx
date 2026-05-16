import { useEffect, useState } from 'react'
import { RefreshCw, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react'
import type { PaymentRecord } from '../../main/payments'

function fmtAge(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const TABS = ['all', 'pending', 'detected', 'confirmed', 'expired'] as const
type Tab = typeof TABS[number]

export default function Payments(): JSX.Element {
  const [records, setRecords] = useState<PaymentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [verifying, setVerifying] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      setRecords(await window.api.payments.list())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const reverify = async (id: string): Promise<void> => {
    setVerifying(id)
    try {
      await window.api.payments.reverify(id)
      await load()
    } finally {
      setVerifying(null)
    }
  }

  const q = search.trim().toLowerCase()
  const visible = records.filter((r) => {
    if (tab !== 'all' && (r.merchant_status ?? 'unknown') !== tab) return false
    if (q) {
      return (
        r.payment_id?.toLowerCase().includes(q) ||
        r.address?.toLowerCase().includes(q) ||
        r.txid?.toLowerCase().includes(q)
      )
    }
    return true
  })

  const counts: Record<Tab, number> = {
    all: records.length,
    pending: records.filter((r) => (r.merchant_status ?? 'unknown') === 'pending').length,
    detected: records.filter((r) => (r.merchant_status ?? 'unknown') === 'detected').length,
    confirmed: records.filter((r) => (r.merchant_status ?? 'unknown') === 'confirmed').length,
    expired: records.filter((r) => (r.merchant_status ?? 'unknown') === 'expired').length,
  }

  const attention = records.filter((r) => r.needs_attention)

  return (
    <div style={{ maxWidth: 680 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h1 style={s.title}>Payments</h1>
        {attention.length > 0 && (
          <span style={s.badge}>{attention.length} need attention</span>
        )}
        <button style={s.refresh} onClick={load} title="Refresh">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Tabs + Search */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={s.tabBar}>
          {TABS.map((t) => (
            <button
              key={t}
              style={{ ...s.tab, ...(tab === t ? s.tabActive : {}) }}
              onClick={() => setTab(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
              {counts[t] > 0 && <span style={{ ...s.tabCount, ...(tab === t ? s.tabCountActive : {}) }}>{counts[t]}</span>}
            </button>
          ))}
        </div>
        <input
          style={s.search}
          placeholder="Search payment ID, address, txid…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          spellCheck={false}
        />
      </div>

      {loading && <div style={{ color: '#64748b' }}>Loading…</div>}
      {!loading && visible.length === 0 && (
        <div style={{ color: '#64748b' }}>No payments{q || tab !== 'all' ? ' matching filter' : ' yet'}.</div>
      )}

      {visible.map((r) => (
        <PaymentRow key={r.id} record={r} onReverify={reverify} verifying={verifying === r.id} />
      ))}
    </div>
  )
}

function PaymentRow({ record: r, onReverify, verifying }: {
  record: PaymentRecord
  onReverify: (id: string) => void
  verifying: boolean
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const status = r.merchant_status ?? 'unknown'
  const statusColor = status === 'confirmed' ? '#22c55e'
    : status === 'detected' ? '#f7931a'
    : status === 'expired' ? '#f87171'
    : '#64748b'

  const amountLabel = r.amount_sat > 0
    ? `${r.amount_sat.toLocaleString()} sat`
    : '—'

  return (
    <div style={{ ...s.card, borderColor: r.needs_attention ? '#f87171' : '#2d3048' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ ...s.statusDot, background: statusColor }} />
            <span style={{ fontSize: 15, fontWeight: 600, color: '#e2e8f0' }}>
              {amountLabel}
            </span>
            <span style={{ fontSize: 12, color: statusColor, fontWeight: 600 }}>
              {status.toUpperCase()}
            </span>
            {r.needs_attention && (
              <span style={s.alertBadge}><AlertTriangle size={11} style={{ verticalAlign: 'middle', marginRight: 3 }} />needs attention</span>
            )}
          </div>

          {r.merchant_url && (
            <div style={s.meta}>
              Merchant: <span style={{ color: '#94a3b8' }}>{r.merchant_url}</span>
            </div>
          )}
          <div style={s.meta}>
            {new Date(r.created_at).toLocaleString()}
            {r.on_chain_confs > 0 && ` · ${r.on_chain_confs} confs`}
            {' · checked '}{fmtAge(r.last_checked)}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginLeft: 12 }}>
          <button style={s.btnSecondary} onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button
            style={{ ...s.btnVerify, opacity: verifying ? 0.6 : 1 }}
            onClick={() => onReverify(r.id)}
            disabled={verifying}
          >
            <RefreshCw size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {verifying ? '…' : 'Verify'}
          </button>
        </div>
      </div>

      {expanded && (
        <div style={s.details}>
          <DetailRow label="Payment ID" value={r.payment_id ?? '—'} mono />
          <DetailRow label="Address" value={r.address} mono />
          <DetailRow label="TXID" value={r.txid ?? '—'} mono />
          <DetailRow label="On-chain confs" value={String(r.on_chain_confs)} />
          <DetailRow label="Merchant status" value={status} />
          <DetailRow label="Last checked" value={new Date(r.last_checked).toLocaleString()} />
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 4 }}>
      <span style={{ fontSize: 11, color: '#475569', minWidth: 110 }}>{label}</span>
      <span style={{ fontSize: 11, color: '#94a3b8', fontFamily: mono ? 'monospace' : undefined, wordBreak: 'break-all' }}>{value}</span>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  title: { fontSize: 20, fontWeight: 600, margin: 0 },
  refresh: {
    marginLeft: 'auto', background: 'none', border: '1px solid #2d3048',
    borderRadius: 6, color: '#64748b', cursor: 'pointer', padding: '6px 8px',
    display: 'flex', alignItems: 'center'
  },
  badge: { fontSize: 11, background: '#7f1d1d66', border: '1px solid #f87171', color: '#f87171', borderRadius: 4, padding: '2px 8px', fontWeight: 600 },
  alertBadge: { fontSize: 11, background: '#7f1d1d44', color: '#f87171', borderRadius: 4, padding: '1px 6px' },
  tabBar: { display: 'flex', background: '#1a1d27', border: '1px solid #2d3048', borderRadius: 7, padding: 3, gap: 2 },
  tab: {
    background: 'none', border: 'none', borderRadius: 5, color: '#64748b',
    fontSize: 12, fontWeight: 500, cursor: 'pointer', padding: '4px 10px',
    display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' as const
  },
  tabActive: { background: '#2d3048', color: '#e2e8f0' },
  tabCount: { fontSize: 10, background: '#2d304888', color: '#475569', borderRadius: 4, padding: '0 5px', fontWeight: 700 },
  tabCountActive: { background: '#3d4060', color: '#94a3b8' },
  search: {
    flex: 1, minWidth: 160, background: '#1a1d27', border: '1px solid #2d3048',
    borderRadius: 7, color: '#e2e8f0', fontSize: 12, padding: '6px 12px', outline: 'none'
  },
  card: {
    background: '#1a1d27', border: '1px solid', borderRadius: 8,
    padding: '14px 16px', marginBottom: 8
  },
  statusDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 3 },
  meta: { fontSize: 12, color: '#64748b', marginBottom: 2 },
  details: { marginTop: 12, paddingTop: 12, borderTop: '1px solid #2d3048' },
  btnSecondary: {
    padding: '6px 12px', background: 'none', border: '1px solid #2d3048',
    borderRadius: 6, color: '#94a3b8', fontSize: 14, cursor: 'pointer'
  },
  btnVerify: {
    padding: '6px 12px', background: 'none', border: '1px solid #f7931a55',
    borderRadius: 6, color: '#f7931a', fontSize: 14, cursor: 'pointer', fontWeight: 600
  }
}
