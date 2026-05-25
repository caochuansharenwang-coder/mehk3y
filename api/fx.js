// /api/fx — Apple 礼品卡页用的实时汇率
// 返回 USD / TRY / NGN → CNY 等价。两个免费源兜底, 无 key 需求

export const config = { runtime: 'edge' };

const race = (p, ms) =>
  Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);

const tryFetch = async (url, ms = 6000) => {
  const r = await race(fetch(url), ms);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
};

const sources = [
  () => tryFetch('https://api.exchangerate-api.com/v4/latest/USD'),
  () => tryFetch('https://open.er-api.com/v6/latest/USD'),
];

export default async function handler() {
  let rates = null;
  for (const src of sources) {
    try {
      const d = await src();
      rates = d.rates ?? d.conversion_rates;
      if (rates?.CNY && rates?.TRY && rates?.NGN) break;
    } catch { /* try next */ }
  }

  if (!rates) {
    return new Response(JSON.stringify({ error: 'all sources failed' }), {
      status: 502, headers: { 'content-type': 'application/json' },
    });
  }

  const cny  = rates.CNY;
  const tryR = rates.TRY;
  const ngn  = rates.NGN;

  return new Response(JSON.stringify({
    base: 'CNY',
    usd: parseFloat(cny.toFixed(4)),
    try: parseFloat((cny / tryR).toFixed(4)),
    ngn: parseFloat((100 * cny / ngn).toFixed(4)),
    ts:  Date.now(),
  }), {
    headers: {
      'content-type':  'application/json; charset=utf-8',
      'cache-control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  });
}
