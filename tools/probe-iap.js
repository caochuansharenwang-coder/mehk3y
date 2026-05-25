// Detailed diagnostics: for every storefront, log HTTP status + outcome.
// Reveals whether the failures are 400 (app not in region) vs rate-limited
// (empty 200 / 301 chain) vs timeouts.

const { STOREFRONTS } = require('../api/appstore-iap.js');

const APP_STORE_UA =
  'AppStore/2.0 iOS/17.0 model/iPhone15,2 hwp/t8120 build/21A340 (6; dt:251)';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function probe(cc, id) {
  const sf = STOREFRONTS[cc];
  const url = `https://itunes.apple.com/WebObjects/MZStore.woa/wa/viewSoftware?id=${id}`;
  const headers = {
    'User-Agent':          APP_STORE_UA,
    'X-Apple-Store-Front': `${sf.id}-1,29`,
    'Accept':              '*/*',
    'Accept-Language':     'en-US,en;q=0.9',
  };
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers, redirect: 'follow' });
    const ct = r.headers.get('content-type') || '';
    const tk = r.headers.get('apple-tk');
    const text = await r.text();
    let parsed = '?';
    if (text.length === 0) {
      parsed = `empty (apple-tk=${tk})`;
    } else if (ct.includes('json')) {
      try {
        const j = JSON.parse(text);
        const p = j.storePlatformData && j.storePlatformData['product-dv'] &&
                  j.storePlatformData['product-dv'].results &&
                  j.storePlatformData['product-dv'].results[id];
        const ao = j.pageData && j.pageData.addOns;
        parsed = p ? `name=${(p.name||'?').slice(0,18)} addOns=${(ao||[]).length}` : 'no-product-in-json';
      } catch (e) {
        parsed = `JSON.parse-fail (${text.length}b)`;
      }
    } else {
      parsed = `non-json ct=${ct} len=${text.length}`;
    }
    return { cc, status: r.status, ms: Date.now()-t0, parsed, ct };
  } catch (e) {
    return { cc, status: 0, ms: Date.now()-t0, parsed: `error: ${e.message}` };
  }
}

(async () => {
  const id = process.argv[2] || '6473753684';
  console.log(`Probing all storefronts for id=${id}, concurrency=5\n`);
  const ccs = Object.keys(STOREFRONTS);
  const results = [];
  let next = 0;
  async function worker(wi) {
    while (true) {
      const i = next++;
      if (i >= ccs.length) return;
      // small stagger inside worker too
      if (i < 5) await sleep(wi * 80);
      results[i] = await probe(ccs[i], id);
      // gap between requests in the same worker
      if (process.env.GAP_MS) await sleep(parseInt(process.env.GAP_MS,10));
    }
  }
  await Promise.all(Array.from({ length: parseInt(process.env.CONCURRENCY||'5',10) }, (_, wi) => worker(wi)));
  for (const r of results) {
    console.log(`  ${r.cc.padEnd(3)} ${String(r.status).padStart(3)}  ${(r.ms+'ms').padStart(7)}  ${r.parsed}`);
  }
  // summary
  const byStatus = {};
  for (const r of results) byStatus[r.status] = (byStatus[r.status]||0)+1;
  console.log(`\nstatus summary: ${JSON.stringify(byStatus)}`);
})();
