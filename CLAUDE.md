# Fractune Website — CLAUDE.md (working document)

This is the primary instruction document for an AI agent (or new developer) working on the Fractune website. The original brief is preserved further down as background. When this document and the code disagree, **the code wins** — update this document.

## 1. Project Overview

The Fractune website serves three purposes from a single Astro project:

1. **Landing page** (`fractune.dk`) — Apple-Review-compliant marketing site for the Fractune iOS app.
2. **Sites map** (`sites.fractune.dk`) — interactive Apple MapKit JS map showing analysed buildings worldwide. Plus an admin section for moderating contributed records.
3. **API endpoints** — server-side data ingest (App Attest verified) and a public read-only `/api/sites` for the map.

The iOS app submits research data here via App Attest-signed POST requests. Records are stored in Apple CloudKit (public database, container `iCloud.coloursbybarslund.fractune`, recordType `Research`).

## 2. Repository & Deployment

- **GitHub:** `ColoursbyBarslund/fractune-site`
- **Vercel project:** `fractune-dk`
- **Domains:** `fractune.dk`, `www.fractune.dk`, `sites.fractune.dk`, `fractune-dk.vercel.app`
- **Auto-deploy:** push to `main` → Vercel builds and deploys

## 3. Tech Stack

- **Framework:** Astro 6.1.7 with TypeScript (strict)
- **Rendering:** Server-side (`output: 'server'`)
- **Adapter:** `@astrojs/vercel`
- **Node:** ≥ 22.12
- **Map:** Apple MapKit JS (token generated server-side via `/api/mapkit-token`)
- **Database:** Apple CloudKit (public database) — server-to-server signed requests
- **iOS auth:** Apple App Attest (DCAppAttestService) — challenge → attestation → assertion
- **Admin auth:** email + password + TOTP 2FA (otpauth library)
- **JWT:** `jose` library for MapKit token + admin session token
- **App Attest verification:** `node-app-attest` library

## 4. File Structure (actual)

```
src/
├── middleware.ts              # Subdomain routing for sites.fractune.dk + /admin redirect
├── layouts/BaseLayout.astro   # Shared HTML shell (lang="en", apple-itunes-app meta)
├── styles/global.css          # Design system (Myriad Pro, #12283E accent)
├── lib/
│   └── cloudkit.ts            # CloudKit server-to-server: queryRecords, createRecord, signed requests
├── pages/
│   ├── index.astro            # Landing page (hero, features, how-it-works, footer)
│   ├── science.astro          # The Science of fractal fluence — D-value scale, research
│   ├── methodology.astro      # 301 redirect to /science#methodology
│   ├── privacy.astro          # Privacy policy (Apple Review requirement)
│   ├── terms.astro            # Terms of use
│   ├── support.astro          # FAQ / support
│   ├── license.astro          # Open-source / asset licenses
│   ├── sites/
│   │   ├── index.astro        # MapKit JS fullscreen map view
│   │   └── admin.astro        # Web admin: list/edit/flag/hide records
│   └── api/
│       ├── mapkit-token.ts    # GET: short-lived MapKit JS JWT (60s)
│       ├── sites.ts           # GET: all visible Research records for the map
│       ├── ingest.ts          # POST: receive analyzed site data (App Attest verified)
│       ├── challenge.ts       # POST: issue App Attest challenge nonce
│       ├── attest.ts          # POST: verify attestation, return signed receipt
│       ├── erasure.ts         # POST: GDPR erasure request handler
│       └── admin/
│           ├── auth.ts        # POST: admin login (email + password + TOTP)
│           ├── update.ts      # POST: admin edits a record's metadata/flag
│           └── delete.ts      # POST: admin deletes a record
public/
├── fonts/                     # Myriad Pro (light, regular, semibold .otf)
├── favicon.svg, favicon.ico, favicon-32.png, apple-touch-icon.png
├── logo.png                   # Fractune logo
└── varde-lethgori.jpg         # Hero photo (Varde Teater & Musikhus by Leth & Gori)
vercel.json                    # Security headers, output config
astro.config.mjs               # Vercel adapter, output: 'server'
.env.local                     # Local secrets (gitignored)
.env.example                   # Documented public env-var names (incomplete — see §8)
```

Approximate sizes (lines): `index.astro` 438, `science.astro` 497, `sites/index.astro` 622, `sites/admin.astro` 580, `api/ingest.ts` 285, `lib/cloudkit.ts` 203, `api/admin/auth.ts` 112, `api/erasure.ts` 109. Other files are small.

## 5. API Endpoints

### `/api/mapkit-token` — `GET`
Returns a short-lived (60-second) MapKit JS JWT signed with the MapKit private key (ES256). Used by `/sites/index.astro` to authenticate with Apple Maps. Origin claim is set from request header.

### `/api/sites` — `GET`
Returns visible (non-hidden) Research records from CloudKit, formatted as `SiteRecord[]`. Falls back to empty array if CloudKit is not configured (development mode). Cached `s-maxage=600`. Currently returns `dValue: number` per record; **F + dimension scores are added in Web Sprint 2**.

### `/api/ingest` — `POST`
Receives analyzed site data from the iOS app. Authentication: App Attest assertion (preferred) or static API key (deprecated transition fallback). Rate-limited per remote IP (10 req/min in-memory). Validates payload shape, signs receipt, writes to CloudKit. The `metricsJSON` field is opaque to the server but contains all metric values — including F + dimensions from iOS Sprint 7 onward.

### `/api/challenge` — `POST`
Issues a fresh nonce for App Attest challenge. Stored in-memory (per-instance) and consumed by `/api/attest`. Single-use, expires after 5 minutes.

### `/api/attest` — `POST`
Receives `{ keyId, attestation, challenge }` from the iOS app, validates against Apple's certificate chain via `node-app-attest`, extracts the public key, signs a receipt containing `{ keyId, publicKey, attestedAt }`. The app stores this receipt and includes it in subsequent `/api/ingest` calls.

### `/api/erasure` — `POST`
GDPR data deletion handler. Marks records for the contributorID as pending erasure, processed asynchronously by an admin or scheduled job.

### `/api/admin/auth` — `POST`
Admin login: email + password + TOTP 6-digit code. Returns a 24-hour signed session JWT (HS256). Credentials in env vars `FRACTUNE_ADMIN_EMAIL`, `FRACTUNE_ADMIN_PASSWORD`, `FRACTUNE_ADMIN_TOTP_SECRET`.

### `/api/admin/update` — `POST`
Authenticated admin updates a record's metadata fields (buildingName, address, architect, style, type, year, flag) or visibility (hidden/visible).

### `/api/admin/delete` — `POST`
Authenticated admin deletes a record entirely.

## 6. Auth Flows

### iOS → ingest (App Attest)

```
App generates AppAttest key → keyId
  ↓
App: POST /api/challenge → { challenge }
  ↓
App: clientDataHash = SHA256(challenge + keyId)
  ↓
App: DCAppAttestService.attestKey(keyId, clientDataHash) → attestation
  ↓
App: POST /api/attest { keyId, attestation, challenge }
  ↓
Server: verifyAttestation() → { publicKey } → sign receipt → return receipt
  ↓
App stores receipt (Keychain, 89-day lifetime)
  ↓
App: build payload → POST /api/ingest with headers:
  x-fractune-receipt: <signed receipt>
  x-fractune-assertion: DCAppAttestService.generateAssertion(keyId, payloadHash)
  x-fractune-sign-count: monotonic counter
  ↓
Server: verify receipt + assertion → write to CloudKit
```

### Admin → web admin (TOTP)

```
Admin: POST /api/admin/auth { email, password, code } → 24h session JWT
  ↓
Admin pages: include session JWT in Authorization header
  ↓
/api/admin/update + /api/admin/delete: verify session JWT before acting
```

## 7. Subdomain Routing

`sites.fractune.dk` is handled via Astro middleware (`src/middleware.ts`), not via Vercel rewrites:

- If `host` starts with `sites.`, paths are rewritten: `/` → `/sites/`, `/admin` → `/sites/admin`. API calls (`/api/*`) are not rewritten.
- If `host` is the apex `fractune.dk` and path is `/admin`, the middleware redirects (302) to `https://sites.fractune.dk/admin`.

This keeps the admin pages bound to the sites subdomain while letting the API run on either domain.

## 8. Environment Variables

`.env.example` is currently incomplete — the actual variables consumed by the code:

```
# MapKit JS (required for /sites map)
MAPKIT_TEAM_ID=7PFF5A75N3
MAPKIT_KEY_ID=AXKZMYN4Z4
MAPKIT_PRIVATE_KEY=<.p8 file contents, with literal \n preserved>

# CloudKit server-to-server (required for /api/sites and /api/ingest)
CLOUDKIT_CONTAINER_ID=iCloud.coloursbybarslund.fractune
CLOUDKIT_KEY_ID=<server-to-server key ID>
CLOUDKIT_PRIVATE_KEY=<EC private key in PEM, with \n preserved>
CLOUDKIT_TEAM_ID=7PFF5A75N3

# Admin auth (required for /sites/admin)
FRACTUNE_ADMIN_EMAIL=<admin email>
FRACTUNE_ADMIN_PASSWORD=<admin password, hashed or plain depending on auth.ts>
FRACTUNE_ADMIN_TOTP_SECRET=<base32 TOTP secret, set up in authenticator app>
FRACTUNE_ADMIN_SESSION_SECRET=<HS256 secret for session JWT>

# Ingest fallback (deprecated transition)
FRACTUNE_INGEST_KEY=<static API key, used only if App Attest headers absent>
```

`.env.example` should be updated to include CLOUDKIT_PRIVATE_KEY and the admin/ingest variables — that's a low-priority chore.

## 9. CloudKit Integration

`src/lib/cloudkit.ts` exposes:

- `queryRecords(recordType: string, options?)` — reads records from public database via signed POST.
- `createRecord(recordType, fields)` — writes a new record.
- `CLOUDKIT_ENV` — currently `'development'`. Switch to `'production'` when the iOS app is in App Store.

Server-to-server signing: SHA256(date + bodyHash + subpath), signed with EC private key, sent as `X-Apple-CloudKit-Request-KeyID/-ISO8601Date/-SignatureV1`. If env vars missing, `getConfig()` returns null and the helpers gracefully no-op (return empty arrays / throw "not configured" errors that callers handle).

Records have type `Research` with these fields (camelCase as written by the iOS app):
- `metricsJSON` (String) — opaque JSON containing all metric values, including F + dimensions
- `geoLat`, `geoLon` (Double) — location
- `cameraHeading` (Double) — bearing
- `analyzedAt` (Date)
- `contributorID` (String)
- Building metadata: `buildingName`, `buildingAddress`, `architect`, `buildingStyle`, `buildingType`, `constructionYear`, `metadataSource`, etc.
- Admin: `adminFlag`, `isHidden`, `metadataUpdatedAt`, `metadataUserEdited`

The iOS app additionally sends `cameraJSON` (Donation capture metadata) and an optional `image` asset.

## 10. Design System

- **Font:** Myriad Pro (light 300, regular 400, semibold 600) — loaded as web fonts from `/fonts/`
- **Accent colour:** `#12283E` (dark navy) — matches the iOS app's `fractuneAccent` in light mode
- **Sweet-spot colour:** `#2A7D3F` green (matches iOS `fractuneSweetSpot`)
- **High-complexity warning:** `#BB4444` red (matches iOS `fractuneHigh`)
- **Style:** Minimalist, Apple-inspired. White backgrounds, frosted-glass nav/panels, pill-shaped buttons.
- **Language:** All UI text in English (the iOS app is in Danish; the website is the public-facing English presence).

## 11. Current Status

### Working
- Landing page complete (hero, features, privacy summary, footer)
- Privacy, terms, support, license pages
- `sites.fractune.dk` subdomain routing via middleware
- MapKit JS map loads and renders
- `/api/mapkit-token` generates valid 60s JWTs
- `/api/sites` reads from CloudKit (or returns empty if not configured)
- `/api/ingest` accepts both App Attest and API-key auth, rate-limits, writes to CloudKit
- `/api/challenge` + `/api/attest` — full App Attest flow implemented
- `/api/erasure` accepts GDPR deletion requests
- `/api/admin/auth` — email + password + TOTP 2FA
- `/api/admin/update` + `/api/admin/delete`
- `/sites/admin` — web admin UI for CloudKit records

### TODO (smaller items)
- **App Store ID placeholder** — `idXXXXXXXXXX` in `index.astro` line 28 and `app-id=XXXXXXXXXX` in `BaseLayout.astro` line 16. Replace once app is published.
- **Map markers rendering** — historical issue: `MarkerAnnotation` markers from `loadSites()` may not render reliably. Current code uses a `setTimeout(2000)` workaround. May or may not still be needed — verify in browser.
- **`.env.example` is incomplete** — does not list the CloudKit private key, admin variables, or ingest fallback key.

### TODO (Fractune 2.0 alignment — see §12)
The iOS app has migrated from D as headline metric to **Architectural Fluency F** with four dimensions (fractal, rhythm, chromatic, structure). The website still talks about "the D-value" everywhere. Five web-sprints address this — see the next section.

## 12. F-Migration Plan (Web Sprints 1–5)

Detailed sprint instructions live (or will live) in `docs/sprints/web-sprint-0X-*.md`. Sprint roadmap:

| Sprint | Content | User-visible? |
|---|---|---|
| 1 | This CLAUDE.md update — reflect actual implementation status, document API endpoints | No |
| 2 | API endpoints: `sites.ts` SiteRecord adds fValue + confidence + dimension scores; `ingest.ts` validates new metricsJSON fields | No (data shape change) |
| 3 | Existing content: `index.astro`, `science.astro`, `methodology.astro` migrated from D-centric to F-centric language | Yes (text-only) |
| 4 | New pages: `/architectural-fluency` (dedicated F page) and `/research` (curated reference list pulling from MetricInfoCatalog) | Yes (new pages) |
| 5 | Sites map: markers show F with sweet-spot colour, fallback "—" for legacy records without F. Possibly fix the markers-not-rendering bug at the same time | Yes (map UI) |

Web Sprint 1 is this document. Web Sprint 2 is the next deliverable.

## 13. Working Rules for the Agent

1. **Read the existing code first.** TypeScript-strict means types matter — when adding fields to `SiteRecord` or `IngestPayload`, update both the interface and any inference points.
2. **Preserve backwards compatibility.** Older records in CloudKit (pre-iOS-Sprint-7) lack F in their `metricsJSON`. Server code must tolerate missing fields. Use optional types and default-to-null pattern, not throws.
3. **Keep auth strict.** Don't relax App Attest verification. Don't add new endpoints that bypass admin auth. The static API key is a transition mechanism only.
4. **Astro server output.** All `/api/*.ts` files are server-side. They run on Vercel functions and can read `import.meta.env.*` for secrets. Don't accidentally expose secrets to the client.
5. **Subdomain awareness.** When adding new routes, consider whether they should be reachable on `fractune.dk`, `sites.fractune.dk`, or both. Middleware handles this — read it before adding routes that look like `/sites/something`.
6. **English in markup, Danish in conversation.** Page content is in English (international audience for the iOS app). Conversation with Anders can stay in Danish.
7. **Don't change the iOS app from here.** This repo is the website. The iOS app lives in `/Users/fardabar/Fractune` (separate Xcode workspace). Cross-references like the F formula or sweet-spot ranges should match the iOS implementation — when in doubt, refer to that repo's `CLAUDE.md` §13.
8. **CloudKit dev vs prod.** `CLOUDKIT_ENV` is hardcoded to `'development'` in `lib/cloudkit.ts`. When the iOS app ships to App Store, this single line flips to `'production'`. Don't forget.
9. **Vercel cold starts.** API endpoints run as serverless functions. In-memory state (rate-limit map, challenge nonces) does NOT persist across cold starts or instances. That's acceptable for current rate-limiting (best-effort burst protection) and challenges (single-use, 5-minute window) but is a known limitation if you ever need stricter guarantees.

## 14. Owner

Anders Barslund (anders@andersbarslund.com)
- Architect and colour consultant
- Apple-ecosystem-focused
- Native Danish; comfortable in English
- Prefers minimalist Apple-style design and direct technical communication

## 15. Commands

```bash
npm run dev      # Local dev server at localhost:4321
npm run build    # Production build (verifies types, bundles)
npm run preview  # Preview production build locally
```

## Apple Developer Details

- **Team:** Colours by Barslund ApS
- **Team ID:** `7PFF5A75N3`
- **App identifier:** `dk.coloursbybarslund.Fractune`
- **MapKit Key ID:** `AXKZMYN4Z4`
- **Maps ID:** `maps.dk.fractune`
- **CloudKit container:** `iCloud.coloursbybarslund.fractune`
