// PUBLIC submission endpoint for the Gonzaga Portfolio Competition — POST /api/submit.
// Un-gated (any student may submit). Enforces the open-flag + deadline server-side, validates every
// field, and UPSERTs into D1 keyed on (email, category): one entry per category per student, so a
// re-submission of the SAME category updates that entry (last write wins) rather than adding a duplicate.
// Different categories = separate rows. This also caps a single identity to at most 4 rows (one per
// category), bounding table-flooding abuse. Stores student PII (name + email) — review it only through
// the (Access-gated) admin path in DEPLOY.md.
//
// Bot protection is REQUIRED: the endpoint fails closed until TURNSTILE_SECRET is set (503) and a
// valid Turnstile token accompanies each submission (else 403). See DEPLOY.md to configure the keys.
import { json, error, clean, isEmail } from './_lib/respond.js';
import { verifyTurnstile } from './_lib/turnstile.js';

const CATEGORIES = new Set(['business', 'personal', 'design', 'problem-solving']);
const MAX_BODY_BYTES = 64 * 1024;   // reject oversized bodies BEFORE parsing (memory/DoS guard)
const MAX_REFLECTION = 5000;        // hard server cap; the field is also sliced to this length

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) return error('Submissions are temporarily unavailable.', 503);

    // ── Hard server-side gate: explicit early close, or past the deadline. The form checks these too,
    //    but the server is the source of truth — a late/stale POST is rejected regardless of the page. ──
    if (env.SUBMISSIONS_OPEN === 'false') return error('Submissions are closed.', 403);
    if (env.DEADLINE_ISO) {
      const deadline = Date.parse(env.DEADLINE_ISO);
      if (Number.isFinite(deadline) && Date.now() > deadline) {
        return error('The submission deadline has passed.', 403);
      }
    }

    // ── Body-size guard: cap the request before reading it into memory. ──
    const declaredLen = Number(request.headers.get('content-length') || 0);
    if (declaredLen > MAX_BODY_BYTES) return error('Your submission is too large.', 413);

    const ct = request.headers.get('content-type') || '';
    const body = ct.includes('application/json')
      ? await request.json().catch(() => ({}))
      : Object.fromEntries((await request.formData()).entries());
    const get = (k) => body[k];

    // ── Bot gate (REQUIRED). Fails closed: no secret configured → 503; missing/invalid token → 403. ──
    if (!env.TURNSTILE_SECRET) return error('Submissions are temporarily unavailable.', 503);
    const turnstileToken = get('cf-turnstile-response') || get('turnstileToken');
    const turnstileIp = request.headers.get('CF-Connecting-IP') || '';
    if (!(await verifyTurnstile(env, turnstileToken, turnstileIp))) {
      return error('Please complete the bot check, then submit again.', 403);
    }

    // ── Validate every field SERVER-SIDE (the client checks are a courtesy only). ──
    const name = clean(get('name'), 200);
    let email = clean(get('email'), 300);
    const portfolio_url = clean(get('portfolio_url') || get('url'), 500);
    const category = clean(get('category'), 40).toLowerCase();
    const reflection = clean(get('reflection'), MAX_REFLECTION);

    if (!name) return error('Please enter your name.');
    if (!isEmail(email)) return error('Please enter a valid email address.');
    let parsedUrl;
    try { parsedUrl = new URL(portfolio_url); } catch { parsedUrl = null; }
    if (!parsedUrl) {
      return error('Please enter a valid portfolio URL (starting with https://).');
    }
    if (parsedUrl.protocol !== 'https:') {
      return error("Portfolio URL must use https. If your site is currently http-only, you'll need to enable https before submitting.");
    }
    if (!CATEGORIES.has(category)) return error('Please choose a category.');
    if (reflection.length < 20) return error('Please share a little about what you learned and how you grew.');

    email = email.toLowerCase();                 // normalize so the (email, category) dedup key is reliable
    const now = new Date().toISOString();

    // UPSERT on (email, category). On re-submit of the same category we update the entry but PRESERVE
    // created_at and all reviewer state (review_status / reviewer_notes / reviewed_by / reviewed_at are
    // intentionally not touched). Minimal-PII: we persist only what the entry itself needs.
    const res = await env.DB.prepare(
      `INSERT INTO submissions
         (created_at, updated_at, name, email, portfolio_url, category, reflection)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(email, category) DO UPDATE SET
         updated_at    = excluded.updated_at,
         name          = excluded.name,
         portfolio_url = excluded.portfolio_url,
         reflection    = excluded.reflection`
    ).bind(now, now, name, email, portfolio_url, category, reflection).run();

    return json({ ok: true, id: res.meta?.last_row_id ?? null });
  } catch (e) {
    // Never echo internal error text (could leak schema/config). Log server-side WITHOUT PII.
    console.log('submit failed:', e && e.name ? e.name : 'error');
    return error('Something went wrong saving your submission. Please try again.', 500);
  }
}
