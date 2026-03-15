import React from 'react'

/**
 * Small coloured dot + label showing the bot's current state.
 * Used in both the floating widget and the dashboard status view.
 *
 * Props:
 *   running {boolean}
 *   error   {string|null}
 */
export default function StatusBadge({ running, error }) {
  let variant = 'idle'
  let label   = 'Idle'

  if (error)   { variant = 'error';   label = 'Error'   }
  if (running) { variant = 'running'; label = 'Running' }

  return (
    <span className={`status-badge ${variant}`}>
      <span className="status-dot" />
      <span className="status-label">{label}</span>
    </span>
  )
}
