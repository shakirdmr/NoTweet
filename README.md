# NoTweet

A Chrome MV3 extension that automatically replies to tweets in Twitter/X communities using the Claude AI API.

## What it does

- Scrolls your Twitter/X feed like a human
- Picks tweets from communities you care about
- Generates short, natural-sounding replies via Claude
- Types and submits replies automatically
- Remembers which tweets it already replied to (7-day memory)
- Respects configurable daily limits and delays between replies

---

## Setup

### 1. Build the extension

```bash
git clone <repo-url>
cd notweet
npm install
npm run build
```

### 2. Load into Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `dist/` folder

### 3. Configure

Open the extension panel → go to **Settings**:

| Setting | Description |
|---------|-------------|
| Claude API Key | Your key from [console.anthropic.com](https://console.anthropic.com) |
| My Handle | Your Twitter handle without @ — used for reply-back detection |
| Keywords | Only reply to tweets containing these words (empty = reply to anyone) |
| Accounts | Only reply to specific accounts (empty = anyone) |
| Daily limit | Max replies to send per day |
| Min / Max delay | Minutes to wait between replies |
| Auto-submit | Automatically click Reply after typing |
| Auto-like | Like the tweet before replying |

### 4. Run

Go to any Twitter/X community feed → open the extension → click **Start**.

---

## Tech stack

- Chrome MV3 — Service Worker + Content Script
- React 18 — side panel rendered inside Shadow DOM
- Vite — build tool
- Claude API — reply generation

---

## Development

```bash
npm run build    # full build
npm run dev      # watch mode (rebuilds on file change)
```

After each build, go to `chrome://extensions` and click the refresh icon on the NoTweet card.
