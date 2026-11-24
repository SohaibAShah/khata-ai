import { useEffect, useState } from 'react'

export const rs = (n) => `Rs ${Math.round(n).toLocaleString('en-PK')}`
export const DAY = 86_400_000

export function ago(ts) {
  if (!ts) return '—'
  const d = Math.floor((Date.now() - ts) / DAY)
  if (d <= 0) return 'today'
  if (d === 1) return 'yesterday'
  if (d < 30) return `${d} days ago`
  return new Date(ts).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false)
    addEventListener('online', on); addEventListener('offline', off)
    return () => { removeEventListener('online', on); removeEventListener('offline', off) }
  }, [])
  return online
}

/** Persisted per-device preference. */
export function useLocal(key, initial) {
  const [v, setV] = useState(() => {
    try { const s = localStorage.getItem(key); return s == null ? initial : JSON.parse(s) } catch { return initial }
  })
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* empty */ } }, [key, v])
  return [v, setV]
}

/** Counts where each AI request ran, so the shopkeeper can see how much stayed on the device. */
const STATS_KEY = 'khata-ai-stats'
export function recordInference(source) {
  try {
    const s = JSON.parse(localStorage.getItem(STATS_KEY)) || { device: 0, cloud: 0 }
    s[source] = (s[source] || 0) + 1
    localStorage.setItem(STATS_KEY, JSON.stringify(s))
    dispatchEvent(new Event('khata-stats'))
  } catch { /* empty */ }
}
export function useStats() {
  const read = () => { try { return JSON.parse(localStorage.getItem(STATS_KEY)) || { device: 0, cloud: 0 } } catch { return { device: 0, cloud: 0 } } }
  const [s, setS] = useState(read)
  useEffect(() => {
    const f = () => setS(read())
    addEventListener('khata-stats', f)
    return () => removeEventListener('khata-stats', f)
  }, [])
  return s
}

const AVATAR_HUES = [152, 28, 210, 340, 265, 190, 48, 0]
export function Avatar({ name, size = 38 }) {
  const n = (name || '?').trim()
  let h = 0
  for (const ch of n) h = (h * 31 + ch.codePointAt(0)) >>> 0
  const hue = AVATAR_HUES[h % AVATAR_HUES.length]
  const initials = n.split(/\s+/).filter((w) => /\p{L}/u.test(w[0])).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || n[0]
  return (
    <span className="avatar" aria-hidden style={{ '--h': hue, width: size, height: size, fontSize: size * 0.38 }}>
      {initials}
    </span>
  )
}

/** Tiny toast queue: notify('Saved') shows a message for ~2.6s. */
export function useToast() {
  const [toast, setToast] = useState(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])
  return [toast, (text) => setToast({ text, key: Date.now() })]
}

export function SourceBadge({ source, ms }) {
  if (!source) return null
  return (
    <span className={`badge badge-${source}`}>
      {source === 'device' ? '🔒 On-device' : '☁️ Cloud'}
      {ms != null && <span className="badge-ms"> · {(ms / 1000).toFixed(1)}s</span>}
    </span>
  )
}

export async function loadSample(store) {
  const { people, txns } = sampleData()
  const ids = []
  for (const p of people) ids.push(await store.addCustomer(p))
  await store.addTxns(txns.map(({ i, ...t }) => ({ ...t, customerId: ids[i], source: 'manual', via: 'sample' })))
}

export function sampleData() {
  const now = Date.now()
  const people = [
    // Fictional demo customers; phone numbers are placeholders, not real people.
    { name: 'Ali Bhai', phone: '03000000001', lang: 'urdu' },
    { name: 'Sana Baji', phone: '03000000002', lang: 'roman' },
    { name: 'Usman (school van)', phone: '03000000003', lang: 'roman' },
    { name: 'Farah Teacher', phone: '03000000004', lang: 'english' },
    { name: 'Bilal Store', phone: '03000000005', lang: 'english' },
    { name: 'Hamza', phone: '03000000006', lang: 'roman' },
  ]
  const txns = [
    [0, 'credit', 1250, 'notebooks and gel pens', 41],
    [0, 'payment', 500, '', 30],
    [0, 'credit', 850, 'geometry box, 2 registers', 6],
    [1, 'credit', 2200, 'school project chart papers', 18],
    [1, 'payment', 2200, '', 3],
    [2, 'credit', 4800, 'bulk copies for students', 52],
    [2, 'credit', 1200, 'markers', 37],
    [3, 'credit', 650, 'whiteboard markers', 12],
    [3, 'payment', 300, '', 2],
    [4, 'credit', 7500, 'wholesale A4 rims', 25],
    [4, 'payment', 3000, '', 14],
    [5, 'credit', 380, 'pencils, eraser', 1],
  ]
  return { people, txns: txns.map(([i, type, amount, items, d]) => ({ i, type, amount, items, createdAt: now - d * DAY - 3_600_000 })) }
}
