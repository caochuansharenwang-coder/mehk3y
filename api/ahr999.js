// /api/ahr999 — Bitcoin ahr999 DCA index
// ahr999 = (price / DMA200) * (price / fitted_price)
// fitted_price = 10 ^ (5.84 * log10(coin_age_days) - 17.01)
// 只算 DMA200 + fitted_price 给客户端,客户端用当前价乘出来

export const config = { runtime: 'edge' };

const race = (p, ms) => {
  let timer;
  return Promise.race([
    p,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); }),
  ]).finally(() => clearTimeout(timer));
};

const tryJson = async (url, ms = 6000) => {
  try {
    const r = await race(fetch(url), ms);
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
};

export default async function handler() {
  let closes = null, lastTs = null;

  const okx = await tryJson('https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=1D&limit=200');
  if (okx && Array.isArray(okx.data) && okx.data.length >= 100) {
    closes = okx.data.map(k => parseFloat(k[4])).reverse();
    lastTs = parseInt(okx.data[0][0]);
  }

  if (!closes) {
    const bn = await tryJson('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=200');
    if (Array.isArray(bn) && bn.length >= 100) {
      closes = bn.map(k => parseFloat(k[4]));
      lastTs = bn[bn.length - 1][0];
    }
  }

  if (!closes) {
    return new Response(JSON.stringify({ error: 'upstream failed' }), {
      status: 502, headers: { 'content-type': 'application/json' },
    });
  }

  const dma200 = closes.reduce((a, b) => a + b, 0) / closes.length;
  if (!lastTs) lastTs = Date.now();
  const coinDays = Math.floor((lastTs - new Date('2009-01-03').getTime()) / 86400000);
  const expPrice = Math.pow(10, 5.84 * Math.log10(coinDays) - 17.01);

  return new Response(JSON.stringify({ dma200, expPrice, coinDays, lastTs }), {
    headers: {
      'content-type':  'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=21600, stale-while-revalidate=86400',
    },
  });
}
