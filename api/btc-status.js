// /api/btc-status — 全网算力 + 减半倒计时 (合并 mempool.space 两次调用)
// Edge Runtime, China-friendly

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
  const [hash3d, heightRaw] = await Promise.all([
    tryJson('https://mempool.space/api/v1/mining/hashrate/3d'),
    tryJson('https://mempool.space/api/blocks/tip/height'),
  ]);

  let hashrate = null;
  if (hash3d?.currentHashrate) {
    hashrate = +(hash3d.currentHashrate / 1e18).toFixed(1);
  }

  let halving = null;
  // tip/height 返回的是裸数字 (text/plain 或 JSON 数字)
  const height = typeof heightRaw === 'number' ? heightRaw
              : typeof heightRaw === 'string' ? parseInt(heightRaw, 10) : null;
  if (height && height > 0) {
    const next  = Math.ceil(height / 210000) * 210000;
    const days  = Math.round((next - height) * 10 / (60 * 24));
    const est   = new Date(Date.now() + days * 86400000);
    const date  = est.getFullYear() + '-' +
                  String(est.getMonth() + 1).padStart(2, '0') + '-' +
                  String(est.getDate()).padStart(2, '0');
    const prev  = next - 210000;
    const progress = +((height - prev) / 210000 * 100).toFixed(1);
    halving = { days, height, date, progress };
  }

  if (hashrate == null && halving == null) {
    return new Response(JSON.stringify({ error: 'upstream failed' }), {
      status: 502, headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ hashrate, halving }), {
    headers: {
      'content-type':  'application/json; charset=utf-8',
      'cache-control': 'public, max-age=120, s-maxage=300, stale-while-revalidate=1800',
    },
  });
}
