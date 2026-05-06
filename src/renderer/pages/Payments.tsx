import { useEffect, useState } from 'react'
import type { PaymentRecord } from '../../main/payments'

export default function Payments(): JSX.Element {
  const [records, setRecords] = useState<PaymentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [verifying, setVerifying] = useState<string | null>(null)

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

  const attention = records.filter((r) => r.needs_attention)

  return (
    <div style={{ maxWidth: 680 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 24 }}>
        <h1 style={s.title}>Payments</h1>
        {attention.length > 0 && (
          <span style={s.badge}>{attention.length} need attention</span>
        )}
        <button style={s.refresh} onClick={load}>↻ Refresh</button>
      </div>

      {loading && <div style={{ color: '#64748b' }}>Loading…</div>}
      {!loading && records.length === 0 && (
        <div style={{ color: '#64748b' }}>No payments yet.</div>
      )}

      {records.map((r) => (
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

  return (
    <div style={{ ...s.card, borderColor: r.needs_attention ? '#f87171' : '#2d3048' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ ...s.statusDot, background: statusColor }} />
            <span style={{ fontSize: 15, fontWeight: 600, color: '#e2e8f0' }}>
              {r.amount_sat.toLocaleString()} sat
            </span>
            <span style={{ fontSize: 12, color: statusColor, fontWeight: 600 }}>
              {status.toUpperCase()}
            </span>
            {r.needs_attention && (
              <span style={s.alertBadge}>⚠ needs attention</span>
            )}
          </div>

          {r.merchant_url && (
            <div style={s.meta}>
              Merchant: <span style={{ color: '#94a3b8' }}>{r.merchant_url}</span>
            </div>
          )}
          <div style={s.meta}>
            {new Date(r.created_at).toLocaleString()} · {r.on_chain_confs} confs on-chain
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginLeft: 12 }}>
          <button style={s.btnSecondary} onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Less' : 'Details'}
          </button>
          <button
            style={{ ...s.btnVerify, opacity: verifying ? 0.6 : 1 }}
            onClick={() => onReverify(r.id)}
            disabled={verifying}
          >
            {verifying ? '…' : '↻ Verify'}
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
  refresh: { fontSize: 12, background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 0 },
  badge: { fontSize: 11, background: '#7f1d1d66', border: '1px solid #f87171', color: '#f87171', borderRadius: 4, padding: '2px 8px', fontWeight: 600 },
  alertBadge: { fontSize: 11, background: '#7f1d1d44', color: '#f87171', borderRadius: 4, padding: '1px 6px' },
  card: {
    background: '#1a1d27', border: '1px solid', borderRadius: 8,
    padding: '14px 16px', marginBottom: 8
  },
  statusDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 3 },
  meta: { fontSize: 12, color: '#64748b', marginBottom: 2 },
  details: { marginTop: 12, paddingTop: 12, borderTop: '1px solid #2d3048' },
  btnSecondary: {
    padding: '5px 12px', background: 'none', border: '1px solid #2d3048',
    borderRadius: 5, color: '#64748b', fontSize: 12, cursor: 'pointer'
  },
  btnVerify: {
    padding: '5px 12px', background: 'none', border: '1px solid #f7931a55',
    borderRadius: 5, color: '#f7931a', fontSize: 12, cursor: 'pointer', fontWeight: 600
  }
}
