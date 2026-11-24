// Charts worked out on the device from the ledger itself: no AI call, nothing leaves the shop.
import { useState } from 'react'
import { DAY, rs } from '../lib.jsx'

const WEEKS = 8
const AGE_BUCKETS = [
  { key: 'fresh', label: 'Under 30 days', test: (d) => d < 30 },
  { key: 'late', label: '30–60 days', test: (d) => d >= 30 && d < 60 },
  { key: 'old', label: 'Over 60 days', test: (d) => d >= 60 },
]
const shortDate = (ts) => new Date(ts).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })

/** Credit given and money collected per week, oldest first, ending today. */
export function weeklyFlow(txns, now = Date.now()) {
  const end = new Date(now); end.setHours(23, 59, 59, 999)
  return Array.from({ length: WEEKS }, (_, i) => {
    const to = end.getTime() - (WEEKS - 1 - i) * 7 * DAY
    const from = to - 7 * DAY
    const inWeek = txns.filter((t) => t.createdAt > from && t.createdAt <= to)
    const sum = (type) => inWeek.filter((t) => t.type === type).reduce((s, t) => s + t.amount, 0)
    return { from: from + 1, credit: sum('credit'), paid: sum('payment') }
  })
}

/** Outstanding money grouped by how long the oldest unpaid entry has been waiting. */
export function ageing(rows) {
  return AGE_BUCKETS.map((b) => {
    const owing = rows.filter((r) => r.balance > 0 && b.test(r.pendingDays))
    return { ...b, amount: owing.reduce((s, r) => s + r.balance, 0), people: owing.length }
  })
}

export function AgeingChart({ rows }) {
  const data = ageing(rows)
  const max = Math.max(1, ...data.map((d) => d.amount))
  return (
    <section className="card chart">
      <strong>How long money has been waiting</strong>
      <p className="small muted">Outstanding udhaar by the age of each customer's oldest unpaid entry, with how many customers.</p>
      <ul className="age-bars">
        {data.map((d, i) => (
          <li key={d.key} title={`${d.label}: ${rs(d.amount)} from ${d.people} ${d.people === 1 ? 'customer' : 'customers'}`}>
            <span className="age-label small">{d.label}</span>
            <span className="age-track">
              <span className={`age-fill age-${i}`} style={{ width: `${d.amount ? Math.max(2, (d.amount / max) * 100) : 0}%` }} />
            </span>
            <span className="age-val small"><b>{rs(d.amount)}</b> <span className="muted">· {d.people}</span></span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function FlowChart({ txns }) {
  const weeks = weeklyFlow(txns)
  const [active, setActive] = useState(WEEKS - 1)
  const max = Math.max(1, ...weeks.flatMap((w) => [w.credit, w.paid]))
  const w = weeks[active]
  const totals = weeks.reduce((s, x) => ({ credit: s.credit + x.credit, paid: s.paid + x.paid }), { credit: 0, paid: 0 })
  return (
    <section className="card chart">
      <strong>Credit given vs collected, last {WEEKS} weeks</strong>
      <div className="legend small">
        <span><i className="key key-credit" />Given on credit {rs(totals.credit)}</span>
        <span><i className="key key-paid" />Collected {rs(totals.paid)}</span>
      </div>
      <p className="readout small" aria-live="polite">
        Week of {shortDate(w.from)}: <b>{rs(w.credit)}</b> given · <b>{rs(w.paid)}</b> collected
      </p>
      <div className="flow" role="group" aria-label="Weekly credit and collections">
        <span className="flow-max small muted">{rs(max)}</span>
        {weeks.map((x, i) => (
          <button key={x.from} className={`flow-col ${i === active ? 'on' : ''}`} onPointerEnter={() => setActive(i)} onClick={() => setActive(i)} onFocus={() => setActive(i)}
            aria-label={`Week of ${shortDate(x.from)}: ${rs(x.credit)} given on credit, ${rs(x.paid)} collected`}>
            <span className="flow-bars">
              <span className="flow-bar key-credit" style={{ height: `${(x.credit / max) * 100}%` }} />
              <span className="flow-bar key-paid" style={{ height: `${(x.paid / max) * 100}%` }} />
            </span>
            <span className="flow-x">{shortDate(x.from)}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
