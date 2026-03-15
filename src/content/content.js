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
let disconnectObserver  = null
let reactRoot           = null
let scrollTimerId       = null
let replyLoopTimer      = null
let composeObserver     = null
let composeWasOpen      = false
let isReplying          = false  // blocks scroll simulator while typing

// ─── Bootstrap ────────────────────────────────────────────────────────────────
function initialize() {
  stopReplyLoop()
  disconnectObserver?.()
  const { shadow, mountPoint, styleEl } = createShadowHost()
  reactRoot = mountUI(shadow, mountPoint, styleEl)
  disconnectObserver = startObserver(onTweetsFound)
  startComposeObserver()
  // Restart loops if bot was already running before this page navigation
  chrome.storage.local.get(STORE.STATE, (result) => {
    if (result[STORE.STATE]?.isRunning) {
      startScrollSimulator()
      startReplyLoop()
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

// ─── Outbound reply loop ───────────────────────────────────────────────────────
function startReplyLoop() {
  stopReplyLoop()
  runReplyLoop()
}

function stopReplyLoop() {
  if (replyLoopTimer !== null) {
    clearTimeout(replyLoopTimer)
    replyLoopTimer = null
  }
}

async function runReplyLoop() {
  try {
    const result   = await chrome.storage.local.get([STORE.SETTINGS, STORE.STATE])
    const settings = result[STORE.SETTINGS] || {}
    const state    = result[STORE.STATE]    || {}

    // Guards
    if (!state.isRunning)                       { scheduleNextReply(); return }
    if (!settings.autoReply)                    { scheduleNextReply(); return }
    if (!settings.apiKey && !settings.proxyUrl) { scheduleNextReply(); return }

    // Daily limit — account for midnight reset
    const today = todayString()
    const count = state.lastReset === today ? (state.outboundCount || 0) : 0
    if (count >= (settings.outboundLimit || 5)) return  // limit hit — loop stops until reset

    // Scan visible tweets and filter to unseen candidates
    const allTweets  = getTweets()
    const candidates = allTweets.filter(t =>
      !state.seenTweets?.[t.id] && matchesFilters(t, settings)
    )

    if (!candidates.length) {
      humanScroll()  // scroll to load more tweets
      chrome.runtime.sendMessage({
        type:    MSG.LOG_ATTEMPT,
        payload: {
          reason: allTweets.length
            ? 'No tweets matched your filters — check keywords/accounts in Settings'
            : 'Scrolling to load more posts…',
        },
      }).catch(() => {})
      scheduleNextReply()
      return
    }

    const tweet = candidates[0]

    // Block scroll simulator while we type (tweet must stay in DOM)
    isReplying = true
    try {
      const tweetNode = findTweetNode(tweet.id)
      if (!tweetNode) {
        // Shouldn't happen (tweet just came from DOM scan), but guard anyway
        scheduleNextReply()
        return
      }

      // Ask background to call Claude
      const resp = await chrome.runtime.sendMessage({
        type:    MSG.GENERATE_REPLY,
        payload: { tweetText: tweet.text, handle: tweet.handle },
      })

      if (!resp?.ok) {
        chrome.runtime.sendMessage({
          type:    MSG.LOG_ATTEMPT,
          payload: { reason: `Claude error: ${resp?.error || 'unknown'}` },
        }).catch(() => {})
        scheduleNextReply()
        return
      }

      // Type reply — typer.js has a built-in 1–2.5s pre-submit pause before clicking send
      await typeReply(tweetNode, resp.replyText, settings.autoSubmit)

      // Tell background to update counts and write the log entry
      chrome.runtime.sendMessage({
        type:    MSG.LOG_OUTBOUND,
        payload: { tweet, replyText: resp.replyText },
      }).catch(() => {})

    } finally {
      isReplying = false
    }

  } catch (err) {
    isReplying = false
    chrome.runtime.sendMessage({
      type:    MSG.LOG_ATTEMPT,
      payload: { reason: `Loop error: ${err.message}` },
    }).catch(() => {})
  }

  scheduleNextReply()
}

function scheduleNextReply() {
  const ms = randomBetween(30_000, 120_000)
  replyLoopTimer = setTimeout(runReplyLoop, ms)
}

// Mirrors matchesFilters in background.js
function matchesFilters(tweet, settings) {
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
