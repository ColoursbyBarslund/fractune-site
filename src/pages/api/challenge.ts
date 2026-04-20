import type { APIRoute } from 'astro';
import { randomBytes } from 'node:crypto';

/**
 * GET /api/challenge
 *
 * Returns a server-generated nonce for App Attest attestation.
 * The nonce is a one-time-use random string.
 * The app must use this as the challenge when calling attestKey().
 *
 * In-memory store with 5-minute TTL. Nonce is consumed on use.
 * For production scale, migrate to Vercel KV.
 */

interface NonceEntry {
  nonce: string;
  createdAt: number;
}

// In-memory nonce store (per-instance, acceptable for low-traffic attestation)
const nonceStore = new Map<string, NonceEntry>();
const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Cleanup expired nonces periodically
function cleanupNonces() {
  const now = Date.now();
  for (const [key, entry] of nonceStore) {
    if (now - entry.createdAt > NONCE_TTL_MS) {
      nonceStore.delete(key);
    }
  }
}

export const GET: APIRoute = async () => {
  cleanupNonces();

  const nonce = randomBytes(32).toString('base64url');

  nonceStore.set(nonce, {
    nonce,
    createdAt: Date.now(),
  });

  return new Response(JSON.stringify({ challenge: nonce }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
};

/**
 * Verify and consume a nonce. Returns true if valid and not expired.
 * Exported for use by /api/attest.
 */
export function consumeNonce(nonce: string): boolean {
  const entry = nonceStore.get(nonce);
  if (!entry) return false;

  const isExpired = Date.now() - entry.createdAt > NONCE_TTL_MS;
  nonceStore.delete(nonce); // Always consume, even if expired

  return !isExpired;
}
