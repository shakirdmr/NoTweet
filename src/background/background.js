/**
 * NoTweet — Background Service Worker (MV3)
 *
 * Responsibilities (streamlined):
 *
 * 1. REPLYBACK — replies to replies on the user's own posts
 *    • Triggered by REPLY_TO_MY_POST from content script
 *    • Uses chrome.alarm (5–15 s delay), queue persisted in storage
 *
 * 2. GENERATE_REPLY — Claude API calls on behalf of content script
 *    • Content script owns the outbound reply loop (setTimeout, never sleeps)
 *    • Background is a stateless API proxy here
 *
 * 3. State management — LOG_OUTBOUND / LOG_ATTEMPT / status broadcasts
 */

import { MSG, STORE, ALARM_REPLYBACK, DELAY } from '../shared/constants.js'
import {
  loadAll, setStorage, ensureDefaults,
  randomBetween, todayString,
} from '../shared/utils.js'
import { OUTBOUND_PROMPT, REPLYBACK_PROMPT, CORRECTION_PROMPT } from './prompts.js'

// ─── Init ─────────────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(ensureDefaults)
chrome.runtime.onStartup.addListener(ensureDefaults)

// ─── Alarm handler ────────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_REPLYBACK) await runReplybackCycle()
})

// ─── Message handler ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message

  switch (type) {

    // ── Someone replied to the user's own post ─────────────────────────────
    case MSG.REPLY_TO_MY_POST: {
      ;(async () => {
        try {
          await enqueueReplyback(payload.tweet)
          sendResponse({ ok: true })
        } catch (err) {
          sendResponse({ ok: false, error: err.message })
        }
      })()
      return true
    }

    // ── Content script asks Claude for a reply text ────────────────────────
    case MSG.GENERATE_REPLY: {
      ;(async () => {
        try {
          const { settings } = await loadAll()
          if (!settings.apiKey && !settings.proxyUrl) {
            sendResponse({ ok: false, error: 'No API key configured.' })
            return
          }
          const replyText = await callClaude(payload.tweetText, settings, 'outbound')
          sendResponse({ ok: true, replyText })
        } catch (err) {
          // 401/403 = invalid API key — no point retrying, stop the bot
          const fatal = /40[13]/.test(err.message)
          sendResponse({ ok: false, error: err.message, fatal })
        }
      })()
      return true
    }

    // ── Content script reports a successful outbound reply ─────────────────
    case MSG.LOG_OUTBOUND: {
      ;(async () => {
        try {
          let { state, log } = await loadAll()
          state = checkDailyReset(state)
          state.seenTweets[payload.tweet.id] = Date.now()
          if (!payload.skipCount) {
            state.outboundCount++
            state.error = null
          }
          await setStorage({ [STORE.STATE]: state })
          // Always log the entry so seenTweets bookkeeping is visible; skip count-increment only
          await saveLogEntry({ tweet: payload.tweet, replyText: payload.replyText, kind: payload.skipCount ? 'seen' : 'outbound', log })
          if (!payload.skipCount) await broadcastStatus()
          sendResponse({ ok: true })
        } catch (err) {
          sendResponse({ ok: false, error: err.message })
        }
      })()
      return true
    }

    // ── Content script reports a skipped cycle ────────────────────────────
    case MSG.LOG_ATTEMPT: {
      ;(async () => {
        try {
          const { log } = await loadAll()
          await saveLogEntry({ tweet: null, replyText: null, kind: 'attempt', log, reason: payload.reason })
          sendResponse({ ok: true })
        } catch (err) {
          sendResponse({ ok: false, error: err.message })
        }
      })()
      return true
    }

    case MSG.LOG_FAILED: {
      ;(async () => {
        try {
          let { state, log } = await loadAll()
          state = checkDailyReset(state)
          state.failedCount = (state.failedCount || 0) + 1
          state.error = payload.reason || 'Reply failed'
          await setStorage({ [STORE.STATE]: state })
          await saveLogEntry({ tweet: payload.tweet || null, replyText: payload.replyText || null, kind: 'error', log, reason: payload.reason })
          await broadcastStatus()
          sendResponse({ ok: true })
        } catch (err) {
          sendResponse({ ok: false, error: err.message })
        }
      })()
      return true
    }

    case MSG.START_BOT: {
      ;(async () => {
        try {
          const { state } = await loadAll()
          state.isRunning  = true
          state.error      = null
          state.failedCount = 0   // fresh start = clear failure count
          await setStorage({ [STORE.STATE]: state })
          await broadcastStatus()  // content script starts its reply loop on STATUS_UPDATE
          sendResponse({ ok: true })
        } catch (err) {
          sendResponse({ ok: false, error: err.message })
        }
      })()
      return true
    }

    case MSG.STOP_BOT: {
      ;(async () => {
        try {
          await chrome.alarms.clear(ALARM_REPLYBACK)
          const { state } = await loadAll()
          state.isRunning = false
          state.error     = null   // clear stale errors when stopped
          await setStorage({ [STORE.STATE]: state })
          await broadcastStatus()
          sendResponse({ ok: true })
        } catch (err) {
          sendResponse({ ok: false, error: err.message })
        }
      })()
      return true
    }

    case MSG.SAVE_SETTINGS: {
      ;(async () => {
        try {
          await setStorage({ [STORE.SETTINGS]: payload })
          sendResponse({ ok: true })
        } catch (err) {
          sendResponse({ ok: false, error: err.message })
        }
      })()
      return true
    }

    case MSG.CLEAR_ERROR: {
      ;(async () => {
        try {
          const { state } = await loadAll()
          state.error = null
          await setStorage({ [STORE.STATE]: state })
          sendResponse({ ok: true })
        } catch (err) {
          sendResponse({ ok: false, error: err.message })
        }
      })()
      return true
    }

    case MSG.GET_STATUS: {
      ;(async () => {
        try {
          sendResponse(await buildStatusSnapshot())
        } catch (err) {
          sendResponse({ ok: false, error: err.message })
        }
      })()
      return true
    }

    case MSG.GET_LOG: {
      ;(async () => {
        try {
          const { log } = await loadAll()
          sendResponse(log)
        } catch (err) {
          sendResponse([])
        }
      })()
      return true
    }

    case MSG.CLEAR_LOG: {
      ;(async () => {
        try {
          await setStorage({ [STORE.LOG]: [] })
          await broadcastStatus()
          sendResponse({ ok: true })
        } catch (err) {
          sendResponse({ ok: false, error: err.message })
        }
      })()
      return true
    }

    case MSG.CORRECT_TWEET: {
      ;(async () => {
        try {
          const { settings } = await loadAll()
          if (!settings.apiKey && !settings.proxyUrl) {
            sendResponse({ ok: false, error: 'No API key configured.' })
            return
          }
          const correctedText = await callClaude(payload.text, settings, 'correction', settings.correctionPrompt)
          sendResponse({ ok: true, correctedText })
        } catch (err) {
          sendResponse({ ok: false, error: err.message })
        }
      })()
      return true
    }

    default:
      return false
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// REPLYBACK CYCLE — reply to replies on the user's own posts
// ═══════════════════════════════════════════════════════════════════════════════
async function enqueueReplyback(tweet) {
  const stored = await chrome.storage.local.get(STORE.REPLYBACK_QUEUE)
  const queue  = stored[STORE.REPLYBACK_QUEUE] || []

  if (queue.some((t) => t.id === tweet.id)) return

  queue.push(tweet)
  await setStorage({ [STORE.REPLYBACK_QUEUE]: queue })

  const existing = await chrome.alarms.get(ALARM_REPLYBACK)
  if (!existing) {
    const delayMs = randomBetween(DELAY.REPLYBACK_MIN_MS, DELAY.REPLYBACK_MAX_MS)
    chrome.alarms.create(ALARM_REPLYBACK, { delayInMinutes: delayMs / 60_000 })
  }
}

async function runReplybackCycle() {
  let { settings, state, log } = await loadAll()
  const stored = await chrome.storage.local.get(STORE.REPLYBACK_QUEUE)
  let queue    = stored[STORE.REPLYBACK_QUEUE] || []

  state = checkDailyReset(state)

  if (!state.isRunning || !queue.length) return
  if (!settings.autoReply) return
  if (state.replybackCount >= settings.replybackLimit) {
    state.error = `Reply-back limit of ${settings.replybackLimit} reached for today.`
    await setStorage({ [STORE.STATE]: state })
    await broadcastStatus()
    return
  }
  if (!settings.apiKey && !settings.proxyUrl) return

  const tweet = queue.shift()
  await setStorage({ [STORE.REPLYBACK_QUEUE]: queue })

  if (state.seenTweets[tweet.id]) {
    if (queue.length) {
      const delayMs = randomBetween(DELAY.REPLYBACK_MIN_MS, DELAY.REPLYBACK_MAX_MS)
      chrome.alarms.create(ALARM_REPLYBACK, { delayInMinutes: delayMs / 60_000 })
    }
    return
  }

  try {
    const replyText = await callClaude(tweet.text, settings, 'replyback')
    state.seenTweets[tweet.id] = Date.now()
    state.replybackCount++
    await setStorage({ [STORE.STATE]: state })
    await saveLogEntry({ tweet, replyText, kind: 'replyback', log })
    await sendReplyToTab({ tweetId: tweet.id, replyText, autoSubmit: settings.autoSubmit, tweet })
  } catch (err) {
    state.failedCount = (state.failedCount || 0) + 1
    state.error = err.message
    await setStorage({ [STORE.STATE]: state })
    const { log: freshLog } = await loadAll()
    await saveLogEntry({ tweet, replyText: null, kind: 'error', log: freshLog, reason: err.message })
  }

  await broadcastStatus()

  if (queue.length) {
    const delayMs = randomBetween(DELAY.REPLYBACK_MIN_MS, DELAY.REPLYBACK_MAX_MS)
    chrome.alarms.create(ALARM_REPLYBACK, { delayInMinutes: delayMs / 60_000 })
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function checkDailyReset(state) {
  const today = todayString()
  if (state.lastReset !== today) {
    state.outboundCount  = 0
    state.replybackCount = 0
    state.failedCount    = 0
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
    state.seenTweets = Object.fromEntries(
      Object.entries(state.seenTweets).filter(([, ts]) => ts > cutoff)
    )
    state.lastReset      = today
  }
  return state
}

async function saveLogEntry({ tweet, replyText, kind, log, reason }) {
  const entry = tweet
    ? {
        id:        tweet.id,
        handle:    tweet.handle,
        tweetText: tweet.text,
        reply:     replyText,
        timestamp: Date.now(),
        kind,
        reason,
      }
    : {
        id:        `attempt_${Date.now()}`,
        handle:    null,
        tweetText: null,
        reply:     null,
        timestamp: Date.now(),
        kind:      kind || 'attempt',
        reason,
      }
  const newLog = [entry, ...log].slice(0, 100)
  await setStorage({ [STORE.LOG]: newLog })
  await broadcastToTabs({ type: MSG.LOG_UPDATE, payload: { entry } })
}

async function sendReplyToTab({ tweetId, replyText, autoSubmit, tweet }) {
  const tabs = await chrome.tabs.query({ url: ['https://twitter.com/*', 'https://x.com/*'] })
  if (!tabs.length) return
  for (const tab of tabs) {
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, {
        type:    MSG.TYPE_REPLY,
        payload: { tweetId, replyText, autoSubmit },
      })
      if (resp && !resp.ok) {
        const { log: freshLog } = await loadAll()
        await saveLogEntry({ tweet, replyText: null, kind: 'error', log: freshLog, reason: resp.error })
      }
    } catch (_) {}
  }
}

// ─── Claude API ───────────────────────────────────────────────────────────────
async function callClaude(tweetText, settings, kind = 'outbound', customPrompt = '') {
  const { apiKey, proxyUrl, proxySecret } = settings

  let system, userContent

  if (kind === 'replyback') {
    system      = REPLYBACK_PROMPT
    userContent = `Their reply: "${tweetText}"`
  } else if (kind === 'correction') {
    system      = customPrompt.trim() || CORRECTION_PROMPT
    userContent = tweetText
  } else {
    system      = OUTBOUND_PROMPT
    userContent = `Tweet: "${tweetText}"`
  }

  const apiPayload = {
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 35,
    system,
    messages:   [{ role: 'user', content: userContent }],
  }

  const useProxy = !!proxyUrl?.trim()
  const url     = useProxy ? proxyUrl.trim() : 'https://api.anthropic.com/v1/messages'
  const headers = useProxy
    ? { 'x-proxy-secret': proxySecret, 'content-type': 'application/json' }
    : {
        'x-api-key':                              apiKey,
        'anthropic-version':                      '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type':                           'application/json',
      }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(apiPayload),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Claude API ${response.status}: ${body}`)
  }

  const data = await response.json()
  const text = data?.content?.[0]?.text?.trim()
  if (!text) throw new Error('Empty response from Claude API')
  return text
}

// ─── Status snapshot ─────────────────────────────────────────────────────────
async function buildStatusSnapshot() {
  const { settings, state } = await loadAll()
  return {
    isRunning:      state.isRunning,
    outboundCount:  state.outboundCount,
    replybackCount: state.replybackCount,
    failedCount:    state.failedCount || 0,
    outboundLimit:  settings.outboundLimit,
    replybackLimit: settings.replybackLimit,
    nextAlarmAt:    null,  // outbound loop lives in content script (setTimeout)
    error:          state.error,
    hasApiKey:      !!settings.apiKey || !!settings.proxyUrl,
    hasMyHandle:    !!settings.myHandle,
  }
}

// ─── Broadcast helpers ────────────────────────────────────────────────────────
async function broadcastStatus() {
  const snapshot = await buildStatusSnapshot()
  await broadcastToTabs({ type: MSG.STATUS_UPDATE, payload: snapshot })
}

async function broadcastToTabs(message) {
  const tabs = await chrome.tabs.query({
    url: ['https://twitter.com/*', 'https://x.com/*'],
  })
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, message).catch(() => {})
  }
}
