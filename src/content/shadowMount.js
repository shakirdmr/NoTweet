/**
 * Creates a Shadow DOM host element and appends it to document.body.
 *
 * Why Shadow DOM?
 * Twitter injects aggressive global CSS (box-sizing, font overrides, scoped
 * data-* selectors) that corrupts the glassmorphism widget's appearance.
 * A shadow root isolates our styles completely.
 *
 * Returns { shadow, mountPoint, styleEl } so the caller can inject CSS
 * and mount React into mountPoint.
 */
export function createShadowHost() {
  // Remove any stale host (e.g. after SPA navigation re-init)
  document.getElementById('notweet-root')?.remove()

  const host = document.createElement('div')
  host.id = 'notweet-root'
  // The host itself must not intercept pointer events — the inner React
  // components set pointer-events:all selectively.
  Object.assign(host.style, {
    position:      'fixed',
    bottom:        '20px',
    right:         '20px',
    zIndex:        '2147483647',
    pointerEvents: 'none',
    // Give the host a size so backdrop-filter has a surface to blur against
    width:         '0',
    height:        '0',
    overflow:      'visible',
  })
  document.body.appendChild(host)

  // Open mode so that content.js can query the shadow DOM if needed
  const shadow = host.attachShadow({ mode: 'open' })

  // <style> element — CSS strings are injected here by main.jsx
  const styleEl = document.createElement('style')
  shadow.appendChild(styleEl)

  // React mount point inside the shadow root
  const mountPoint = document.createElement('div')
  mountPoint.id = 'notweet-mount'
  shadow.appendChild(mountPoint)

  return { shadow, mountPoint, styleEl }
}
