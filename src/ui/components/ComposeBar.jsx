/**
 * ComposeBar — floating bar shown in the shadow DOM when the user opens
 * Twitter's compose box (and correctionEnabled is true).
 *
 * Positioned just above the NoTweet pill widget (bottom-right corner).
 * Calls the background's CORRECT_TWEET handler and replaces the compose
 * box text via replaceComposeText() from typer.js.
 */

import React, { useState } from 'react'
import { MSG } from '../../shared/constants.js'
import { replaceComposeText } from '../../content/typer.js'

// state: 'idle' | 'loading' | 'done' | 'error'
export default function ComposeBar({ onDismiss }) {
  const [state, setState] = useState('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleImprove() {
    const textarea = document.querySelector('[data-testid="tweetTextarea_0"]')
    const text = textarea?.textContent?.trim()

    if (!text) {
      setErrorMsg('Compose box is empty.')
      setState('error')
      setTimeout(() => setState('idle'), 2500)
      return
    }

    setState('loading')

    chrome.runtime.sendMessage(
      { type: MSG.CORRECT_TWEET, payload: { text } },
      (response) => {
        if (chrome.runtime.lastError || !response) {
          setErrorMsg('Extension error.')
          setState('error')
          setTimeout(() => setState('idle'), 3000)
          return
        }
        if (response.ok) {
          try {
            replaceComposeText(response.correctedText)
            setState('done')
            setTimeout(() => setState('idle'), 2000)
          } catch (err) {
            setErrorMsg(err.message)
            setState('error')
            setTimeout(() => setState('idle'), 3000)
          }
        } else {
          setErrorMsg(response.error || 'Unknown error')
          setState('error')
          setTimeout(() => setState('idle'), 3000)
        }
      },
    )
  }

  return (
    <div className="compose-bar">
      {state === 'idle' && (
        <>
          <span className="compose-bar-label">✨ Improve tweet?</span>
          <button className="compose-bar-btn" onClick={handleImprove}>Improve</button>
          <button className="compose-bar-dismiss" onClick={onDismiss} title="Dismiss">✕</button>
        </>
      )}
      {state === 'loading' && (
        <span className="compose-bar-label compose-bar-muted">Thinking…</span>
      )}
      {state === 'done' && (
        <span className="compose-bar-label compose-bar-success">✓ Done</span>
      )}
      {state === 'error' && (
        <span className="compose-bar-label compose-bar-error">✗ {errorMsg}</span>
      )}
    </div>
  )
}
