# Architecture — NoTweet

## Overview

The extension has three main parts that communicate via Chrome message passing:

```
┌─────────────────────────────────────────────────────┐
│                   Twitter/X Page                    │
│                                                     │
│  ┌──────────────────┐     ┌────────────────────┐    │
│  │  Content Script  │────▶│   Side Panel (UI)  │    │
│  │  (content.js)    │     │   (React + Shadow) │    │
│  └────────┬─────────┘     └────────────────────┘    │
│           │ chrome.runtime messages                  │
│  ┌────────▼─────────┐                               │
│  │  Service Worker  │ ◀── Claude API                 │
│  │  (background.js) │                               │
│  └──────────────────┘                               │
└─────────────────────────────────────────────────────┘
```

---

## Part 1: Content Script

**Files:** `src/content/content.js`, `src/content/typer.js`, `src/content/observer.js`

Runs directly inside the Twitter/X page.

### What it does

1. **Watches for tweets** — uses `MutationObserver` to detect new tweets appearing in the DOM
2. **Picks a tweet** — filters by keywords and accounts from settings
3. **Requests a reply** — sends the tweet text to the Service Worker which calls Claude
4. **Types the reply** — opens the reply compose box and types character by character
5. **Submits** — clicks the Reply button

### Reply loop

```
startReplyLoop()
    ↓
scheduleNextReply()  ← waits min–max minutes
    ↓
runReplyLoop()
    ↓
Is there an unseen tweet?
    ↓ yes
typeReply()  ← types and submits
    ↓
scheduleNextReply()  ← wait again
```

---

## Part 2: Service Worker (Background)

**Files:** `src/background/background.js`, `src/background/prompts.js`

Runs in the background even when the page is briefly closed.

### What it does

- **Calls Claude API** — sends tweet text, receives a suggested reply
- **Persists data** — stores stats, seen tweets, and settings in `chrome.storage.local`
- **Routes messages** — receives requests from the Content Script and UI, responds to each

### Storage layout

```
chrome.storage.local
│
├── settings        ← user settings (API key, limits, delay...)
├── state           ← bot state (reply counts, seen tweets...)
├── log             ← last 100 activity entries
└── replybackQueue  ← queue of replies to reply-backs on user's own posts
```

---

## Part 3: UI (Side Panel)

**Files:** `src/ui/`

A React app rendered inside **Shadow DOM** so its styles never conflict with Twitter's.

### Tabs

- **Status** — shows stats, current activity, and Start/Stop controls
- **Settings** — edit all bot settings
- **Log** — view recent activity
- **Correct** — manually improve tweets before posting

---

## Message flow

```
Content Script  ──GENERATE_REPLY──▶  Background  ──▶  Claude API
Content Script  ◀──────reply text──  Background  ◀──  Claude

Content Script  ──LOG_OUTBOUND────▶  Background  (saves to storage)
Background      ──STATUS_UPDATE───▶  UI Panel    (updates counters)
```

---

## Key files

| File | Purpose |
|------|---------|
| `src/content/content.js` | Main reply loop |
| `src/content/typer.js` | Human-like typing simulation |
| `src/content/observer.js` | DOM tweet detection |
| `src/background/background.js` | Background logic and storage |
| `src/background/prompts.js` | Claude prompts |
| `src/shared/constants.js` | Shared constants across all contexts |
| `src/ui/components/SidePanel.jsx` | Main UI component |
