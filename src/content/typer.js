import { DELAY } from '../shared/constants.js'
import { randomBetween, delay } from '../shared/utils.js'

const REPLY_BTN_SELECTOR  = '[data-testid="reply"]'
const TEXTAREA_SELECTOR   = '[data-testid="tweetTextarea_0"]'
const SUBMIT_BTN_SELECTOR = '[data-testid="tweetButton"]'

export async function typeReply(tweetNode, text, autoSubmit = false) {
  tweetNode.scrollIntoView({ behavior: 'smooth', block: 'center' })
  await delay(400)

  const replyBtn = tweetNode.querySelector(REPLY_BTN_SELECTOR)
  if (!replyBtn) throw new Error('Reply button not found on tweet')
  replyBtn.click()

  const submitBtn = await waitForReplyButton(DELAY.REPLY_BOX_TIMEOUT)
  if (!submitBtn) throw new Error('Reply compose box did not appear in time')

  // Scope to the modal dialog to avoid the always-present inline compose box
  // on community pages (both share data-testid="tweetTextarea_0")
  const dialogEl = submitBtn.closest('[role="dialog"]')
  if (!dialogEl) throw new Error('Reply compose dialog not found')
  const textarea = dialogEl.querySelector(TEXTAREA_SELECTOR)
  if (!textarea) throw new Error('Reply textarea not found in compose box')

  textarea.focus()
  await delay(150)

  let charsSinceBreak = 0
  const burstEvery = DELAY.BURST_EVERY + Math.floor(Math.random() * 3) - 1

  for (const char of text) {
    insertChar(textarea, char)
    charsSinceBreak++

    if (charsSinceBreak >= burstEvery) {
      await delay(randomBetween(DELAY.BURST_MIN_MS, DELAY.BURST_MAX_MS))
      charsSinceBreak = 0
    } else {
      await delay(randomBetween(DELAY.CHAR_MIN_MS, DELAY.CHAR_MAX_MS))
    }
  }

  await delay(randomBetween(DELAY.PRE_SUBMIT_MIN_MS, DELAY.PRE_SUBMIT_MAX_MS))

  if (autoSubmit) {
    textarea.focus()
    await delay(100)

    const liveDialogEl  = textarea.closest('[role="dialog"]')
    const liveSubmitBtn = liveDialogEl
      ? [...liveDialogEl.querySelectorAll(SUBMIT_BTN_SELECTOR)]
          .find(btn => btn.textContent.trim() === 'Reply')
      : null

    console.log('[NoTweet] dialog found:', !!liveDialogEl)
    console.log('[NoTweet] submit button found:', !!liveSubmitBtn)
    console.log('[NoTweet] button disabled:', liveSubmitBtn?.disabled)
    console.log('[NoTweet] button aria-disabled:', liveSubmitBtn?.getAttribute('aria-disabled'))

    // Poll up to 3 s for Draft.js to enable the button after the last character
    let waited = 0
    while (
      liveSubmitBtn &&
      (liveSubmitBtn.disabled || liveSubmitBtn.getAttribute('aria-disabled') === 'true') &&
      waited < 3000
    ) {
      await delay(100)
      waited += 100
    }

    console.log('[NoTweet] waited for button:', waited, 'ms')
    console.log('[NoTweet] button disabled after wait:', liveSubmitBtn?.disabled)
    console.log('[NoTweet] button aria-disabled after wait:', liveSubmitBtn?.getAttribute('aria-disabled'))

    const isDisabled = !liveSubmitBtn
      || liveSubmitBtn.disabled
      || liveSubmitBtn.getAttribute('aria-disabled') === 'true'

    console.log('[NoTweet] isDisabled (will skip click if true):', isDisabled)
    if (isDisabled) return false

    console.log('[NoTweet] clicking the button now...')
    const evtOpts = { bubbles: true, cancelable: true, view: window }
    liveSubmitBtn.dispatchEvent(new MouseEvent('mousedown', evtOpts))
    liveSubmitBtn.dispatchEvent(new MouseEvent('mouseup',   evtOpts))
    liveSubmitBtn.dispatchEvent(new MouseEvent('click',     evtOpts))
    console.log('[NoTweet] click dispatched — waiting up to 8s for dialog to close...')

    const confirmed = await waitForSubmitConfirm(liveDialogEl, 8000)
    console.log('[NoTweet] dialog closed?', confirmed)
    return confirmed
  }

  return true
}

function waitForReplyButton(timeoutMs) {
  const isReply = (btn) =>
    btn.textContent.trim() === 'Reply' && !!btn.closest('[role="dialog"]')

  const immediate = [...document.querySelectorAll(SUBMIT_BTN_SELECTOR)].find(isReply)
  if (immediate) return Promise.resolve(immediate)

  return new Promise((resolve) => {
    const obs = new MutationObserver(() => {
      const btn = [...document.querySelectorAll(SUBMIT_BTN_SELECTOR)].find(isReply)
      if (btn) { obs.disconnect(); resolve(btn) }
    })
    obs.observe(document.body, { childList: true, subtree: true })
    setTimeout(() => { obs.disconnect(); resolve(null) }, timeoutMs)
  })
}

function waitForSubmitConfirm(el, timeoutMs = 4000) {
  return new Promise((resolve) => {
    if (!document.body.contains(el)) { resolve(true); return }
    const obs = new MutationObserver(() => {
      if (!document.body.contains(el)) { obs.disconnect(); resolve(true) }
    })
    obs.observe(document.body, { childList: true, subtree: true })
    setTimeout(() => { obs.disconnect(); resolve(false) }, timeoutMs)
  })
}

function insertChar(element, char) {
  element.focus()
  const inserted = document.execCommand('insertText', false, char)
  if (!inserted) {
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true, data: char, inputType: 'insertText',
    }))
  }
}

export function replaceComposeText(text) {
  const textarea = document.querySelector(TEXTAREA_SELECTOR)
  if (!textarea) throw new Error('Compose box not found')
  textarea.focus()
  document.execCommand('selectAll', false, null)
  const replaced = document.execCommand('insertText', false, text)
  if (!replaced) {
    textarea.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true, data: text, inputType: 'insertText',
    }))
  }
}

export function findTweetNode(tweetId) {
  const link = document.querySelector(`a[href*="/status/${tweetId}"]`)
  return link?.closest('article[data-testid="tweet"]') ?? null
}
