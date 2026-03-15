import React, { useState, useEffect } from 'react'
import StatusBadge          from './StatusBadge.jsx'
import SettingsPanel        from './SettingsPanel.jsx'
import ActivityLog          from './ActivityLog.jsx'
import TweetCorrectionPanel from './TweetCorrectionPanel.jsx'
import Logo                 from './Logo.jsx'
import { MSG, STORE } from '../../shared/constants.js'

/**
 * Panel state — right-side drawer with full Status / Settings / Log tabs.
 * Non-blocking: Twitter is fully usable on the left.
 *
 * Props:
 *   status     {object}
 *   log        {Array}
 *   onClose    {fn} → back to pill
 *   onStart    {fn}
 *   onStop     {fn}
 *   onClearLog {fn}
 */
export default function SidePanel({ status, log, onClose, onStart, onStop, onClearLog, onThemeChange }) {
  const [tab, setTab] = useState('status')

  return (
    <div className="side-panel">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="side-panel-header">
        <Logo size={26} />
        <span className="side-panel-title">NoTweet</span>
        <StatusBadge running={status.isRunning} error={status.error} />
        <button className="panel-icon-btn" onClick={onClose} title="Close">✕</button>
      </header>

      {/* ── Tab bar ────────────────────────────────────────────────────── */}
      <nav className="dashboard-tabs">
        {['status', 'correct', 'settings', 'log'].map((t) => (
          <button
            key={t}
            className={`tab-btn${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'correct' ? '✨ Correct' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>

      {/* ── Tab content ────────────────────────────────────────────────── */}
      <div className="side-panel-body">
        {tab === 'status'   && (
          <StatusView
            status={status}
            onStart={onStart}
            onStop={onStop}
          />
        )}
        {tab === 'correct'  && <TweetCorrectionPanel />}
        {tab === 'settings' && <SettingsPanel onThemeChange={onThemeChange} />}
        {tab === 'log'      && <ActivityLog log={log} onClear={onClearLog} />}
      </div>

    </div>
  )
}

// ─── Status tab ───────────────────────────────────────────────────────────────
function StatusView({ status, onStart, onStop }) {
  const {
    isRunning,
    outboundCount  = 0,
    replybackCount = 0,
    outboundLimit  = 5,
    replybackLimit = 5,
    nextAlarmAt,
    error,
    hasApiKey,
    hasMyHandle,
  } = status

  const [countdown, setCountdown] = useState(null)
  useEffect(() => {
    if (!nextAlarmAt) { setCountdown(null); return }
    const tick = () => setCountdown(Math.max(0, Math.round((nextAlarmAt - Date.now()) / 1000)))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [nextAlarmAt])

  const [behavior, setBehavior] = useState({ autoReply: true, autoLike: false, autoSubmit: false })

  useEffect(() => {
    chrome.storage.local.get(STORE.SETTINGS, (result) => {
      const s = result[STORE.SETTINGS]
      if (!s) return
      setBehavior({
        autoReply:  s.autoReply  ?? true,
        autoLike:   s.autoLike   ?? false,
        autoSubmit: s.autoSubmit ?? false,
      })
    })
  }, [])

  function toggleBehavior(field) {
    setBehavior((prev) => {
      const next = { ...prev, [field]: !prev[field] }
      // Patch just these three keys into stored settings
      chrome.storage.local.get(STORE.SETTINGS, (result) => {
        const current = result[STORE.SETTINGS] ?? {}
        const updated = { ...current, autoReply: next.autoReply, autoLike: next.autoLike, autoSubmit: next.autoSubmit }
        chrome.runtime.sendMessage({ type: MSG.SAVE_SETTINGS, payload: updated }).catch(() => {})
      })
      return next
    })
  }

  return (
    <div className="status-view">

      {/* ── Community replies row ───────────────────────────────────────── */}
      <div className="stat-section-label">Community replies</div>
      <div className="status-cards" style={{ marginBottom: '16px' }}>
        <div className="stat-card">
          <div className="stat-label">Sent tonight</div>
          <div className="stat-value accent">{outboundCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Remaining</div>
          <div className="stat-value">{Math.max(0, outboundLimit - outboundCount)}</div>
        </div>
      </div>

      {/* ── Reply-backs row ─────────────────────────────────────────────── */}
      <div className="stat-section-label">
        Reply-backs to your posts
        {!hasMyHandle && (
          <span className="stat-section-hint"> — set your handle in Settings</span>
        )}
      </div>
      <div className="status-cards" style={{ marginBottom: '20px' }}>
        <div className="stat-card">
          <div className="stat-label">Sent tonight</div>
          <div className="stat-value accent">{replybackCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Remaining</div>
          <div className="stat-value">{Math.max(0, replybackLimit - replybackCount)}</div>
        </div>
      </div>

      {/* ── Behavior widgets ────────────────────────────────────────────── */}
      <div className="stat-section-label" style={{ marginBottom: '10px' }}>Behavior</div>
      <div className="behavior-widgets">
        {[
          { key: 'autoReply',  label: 'Auto-reply' },
          { key: 'autoLike',   label: 'Auto-like'  },
          { key: 'autoSubmit', label: 'Auto-submit' },
        ].map(({ key, label }) => (
          <button
            key={key}
            className={`behavior-chip${behavior[key] ? ' active' : ''}`}
            onClick={() => toggleBehavior(key)}
          >
            <span className="behavior-chip-dot" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Current status ──────────────────────────────────────────────── */}
      <div className="status-row" style={{ marginTop: '20px' }}>
        <StatusBadge running={isRunning} error={error} />
        {isRunning && countdown !== null && (
          <span className="next-reply-hint">Next community reply in ~{formatSeconds(countdown)}</span>
        )}
      </div>

      {error && <div className="error-box">⚠ {error}</div>}

      <div className="control-row">
        {isRunning ? (
          <button className="btn-danger" onClick={onStop}>⏹ Stop</button>
        ) : (
          <button className="btn-primary" onClick={onStart} disabled={!hasApiKey}>
            ▶ Start
          </button>
        )}
      </div>

      {!hasApiKey && (
        <p className="no-api-hint">⚠ Add your Claude API key in Settings before starting.</p>
      )}
    </div>
  )
}

function formatSeconds(sec) {
  if (sec < 60) return `${sec}s`
  return `${Math.floor(sec / 60)}m ${sec % 60}s`
}
