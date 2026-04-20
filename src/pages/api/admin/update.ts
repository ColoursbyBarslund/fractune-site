import type { APIRoute } from 'astro';
import { updateRecord } from '../../../lib/cloudkit';
import { verifyAdminToken } from './auth';

/**
 * POST /api/admin/update
 * Update a Research record. Supports:
 *   - hide/unhide (hidden field)
 *   - move (geoLat/geoLon)
 *   - edit metadata (buildingName, architect, etc.)
 */

interface UpdateRequest {
  recordName: string;
  fields: Record<string, any>;
}

export const POST: APIRoute = async ({ request }) => {
  const token = request.headers.get('x-admin-token');
  if (!token || !verifyAdminToken(token)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body: UpdateRequest = await request.json().catch(() => null as any);
  if (!body?.recordName || !body?.fields) {
    return new Response(JSON.stringify({ error: 'Missing recordName or fields' }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Map plain values to CloudKit field format { value: ... }
  const ckFields: Record<string, any> = {};
  for (const [key, val] of Object.entries(body.fields)) {
    if (val === null || val === undefined) continue;
    ckFields[key] = { value: val };
  }

  try {
    await updateRecord(body.recordName, 'Research', ckFields);
    console.log(`Admin update: ${body.recordName} — fields: ${Object.keys(ckFields).join(', ')}`);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Admin update failed:', err);
    return new Response(JSON.stringify({ error: 'Update failed', detail: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
