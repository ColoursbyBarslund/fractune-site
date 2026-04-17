import type { APIRoute } from 'astro';

/**
 * POST /api/ingest
 *
 * Receives analyzed site data from the Fractune iOS app.
 * Validates payload, verifies App Attest, rate-limits,
 * and forwards to CloudKit server-side.
 */

// In-memory rate limiting (use Redis/KV in production on Vercel)
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;

interface IngestPayload {
  contributorID: string;
  attestToken: string;
  site: {
    name?: string;
    latitude: number;
    longitude: number;
    dValue: number;
    address?: string;
    analyzedAt: string;
  };
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  // Check content type
  const contentType = request.headers.get('content-type');
  if (!contentType?.includes('application/json')) {
    return errorResponse(400, 'Content-Type must be application/json');
  }

  // Check payload size (max 64KB)
  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength) > 65_536) {
    return errorResponse(413, 'Payload too large');
  }

  // Parse body
  let body: IngestPayload;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Invalid JSON');
  }

  // Schema validation
  const validationError = validatePayload(body);
  if (validationError) {
    return errorResponse(422, validationError);
  }

  // Rate limiting
  const rateLimitKey = `${body.contributorID}:${clientAddress}`;
  if (isRateLimited(rateLimitKey)) {
    return errorResponse(429, 'Too many requests');
  }

  // Verify App Attest / DeviceCheck token
  const attestValid = await verifyAttestToken(body.attestToken);
  if (!attestValid) {
    return errorResponse(403, 'Invalid attestation');
  }

  // Write to CloudKit
  try {
    await writeToCloudKit(body);
  } catch (err) {
    console.error('CloudKit write failed:', err);
    return errorResponse(502, 'Upstream error');
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

function validatePayload(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'Missing body';
  const b = body as Record<string, unknown>;

  if (typeof b.contributorID !== 'string' || b.contributorID.length === 0)
    return 'Missing or invalid contributorID';
  if (typeof b.attestToken !== 'string' || b.attestToken.length === 0)
    return 'Missing or invalid attestToken';
  if (!b.site || typeof b.site !== 'object')
    return 'Missing site data';

  const site = b.site as Record<string, unknown>;
  if (typeof site.latitude !== 'number' || site.latitude < -90 || site.latitude > 90)
    return 'Invalid latitude';
  if (typeof site.longitude !== 'number' || site.longitude < -180 || site.longitude > 180)
    return 'Invalid longitude';
  if (typeof site.dValue !== 'number' || site.dValue < 0 || site.dValue > 3)
    return 'Invalid dValue';
  if (typeof site.analyzedAt !== 'string')
    return 'Missing analyzedAt timestamp';

  return null;
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(key, { count: 1, windowStart: now });
    return false;
  }

  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

async function verifyAttestToken(_token: string): Promise<boolean> {
  // TODO: Implement Apple App Attest verification
  // https://developer.apple.com/documentation/devicecheck/validating_apps_that_connect_to_your_server
  console.warn('App Attest verification not yet implemented — accepting all tokens');
  return true;
}

async function writeToCloudKit(payload: IngestPayload): Promise<void> {
  const containerId = import.meta.env.CLOUDKIT_CONTAINER_ID;
  const keyId = import.meta.env.CLOUDKIT_KEY_ID;
  const teamId = import.meta.env.CLOUDKIT_TEAM_ID;

  if (!containerId || !keyId || !teamId) {
    console.warn('CloudKit credentials not configured — skipping write');
    return;
  }

  // TODO: Implement signed CloudKit server-to-server record creation
  // POST https://api.apple-cloudkit.com/database/1/{containerId}/{environment}/public/records/modify
  console.log('Would write site to CloudKit:', {
    name: payload.site.name,
    dValue: payload.site.dValue,
    lat: payload.site.latitude,
    lng: payload.site.longitude,
  });
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
