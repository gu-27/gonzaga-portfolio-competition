// Cloudflare Access identity for the review UI. Every /api/admin/* request must carry a valid Access
// JWT (set by Access at the edge, NOT by the browser). Verifies RS256 signature against the team's
// Access public keys + exp (+ aud when ACCESS_AUD is configured), then enforces a hardcoded reviewer
// allowlist — belt-and-suspenders on top of the Access application policy. Any failure → AuthError (403).
// Ported from inwai-followup/functions/api/_lib/auth.js (which is ported from gscg-brain _auth.js).
//
// Trusts ONLY the Access JWT for identity — never a client-supplied email/header/body.
//
// LOCAL DEV ONLY: set ACCESS_JWT_VERIFY="off" to DECODE-only (skip signature check) so the update path
// can be exercised without Cloudflare signing. It still requires a token, checks exp, and enforces the
// allowlist — only the signature is skipped. NEVER set it in production; unset (default) = full verify.

// Keep this list in sync with the Cloudflare Access policy (see DEPLOY.md → Review UI).
const REVIEWERS = new Set([
  'correia@gonzaga.edu',
  'lebretj@gonzaga.edu',
  'reesee2@gonzaga.edu',
]);

// Access team domain. Overridable via env.ACCESS_TEAM_DOMAIN; hardcoded default so no env is required.
const DEFAULT_TEAM_DOMAIN = 'frosty-voice-866c.cloudflareaccess.com';

export class AuthError extends Error {
  constructor(message) { super(message); this.name = 'AuthError'; this.status = 403; }
}

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function decodeSegment(seg) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(seg)));
}

function readToken(request) {
  const h = request.headers.get('Cf-Access-Jwt-Assertion');
  if (h) return h.trim();
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// Accept a full team domain, a bare team name, or either with a scheme/trailing slash — one
// canonicalizer prevents the "…cloudflareaccess.com.cloudflareaccess.com" domain-doubling failure.
function certsUrl(teamEnv) {
  let t = (teamEnv || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!t) throw new AuthError('Access team domain is empty.');
  if (!t.includes('.')) t = `${t}.cloudflareaccess.com`;
  return `https://${t}/cdn-cgi/access/certs`;
}

let _jwks = null; // immutable across the isolate — safe to memoize
async function jwks(team) {
  if (_jwks) return _jwks;
  const r = await fetch(certsUrl(team));
  if (!r.ok) throw new AuthError(`Access certs fetch failed (${r.status})`);
  _jwks = (await r.json()).keys || [];
  return _jwks;
}

async function verifySignature(token, team, aud) {
  const [h, p, s] = token.split('.');
  const header = decodeSegment(h);
  const payload = decodeSegment(p);
  // aud is only enforced when configured (recommended — see DEPLOY.md).
  if (aud) {
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(aud)) throw new AuthError('JWT aud mismatch');
  }
  if (!payload.exp || Date.now() / 1000 > payload.exp) throw new AuthError('JWT expired');
  const keys = await jwks(team);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new AuthError('no matching Access signing key');
  const key = await crypto.subtle.importKey(
    'jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
  );
  const data = new TextEncoder().encode(`${h}.${p}`);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(s), data);
  if (!ok) throw new AuthError('JWT signature invalid');
  return payload;
}

// Returns the authenticated reviewer email (lowercased) or throws AuthError (→ 403). Fail-closed.
export async function requireIdentity(request, env) {
  const token = readToken(request);
  if (!token || token.split('.').length !== 3) {
    throw new AuthError('No Cloudflare Access identity on request.');
  }

  let payload;
  if (env && env.ACCESS_JWT_VERIFY === 'off') {
    // DECODE-ONLY (local dev). Signature is NOT checked; exp + allowlist still are. Never in production.
    payload = decodeSegment(token.split('.')[1]);
    if (!payload.exp || Date.now() / 1000 > payload.exp) throw new AuthError('JWT expired');
  } else {
    const team = (env && env.ACCESS_TEAM_DOMAIN) || DEFAULT_TEAM_DOMAIN;
    const aud = (env && env.ACCESS_AUD) || null;
    payload = await verifySignature(token, team, aud);
  }

  const email = (payload.email || (payload.identity && payload.identity.email) || payload.sub || '')
    .toString().trim().toLowerCase();
  if (!email) throw new AuthError('Access identity has no email claim.');
  if (!REVIEWERS.has(email)) throw new AuthError('Not an authorized reviewer.');
  return email;
}
