import { createHash, createSign } from 'node:crypto';

const CLOUDKIT_BASE = 'https://api.apple-cloudkit.com';
const CLOUDKIT_ENV = 'development'; // Switch to 'production' when app is in App Store

interface CloudKitConfig {
  containerId: string;
  keyId: string;
  privateKey: string;
}

function getConfig(): CloudKitConfig | null {
  const containerId = import.meta.env.CLOUDKIT_CONTAINER_ID;
  const keyId = import.meta.env.CLOUDKIT_KEY_ID;
  const privateKeyPem = import.meta.env.CLOUDKIT_PRIVATE_KEY;

  if (!containerId || !keyId || !privateKeyPem) return null;

  let formattedKey = privateKeyPem.replace(/\\n/g, '\n');
  if (!formattedKey.includes('-----BEGIN')) {
    formattedKey = `-----BEGIN EC PRIVATE KEY-----\n${formattedKey}\n-----END EC PRIVATE KEY-----`;
  }

  return { containerId, keyId, privateKey: formattedKey };
}

/**
 * Send a signed request to CloudKit server-to-server API.
 */
async function signedRequest(subpath: string, body: string, config: CloudKitConfig): Promise<Response> {
  const isoDate = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const bodyHash = createHash('sha256').update(body, 'utf8').digest('base64');
  const message = `${isoDate}:${bodyHash}:${subpath}`;

  const sign = createSign('SHA256');
  sign.update(message);
  const signature = sign.sign(config.privateKey, 'base64');

  return fetch(`${CLOUDKIT_BASE}${subpath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      'X-Apple-CloudKit-Request-KeyID': config.keyId,
      'X-Apple-CloudKit-Request-ISO8601Date': isoDate,
      'X-Apple-CloudKit-Request-SignatureV1': signature,
    },
    body,
  });
}

/**
 * Query records from CloudKit public database.
 */
export async function queryRecords(recordType: string, filterBy?: any[], resultsLimit = 200): Promise<any[]> {
  const config = getConfig();
  if (!config) throw new Error('CloudKit not configured');

  const subpath = `/database/1/${config.containerId}/${CLOUDKIT_ENV}/public/records/query`;
  const body = JSON.stringify({
    query: { recordType, filterBy },
    resultsLimit,
  });

  const response = await signedRequest(subpath, body, config);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`CloudKit query failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data.records || [];
}

/**
 * Create a record in CloudKit public database.
 */
export async function createRecord(recordType: string, fields: Record<string, any>, recordName?: string): Promise<any> {
  const config = getConfig();
  if (!config) throw new Error('CloudKit not configured');

  const subpath = `/database/1/${config.containerId}/${CLOUDKIT_ENV}/public/records/modify`;

  const record: any = {
    recordType,
    fields,
  };

  if (recordName) {
    record.recordName = recordName;
  }

  const body = JSON.stringify({
    operations: [{
      operationType: 'create',
      record,
    }],
  });

  const response = await signedRequest(subpath, body, config);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`CloudKit create failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  if (data.records?.[0]?.serverErrorCode) {
    throw new Error(`CloudKit record error: ${data.records[0].serverErrorCode} — ${data.records[0].reason}`);
  }

  return data.records?.[0];
}

/**
 * Update fields on an existing record in CloudKit public database.
 */
export async function updateRecord(recordName: string, recordType: string, fields: Record<string, any>, recordChangeTag?: string): Promise<any> {
  const config = getConfig();
  if (!config) throw new Error('CloudKit not configured');

  const subpath = `/database/1/${config.containerId}/${CLOUDKIT_ENV}/public/records/modify`;

  const record: any = {
    recordName,
    recordType,
    fields,
  };

  // If we have a change tag, use it for optimistic locking
  if (recordChangeTag) {
    record.recordChangeTag = recordChangeTag;
  }

  const body = JSON.stringify({
    operations: [{
      operationType: 'forceUpdate',
      record,
    }],
  });

  const response = await signedRequest(subpath, body, config);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`CloudKit update failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  if (data.records?.[0]?.serverErrorCode) {
    throw new Error(`CloudKit update error: ${data.records[0].serverErrorCode} — ${data.records[0].reason}`);
  }

  return data.records?.[0];
}

/**
 * Delete records from CloudKit public database.
 */
export async function deleteRecords(recordNames: string[], recordType: string): Promise<{ deleted: number; errors: number }> {
  const config = getConfig();
  if (!config) throw new Error('CloudKit not configured');

  const subpath = `/database/1/${config.containerId}/${CLOUDKIT_ENV}/public/records/modify`;

  const operations = recordNames.map(recordName => ({
    operationType: 'delete' as const,
    record: { recordName, recordType },
  }));

  // CloudKit allows max 200 operations per request
  let deleted = 0;
  let errors = 0;

  for (let i = 0; i < operations.length; i += 200) {
    const batch = operations.slice(i, i + 200);
    const body = JSON.stringify({ operations: batch });

    const response = await signedRequest(subpath, body, config);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`CloudKit delete batch failed: ${errorText}`);
      errors += batch.length;
      continue;
    }

    const data = await response.json();
    for (const record of data.records || []) {
      if (record.serverErrorCode) {
        errors++;
      } else {
        deleted++;
      }
    }
  }

  return { deleted, errors };
}

export { CLOUDKIT_ENV };
