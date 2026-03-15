import React, { useState, useEffect, useRef } from 'react'
import { MSG, DEFAULTS } from '../shared/constants.js'
import FloatingWidget from './components/FloatingWidget.jsx'
import SidePanel      from './components/SidePanel.jsx'
import ComposeBar     from './components/ComposeBar.jsx'

/**
 * Root React component.
 * Two view states:
 *   'collapsed' — small pill, bottom-right
 *   'panel'     — right-side drawer with full tabs, Twitter still visible
 */
export default function App({ shadowRoot }) {
  const [view, setView] = useState('collapsed') // 'collapsed' | 'panel'

  const [status, setStatus] = useState({
    isRunning:      false,
    outboundCount:  0,
    replybackCount: 0,
    outboundLimit:  DEFAULTS.settings.outboundLimit,
    replybackLimit: DEFAULTS.settings.replybackLimit,
    nextReplyIn:    null,
    error:          null,
    hasApiKey:      false,
    hasMyHandle:    false,
  })

  const [log, setLog] = useState([])

  // ── Compose-box state for tweet correction ────────────────────────────────
  const [composeOpen, setComposeOpen] = useState(false)
  const correctionEnabledRef = useRef(false)

  useEffect(() => {
    // Load initial correctionEnabled value
    chrome.storage.local.get('settings', (result) => {
      correctionEnabledRef.current = result?.settings?.correctionEnabled ?? false
    })

    // Keep ref in sync when settings change
    const onStorageChange = (changes, area) => {
      if (area === 'local' && changes.settings) {
        correctionEnabledRef.current = changes.settings.newValue?.correctionEnabled ?? false
        // If correction was just disabled, hide the bar
        if (!correctionEnabledRef.current) setComposeOpen(false)
      }
    }
    chrome.storage.onChanged.addListener(onStorageChange)

    // Listen for compose events dispatched by the content script observer
    const onCompose = (e) => {
      if (correctionEnabledRef.current) {
        setComposeOpen(e.detail.open)
      }
    }
    window.addEventListener('notweet:compose', onCompose)

    return () => {
      chrome.storage.onChanged.removeListener(onStorageChange)
      window.removeEventListener('notweet:compose', onCompose)
    }
  }, [])

  // ── Apply theme to shadow host ────────────────────────────────────────────
  useEffect(() => {
    if (!shadowRoot) return

    function applyTheme() {
      chrome.storage.local.get('settings', (result) => {
        const theme = result?.settings?.theme || 'dark'
        shadowRoot.host.dataset.theme = theme
      })
    }

    applyTheme()

    const onChange = (changes, area) => {
      if (area === 'local' && changes.settings) applyTheme()
    }
    chrome.storage.onChanged.addListener(onChange)
    return () => chrome.storage.onChanged.removeListener(onChange)
  }, [shadowRoot])

  // ── Listen for push messages from the background ──────────────────────────
  useEffect(() => {
    function onMessage(message) {
      if (!message?.type) return

      if (message.type === MSG.STATUS_UPDATE) {
        setStatus(message.payload)
      }

      if (message.type === MSG.LOG_UPDATE) {
        setLog((prev) => [message.payload.entry, ...prev].slice(0, 100))
      }
    }

    chrome.runtime.onMessage.addListener(onMessage)

    // Pull initial state immediately on mount
    chrome.runtime.sendMessage({ type: MSG.GET_STATUS }, (snap) => {
      if (snap) setStatus(snap)
    })

    chrome.runtime.sendMessage({ type: MSG.GET_LOG }, (entries) => {
      if (Array.isArray(entries)) setLog(entries)
    })

    return () => chrome.runtime.onMessage.removeListener(onMessage)
  }, [])

  // ── Polling fallback (30 s) — status_update may be missed if the   ─────────
  // ── service worker was asleep when the content script first loaded. ─────────
  useEffect(() => {
    const id = setInterval(() => {
      chrome.runtime.sendMessage({ type: MSG.GET_STATUS }, (snap) => {
        if (snap) setStatus(snap)
      })
    }, 30_000)
    return () => clearInterval(id)
  }, [])

  function sendMsg(type) { chrome.runtime.sendMessage({ type }).catch(() => {}) }
  function clearLog()    { chrome.runtime.sendMessage({ type: MSG.CLEAR_LOG }).catch(() => {}) }

  return (
    <>
      {composeOpen && (
        <ComposeBar onDismiss={() => setComposeOpen(false)} />
      )}

      {view === 'collapsed' && (
        <div className="notweet-pill-anchor">
          <FloatingWidget status={status} onClick={() => setView('panel')} />
        </div>
      )}

      {view === 'panel' && (
        <SidePanel
          status={status}
          log={log}
          onClose={() => setView('collapsed')}
          onStart={() => sendMsg(MSG.START_BOT)}
          onStop={() => sendMsg(MSG.STOP_BOT)}
          onClearLog={clearLog}
          onThemeChange={(t) => { if (shadowRoot) shadowRoot.host.dataset.theme = t }}
        />
      )}
    </>
  )
}
