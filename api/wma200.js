// /api/wma200?asset=btc|eth — 200 周均线
// Edge Runtime: 全球边缘部署 (Vercel 免费版也是), China-friendly

export const config = { runtime: 'edge' };

const race = (p, ms) =>
  Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);

const tryJson = async (url, ms = 6000) => {
  try {
    const r = await race(fetch(url), ms);
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
};

export default async function handler(request) {
  const { searchParams } = new URL(request.url);
  const asset = (searchParams.get('asset') || 'btc').toLowerCase();
  if (asset !== 'btc' && asset !== 'eth') {
    return new Response(JSON.stringify({ error: 'asset must be btc or eth' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }

  const okxInst    = asset === 'btc' ? 'BTC-USDT' : 'ETH-USDT';
  const binanceSym = asset === 'btc' ? 'BTCUSDT'  : 'ETHUSDT';

  let closes = null;

  const okx = await tryJson(`https://www.okx.com/api/v5/market/candles?instId=${okxInst}&bar=1W&limit=200`);
  if (okx && Array.isArray(okx.data) && okx.data.length >= 100) {
    closes = okx.data.map(k => parseFloat(k[4])).reverse();
  }

  if (!closes) {
    const bn = await tryJson(`https://api.binance.com/api/v3/klines?symbol=${binanceSym}&interval=1w&limit=200`);
    if (Array.isArray(bn) && bn.length >= 100) {
      closes = bn.map(k => parseFloat(k[4]));
    }
  }

  if (!closes) {
    return new Response(JSON.stringify({ error: 'upstream failed' }), {
      status: 502, headers: { 'content-type': 'application/json' },
    });
  }

  const wma200 = closes.reduce((a, b) => a + b, 0) / closes.length;

  return new Response(JSON.stringify({ asset, wma200, samples: closes.length }), {
    headers: {
      'content-type':  'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=21600, stale-while-revalidate=86400',
    },
  });
}
