import type { APIRoute } from 'astro';

/**
 * GET /api/sites
 * Returns all public site records from CloudKit.
 * Used by the sites.fractune.dk map view.
 */
export const GET: APIRoute = async () => {
  try {
    const sites = await fetchSitesFromCloudKit();

    return new Response(JSON.stringify({ sites }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300, s-maxage=600',
      },
    });
  } catch (err) {
    console.error('Error fetching sites:', err);
    return new Response(JSON.stringify({ error: 'Failed to fetch sites' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

interface SiteRecord {
  name: string;
  latitude: number;
  longitude: number;
  dValue: number;
  address?: string;
  analyzedAt?: string;
  contributorID?: string;
}

async function fetchSitesFromCloudKit(): Promise<SiteRecord[]> {
  const containerId = import.meta.env.CLOUDKIT_CONTAINER_ID;
  const keyId = import.meta.env.CLOUDKIT_KEY_ID;
  const teamId = import.meta.env.CLOUDKIT_TEAM_ID;

  if (!containerId || !keyId || !teamId) {
    console.warn('CloudKit credentials not configured — returning demo data');
    return getDemoSites();
  }

  // TODO: Implement CloudKit server-to-server query
  // POST https://api.apple-cloudkit.com/database/1/{containerId}/{environment}/public/records/query
  // Signed request using server-to-server key.
  return getDemoSites();
}

function getDemoSites(): SiteRecord[] {
  return [
    {
      name: 'Rundetaarn',
      latitude: 55.6814,
      longitude: 12.5759,
      dValue: 1.423,
      address: 'Koebmagergade 52A, 1150 Koebenhavn',
      analyzedAt: '2026-03-15T10:30:00Z',
    },
    {
      name: 'Den Sorte Diamant',
      latitude: 55.6726,
      longitude: 12.5822,
      dValue: 1.187,
      address: 'Soeren Kierkegaards Plads 1, 1221 Koebenhavn',
      analyzedAt: '2026-03-22T14:15:00Z',
    },
    {
      name: 'Christiansborg Slot',
      latitude: 55.6761,
      longitude: 12.5801,
      dValue: 1.652,
      address: 'Prins Joergens Gaard 1, 1218 Koebenhavn',
      analyzedAt: '2026-04-01T09:00:00Z',
    },
    {
      name: 'Operaen',
      latitude: 55.6815,
      longitude: 12.6013,
      dValue: 1.312,
      address: 'Ekvipagemestervej 10, 1438 Koebenhavn',
      analyzedAt: '2026-04-05T16:45:00Z',
    },
    {
      name: '8 Tallet',
      latitude: 55.6313,
      longitude: 12.5571,
      dValue: 1.789,
      address: 'Richard Mortensens Vej 61, 2300 Koebenhavn',
      analyzedAt: '2026-04-10T11:20:00Z',
    },
  ];
}
