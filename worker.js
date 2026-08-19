/**
 * TransferTracker API proxy — Cloudflare Worker
 *
 * Why this exists: the browser app cannot hold an Anthropic API key. Inside the
 * Claude artifact sandbox a keyless fetch to api.anthropic.com is injected with
 * credentials automatically; everywhere else that request fails. This Worker is
 * the "everywhere else" path.
 *
 * Deploy:
 *   npm install -g wrangler
 *   wrangler login
 *   wrangler secret put ANTHROPIC_API_KEY      # paste key when prompted
 *   wrangler deploy
 *
 * Then set PROXY_URL in the app to the deployed workers.dev URL.
 */

const ALLOWED_MODELS = new Set(['claude-sonnet-4-6']);
const MAX_BODY_BYTES = 6 * 1024 * 1024;  // PDFs arrive base64-encoded
const MAX_TOKENS_CAP = 4000;
const RATE_LIMIT = 20;                   // requests per window, per IP
const RATE_WINDOW_MS = 60_000;

// In-memory limiter. Resets when the isolate recycles, which is fine for a
// demo — swap for Durable Objects or KV if this ever sees real traffic.
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now - rec.start > RATE_WINDOW_MS) {
    hits.set(ip, { start: now, n: 1 });
    return false;
  }
  rec.n += 1;
  if (hits.size > 5000) hits.clear();   // crude memory ceiling
  return rec.n > RATE_LIMIT;
}

function cors(origin, allowed) {
  const ok = allowed.includes('*') || allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? (origin || '*') : allowed[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());
    const ch = cors(origin, allowed);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: ch });
    if (request.method !== 'POST') {
      return json({ error: 'Send a POST request to this endpoint.' }, 405, ch);
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (rateLimited(ip)) {
      return json({ error: 'Too many requests. Wait a minute and try again.' }, 429, ch);
    }

    let body;
    try {
      const raw = await request.text();
      if (raw.length > MAX_BODY_BYTES) {
        return json({ error: 'That document is too large. Try pasting the text instead of the PDF.' }, 413, ch);
      }
      body = JSON.parse(raw);
    } catch {
      return json({ error: 'Request body was not valid JSON.' }, 400, ch);
    }

    if (!ALLOWED_MODELS.has(body.model)) {
      return json({ error: 'Unsupported model.' }, 400, ch);
    }
    body.max_tokens = Math.min(Number(body.max_tokens) || 1000, MAX_TOKENS_CAP);

    // Strip anything the client has no business setting.
    delete body.mcp_servers;
    delete body.metadata;

    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: 'Proxy is missing its API key. Run: wrangler secret put ANTHROPIC_API_KEY' }, 500, ch);
    }

    try {
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      const text = await upstream.text();
      return new Response(text, {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json', ...ch },
      });
    } catch (err) {
      return json({ error: 'Could not reach the model service. Try again in a moment.' }, 502, ch);
    }
  },
};
