import type { APIRoute } from 'astro';
import { queryRecords, deleteRecords } from '../../lib/cloudkit';

/**
 * POST /api/erasure
 *
 * GDPR/data erasure endpoint.
 * Receives a contributorID and deletes or anonymizes all associated records.
 */

interface ErasureRequest {
  contributorID: string;
  reason?: string;
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  // Guard: require API key to prevent unauthorized erasure requests
  const apiKey = request.headers.get('x-fractune-api-key');
  const expectedKey = import.meta.env.FRACTUNE_INGEST_KEY;
  if (!expectedKey || apiKey !== expectedKey) {
    return errorResponse(403, 'Forbidden');
  }

  const contentType = request.headers.get('content-type');
  if (!contentType?.includes('application/json')) {
    return errorResponse(400, 'Content-Type must be application/json');
  }

  let body: ErasureRequest;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Invalid JSON');
  }

  if (typeof body.contributorID !== 'string' || body.contributorID.length === 0) {
    return errorResponse(422, 'Missing or invalid contributorID');
  }

  const auditEntry = {
    timestamp: new Date().toISOString(),
    contributorID: hashContributorID(body.contributorID),
    clientAddress,
    reason: body.reason || 'User requested data deletion',
    status: 'pending' as const,
  };

  console.log('Erasure request received:', auditEntry);

  try {
    await processErasure(body.contributorID);
  } catch (err) {
    console.error('Erasure processing failed:', err);
    return errorResponse(502, 'Erasure request could not be processed');
  }

  return new Response(
    JSON.stringify({
      ok: true,
      message: 'Erasure request received. All associated data will be removed within 30 days.',
      referenceId: auditEntry.timestamp,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};

async function processErasure(contributorID: string): Promise<void> {
  // 1. Query all Research records for this contributor
  const records = await queryRecords('Research', [{
    fieldName: 'contributorID',
    comparator: 'EQUALS',
    fieldValue: { value: contributorID },
  }]);

  if (records.length === 0) {
    console.log(`Erasure: no records found for contributor ${hashContributorID(contributorID)}`);
    return;
  }

  // 2. Delete all matching records
  const recordNames = records.map((r: any) => r.recordName);
  const result = await deleteRecords(recordNames, 'Research');

  console.log(`Erasure: deleted ${result.deleted} records, ${result.errors} errors for contributor ${hashContributorID(contributorID)}`);

  if (result.errors > 0) {
    throw new Error(`Failed to delete ${result.errors} of ${recordNames.length} records`);
  }
}

function hashContributorID(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    const char = id.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `contrib_${Math.abs(hash).toString(36)}`;
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
