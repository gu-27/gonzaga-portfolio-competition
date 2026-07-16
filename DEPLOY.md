# Deploy — Submission tool (Cloudflare Pages + D1)

The site is static, but the **Submit** page needs Cloudflare to store entries. It runs as a
Cloudflare **Pages Function** (`functions/api/submit.js`) that writes each entry to a **D1**
database. GitHub Pages cannot run this — the site must be served by **Cloudflare Pages**.

Fields captured per entry: `name`, `email`, `portfolio_url`, `category`
(`business` | `personal` | `design` | `problem-solving`), `reflection`
("what you learned and how you grew"). One row per entry; students may submit again for
another category. Deadline **August 24, 2026 · 11:59pm Pacific** is enforced server-side.

---

## One-time setup

**0. Prereqs** — `wrangler` is installed; log in once:
```bash
wrangler login
```

**1. Create the D1 database**, then paste the returned id into `wrangler.toml` (`database_id`):
```bash
wrangler d1 create gpc_submissions
```

**2. Create the table** (run both — local is for `pages dev`, remote is production):
```bash
wrangler d1 execute gpc_submissions --local  --file=./migrations/0001_init.sql
wrangler d1 execute gpc_submissions --remote --file=./migrations/0001_init.sql
```

**3. Test locally:**
```bash
wrangler pages dev .
```
Open the printed URL, go to `/submit.html`, submit a test entry, then confirm it landed:
```bash
wrangler d1 execute gpc_submissions --local --command="SELECT id, name, category FROM submissions"
```

**4. Deploy.** Either:
- **Direct upload** (simplest): `wrangler pages deploy .`
- **Git integration:** connect this repo to a Pages project → Build command: *(none)* →
  Build output directory: `/`. Bindings/vars come from `wrangler.toml`; if your setup needs
  them in the dashboard, add a D1 binding named **`DB`** → `gpc_submissions`, and vars
  `SUBMISSIONS_OPEN=true`, `DEADLINE_ISO=2026-08-24T23:59:59-07:00`.

---

## Required before launch: Turnstile bot protection

Turnstile is **ON (required)** — the form will not accept submissions until you configure it.
The endpoint fails closed: no secret → `503`, missing/invalid token → `403`.

1. Cloudflare dashboard → **Turnstile** → add a widget for your site's domain. You get a
   **site key** (public) and a **secret key** (private).
2. Paste the **site key** into `submit.html`, replacing `REPLACE_WITH_TURNSTILE_SITE_KEY`
   (`var TURNSTILE_SITE_KEY = '...'`).
3. Set the **secret key** as a Pages secret:
   ```bash
   wrangler pages secret put TURNSTILE_SECRET
   ```

For local testing, Cloudflare's always-pass test keys work: site `1x00000000000000000000AA`,
secret `1x0000000000000000000000000000000AA`.

> **IMPORTANT:** Cloudflare Pages environment variables and secrets bind at deploy time. Setting or
> changing `TURNSTILE_SECRET` (or any env var) does NOT affect the currently-running deployment — you
> must redeploy afterward for the change to take effect. Set secrets BEFORE deploying, or redeploy
> after any secret change. Symptom if you forget: `/api/submit` returns 503 "Submissions are
> temporarily unavailable" even though the secret shows as set in the dashboard.

---

## Rate Limiting (Cloudflare WAF)

Turnstile stops bots; these WAF rules bound raw request volume per IP as defense-in-depth.
They are Cloudflare zone config (not code), documented here so they can be re-created exactly
if the project ever migrates.

> **NOTE:** Cloudflare rate limiting rules require a zone (a domain in your account). They cannot be
> configured for a bare `*.pages.dev` URL. These rules become available only if/when a custom domain
> is attached. Until then, Turnstile plus the `UNIQUE(email, category)` dedup constraint are the
> active abuse controls.

**Where to click:** Cloudflare dashboard → pick the account → open the site's **zone/domain** →
**Security** → **WAF** → **Rate limiting rules** tab → **Create rule**. (On some plans it appears
as **Security** → **Rate limiting rules** directly, without the WAF sub-tab.)

**Rule 1 — primary (challenge bursts)**
- Name: `gpc-submit-burst`
- When incoming requests match: field **URI Path** · operator **equals** · value `/api/submit`
  (optionally AND field **Request Method** equals `POST`)
- Rate: **5** requests per **1 minute**, "with the same" characteristic **IP**
- Then take action: **Managed Challenge**

**Rule 2 — backstop (block sustained abuse)**
- Name: `gpc-submit-hourly`
- When incoming requests match: field **URI Path** · operator **equals** · value `/api/submit`
  (optionally AND field **Request Method** equals `POST`)
- Rate: **30** requests per **1 hour**, "with the same" characteristic **IP**
- Then take action: **Block**

If the project migrates to a new zone, re-create both rules with these exact values.

---

## Reviewing / judging submissions

Read everything (newest first):
```bash
wrangler d1 execute gpc_submissions --remote \
  --command="SELECT id, created_at, name, email, category, portfolio_url FROM submissions ORDER BY created_at DESC"
```

One category, with reflections:
```bash
wrangler d1 execute gpc_submissions --remote \
  --command="SELECT name, portfolio_url, reflection FROM submissions WHERE category='design' ORDER BY created_at"
```

Export to a file for a spreadsheet / the review team:
```bash
wrangler d1 execute gpc_submissions --remote --json \
  --command="SELECT * FROM submissions ORDER BY category, created_at" > submissions.json
```

> **PII:** entries contain student names + emails. Keep exports off shared drives, and if you
> want an in-browser review screen instead of the CLI, put it behind **Cloudflare Access** and
> verify the JWT in the Function (see the `pages-functions-and-access-jwt` pattern) — ask and
> I'll build it.

---

## Closing submissions

- **Automatic:** after `DEADLINE_ISO`, the server rejects new entries and the form shows a
  "closed" message.
- **Early close:** set the Pages var `SUBMISSIONS_OPEN=false` (redeploy or update in the
  dashboard) — no code change needed.
