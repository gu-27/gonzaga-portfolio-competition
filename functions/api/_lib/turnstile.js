// Cloudflare Turnstile verification — optional bot gate on the public submit endpoint.
// Only CALLED when TURNSTILE_SECRET is set (see submit.js); when called it fails CLOSED
// (a missing/invalid token is rejected). Local dev can use Cloudflare's "always passes"
// test secret: 1x0000000000000000000000000000000AA.

export async function verifyTurnstile(env, token, remoteIp) {
  if (!env.TURNSTILE_SECRET) throw new Error('Turnstile is not configured (need TURNSTILE_SECRET).');
  if (!token) return false;
  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET);
  body.append('response', token);
  if (remoteIp) body.append('remoteip', remoteIp);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  });
  if (!res.ok) return false;
  const data = await res.json().catch(() => ({}));
  return data.success === true;
}
