/**
 * NoTweet — Cloudflare Worker API Proxy
 *
 * Proxies requests to the Anthropic API so the real API key never
 * touches the browser extension. The extension sends a lightweight
 * shared secret instead; the worker holds the actual key as an
 * environment variable set via `wrangler secret put`.
 *
 * Routes:
 *   GET  /ping  → 200 "ok"  (health check / keepalive)
 *   POST /      → proxy to https://api.anthropic.com/v1/messages
 *
 * Required environment variables (set with `wrangler secret put`):
 *   ANTHROPIC_API_KEY  — your Anthropic API key
 *   PROXY_SECRET       — a random shared secret known only to your extension
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-proxy-secret',
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)

    // ── Preflight ──────────────────────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    // ── Health check ───────────────────────────────────────────────────────
    if (request.method === 'GET' && pathname === '/ping') {
      return new Response('ok', {
        status:  200,
        headers: { ...CORS_HEADERS, 'content-type': 'text/plain' },
      })
    }

    // ── Only POST / is valid beyond this point ─────────────────────────────
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })
    }

    // ── Authenticate with shared secret ────────────────────────────────────
    const secret = request.headers.get('x-proxy-secret')
    if (!env.PROXY_SECRET || secret !== env.PROXY_SECRET) {
      return new Response('Unauthorized', { status: 401, headers: CORS_HEADERS })
    }

    // ── Forward to Anthropic ───────────────────────────────────────────────
    let body
    try {
      body = await request.text()
    } catch {
      return new Response('Bad request', { status: 400, headers: CORS_HEADERS })
    }

    const upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key':         env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body,
    })

    const responseBody = await upstream.text()

    return new Response(responseBody, {
      status:  upstream.status,
      headers: {
        ...CORS_HEADERS,
        'content-type': upstream.headers.get('content-type') || 'application/json',
      },
    })
  },
}
