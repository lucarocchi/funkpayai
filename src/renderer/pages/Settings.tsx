import { useEffect, useState } from 'react'
import { X, Check } from 'lucide-react'

type ApprovalMode = 'never' | 'threshold' | 'always'

interface Merchant { name: string; url: string }

interface ShippingInfo {
  firstName: string; lastName: string; email: string; phone: string
  address1: string; address2: string; city: string; state: string
  zip: string; country: string
}

interface BillingInfo {
  sameAsShipping: boolean; company: string; vatId: string
  firstName: string; lastName: string; email: string
  address1: string; city: string; zip: string; country: string
}

interface Settings {
  rpcUrl: string; rpcUser: string; rpcPassword: string
  mcpPort: number; pruneGB: number
  approvalMode: ApprovalMode; approvalThresholdSat: number
  confirmationsRequired: number
  merchants: Merchant[]
  shipping: ShippingInfo; billing: BillingInfo
}

export default function Settings(): JSX.Element {
  const [s, setS] = useState<Settings | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => { window.api.settings.load().then(setS) }, [])

  const set = (patch: Partial<Settings>): void =>
    setS((prev) => prev ? { ...prev, ...patch } : prev)

  const setShipping = (patch: Partial<ShippingInfo>): void =>
    setS((prev) => prev ? { ...prev, shipping: { ...prev.shipping, ...patch } } : prev)

  const setBilling = (patch: Partial<BillingInfo>): void =>
    setS((prev) => prev ? { ...prev, billing: { ...prev.billing, ...patch } } : prev)

  const save = async (): Promise<void> => {
    if (!s) return
    await window.api.settings.save(s)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!s) return <div style={{ color: '#64748b' }}>Loading…</div>

  return (
    <div style={{ maxWidth: 560 }}>
      <h1 style={styles.title}>Settings</h1>

      {/* PAYMENT APPROVAL */}
      <Section title="Payment Approval">
        <label style={styles.label}>Approval mode</label>
        <select style={styles.select} value={s.approvalMode}
          onChange={(e) => set({ approvalMode: e.target.value as ApprovalMode })}>
          <option value="never">Never — full autonomy</option>
          <option value="threshold">Threshold — ask above limit</option>
          <option value="always">Always ask</option>
        </select>
        {s.approvalMode === 'threshold' && (
          <Field label="Threshold (sat)" style={{ marginTop: 12 }}>
            <input style={styles.input} type="number" value={s.approvalThresholdSat}
              onChange={(e) => set({ approvalThresholdSat: Number(e.target.value) })} />
          </Field>
        )}

        <div style={{ marginTop: 20, borderTop: '1px solid #2d3048', paddingTop: 16 }}>
          <label style={styles.label}>Release agent after payment</label>
          <select style={styles.select} value={s.confirmationsRequired === 0 ? 'detected' : 'confirmed'}
            onChange={(e) => set({ confirmationsRequired: e.target.value === 'detected' ? 0 : (s.confirmationsRequired || 1) })}>
            <option value="detected">Detected — tx seen in mempool (fast, unconfirmed)</option>
            <option value="confirmed">Confirmed — wait N confirmations (safer)</option>
          </select>
          {s.confirmationsRequired > 0 && (
            <Field label="Confirmations required" style={{ marginTop: 12 }}>
              <input style={styles.input} type="number" min={1} max={6} value={s.confirmationsRequired}
                onChange={(e) => set({ confirmationsRequired: Math.max(1, Number(e.target.value)) })} />
              <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
                {s.confirmationsRequired === 1 ? '~10 min' :
                 s.confirmationsRequired <= 3 ? `~${s.confirmationsRequired * 10} min` :
                 `~${s.confirmationsRequired * 10} min · recommended for large amounts`}
              </div>
            </Field>
          )}
        </div>
      </Section>

      {/* SHIPPING */}
      <Section title="Shipping Address">
        <p style={styles.hint}>Used by the AI agent when purchasing physical goods.</p>
        <Row>
          <Field label="First name">
            <input style={styles.input} value={s.shipping.firstName}
              onChange={(e) => setShipping({ firstName: e.target.value })} />
          </Field>
          <Field label="Last name">
            <input style={styles.input} value={s.shipping.lastName}
              onChange={(e) => setShipping({ lastName: e.target.value })} />
          </Field>
        </Row>
        <Row>
          <Field label="Email">
            <input style={styles.input} type="email" value={s.shipping.email}
              onChange={(e) => setShipping({ email: e.target.value })} />
          </Field>
          <Field label="Phone">
            <input style={styles.input} value={s.shipping.phone}
              onChange={(e) => setShipping({ phone: e.target.value })} />
          </Field>
        </Row>
        <Field label="Address" style={{ marginTop: 12 }}>
          <input style={styles.input} placeholder="Street and number"
            value={s.shipping.address1}
            onChange={(e) => setShipping({ address1: e.target.value })} />
          <input style={{ ...styles.input, marginTop: 6 }} placeholder="Apartment, suite… (optional)"
            value={s.shipping.address2}
            onChange={(e) => setShipping({ address2: e.target.value })} />
        </Field>
        <Row style={{ marginTop: 12 }}>
          <Field label="City">
            <input style={styles.input} value={s.shipping.city}
              onChange={(e) => setShipping({ city: e.target.value })} />
          </Field>
          <Field label="State / Province">
            <input style={styles.input} value={s.shipping.state}
              onChange={(e) => setShipping({ state: e.target.value })} />
          </Field>
        </Row>
        <Row>
          <Field label="ZIP / Postal code">
            <input style={styles.input} value={s.shipping.zip}
              onChange={(e) => setShipping({ zip: e.target.value })} />
          </Field>
          <Field label="Country">
            <input style={styles.input} value={s.shipping.country}
              onChange={(e) => setShipping({ country: e.target.value })} />
          </Field>
        </Row>
      </Section>

      {/* BILLING */}
      <Section title="Billing">
        <label style={styles.checkRow}>
          <input type="checkbox" checked={s.billing.sameAsShipping}
            onChange={(e) => setBilling({ sameAsShipping: e.target.checked })} />
          <span style={{ marginLeft: 8, color: '#94a3b8', fontSize: 14 }}>Same as shipping address</span>
        </label>

        <Row style={{ marginTop: 16 }}>
          <Field label="Company (optional)">
            <input style={styles.input} value={s.billing.company}
              onChange={(e) => setBilling({ company: e.target.value })} />
          </Field>
          <Field label="VAT / Tax ID (optional)">
            <input style={styles.input} value={s.billing.vatId}
              onChange={(e) => setBilling({ vatId: e.target.value })} />
          </Field>
        </Row>

        {!s.billing.sameAsShipping && (
          <>
            <Row>
              <Field label="First name">
                <input style={styles.input} value={s.billing.firstName}
                  onChange={(e) => setBilling({ firstName: e.target.value })} />
              </Field>
              <Field label="Last name">
                <input style={styles.input} value={s.billing.lastName}
                  onChange={(e) => setBilling({ lastName: e.target.value })} />
              </Field>
            </Row>
            <Field label="Email">
              <input style={styles.input} type="email" value={s.billing.email}
                onChange={(e) => setBilling({ email: e.target.value })} />
            </Field>
            <Field label="Address" style={{ marginTop: 12 }}>
              <input style={styles.input} value={s.billing.address1}
                onChange={(e) => setBilling({ address1: e.target.value })} />
            </Field>
            <Row>
              <Field label="City">
                <input style={styles.input} value={s.billing.city}
                  onChange={(e) => setBilling({ city: e.target.value })} />
              </Field>
              <Field label="ZIP">
                <input style={styles.input} value={s.billing.zip}
                  onChange={(e) => setBilling({ zip: e.target.value })} />
              </Field>
              <Field label="Country">
                <input style={styles.input} value={s.billing.country}
                  onChange={(e) => setBilling({ country: e.target.value })} />
              </Field>
            </Row>
          </>
        )}
      </Section>

      {/* MERCHANTS */}
      <Section title="Trusted Merchants">
        <p style={styles.hint}>FunkPay merchant servers the agent can use. Name is used by the agent to identify them.</p>
        {(s.merchants ?? []).map((m, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'flex-end' }}>
            <Field label={i === 0 ? 'Name' : ''} style={{ flex: '0 0 140px' }}>
              <input style={styles.input} value={m.name} placeholder="btcfunk.com"
                onChange={(e) => {
                  const merchants = [...s.merchants]
                  merchants[i] = { ...merchants[i], name: e.target.value }
                  set({ merchants })
                }} />
            </Field>
            <Field label={i === 0 ? 'Server URL' : ''} style={{ flex: 1 }}>
              <input style={styles.input} value={m.url} placeholder="https://btcfunk.com/pay"
                onChange={(e) => {
                  const merchants = [...s.merchants]
                  merchants[i] = { ...merchants[i], url: e.target.value }
                  set({ merchants })
                }} />
            </Field>
            <button style={styles.removeBtn} onClick={() => set({ merchants: s.merchants.filter((_, j) => j !== i) })}><X size={14} /></button>
          </div>
        ))}
        <button style={styles.addBtn} onClick={() => set({ merchants: [...(s.merchants ?? []), { name: '', url: '' }] })}>
          + Add merchant
        </button>
      </Section>

      {/* NODE & MCP */}
      <Section title="Bitcoin Node (RPC)">
        <Field label="RPC URL">
          <input style={styles.input} value={s.rpcUrl}
            onChange={(e) => set({ rpcUrl: e.target.value })} />
        </Field>
        <Row style={{ marginTop: 12 }}>
          <Field label="User">
            <input style={styles.input} value={s.rpcUser}
              onChange={(e) => set({ rpcUser: e.target.value })} />
          </Field>
          <Field label="Password">
            <input style={styles.input} type="password" value={s.rpcPassword}
              onChange={(e) => set({ rpcPassword: e.target.value })} />
          </Field>
        </Row>
      </Section>

      <Section title="Advanced">
        <Row>
          <Field label="MCP Port">
            <input style={styles.input} type="number" value={s.mcpPort}
              onChange={(e) => set({ mcpPort: Number(e.target.value) })} />
          </Field>
          <Field label="Prune size (GB)">
            <input style={styles.input} type="number" value={s.pruneGB}
              onChange={(e) => set({ pruneGB: Number(e.target.value) })} />
          </Field>
        </Row>
      </Section>

      <button style={styles.btn} onClick={save}>
        {saved ? <><Check size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />Saved</> : 'Save'}
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

function Row({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }): JSX.Element {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Array.isArray(children) ? children.filter(Boolean).length : 1}, 1fr)`, gap: 12, ...style }}>{children}</div>
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }): JSX.Element {
  return (
    <div style={style}>
      <label style={styles.label}>{label}</label>
      {children}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  title: { fontSize: 20, fontWeight: 600, marginBottom: 24 },
  section: { background: '#1a1d27', border: '1px solid #2d3048', borderRadius: 8, padding: 20, marginBottom: 16 },
  sectionTitle: { fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 },
  label: { display: 'block', fontSize: 12, color: '#64748b', marginBottom: 5 },
  hint: { fontSize: 12, color: '#475569', marginBottom: 14, marginTop: -4 },
  input: {
    display: 'block', width: '100%', padding: '7px 10px',
    background: '#0f1117', border: '1px solid #2d3048', borderRadius: 6,
    color: '#e2e8f0', fontSize: 13, outline: 'none'
  },
  select: {
    display: 'block', width: '100%', padding: '7px 10px',
    background: '#0f1117', border: '1px solid #2d3048', borderRadius: 6,
    color: '#e2e8f0', fontSize: 13, outline: 'none'
  },
  checkRow: { display: 'flex', alignItems: 'center', cursor: 'pointer' },
  btn: { marginTop: 8, padding: '10px 24px', background: '#f7931a', border: 'none', borderRadius: 6, color: '#000', fontWeight: 700, fontSize: 14, cursor: 'pointer' },
  addBtn: { marginTop: 4, padding: '6px 14px', background: 'none', border: '1px dashed #2d3048', borderRadius: 6, color: '#64748b', fontSize: 13, cursor: 'pointer' },
  removeBtn: { padding: '7px 10px', background: 'none', border: '1px solid #2d3048', borderRadius: 6, color: '#64748b', fontSize: 12, cursor: 'pointer', marginBottom: 0, flexShrink: 0 }
}
