import { useEffect, useRef, useState } from 'react'
import { draftReminder } from '../ai.js'
import { unpaidCredits } from '../store.js'
import { Avatar, recordInference, rs, SourceBadge } from '../lib.jsx'
import { intlNumber, isQuietHour, LANGS, logReminder, smsLink, whatsappLink } from '../reminders.js'
import { friendlyError } from './Composer.jsx'

const AUTO_LIMIT = 6 // drafts written automatically per session; the rest on tap
const keyOf = (c) => `${c.id}:${c.lang}:${c.tone}:${c.balance}`

/**
 * Today's reminders. When Gemini Nano is ready, messages are drafted automatically on the device
 * in each customer's preferred language; the shopkeeper reviews and sends each with one tap.
 */
export default function RemindersDue({ due, txns, rules, store, shopName, deviceState, drafts, setDrafts, notify, onOpen }) {
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState(null)
  const auto = useRef(0)
  const quiet = isQuietHour(rules)

  async function draft(c) {
    const k = keyOf(c)
    setBusy(c.id)
    const items = unpaidCredits(txns.filter((t) => t.customerId === c.id)).map((t) => t.items).filter(Boolean).slice(0, 3).join(', ')
    // Two attempts: the first draft after opening the app can time out while Gemini Nano is still
    // loading (~30 s); by the second attempt the model is warm and answers in a few seconds.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const t0 = performance.now()
      try {
        const r = await draftReminder({ shopName, name: c.name, balance: c.balance, days: c.pendingDays, items, lang: c.lang, tone: c.tone })
        recordInference(r.source)
        setDrafts((d) => ({ ...d, [k]: { ...r, ms: performance.now() - t0 } }))
        break
      } catch (e) {
        console.error(e)
        if (attempt === 2) setDrafts((d) => ({ ...d, [k]: { error: friendlyError(e) } }))
      }
    }
    setBusy(null)
  }

  // Automatic drafting, one at a time, only when the private on-device model is available.
  const next = due.find((c) => !drafts[keyOf(c)])
  useEffect(() => {
    if (deviceState !== 'available' || busy || !next || auto.current >= AUTO_LIMIT) return
    auto.current++
    draft(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceState, busy, next?.id, next && keyOf(next)])

  if (!due.length) return null

  const sent = (c, via) => { logReminder(store, c, via); notify(`Reminder to ${c.name} logged · next in ${rules.everyDays} days`) }
  const skip = (c) => {
    const tomorrow = new Date(); tomorrow.setHours(24, 0, 0, 0)
    store.updateCustomer(c.id, { snoozedUntil: tomorrow.getTime() })
    notify(`${c.name} skipped until tomorrow`)
  }
  const total = due.reduce((s, c) => s + c.balance, 0)
  const shown = showAll ? due : due.slice(0, 3)

  return (
    <section className="card reminders">
      <div className="row between">
        <strong>⏰ Reminders due today <span className="muted">({due.length} · {rs(total)})</span></strong>
      </div>
      <p className="small muted">
        {deviceState === 'available'
          ? "Drafted on this device in each customer's language. Check the message, then send it yourself."
          : 'Tap Draft to write each message. You check it and send it yourself.'}
      </p>
      {quiet && <p className="small quiet">🌙 Quiet hours until {rules.quietTo}:00. Messages are ready; send them in the morning.</p>}

      <ul className="due">
        {shown.map((c) => {
          const d = drafts[keyOf(c)]
          const phone = intlNumber(c.phone)
          return (
            <li key={c.id}>
              <div className="due-head">
                <button className="due-who" onClick={() => onOpen(c.id)}>
                  <Avatar name={c.name} size={34} />
                  <span className="grow">
                    <span className="name" dir="auto">{c.name}</span>
                    <span className="small muted">
                      <span className="owes">{rs(c.balance)}</span> · {c.pendingDays} days
                      {c.sent > 0 && ` · reminder ${c.sent + 1}`}
                      {c.tone === 'firm' && <span className="tag-firm">firm</span>}
                    </span>
                  </span>
                </button>
                <select className="lang-pick" value={c.lang} aria-label={`Language for ${c.name}`}
                  onChange={(e) => store.updateCustomer(c.id, { lang: e.target.value })}>
                  {LANGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>

              {d?.text != null ? (
                <>
                  <div className="row between">
                    <SourceBadge source={d.source} ms={d.ms} />
                  </div>
                  <textarea dir="auto" rows={3} value={d.text} aria-label={`Reminder for ${c.name}`}
                    onChange={(e) => setDrafts((all) => ({ ...all, [keyOf(c)]: { ...d, text: e.target.value } }))} />
                </>
              ) : busy === c.id ? (
                <p className="small muted"><span className="spinner" /> Writing in {LANGS.find(([k]) => k === c.lang)[1]}…</p>
              ) : d?.error ? (
                <p className="error small">{d.error}</p>
              ) : null}

              <div className="row">
                {d?.text == null && busy !== c.id && (
                  <button className="btn small" onClick={() => draft(c)} disabled={!!busy}>✍️ {d?.error ? 'Try again' : 'Draft'}</button>
                )}
                {d?.text != null && phone && !quiet && (
                  <>
                    <a className="btn small whatsapp" href={whatsappLink(c.phone, d.text)} target="_blank" rel="noreferrer" onClick={() => sent(c, 'whatsapp')}>WhatsApp</a>
                    <a className="btn small" href={smsLink(c.phone, d.text)} onClick={() => sent(c, 'sms')}>SMS</a>
                  </>
                )}
                {d?.text != null && !phone && (
                  <button className="btn small" onClick={() => onOpen(c.id)}>Add number</button>
                )}
                <button className="btn small ghost" onClick={() => skip(c)}>Skip today</button>
              </div>
            </li>
          )
        })}
      </ul>
      {due.length > 3 && (
        <button className="btn ghost small wide" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show all ${due.length}`}
        </button>
      )}
    </section>
  )
}

