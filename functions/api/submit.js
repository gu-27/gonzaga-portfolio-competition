// PUBLIC submission endpoint for the Gonzaga Portfolio Competition — POST /api/submit.
// Un-gated (any student may submit). Enforces the open-flag + deadline server-side, validates
// every field, and writes ONE row per entry to D1. Students may submit again for another category.
// Stores student PII (name + email) — review it only through the (Access-gated) admin path in DEPLOY.md.
//
// Bot protection is optional and OFF until you configure Turnstile: set the secret
// (`wrangler pages secret put TURNSTILE_SECRET`) AND paste the site key into submit.html. Once the
// secret is present this endpoint fails CLOSED on a missing/invalid token.
import { json, error, clean, isEmail } from './_lib/respond.js';
import { verifyTurnstile } from './_lib/turnstile.js';

const CATEGORIES = new Set(['business', 'personal', 'design', 'problem-solving']);

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) return error('Submissions are not configured yet (missing database binding).', 500);

    // Hard server-side gate: explicit early close, or past the deadline. The form also checks these,
    // but the server is the source of truth — a late POST is rejected even if the page is stale.
    if (env.SUBMISSIONS_OPEN === 'false') return error('Submissions are closed.', 403);
    if (env.DEADLINE_ISO) {
      const deadline = Date.parse(env.DEADLINE_ISO);
      if (Number.isFinite(deadline) && Date.now() > deadline) {
        return error('The submission deadline has passed.', 403);
      }
    }

    const ct = request.headers.get('content-type') || '';
    const body = ct.includes('application/json')
      ? await request.json().catch(() => ({}))
      : Object.fromEntries((await request.formData()).entries());
    const get = (k) => body[k];

    // Optional bot gate — only enforced once TURNSTILE_SECRET is configured.
    if (env.TURNSTILE_SECRET) {
      const token = get('cf-turnstile-response') || get('turnstileToken');
      const ip = request.headers.get('CF-Connecting-IP') || '';
      if (!(await verifyTurnstile(env, token, ip))) return error('Bot verification failed. Please try again.', 403);
    }

    const name = clean(get('name'), 200);
    const email = clean(get('email'), 300);
    const portfolio_url = clean(get('portfolio_url') || get('url'), 500);
    const category = clean(get('category'), 40).toLowerCase();
    const reflection = clean(get('reflection'), 5000);

    if (!name) return error('Please enter your name.');
    if (!isEmail(email)) return error('Please enter a valid email address.');
    if (!/^https?:\/\/.+\..+/i.test(portfolio_url)) {
      return error('Please enter a valid portfolio URL (starting with https://).');
    }
    if (!CATEGORIES.has(category)) return error('Please choose a category.');
    if (reflection.length < 20) {
      return error('Please share a little about what you learned and how you grew.');
    }

    const created_at = new Date().toISOString();
    const ip = request.headers.get('CF-Connecting-IP') || '';
    const country = (request.cf && request.cf.country) || '';
    const user_agent = clean(request.headers.get('user-agent'), 400);

    const res = await env.DB.prepare(
      `INSERT INTO submissions (created_at, name, email, portfolio_url, category, reflection, ip, country, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(created_at, name, email, portfolio_url, category, reflection, ip, country, user_agent).run();

    return json({ ok: true, id: res.meta?.last_row_id ?? null });
  } catch (e) {
    return error(e.message || 'Submission failed.', 500);
  }
}
