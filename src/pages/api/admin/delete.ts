import type { APIRoute } from 'astro';
import { deleteRecords } from '../../../lib/cloudkit';
import { verifyAdminToken } from './auth';

/**
 * POST /api/admin/delete
 * Delete one or more Research records from CloudKit.
 * Requires admin token.
 */
export const POST: APIRoute = async ({ request }) => {
  const token = request.headers.get('x-admin-token');
  if (!token || !verifyAdminToken(token)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await request.json().catch(() => null);
  if (!body?.recordNames || !Array.isArray(body.recordNames) || body.recordNames.length === 0) {
    return new Response(JSON.stringify({ error: 'Missing recordNames array' }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Safety: max 50 records per request
  if (body.recordNames.length > 50) {
    return new Response(JSON.stringify({ error: 'Max 50 records per request' }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const result = await deleteRecords(body.recordNames, 'Research');
    console.log(`Admin delete: ${result.deleted} deleted, ${result.errors} errors`);

    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Admin delete failed:', err);
    return new Response(JSON.stringify({ error: 'Delete failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
