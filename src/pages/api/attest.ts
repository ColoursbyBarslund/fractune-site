import type { APIRoute } from 'astro';
import { verifyAttestation } from 'node-app-attest';
import { createHash, createSign } from 'node:crypto';
import { consumeNonce } from './challenge';

/**
 * POST /api/attest
 *
 * Receives an App Attest attestation from the iOS app.
 * Validates the attestation with Apple's certificate chain.
 * Returns a signed receipt containing the public key, which the app
 * must include in subsequent requests to /api/ingest.
 *
 * Flow:
 *   1. App calls DCAppAttestService.generateKey() → keyId
 *   2. App calls DCAppAttestService.attestKey(keyId, clientDataHash) → attestation
 *   3. App sends { keyId, attestation, challenge } to this endpoint
 *   4. Server validates attestation, extracts public key
 *   5. Server returns signed receipt { keyId, publicKey, attestedAt }
 *   6. App stores receipt and sends it with future /api/ingest calls
 */

interface AttestRequest {
  keyId: string;
  attestation: string; // base64-encoded attestation object
  challenge: string;   // the challenge string used to generate clientDataHash
}

const BUNDLE_ID = 'dk.coloursbybarslund.Fractune';

export const POST: APIRoute = async ({ request }) => {
  const contentType = request.headers.get('content-type');
  if (!contentType?.includes('application/json')) {
    return errorResponse(400, 'Content-Type must be application/json');
  }

  let body: AttestRequest;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Invalid JSON');
  }

  // Validate required fields
  if (!body.keyId || typeof body.keyId !== 'string') {
    return errorResponse(422, 'Missing keyId');
  }
  if (!body.attestation || typeof body.attestation !== 'string') {
    return errorResponse(422, 'Missing attestation');
  }
  if (!body.challenge || typeof body.challenge !== 'string') {
    return errorResponse(422, 'Missing challenge');
  }

  const teamId = import.meta.env.MAPKIT_TEAM_ID; // Same Apple Team ID
  const isDev = import.meta.env.CLOUDKIT_ENV === 'development' ||
                !import.meta.env.CLOUDKIT_ENV;

  if (!teamId) {
    console.error('Team ID not configured');
    return errorResponse(500, 'Server configuration error');
  }

  // Verify challenge is a valid server-generated nonce
  if (!consumeNonce(body.challenge)) {
    return errorResponse(403, 'Invalid or expired challenge — request a new one from GET /api/challenge');
  }

  try {
    // Decode base64 attestation to Buffer
    const attestationBuffer = Buffer.from(body.attestation, 'base64');

    // Verify attestation with Apple's certificate chain
    const result = await verifyAttestation(
      attestationBuffer,
      body.challenge,
      body.keyId,
      BUNDLE_ID,
      teamId,
      isDev, // allowDevelopmentEnvironment
    );

    // Create a signed receipt the app can use for future requests
    const receipt = createSignedReceipt(result.publicKey, body.keyId);

    console.log(`App Attest: device attested successfully (keyId: ${body.keyId.substring(0, 8)}...)`);

    return new Response(JSON.stringify({
      ok: true,
      receipt,
      signCount: 0, // Initial sign count
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Attestation verification failed:', err);
    return errorResponse(403, 'Attestation verification failed');
  }
};

/**
 * Creates a signed receipt containing the attested public key.
 * The receipt is a JWT-like structure: base64(header).base64(payload).signature
 * Signed with the server's CloudKit private key (ECDSA P-256).
 */
function createSignedReceipt(publicKey: string, keyId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'receipt' })).toString('base64url');

  const payload = Buffer.from(JSON.stringify({
    publicKey,
    keyId,
    bundleId: BUNDLE_ID,
    attestedAt: new Date().toISOString(),
    exp: Date.now() + (90 * 24 * 60 * 60 * 1000), // 90 days
  })).toString('base64url');

  const message = `${header}.${payload}`;

  const privateKey = import.meta.env.CLOUDKIT_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!privateKey) {
    throw new Error('Server signing key not configured');
  }

  const sign = createSign('SHA256');
  sign.update(message);
  const signature = sign.sign(privateKey, 'base64url');

  return `${message}.${signature}`;
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
