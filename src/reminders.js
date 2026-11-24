// Reminder automation (semi-automatic): the app decides who is due and drafts the message in each
// customer's own language on the device; the shopkeeper sends it from their own WhatsApp or SMS with
// one tap. Nothing is sent by a server, so customer numbers and debts never leave the shop's devices.
import { DAY } from './lib.jsx'

export const LANGS = [['roman', 'Roman Urdu'], ['urdu', 'اردو'], ['english', 'English']]

export const DEFAULT_RULES = {
  afterDays: 30, // first reminder once the oldest unpaid credit is this old
  everyDays: 7, // then at most once every N days
  firmAfter: 2, // switch to a firm tone after this many reminders for the same debt
  quietFrom: 21, // no reminders from 9 PM…
  quietTo: 9, // …until 9 AM
}

/** Customer's preferred reminder language (older records have none). */
export const langOf = (c) => (LANGS.some(([k]) => k === c.lang) ? c.lang : 'roman')

/** "0300 1234567" → "923001234567"; returns '' when it doesn't look like a phone number. */
export function intlNumber(phone) {
  const d = String(phone || '').replace(/\D/g, '').replace(/^00/, '').replace(/^0/, '92')
  return d.length >= 10 ? d : ''
}

export const whatsappLink = (phone, text) => `https://wa.me/${intlNumber(phone)}?text=${encodeURIComponent(text)}`
export const smsLink = (phone, text) => `sms:+${intlNumber(phone)}?body=${encodeURIComponent(text)}`

/** Reminders already sent for the debt that is pending now (older ones were for a debt that was paid). */
export function remindersForCurrentDebt(c, now = Date.now()) {
  const since = now - c.pendingDays * DAY
  return c.lastReminder?.at >= since ? c.remindCount || 0 : 0
}

export function isQuietHour(rules, date = new Date()) {
  const h = date.getHours()
  const { quietFrom: a, quietTo: b } = rules
  return a === b ? false : a < b ? h >= a && h < b : h >= a || h < b
}

/** Customers who should get a reminder today, most overdue first, with the tone to use. */
export function dueReminders(rows, rules, now = Date.now()) {
  return rows
    .filter((c) => c.balance > 0 && c.autoRemind !== false && c.pendingDays >= rules.afterDays)
    .filter((c) => !(c.snoozedUntil > now))
    .filter((c) => !c.lastReminder || now - c.lastReminder.at >= rules.everyDays * DAY)
    .map((c) => {
      const sent = remindersForCurrentDebt(c, now)
      return { ...c, lang: langOf(c), tone: sent >= rules.firmAfter ? 'firm' : 'warm', sent }
    })
    .sort((a, b) => b.pendingDays - a.pendingDays || b.balance - a.balance)
}

/** Records a reminder the shopkeeper sent (or opened to send) so it isn't suggested again too soon. */
export function logReminder(store, c, via) {
  const count = remindersForCurrentDebt(c) + 1
  return store.updateCustomer(c.id, { lastReminder: { at: Date.now(), via, lang: langOf(c) }, remindCount: count, snoozedUntil: 0 })
}
