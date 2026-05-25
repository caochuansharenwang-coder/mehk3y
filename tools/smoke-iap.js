// Local smoke test for /api/appstore-iap.js
// Mocks Vercel's req/res shim and runs the handler against real Apple endpoints.
//
// Usage:  node tools/smoke-iap.js [appId] [appId ...]
// Default test set: Claude (subscription), Procreate (one-time), GoodNotes 6,
//                   Halide (subscription)

const handler = require('../api/appstore-iap.js');

const cases = process.argv.slice(2).length ? process.argv.slice(2) : [
  '6473753684', // Claude — multi-tier subscription
  '425073498',  // Procreate — one-time purchase, no IAPs
  '1444383602', // GoodNotes 6 — wrong-id sanity check (should still resolve via correct id below)
  '1561788652', // Halide Mark II — subscription
  '6448311069', // ChatGPT — multiple offers
  '1232780281', // Notion
];

function makeRes() {
  let statusCode = 200;
  let headers = {};
  let body = null;
  return {
    status(c) { statusCode = c; return this; },
    setHeader(k, v) { headers[k] = v; },
    json(d) { body = d; return this; },
    _result() { return { statusCode, headers, body }; },
  };
}

(async () => {
  for (const id of cases) {
    const t0 = Date.now();
    const req = { query: { id } };
    const res = makeRes();
    await handler(req, res);
    const r = res._result();
    const ms = Date.now() - t0;
    console.log(`\n========== id=${id}  HTTP ${r.statusCode}  ${ms}ms ==========`);
    if (r.statusCode !== 200) {
      console.log('  body:', JSON.stringify(r.body).slice(0, 200));
      continue;
    }
    const d = r.body;
    console.log(`  app: ${d.app.name} by ${d.app.artist}  hasIAP=${d.app.hasInAppPurchases}  storefronts=${d.app.storefronts}/${d.app.attempted}  rates=${d.ratesAvailable}`);
    console.log(`  body price (cheapest 5):`);
    for (const r of d.bodyPriced.slice(0, 5)) {
      console.log(`    ${r.cc.toUpperCase()} ${r.countryName.padEnd(10)}  ${(r.formatted||'').padStart(14)}  ${r.amountUsd != null ? '$'+r.amountUsd.toFixed(2) : '—'}`);
    }
    console.log(`  body free regions: ${d.bodyFree.length}`);
    console.log(`  IAPs by SKU: ${d.iaps.length}`);
    for (const sku of d.iaps.slice(0, 4)) {
      console.log(`    ▸ ${sku.name}  [${sku.period||'?'}]  cheapest USD ${sku.cheapestUsd != null ? '$'+sku.cheapestUsd.toFixed(2) : '—'}  rows=${sku.rows.length}`);
      for (const r of sku.rows.slice(0, 3)) {
        console.log(`        ${r.cc.toUpperCase()} ${r.countryName.padEnd(10)} ${(r.formatted||'').padStart(14)}  ${r.amountUsd != null ? '$'+r.amountUsd.toFixed(2) : '—'}`);
      }
    }
  }
})();
