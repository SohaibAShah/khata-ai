// All generative AI in Khata AI goes through Firebase AI Logic hybrid inference.
//
// Routing policy (why each task runs where it does):
//  - Ledger entries & reminders contain customer names + debts → PREFER_ON_DEVICE (private, free, offline).
//  - Notebook/bill photos are heavy handwriting OCR → PREFER_IN_CLOUD (bigger model), on-device as fallback.
//  - Monthly insights → cloud, but names are replaced with pseudonyms (C1, C2…) before leaving the device.
// Modes and model names are tunable from Remote Config without shipping a new build.
import { getGenerativeModel, InferenceMode, Schema } from 'firebase/ai'
import { ai, firebaseEnabled, rc } from './firebase.js'

const FORCE_KEY = 'khata-ai-force-mode'

/** User/demo override: 'auto' | 'device' | 'cloud'. */
export function getForcedMode() {
  try { return localStorage.getItem(FORCE_KEY) || 'auto' } catch { return 'auto' }
}
export function setForcedMode(v) {
  try { localStorage.setItem(FORCE_KEY, v) } catch { /* empty */ }
  cache.clear()
}

function resolveMode(preferred) {
  const forced = getForcedMode()
  if (forced === 'device') return InferenceMode.ONLY_ON_DEVICE
  if (forced === 'cloud') return InferenceMode.ONLY_IN_CLOUD
  return InferenceMode[preferred] || InferenceMode.PREFER_ON_DEVICE
}

// ---------- Schemas (shared by on-device responseConstraint and cloud responseSchema) ----------

const entrySchema = Schema.object({
  properties: {
    entries: Schema.array({
      items: Schema.object({
        properties: {
          customerName: Schema.string(),
          type: Schema.enumString({ enum: ['credit', 'payment'] }),
          amount: Schema.number(),
          items: Schema.string(),
        },
        optionalProperties: ['items'],
      }),
    }),
  },
})

const insightSchema = Schema.object({
  properties: {
    headline: Schema.string(),
    points: Schema.array({ items: Schema.string() }),
    followUp: Schema.array({
      items: Schema.object({ properties: { id: Schema.string(), reason: Schema.string() } }),
    }),
    tip: Schema.string(),
  },
})

// ---------- Model factory ----------

const cache = new Map()
const initialized = new WeakSet()

function model(task, useAlt = false) {
  if (!firebaseEnabled) throw new Error('Firebase is not configured. Add your keys to .env.local (see README).')
  const spec = {
    entry: { mode: rc('entry_mode'), cloud: rc('cloud_model'), schema: entrySchema },
    photo: { mode: 'PREFER_IN_CLOUD', cloud: rc('heavy_model'), schema: entrySchema, image: true },
    reminder: { mode: rc('reminder_mode'), cloud: rc('cloud_model') },
    insights: { mode: 'PREFER_IN_CLOUD', cloud: rc('heavy_model'), schema: insightSchema },
  }[task]
  // Fallback when the primary cloud model is overloaded: swap the light and heavy models.
  if (useAlt) spec.cloud = spec.cloud === rc('cloud_model') ? rc('heavy_model') : rc('cloud_model')
  // A retry always goes to the cloud, so a slow or stuck Nano can't block it a second time.
  const mode = useAlt ? InferenceMode.ONLY_IN_CLOUD : resolveMode(spec.mode)
  const key = `${task}:${mode}:${spec.cloud}`
  if (cache.has(key)) return cache.get(key)

  const expectedInputs = [{ type: 'text', languages: ['en'] }]
  if (spec.image) expectedInputs.push({ type: 'image' })
  const m = getGenerativeModel(ai, {
    mode,
    inCloudParams: {
      model: spec.cloud,
      generationConfig: spec.schema
        ? { responseMimeType: 'application/json', responseSchema: spec.schema, temperature: 0.1 }
        : { temperature: 0.7 },
    },
    onDeviceParams: {
      createOptions: { expectedInputs, expectedOutputs: [{ type: 'text', languages: ['en'] }] },
      // No responseConstraint: schema-constrained decoding makes Gemini Nano take 45s+ on a short note,
      // while a plain prompt answers in ~3s. The prompt shows the JSON shape and parseJson() is tolerant.
    },
  })
  cache.set(key, m)
  return m
}

/** Must run on a user gesture. Starts (or confirms) the Gemini Nano download in Chrome. */
function initDevice(m, onProgress) {
  if (initialized.has(m) || typeof m.initializeDeviceModel !== 'function') return Promise.resolve()
  initialized.add(m)
  return Promise.resolve(m.initializeDeviceModel(onProgress)).catch((e) => console.info('[Khata AI] on-device init:', e?.message))
}

/** Errors worth one retry on the other cloud model (overload, rate limit, hang). */
export const TRANSIENT = /\b(429|500|503)\b|high demand|overloaded|resource.?exhausted|timed out/i
const AI_TIMEOUT_MS = 45000

function withTimeout(p, ms) {
  let t
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('AI request timed out')), ms) })])
    .finally(() => clearTimeout(t))
}

async function run(task, parts) {
  const m = model(task)
  const init = initDevice(m)
  const forced = getForcedMode()
  if (forced === 'device') await init
  let result
  try {
    result = await withTimeout(m.generateContent(parts), AI_TIMEOUT_MS)
  } catch (e) {
    if (forced === 'device' || !TRANSIENT.test(String(e?.message))) throw e
    console.info('[Khata AI] first attempt failed, retrying in the cloud on the other model:', e?.message)
    result = await withTimeout(model(task, true).generateContent(parts), AI_TIMEOUT_MS)
  }
  const text = result.response.text()
  const source = String(result.response.inferenceSource || '').toUpperCase().includes('DEVICE') ? 'device' : 'cloud'
  return { text, source }
}

/** Tolerant JSON reader: on-device output may wrap the object in code fences or a sentence. */
function parseJson(text) {
  const clean = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    return JSON.parse(clean)
  } catch {
    const start = clean.indexOf('{')
    const end = clean.lastIndexOf('}')
    if (start === -1 || end <= start) throw new Error(`AI reply was not JSON: ${clean.slice(0, 80)}`)
    return JSON.parse(clean.slice(start, end + 1))
  }
}

// ---------- On-device model status (Chrome Prompt API) ----------

/** 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported' */
export async function deviceStatus() {
  const LM = globalThis.LanguageModel
  if (!LM?.availability) return 'unsupported'
  try {
    return await LM.availability({ expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] })
  } catch {
    return 'unavailable'
  }
}

/** Call from a click handler: downloads Gemini Nano if needed, reporting 0..1 progress. */
export async function warmUpDevice(onProgress) {
  await initDevice(model('entry'), onProgress)
  initDevice(model('reminder'))
}

// ---------- Tasks ----------

const ENTRY_RULES = `You are the bookkeeper for a small shop in Pakistan. Convert the shopkeeper's note into ledger entries.
The note may be English, Roman Urdu, Urdu script, or a mix.
- type "credit" = customer took goods/cash on credit and now owes MORE (udhaar, le gaya, le gayi, khate mein likho, baaki, took, borrowed).
- type "payment" = customer paid money back and owes LESS (jama, de gaya, de gayi, wapis, ada, paid, returned money).
- amount is a plain number in rupees. "2k" = 2000, "dedh hazar" = 1500, "dhai sau" = 250, "paanch sau" = 500, "hazar" = 1000.
- customerName: reuse the exact spelling from KNOWN CUSTOMERS when it is clearly the same person; otherwise write the name as given.
- items: short English description of goods, empty if none.
- One note can contain several entries. Never invent entries that are not in the note.`

export async function parseEntry(note, knownNames) {
  const prompt = `${ENTRY_RULES}

KNOWN CUSTOMERS: ${knownNames.slice(0, 200).join(', ') || '(none yet)'}

Example: "ali bhai 3 register 450 udhaar, sana ne 1000 jama karwaye"
→ {"entries":[{"customerName":"Ali Bhai","type":"credit","amount":450,"items":"3 registers"},{"customerName":"Sana","type":"payment","amount":1000,"items":""}]}

NOTE: ${note}

Reply with only the JSON object, in exactly the shape of the example.`
  const { text, source } = await run('entry', prompt)
  return { entries: sanitize(parseJson(text).entries), source }
}

async function fileToPart(file) {
  const data = await new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onloadend = () => resolve(String(r.result).split(',')[1])
    r.onerror = reject
    r.readAsDataURL(file)
  })
  return { inlineData: { data, mimeType: file.type } }
}

/** Reads a photo of a handwritten khata page or a printed bill into ledger entries. */
export async function parsePhoto(file, knownNames) {
  const prompt = `${ENTRY_RULES}

The input is a PHOTO of a handwritten khata (credit notebook) page or a bill. Read every row you can.
Rows with a name and amount and no clear payment word are "credit". Skip totals, dates and crossed-out rows.

KNOWN CUSTOMERS: ${knownNames.slice(0, 200).join(', ') || '(none yet)'}
Reply with only a JSON object: {"entries":[{"customerName":"…","type":"credit","amount":450,"items":"…"}]}`
  const { text, source } = await run('photo', [prompt, await fileToPart(file)])
  return { entries: sanitize(parseJson(text).entries), source }
}

function sanitize(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((e) => ({
      customerName: String(e.customerName || '').trim(),
      type: e.type === 'payment' ? 'payment' : 'credit',
      amount: Math.round(Math.abs(Number(e.amount) || 0)),
      items: String(e.items || '').trim(),
    }))
    .filter((e) => e.customerName && e.amount > 0)
}

export async function draftReminder({ shopName, name, balance, days, items, lang, tone }) {
  const langLine = {
    roman: 'Write in Roman Urdu (Urdu in English letters), the way people text on WhatsApp in Pakistan.',
    urdu: 'Write in Urdu script.',
    english: 'Write in simple English.',
  }[lang] || 'Write in Roman Urdu.'
  const prompt = `Write a short WhatsApp message from a shopkeeper to a regular customer about money they owe.
${langLine}
Tone: ${tone === 'firm' ? 'polite but firm, ask for a date' : 'warm and respectful, like a neighbour; keep the relationship'}.
Max 3 sentences. No emojis except one at most. Do not threaten. Sign off with the shop name.
Shop: ${shopName || 'our shop'}
Customer: ${name}
Amount due: Rs ${balance.toLocaleString('en-PK')}
Oldest unpaid: ${days} days ago
Recent items: ${items || 'n/a'}
Output only the message text.`
  const { text, source } = await run('reminder', prompt)
  return { text: text.trim().replace(/^"|"$/g, ''), source }
}

/**
 * Monthly insights. Customer names are pseudonymised on-device before the request,
 * so the cloud model only ever sees C1, C2… and amounts.
 */
export async function monthlyInsights(rows) {
  const alias = new Map(rows.map((r, i) => [`C${i + 1}`, r]))
  const table = [...alias.entries()]
    .map(([id, r]) => `${id}: owes ${r.balance}, credit30d ${r.credit30}, paid30d ${r.paid30}, daysSinceLastPayment ${r.daysSincePay ?? 'never'}, entries ${r.count}`)
    .join('\n')
  const prompt = `You advise a small Pakistani shop owner about their credit (udhaar) book. Be practical and brief.
Data (one line per customer, amounts in rupees):
${table || '(no customers)'}

Return: headline (one sentence on overall credit health), points (3 short observations with numbers),
followUp (up to 3 customer ids to contact first, with a short reason), tip (one concrete action for this week).
Reply with only a JSON object: {"headline":"…","points":["…"],"followUp":[{"id":"C1","reason":"…"}],"tip":"…"}`
  const { text, source } = await run('insights', prompt)
  const out = parseJson(text)
  // Swap pseudonyms back to real names locally, after the response arrives.
  const reveal = (s) => String(s || '').replace(/\bC(\d+)\b/g, (m) => alias.get(m)?.name || m)
  return {
    headline: reveal(out.headline),
    points: (out.points || []).map(reveal),
    tip: reveal(out.tip),
    followUp: (out.followUp || []).map((f) => ({ reason: reveal(f.reason), customer: alias.get(f.id) })).filter((f) => f.customer),
    source,
    sentPreview: table,
  }
}
