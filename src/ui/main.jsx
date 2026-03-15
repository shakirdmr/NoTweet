/**
 * React entry point.
 * Called by content.js after creating the Shadow DOM host.
 *
 * Imports all CSS as ?inline strings (Vite feature) and injects them into
 * the <style> element inside the shadow root so styles are fully isolated
 * from Twitter's own CSS.
 */
import React    from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

// ?inline tells Vite to export the CSS as a plain string instead of
// injecting it into <head>. This is essential for Shadow DOM style isolation.
import baseStyles      from '../styles/base.css?inline'
import widgetStyles    from '../styles/widget.css?inline'
import dashboardStyles from '../styles/dashboard.css?inline'

/**
 * Mounts the React app into the shadow root.
 *
 * @param {ShadowRoot} shadowRoot  - the shadow root of the host element
 * @param {HTMLElement} mountPoint - the <div> inside the shadow root to render into
 * @param {HTMLStyleElement} styleEl - the <style> element inside the shadow root
 * @returns {import('react-dom/client').Root}
 */
export function mountUI(shadowRoot, mountPoint, styleEl) {
  // Inject all styles into shadow DOM
  styleEl.textContent = baseStyles + widgetStyles + dashboardStyles

  const root = createRoot(mountPoint)
  root.render(<App shadowRoot={shadowRoot} />)
  return root
}
