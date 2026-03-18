// ─── Message types ────────────────────────────────────────────────────────────
export const MSG = {
  // Content → Background
  TWEETS_AVAILABLE:  'TWEETS_AVAILABLE',  // new outbound tweets detected in DOM
  REPLY_TO_MY_POST:  'REPLY_TO_MY_POST',  // someone replied to the user's own tweet
  GET_STATUS:        'GET_STATUS',
  START_BOT:         'START_BOT',
  STOP_BOT:          'STOP_BOT',
  SAVE_SETTINGS:     'SAVE_SETTINGS',
  GET_LOG:           'GET_LOG',
  CLEAR_LOG:         'CLEAR_LOG',

  // Tweet correction (content ↔ background, direct sendMessage)
  CORRECT_TWEET:     'CORRECT_TWEET',

  // Content → Background: outbound reply loop (content script manages timing)
  GENERATE_REPLY:    'GENERATE_REPLY',  // ask Claude for a reply to a tweet
  LOG_OUTBOUND:      'LOG_OUTBOUND',    // report a sent reply; background updates counts
  LOG_ATTEMPT:       'LOG_ATTEMPT',     // report a skipped cycle (scroll / no match)
  LOG_FAILED:        'LOG_FAILED',      // report a failed reply attempt (API error, submit failed)
  CLEAR_ERROR:       'CLEAR_ERROR',     // clear stored error state

  // Background → Content (tab)
  STATUS_UPDATE:     'STATUS_UPDATE',
  LOG_UPDATE:        'LOG_UPDATE',
  TYPE_REPLY:        'TYPE_REPLY',   // background → content: type a replyback into the DOM
}

// ─── chrome.storage.local keys ───────────────────────────────────────────────
export const STORE = {
  SETTINGS:       'settings',
  STATE:          'state',
  LOG:            'log',
  REPLYBACK_QUEUE:  'replybackQueue',  // persisted so it survives service-worker sleep
}

// ─── Default values ───────────────────────────────────────────────────────────
export const DEFAULTS = {
  settings: {
    apiKey:         '',
    myHandle:       '',     // user's own handle (no @) — used to detect reply-backs
    keywords:       [],     // filter for outbound replies (empty = reply to anyone)
    accounts:       [],     // specific accounts to reply to (empty = anyone)
    outboundLimit:  5,      // max replies to community/timeline posts per night
    replybackLimit: 5,      // max reply-backs to replies on own posts per night
    autoSubmit:     false,
    autoReply:         true,   // generate & post AI replies
    autoLike:          false,  // automatically like tweets the bot processes
    theme:             'dark', // 'dark' | 'light' | 'system'
    correctionEnabled: false,  // show "✨ Improve" bar when compose box opens
    correctionPrompt:  '',     // empty = use built-in default prompt
    delayMin:          2,      // minutes to wait between outbound replies (min)
    delayMax:          3,      // minutes to wait between outbound replies (max)
    proxyUrl:          '',     // e.g. https://notweet-proxy.workers.dev (leave blank = direct)
    proxySecret:       '',     // shared secret for the proxy
  },
  state: {
    isRunning:      false,
    outboundCount:  0,      // replies sent to community posts today
    replybackCount: 0,      // reply-backs sent today
    failedCount:    0,      // failed reply attempts today
    lastReset:      null,
    seenTweets:     {},
    error:          null,
  },
  log: [],
  replybackQueue: [],
}

// ─── Timing ───────────────────────────────────────────────────────────────────
export const DELAY = {
  // Outbound (community) replies — 2–3 min gap so new tweets load and it feels human
  MIN_BETWEEN_REPLIES: 120,   // seconds
  MAX_BETWEEN_REPLIES: 180,   // seconds

  // Reply-backs to own post — quick, like you just saw it
  REPLYBACK_MIN_MS: 5_000,    // 5 seconds
  REPLYBACK_MAX_MS: 15_000,   // 15 seconds

  // Typing simulation
  CHAR_MIN_MS:       40,
  CHAR_MAX_MS:       140,
  BURST_MIN_MS:      300,
  BURST_MAX_MS:      700,
  BURST_EVERY:       6,
  PRE_SUBMIT_MIN_MS: 1000,
  PRE_SUBMIT_MAX_MS: 2500,
  REPLY_BOX_TIMEOUT: 4000,
}

// ─── Chrome alarm names ───────────────────────────────────────────────────────
export const ALARM_REPLYBACK = 'notweet_replyback'  // reply-back to own post
