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
        await enqueueReplyback(payload.tweet)
        sendResponse({ ok: true })
      })()
      return true
    }

    // ── Content script asks Claude for a reply text ────────────────────────
    case MSG.GENERATE_REPLY: {
      ;(async () => {
        const { settings } = await loadAll()
        if (!settings.apiKey && !settings.proxyUrl) {
          sendResponse({ ok: false, error: 'No API key configured.' })
          return
        }
        try {
          const replyText = await callClaude(payload.tweetText, settings, 'outbound')
          sendResponse({ ok: true, replyText })
        } catch (err) {
          sendResponse({ ok: false, error: err.message })
        }
      })()
      return true
    }

    // ── Content script reports a successful outbound reply ─────────────────
    case MSG.LOG_OUTBOUND: {
      ;(async () => {
        let { state, log } = await loadAll()
        state = checkDailyReset(state)
        state.seenTweets[payload.tweet.id] = true
        state.outboundCount++
        state.error = null
        await setStorage({ [STORE.STATE]: state })
        await saveLogEntry({ tweet: payload.tweet, replyText: payload.replyText, kind: 'outbound', log })
        await broadcastStatus()
        sendResponse({ ok: true })
      })()
      return true
    }

    // ── Content script reports a skipped cycle ────────────────────────────
    case MSG.LOG_ATTEMPT: {
      ;(async () => {
        const { log } = await loadAll()
        await saveLogEntry({ tweet: null, replyText: null, kind: 'attempt', log, reason: payload.reason })
        sendResponse({ ok: true })
      })()
      return true
    }

    case MSG.START_BOT: {
      ;(async () => {
        const { state } = await loadAll()
        state.isRunning = true
        state.error = null
        await setStorage({ [STORE.STATE]: state })
        await broadcastStatus()  // content script starts its reply loop on STATUS_UPDATE
        sendResponse({ ok: true })
      })()
      return true
    }

    case MSG.STOP_BOT: {
      ;(async () => {
        await chrome.alarms.clear(ALARM_REPLYBACK)
        const { state } = await loadAll()
        state.isRunning = false
        await setStorage({ [STORE.STATE]: state })
        await broadcastStatus()
        sendResponse({ ok: true })
      })()
      return true
    }

    case MSG.SAVE_SETTINGS: {
      ;(async () => {
        await setStorage({ [STORE.SETTINGS]: payload })
        sendResponse({ ok: true })
      })()
      return true
    }

    case MSG.GET_STATUS: {
      ;(async () => sendResponse(await buildStatusSnapshot()))()
      return true
    }

    case MSG.GET_LOG: {
      ;(async () => {
        const { log } = await loadAll()
        sendResponse(log)
      })()
      return true
    }

    case MSG.CLEAR_LOG: {
      ;(async () => {
        await setStorage({ [STORE.LOG]: [] })
        await broadcastStatus()
        sendResponse({ ok: true })
      })()
      return true
    }

    case MSG.CORRECT_TWEET: {
      ;(async () => {
        const { settings } = await loadAll()
        if (!settings.apiKey && !settings.proxyUrl) {
          sendResponse({ ok: false, error: 'No API key configured.' })
          return
        }
        try {
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
    state.seenTweets[tweet.id] = true
    state.replybackCount++
    await setStorage({ [STORE.STATE]: state })
    await saveLogEntry({ tweet, replyText, kind: 'replyback', log })
    await sendReplyToTab({ tweetId: tweet.id, replyText, autoSubmit: settings.autoSubmit, tweet })
  } catch (err) {
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
    state.seenTweets     = {}
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
    system = `You are a founder replying to someone who commented on your tweet. You've been building in public for years and have real scar tissue from it.

Write a reply that sounds like you typed it on your phone between tasks. Raw, direct, no polish.

Rules:
- 2–3 lines max, can be as short as one punchy line
- Write like you're texting a peer — lowercase is fine, skip punctuation sometimes
- Draw from real founder experience: shipping late, losing customers, bad launches, small wins that felt huge
- Be specific to what they actually said — don't give generic advice
- Occasionally drop a word or use "lol" / "tbh" / "ngl" naturally — not forced
- NEVER start with "Great", "Love this", "So true", "Absolutely", or any hype opener
- No hashtags, no emojis unless they feel completely natural
- No quotes around your reply, no labels, just the raw text`
    userContent = `Their reply: "${tweetText}"`
  } else if (kind === 'correction') {
    system = customPrompt.trim() ||
      'Fix grammar, improve clarity, and make this tweet more engaging. Keep the same tone and meaning. Return only the improved tweet text — no labels, no quotes, no explanation.'
    userContent = tweetText
  } else {
    system = `You are a founder who has been building products for years. You reply to tweets on Twitter like a real person — not a content creator, not a motivational account, just someone with actual experience who has something worth saying.

Write a reply that sounds like it was typed quickly, from memory, from real experience.

Rules:
- 2–3 lines max. Can be one line if that's all it needs
- Lowercase is fine. Missing punctuation is fine. Imperfect grammar is fine
- Sound like you've actually lived this: shipping at 3am, losing users, making $0 for months, finally getting traction
- Be specific to what the tweet is actually saying — not generic
- Occasionally throw in a small natural typo or shorthand (ur, tbh, ngl, lol) — don't overdo it
- NEVER open with "Great post", "Love this", "So true", "This is so good", "Absolutely", or any variation
- No hashtags. No emojis unless it's a single one that fits naturally
- No quotes, no labels, no formatting — just the reply text and nothing else`
    userContent = `Tweet: "${tweetText}"`
  }

  const apiPayload = {
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 80,
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
