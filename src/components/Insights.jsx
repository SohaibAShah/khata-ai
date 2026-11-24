import { useState } from 'react'
import { monthlyInsights } from '../ai.js'
import { DAY, recordInference, rs, SourceBadge } from '../lib.jsx'
import { friendlyError } from './Composer.jsx'
import { AgeingChart, FlowChart } from './InsightCharts.jsx'

export default function Insights({ rows, txns, onOpen }) {
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showSent, setShowSent] = useState(false)

  const since = Date.now() - 30 * DAY
  const recent = txns.filter((t) => t.createdAt >= since)
  const credit30 = recent.filter((t) => t.type === 'credit').reduce((s, t) => s + t.amount, 0)
  const paid30 = recent.filter((t) => t.type === 'payment').reduce((s, t) => s + t.amount, 0)
  const outstanding = rows.reduce((s, r) => s + Math.max(0, r.balance), 0)

  function stats() {
    return rows.map((r) => {
      const mine = txns.filter((t) => t.customerId === r.id)
      const lastPay = mine.filter((t) => t.type === 'payment').sort((a, b) => b.createdAt - a.createdAt)[0]
      return {
        ...r,
        credit30: mine.filter((t) => t.type === 'credit' && t.createdAt >= since).reduce((s, t) => s + t.amount, 0),
        paid30: mine.filter((t) => t.type === 'payment' && t.createdAt >= since).reduce((s, t) => s + t.amount, 0),
        daysSincePay: lastPay ? Math.floor((Date.now() - lastPay.createdAt) / DAY) : null,
      }
    })
  }

  async function run() {
    setBusy(true); setError('')
    const t0 = performance.now()
    try {
      const r = await monthlyInsights(stats())
      recordInference(r.source)
      setRes({ ...r, ms: performance.now() - t0 })
    } catch (e) {
      console.error(e)
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="stats">
        <div className="stat"><span className="small muted">Outstanding</span><strong>{rs(outstanding)}</strong></div>
        <div className="stat"><span className="small muted">Given on credit (30d)</span><strong>{rs(credit30)}</strong></div>
        <div className="stat"><span className="small muted">Collected (30d)</span><strong>{rs(paid30)}</strong></div>
        <div className="stat"><span className="small muted">Recovery rate</span><strong>{credit30 ? Math.round((paid30 / credit30) * 100) : 0}%</strong></div>
      </section>

      <FlowChart txns={txns} />
      <AgeingChart rows={rows} />

      <section className="card">
        <div className="row between">
          <strong>Monthly advisor</strong>
          {res && <SourceBadge source={res.source} ms={res.ms} />}
        </div>
        <p className="small muted">
          Uses a larger cloud model for analysis. <b>Customer names are replaced with codes (C1, C2…) on this device</b> before
          anything is sent, then swapped back when the answer arrives.
        </p>
        <div className="row">
          <button className="btn primary" onClick={run} disabled={busy || !rows.length}>
            {busy ? <span className="spinner" /> : '📊'} {res ? 'Refresh' : 'Analyse my khata'}
          </button>
          <button className="btn ghost" onClick={() => setShowSent((s) => !s)}>{showSent ? 'Hide' : 'Show'} what the cloud sees</button>
        </div>
        {showSent && <pre className="sent">{res?.sentPreview || stats().map((r, i) => `C${i + 1}: owes ${r.balance}, credit30d ${r.credit30}, paid30d ${r.paid30}, daysSinceLastPayment ${r.daysSincePay ?? 'never'}, entries ${r.count}`).join('\n')}</pre>}
        {error && <p className="error">{error}</p>}
        {res && (
          <div className="insight">
            <p className="headline">{res.headline}</p>
            <ul>{res.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
            {!!res.followUp.length && (
              <>
                <strong>Call these first</strong>
                <ul className="follow">
                  {res.followUp.map((f, i) => (
                    <li key={i}><button className="link" onClick={() => onOpen(f.customer.id)} dir="auto">{f.customer.name}</button> · {rs(f.customer.balance)} · {f.reason}</li>
                  ))}
                </ul>
              </>
            )}
            {res.tip && <p className="tip">💡 {res.tip}</p>}
          </div>
        )}
      </section>
    </>
  )
}
