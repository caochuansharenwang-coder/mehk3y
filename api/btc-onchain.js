// /api/btc-onchain — MVRV ratio + Balanced Price
// 主源:looknode 代理 (Cloudflare worker), MVRV 兜底走 CoinMetrics 社区 API

export const config = { runtime: 'edge' };

const race = (p, ms) =>
  Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);

const tryJson = async (url, ms = 8000) => {
  try {
    const r = await race(fetch(url), ms);
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
};

const fromLooknode = (d) => {
  if (!d || d.code !== 100 || !Array.isArray(d.data) || !d.data.length) return null;
  return d.data[d.data.length - 1].v;
};

export default async function handler() {
  const [bpRaw, mvrvRaw] = await Promise.all([
    tryJson('https://looknode-proxy.corms-cushier-0l.workers.dev/balancedPrice'),
    tryJson('https://looknode-proxy.corms-cushier-0l.workers.dev/mCapRealizedRatio'),
  ]);

  let balancedPrice = fromLooknode(bpRaw);
  let mvrv          = fromLooknode(mvrvRaw);

  if (mvrv == null) {
    const cm = await tryJson('https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=CapMVRVCur&limit_per_asset=1');
    const v  = parseFloat(cm?.data?.[0]?.CapMVRVCur);
    if (!isNaN(v) && v > 0) mvrv = v;
  }

  if (balancedPrice == null && mvrv == null) {
    return new Response(JSON.stringify({ error: 'upstream failed' }), {
      status: 502, headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ balancedPrice, mvrv }), {
    headers: {
      'content-type':  'application/json; charset=utf-8',
      'cache-control': 'public, max-age=600, s-maxage=3600, stale-while-revalidate=21600',
    },
  });
}
