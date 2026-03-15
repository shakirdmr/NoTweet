import { STORE, DEFAULTS } from './constants.js'

// ─── Randomness helpers ───────────────────────────────────────────────────────
export const randomBetween = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min

export const delay = (ms) => new Promise((res) => setTimeout(res, ms))

// ─── Date helpers ─────────────────────────────────────────────────────────────
export const todayString = () => new Date().toDateString()

export const tomorrowMidnightMs = () => {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// ─── chrome.storage.local wrappers ───────────────────────────────────────────
export const getStorage = (keys) =>
  new Promise((res) => chrome.storage.local.get(keys, res))

export const setStorage = (data) =>
  new Promise((res) => chrome.storage.local.set(data, res))

/**
 * Reads settings + state + log from storage.
 * Merges with DEFAULTS so callers always get fully-shaped objects.
 */
export async function loadAll() {
  const raw = await getStorage([STORE.SETTINGS, STORE.STATE, STORE.LOG])
  return {
    settings: { ...DEFAULTS.settings, ...(raw[STORE.SETTINGS] || {}) },
    state:    { ...DEFAULTS.state,    ...(raw[STORE.STATE]    || {}) },
    log:      raw[STORE.LOG] || [],
  }
}

/**
 * Initialises storage with DEFAULTS if keys are missing.
 * Safe to call multiple times — only writes missing keys.
 */
export async function ensureDefaults() {
  const raw = await getStorage([STORE.SETTINGS, STORE.STATE, STORE.LOG])
  const patch = {}
  if (!raw[STORE.SETTINGS]) patch[STORE.SETTINGS] = DEFAULTS.settings
  if (!raw[STORE.STATE])    patch[STORE.STATE]    = DEFAULTS.state
  if (!raw[STORE.LOG])      patch[STORE.LOG]      = DEFAULTS.log
  if (Object.keys(patch).length) await setStorage(patch)
}

// ─── DOM helpers (content script only) ───────────────────────────────────────
/**
 * Returns a promise that resolves with the first element matching `selector`,
 * or null if not found within `timeout` ms.
 */
export function waitForElement(selector, timeout = 3000) {
  return new Promise((resolve) => {
    const el = document.querySelector(selector)
    if (el) return resolve(el)

    const observer = new MutationObserver(() => {
      const found = document.querySelector(selector)
      if (found) {
        observer.disconnect()
        resolve(found)
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    setTimeout(() => {
      observer.disconnect()
      resolve(null)
    }, timeout)
  })
}
