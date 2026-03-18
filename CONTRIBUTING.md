# Contributing — NoTweet

Welcome! Here's everything you need to start contributing.

---

## Getting started

### 1. Clone and install

```bash
git clone <repo-url>
cd notweet
npm install
```

### 2. Start watch mode

```bash
npm run dev
```

This watches all files and rebuilds automatically on every change.

### 3. Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `dist/` folder
4. After each rebuild → click the refresh icon on the NoTweet card

---

## Project structure

```
src/
├── background/
│   ├── background.js   ← Service Worker (Claude calls, storage, routing)
│   └── prompts.js      ← Claude prompt templates
├── content/
│   ├── content.js      ← Reply loop
│   ├── typer.js        ← Typing simulation
│   └── observer.js     ← Tweet DOM detection
├── ui/
│   ├── App.jsx         ← React root
│   └── components/     ← UI components
└── shared/
    ├── constants.js    ← Shared constants
    └── utils.js        ← Helper functions
```

---

## Code guidelines

- **No unnecessary comments** — code should be self-explanatory
- **Targeted changes only** — don't refactor code unrelated to your task
- **Test manually** before submitting — run the bot and verify the change works end-to-end

---

## Submitting a change

1. Create a branch: `git checkout -b feature/your-feature-name`
2. Make your changes
3. Run `npm run build` and confirm it succeeds
4. Stage only the files you changed: `git add <files>`
5. `git commit -m "Clear description of what changed and why"`
6. Open a Pull Request

---

## Reporting a bug

1. Open DevTools on the Twitter/X page (F12 → Console tab)
2. Copy any messages starting with `[NoTweet]`
3. Open an Issue with the error output and steps to reproduce

---

## Important notes

- **Never commit your API key** — add it in the extension Settings only
- The extension currently only works on Twitter/X
- Chrome MV3 uses a Service Worker — don't assume in-memory state survives; always use `chrome.storage.local` for anything that needs to persist
