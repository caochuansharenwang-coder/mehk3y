// /api/eth-market — ETH 市值 / 24h 成交 / 流通量 / 质押量
// 代理 CoinGecko 给国内用户

export const config = { runtime: 'edge' };

const race = (p, ms) =>
  Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);

export default async function handler() {
  try {
    const r = await race(
      fetch('https://api.coingecko.com/api/v3/coins/ethereum?localization=false&tickers=false&community_data=false&developer_data=false'),
      9000
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const md = d.market_data;
    const totalSupply = md.total_supply || md.circulating_supply;

    const payload = {
      mcap:        md.market_cap.usd,
      vol:         md.total_volume.usd,
      chg7:        md.price_change_percentage_7d,
      chg30:       md.price_change_percentage_30d,
      ath:         md.ath.usd,
      athPct:      md.ath_change_percentage.usd,
      totalSupply,
      // CoinGecko 没有原生质押量字段, 取 beaconcha.in 当前估值 (定期手动更新)
      stakedEth: 34_000_000,
    };

    return new Response(JSON.stringify(payload), {
      headers: {
        'content-type':  'application/json; charset=utf-8',
        'cache-control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=1800',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), {
      status: 502, headers: { 'content-type': 'application/json' },
    });
  }
}
