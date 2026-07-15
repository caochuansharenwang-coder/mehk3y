// /api/strategy-btc — Strategy/MSTR BTC treasury data fallback path.
// Kept separate from /api/mstr so the frontend has a safe fallback path.

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
    const r = await race(
      fetch('https://looknode-proxy.corms-cushier-0l.workers.dev/mnav'),
      12000
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    if (!d?.mstr?.stock_price) throw new Error('no MSTR data');

    return new Response(JSON.stringify(d), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=300, s-maxage=1800, stale-while-revalidate=21600',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
}
