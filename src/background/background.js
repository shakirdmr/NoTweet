/**
 * NoTweet — Background Service Worker (MV3)
 *
 * Two independent reply flows:
 *
 * 1. OUTBOUND  — replies to community / timeline tweets
 *    • Triggered by TWEETS_AVAILABLE from content script
 *    • Respects outboundLimit per night
 *    • Random 30–120 s delay between replies (chrome alarm)
 *
 * 2. REPLYBACK — instant reply when someone replies to the user's own post
 *    • Triggered by REPLY_TO_MY_POST from content script
 *    • Respects replybackLimit per night
 *    • Short 5–15 s delay (feels natural, not robotic)
 *    • Queue persisted in chrome.storage.local (survives service-worker sleep)
 */

import { MSG, STORE, ALARM_OUTBOUND, ALARM_REPLYBACK, DELAY } from '../shared/constants.js'
import {
  loadAll, setStorage, ensureDefaults,
  randomBetween, todayString,
} from '../shared/utils.js'

// ─── In-memory outbound tweet queue ──────────────────────────────────────────
// Wiped on service-worker sleep — fine, content script repopulates continuously.
let pendingTweets = new Map()
let currentTabId  = null

// ─── Init ─────────────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(ensureDefaults)
chrome.runtime.onStartup.addListener(ensureDefaults)

// ─── Alarm handler ────────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_OUTBOUND)  await runOutboundCycle()
  if (alarm.name === ALARM_REPLYBACK) await runReplybackCycle()
})

// ─── Message handler ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message

  switch (type) {
    // ── New community tweets spotted in DOM ────────────────────────────────
    case MSG.TWEETS_AVAILABLE: {
      if (sender.tab?.id) currentTabId = sender.tab.id
      for (const [id, data] of Object.entries(payload.tweetMap)) {
        if (!pendingTweets.has(id)) pendingTweets.set(id, data)
      }
      sendResponse({ ok: true })
      return false
    }

    // ── Someone replied to the user's own post ─────────────────────────────
    case MSG.REPLY_TO_MY_POST: {
      if (sender.tab?.id) currentTabId = sender.tab.id
      ;(async () => {
        await enqueueReplyback(payload.tweet)
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
        await scheduleOutbound()
        await broadcastStatus()
        sendResponse({ ok: true })
      })()
      return true
    }

    case MSG.STOP_BOT: {
      ;(async () => {
        await chrome.alarms.clear(ALARM_OUTBOUND)
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
// OUTBOUND CYCLE — community / timeline replies
// ═══════════════════════════════════════════════════════════════════════════════
async function runOutboundCycle() {
  let { settings, state, log } = await loadAll()

  state = checkDailyReset(state)

  if (!state.isRunning) return
  if (!settings.autoReply) {
    const { log } = await loadAll()
    await saveLogEntry({
      tweet: null, replyText: null, kind: 'attempt', log,
      reason: 'Auto-reply is off — turn it on in the Status tab to enable replies',
    })
    await scheduleOutbound()
    return
  }
  if (state.outboundCount >= settings.outboundLimit) {
    state.error = `Outbound limit of ${settings.outboundLimit} reached for today.`
    await setStorage({ [STORE.STATE]: state })
    await broadcastStatus()
    return
  }
  if (!settings.apiKey && !settings.proxyUrl) {
    state.error = 'No Claude API key configured.'
    await setStorage({ [STORE.STATE]: state })
    await broadcastStatus()
    await scheduleOutbound()
    return
  }

  const tweet = pickTweet(pendingTweets, settings, state.seenTweets)
  if (!tweet) {
    // Queue empty — first try to recover already-visible tweets (lost on SW restart),
    // then ask the content script to scroll and load more.
    if (pendingTweets.size === 0) {
      await rescanTweets()
      await requestMoreTweets()
    }
    const { log } = await loadAll()
    await saveLogEntry({
      tweet: null, replyText: null, kind: 'attempt', log,
      reason: pendingTweets.size === 0
        ? 'Scrolling to load more posts…'
        : 'No tweets matched your filters — check keywords/accounts in Settings',
    })
    await scheduleOutbound()
    return
  }

  state.error = null

  try {
    const replyText = await callClaude(tweet.text, settings, 'outbound')
    state.seenTweets[tweet.id] = true
    state.outboundCount++
    await setStorage({ [STORE.STATE]: state })
    await saveLogEntry({ tweet, replyText, kind: 'outbound', log })
    await sendReplyToTab({ tweetId: tweet.id, replyText, handle: tweet.handle, autoSubmit: settings.autoSubmit, tweet })
  } catch (err) {
    state.error = err.message
    await setStorage({ [STORE.STATE]: state })
    const { log: freshLog } = await loadAll()
    await saveLogEntry({ tweet, replyText: null, kind: 'error', log: freshLog, reason: err.message })
  }

  await broadcastStatus()
  await scheduleOutbound()
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPLYBACK CYCLE — reply to replies on the user's own posts
// ═══════════════════════════════════════════════════════════════════════════════
async function enqueueReplyback(tweet) {
  const stored = await chrome.storage.local.get(STORE.REPLYBACK_QUEUE)
  const queue  = stored[STORE.REPLYBACK_QUEUE] || []

  // Don't enqueue the same tweet twice
  if (queue.some((t) => t.id === tweet.id)) return

  queue.push(tweet)
  await setStorage({ [STORE.REPLYBACK_QUEUE]: queue })

  // Schedule a replyback alarm if one isn't already pending
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

  // Pop the first item
  const tweet = queue.shift()
  await setStorage({ [STORE.REPLYBACK_QUEUE]: queue })

  // Check we haven't already replied
  if (state.seenTweets[tweet.id]) {
    // Still items? Reschedule
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
    await sendReplyToTab({ tweetId: tweet.id, replyText, handle: tweet.handle, autoSubmit: settings.autoSubmit, tweet })
  } catch (err) {
    state.error = err.message
    await setStorage({ [STORE.STATE]: state })
    const { log: freshLog } = await loadAll()
    await saveLogEntry({ tweet, replyText: null, kind: 'error', log: freshLog, reason: err.message })
  }

  await broadcastStatus()

  // If more items in queue, schedule next replyback
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
    // Fire-and-forget persist; caller will setStorage with full state
  }
  return state
}

function pickTweet(queue, settings, seenTweets) {
  for (const [id, tweet] of queue.entries()) {
    if (seenTweets[id]) { queue.delete(id); continue }
    if (matchesFilters(tweet, settings)) { queue.delete(id); return tweet }
  }
  return null
}

function matchesFilters(tweet, settings) {
  const { keywords, accounts } = settings
  if (!keywords.length && !accounts.length) return true

  const textLower   = tweet.text.toLowerCase()
  const handleLower = tweet.handle.toLowerCase()

  return (
    keywords.some((kw) => textLower.includes(kw.toLowerCase())) ||
    accounts.some((acc) => handleLower === acc.toLowerCase().replace(/^@/, ''))
  )
}

async function saveLogEntry({ tweet, replyText, kind, log, reason }) {
  const entry = tweet
    ? {
        id:        tweet.id,
        handle:    tweet.handle,
        tweetText: tweet.text,
        reply:     replyText,
        timestamp: Date.now(),
        kind,      // 'outbound' | 'replyback' | 'error'
        reason,    // populated for 'error' entries
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

async function sendReplyToTab({ tweetId, replyText, handle, autoSubmit, tweet, log }) {
  let tabId = currentTabId
  if (tabId === null) {
    // Service worker may have been restarted — find any active Twitter/X tab
    const tabs = await chrome.tabs.query({ url: ['https://twitter.com/*', 'https://x.com/*'] })
    if (!tabs.length) return
    tabId = tabs[0].id
    currentTabId = tabId
  }
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type:    MSG.TYPE_REPLY,
      payload: { tweetId, replyText, handle, autoSubmit },
    })
    if (response && !response.ok) {
      const { log: freshLog } = await loadAll()
      await saveLogEntry({ tweet, replyText: null, kind: 'error', log: freshLog, reason: response.error })
    }
  } catch (err) {
    // Tab closed or content script not ready — ignore silently
  }
}

async function rescanTweets() {
  let tabId = currentTabId
  if (tabId === null) {
    const tabs = await chrome.tabs.query({ url: ['https://twitter.com/*', 'https://x.com/*'] })
    if (!tabs.length) return
    tabId = tabs[0].id
    currentTabId = tabId
  }
  chrome.tabs.sendMessage(tabId, { type: MSG.RESCAN_TWEETS }).catch(() => {})
}

async function requestMoreTweets() {
  let tabId = currentTabId
  if (tabId === null) {
    const tabs = await chrome.tabs.query({ url: ['https://twitter.com/*', 'https://x.com/*'] })
    if (!tabs.length) return
    tabId = tabs[0].id
    currentTabId = tabId
  }
  chrome.tabs.sendMessage(tabId, { type: MSG.LOAD_MORE_TWEETS }).catch(() => {})
}

async function scheduleOutbound() {
  const delaySec = randomBetween(DELAY.MIN_BETWEEN_REPLIES, DELAY.MAX_BETWEEN_REPLIES)
  await chrome.alarms.clear(ALARM_OUTBOUND)
  chrome.alarms.create(ALARM_OUTBOUND, { delayInMinutes: delaySec / 60 })
}

// ─── Claude API ───────────────────────────────────────────────────────────────
async function callClaude(tweetText, settings, kind = 'outbound', customPrompt = '') {
  const { apiKey, proxyUrl, proxySecret } = settings

  let prompt
  if (kind === 'replyback') {
    prompt = `Someone replied to your tweet. Write a short, warm, conversational reply back to them.\n\nTheir reply:\n"${tweetText}"\n\nYour reply:`
  } else if (kind === 'correction') {
    const instruction = customPrompt.trim() ||
      'Fix grammar, improve clarity, and make this tweet more engaging. Keep the same tone and meaning. Return only the improved tweet text, nothing else.'
    prompt = `${instruction}\n\nTweet:\n"${tweetText}"\n\nImproved tweet:`
  } else {
    prompt = `Write a short friendly reply to this tweet.\n\nTweet:\n"${tweetText}"\n\nReply:`
  }

  const payload = {
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 150,
    messages:   [{ role: 'user', content: prompt }],
  }

  // Use proxy if configured — keeps the real API key off the browser
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
    body: JSON.stringify(payload),
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
  const alarm = await chrome.alarms.get(ALARM_OUTBOUND)
  return {
    isRunning:      state.isRunning,
    outboundCount:  state.outboundCount,
    replybackCount: state.replybackCount,
    outboundLimit:  settings.outboundLimit,
    replybackLimit: settings.replybackLimit,
    nextAlarmAt:    alarm ? alarm.scheduledTime : null,
    error:          state.error,
    hasApiKey:      !!settings.apiKey && !settings.proxyUrl || !!settings.proxyUrl,
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
