import React from 'react'

/**
 * Renders the extension logo image.
 *
 * Uses chrome.runtime.getURL so the content script can reference
 * the file inside the extension's own package at dist/icons/logo.png.
 *
 * Props:
 *   size {number} - width & height in px (default 24)
 *   className {string}
 */
function getLogoSrc() {
  try { return chrome.runtime.getURL('NoTweet.png') }
  catch { return '' }
}

export default function Logo({ size = 24, className = '' }) {
  const src = getLogoSrc()
  if (!src) return null
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt="NoTweet"
      className={`nt-logo ${className}`}
      draggable={false}
    />
  )
}
