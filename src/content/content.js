/**
 * NoTweet — Content Script
 *
 * The outbound reply loop lives here (setTimeout-based) so it stays alive
 * as long as the Twitter tab is open — no chrome.alarms, no SW ephemerality.
 *
 * Flow:
 *   runReplyLoop() fires every 30–120 s
 *   → scans visible tweets
 *   → picks one that hasn't been seen and matches filters
 *   → asks background for a Claude reply (GENERATE_REPLY)
 *   → types it (and optionally submits)
 *   → tells background to log + update counts (LOG_OUTBOUND)
 *
 * Replybacks (someone replied to the user's own post) are still routed to
 * background via REPLY_TO_MY_POST — background handles the alarm + Claude call
 * and sends TYPE_REPLY back here to type the response.
 */

import { MSG, STORE } from '../shared/constants.js'
import { randomBetween, delay, todayString } from '../shared/utils.js'
import { createShadowHost } from './shadowMount.js'
import { startObserver } from './observer.js'
import { getTweets } from './observer.js'
import { typeReply, findTweetNode } from './typer.js'
import { mountUI } from '../ui/main.jsx'

// ─── State ────────────────────────────────────────────────────────────────────
let disconnectObserver   = null
let reactRoot            = null
let scrollTimerId        = null
let replyLoopTimer       = null
let composeObserver      = null
let composeWasOpen       = false
let isReplying           = false  // blocks scroll simulator while typing
let botComposeOpen       = false  // true when bot typed a reply and left compose box open (autoSubmit=false)
let loopRunning          = false  // mutex — prevents concurrent runReplyLoop instances
let composeCloseObserver = null   // single watchForComposeClose observer — prevents stacking
let lastErrorAt          = 0      // timestamp of last error; prevents initialize() from bypassing error backoff

const MIN_ERROR_BACKOFF_MS = 60_000  // don't restart loop within 60 s of an error via initialize()

// ─── Bootstrap ────────────────────────────────────────────────────────────────
function initialize() {
  disconnectObserver?.()
  const { shadow, mountPoint, styleEl } = createShadowHost()
  reactRoot = mountUI(shadow, mountPoint, styleEl)
  disconnectObserver = startObserver(onTweetsFound)
  startComposeObserver()
  chrome.storage.local.get(STORE.STATE, (result) => {
    if (result[STORE.STATE]?.isRunning) {
      startScrollSimulator()
      const errorCooldown = Date.now() - lastErrorAt < MIN_ERROR_BACKOFF_MS
      // Only start if nothing is already scheduled or running.
      // Removing stopReplyLoop() here preserves the 30-120s wait timer across
      // SPA navigations (e.g. x.com/compose/post → back), so the bot doesn't
      // fire a new reply immediately after each submission.
      if (!isReplying && !errorCooldown && replyLoopTimer === null && !loopRunning) {
        startReplyLoop()
      }
    }
  })
}

// ─── Tweet detection callback (replybacks + auto-like only) ───────────────────
// Outbound replies are picked directly in runReplyLoop — no push needed.
function onTweetsFound(tweets) {
  if (!tweets.length) return

  chrome.storage.local.get([STORE.SETTINGS, STORE.STATE], (result) => {
    const settings = result[STORE.SETTINGS] || {}
    const state    = result[STORE.STATE]    || {}
    const myHandle = (settings.myHandle || '').toLowerCase().replace(/^@/, '')

    for (const tweet of tweets) {
      if (myHandle && tweet.isReplyTo === myHandle) {
        chrome.runtime.sendMessage({
          type:    MSG.REPLY_TO_MY_POST,
          payload: { tweet: { id: tweet.id, text: tweet.text, handle: tweet.handle } },
        }).catch(() => {})
      }
    }

    if (state.isRunning && settings.autoLike) {
      likeTweetsWithDelay(tweets)
    }
  })
}

// ─── Auto-like helper ─────────────────────────────────────────────────────────
async function likeTweetsWithDelay(tweets) {
  for (const tweet of tweets) {
    const node = findTweetNode(tweet.id)
    if (node) {
      const likeBtn = node.querySelector('[data-testid="like"]')
      if (likeBtn) {
        likeBtn.click()
        await delay(randomBetween(500, 1500))
      }
    }
  }
}

// ─── Activity broadcaster ──────────────────────────────────────────────────────
function dispatchActivity(type, extra = {}) {
  window.dispatchEvent(new CustomEvent('notweet:activity', { detail: { type, ...extra } }))
}

// ─── Compose-close watcher ────────────────────────────────────────────────────
// Called after the bot types a reply with autoSubmit=false. Watches the DOM for
// tweetButtonInline to disappear (user submitted or dismissed), then clears the flag.
// Stored in composeCloseObserver so repeated calls disconnect the previous observer
// instead of stacking multiple observers.
function watchForComposeClose() {
  composeCloseObserver?.disconnect()
  composeCloseObserver = new MutationObserver(() => {
    if (!document.querySelector('[data-testid="tweetButtonInline"]')) {
      botComposeOpen = false
      dispatchActivity('idle')
      composeCloseObserver?.disconnect()
      composeCloseObserver = null
    }
  })
  composeCloseObserver.observe(document.body, { childList: true, subtree: true })
}

// ─── Outbound reply loop ───────────────────────────────────────────────────────
function startReplyLoop() {
  stopReplyLoop()
  chrome.storage.local.get(STORE.SETTINGS, (result) => {
    scheduleNextReply(false, result[STORE.SETTINGS] || {})
  })
}

function stopReplyLoop() {
  if (replyLoopTimer !== null) {
    clearTimeout(replyLoopTimer)
    replyLoopTimer = null
  }
  loopRunning = false
  dispatchActivity('idle')
}

async function runReplyLoop() {
  // Prevent concurrent instances (e.g. from SPA navigation calling initialize() multiple times)
  if (loopRunning) return
  loopRunning = true

  let settings = {}

  try {
    // If the bot left a compose box open for manual review, wait for the user to close it.
    if (botComposeOpen) {
      dispatchActivity('compose_open')
      replyLoopTimer = setTimeout(runReplyLoop, 5_000)
      return
    }

    const result = await chrome.storage.local.get([STORE.SETTINGS, STORE.STATE])
    settings = result[STORE.SETTINGS] || {}
    const state    = result[STORE.STATE]    || {}

    // Guards
    if (!state.isRunning)                       { scheduleNextReply(false, settings); return }
    if (!settings.autoReply)                    { scheduleNextReply(false, settings); return }
    if (!settings.apiKey && !settings.proxyUrl) { scheduleNextReply(false, settings); return }

    // Daily limit — stop the bot entirely when reached
    const today = todayString()
    const count = state.lastReset === today ? (state.outboundCount || 0) : 0
    if (count >= (settings.outboundLimit || 5)) {
      dispatchActivity('limit_reached')
      chrome.runtime.sendMessage({ type: MSG.STOP_BOT }).catch(() => {})
      return
    }

    // Scan visible tweets and filter to unseen candidates
    dispatchActivity('scanning')
    const allTweets  = getTweets()
    const candidates = allTweets.filter(t =>
      !state.seenTweets?.[t.id] && matchesFilters(t, settings)
    )

    if (!candidates.length) {
      dispatchActivity('scrolling')
      humanScroll()
      chrome.runtime.sendMessage({
        type:    MSG.LOG_ATTEMPT,
        payload: {
          reason: allTweets.length
            ? 'No tweets matched your filters — check keywords/accounts in Settings'
            : 'Scrolling to load more posts…',
        },
      }).catch(() => {})
      scheduleNextReply(false, settings)
      return
    }

    const tweet = candidates[0]

    // Block scroll simulator while we type (tweet must stay in DOM)
    isReplying = true
    try {
      const tweetNode = findTweetNode(tweet.id)
      if (!tweetNode) {
        scheduleNextReply(false, settings)
        return
      }

      // Ask background to call Claude
      dispatchActivity('generating')
      const resp = await chrome.runtime.sendMessage({
        type:    MSG.GENERATE_REPLY,
        payload: { tweetText: tweet.text, handle: tweet.handle },
      })

      if (!resp?.ok) {
        chrome.runtime.sendMessage({
          type:    MSG.LOG_FAILED,
          payload: { tweet, reason: `Claude error: ${resp?.error || 'unknown'}` },
        }).catch(() => {})

        if (resp?.fatal) {
          // Invalid API key — stop the bot entirely, no point retrying
          chrome.runtime.sendMessage({ type: MSG.STOP_BOT }).catch(() => {})
          return
        }

        // Mark tweet as seen so we don't hammer the same one on retry
        chrome.runtime.sendMessage({
          type:    MSG.LOG_OUTBOUND,
          payload: { tweet, replyText: null, skipCount: true },
        }).catch(() => {})

        scheduleNextReply(true, settings)  // longer backoff on error
        return
      }

      // Type reply — returns true if sent (or manual), false if autoSubmit failed
      dispatchActivity('typing')
      const sent = await typeReply(tweetNode, resp.replyText, settings.autoSubmit)

      if (sent && !settings.autoSubmit) {
        // Bot typed but left the compose box open — watch for user to close it
        botComposeOpen = true
        watchForComposeClose()
        chrome.runtime.sendMessage({
          type:    MSG.LOG_OUTBOUND,
          payload: { tweet, replyText: resp.replyText },
        }).catch(() => {})
      } else if (sent) {
        chrome.runtime.sendMessage({
          type:    MSG.LOG_OUTBOUND,
          payload: { tweet, replyText: resp.replyText },
        }).catch(() => {})
      } else {
        // autoSubmit=true but compose box didn't close — submit failed.
        // Block the loop so the next iteration doesn't try to open a new reply box
        // while this one is still open (which would cause typing into the wrong place).
        botComposeOpen = true
        watchForComposeClose()
        chrome.runtime.sendMessage({
          type:    MSG.LOG_OUTBOUND,
          payload: { tweet, replyText: resp.replyText, skipCount: true },
        }).catch(() => {})
        chrome.runtime.sendMessage({
          type:    MSG.LOG_FAILED,
          payload: { tweet, replyText: resp.replyText, reason: 'Submit button clicked but reply did not send — compose box stayed open.' },
        }).catch(() => {})
      }

    } finally {
      isReplying = false
    }

  } catch (err) {
    isReplying = false
    chrome.runtime.sendMessage({
      type:    MSG.LOG_FAILED,
      payload: { tweet: null, reason: `Unexpected error: ${err.message}` },
    }).catch(() => {})
  } finally {
    loopRunning = false
  }

  scheduleNextReply(false, settings ?? {})
}

function scheduleNextReply(isError = false, settings = {}) {
  if (isError) lastErrorAt = Date.now()
  let ms
  if (isError) {
    ms = randomBetween(180_000, 300_000)
  } else {
    const minMs = Math.max(1, parseInt(settings.delayMin, 10) || 2) * 60_000
    const maxMs = Math.max(minMs, parseInt(settings.delayMax, 10) || 3) * 60_000
    ms = randomBetween(minMs, maxMs)
  }
  replyLoopTimer = setTimeout(runReplyLoop, ms)
  dispatchActivity('waiting', { ms })

  // Scroll during the wait so new tweets load naturally
  if (!isError) {
    const scroll1 = randomBetween(15_000, Math.min(40_000, ms * 0.3))
    const scroll2 = randomBetween(Math.min(60_000, ms * 0.5), Math.min(100_000, ms * 0.75))
    setTimeout(() => { if (!isReplying) humanScroll() }, scroll1)
    if (ms > 60_000) setTimeout(() => { if (!isReplying) humanScroll() }, scroll2)
  }
}

// Mirrors matchesFilters in background.js
function matchesFilters(tweet, settings) {
  // Never reply to the user's own tweets
  const myHandle = (settings.myHandle || '').toLowerCase().replace(/^@/, '')
  if (myHandle && tweet.handle.toLowerCase() === myHandle) return false

  const keywords = settings.keywords || []
  const accounts = settings.accounts || []
  if (!keywords.length && !accounts.length) return true
  const textLower   = tweet.text.toLowerCase()
  const handleLower = tweet.handle.toLowerCase()
  return (
    keywords.some(kw  => textLower.includes(kw.toLowerCase())) ||
    accounts.some(acc => handleLower === acc.toLowerCase().replace(/^@/, ''))
  )
}

// ─── Message listener ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type, payload } = message

  // Replyback: background typed the reply via TYPE_REPLY (replyback flow)
  if (type === MSG.TYPE_REPLY) {
    ;(async () => {
      isReplying = true
      try {
        const { tweetId, replyText, autoSubmit } = payload
        let tweetNode = findTweetNode(tweetId)

        if (!tweetNode) {
          window.scrollTo({ top: 0, behavior: 'smooth' })
          await delay(2500)
          tweetNode = findTweetNode(tweetId)
        }

        if (!tweetNode) {
          sendResponse({ ok: false, error: 'Tweet scrolled out of view' })
          return
        }
        await typeReply(tweetNode, replyText, autoSubmit)
        sendResponse({ ok: true })
      } catch (err) {
        sendResponse({ ok: false, error: err.message })
      } finally {
        isReplying = false
      }
    })()
    return true
  }

  if (type === MSG.STATUS_UPDATE) {
    if (payload?.isRunning) {
      startScrollSimulator()
      startReplyLoop()
    } else {
      stopScrollSimulator()
      stopReplyLoop()
    }
  }
})

// ─── Human-like scroll ────────────────────────────────────────────────────────
async function humanScroll() {
  if (isReplying) return
  const active = document.activeElement
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return

  const steps = randomBetween(3, 6)
  for (let i = 0; i < steps; i++) {
    await delay(randomBetween(900, 3200))

    if (Math.random() < 0.25 && i > 0) {
      window.scrollBy({ top: -randomBetween(80, 160), behavior: 'smooth' })
      await delay(randomBetween(600, 1400))
    }

    window.scrollBy({ top: randomBetween(160, 380), behavior: 'smooth' })
  }
}

// ─── Background scroll simulator ─────────────────────────────────────────────
function startScrollSimulator() {
  stopScrollSimulator()

  function scheduleScroll() {
    const waitMs = randomBetween(20_000, 90_000)
    scrollTimerId = setTimeout(() => {
      humanScroll()
      scheduleScroll()
    }, waitMs)
  }

  scheduleScroll()
}

function stopScrollSimulator() {
  if (scrollTimerId !== null) {
    clearTimeout(scrollTimerId)
    scrollTimerId = null
  }
}

// ─── Compose-box observer ─────────────────────────────────────────────────────
const COMPOSE_SELECTOR = '[data-testid="tweetTextarea_0"]'

function startComposeObserver() {
  composeObserver?.disconnect()
  composeWasOpen = false

  composeObserver = new MutationObserver(() => {
    const isOpen = !!document.querySelector(COMPOSE_SELECTOR)
    if (isOpen !== composeWasOpen) {
      composeWasOpen = isOpen
      window.dispatchEvent(new CustomEvent('notweet:compose', { detail: { open: isOpen } }))
    }
  })

  composeObserver.observe(document.body, { childList: true, subtree: true })
}

// ─── SPA navigation ───────────────────────────────────────────────────────────
;(function patchHistory() {
  const original = history.pushState.bind(history)
  history.pushState = function (...args) {
    original(...args)
    setTimeout(initialize, 600)
  }
  window.addEventListener('popstate', () => setTimeout(initialize, 600))
})()

// ─── First run ────────────────────────────────────────────────────────────────
initialize()
