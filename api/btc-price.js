// /api/btc-price — BTC 当前价 + 24h 涨跌幅
// 代理给客户端,避免国内用户被 Binance / CoinGecko 直连卡住
// Edge Runtime: 全球边缘部署, China-friendly

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
  let price = null, chg = null;

  // OKX 优先 (HK 节点, 国内能访问)
  const okx = await tryJson('https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT');
  if (okx?.data?.[0]) {
    const t = okx.data[0];
    const last = parseFloat(t.last);
    const open = parseFloat(t.open24h);
    if (last > 0 && open > 0) {
      price = last;
      chg = (last - open) / open * 100;
    }
  }

  // CoinGecko 兜底
  if (price == null) {
    const cg = await tryJson('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true', 6000);
    if (cg?.bitcoin?.usd) {
      price = cg.bitcoin.usd;
      chg = cg.bitcoin.usd_24h_change ?? null;
    }
  }

  if (price == null) {
    return new Response(JSON.stringify({ error: 'upstream failed' }), {
      status: 502, headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ price, chg }), {
    headers: {
      'content-type':  'application/json; charset=utf-8',
      'cache-control': 'public, max-age=10, s-maxage=15, stale-while-revalidate=60',
    },
  });
}
