import React from 'react'
import { MSG } from '../../shared/constants.js'

/**
 * Scrollable list of past reply entries.
 *
 * Props:
 *   log      {Array}    - array of { id, handle, tweetText, reply, timestamp }
 *   onClear  {function} - clears the log
 *   compact  {boolean}  - side-panel mode: show fewer entries, no count toolbar
 */
export default function ActivityLog({ log, onClear, compact = false }) {
  const entries = compact ? log.slice(0, 8) : log

  return (
    <div className="activity-log">
      {!compact && (
        <div className="log-toolbar">
          <span className="log-count">{log.length} {log.length === 1 ? 'reply' : 'replies'} logged</span>
          {log.length > 0 && (
            <button className="btn-ghost" style={{ padding: '5px 12px', fontSize: '12px' }}
              onClick={onClear}>
              Clear log
            </button>
          )}
        </div>
      )}

      {entries.length === 0 ? (
        <p className="log-empty">No replies yet. Start the bot to begin.</p>
      ) : (
        <div className="log-list">
          {entries.map((entry) => (
            <LogEntry key={entry.id + entry.timestamp} entry={entry} />
          ))}
          {compact && log.length > 8 && (
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center', padding: '6px 0' }}>
              +{log.length - 8} more — expand for full log
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function LogEntry({ entry }) {
  const time = new Date(entry.timestamp).toLocaleTimeString([], {
    hour:   '2-digit',
    minute: '2-digit',
  })

  if (entry.kind === 'attempt') {
    return (
      <div className="log-entry log-entry-attempt">
        <div className="log-entry-header">
          <span className="log-handle" style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
            ↺ Tried
          </span>
          <span className="log-time">{time}</span>
        </div>
        <p className="log-tweet-text" style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
          {entry.reason}
        </p>
      </div>
    )
  }

  return (
    <div className="log-entry">
      <div className="log-entry-header">
        <span className="log-handle">@{entry.handle}</span>
        <span className="log-time">{time}</span>
      </div>
      <p className="log-tweet-text">"{entry.tweetText}"</p>
      <div className="log-reply">{entry.reply}</div>
    </div>
  )
}
