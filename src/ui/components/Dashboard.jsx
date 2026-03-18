import React, { useState } from 'react'
import StatusBadge  from './StatusBadge.jsx'
import SettingsPanel from './SettingsPanel.jsx'
import ActivityLog   from './ActivityLog.jsx'
import Logo from './Logo.jsx'
import { MSG } from '../../shared/constants.js'

/**
 * Full-screen dashboard overlay.
 * Three tabs: Status | Settings | Log
 *
 * Props:
 *   status     {object}   - current bot state snapshot from background
 *   log        {Array}    - activity log entries
 *   onCollapse {function} - close the dashboard (back to floating widget)
 */
export default function Dashboard({ status, log, onCollapse }) {
  const [tab, setTab] = useState('status')

  function sendMsg(type) {
    chrome.runtime.sendMessage({ type }).catch(() => {})
  }

  function clearLog() {
    chrome.runtime.sendMessage({ type: MSG.CLEAR_LOG }).catch(() => {})
  }

  return (
    <div className="dashboard-overlay" onClick={(e) => {
      // Clicking the backdrop (not the panel) closes the dashboard
      if (e.target === e.currentTarget) onCollapse()
    }}>
      <div className="dashboard-panel">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="dashboard-header">
          <div className="dashboard-title">
            <Logo size={28} />
            <h1>NoTweet</h1>
          </div>
          <button className="close-btn" onClick={onCollapse} title="Close">✕</button>
        </header>

        {/* ── Tab bar ────────────────────────────────────────────────────── */}
        <nav className="dashboard-tabs">
          {['status', 'settings', 'log'].map((t) => (
            <button
              key={t}
              className={`tab-btn${tab === t ? ' active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>

        {/* ── Tab content ────────────────────────────────────────────────── */}
        <main className="dashboard-content">
          {tab === 'status'   && (
            <StatusView
              status={status}
              onStart={() => sendMsg(MSG.START_BOT)}
              onStop={() => sendMsg(MSG.STOP_BOT)}
            />
          )}
          {tab === 'settings' && <SettingsPanel />}
          {tab === 'log'      && <ActivityLog log={log} onClear={clearLog} />}
        </main>

      </div>
    </div>
  )
}

// ─── Status tab ───────────────────────────────────────────────────────────────
const ACTIVITY_LABEL = {
  scanning:      'Scanning tweets…',
  scrolling:     'Scrolling for more tweets…',
  generating:    'Asking Claude for a reply…',
  typing:        'Typing reply…',
  compose_open:  'Compose box is open — waiting for you to close it…',
  idle:          null,
  limit_reached: 'Daily limit reached — stopped.',
}

function StatusView({ status, onStart, onStop }) {
  const {
    isRunning,
    outboundCount  = 0,
    replybackCount = 0,
    failedCount    = 0,
    outboundLimit  = 5,
    replybackLimit = 5,
    nextReplyIn,
    activity,
    error,
    hasApiKey,
    hasMyHandle,
  } = status

  const activityLabel = activity === 'waiting' && nextReplyIn !== null
    ? `Waiting ${formatSeconds(nextReplyIn)}…`
    : ACTIVITY_LABEL[activity] ?? null

  return (
    <div className="status-view">

      {/* ── Community replies row ───────────────────────────────────────── */}
      <div className="stat-section-label">Community replies</div>
      <div className="status-cards" style={{ marginBottom: '16px' }}>
        <div className="stat-card">
          <div className="stat-label">Sent</div>
          <div className="stat-value accent">{outboundCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Failed</div>
          <div className="stat-value" style={{ color: failedCount > 0 ? '#ff6b6b' : 'inherit' }}>{failedCount}</div>
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

      {/* ── Current status ──────────────────────────────────────────────── */}
      <div className="status-row">
        <StatusBadge running={isRunning} error={error} />
      </div>

      {isRunning && activityLabel && (
        <div className="activity-label">{activityLabel}</div>
      )}

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
