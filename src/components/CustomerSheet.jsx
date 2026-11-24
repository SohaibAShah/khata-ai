import { useEffect, useState } from 'react'
import { draftReminder } from '../ai.js'
import { unpaidCredits } from '../store.js'
import { ago, Avatar, recordInference, rs, SourceBadge } from '../lib.jsx'
import { friendlyError } from './Composer.jsx'

export default function CustomerSheet({ customer, txns, store, shopName, onClose, notify }) {
  const [phone, setPhone] = useState(customer.phone || '')
  const [manual, setManual] = useState({ type: 'credit', amount: '', items: '' })
  const [lang, setLang] = useState('roman')
  const [tone, setTone] = useState('warm')
  const [reminder, setReminder] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  const history = txns.filter((t) => t.customerId === customer.id).sort((a, b) => b.createdAt - a.createdAt)
  const pending = unpaidCredits(history)
  const days = customer.pendingDays

  async function generate() {
    setBusy(true); setError('')
    const t0 = performance.now()
    try {
      const items = pending.map((t) => t.items).filter(Boolean).slice(0, 3).join(', ')
      const r = await draftReminder({ shopName, name: customer.name, balance: customer.balance, days, items, lang, tone })
      recordInference(r.source)
      setReminder({ ...r, ms: performance.now() - t0 })
    } catch (e) {
      console.error(e)
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  function addManual(e) {
    e.preventDefault()
    const amount = Math.abs(Number(manual.amount))
    if (!amount) return
    store.addTxns([{ customerId: customer.id, type: manual.type, amount, items: manual.items.trim(), source: 'manual', via: 'manual' }])
    notify(`${manual.type === 'payment' ? 'Jama' : 'Udhaar'} ${rs(amount)} added for ${customer.name}`)
    setManual({ type: manual.type, amount: '', items: '' })
  }

  function remove(t) {
    if (!confirm(`Delete ${rs(t.amount)} ${t.type === 'payment' ? 'payment' : 'credit'}?`)) return
    store.deleteTxn(t.id)
    notify('Entry deleted')
  }

  const waNumber = phone.replace(/\D/g, '').replace(/^0/, '92')
  const waLink = reminder && waNumber ? `https://wa.me/${waNumber}?text=${encodeURIComponent(reminder.text)}` : null

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={customer.name} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden />
        <header className="sheet-head">
          <Avatar name={customer.name} size={48} />
          <div className="grow">
            <h2 dir="auto">{customer.name}</h2>
            <span className="small muted">{customer.count} entries · last {ago(customer.lastAt)}</span>
          </div>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className={`balance-panel ${customer.balance > 0 ? 'owes' : 'clear'}`}>
          <span className="small">{customer.balance > 0 ? 'Owes you' : customer.balance < 0 ? 'Paid in advance' : 'Balance'}</span>
          <strong>{customer.balance === 0 ? 'All clear ✓' : rs(Math.abs(customer.balance))}</strong>
          {customer.balance > 0 && (
            <span className={`tag ${customer.overdue ? 'tag-overdue' : ''}`}>
              {customer.overdue ? `Overdue · ${days} days` : `Pending ${days} ${days === 1 ? 'day' : 'days'}`}
            </span>
          )}
        </div>

        {customer.balance > 0 && (
          <section className="panel">
            <div className="row between">
              <strong>💬 Payment reminder</strong>
              {reminder && <SourceBadge source={reminder.source} ms={reminder.ms} />}
            </div>
            <p className="small muted">Drafted privately on this device when Gemini Nano is available. You review it and send it yourself.</p>
            <div className="row">
              <div className="seg">
                {[['roman', 'Roman Urdu'], ['urdu', 'اردو'], ['english', 'English']].map(([k, l]) => (
                  <button key={k} className={lang === k ? 'on' : ''} onClick={() => setLang(k)}>{l}</button>
                ))}
              </div>
              <div className="seg">
                {[['warm', 'Warm'], ['firm', 'Firm']].map(([k, l]) => (
                  <button key={k} className={tone === k ? 'on' : ''} onClick={() => setTone(k)}>{l}</button>
                ))}
              </div>
            </div>
            {reminder && (
              <textarea dir="auto" rows={4} value={reminder.text} onChange={(e) => setReminder({ ...reminder, text: e.target.value })} aria-label="Reminder text" />
            )}
            {error && <p className="error">{error}</p>}
            <div className="row">
              <button className={`btn ${reminder ? '' : 'primary'}`} onClick={generate} disabled={busy}>
                {busy ? <span className="spinner" /> : '✍️'} {busy ? 'Writing…' : reminder ? 'Rewrite' : 'Draft reminder'}
              </button>
              {reminder && (waLink
                ? <a className="btn whatsapp" href={waLink} target="_blank" rel="noreferrer">Send on WhatsApp</a>
                : <span className="small muted">Add a WhatsApp number below to send.</span>)}
              {reminder && <button className="btn ghost" onClick={() => { navigator.clipboard?.writeText(reminder.text); notify('Copied') }}>Copy</button>}
            </div>
          </section>
        )}

        <section className="panel">
          <strong>Add manually</strong>
          <form className="manual" onSubmit={addManual}>
            <div className="seg">
              <button type="button" className={manual.type === 'credit' ? 'on credit' : ''} onClick={() => setManual({ ...manual, type: 'credit' })}>Udhaar</button>
              <button type="button" className={manual.type === 'payment' ? 'on payment' : ''} onClick={() => setManual({ ...manual, type: 'payment' })}>Jama</button>
            </div>
            <input className="amt" type="number" min="1" inputMode="numeric" placeholder="Rs" value={manual.amount} onChange={(e) => setManual({ ...manual, amount: e.target.value })} aria-label="Amount" />
            <input dir="auto" className="items" placeholder="items (optional)" value={manual.items} onChange={(e) => setManual({ ...manual, items: e.target.value })} aria-label="Items" />
            <button className="btn" type="submit" disabled={!Number(manual.amount)}>Add</button>
          </form>
        </section>

        <label className="label" htmlFor="phone">WhatsApp number</label>
        <input id="phone" inputMode="tel" value={phone} placeholder="03xx xxxxxxx"
          onChange={(e) => setPhone(e.target.value)}
          onBlur={() => phone !== (customer.phone || '') && store.updateCustomer(customer.id, { phone })} />

        <h3>History</h3>
        {!history.length && <p className="muted">No entries yet.</p>}
        <ul className="history">
          {history.map((t) => (
            <li key={t.id}>
              <span className={`dot ${t.type}`} aria-hidden />
              <span className="grow">
                <span className="h-items" dir="auto">{t.items || (t.type === 'payment' ? 'Payment received' : 'Credit')}</span>
                <span className="small muted">
                  {ago(t.createdAt)}
                  {t.source === 'device' && ' · 🔒 read on-device'}
                  {t.source === 'cloud' && (t.via === 'photo' ? ' · 📷 scanned' : ' · ☁️ cloud')}
                </span>
              </span>
              <span className={`amt-tag ${t.type}`}>{t.type === 'payment' ? '−' : '+'}{rs(t.amount)}</span>
              <button className="btn icon ghost small" onClick={() => remove(t)} aria-label="Delete entry">🗑</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
