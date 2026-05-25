import { mkdir, writeFile } from 'node:fs/promises';

const OUT = new URL('../data/btc.json', import.meta.url);

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

async function tryJson(url, ms = 8000) {
  try {
    const r = await Promise.race([fetch(url), timeout(ms)]);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function getPrice() {
  const sources = [
    async () => {
      const okx = await tryJson('https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT', 6000);
      const t = okx?.data?.[0];
      const last = parseFloat(t?.last);
      const open = parseFloat(t?.open24h);
      return last > 0 && open > 0 ? { price: last, chg: (last - open) / open * 100 } : null;
    },
    async () => {
      const cg = await tryJson('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true', 8000);
      return cg?.bitcoin?.usd ? { price: cg.bitcoin.usd, chg: cg.bitcoin.usd_24h_change ?? null } : null;
    },
  ];
  for (const source of sources) {
    const value = await source();
    if (value) return value;
  }
  return null;
}

async function getStatus() {
  const [hash3d, heightRaw] = await Promise.all([
    tryJson('https://mempool.space/api/v1/mining/hashrate/3d', 8000),
    fetch('https://mempool.space/api/blocks/tip/height').then((r) => r.text()).catch(() => null),
  ]);

  const hashrate = hash3d?.currentHashrate ? +(hash3d.currentHashrate / 1e18).toFixed(1) : null;
  const height = parseInt(heightRaw, 10);
  let halving = null;
  if (height > 0) {
    const next = Math.ceil(height / 210000) * 210000;
    const days = Math.round((next - height) * 10 / (60 * 24));
    const est = new Date(Date.now() + days * 86400000);
    const date = est.getFullYear() + '-' + String(est.getMonth() + 1).padStart(2, '0') + '-' + String(est.getDate()).padStart(2, '0');
    const prev = next - 210000;
    const progress = +((height - prev) / 210000 * 100).toFixed(1);
    halving = { days, height, date, progress };
  }
  return { hashrate, halving };
}

async function getFng() {
  const d = await tryJson('https://api.alternative.me/fng/?limit=1', 8000);
  const value = parseInt(d?.data?.[0]?.value, 10);
  return Number.isFinite(value) ? value : null;
}

async function getWma200() {
  const sources = [
    async () => {
      const okx = await tryJson('https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=1W&limit=200', 9000);
      if (!Array.isArray(okx?.data) || okx.data.length < 100) return null;
      const closes = okx.data.map((k) => parseFloat(k[4])).filter((v) => v > 0).reverse();
      return closes.length >= 100 ? closes.reduce((a, b) => a + b, 0) / closes.length : null;
    },
    async () => {
      const bn = await tryJson('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1w&limit=200', 9000);
      if (!Array.isArray(bn) || bn.length < 100) return null;
      const closes = bn.map((k) => parseFloat(k[4])).filter((v) => v > 0);
      return closes.length >= 100 ? closes.reduce((a, b) => a + b, 0) / closes.length : null;
    },
  ];
  for (const source of sources) {
    const value = await source();
    if (value) return value;
  }
  return null;
}

async function getAhrBase() {
  const sources = [
    async () => {
      const okx = await tryJson('https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=1D&limit=200', 9000);
      if (!Array.isArray(okx?.data) || okx.data.length < 100) return null;
      const closes = okx.data.map((k) => parseFloat(k[4])).filter((v) => v > 0).reverse();
      if (closes.length < 100) return null;
      return { closes, lastTs: parseInt(okx.data[0][0], 10) };
    },
    async () => {
      const bn = await tryJson('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=200', 9000);
      if (!Array.isArray(bn) || bn.length < 100) return null;
      const closes = bn.map((k) => parseFloat(k[4])).filter((v) => v > 0);
      if (closes.length < 100) return null;
      return { closes, lastTs: bn[bn.length - 1][0] };
    },
  ];
  for (const source of sources) {
    const value = await source();
    if (value) {
      const dma200 = value.closes.reduce((a, b) => a + b, 0) / value.closes.length;
      const coinDays = Math.floor(((value.lastTs || Date.now()) - new Date('2009-01-03').getTime()) / 86400000);
      const expPrice = Math.pow(10, 5.84 * Math.log10(coinDays) - 17.01);
      return { dma200, expPrice, coinDays, lastTs: value.lastTs };
    }
  }
  return null;
}

const looknodeValue = (d) => {
  if (!d || d.code !== 100 || !Array.isArray(d.data) || !d.data.length) return null;
  return d.data[d.data.length - 1].v;
};

async function getOnchain() {
  const [bpRaw, mvrvRaw] = await Promise.all([
    tryJson('https://looknode-proxy.corms-cushier-0l.workers.dev/balancedPrice', 10000),
    tryJson('https://looknode-proxy.corms-cushier-0l.workers.dev/mCapRealizedRatio', 10000),
  ]);
  let balancedPrice = looknodeValue(bpRaw);
  let mvrv = looknodeValue(mvrvRaw);

  if (mvrv == null) {
    const cm = await tryJson('https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=CapMVRVCur&limit_per_asset=1', 10000);
    const v = parseFloat(cm?.data?.[0]?.CapMVRVCur);
    if (v > 0) mvrv = v;
  }

  return { balancedPrice, mvrv };
}

async function getMstr() {
  const d = await tryJson('https://looknode-proxy.corms-cushier-0l.workers.dev/mnav', 12000);
  return d?.mstr?.stock_price ? d.mstr : null;
}

function computeDerived(data) {
  if (data.price?.price > 0 && data.ahrBase?.dma200 > 0 && data.ahrBase?.expPrice > 0) {
    data.ahr999 = (data.price.price / data.ahrBase.dma200) * (data.price.price / data.ahrBase.expPrice);
  }
  if (data.price?.price > 0 && data.wma200 > 0) {
    data.wma200Ratio = data.price.price / data.wma200;
  }
  if (data.price?.price > 0 && data.onchain?.balancedPrice > 0) {
    data.balancedPriceRatio = data.price.price / data.onchain.balancedPrice;
  }
  if (data.price?.price > 0 && data.mstr?.btc_holdings > 0 && data.mstr?.stock_price > 0 && data.mstr?.shares > 0) {
    const mcap = data.mstr.stock_price * data.mstr.shares;
    const btcVal = data.mstr.btc_holdings * data.price.price;
    data.mstrComputed = {
      mcap,
      btcVal,
      basic: mcap / btcVal,
      ev: (mcap + (data.mstr.debt || 0) + (data.mstr.pref || 0)) / (btcVal + (data.mstr.cash || 0)),
      pctSupply: data.mstr.btc_holdings / 19_800_000 * 100,
    };
  }
}

async function main() {
  const [price, status, fng, wma200, ahrBase, onchain, mstr] = await Promise.all([
    getPrice(),
    getStatus(),
    getFng(),
    getWma200(),
    getAhrBase(),
    getOnchain(),
    getMstr(),
  ]);

  const data = {
    version: 1,
    asset: 'btc',
    updatedAt: new Date().toISOString(),
    price,
    hashrate: status.hashrate,
    halving: status.halving,
    fng,
    wma200,
    ahrBase,
    onchain,
    mstr,
  };
  computeDerived(data);

  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await writeFile(OUT, JSON.stringify(data, null, 2) + '\n');
  console.log(`wrote ${OUT.pathname}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
