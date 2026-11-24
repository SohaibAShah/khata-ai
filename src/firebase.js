// Firebase bootstrap: App, App Check, Auth, Firestore (offline cache), Remote Config, AI Logic.
import { initializeApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'
import { getAuth, signInAnonymously } from 'firebase/auth'
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore'
import { getRemoteConfig, fetchAndActivate, getValue } from 'firebase/remote-config'
import { getAI, GoogleAIBackend } from 'firebase/ai'

const env = import.meta.env

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
}

/** True when a Firebase config is present. Without one the app runs in local demo mode (no AI). */
export const firebaseEnabled = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId)

/** Defaults used when Remote Config is unreachable (offline) or not yet fetched. */
export const RC_DEFAULTS = {
  // Inference mode for parsing ledger entries. Private data → on-device first.
  entry_mode: 'PREFER_ON_DEVICE',
  // Inference mode for drafting payment reminders.
  reminder_mode: 'PREFER_ON_DEVICE',
  // Cloud fallback model for light tasks.
  cloud_model: 'gemini-3.5-flash-lite',
  // Cloud model for heavy tasks (handwritten notebook photos, monthly insights).
  // Flash-Lite reads our khata pages correctly in ~3s; gemini-3.8-flash was taking 15-45s or
  // returning "high demand" (Nov 2026), so it is the retry model instead. Switchable via Remote Config.
  heavy_model: 'gemini-3.5-flash-lite',
  // Model for the one retry after a busy or failed cloud call.
  fallback_model: 'gemini-3.8-flash',
}

let app, auth, db, remoteConfig, ai

if (firebaseEnabled) {
  app = initializeApp(firebaseConfig)

  // App Check is enforced for Firebase AI Logic. Use the debug provider on localhost.
  const debug = env.DEV || env.VITE_APPCHECK_DEBUG === 'true'
  if (debug) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = env.VITE_APPCHECK_DEBUG_TOKEN || true
  }
  // With the debug provider active the site key is never used for attestation, so a placeholder is fine.
  const siteKey = env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY || (debug ? 'debug-placeholder' : '')
  if (siteKey) {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true,
    })
  } else {
    console.warn('[Khata AI] VITE_RECAPTCHA_ENTERPRISE_SITE_KEY not set — App Check not initialized; AI calls will be rejected.')
  }

  auth = getAuth(app)
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  })

  remoteConfig = getRemoteConfig(app)
  remoteConfig.settings.minimumFetchIntervalMillis = env.DEV ? 60_000 : 3_600_000
  remoteConfig.defaultConfig = RC_DEFAULTS

  ai = getAI(app, { backend: new GoogleAIBackend() })
}

export { app, auth, db, ai }

/** Fetch Remote Config once; failures (e.g. offline) silently keep defaults. */
export async function loadRemoteConfig() {
  if (!remoteConfig) return
  try {
    await fetchAndActivate(remoteConfig)
  } catch (e) {
    console.info('[Khata AI] Remote Config fetch skipped:', e?.code || e?.message)
  }
}

export function rc(key) {
  if (!remoteConfig) return RC_DEFAULTS[key]
  return getValue(remoteConfig, key).asString() || RC_DEFAULTS[key]
}

/** Resolve to the signed-in user (anonymous sign-in keeps onboarding to zero taps). */
export async function ensureUser() {
  if (!auth) return null
  // Wait for the persisted session to load, otherwise every reload would mint a new anonymous account.
  await auth.authStateReady()
  return auth.currentUser || (await signInAnonymously(auth)).user
}
