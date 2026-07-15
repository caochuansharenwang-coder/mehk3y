// /api/btc-sentiment — Fear & Greed data fallback path.
// Some browser content blockers are aggressive with short endpoint names.

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
    const r = await race(fetch('https://api.alternative.me/fng/?limit=1'), 6000);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const value = parseInt(d?.data?.[0]?.value, 10);
    if (!Number.isFinite(value)) throw new Error('invalid payload');

    return new Response(JSON.stringify({ value }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=600, s-maxage=1800, stale-while-revalidate=21600',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
}
