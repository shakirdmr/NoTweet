/**
 * Human-like typing simulation for Twitter's tweet composer.
 *
 * Twitter's composer is a Slate.js-backed contenteditable <div> — not a plain
 * <textarea>. Setting element.value or dispatching keydown/keyup events alone
 * does not update Slate's internal state. The only reliable technique is:
 *
 *   1. Focus the contenteditable element
 *   2. Use document.execCommand('insertText', false, char)  ← inserts into the
 *      active selection and triggers Slate's beforeinput handler
 *   3. Dispatch a synthetic 'input' event so React's SyntheticEvent system
 *      picks up the change
 *
 * This is the same strategy used by password managers and autofill tools.
 * execCommand is deprecated but still works in Chromium; there is no
 * universal replacement for contenteditable insertion yet.
 */

import { DELAY } from '../shared/constants.js'
import { randomBetween, delay, waitForElement } from '../shared/utils.js'

const REPLY_BTN_SELECTOR  = '[data-testid="reply"]'
const TEXTAREA_SELECTOR   = '[data-testid="tweetTextarea_0"]'
const SUBMIT_BTN_SELECTOR = '[data-testid="tweetButtonInline"]'

/**
 * Opens the reply compose box for `tweetNode`, types `text` character
 * by character, and optionally clicks the submit button.
 *
 * @param {Element} tweetNode  - article element containing the tweet
 * @param {string}  text       - the reply to type
 * @param {boolean} autoSubmit - whether to click the tweet button at the end
 */
export async function typeReply(tweetNode, text, autoSubmit = false) {
  // 1. Scroll the tweet into view so the reply button is accessible
  tweetNode.scrollIntoView({ behavior: 'smooth', block: 'center' })
  await delay(400)

  // 2. Click the reply button
  const replyBtn = tweetNode.querySelector(REPLY_BTN_SELECTOR)
  if (!replyBtn) throw new Error('Reply button not found on tweet')
  replyBtn.click()

  // 3. Wait for the compose textarea to appear (it may open in a modal)
  const textarea = await waitForElement(TEXTAREA_SELECTOR, DELAY.REPLY_BOX_TIMEOUT)
  if (!textarea) throw new Error('Reply compose box did not appear in time')

  // 4. Focus the textarea
  textarea.focus()
  await delay(150)

  // 5. Type characters one by one with randomised delays
  let charsSinceBreak = 0
  const burstEvery = DELAY.BURST_EVERY + Math.floor(Math.random() * 3) - 1 // 5–8

  for (const char of text) {
    insertChar(textarea, char)
    charsSinceBreak++

    if (charsSinceBreak >= burstEvery) {
      // Burst pause — simulates brief hesitation / thinking
      await delay(randomBetween(DELAY.BURST_MIN_MS, DELAY.BURST_MAX_MS))
      charsSinceBreak = 0
    } else {
      await delay(randomBetween(DELAY.CHAR_MIN_MS, DELAY.CHAR_MAX_MS))
    }
  }

  // 6. Human pause before submitting
  await delay(randomBetween(DELAY.PRE_SUBMIT_MIN_MS, DELAY.PRE_SUBMIT_MAX_MS))

  // 7. Optionally click the submit button
  if (autoSubmit) {
    const submitBtn = document.querySelector(SUBMIT_BTN_SELECTOR)
    if (submitBtn && !submitBtn.disabled) {
      submitBtn.click()
    }
  }
}

// ─── Low-level character insertion ───────────────────────────────────────────
function insertChar(element, char) {
  // execCommand operates on the focused element's active selection
  element.focus()
  const inserted = document.execCommand('insertText', false, char)

  // Fallback: if execCommand returns false (some environments), dispatch
  // a manual InputEvent instead
  if (!inserted) {
    const event = new InputEvent('input', {
      bubbles:    true,
      cancelable: true,
      data:       char,
      inputType:  'insertText',
    })
    element.dispatchEvent(event)
  }
}

/**
 * Replaces all text in the already-open tweet compose box with `text`.
 * Uses a single execCommand call (no character-by-character simulation)
 * because this is user-initiated, not bot-driven.
 */
export function replaceComposeText(text) {
  const textarea = document.querySelector(TEXTAREA_SELECTOR)
  if (!textarea) throw new Error('Compose box not found')
  textarea.focus()
  document.execCommand('selectAll', false, null)
  const replaced = document.execCommand('insertText', false, text)
  if (!replaced) {
    // Fallback for environments where execCommand is blocked
    const event = new InputEvent('input', {
      bubbles:   true,
      cancelable: true,
      data:      text,
      inputType: 'insertText',
    })
    textarea.dispatchEvent(event)
  }
}

/**
 * Finds a tweet article node by its status ID.
 * More reliable than storing node references (which can be recycled by
 * Twitter's virtual list).
 */
export function findTweetNode(tweetId) {
  const link = document.querySelector(`a[href*="/status/${tweetId}"]`)
  return link?.closest('article[data-testid="tweet"]') ?? null
}
