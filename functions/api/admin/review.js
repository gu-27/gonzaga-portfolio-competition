// POST /api/admin/review — set review status + notes on a submission. Access-gated (fail-closed).
// Body: { id, review_status, reviewer_notes }. Records reviewed_by = authenticated email, reviewed_at = now.
// Touches ONLY reviewer fields — never the student-submitted data (name/email/portfolio_url/category/
// reflection/created_at) and never updated_at (that tracks student writes only).
import { json, error, clean } from '../_lib/respond.js';
import { requireIdentity, AuthError } from '../_lib/identity.js';

const STATUSES = new Set(['unreviewed', 'shortlisted', 'winner', 'disqualified']);

export async function onRequestPost({ request, env }) {
  try {
    const email = await requireIdentity(request, env);   // 403 if not an authenticated reviewer
    if (!env.DB) return error('Database not configured.', 503);

    const body = await request.json().catch(() => ({}));
    const id = Number(body.id);
    const review_status = clean(body.review_status, 20);
    const reviewer_notes = clean(body.reviewer_notes, 5000);

    if (!Number.isInteger(id) || id <= 0) return error('Invalid submission id.');
    if (!STATUSES.has(review_status)) return error('Invalid review_status.');

    const now = new Date().toISOString();
    const res = await env.DB.prepare(
      `UPDATE submissions
          SET review_status = ?, reviewer_notes = ?, reviewed_by = ?, reviewed_at = ?
        WHERE id = ?`
    ).bind(review_status, reviewer_notes, email, now, id).run();

    if (!res.meta || res.meta.changes === 0) return error('Submission not found.', 404);

    // Echo the updated reviewer state so the UI reflects exactly what landed.
    const row = await env.DB.prepare(
      `SELECT id, review_status, reviewer_notes, reviewed_by, reviewed_at FROM submissions WHERE id = ?`
    ).bind(id).first();

    return json({ ok: true, submission: row }, 200, { 'Cache-Control': 'no-store' });
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, 403);
    console.log('admin/review failed:', e && e.name ? e.name : 'error'); // no PII
    return error('Failed to save review.', 500);
  }
}
