# Fractune Website — Project Guide

## Project Overview

This is the website for **Fractune**, an iOS app that analyses architectural complexity using fractal geometry (box-counting method → D-value). The site serves three purposes:

1. **Landing page** (`fractune.dk`) — Apple Review compliant app marketing site
2. **Sites map** (`sites.fractune.dk`) — Interactive Apple MapKit JS map showing analysed buildings with D-values
3. **API endpoints** — Server-side data ingest from the iOS app, replacing direct CloudKit writes

## Tech Stack

- **Framework:** Astro with TypeScript (strict)
- **Rendering:** Server-side (`output: 'server'`)
- **Adapter:** `@astrojs/vercel`
- **Deployment:** GitHub → Vercel (auto-deploy on push to `main`)
- **Map:** Apple MapKit JS (token generated server-side via `/api/mapkit-token`)
- **Database:** Apple CloudKit (public database) — not yet implemented server-side
- **Auth:** Apple App Attest / DeviceCheck — not yet implemented
- **JWT:** `jose` library for MapKit token generation

## Repository

- **GitHub:** `ColoursbyBarslund/fractune-site`
- **Vercel project:** `fractune-dk`
- **Domains:** `fractune.dk`, `www.fractune.dk`, `sites.fractune.dk`, `fractune-dk.vercel.app`

## Architecture

### Subdomain Routing

`sites.fractune.dk` is handled via Astro middleware (`src/middleware.ts`), not via `vercel.json` rewrites. The middleware checks the `host` header and rewrites requests to `/sites/*` routes.

### File Structure

```
src/
  layouts/BaseLayout.astro     — Shared HTML shell (lang="en")
  middleware.ts                 — Subdomain routing (sites.fractune.dk → /sites/)
  styles/global.css             — Design system (Myriad Pro, #12283E accent)
  pages/
    index.astro                 — Landing page
    privacy.astro               — Privacy policy (Apple Review requirement)
    terms.astro                 — Terms of use
    support.astro               — FAQ / support page
    sites/index.astro           — MapKit JS fullscreen map view
    api/
      mapkit-token.ts           — GET: generates short-lived MapKit JS JWT
      sites.ts                  — GET: returns site records (currently demo data)
      ingest.ts                 — POST: receives data from iOS app
      erasure.ts                — POST: GDPR data deletion endpoint
public/
  fonts/                        — Myriad Pro (light, regular, semibold .otf)
  favicon.svg, favicon.ico
vercel.json                     — Security headers
```

### Environment Variables (Vercel)

```
MAPKIT_TEAM_ID=7PFF5A75N3
MAPKIT_KEY_ID=AXKZMYN4Z4
MAPKIT_PRIVATE_KEY=<contents of AuthKey .p8 file>
CLOUDKIT_CONTAINER_ID=<not yet set>
CLOUDKIT_KEY_ID=<not yet set>
CLOUDKIT_PRIVATE_KEY=<not yet set>
CLOUDKIT_TEAM_ID=<not yet set>
```

## Design System

- **Font:** Myriad Pro (light 300, regular 400, semibold 600) — loaded as web fonts from `/fonts/`
- **Accent colour:** `#12283E` (dark navy)
- **Style:** Minimalist, Apple-inspired. White backgrounds, frosted-glass nav/panels, pill-shaped buttons
- **Language:** All text in English

## Current Status & Known Issues

### Working
- Landing page with all sections (hero, features, privacy, footer)
- Privacy policy, terms, support pages
- `sites.fractune.dk` subdomain routing via middleware
- MapKit JS map loads and shows Copenhagen
- `/api/mapkit-token` generates valid JWT tokens
- `/api/sites` returns demo building data
- `/api/ingest` accepts POST with validation and rate-limiting
- `/api/erasure` accepts GDPR deletion requests

### TODO — Needs Implementation
- **Map markers not appearing:** The map shows correctly but `MarkerAnnotation` markers from demo data don't render. Likely a timing issue — `loadSites()` is called with a `setTimeout(2000)` workaround. Needs proper fix (try `map` event listener or debug in browser console).
- **CloudKit server-to-server integration:** Both read (for `/api/sites`) and write (for `/api/ingest`). Requires signed requests with the CloudKit private key.
- **App Attest token verification** in `/api/ingest` — currently accepts all tokens.
- **App Store ID:** Replace `idXXXXXXXXXX` placeholder in landing page and `<meta name="apple-itunes-app">` in BaseLayout.
- **MapKit origin claim:** The `/api/mapkit-token` endpoint sets an `origin` claim from the request header — verify this works correctly or remove it.

## Apple Developer Details

- **Team:** Colours by Barslund ApS
- **Team ID:** 7PFF5A75N3
- **App identifier:** dk.coloursbybarslund.Fractune
- **MapKit Key ID:** AXKZMYN4Z4
- **Maps ID:** maps.dk.fractune

## Commands

```bash
npm run dev      # Local dev server
npm run build    # Production build
npm run preview  # Preview production build locally
```

## Owner

Anders Barslund (anders@andersbarslund.com)
Danish developer, prefers Apple ecosystem. Communicates in Danish but all site content is in English.
