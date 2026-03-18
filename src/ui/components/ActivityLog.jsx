import React from 'react'

/**
 * Scrollable list of past reply entries.
 *
 * Props:
 *   log      {Array}    - array of log entries with kind field
 *   onClear  {function} - clears the log
 *   compact  {boolean}  - side-panel mode: show fewer entries, no count toolbar
 */
export default function ActivityLog({ log, onClear, compact = false }) {
  const entries = compact ? log.slice(0, 8) : log

  // Only count actual sent replies for the summary
  const replyCount = log.filter((e) => e.kind === 'outbound' || e.kind === 'replyback').length

  return (
    <div className="activity-log">
      {!compact && (
        <div className="log-toolbar">
          <span className="log-count">
            {replyCount} {replyCount === 1 ? 'reply' : 'replies'} sent
            {log.length > replyCount && (
              <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                {' '}({log.length - replyCount} skipped/errors)
              </span>
            )}
          </span>
          {log.length > 0 && (
            <button className="btn-ghost" style={{ padding: '5px 12px', fontSize: '12px' }}
              onClick={onClear}>
              Clear log
            </button>
          )}
        </div>
      )}

      {entries.length === 0 ? (
        <p className="log-empty">No activity yet. Start the bot to begin.</p>
      ) : (
        <div className="log-list">
          {entries.map((entry) => (
            <LogEntry key={entry.id + entry.timestamp} entry={entry} />
          ))}
          {compact && log.length > 8 && (
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center', padding: '6px 0' }}>
              +{log.length - 8} more in Log tab
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
          <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '12px' }}>
            ↺ Scanning
          </span>
          <span className="log-time">{time}</span>
        </div>
        <p className="log-tweet-text" style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
          {entry.reason}
        </p>
      </div>
    )
  }

  if (entry.kind === 'error') {
    return (
      <div className="log-entry log-entry-error">
        <div className="log-entry-header">
          <span style={{ color: 'var(--error)', fontSize: '12px' }}>
            ✕ Failed{entry.handle ? ` on @${entry.handle}` : ''}
          </span>
          <span className="log-time">{time}</span>
        </div>
        {entry.tweetText && (
          <p className="log-tweet-text" style={{ opacity: 0.5 }}>"{entry.tweetText}"</p>
        )}
        <p className="log-tweet-text" style={{ color: 'var(--error)', fontStyle: 'italic' }}>
          {entry.reason}
        </p>
      </div>
    )
  }

  if (entry.kind === 'seen') {
    return (
      <div className="log-entry log-entry-attempt">
        <div className="log-entry-header">
          <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
            ⊘ Skipped @{entry.handle}
          </span>
          <span className="log-time">{time}</span>
        </div>
        <p className="log-tweet-text" style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
          Already replied to this tweet
        </p>
      </div>
    )
  }

  // outbound or replyback — actual sent replies
  const isReplyback = entry.kind === 'replyback'
  return (
    <div className="log-entry">
      <div className="log-entry-header">
        <span className="log-handle">@{entry.handle}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{
            fontSize: '10px',
            fontWeight: 600,
            padding: '1px 6px',
            borderRadius: '999px',
            background: isReplyback ? 'rgba(0,186,124,0.15)' : 'rgba(29,155,240,0.15)',
            color: isReplyback ? 'var(--success)' : 'var(--accent)',
          }}>
            {isReplyback ? 'reply-back' : 'community'}
          </span>
          <span className="log-time">{time}</span>
        </div>
      </div>
      <p className="log-tweet-text">"{entry.tweetText}"</p>
      <div className="log-reply">{entry.reply}</div>
    </div>
  )
}
