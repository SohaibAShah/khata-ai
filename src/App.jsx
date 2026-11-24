import { useCallback, useEffect, useMemo, useState } from 'react'
import { ensureUser, firebaseEnabled, loadRemoteConfig } from './firebase.js'
import { balances, createStore, OVERDUE_DAYS } from './store.js'
import { deviceStatus } from './ai.js'
import { ago, Avatar, loadSample, rs, useLocal, useOnline, useToast } from './lib.jsx'
import Composer from './components/Composer.jsx'
import CustomerSheet from './components/CustomerSheet.jsx'
import Insights from './components/Insights.jsx'
import RemindersDue from './components/RemindersDue.jsx'
import Settings from './components/Settings.jsx'
import { DEFAULT_RULES, dueReminders } from './reminders.js'

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])

const FILTERS = [['all', 'All'], ['owes', 'Owe you'], ['overdue', 'Overdue']]

export default function App() {
  const [store, setStore] = useState(null)
  const [uid, setUid] = useState(null)
  const [data, setData] = useState({ customers: [], txns: [] })
  const [tab, setTab] = useLocal('khata-ai-tab', 'ledger')
  const [shopName, setShopName] = useLocal('khata-ai-shop', 'Al-Noor Stationers')
  const [openId, setOpenId] = useState(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [deviceState, setDeviceState] = useState('checking')
  const [savedRules, setRules] = useLocal('khata-ai-reminder-rules', DEFAULT_RULES)
  const rules = { ...DEFAULT_RULES, ...savedRules }
  const [drafts, setDrafts] = useState({})
  const [toast, notify] = useToast()
  const online = useOnline()

  useEffect(() => {
    let unsub = () => {}
    ;(async () => {
      loadRemoteConfig()
      let user = null
      if (firebaseEnabled) {
        try { user = await withTimeout(ensureUser(), 8000) } catch (e) { console.warn('[Khata AI] sign-in failed, using local store', e) }
      }
      const s = createStore(user)
      setUid(user?.uid || null)
      setStore(s)
      unsub = s.subscribe(setData)
    })()
    return () => unsub()
  }, [])

  const refreshDevice = useCallback(() => { deviceStatus().then(setDeviceState) }, [])
  useEffect(refreshDevice, [refreshDevice])
  const closeSheet = useCallback(() => setOpenId(null), [])

  const rows = useMemo(() => balances(data.customers, data.txns), [data])
  const stats = useMemo(() => {
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
    return {
      outstanding: rows.reduce((s, r) => s + Math.max(0, r.balance), 0),
      owing: rows.filter((r) => r.balance > 0).length,
      overdue: rows.filter((r) => r.overdue),
      overdueAmt: rows.filter((r) => r.overdue).reduce((s, r) => s + r.balance, 0),
      collected: data.txns.filter((t) => t.type === 'payment' && t.createdAt >= monthStart.getTime()).reduce((s, t) => s + t.amount, 0),
    }
  }, [rows, data.txns])

  const list = rows
    .filter((r) => filter === 'all' || (filter === 'owes' ? r.balance > 0 : r.overdue))
    .filter((r) => !query || r.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.balance - a.balance || b.lastAt - a.lastAt)
  const open = rows.find((r) => r.id === openId)
  const ruleKey = JSON.stringify(rules)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const due = useMemo(() => dueReminders(rows, rules), [rows, ruleKey])

  const deviceChip = deviceState === 'available'
    ? { cls: 'ok', text: '🔒 On-device AI' }
    : deviceState === 'downloadable' || deviceState === 'downloading'
      ? { cls: 'warn', text: '⬇ Get on-device AI' }
      : deviceState === 'checking' ? { cls: '', text: '…' } : { cls: 'muted', text: '☁️ Cloud AI' }

  async function sample() {
    await loadSample(store)
    notify('Sample shop loaded')
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <img src="/favicon.svg" alt="" className="logo" />
          <div className="brand-text">
            <h1>Khata AI</h1>
            <span className="small muted shop" dir="auto">{shopName}</span>
          </div>
        </div>
        <div className="row nowrap">
          {!online && <span className="pill warn">Offline</span>}
          <button className={`pill ${deviceChip.cls}`} onClick={() => setTab('settings')}>{deviceChip.text}</button>
        </div>
      </header>

      {!firebaseEnabled && (
        <div className="banner">Demo mode: add your Firebase config to <code>.env.local</code> to turn on AI and sync.</div>
      )}

      <main>
        {!store && <div className="loading"><span className="spinner" /> Opening your khata…</div>}

        {store && tab === 'ledger' && (
          <div className="ledger">
            <div className="ledger-main">
            <section className="hero">
              <span className="hero-label">Total udhaar outstanding</span>
              <strong className="hero-amount">{rs(stats.outstanding)}</strong>
              <div className="hero-stats">
                <div><b>{stats.owing}</b><span>owe you</span></div>
                <div><b>{stats.overdue.length}</b><span>overdue {OVERDUE_DAYS}d+</span></div>
                <div><b>{rs(stats.collected)}</b><span>collected this month</span></div>
              </div>
            </section>

            <Composer store={store} customers={rows} deviceState={deviceState} notify={notify} />
            </div>

            <div className="ledger-side">
            <RemindersDue due={due} txns={data.txns} rules={rules} store={store} shopName={shopName} deviceState={deviceState}
              drafts={drafts} setDrafts={setDrafts} notify={notify} onOpen={setOpenId} />
            {!rows.length ? (
              <section className="card welcome">
                <h2>Your khata, without the paper</h2>
                <ul>
                  <li><span>🔒</span><div><b>Private by default.</b> Entries are read by AI on your own computer, so customer names and debts stay with you.</div></li>
                  <li><span>📶</span><div><b>Works offline.</b> Keep writing when the internet drops. It syncs when you're back.</div></li>
                  <li><span>🗣️</span><div><b>Speaks your language.</b> English, Roman Urdu or Urdu, even mixed in one line.</div></li>
                </ul>
                <div className="row">
                  <button className="btn primary" onClick={sample}>Try with a sample shop</button>
                  <span className="small muted">or write your first entry above</span>
                </div>
              </section>
            ) : (
              <section className="card list">
                <div className="list-head">
                  <strong>Customers <span className="muted">({rows.length})</span></strong>
                  <input className="search" type="search" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search customers" />
                </div>
                <div className="filters" role="tablist">
                  {FILTERS.map(([k, l]) => (
                    <button key={k} role="tab" aria-selected={filter === k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
                      {l}{k === 'overdue' && stats.overdue.length > 0 && <span className="count">{stats.overdue.length}</span>}
                    </button>
                  ))}
                </div>
                {!list.length && <p className="muted small empty">No customers match.</p>}
                <ul className="customers">
                  {list.map((c) => (
                    <li key={c.id}>
                      <button onClick={() => setOpenId(c.id)}>
                        <Avatar name={c.name} />
                        <span className="grow">
                          <span className="name" dir="auto">{c.name}</span>
                          <span className="small muted">
                            {c.balance > 0
                              ? c.overdue ? <span className="owes">Overdue · {c.pendingDays} days</span> : `Pending ${c.pendingDays} ${c.pendingDays === 1 ? 'day' : 'days'}`
                              : `Last ${ago(c.lastAt)}`}
                          </span>
                        </span>
                        <span className={`bal ${c.balance > 0 ? 'owes' : 'clear'}`}>
                          {c.balance > 0 ? rs(c.balance) : c.balance < 0 ? `+${rs(-c.balance)}` : 'Clear ✓'}
                        </span>
                        <span className="chev" aria-hidden>›</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {stats.overdueAmt > 0 && filter !== 'overdue' && !due.length && (
                  <button className="overdue-nudge" onClick={() => setFilter('overdue')}>
                    ⏰ {rs(stats.overdueAmt)} has been pending over {OVERDUE_DAYS} days. Send reminders →
                  </button>
                )}
              </section>
            )}
            </div>
          </div>
        )}

        {store && tab === 'insights' && <Insights rows={rows} txns={data.txns} onOpen={setOpenId} />}

        {store && tab === 'settings' && (
          <Settings shopName={shopName} setShopName={setShopName} deviceState={deviceState} refreshDevice={refreshDevice}
            store={store} storeKind={store.kind} uid={uid} onSample={sample} rules={rules} setRules={setRules} />
        )}
      </main>

      <nav className="tabs" aria-label="Main">
        {[['ledger', '📒', 'Khata'], ['insights', '📊', 'Insights'], ['settings', '⚙️', 'Settings']].map(([k, i, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined}>
            <span aria-hidden>{i}</span>{l}
          </button>
        ))}
      </nav>

      {open && (
        <CustomerSheet key={open.id} customer={open} txns={data.txns} store={store} shopName={shopName} onClose={closeSheet} notify={notify} />
      )}

      {toast && <div className="toast" key={toast.key} role="status">{toast.text}</div>}
    </div>
  )
}
