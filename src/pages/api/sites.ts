import type { APIRoute } from 'astro';
import { queryRecords, CLOUDKIT_ENV } from '../../lib/cloudkit';

/**
 * GET /api/sites
 * Returns all public site records from CloudKit (Research record type).
 * Used by the sites.fractune.dk map view.
 */
export const GET: APIRoute = async ({ url }) => {
  try {
    const includeHidden = url.searchParams.get('includeHidden') === 'true';
    const allSites = await fetchSitesFromCloudKit();
    const sites = includeHidden ? allSites : allSites.filter(s => !s.hidden);

    return new Response(JSON.stringify({ sites, source: sites.length > 0 ? 'cloudkit' : 'empty', env: CLOUDKIT_ENV }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300, s-maxage=600',
      },
    });
  } catch (err) {
    console.error('Error fetching sites:', err);
    return new Response(JSON.stringify({
      error: 'Failed to fetch sites',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

interface SiteRecord {
  id: string;
  latitude: number;
  longitude: number;
  dValue: number;
  analyzedAt?: string;
  buildingSelectionMode?: string;
  buildingGate?: string;
  // Building metadata
  buildingName?: string;
  buildingAddress?: string;
  constructionYear?: number;
  architect?: string;
  buildingStyle?: string;
  buildingType?: string;
  // Admin
  hidden?: boolean;
  contributorID?: string;
}

async function fetchSitesFromCloudKit(): Promise<SiteRecord[]> {
  let records: any[];
  try {
    records = await queryRecords('Research');
  } catch (err) {
    // If CloudKit is not configured, return empty
    if (String(err).includes('not configured')) {
      console.warn('CloudKit not configured — returning empty array');
      return [];
    }
    throw err;
  }

  const sites: SiteRecord[] = [];

  for (const record of records) {
    try {
      const fields = record.fields;
      if (!fields) continue;

      const lat = fields.geoLat?.value;
      const lon = fields.geoLon?.value;

      if (lat == null || lon == null) continue;
      if (lat === 0 && lon === 0) continue;

      let dValue: number | null = null;
      let buildingGate: string | undefined;
      let buildingSelectionMode: string | undefined;

      if (fields.metricsJSON?.value) {
        try {
          const json = JSON.parse(fields.metricsJSON.value);
          dValue = json.metrics?.D ?? json.D ?? json.dValue ?? null;
          buildingGate = json.building?.gate;
          buildingSelectionMode = json.building?.selectionMode;
        } catch {
          console.warn(`Failed to parse metricsJSON for record ${record.recordName}`);
        }
      }

      if (dValue == null) continue;

      let analyzedAt: string | undefined;
      if (fields.createdAt?.value) {
        analyzedAt = new Date(fields.createdAt.value).toISOString();
      } else if (record.created?.timestamp) {
        analyzedAt = new Date(record.created.timestamp).toISOString();
      }

      sites.push({
        id: record.recordName,
        latitude: lat,
        longitude: lon,
        dValue,
        analyzedAt,
        buildingSelectionMode,
        buildingGate,
        buildingName: fields.buildingName?.value || undefined,
        buildingAddress: fields.buildingAddress?.value || undefined,
        constructionYear: fields.constructionYear?.value || undefined,
        architect: fields.architect?.value || undefined,
        buildingStyle: fields.buildingStyle?.value || undefined,
        buildingType: fields.buildingType?.value || undefined,
        hidden: fields.hidden?.value === 1,
        contributorID: fields.contributorID?.value || undefined,
      });
    } catch (err) {
      console.warn(`Skipping record ${record.recordName}:`, err);
    }
  }

  const noLocation = records.length - sites.length;
  console.log(`CloudKit (${CLOUDKIT_ENV}): ${records.length} total, ${sites.length} with location+D, ${noLocation} skipped`);
  return sites;
}
