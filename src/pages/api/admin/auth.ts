import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import { TOTP, Secret } from 'otpauth';

/**
 * POST /api/admin/auth
 * Admin login with email + password + TOTP 2FA.
 * Returns a signed session token valid for 24 hours.
 */
export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body) {
    return errorResponse(400, 'Invalid request');
  }

  const { email, password, code } = body;

  const expectedEmail = import.meta.env.FRACTUNE_ADMIN_EMAIL;
  const expectedPassword = import.meta.env.FRACTUNE_ADMIN_PASSWORD;
  const totpSecret = import.meta.env.FRACTUNE_ADMIN_TOTP_SECRET;

  if (!expectedEmail || !expectedPassword || !totpSecret) {
    return errorResponse(500, 'Admin not configured');
  }

  // Step 1: Verify email
  if (!email || email.toLowerCase() !== expectedEmail.toLowerCase()) {
    return errorResponse(403, 'Invalid credentials');
  }

  // Step 2: Verify password
  if (!password || password !== expectedPassword) {
    return errorResponse(403, 'Invalid credentials');
  }

  // Step 3: Verify TOTP code
  if (!code || typeof code !== 'string') {
    return errorResponse(403, 'Invalid credentials');
  }

  const totp = new TOTP({
    issuer: 'Fractune',
    label: expectedEmail,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(totpSecret),
  });

  const delta = totp.validate({ token: code, window: 1 });
  if (delta === null) {
    return errorResponse(403, 'Invalid 2FA code');
  }

  // Create session token (valid for 24h)
  const today = new Date().toISOString().split('T')[0];
  const token = createHash('sha256').update(`${expectedPassword}:${totpSecret}:${today}`).digest('hex');

  return new Response(JSON.stringify({ ok: true, token }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

/** Verify admin token. Exported for use by other admin endpoints. */
export function verifyAdminToken(token: string): boolean {
  const password = import.meta.env.FRACTUNE_ADMIN_PASSWORD;
  const totpSecret = import.meta.env.FRACTUNE_ADMIN_TOTP_SECRET;
  if (!password || !totpSecret || !token) return false;

  const today = new Date().toISOString().split('T')[0];
  const validToken = createHash('sha256').update(`${password}:${totpSecret}:${today}`).digest('hex');
  return token === validToken;
}

/**
 * GET /api/admin/auth?setup=true
 * Returns TOTP setup URI (only works once, when no token exists yet).
 * Used to generate QR code for authenticator app.
 */
export const GET: APIRoute = async ({ url }) => {
  if (url.searchParams.get('setup') !== 'true') {
    return new Response('Not found', { status: 404 });
  }

  const email = import.meta.env.FRACTUNE_ADMIN_EMAIL;
  const totpSecret = import.meta.env.FRACTUNE_ADMIN_TOTP_SECRET;
  if (!email || !totpSecret) {
    return new Response('Not configured', { status: 500 });
  }

  const totp = new TOTP({
    issuer: 'Fractune',
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(totpSecret),
  });

  return new Response(JSON.stringify({ uri: totp.toString() }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
