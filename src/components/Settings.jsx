import { useState } from 'react'
import { getForcedMode, setForcedMode, warmUpDevice } from '../ai.js'
import { firebaseEnabled } from '../firebase.js'
import { useStats } from '../lib.jsx'

const STATUS = {
  available: { icon: '✅', text: 'Gemini Nano is ready on this computer.' },
  downloadable: { icon: '⬇️', text: 'Gemini Nano can be downloaded once (a few GB). After that it works offline.' },
  downloading: { icon: '⏳', text: 'Gemini Nano is downloading…' },
  unavailable: { icon: '☁️', text: "This device can't run Gemini Nano, so Khata AI will use the cloud." },
  unsupported: { icon: '☁️', text: 'This browser has no on-device model (needs desktop Chrome 139+), so Khata AI will use the cloud.' },
  checking: { icon: '…', text: 'Checking…' },
}

const ROUTES = [
  ['✍️', 'Reading your entries', 'device', 'Names and debts stay private'],
  ['💬', 'Drafting reminders', 'device', "In each customer's language; you send them"],
  ['📷', 'Scanning khata pages', 'cloud', 'Handwriting needs a bigger model'],
  ['📊', 'Monthly advisor', 'cloud', 'Names replaced with codes first'],
]

function RuleNumber({ label, value, onChange, min, max, suffix }) {
  return (
    <label className="rule">
      <span>{label}</span>
      <span className="rule-input">
        <input type="number" inputMode="numeric" min={min} max={max} value={value}
          onChange={(e) => onChange(Math.min(max, Math.max(min, Math.round(Number(e.target.value) || min))))} />
        <span className="muted small">{suffix}</span>
      </span>
    </label>
  )
}

export default function Settings({ shopName, setShopName, deviceState, refreshDevice, storeKind, uid, onSample, rules, setRules }) {
  const setRule = (k) => (v) => setRules({ ...rules, [k]: v })
  const [mode, setMode] = useState(getForcedMode())
  const [progress, setProgress] = useState(null)
  const stats = useStats()
  const total = stats.device + stats.cloud
  const pct = total ? Math.round((stats.device / total) * 100) : 0
  const status = STATUS[deviceState] || { icon: '', text: deviceState }

  async function enable() {
    setProgress(0)
    try {
      await warmUpDevice((p) => setProgress(p))
    } finally {
      setProgress(null)
      refreshDevice()
    }
  }

  return (
    <>
      <section className="card">
        <label className="label first" htmlFor="shop">Shop name <span className="muted">· signs your reminders</span></label>
        <input id="shop" dir="auto" value={shopName} onChange={(e) => setShopName(e.target.value)} />
      </section>

      <section className="card">
        <h3 className="card-title">Daily reminders</h3>
        <p className="small muted">
          Each day, customers who are due appear on the Khata tab with a message in their own language, drafted
          automatically on this device when Gemini Nano is ready. You send it from your own WhatsApp or SMS with one tap:
          no server sends anything and phone numbers aren't shared with any messaging service.
        </p>
        <div className="rules">
          <RuleNumber label="First reminder when money is pending" value={rules.afterDays} onChange={setRule('afterDays')} min={1} max={180} suffix="days" />
          <RuleNumber label="Then remind again every" value={rules.everyDays} onChange={setRule('everyDays')} min={1} max={60} suffix="days" />
          <RuleNumber label="Use a firm tone after" value={rules.firmAfter} onChange={setRule('firmAfter')} min={1} max={10} suffix="reminders" />
          <RuleNumber label="Quiet hours start" value={rules.quietFrom} onChange={setRule('quietFrom')} min={0} max={23} suffix=":00" />
          <RuleNumber label="Quiet hours end" value={rules.quietTo} onChange={setRule('quietTo')} min={0} max={23} suffix=":00" />
        </div>
        <p className="small muted">Set each customer's language, or switch them off, from their page. Reminders stop when they pay.</p>
      </section>

      <section className="card">
        <h3 className="card-title">On-device AI</h3>
        <div className="status-line"><span aria-hidden>{status.icon}</span><p className="small">{status.text}</p></div>
        {progress != null && (
          <div className="progress"><span style={{ width: `${Math.round(progress * 100)}%` }} /><em>{Math.round(progress * 100)}%</em></div>
        )}
        <div className="row">
          {(deviceState === 'downloadable' || deviceState === 'downloading') && progress == null && (
            <button className="btn primary" onClick={enable}>⬇ Enable on-device AI</button>
          )}
          {deviceState === 'available' && <button className="btn" onClick={enable}>Warm up model</button>}
        </div>

        <h3 className="card-title spaced">Where each task runs</h3>
        <ul className="routes">
          {ROUTES.map(([icon, task, where, why]) => (
            <li key={task}>
              <span className="route-icon" aria-hidden>{icon}</span>
              <span className="grow"><b>{task}</b><span className="small muted">{why}</span></span>
              <span className={`badge badge-${where}`}>{where === 'device' ? '🔒 On-device first' : '☁️ Cloud first'}</span>
            </li>
          ))}
        </ul>
        <p className="small muted">Each task falls back to the other side automatically. The defaults are set with Firebase Remote Config.</p>

        <label className="label">Override</label>
        <div className="seg wide">
          {[['auto', 'Auto (hybrid)'], ['device', 'On-device only'], ['cloud', 'Cloud only']].map(([k, l]) => (
            <button key={k} className={mode === k ? 'on' : ''} onClick={() => { setForcedMode(k); setMode(k) }}>{l}</button>
          ))}
        </div>
      </section>

      <section className="card">
        <h3 className="card-title">Privacy meter</h3>
        <div className="privacy">
          <div className="ring" style={{ '--p': pct }}><span>{total ? `${pct}%` : '–'}</span></div>
          <p className="small">
            {total
              ? <>of AI requests stayed on this device.<br /><span className="muted">{stats.device} on-device · {stats.cloud} cloud</span></>
              : 'No AI requests yet. Every result is labelled On-device or Cloud.'}
          </p>
        </div>
      </section>

      <section className="card">
        <h3 className="card-title">Data</h3>
        <p className="small">
          {storeKind === 'firestore'
            ? <>Synced with Cloud Firestore and cached offline. Account: anonymous (<code>{uid?.slice(0, 8)}…</code>).</>
            : firebaseEnabled
              ? 'Saved on this device only, because sign-in is unavailable (probably offline on first launch).'
              : 'Demo mode: Firebase is not configured, so data stays in this browser and AI is off. See the README.'}
        </p>
        <button className="btn" onClick={onSample}>Load sample shop data</button>
      </section>
    </>
  )
}
