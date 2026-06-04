# mehk3y.com — Optimization Pass (2026-01)

> Original problem statement (zh): **帮我优化网站 mehk3y.com**
> Plan A chosen: clone the real `caochuansharenwang-coder/mehk3y` repo and optimize all pages on top of the existing static HTML/CSS/JS stack (no framework migration).

## Architecture (unchanged)

- Pure static HTML + vanilla JS, deployed on Vercel
- Self-hosted Geist / Geist Mono fonts (Apache 2.0)
- CSP-compliant (`script-src 'self' 'unsafe-inline'`)
- Vercel Edge middleware rate limiting on `/api/*`
- Three-state theme controller (light / dark / auto) via `theme.js`

## Optimization summary

### 1. English page (the explicit pain point) — **95% smaller HTML**

| Metric                  | Before  | After   | Δ              |
| ----------------------- | ------- | ------- | -------------- |
| `English.html`          | 370 KB  | 20 KB   | **−95%**       |
| Parser-blocking payload | 370 KB  | 20 KB + 11 KB JS | First paint unblocked |
| Data (cached)           | inline  | `/data/english.json` (331 KB) | loaded async, sessionStorage + HTTP cache |

Changes:
- Extracted 850-word + synonym data into `/data/english.json` (parallel fetch with `<link rel="preload" as="fetch">`).
- Moved render logic into external `english.js` (defer-loaded).
- Added skeleton placeholder cards while data is in flight.
- `requestAnimationFrame`-throttled search filter (smoother on 850 cards).
- Smooth-scroll to active section on pill click.
- Pre-decoded data persists in `sessionStorage` so SPA-like nav within the page is instant.

### 2. Site-wide a11y & navigation

- Added a skip-to-content link (`.skip-link`) on all 9 pages, visible on keyboard focus.
- Wrapped main content in `<main id="main">` landmarks on every sub-page (was previously a plain `<div class="wrap">`).
- Added ARIA `role="tablist" / "tab" / "group"` on English page filter pills + audio toggle.

### 3. CSS polish (common.css)

- View Transitions API (`@view-transition { navigation: auto; }`) — smooth fades when navigating between pages on Chromium browsers, no impact on others.
- `contain: content` on `.card` — major render-cost reduction on the English page (850 cards) and noticeable on apple/hermes lists.

### 4. Performance

- Removed dead `dns-prefetch` entries from `index.html` (`ipwho.is`, `claude.ai` etc. — those are only used by sub-pages, not the home).
- Added cache header for `/data/*.json` in `vercel.json` (1 h browser, 24 h CDN, 7 d stale-while-revalidate).
- Pre-loaded `/data/english.json` via `<link rel="preload" as="fetch">` so it starts downloading in parallel with `common.css`.

### 5. Resilience

- `<noscript>` warning on the English page (since data is now JS-loaded).
- Fetch error path on `english.js` falls back to a friendly empty-state message instead of a blank page.

## Files touched

```
M  English.html               -350 KB
M  common.css                  +0.7 KB
M  index.html                  -0.1 KB
M  vercel.json                 +1 cache rule
M  apple.html  esim.html  hermes.html  perler.html
M  ip.html     crypto.html     apple.html  perler.html   (skip-link + <main>)
M  vercel.json                 (+ /data/*.json cache header)
A  english.js                  10.5 KB
A  data/english.json           331 KB
```

## What was deliberately NOT changed

- Sub-page business logic (`crypto.html`, `ip.html`, `apple.html`, `perler.html`) — already well-architected, no functional changes.
- Theme system, font loading, CSP, middleware rate-limit — already best-in-class.
- Color tokens, brand identity — preserved.
- Visual layout of any page — preserved (verified via screenshots: light + dark + mobile).

## How to push to GitHub

Click **Save to GitHub** in the Emergent chat input. The optimized files in `/app` are ready to commit straight to your `main` branch.

## Future / backlog

- P1: Wrap the 850-card render in `IntersectionObserver` so only on-screen sections fully render (currently all render; with `contain: content` the cost is already low).
- P1: Add a small "command palette" (⌘K) for fast tool jumping across sub-pages.
- P2: Pre-render OG images per sub-page (currently shares a single `og-image.png`).
- P2: Add A-Z letter strip on the English page for jump navigation.
