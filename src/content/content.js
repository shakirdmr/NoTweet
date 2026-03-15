/**
 * NoTweet — Content Script
 *
 * Tweet routing:
 *   tweet.isReplyTo === myHandle  →  MSG.REPLY_TO_MY_POST  (instant replyback)
 *   everything else               →  MSG.TWEETS_AVAILABLE  (outbound queue)
 */

import { MSG, STORE } from '../shared/constants.js'
import { randomBetween, delay } from '../shared/utils.js'
import { createShadowHost } from './shadowMount.js'
import { startObserver, scanCurrentTweets } from './observer.js'
import { typeReply, findTweetNode } from './typer.js'
import { mountUI }          from '../ui/main.jsx'

// ─── State ────────────────────────────────────────────────────────────────────
let disconnectObserver  = null
let reactRoot           = null
let scrollTimerId       = null
let composeObserver     = null
let composeWasOpen      = false

// ─── Bootstrap ────────────────────────────────────────────────────────────────
function initialize() {
  disconnectObserver?.()
  const { shadow, mountPoint, styleEl } = createShadowHost()
  reactRoot = mountUI(shadow, mountPoint, styleEl)
  disconnectObserver = startObserver(onTweetsFound)
  startComposeObserver()
  // Start scroll simulator if bot was already running before this page load
  chrome.storage.local.get(STORE.STATE, (result) => {
    if (result[STORE.STATE]?.isRunning) startScrollSimulator()
  })
}

// ─── Tweet detection callback ─────────────────────────────────────────────────
function onTweetsFound(tweets) {
  if (!tweets.length) return

  // Read settings + state together to route reply-backs and trigger likes.
  chrome.storage.local.get([STORE.SETTINGS, STORE.STATE], (result) => {
    const settings = result[STORE.SETTINGS] || {}
    const state    = result[STORE.STATE]    || {}
    const myHandle = (settings.myHandle || '').toLowerCase().replace(/^@/, '')

    const outbound   = {}  // tweetId → tweet  (for normal community replies)
    const replybacks = []  // tweets replying to myHandle

    for (const tweet of tweets) {
      if (myHandle && tweet.isReplyTo === myHandle) {
        replybacks.push(tweet)
      } else {
        outbound[tweet.id] = { id: tweet.id, text: tweet.text, handle: tweet.handle }
      }
    }

    // Send outbound tweets to the standard queue
    if (Object.keys(outbound).length) {
      chrome.runtime.sendMessage({
        type:    MSG.TWEETS_AVAILABLE,
        payload: { tweetIds: Object.keys(outbound), tweetMap: outbound },
      }).catch(() => {})
    }

    // Send each replyback individually for instant processing
    for (const tweet of replybacks) {
      chrome.runtime.sendMessage({
        type:    MSG.REPLY_TO_MY_POST,
        payload: { tweet: { id: tweet.id, text: tweet.text, handle: tweet.handle } },
      }).catch(() => {})
    }

    // Auto-like: only when bot is running and autoLike is enabled
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

// ─── Message listener ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type, payload } = message

  if (type === MSG.TYPE_REPLY) {
    ;(async () => {
      const { tweetId, replyText, autoSubmit } = payload
      let tweetNode = findTweetNode(tweetId)

      // Twitter's virtual list removes off-screen tweets from the DOM.
      // If the tweet scrolled away during the 30-120s reply delay, scroll
      // back to the top so Twitter re-renders the feed, then retry once.
      if (!tweetNode) {
        window.scrollTo({ top: 0, behavior: 'smooth' })
        await delay(1200)
        tweetNode = findTweetNode(tweetId)
      }

      if (!tweetNode) {
        sendResponse({ ok: false, error: 'Tweet scrolled out of view — will retry next cycle' })
        return
      }
      try {
        await typeReply(tweetNode, replyText, autoSubmit)
        sendResponse({ ok: true })
      } catch (err) {
        sendResponse({ ok: false, error: err.message })
      }
    })()
    return true
  }

  if (message?.type === MSG.STATUS_UPDATE) {
    message.payload?.isRunning ? startScrollSimulator() : stopScrollSimulator()
  }

  if (type === MSG.LOAD_MORE_TWEETS) {
    humanScroll() // fire-and-forget — spreads over several seconds naturally
    sendResponse({ ok: true })
  }

  if (type === MSG.RESCAN_TWEETS) {
    // Service worker restarted and lost its in-memory queue — re-send all
    // currently visible tweets without waiting for new DOM mutations.
    scanCurrentTweets(onTweetsFound)
    sendResponse({ ok: true })
  }
})

// ─── Human-like scroll (used by LOAD_MORE_TWEETS and the simulator) ───────────
async function humanScroll() {
  const active = document.activeElement
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return

  const steps = randomBetween(3, 6)
  for (let i = 0; i < steps; i++) {
    // Pause first — a human reads before scrolling
    await delay(randomBetween(900, 3200))

    // 25% chance of a small upward scroll (re-reading behaviour)
    if (Math.random() < 0.25 && i > 0) {
      window.scrollBy({ top: -randomBetween(80, 160), behavior: 'smooth' })
      await delay(randomBetween(600, 1400))
    }

    // Short downward scroll — humans move in small steps, not full pages
    window.scrollBy({ top: randomBetween(160, 380), behavior: 'smooth' })
  }
}

// ─── Background scroll simulator (keeps page fresh while bot runs) ────────────
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
// Watches for Twitter's tweet compose textarea to appear/disappear and fires
// a custom window event. App.jsx listens for this to show the ComposeBar.
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
