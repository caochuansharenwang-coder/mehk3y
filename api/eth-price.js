// /api/eth-price — ETH 当前价 + 24h + ETH/BTC 比 (一次请求三个值, 省一次往返)
// Edge Runtime, China-friendly

export const config = { runtime: 'edge' };

const race = (p, ms) => {
  let timer;
  return Promise.race([
    p,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); }),
  ]).finally(() => clearTimeout(timer));
};

const tryJson = async (url, ms = 5000) => {
  try {
    const r = await race(fetch(url), ms);
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
};

export default async function handler() {
  // 并发抓 ETH USD + ETH/BTC
  const [okxUsd, okxBtc] = await Promise.all([
    tryJson('https://www.okx.com/api/v5/market/ticker?instId=ETH-USDT'),
    tryJson('https://www.okx.com/api/v5/market/ticker?instId=ETH-BTC'),
  ]);

  let price = null, chg = null, ethbtc = null;

  if (okxUsd?.data?.[0]) {
    const t = okxUsd.data[0];
    const last = parseFloat(t.last);
    const open = parseFloat(t.open24h);
    if (last > 0 && open > 0) {
      price = last;
      chg = (last - open) / open * 100;
    }
  }
  if (okxBtc?.data?.[0]) {
    const v = parseFloat(okxBtc.data[0].last);
    if (v > 0) ethbtc = v;
  }

  // CoinGecko 兜底 USD/chg
  if (price == null) {
    const cg = await tryJson('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true', 6000);
    if (cg?.ethereum?.usd) {
      price = cg.ethereum.usd;
      chg = cg.ethereum.usd_24h_change ?? null;
    }
  }

  if (price == null) {
    return new Response(JSON.stringify({ error: 'upstream failed' }), {
      status: 502, headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ price, chg, ethbtc }), {
    headers: {
      'content-type':  'application/json; charset=utf-8',
      'cache-control': 'public, max-age=10, s-maxage=15, stale-while-revalidate=60',
    },
  });
}
