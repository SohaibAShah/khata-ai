# Khata AI 📒

**A private, offline-first credit ledger (khata) for small shops, powered by Firebase AI Logic hybrid inference.**

Built for [#BuildHybridAI 2026](https://firebasehybridaihackathon.devpost.com/) · Platform: **Web (Chrome)** · License: Apache-2.0

---

## The problem

Across Pakistan and South Asia, millions of kiryana, stationery and medical stores sell on credit (*udhaar*) to
neighbours they know by name. The record is a paper notebook, the **khata**. It gets lost, smudged or disputed,
nobody knows the total owed, and asking a regular customer for money is awkward.

Existing ledger apps want a form for every entry. Shopkeepers are busy at the counter, write in a mix of
Urdu and English, and are rightly nervous about putting their customers' debts on someone else's server.
Internet at the shop is often patchy.

## What Khata AI does

| | |
|---|---|
| ✍️ **Write it like you'd write the khata** | Type or speak `ali bhai 3 register 450 udhaar, sana ne 2k jama karwaye`. AI turns it into structured entries (customer, credit/payment, amount, items) for you to check, then save. English, Roman Urdu, Urdu script or a mix. |
| 📷 **Scan old khata pages** | Photograph a handwritten notebook page or a supplier bill to import every row at once. |
| 💬 **Polite reminders** | One tap drafts a respectful WhatsApp reminder in Roman Urdu, Urdu or English, warm or firm. The shopkeeper reviews and sends it themselves. |
| 📊 **Monthly advisor** | Recovery rate, who to call first and one concrete tip, with customer names pseudonymised before anything leaves the device. |
| 🔒 **Privacy meter** | Shows what share of AI requests ran on-device. Every result carries an *On-device* or *Cloud* badge. |
| 📶 **Works offline** | Installable PWA, Firestore offline cache and on-device Gemini Nano, so the counter keeps working without internet. |

## How it uses Firebase AI Logic hybrid inference

Every AI call goes through `getGenerativeModel(ai, { mode, inCloudParams, onDeviceParams })` in
[`src/ai.js`](src/ai.js). Routing is a deliberate per-task decision, not a single global switch:

| Task | Mode | Why |
|---|---|---|
| Parse a ledger note | `PREFER_ON_DEVICE` | Customer names and debts are the most private data a shop has. On-device is instant, free and works offline. |
| Draft a reminder | `PREFER_ON_DEVICE` | Same personal data, and a short text task that Gemini Nano handles well. |
| Read a khata photo | `PREFER_IN_CLOUD` (`gemini-3.8-flash`) | Messy handwriting needs a bigger multimodal model. Falls back to on-device (JPEG/PNG) when offline. |
| Monthly insights | `PREFER_IN_CLOUD` | Reasoning across the whole book. **Names are replaced with `C1, C2…` on-device first** and swapped back locally. The *Show what the cloud sees* button shows the exact payload. |

Other details:
- **Structured output on both paths**: the same `Schema` is passed as `responseConstraint` (on-device) and
  `responseSchema` (cloud), so the app gets the same JSON wherever inference ran.
- **`inferenceSource`** from each response drives the badges and the privacy meter.
- **`initializeDeviceModel()`** runs on a user gesture (*Settings → Enable on-device AI*) with download progress.
- **Routing override** (*Auto / On-device only / Cloud only*) for testing and for shops that want a hard privacy guarantee.

### Other Firebase products

- **App Check** (reCAPTCHA Enterprise; debug provider on localhost), required by AI Logic — [`src/firebase.js`](src/firebase.js)
- **Authentication**: anonymous sign-in, so there's no onboarding friction at the counter
- **Cloud Firestore** with `persistentLocalCache`: the ledger syncs across devices and works offline. Per-user rules are in [`firestore.rules`](firestore.rules)
- **Remote Config**: inference modes and model names per task ([`remoteconfig.template.json`](remoteconfig.template.json)), so routing can be tuned without a release
- **Hosting**: [`firebase.json`](firebase.json)

## Run it locally

Requirements: Node 20+, **desktop Chrome 139+** for on-device inference.

1. **Chrome:** open `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`, set it to *Enabled* and restart Chrome.
2. **Firebase project:** in the [Firebase console](https://console.firebase.google.com/) create a project and register a **Web app**, then:
   - *AI Services → AI Logic → Get started*, choose **Gemini Developer API**
   - *Build → Authentication → Sign-in method*: enable **Anonymous**
   - *Build → Firestore Database*: create a database, then publish `firestore.rules`
   - *Security → App Check*: register the web app with **reCAPTCHA Enterprise** and copy the site key
   - *(optional)* *Remote Config*: add the parameters from `remoteconfig.template.json`
3. **Configure:**
   ```bash
   cp .env.example .env.local   # then paste your web app config + site key
   npm install
   npm run dev
   ```
4. **App Check debug token:** open http://localhost:5173 and DevTools. Copy the `AppCheck debug token` printed in
   the console and add it in *Security → App Check → Apps → ⋮ → Manage debug tokens*. To keep the same token
   across browsers, put it in `.env.development.local` as `VITE_APPCHECK_DEBUG_TOKEN=…`. That file is only read
   by `npm run dev`, so the token can never end up in a production build (and `*.local` is git-ignored).
5. In the app, open **Settings → Enable on-device AI** (downloads Gemini Nano once), then **Load sample shop data**.

Without a Firebase config the app runs in **demo mode** (localStorage, AI off), so the UI can still be explored.

### Deploy

```bash
npm run build
npx firebase-tools deploy --only hosting,firestore:rules
```

## Project structure

```
src/
  ai.js            Firebase AI Logic hybrid models, schemas, routing policy, pseudonymisation
  firebase.js      App, App Check, Auth, Firestore offline cache, Remote Config
  store.js         Ledger data layer (Firestore, or a localStorage fallback) + balance maths
  lib.jsx          Formatting, hooks, inference stats, sample data
  App.jsx          Shell, ledger screen, navigation
  components/
    Composer.jsx       Natural-language and photo entry, review-before-save
    CustomerSheet.jsx  Customer history, manual entries, AI reminder → WhatsApp
    Insights.jsx       Stats + cloud advisor with "what the cloud sees"
    Settings.jsx       On-device model status/download, routing, privacy meter, data
```

## Built during the hackathon

Everything in this repository was created during the #BuildHybridAI submission period (Nov 2026). It started
from the standard `create-vite` React template and was written with help from an AI coding assistant (Claude Code).
Sample data is fictional, and the phone numbers in it are placeholders.

## License

[Apache License 2.0](LICENSE)
