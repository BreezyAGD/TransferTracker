/**
 * TransferTracker API proxy — Vercel serverless function.
 * Use this OR the Cloudflare Worker, not both.
 *
 * Deploy:
 *   npm i -g vercel
 *   vercel                       # from the proxy/ directory
 *   vercel env add ANTHROPIC_API_KEY
 *   vercel --prod
 *
 * Endpoint lands at https://<project>.vercel.app/api/claude
 */

const ALLOWED_MODELS = new Set(['claude-sonnet-4-6']);
const MAX_TOKENS_CAP = 4000;

export const config = {
  api: { bodyParser: { sizeLimit: '6mb' } },
};

export default async function handler(req, res) {
  const allowed = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());
  const origin = req.headers.origin || '';
  const allowOrigin = allowed.includes('*') || allowed.includes(origin) ? (origin || '*') : allowed[0];

  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Send a POST request to this endpoint.' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

  if (!body || !ALLOWED_MODELS.has(body.model)) {
    return res.status(400).json({ error: 'Unsupported model.' });
  }
  body.max_tokens = Math.min(Number(body.max_tokens) || 1000, MAX_TOKENS_CAP);
  delete body.mcp_servers;
  delete body.metadata;

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Proxy is missing its API key. Run: vercel env add ANTHROPIC_API_KEY' });
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    const text = await upstream.text();
    res.status(upstream.status).setHeader('Content-Type', 'application/json').send(text);
  } catch {
    res.status(502).json({ error: 'Could not reach the model service. Try again in a moment.' });
  }
}
