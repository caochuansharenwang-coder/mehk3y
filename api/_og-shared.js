// /api/_og-shared.js — Helpers for dynamic OG image generation (Vercel Edge + @vercel/og + Satori)
// Used by /api/og-btc and /api/og-eth.

// Tiny createElement helper so we don't need a JSX transpiler.
// Satori requires every <div> to have explicit `display: flex` (or none) when
// it has more than one child, so we default it on for type='div'.
export function el(type, props, ...children) {
  const flat = children.flat ? children.flat(Infinity) : [].concat(...children);
  const kids = flat.filter(c => c !== null && c !== undefined && c !== false);
  const inProps = props || {};
  const style = inProps.style || {};
  const finalStyle = type === 'div' && style.display === undefined
    ? { display: 'flex', ...style }
    : style;
  return {
    type,
    key: null,
    props: { ...inProps, style: finalStyle, children: kids.length === 1 ? kids[0] : kids },
  };
}

// Lazy-load font TTFs once per cold-start, fetched from /fonts/ on the deployed origin.
// Caller passes the request so we can derive the origin (works for preview + prod).
let _fonts = null;
export async function getFonts(req) {
  if (_fonts) return _fonts;
  const origin = new URL(req.url).origin;
  const load = async (name) => {
    const r = await fetch(origin + '/fonts/' + name);
    if (!r.ok) throw new Error('font fetch failed: ' + name + ' ' + r.status);
    return await r.arrayBuffer();
  };
  const [regular, bold, black, mono] = await Promise.all([
    load('Geist-Regular.ttf'),
    load('Geist-Bold.ttf'),
    load('Geist-Black.ttf'),
    load('GeistMono-Regular.ttf'),
  ]);
  _fonts = [
    { name: 'Geist',      data: regular, weight: 400, style: 'normal' },
    { name: 'Geist',      data: bold,    weight: 700, style: 'normal' },
    { name: 'Geist',      data: black,   weight: 900, style: 'normal' },
    { name: 'Geist Mono', data: mono,    weight: 400, style: 'normal' },
  ];
  return _fonts;
}

// Background layer shared by all OG cards: spotlight + noise
const noiseUri = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'>
     <filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/>
     <feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0'/></filter>
     <rect width='100%' height='100%' filter='url(%23n)'/>
   </svg>`.replace(/\s+/g, ' ')
);

export function bg() {
  return [
    // spotlight glow
    el('div', { style: {
      position: 'absolute', top: -400, left: 0, right: 0,
      display: 'flex', justifyContent: 'center',
      pointerEvents: 'none',
    } },
      el('div', { style: {
        width: 1400, height: 900,
        background: 'radial-gradient(ellipse at center, rgba(98,126,234,0.22) 0%, rgba(247,147,26,0.10) 35%, transparent 70%)',
        filter: 'blur(30px)',
      } })
    ),
    // grain
    el('div', { style: {
      position: 'absolute', inset: 0,
      backgroundImage: `url("${noiseUri}")`,
      opacity: 0.05,
      filter: 'invert(1)',
    } }),
  ];
}

export const colors = {
  bg:        '#0a0a0a',
  surface:   '#111111',
  surface2:  '#161616',
  border:    '#1f1f1f',
  border2:   '#2a2a2a',
  text:      '#f5f5f5',
  text2:     '#c4c4c4',
  dim:       '#707070',
  orange:    '#ffae3d',
  green:     '#34d399',
  red:       '#f87171',
  blue:      '#60a5fa',
  purple:    '#a78bfa',
};

// Format helpers
export const fmtUsd = v => {
  if (v == null || isNaN(v)) return '$—';
  if (v >= 1000) return '$' + Math.round(v).toLocaleString('en-US');
  return '$' + v.toFixed(2);
};
export const fmtPct = v => {
  if (v == null || isNaN(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
};
