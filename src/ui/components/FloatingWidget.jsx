import React from 'react'
import StatusBadge from './StatusBadge.jsx'
import Logo from './Logo.jsx'

/**
 * Collapsed state — a small glass pill anchored to the bottom-right.
 * Clicking it expands the dashboard.
 *
 * Props:
 *   status  {object}   - { isRunning, count, remaining, error }
 *   onClick {function} - expand the dashboard
 */
export default function FloatingWidget({ status, onClick }) {
  const {
    isRunning,
    outboundCount  = 0,
    replybackCount = 0,
    outboundLimit  = 5,
    replybackLimit = 5,
    error,
  } = status

  return (
    <div className="floating-widget" onClick={onClick} role="button" tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}>
      <Logo size={28} />
      <div className="widget-info">
        <StatusBadge running={isRunning} error={error} />
        <span className="widget-count">
          {outboundCount}/{outboundLimit} out · {replybackCount}/{replybackLimit} back
        </span>
      </div>
    </div>
  )
}
