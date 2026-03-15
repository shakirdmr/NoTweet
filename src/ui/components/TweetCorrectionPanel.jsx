import React, { useState, useEffect } from 'react'
import { MSG, STORE } from '../../shared/constants.js'

const PRESETS = [
  {
    label:  'Professional',
    prompt: 'Rewrite this tweet to sound professional and polished. Keep it concise and impactful. Return only the improved tweet text.',
  },
  {
    label:  'Casual',
    prompt: 'Rewrite this tweet in a casual, friendly, conversational tone. Keep it natural. Return only the improved tweet text.',
  },
  {
    label:  'Punchy',
    prompt: 'Make this tweet punchier, more attention-grabbing, and engaging. Cut the fluff. Return only the improved tweet text.',
  },
  {
    label:  'Grammar only',
    prompt: 'Fix any grammar, spelling, and punctuation errors in this tweet. Keep the original wording and tone exactly. Return only the corrected tweet text.',
  },
]

export default function TweetCorrectionPanel() {
  const [form, setForm] = useState({
    correctionEnabled: false,
    correctionPrompt:  '',
  })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    chrome.storage.local.get(STORE.SETTINGS, (result) => {
      const s = result[STORE.SETTINGS]
      if (!s) return
      setForm({
        correctionEnabled: s.correctionEnabled ?? false,
        correctionPrompt:  s.correctionPrompt  ?? '',
      })
    })
  }, [])

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setSaved(false)
  }

  function applyPreset(prompt) {
    setForm((prev) => ({ ...prev, correctionPrompt: prompt }))
    setSaved(false)
  }

  function handleSave(e) {
    e.preventDefault()
    chrome.storage.local.get(STORE.SETTINGS, (result) => {
      const current = result[STORE.SETTINGS] ?? {}
      const updated = {
        ...current,
        correctionEnabled: form.correctionEnabled,
        correctionPrompt:  form.correctionPrompt.trim(),
      }
      chrome.runtime.sendMessage({ type: MSG.SAVE_SETTINGS, payload: updated }, () => {
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
      })
    })
  }

  return (
    <form className="settings-form" onSubmit={handleSave}>

      {/* ── Enable toggle ──────────────────────────────────────────────── */}
      <div className="form-field">
        <div className="form-toggle-row">
          <div className="toggle-label">
            <span className="toggle-name">Enable tweet correction</span>
            <span className="toggle-desc">
              Shows "✨ Improve" whenever you open the Twitter compose box.
            </span>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" checked={form.correctionEnabled}
              onChange={(e) => set('correctionEnabled', e.target.checked)} />
            <span className="toggle-track" />
          </label>
        </div>
      </div>

      {/* ── Tone presets ───────────────────────────────────────────────── */}
      <div className="form-field">
        <label className="form-label">Tone presets</label>
        <div className="theme-picker">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className={`theme-option${form.correctionPrompt === p.prompt ? ' active' : ''}`}
              onClick={() => applyPreset(p.prompt)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="form-hint">Click a preset to auto-fill the prompt below.</span>
      </div>

      {/* ── Custom prompt ──────────────────────────────────────────────── */}
      <div className="form-field">
        <label className="form-label" htmlFor="nt-correction-prompt">Custom prompt</label>
        <textarea
          id="nt-correction-prompt"
          className="form-input form-textarea"
          rows={4}
          placeholder="e.g. Fix grammar and make this tweet more engaging. Keep the same tone."
          value={form.correctionPrompt}
          onChange={(e) => set('correctionPrompt', e.target.value)}
        />
        <span className="form-hint">
          Leave blank to use the default: "Fix grammar, improve clarity, and make this tweet more engaging."
        </span>
      </div>

      <div className="settings-save-row">
        <button type="submit" className="btn-primary">Save</button>
        {saved && <span className="save-feedback">✓ Saved</span>}
      </div>

    </form>
  )
}
