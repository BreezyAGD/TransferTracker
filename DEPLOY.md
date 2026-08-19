# Deploying from GitHub to Cloudflare

Two pieces deploy separately from the same repo:

| Piece | Directory | Cloudflare product |
|---|---|---|
| The app (static) | `public/` | Pages |
| The API proxy | `worker/` | Workers |

Do the Worker first — the app depends on it.

---

## Step 1 — Push this repo to GitHub

If you have the GitHub CLI:

```bash
gh repo create transfertracker --public --source=. --remote=origin --push
```

Otherwise, create an empty repo at github.com/new (no README, no .gitignore —
this repo already has them), then:

```bash
git remote add origin https://github.com/YOUR-USERNAME/transfertracker.git
git branch -M main
git push -u origin main
```

---

## Step 2 — Deploy the Worker

### Option A: Git-connected (matches "select a repository")

1. `dash.cloudflare.com` → **Workers & Pages** → **Create** → **Workers** → **Import a repository**
2. Authorize GitHub, pick `transfertracker`
3. Set these build settings:
   - **Root directory:** `worker`
   - **Build command:** *(leave empty)*
   - **Deploy command:** `npx wrangler deploy`
4. Create, then wait for the first build

### Option B: CLI (faster, fewer moving parts)

```bash
cd worker
npx wrangler login
npx wrangler deploy
```

### Then add the API key — required either way

The key is a secret and is never stored in this repo.

**Dashboard:** your Worker → **Settings** → **Variables and Secrets** →
**Add** → type **Secret** → name `ANTHROPIC_API_KEY` → paste value → Deploy

**Or CLI:**
```bash
cd worker && npx wrangler secret put ANTHROPIC_API_KEY
```

Copy your Worker URL — it looks like
`https://transfertracker-proxy.YOUR-SUBDOMAIN.workers.dev`

### Verify

```bash
curl -X POST https://transfertracker-proxy.YOUR-SUBDOMAIN.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-6","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}'
```

A normal Claude JSON response means it works. If you get
`"Proxy is missing its API key"`, the secret didn't save — redo the step above.

---

## Step 3 — Point the app at the Worker

Edit `public/modules/tt-api.js`:

```js
const PROXY_URL = 'https://transfertracker-proxy.YOUR-SUBDOMAIN.workers.dev';
```

Commit and push:

```bash
git commit -am "Point app at deployed proxy" && git push
```

---

## Step 4 — Deploy the app (Pages)

1. `dash.cloudflare.com` → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git**
2. Pick `transfertracker`
3. Build settings:
   - **Framework preset:** None
   - **Build command:** *(leave empty)*
   - **Build output directory:** `public`
4. Save and Deploy

You get `https://transfertracker.pages.dev`. Every push to `main` redeploys.

Open it. The placeholder page self-tests: it confirms the modules loaded, runs
a live AP rule check, and reports whether model access works and over which
transport. All green means you're wired correctly.

---

## Step 5 — Lock down CORS before submitting

Right now any site can call your Worker and spend your API budget.

Edit `worker/wrangler.toml`:

```toml
ALLOWED_ORIGINS = "https://transfertracker.pages.dev"
```

Push (Git-connected) or run `npx wrangler deploy` from `worker/`.

Then reload your Pages URL and confirm the check still passes.

---

## Step 6 — Ship the real app

Replace `public/index.html` with the TransferTracker app file, keeping these
three script tags in this order:

```html
<script src="./modules/tt-api.js"></script>
<script src="./modules/ap-credit.js"></script>
<script src="./modules/assist-import.js"></script>
```

Commit, push, done.

---

## Troubleshooting

**CORS error in the console** — `ALLOWED_ORIGINS` doesn't exactly match your
Pages URL. No trailing slash, and `https://` included.

**500, "missing its API key"** — run `npx wrangler secret list` in `worker/`
to confirm `ANTHROPIC_API_KEY` is there.

**429** — the rate limiter (20 requests/minute/IP). Expected under testing,
harmless in a demo.

**Pages deploys but shows a file list** — build output directory isn't set to
`public`.

**Worker build fails on Git deploy** — root directory must be `worker`, and
deploy command `npx wrangler deploy`.
