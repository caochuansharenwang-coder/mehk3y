// /api/og-btc — Dynamic OG image for /btc, with live price + 24h change + ahr999.
// 1200x630 PNG. Cached 60s at edge, served immutable for 120s to clients.

import { ImageResponse } from '@vercel/og';
import { el, bg, getFonts, colors, fmtUsd, fmtPct } from './_og-shared.js';

export const config = { runtime: 'edge' };

// Fetch live BTC numbers (re-uses our own internal endpoints)
async function fetchData(req) {
  const origin = new URL(req.url).origin;
  const get = (path) => fetch(origin + path, { cf: { cacheTtl: 30 } })
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);

  const [price, ahr] = await Promise.all([
    get('/api/btc-price'),
    get('/api/ahr999'),
  ]);

  let ahr999 = null;
  if (price?.price && ahr?.dma200 && ahr?.expPrice) {
    ahr999 = (price.price / ahr.dma200) * (price.price / ahr.expPrice);
  }
  return {
    price: price?.price ?? null,
    chg:   price?.chg ?? null,
    ahr999,
  };
}

export default async function handler(req) {
  const data = await fetchData(req);
  const fonts = await getFonts(req);

  const chgColor = data.chg == null ? colors.dim : data.chg >= 0 ? colors.green : colors.red;
  const ahrColor = data.ahr999 == null ? colors.dim
    : data.ahr999 < 0.45 ? colors.green
    : data.ahr999 < 1.2  ? colors.green
    : data.ahr999 < 5    ? colors.orange
    : colors.red;

  const card = el('div', {
    style: {
      width: '1200px', height: '630px',
      display: 'flex', flexDirection: 'column',
      background: colors.bg, color: colors.text,
      fontFamily: 'Geist', position: 'relative',
      padding: '64px 80px', justifyContent: 'space-between',
    },
  },
    ...bg(),
    // Top row
    el('div', { style: { display: 'flex', alignItems: 'center', gap: 14, fontSize: 14, color: colors.dim, fontFamily: 'Geist Mono', letterSpacing: '0.14em', textTransform: 'uppercase', zIndex: '1' } },
      el('div', { style: { width: 8, height: 8, borderRadius: 99, background: colors.orange, boxShadow: '0 0 12px ' + colors.orange } }),
      el('div', null, 'Mehk3y / btc dashboard')
    ),
    // Hero — symbol + price
    el('div', { style: { display: 'flex', flexDirection: 'column', zIndex: '1' } },
      el('div', { style: { display: 'flex', alignItems: 'baseline', gap: 22 } },
        el('div', { style: { fontSize: 76, fontWeight: 900, color: colors.orange, letterSpacing: '-0.045em', lineHeight: 1, fontFamily: 'Geist' } }, 'BTC'),
        el('div', { style: { fontSize: 28, fontWeight: 500, color: colors.dim, letterSpacing: '0.04em', textTransform: 'uppercase', fontFamily: 'Geist Mono' } }, '/ USD · live')
      ),
      el('div', { style: { display: 'flex', alignItems: 'baseline', gap: 24, marginTop: 22 } },
        el('div', { style: { fontSize: 132, fontWeight: 700, letterSpacing: '-0.055em', lineHeight: 0.95, fontFamily: 'Geist Mono', color: colors.text } }, fmtUsd(data.price)),
        el('div', { style: { fontSize: 36, fontWeight: 700, color: chgColor, fontFamily: 'Geist Mono' } }, fmtPct(data.chg) + '  24h')
      )
    ),
    // Metric strip
    el('div', { style: { display: 'flex', gap: 14, zIndex: '1' } },
      el('div', { style: { display: 'flex', flex: 1, flexDirection: 'column', padding: '18px 22px', border: '1px solid ' + colors.border, background: colors.surface, borderRadius: 14 } },
        el('div', { style: { fontSize: 12, color: colors.dim, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 500 } }, 'ahr999 DCA'),
        el('div', { style: { fontSize: 38, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 8, fontFamily: 'Geist Mono', color: ahrColor } }, data.ahr999 != null ? data.ahr999.toFixed(2) : '—')
      ),
      el('div', { style: { display: 'flex', flex: 2, flexDirection: 'column', padding: '18px 22px', border: '1px solid ' + colors.border, background: colors.surface, borderRadius: 14 } },
        el('div', { style: { fontSize: 12, color: colors.dim, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 500 } }, 'live dashboard'),
        el('div', { style: { fontSize: 26, marginTop: 8, color: colors.text2, fontWeight: 500, letterSpacing: '-0.005em' } }, 'MVRV · 200WMA · Halving · MSTR mNAV')
      )
    ),
    // Footer
    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', zIndex: '1', fontFamily: 'Geist Mono', fontSize: 14, color: colors.dim, letterSpacing: '0.08em' } },
      el('div', { style: { color: colors.text, fontWeight: 700, fontSize: 20, fontFamily: 'Geist', letterSpacing: '-0.01em' } }, 'Mehk3y.com/btc'),
      el('div', null, 'NO ADS · NO TRACKING · NO BS')
    ),
  );

  return new ImageResponse(card, {
    width: 1200,
    height: 630,
    fonts,
    headers: {
      'Cache-Control': 'public, max-age=60, s-maxage=120, stale-while-revalidate=600',
    },
  });
}
