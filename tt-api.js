/* =========================================================
   TransferTracker — model access layer
   ---------------------------------------------------------
   One call site for every model request in the app.

   Two transports, tried in order:
     1. PROXY_URL — your deployed Worker/Vercel function. Works anywhere.
     2. Direct call to api.anthropic.com — only works inside the Claude
        artifact sandbox, which injects credentials.

   The probe result is cached, so the app knows up front whether AI
   features are available and can hide them rather than letting a
   student fill out a form that was never going to work.
   ========================================================= */

const TT_API = (() => {

  // ---- configure this ----------------------------------------------------
  // After deploying: wrangler deploy → https://transfertracker-proxy.<you>.workers.dev
  //                  vercel --prod   → https://<project>.vercel.app/api/claude
  const PROXY_URL = 'transfertracker.alexjahanlal.workers.dev';   // leave '' to run artifact-only

  const MODEL = 'claude-sonnet-4-6';

  let transport = null;   // 'proxy' | 'direct' | 'none'
  let probing = null;

  function endpoint() {
    return transport === 'proxy' ? PROXY_URL : 'https://api.anthropic.com/v1/messages';
  }

  async function tryPost(url, payload, timeoutMs = 20000) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctl.signal,
      });
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  /* Cheap round-trip to learn which transport works. Called once at load. */
  async function probe() {
    if (probing) return probing;
    probing = (async () => {
      const ping = { model: MODEL, max_tokens: 4, messages: [{ role: 'user', content: 'hi' }] };

      if (PROXY_URL) {
        try {
          const r = await tryPost(PROXY_URL, ping, 8000);
          if (r.ok) { transport = 'proxy'; return transport; }
        } catch { /* fall through */ }
      }
      try {
        const r = await tryPost('https://api.anthropic.com/v1/messages', ping, 8000);
        if (r.ok) { transport = 'direct'; return transport; }
      } catch { /* fall through */ }

      transport = 'none';
      return transport;
    })();
    return probing;
  }

  function available() { return transport === 'proxy' || transport === 'direct'; }
  function transportName() { return transport; }

  /* Collapse a response into plain text, ignoring non-text blocks. */
  function textOf(data) {
    return (data?.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();
  }

  /* Parse a JSON reply, tolerating markdown fences and stray prose. */
  function jsonOf(data) {
    let t = textOf(data).replace(/```json\s*|```/g, '').trim();
    try { return JSON.parse(t); } catch { /* try harder */ }
    const s = t.indexOf('{'), e = t.lastIndexOf('}');
    if (s !== -1 && e > s) {
      try { return JSON.parse(t.slice(s, e + 1)); } catch { /* give up */ }
    }
    return null;
  }

  /**
   * Send a request.
   * @param {Array}  messages  Anthropic message array
   * @param {Object} opts      { system, maxTokens, timeoutMs }
   * @returns {Promise<{ok:boolean, data?:object, error?:string}>}
   */
  async function send(messages, opts = {}) {
    if (transport === null) await probe();
    if (!available()) {
      return { ok: false, error: 'AI features are offline. The rest of the planner still works.' };
    }

    const payload = {
      model: MODEL,
      max_tokens: opts.maxTokens || 1500,
      messages,
    };
    if (opts.system) payload.system = opts.system;

    try {
      const res = await tryPost(endpoint(), payload, opts.timeoutMs || 45000);
      if (!res.ok) {
        let msg = `Request failed (${res.status}).`;
        try { const e = await res.json(); if (e.error) msg = typeof e.error === 'string' ? e.error : msg; } catch {}
        if (res.status === 429) msg = 'Too many requests right now. Wait a minute and try again.';
        return { ok: false, error: msg };
      }
      return { ok: true, data: await res.json() };
    } catch (e) {
      const aborted = e && e.name === 'AbortError';
      return { ok: false, error: aborted ? 'That took too long. Try a shorter document.' : 'Could not reach the model service.' };
    }
  }

  return { probe, available, transportName, send, textOf, jsonOf, MODEL };
})();

if (typeof module !== 'undefined') module.exports = TT_API;
