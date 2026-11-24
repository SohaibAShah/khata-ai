import { useRef, useState } from 'react'
import { getForcedMode, parseEntry, parsePhoto, TRANSIENT } from '../ai.js'
import { firebaseEnabled } from '../firebase.js'
import { findCustomer } from '../store.js'
import { Avatar, recordInference, rs, SourceBadge } from '../lib.jsx'

const EXAMPLES = [
  'ali bhai 3 register 450 udhaar',
  'Sana baji ne 2k jama karwaye',
  'Hamza took 2 gel pens and a sharpener, 180 on credit; Farah paid 300',
]

// Dev-only: open http://localhost:5173/?preview=review to style the review card without an AI call.
const PREVIEW = import.meta.env.DEV && new URLSearchParams(location.search).get('preview') === 'review'
  ? {
      source: 'device', ms: 840, from: 'text',
      entries: [
        { customerName: 'Ali Bhai', type: 'credit', amount: 450, items: '3 registers' },
        { customerName: 'Sana Baji', type: 'payment', amount: 2000, items: '' },
        { customerName: 'Zainab', type: 'credit', amount: 180, items: 'gel pens, sharpener' },
      ],
    }
  : null

function routingHint(deviceState) {
  if (!firebaseEnabled) return { icon: '⚪', text: 'AI is off in demo mode' }
  const forced = getForcedMode()
  if (forced === 'cloud') return { icon: '☁️', text: 'Cloud only (set in Settings)' }
  if (forced === 'device') return { icon: '🔒', text: 'On-device only: nothing leaves this computer' }
  if (deviceState === 'available') return { icon: '🔒', text: 'Runs on-device with Gemini Nano: private and works offline' }
  return { icon: '☁️', text: 'On-device model not ready, so the cloud will be used' }
}

/** Type or speak a note → hybrid AI turns it into entries → shopkeeper reviews → save. */
export default function Composer({ store, customers, deviceState, notify }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(null) // 'text' | 'photo'
  const [draft, setDraft] = useState(PREVIEW) // { entries, source, ms, from }
  const [error, setError] = useState('')
  const [errorDetail, setErrorDetail] = useState('')
  const [listening, setListening] = useState(false)
  const fileRef = useRef(null)
  const names = customers.map((c) => c.name)
  const hint = routingHint(deviceState)

  async function runAI(kind, fn) {
    setBusy(kind); setError(''); setErrorDetail(''); setDraft(null)
    const t0 = performance.now()
    try {
      const { entries, source } = await fn()
      recordInference(source)
      if (!entries.length) setError("Couldn't find any entries. Try including a name and an amount.")
      else setDraft({ entries, source, ms: performance.now() - t0, from: kind })
    } catch (e) {
      console.error(e)
      setError(friendlyError(e)); setErrorDetail(String(e?.message || e).slice(0, 300))
    } finally {
      setBusy(null)
    }
  }

  const submit = (e) => {
    e?.preventDefault()
    if (!note.trim() || busy) return
    runAI('text', () => parseEntry(note.trim(), names))
  }

  const onPhoto = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!/image\/(jpeg|png)/.test(file.type)) return setError('Please use a JPEG or PNG photo.')
    runAI('photo', () => parsePhoto(file, names))
  }

  function listen() {
    const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition
    if (!SR) return setError('Voice input is not supported in this browser.')
    const r = new SR()
    r.lang = 'ur-PK'
    r.interimResults = false
    r.onresult = (ev) => setNote((n) => `${n ? n + ' ' : ''}${ev.results[0][0].transcript}`)
    r.onerror = () => setError('Voice input needs a connection. You can still type the entry.')
    r.onend = () => setListening(false)
    setListening(true)
    r.start()
  }

  async function save() {
    const list = []
    let created = 0
    const known = [...customers]
    for (const e of draft.entries) {
      let c = findCustomer(known, e.customerName)
      if (!c) {
        const id = await store.addCustomer({ name: e.customerName, phone: '' })
        c = { id, name: e.customerName }
        known.push(c)
        created++
      }
      list.push({ customerId: c.id, type: e.type, amount: e.amount, items: e.items, source: draft.source, via: draft.from })
    }
    await store.addTxns(list)
    const n = list.length
    notify(`Saved ${n} ${n === 1 ? 'entry' : 'entries'}${created ? ` · ${created} new ${created === 1 ? 'customer' : 'customers'}` : ''}`)
    setDraft(null)
    setNote('')
  }

  const update = (i, patch) =>
    setDraft((d) => ({ ...d, entries: d.entries.map((e, j) => (j === i ? { ...e, ...patch } : e)) }))
  const remove = (i) => setDraft((d) => ({ ...d, entries: d.entries.filter((_, j) => j !== i) }))

  return (
    <section className="card composer">
      <form onSubmit={submit}>
        <label htmlFor="note" className="composer-title">New entry</label>
        <p className="small muted composer-sub">Write it the way you'd write it in the khata, in English, Roman Urdu or اردو.</p>
        <div className="note-box">
          <textarea
            id="note"
            dir="auto"
            rows={2}
            value={note}
            placeholder="ali bhai 3 register 450 udhaar…"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) submit(e) }}
            disabled={!!busy}
          />
          <button type="button" className={`mic ${listening ? 'live' : ''}`} onClick={listen} title="Speak the entry" aria-label="Speak the entry">🎙️</button>
        </div>
        <div className="composer-actions">
          <button type="submit" className="btn primary" disabled={!note.trim() || !!busy}>
            {busy === 'text' ? <span className="spinner" /> : '✨'} {busy === 'text' ? 'Reading…' : 'Add entry'}
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={!!busy}>
            {busy === 'photo' ? <span className="spinner" /> : '📷'} {busy === 'photo' ? 'Scanning…' : 'Scan khata page'}
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png" capture="environment" hidden onChange={onPhoto} />
        </div>
        <p className="route-hint small"><span aria-hidden>{hint.icon}</span> {hint.text}</p>
        {!note && !draft && !busy && (
          <div className="chips">
            <span className="small muted">Try:</span>
            {EXAMPLES.map((x) => (
              <button type="button" key={x} className="chip" onClick={() => setNote(x)}>{x}</button>
            ))}
          </div>
        )}
      </form>

      {busy && (
        <div className="skeleton" aria-live="polite">
          <span /><span /><span />
          <p className="small muted">{busy === 'photo' ? 'Reading the handwriting…' : 'Understanding your note…'}</p>
        </div>
      )}

      {error && <div className="error" role="alert">{error}{errorDetail && <details className="small"><summary>Technical details</summary><code>{errorDetail}</code></details>}</div>}

      {draft && (
        <div className="review">
          <div className="row between">
            <strong>Check before saving</strong>
            <SourceBadge source={draft.source} ms={draft.ms} />
          </div>
          <p className="small muted">
            {draft.source === 'device'
              ? 'Read by Gemini Nano on this computer. Your note never left the device.'
              : draft.from === 'photo'
                ? 'Handwriting was read by a larger cloud model for accuracy.'
                : getForcedMode() === 'cloud' ? 'Read by Gemini in the cloud (Cloud only is set in Settings).' : 'On-device model unavailable, so Firebase AI Logic used the cloud.'}
          </p>
          {draft.entries.map((e, i) => {
            const match = findCustomer(customers, e.customerName)
            const after = (match?.balance || 0) + (e.type === 'payment' ? -e.amount : e.amount)
            return (
              <div className={`entry-edit ${e.type}`} key={i}>
                <Avatar name={e.customerName} size={34} />
                <div className="entry-fields">
                  <div className="entry-line">
                    <input dir="auto" className="name-input" value={e.customerName} onChange={(ev) => update(i, { customerName: ev.target.value })} aria-label="Customer" />
                    <div className="amt-wrap">
                      <span>Rs</span>
                      <input className="amt" type="number" min="1" inputMode="numeric" value={e.amount} onChange={(ev) => update(i, { amount: Math.abs(Number(ev.target.value)) })} aria-label="Amount" />
                    </div>
                  </div>
                  <div className="entry-line">
                    <div className="seg">
                      <button type="button" className={e.type === 'credit' ? 'on credit' : ''} onClick={() => update(i, { type: 'credit' })}>Udhaar</button>
                      <button type="button" className={e.type === 'payment' ? 'on payment' : ''} onClick={() => update(i, { type: 'payment' })}>Jama</button>
                    </div>
                    <input dir="auto" className="items" value={e.items} placeholder="items" onChange={(ev) => update(i, { items: ev.target.value })} aria-label="Items" />
                  </div>
                  <span className="small muted">
                    {match ? <>Balance becomes <b className={after > 0 ? 'owes' : 'clear'}>{rs(Math.abs(after))}{after < 0 ? ' advance' : ''}</b></> : <span className="tag tag-new">New customer</span>}
                  </span>
                </div>
                <button type="button" className="btn icon ghost small" onClick={() => remove(i)} aria-label="Remove entry">✕</button>
              </div>
            )
          })}
          <div className="row">
            <button className="btn primary" onClick={save} disabled={!draft.entries.length}>
              ✓ Save {draft.entries.length} {draft.entries.length === 1 ? 'entry' : 'entries'}
            </button>
            <button className="btn ghost" onClick={() => setDraft(null)}>Discard</button>
          </div>
        </div>
      )}
    </section>
  )
}

export function friendlyError(e) {
  const m = String(e?.message || e)
  if (/not configured/i.test(m)) return m
  if (/app.?check|attestation|401|403/i.test(m)) return 'App Check rejected the request. Register your debug token in the Firebase console (see README).'
  if (/on-?device|ONLY_ON_DEVICE|not available/i.test(m)) return 'The on-device model is not ready on this computer. Switch AI routing to Auto in Settings.'
  if (/timed out/i.test(m) && getForcedMode() === 'device') return 'The on-device model took too long to answer. Try again, or switch AI routing to Auto in Settings.'
  if (TRANSIENT.test(m) && navigator.onLine) return "Google's AI is busy right now. Please try again in a moment."
  if (!navigator.onLine || /network|offline|failed to fetch/i.test(m)) return "You're offline and the on-device model isn't ready yet. Enable it in Settings while online."
  return `AI request failed: ${m.slice(0, 160)}`
}
