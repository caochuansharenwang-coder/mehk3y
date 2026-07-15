// /api/bmnr — BitMine Immersion (BMNR) 公司 ETH 储备 (CoinGecko public treasury)

export const config = { runtime: 'edge' };

const race = (p, ms) => {
  let timer;
  return Promise.race([
    p,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); }),
  ]).finally(() => clearTimeout(timer));
};

export default async function handler() {
  try {
    const data = await race(
      fetch('https://api.coingecko.com/api/v3/companies/public_treasury/ethereum').then(r => r.json()),
      8000
    );
    const bmnr = (data.companies || []).find(c => /bitmine/i.test(c.name));
    if (!bmnr) throw new Error('bmnr not found');

    const rank = (data.companies || []).findIndex(c => /bitmine/i.test(c.name)) + 1;

    const payload = {
      name:                   bmnr.name,
      symbol:                 bmnr.symbol,
      holdings:               bmnr.total_holdings,
      valueUsd:               bmnr.total_current_value_usd,
      entryUsd:               bmnr.total_entry_value_usd || null,
      pctOfSupply:            bmnr.percentage_of_total_supply,
      rank,
      totalCorporateHoldings: data.total_holdings,
      totalCorporateValueUsd: data.total_value_usd,
      marketCapDominance:     data.market_cap_dominance,
      asOf:                   new Date().toISOString(),
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
