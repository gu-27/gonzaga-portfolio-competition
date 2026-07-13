// Shared response + input helpers for all Functions.

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

export function error(message, status = 400) {
  return json({ ok: false, error: String(message) }, status);
}

// Collapse control chars to single spaces; trim; cap length. Used on every field written to D1.
export function clean(value, max = 4000) {
  return String(value == null ? '' : value)
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .trim()
    .slice(0, max);
}

export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}
