// Ledger data layer. Firestore (with offline cache) when Firebase is configured and the user
// is signed in; otherwise a localStorage store so the UI still works in demo mode.
import {
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch,
} from 'firebase/firestore'
import { db } from './firebase.js'

const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 20)

function firestoreStore(uid) {
  const customersCol = collection(db, 'users', uid, 'customers')
  const txnsCol = collection(db, 'users', uid, 'txns')
  return {
    kind: 'firestore',
    subscribe(cb) {
      let customers = null, txns = null
      const emit = () => customers && txns && cb({ customers, txns })
      const u1 = onSnapshot(customersCol, (s) => {
        customers = s.docs.map((d) => ({ id: d.id, ...d.data() }))
        emit()
      })
      const u2 = onSnapshot(txnsCol, (s) => {
        txns = s.docs.map((d) => ({ id: d.id, ...d.data() }))
        emit()
      })
      return () => { u1(); u2() }
    },
    async addCustomer(data) {
      const id = newId()
      // Writes resolve once committed to the local cache when offline, so don't await the server.
      setDoc(doc(customersCol, id), { ...data, createdAt: Date.now() })
      return id
    },
    async updateCustomer(id, patch) { updateDoc(doc(customersCol, id), patch) },
    async addTxns(list) {
      const batch = writeBatch(db)
      for (const t of list) batch.set(doc(txnsCol, newId()), { ...t, createdAt: t.createdAt ?? Date.now() })
      batch.commit()
    },
    async deleteTxn(id) { deleteDoc(doc(txnsCol, id)) },
  }
}

function localStore() {
  const KEY = 'khata-ai-ledger-v1'
  let state = { customers: [], txns: [] }
  try { state = JSON.parse(localStorage.getItem(KEY)) || state } catch { /* empty */ }
  const listeners = new Set()
  const commit = () => {
    try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* empty */ }
    listeners.forEach((l) => l(state))
  }
  return {
    kind: 'local',
    subscribe(cb) { listeners.add(cb); cb(state); return () => listeners.delete(cb) },
    async addCustomer(data) {
      const id = newId()
      state = { ...state, customers: [...state.customers, { id, ...data, createdAt: Date.now() }] }
      commit(); return id
    },
    async updateCustomer(id, patch) {
      state = { ...state, customers: state.customers.map((c) => (c.id === id ? { ...c, ...patch } : c)) }
      commit()
    },
    async addTxns(list) {
      state = { ...state, txns: [...state.txns, ...list.map((t) => ({ id: newId(), ...t, createdAt: t.createdAt ?? Date.now() }))] }
      commit()
    },
    async deleteTxn(id) {
      state = { ...state, txns: state.txns.filter((t) => t.id !== id) }
      commit()
    },
  }
}

export function createStore(user) {
  return user && db ? firestoreStore(user.uid) : localStore()
}

/**
 * FIFO: payments clear the oldest credits first. Returns the credits still (partly) unpaid,
 * oldest first — the first one's date is how long money has been pending.
 */
export function unpaidCredits(history) {
  let paid = history.filter((t) => t.type === 'payment').reduce((s, t) => s + t.amount, 0)
  const pending = []
  for (const t of [...history].sort((a, b) => a.createdAt - b.createdAt)) {
    if (t.type !== 'credit') continue
    if (paid >= t.amount) { paid -= t.amount; continue }
    pending.push(t)
    paid = 0
  }
  return pending
}

export const OVERDUE_DAYS = 30

/** Balance per customer: positive = customer owes the shop. */
export function balances(customers, txns) {
  const map = Object.fromEntries(customers.map((c) => [c.id, { ...c, balance: 0, lastAt: 0, count: 0, history: [] }]))
  for (const t of txns) {
    const c = map[t.customerId]
    if (!c) continue
    c.balance += t.type === 'payment' ? -t.amount : t.amount
    c.lastAt = Math.max(c.lastAt, t.createdAt || 0)
    c.count++
    c.history.push(t)
  }
  return Object.values(map).map(({ history, ...c }) => {
    const since = c.balance > 0 ? unpaidCredits(history)[0]?.createdAt || null : null
    const pendingDays = since ? Math.max(1, Math.floor((Date.now() - since) / 86_400_000)) : 0
    return { ...c, lastAt: c.lastAt || c.createdAt || 0, pendingDays, overdue: pendingDays >= OVERDUE_DAYS }
  })
}

/** Case/space-insensitive name match so "ali bhai" finds "Ali Bhai". */
export function findCustomer(customers, name) {
  const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
  const n = norm(name)
  if (!n) return null
  return customers.find((c) => norm(c.name) === n) || customers.find((c) => norm(c.name).startsWith(n) || n.startsWith(norm(c.name))) || null
}
