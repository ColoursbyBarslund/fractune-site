import type { APIRoute } from 'astro';
import { SignJWT, importPKCS8 } from 'jose';

/**
 * GET /api/mapkit-token
 *
 * Returns a short-lived MapKit JS JWT token.
 * Apple MapKit JS JWT spec:
 *   Header: { alg: ES256, kid: Key ID, typ: JWT }
 *   Payload: { iss: Team ID, iat, exp, origin (optional) }
 */
export const GET: APIRoute = async ({ request }) => {
  const teamId = import.meta.env.MAPKIT_TEAM_ID;
  const keyId = import.meta.env.MAPKIT_KEY_ID;
  const privateKey = import.meta.env.MAPKIT_PRIVATE_KEY;

  if (!teamId || !keyId || !privateKey) {
    console.error('MapKit credentials not configured');
    return new Response(JSON.stringify({ error: 'MapKit not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Ensure newlines are preserved (Vercel may store them as literal \n)
    const formattedKey = privateKey.replace(/\\n/g, '\n');
    const key = await importPKCS8(formattedKey, 'ES256');

    const token = await new SignJWT({})
      .setProtectedHeader({
        alg: 'ES256',
        kid: keyId,
        typ: 'JWT',
      })
      .setIssuer(teamId)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);

    return new Response(token, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 'private, max-age=3000',
      },
    });
  } catch (err) {
    console.error('Failed to generate MapKit token:', err);
    return new Response(JSON.stringify({ error: 'Token generation failed', detail: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
