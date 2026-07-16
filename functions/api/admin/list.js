// GET /api/admin/list — all submissions for the review UI. Access-gated (requireIdentity, fail-closed).
// Read-only; returns every row ordered by category then created_at (expect < 100 rows, no pagination).
import { json, error } from '../_lib/respond.js';
import { requireIdentity, AuthError } from '../_lib/identity.js';

export async function onRequestGet({ request, env }) {
  try {
    const me = await requireIdentity(request, env);  // 403 (AuthError) if not an authenticated reviewer
    if (!env.DB) return error('Database not configured.', 503);

    const { results } = await env.DB.prepare(
      `SELECT id, created_at, updated_at, name, email, portfolio_url, category, reflection,
              review_status, reviewer_notes, reviewed_by, reviewed_at
         FROM submissions
        ORDER BY category, created_at`
    ).all();

    return json({ ok: true, reviewer: me, submissions: results || [] }, 200, { 'Cache-Control': 'no-store' });
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, 403);
    console.log('admin/list failed:', e && e.name ? e.name : 'error'); // no PII
    return error('Failed to load submissions.', 500);
  }
}
