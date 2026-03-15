import React, { useState, useEffect } from 'react'
import { MSG, STORE, DEFAULTS } from '../../shared/constants.js'

export default function SettingsPanel({ onThemeChange }) {
  const [form, setForm] = useState({
    apiKey:         '',
    myHandle:       '',
    keywords:       '',
    accounts:       '',
    outboundLimit:  5,
    replybackLimit: 5,
    autoSubmit:     false,
    autoReply:      true,
    autoLike:       false,
    theme:          'dark',
    proxyUrl:       '',
    proxySecret:    '',
  })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    chrome.storage.local.get(STORE.SETTINGS, (result) => {
      const s = result[STORE.SETTINGS]
      if (!s) return
      setForm({
        apiKey:         s.apiKey         ?? '',
        myHandle:       s.myHandle        ?? '',
        keywords:       (s.keywords       ?? []).join(', '),
        accounts:       (s.accounts       ?? []).join(', '),
        outboundLimit:  s.outboundLimit   ?? DEFAULTS.settings.outboundLimit,
        replybackLimit: s.replybackLimit  ?? DEFAULTS.settings.replybackLimit,
        autoSubmit:     s.autoSubmit      ?? false,
        autoReply:      s.autoReply       ?? true,
        autoLike:       s.autoLike        ?? false,
        theme:          s.theme           ?? 'dark',
        proxyUrl:       s.proxyUrl        ?? '',
        proxySecret:    s.proxySecret     ?? '',
      })
    })
  }, [])

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setSaved(false)
  }

  function handleSave(e) {
    e.preventDefault()
    const payload = {
      apiKey:         form.apiKey.trim(),
      myHandle:       form.myHandle.trim().replace(/^@/, ''),
      keywords:       splitCsv(form.keywords),
      accounts:       splitCsv(form.accounts).map((a) => a.replace(/^@/, '')),
      outboundLimit:  clamp(form.outboundLimit, 1, 10),
      replybackLimit: clamp(form.replybackLimit, 1, 10),
      autoSubmit:     form.autoSubmit,
      autoReply:      form.autoReply,
      autoLike:       form.autoLike,
      theme:          form.theme,
      proxyUrl:       form.proxyUrl.trim(),
      proxySecret:    form.proxySecret.trim(),
    }
    chrome.runtime.sendMessage({ type: MSG.SAVE_SETTINGS, payload }, () => {
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    })
  }

  return (
    <form className="settings-form" onSubmit={handleSave}>

      {/* ── Claude API Key — required for everything ───────────────────── */}
      <div className="form-field">
        <label className="form-label" htmlFor="nt-api-key">
          Claude API Key
          <span className="required-badge">Required</span>
        </label>
        <input id="nt-api-key" type="password" className="form-input"
          placeholder="sk-ant-..." value={form.apiKey} autoComplete="off"
          onChange={(e) => set('apiKey', e.target.value)} />
        <span className="form-hint">
          Direct key — or leave blank and use the proxy below instead.
          Get yours at console.anthropic.com
        </span>
      </div>

      {/* ── Proxy (optional but recommended for enterprise keys) ────────── */}
      <div className="form-field">
        <label className="form-label" htmlFor="nt-proxy-url">Proxy URL <span className="form-hint" style={{ textTransform: 'none', letterSpacing: 0 }}>(recommended)</span></label>
        <input id="nt-proxy-url" type="text" className="form-input"
          placeholder="https://notweet-proxy.workers.dev"
          value={form.proxyUrl} autoComplete="off"
          onChange={(e) => set('proxyUrl', e.target.value)} />
        <label className="form-label" htmlFor="nt-proxy-secret" style={{ marginTop: '8px' }}>Proxy Secret</label>
        <input id="nt-proxy-secret" type="password" className="form-input"
          placeholder="your shared secret"
          value={form.proxySecret} autoComplete="off"
          onChange={(e) => set('proxySecret', e.target.value)} />
        <span className="form-hint">
          When set, your API key stays on the server and is never sent to the browser.
          Deploy the proxy in <code style={{ fontFamily: 'monospace', fontSize: '10px' }}>proxy/</code> to Cloudflare Workers or Vercel.
        </span>
      </div>

      {/* ── Feature 1: Community Auto-Reply ────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-header">Community Auto-Reply</div>
        <div className="settings-section-desc">
          Finds posts in your timeline matching your keywords or accounts and
          replies to them. Your handle is not needed for this feature.
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="nt-keywords">Keywords</label>
          <input id="nt-keywords" type="text" className="form-input"
            placeholder="#buildinpublic, #indiehackers, shipping"
            value={form.keywords}
            onChange={(e) => set('keywords', e.target.value)} />
          <span className="form-hint">
            Comma-separated. <strong>Leave blank</strong> when browsing a community — the bot replies to all visible posts without filtering.
          </span>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="nt-accounts">Specific Accounts
            <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 4 }}>(optional)</span>
          </label>
          <input id="nt-accounts" type="text" className="form-input"
            placeholder="elonmusk, naval, sama"
            value={form.accounts}
            onChange={(e) => set('accounts', e.target.value)} />
          <span className="form-hint">Only reply to these accounts. Combined with keywords via OR.</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', alignItems: 'end' }}>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label className="form-label">Nightly limit</label>
            <input type="number" className="form-input" min="1" max="10"
              value={form.outboundLimit}
              onChange={(e) => set('outboundLimit', e.target.value)} />
            <span className="form-hint">Max 10, resets midnight.</span>
          </div>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label className="form-label">Auto-like</label>
            <div className="form-toggle-row" style={{ margin: 0 }}>
              <div className="toggle-label">
                <span className="toggle-desc">Like the posts I reply to</span>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={form.autoLike}
                  onChange={(e) => set('autoLike', e.target.checked)} />
                <span className="toggle-track" />
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* ── Feature 2: Reply-back to Your Posts ────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-header">Reply-back to Your Posts</div>
        <div className="settings-section-desc">
          When someone replies to your tweet, the bot replies back automatically
          within 5–15 seconds. Needs your handle to know which posts are yours.
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="nt-handle">
            Your Twitter Handle
            <span className="required-badge">Required</span>
          </label>
          <input id="nt-handle" type="text" className="form-input"
            placeholder="yourhandle  (no @)" value={form.myHandle}
            onChange={(e) => set('myHandle', e.target.value)} />
          <span className="form-hint">
            Without this, the bot cannot detect replies to your own posts.
          </span>
        </div>

        <div className="form-field" style={{ marginBottom: 0 }}>
          <label className="form-label">Nightly limit</label>
          <input type="number" className="form-input" min="1" max="10"
            value={form.replybackLimit}
            onChange={(e) => set('replybackLimit', e.target.value)} />
          <span className="form-hint">Max 10, resets midnight.</span>
        </div>
      </div>

      {/* ── Auto-submit — global, applies to both ──────────────────────── */}
      <div className="form-toggle-row">
        <div className="toggle-label">
          <span className="toggle-name">Auto-submit replies</span>
          <span className="toggle-desc">Applies to both features above. Off = bot types the reply but waits for you to post it.</span>
        </div>
        <label className="toggle-switch">
          <input type="checkbox" checked={form.autoSubmit}
            onChange={(e) => set('autoSubmit', e.target.checked)} />
          <span className="toggle-track" />
        </label>
      </div>

      {/* ── Theme ──────────────────────────────────────────────────────── */}
      <div className="form-field">
        <label className="form-label">Appearance</label>
        <div className="theme-picker">
          {['dark', 'light', 'system'].map((t) => (
            <button
              key={t}
              type="button"
              className={`theme-option${form.theme === t ? ' active' : ''}`}
              onClick={() => { set('theme', t); onThemeChange?.(t) }}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-save-row">
        <button type="submit" className="btn-primary">Save settings</button>
        {saved && <span className="save-feedback">✓ Saved</span>}
      </div>
    </form>
  )
}

const splitCsv = (str) =>
  str.split(',').map((s) => s.trim()).filter(Boolean)

const clamp = (val, min, max) =>
  Math.min(max, Math.max(min, parseInt(val, 10) || min))
