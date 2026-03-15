/**
 * MutationObserver-based tweet detector.
 *
 * Each detected tweet now includes an `isReplyTo` field:
 *   null          → original tweet (not a reply)
 *   'somehandle'  → this tweet is a reply to @somehandle
 *
 * content.js uses `isReplyTo` to route tweets:
 *   isReplyTo === myHandle  →  REPLY_TO_MY_POST  (instant replyback)
 *   otherwise               →  TWEETS_AVAILABLE  (outbound queue)
 */

const TWEET_SELECTOR = 'article[data-testid="tweet"]'
const DEBOUNCE_MS    = 300

export function startObserver(onTweetsFound) {
  let timer = null

  const observer = new MutationObserver((mutations) => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      const newNodes = []

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue
          if (node.matches?.(TWEET_SELECTOR)) newNodes.push(node)
          const nested = node.querySelectorAll?.(TWEET_SELECTOR)
          if (nested?.length) newNodes.push(...nested)
        }
      }

      if (!newNodes.length) return
      const extracted = extractTweetData(newNodes)
      if (extracted.length) onTweetsFound(extracted)
    }, DEBOUNCE_MS)
  })

  observer.observe(document.body, { childList: true, subtree: true })

  // Scan tweets already in the DOM at startup (observer only catches future mutations)
  const existing = document.querySelectorAll(TWEET_SELECTOR)
  if (existing.length) {
    const extracted = extractTweetData([...existing])
    if (extracted.length) onTweetsFound(extracted)
  }

  return () => observer.disconnect()
}

/**
 * Force-scans all tweets currently visible in the DOM and calls onTweetsFound.
 * Use this after a service-worker restart wipes the in-memory queue, since
 * already-rendered tweets won't re-trigger the MutationObserver.
 */
export function scanCurrentTweets(onTweetsFound) {
  const nodes = document.querySelectorAll(TWEET_SELECTOR)
  if (!nodes.length) return
  const extracted = extractTweetData([...nodes])
  if (extracted.length) onTweetsFound(extracted)
}

/**
 * Synchronously returns all tweet data currently visible in the DOM.
 * Used by the GET_TWEETS message handler for pull-based fetching.
 */
export function getTweets() {
  const nodes = document.querySelectorAll(TWEET_SELECTOR)
  return nodes.length ? extractTweetData([...nodes]) : []
}

// ─── Data extraction ──────────────────────────────────────────────────────────
function extractTweetData(nodes) {
  const seen    = new Set()
  const results = []

  for (const node of nodes) {
    const data = parseTweetNode(node)
    if (!data || seen.has(data.id)) continue
    seen.add(data.id)
    results.push(data)
  }
  return results
}

function parseTweetNode(node) {
  // Tweet ID from permalink
  const statusLink = node.querySelector('a[href*="/status/"]')
  const match      = statusLink?.href.match(/\/status\/(\d+)/)
  if (!match) return null
  const id = match[1]

  // Tweet text
  const textEl = node.querySelector('[data-testid="tweetText"]')
  const text   = textEl?.innerText?.trim() || ''
  if (!text) return null

  // Author handle
  const handleLink = node.querySelector('[data-testid="User-Name"] a[href^="/"]')
  const handle     = handleLink?.href.match(/\/([^/?]+)$/)?.[1] || ''

  // Reply context — who is this tweet replying to?
  const isReplyTo = detectReplyTo(node)

  return { id, text, handle, isReplyTo }
}

/**
 * Detects the "Replying to @handle" context on a tweet.
 * Twitter renders this as a div containing the text "Replying to" and
 * one or more @handle links, positioned above the tweet text.
 *
 * Returns the handle string (no @) or null if this is not a reply.
 */
function detectReplyTo(node) {
  // Walk all <a> elements and look for ones that sit inside a
  // "Replying to" context. The parent container typically has text
  // that contains "Replying to" somewhere nearby.
  const allLinks = node.querySelectorAll('a[href^="/"]')

  for (const link of allLinks) {
    // Skip links that are the tweet permalink or media
    const href = link.getAttribute('href') || ''
    if (href.includes('/status/') || href.includes('/photo/')) continue

    // Check if a nearby ancestor (within 3 levels) contains "Replying to"
    let el = link.parentElement
    for (let depth = 0; depth < 4; depth++) {
      if (!el) break
      if (el.textContent?.includes('Replying to')) {
        // Extract handle from href: /username → username
        const replyHandle = href.replace(/^\//, '').split('/')[0].toLowerCase()
        if (replyHandle) return replyHandle
      }
      el = el.parentElement
    }
  }
  return null
}
