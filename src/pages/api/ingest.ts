import type { APIRoute } from 'astro';
import { verifyAssertion } from 'node-app-attest';
import { createHash, createVerify } from 'node:crypto';
import { createRecord } from '../../lib/cloudkit';

/**
 * POST /api/ingest
 *
 * Receives analyzed site data from the Fractune iOS app.
 * Authentication: App Attest assertion OR API key (fallback during transition).
 *
 * Expected headers:
 *   x-fractune-receipt: signed receipt from /api/attest
 *   x-fractune-assertion: base64-encoded assertion from DCAppAttestService
 *   x-fractune-sign-count: current sign count
 *   -- OR --
 *   x-fractune-api-key: static API key (deprecated, for transition only)
 */

const BUNDLE_ID = 'dk.coloursbybarslund.Fractune';

// In-memory rate limiting (burst protection per instance).
// API key / App Attest is the primary access control.
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;

interface IngestPayload {
  contributorID: string;
  metricsJSON: string;
  geoLat?: number;
  geoLon?: number;
  cameraHeading?: number;
  appVersion?: string;
  modelVersion?: string;
  consentVersion?: string;
  analyzedAt: string;
  // Building metadata (all optional)
  buildingName?: string;
  buildingAddress?: string;
  constructionYear?: number;
  architect?: string;
  buildingStyle?: string;
  buildingType?: string;
  metadataSource?: string;
  metadataSourceID?: string;
  metadataConfidence?: number;
  metadataUpdatedAt?: string;
  metadataUserEdited?: boolean;
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  // --- Authentication: try App Attest first, fall back to API key ---
  const receipt = request.headers.get('x-fractune-receipt');
  const assertion = request.headers.get('x-fractune-assertion');
  const signCountHeader = request.headers.get('x-fractune-sign-count');
  const apiKey = request.headers.get('x-fractune-api-key');
  const expectedKey = import.meta.env.FRACTUNE_INGEST_KEY;

  let authMethod: 'attest' | 'apikey' | null = null;
  let attestPublicKey: string | null = null;

  if (receipt && assertion && signCountHeader) {
    // Verify App Attest assertion
    const verifyResult = verifyReceipt(receipt);
    if (!verifyResult) {
      return errorResponse(403, 'Invalid receipt');
    }
    attestPublicKey = verifyResult.publicKey;

    try {
      const teamId = import.meta.env.MAPKIT_TEAM_ID;
      const requestBody = await request.clone().text();

      await verifyAssertion(
        Buffer.from(assertion, 'base64'),
        requestBody,
        attestPublicKey,
        BUNDLE_ID,
        teamId,
        parseInt(signCountHeader, 10),
      );
      authMethod = 'attest';
    } catch (err) {
      console.error('Assertion verification failed:', err);
      return errorResponse(403, 'Invalid assertion');
    }
  } else if (apiKey && expectedKey && apiKey === expectedKey) {
    // Fallback: static API key (transition period)
    authMethod = 'apikey';
  } else {
    return errorResponse(403, 'Forbidden — provide App Attest assertion or API key');
  }

  // --- Content validation ---
  const contentType = request.headers.get('content-type');
  if (!contentType?.includes('application/json')) {
    return errorResponse(400, 'Content-Type must be application/json');
  }

  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength) > 65_536) {
    return errorResponse(413, 'Payload too large');
  }

  let body: IngestPayload;
  try {
    body = authMethod === 'attest'
      ? JSON.parse(await request.clone().text()) // Already cloned above
      : await request.json();
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

  // Write to CloudKit
  try {
    await writeToCloudKit(body);
  } catch (err) {
    console.error('CloudKit write failed:', err);
    return errorResponse(502, 'Upstream error');
  }

  console.log(`Ingest: record accepted (auth=${authMethod}, contributor=${body.contributorID.substring(0, 8)}...)`);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

/**
 * Verify the signed receipt from /api/attest.
 * Returns the public key if valid, null if invalid or expired.
 */
function verifyReceipt(receipt: string): { publicKey: string; keyId: string } | null {
  const parts = receipt.split('.');
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  const message = `${header}.${payload}`;

  // Verify signature with server's CloudKit public key
  const privateKey = import.meta.env.CLOUDKIT_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!privateKey) return null;

  try {
    // Extract public key from private key for verification
    const verify = createVerify('SHA256');
    verify.update(message);
    // Note: we use the private key PEM which OpenSSL can extract the public key from
    const isValid = verify.verify(privateKey, signature, 'base64url');
    if (!isValid) return null;

    const payloadData = JSON.parse(Buffer.from(payload, 'base64url').toString());

    // Check expiration
    if (payloadData.exp && Date.now() > payloadData.exp) {
      console.warn('Receipt expired');
      return null;
    }

    // Check bundle ID
    if (payloadData.bundleId !== BUNDLE_ID) {
      console.warn('Receipt bundle ID mismatch');
      return null;
    }

    return {
      publicKey: payloadData.publicKey,
      keyId: payloadData.keyId,
    };
  } catch {
    return null;
  }
}

function validatePayload(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'Missing body';
  const b = body as Record<string, unknown>;

  if (typeof b.contributorID !== 'string' || b.contributorID.length === 0)
    return 'Missing or invalid contributorID';
  if (typeof b.metricsJSON !== 'string' || b.metricsJSON.length === 0)
    return 'Missing metricsJSON';
  if (typeof b.analyzedAt !== 'string')
    return 'Missing analyzedAt';

  // Location is optional (user may not have consented)
  if (b.geoLat != null && (typeof b.geoLat !== 'number' || b.geoLat < -90 || b.geoLat > 90))
    return 'Invalid geoLat';
  if (b.geoLon != null && (typeof b.geoLon !== 'number' || b.geoLon < -180 || b.geoLon > 180))
    return 'Invalid geoLon';

  // Building metadata validation (all optional, but validate if present)
  if (b.constructionYear != null) {
    if (typeof b.constructionYear !== 'number' || !Number.isInteger(b.constructionYear) || b.constructionYear < 1000 || b.constructionYear > 2100)
      return 'Invalid constructionYear (must be integer 1000–2100)';
  }
  if (b.metadataConfidence != null) {
    if (typeof b.metadataConfidence !== 'number' || b.metadataConfidence < 0 || b.metadataConfidence > 1)
      return 'Invalid metadataConfidence (must be 0.0–1.0)';
  }

  return null;
}

/** Trim string, return undefined if empty */
function trimOrNil(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

async function writeToCloudKit(payload: IngestPayload): Promise<void> {
  const fields: Record<string, any> = {
    contributorID: { value: payload.contributorID },
    metricsJSON: { value: payload.metricsJSON },
    createdAt: { value: new Date(payload.analyzedAt).getTime() },
  };

  // Optional core fields
  if (payload.geoLat != null) fields.geoLat = { value: payload.geoLat };
  if (payload.geoLon != null) fields.geoLon = { value: payload.geoLon };
  if (payload.cameraHeading != null) fields.cameraHeading = { value: payload.cameraHeading };
  if (payload.appVersion) fields.appVersion = { value: payload.appVersion };
  if (payload.modelVersion) fields.modelVersion = { value: payload.modelVersion };
  if (payload.consentVersion) fields.consentVersion = { value: payload.consentVersion };

  // Building metadata (all optional, trimmed)
  const name = trimOrNil(payload.buildingName);
  const address = trimOrNil(payload.buildingAddress);
  const architect = trimOrNil(payload.architect);
  const style = trimOrNil(payload.buildingStyle);
  const type = trimOrNil(payload.buildingType);
  const source = trimOrNil(payload.metadataSource);
  const sourceID = trimOrNil(payload.metadataSourceID);

  if (name) fields.buildingName = { value: name };
  if (address) fields.buildingAddress = { value: address };
  if (payload.constructionYear != null) fields.constructionYear = { value: payload.constructionYear };
  if (architect) fields.architect = { value: architect };
  if (style) fields.buildingStyle = { value: style };
  if (type) fields.buildingType = { value: type };
  if (source) fields.metadataSource = { value: source };
  if (sourceID) fields.metadataSourceID = { value: sourceID };
  if (payload.metadataConfidence != null) fields.metadataConfidence = { value: payload.metadataConfidence };
  if (payload.metadataUpdatedAt) fields.metadataUpdatedAt = { value: new Date(payload.metadataUpdatedAt).getTime() };
  if (payload.metadataUserEdited != null) fields.metadataUserEdited = { value: payload.metadataUserEdited ? 1 : 0 };

  await createRecord('Research', fields);

  console.log(`CloudKit: wrote Research record (contributor=${payload.contributorID.substring(0, 8)}..., hasLocation=${payload.geoLat != null}, building=${name || 'unnamed'})`);
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
