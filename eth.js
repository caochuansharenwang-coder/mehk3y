// ETH Dashboard. Depends on common.js.
//
// 所有上游 fetch 全走 /api/* (Edge Runtime, 全球边缘部署, China-friendly).
//
// IIFE 包裹 — 让 const cache/ft/price 不暴露到全局，方便和 script.js 在同一页面共存（/crypto）。

(function () {
'use strict';

const cache = mehk3yCache('eth_v2');
const ft    = mehk3yFetch;
const price = mehk3yPriceGate();
let wma200Value = 0;

const cryptoUi = window.mehk3yCryptoUi || { issue() {}, recovered() {} };

function markIssue(key, message) {
  cryptoUi.issue('eth', key, message);
}

function markRecovered(key, updatedAt) {
  cryptoUi.recovered('eth', key, updatedAt);
}

function markBmnrIssue(key, message) {
  cryptoUi.issue('bmnr', key, message);
}

function markBmnrRecovered(key, updatedAt) {
  cryptoUi.recovered('bmnr', key, updatedAt);
}

function applyPrice(pd) {
  if (!pd) return;
  price.resolve(pd.price);
  document.getElementById('eth-price').textContent = '$' + pd.price.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const chgEl = document.getElementById('eth-chg');
  const chg = pd.chg ?? 0;
  chgEl.textContent = (chg > 0 ? '+' : '') + chg.toFixed(2) + '%';
  chgEl.style.color = chg > 0 ? 'var(--crypto-positive)' : chg < 0 ? 'var(--crypto-negative)' : 'var(--text-2)';
  if (pd.ethbtc != null && pd.ethbtc > 0) {
    document.getElementById('eth-btc').textContent = pd.ethbtc.toFixed(5);
    cache.set('ethbtc', pd.ethbtc);
  }
  if (wma200Value > 0) applyWmaRatio();
}

function applyWmaRatio() {
  if (!price.value || wma200Value <= 0) return;
  const ratio = price.value / wma200Value;
  document.getElementById('eth-wma200-ratio').textContent = ratio.toFixed(2);
  const noteEl = document.getElementById('eth-wma200-note');
  if (ratio < 1) {
    noteEl.textContent = '低于 200WMA — 极端低估区间';
  } else if (ratio < 1.5) {
    noteEl.textContent = '接近 200WMA — 底部区间';
  } else if (ratio < 3) {
    noteEl.textContent = '高于 200WMA — 正常区间';
  } else {
    noteEl.textContent = '远超 200WMA — 过热信号';
  }
}

function applyMarket(md) {
  const mcapEl = document.getElementById('market-cap');
  mcapEl.textContent = '$' + (md.mcap / 1e9).toFixed(1) + 'B';

  const volEl = document.getElementById('volume-24h');
  volEl.textContent = '$' + (md.vol / 1e9).toFixed(1) + 'B';

  const supplyEl = document.getElementById('supply-total');
  supplyEl.textContent = (md.totalSupply / 1e6).toFixed(2) + ' M';

  const stakePct = (md.stakedEth / md.totalSupply * 100).toFixed(1);
  document.getElementById('supply-staked').textContent = (md.stakedEth / 1e6).toFixed(1) + ' M ETH';
  document.getElementById('supply-staked-pct').textContent = stakePct + '%';
  document.getElementById('supply-note').textContent = '质押年化约 3.5%';
}

async function fetchBmnr() {
  try {
    const r = await ft('/api/bmnr', 9000);
    const d = await r.json();
    if (!d || !d.holdings) throw new Error('no data');
    applyBmnr(d);
    cache.set('bmnr', d);
    markBmnrRecovered('bmnr', d.asOf);
    return true;
  } catch (e) {
    console.error('bmnr', e);
    markBmnrIssue('bmnr', 'BMNR 公司储备');
    return false;
  }
}

function fmtEth(v) {
  if (v >= 1e6) return (v / 1e6).toFixed(3) + ' M ETH';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + ' K ETH';
  return Math.round(v).toLocaleString() + ' ETH';
}
function fmtUsd(v) {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  return '$' + Math.round(v).toLocaleString();
}

function applyBmnr(d) {
  document.getElementById('bmnr-ticker').textContent = d.symbol || 'BMNR.US';
  document.getElementById('bmnr-rank').textContent = d.rank ? '#' + d.rank : '#—';
  document.getElementById('bmnr-pct').textContent = (d.pctOfSupply != null ? d.pctOfSupply.toFixed(3) + '%' : '—');
  document.getElementById('bmnr-eth').textContent = fmtEth(d.holdings);
  document.getElementById('bmnr-usd').textContent = fmtUsd(d.valueUsd);

  const stakedEst = d.holdings * 0.85;
  const yieldEl = document.getElementById('bmnr-yield');
  yieldEl.textContent = fmtUsd(stakedEst * (price.value || (d.valueUsd / d.holdings)) * 0.035) + ' /年';

  if (d.totalCorporateHoldings) {
    const share = d.holdings / d.totalCorporateHoldings * 100;
    const shareEl = document.getElementById('bmnr-share');
    shareEl.textContent = share.toFixed(1) + '%';
  }

  if (d.asOf) {
    const date = new Date(d.asOf);
    document.getElementById('bmnr-asof').textContent = date.toLocaleString('zh-CN', { hour12: false });
  }

  applyBmnrWeekly(d.holdings);
}

function applyBmnrWeekly(currentHoldings) {
  const KEY = 'eth_v2_bmnr_history';
  let hist = [];
  try { hist = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch(_) {}

  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  if (!hist.length || hist[hist.length - 1].d !== today) {
    hist.push({ d: today, t: now, h: currentHoldings });
  } else {
    hist[hist.length - 1].h = currentHoldings;
    hist[hist.length - 1].t = now;
  }
  const cutoff = now - 60 * 86400 * 1000;
  hist = hist.filter(s => s.t >= cutoff);
  try { localStorage.setItem(KEY, JSON.stringify(hist)); } catch(_) {}

  const target = now - 7 * 86400 * 1000;
  let best = null;
  for (const s of hist) {
    if (s.t > now - 8 * 86400 * 1000 && s.t < now - 6 * 86400 * 1000) {
      if (!best || Math.abs(s.t - target) < Math.abs(best.t - target)) best = s;
    }
  }

  const el = document.getElementById('bmnr-wkdelta');
  const sub = document.getElementById('bmnr-wkdelta-sub');
  if (!best) {
    const oldest = hist[0];
    if (oldest && oldest.t < now - 86400 * 1000) {
      const days = Math.floor((now - oldest.t) / 86400000);
      const delta = currentHoldings - oldest.h;
      const pct = oldest.h > 0 ? delta / oldest.h * 100 : 0;
      el.textContent = (delta > 0 ? '+' : delta < 0 ? '−' : '') + fmtEth(Math.abs(delta));
      el.style.color = delta > 0 ? 'var(--crypto-positive)' : delta < 0 ? 'var(--crypto-negative)' : 'var(--text-2)';
      sub.textContent = `${days} 天样本 · ${(pct > 0 ? '+' : '') + pct.toFixed(2)}%`;
    } else {
      el.textContent = fmtEth(currentHoldings);
      el.style.color = 'var(--text-2)';
      sub.textContent = '当前持仓 · 等待 7 日样本';
    }
    return;
  }
  const delta = currentHoldings - best.h;
  if (delta === 0) {
    el.textContent = fmtEth(currentHoldings);
    el.style.color = 'var(--text-2)';
    sub.textContent = '持仓无变动 · 较 ' + best.d;
    return;
  }
  const pct = (delta / best.h * 100);
  el.textContent = (delta >= 0 ? '+' : '−') + fmtEth(Math.abs(delta));
  el.style.color = delta > 0 ? 'var(--crypto-positive)' : 'var(--crypto-negative)';
  sub.textContent = (delta >= 0 ? '+' : '') + pct.toFixed(2) + '% · 较 ' + best.d;
}

// --- Show cache instantly ---
(function showCache() {
  const p = cache.get('price', 300000);   if (p) applyPrice(p);
  const e = cache.get('ethbtc', 300000);  if (e) document.getElementById('eth-btc').textContent = e.toFixed(5);
  const m = cache.get('market', 600000);  if (m) applyMarket(m);
  const b = cache.get('bmnr', 1800000);   if (b) applyBmnr(b);
  const bc = cache.get('bmnr-mnav', 86400000);
  if (bc?.mnav) { applyMnav('bmnr-mnav', bc.mnav); document.getElementById('bmnr-detail').textContent = '股价 $' + bc.price + ' · 市值 / ETH 持仓价值'; }
  const w = cache.get('wma200', 86400000);
  if (w) { wma200Value = w; document.getElementById('eth-wma200-price').textContent = '$' + Math.round(w).toLocaleString(); applyWmaRatio(); }
  const g = cache.get('gas', 120000);
  if (g != null) applyGas(g);
})();

async function fetchPrice() {
  try {
    const r = await ft('/api/eth-price', 6000);
    const d = await r.json();
    if (d && d.price > 0) {
      applyPrice(d);
      cache.set('price', d);
      markRecovered('ethPrice');
      return true;
    }
    throw new Error('invalid ETH price');
  } catch (e) {
    console.error('price', e);
    markIssue('ethPrice', 'ETH 实时价格');
    return false;
  }
}

async function fetchMarketAndSupply() {
  try {
    const r = await ft('/api/eth-market', 8000);
    const d = await r.json();
    if (d && d.mcap) {
      applyMarket(d);
      cache.set('market', d);
      markRecovered('ethMarket');
      return true;
    }
    throw new Error('invalid ETH market data');
  } catch(e) {
    console.error('market', e);
    markIssue('ethMarket', 'ETH 市场与供应');
    return false;
  }
}

function applyGas(gas) {
  if (gas == null || !Number.isFinite(Number(gas))) return false;
  const g = Number(gas);
  const disp = g >= 10 ? Math.round(g) : g >= 1 ? g.toFixed(1) : g.toFixed(2);
  const priceEl = document.getElementById('gas-price');
  const statusEl = document.getElementById('gas-status');
  const tone = g < 20 ? 'positive' : g < 50 ? 'neutral' : 'negative';
  const status = g < 20 ? '低费' : g < 50 ? '正常' : '拥堵';
  priceEl.textContent = disp + ' Gwei';
  priceEl.style.color = `var(--crypto-${tone})`;
  if (statusEl) {
    statusEl.textContent = status;
    statusEl.className = `metric-status tone-${tone}`;
  }
  return true;
}

async function fetchGas() {
  try {
    const r = await ft('/api/eth-gas', 8000);
    const d = await r.json();
    if (!applyGas(d.gas)) throw new Error('invalid gas data');
    cache.set('gas', d.gas);
    markRecovered('ethGas');
    return true;
  } catch(error) {
    console.error('gas', error);
    markIssue('ethGas', 'ETH Gas');
    return false;
  }
}

async function fetchWma200() {
  try {
    const r = await ft('/api/wma200?asset=eth', 8000);
    const d = await r.json();
    if (d.wma200 > 0) {
      wma200Value = d.wma200;
      document.getElementById('eth-wma200-price').textContent = '$' + Math.round(d.wma200).toLocaleString();
      applyWmaRatio();
      cache.set('wma200', d.wma200);
      markRecovered('ethWma');
      return true;
    }
    throw new Error('invalid ETH 200WMA');
  } catch(e) {
    console.error('200WMA', e);
    markIssue('ethWma', 'ETH 200 周均线');
    return false;
  }
}

function applyMnav(id, val) {
  const el = document.getElementById(id);
  if (!el || val == null || isNaN(val)) return;
  const statusEl = document.getElementById(`${id}-status`);
  const tone = val < 1 ? 'positive' : val < 2 ? 'neutral' : 'negative';
  const status = val < 1 ? '折价' : val < 2 ? '常态' : '高溢价';
  el.textContent = val.toFixed(2) + 'x';
  el.style.color = `var(--crypto-${tone})`;
  if (statusEl) {
    statusEl.textContent = status;
    statusEl.className = `metric-status tone-${tone}`;
  }
}

function applyMnavPayload(d, bmnrOverride) {
  const ethPrice = price.value || d?.eth_price;
  const b = d?.bmnr;
  if (!(ethPrice > 0) || !b?.stock_price) return false;

  let bmnrEth = bmnrOverride?.holdings || b.eth_holdings || 0;
  const cached = cache.get('bmnr', 1800000);
  if (!bmnrOverride?.holdings && cached?.holdings > 0) bmnrEth = cached.holdings;
  if (!(bmnrEth > 0) || !(b.shares > 0)) return false;

  const mcap = b.stock_price * b.shares;
  const mnav = mcap / (bmnrEth * ethPrice);
  applyMnav('bmnr-mnav', mnav);
  document.getElementById('bmnr-detail').textContent = '股价 $' + b.stock_price + ' · 市值 ' + fmtUsd(mcap);
  cache.set('bmnr-mnav', { mnav, eth: bmnrEth, price: b.stock_price, mcap });
  return true;
}

async function fetchMnav() {
  await price.wait(8000);
  if (!price.value) {
    markBmnrIssue('mstr', 'BMNR mNAV（等待 ETH 价格）');
    return false;
  }
  try {
    const d = await window.mehk3yLoadMstr();
    if (!applyMnavPayload(d)) throw new Error('invalid BMNR mNAV data');
    markBmnrRecovered('mstr');
    return true;
  } catch (e) {
    console.error('mNAV', e);
    markBmnrIssue('mstr', 'BMNR mNAV 股价数据');
    return false;
  }
}

function applyEthSummary(payload) {
  const groups = payload?.groups || {};
  if (groups.ethPrice?.ok && groups.ethPrice.data?.price > 0) {
    applyPrice(groups.ethPrice.data);
    cache.set('price', groups.ethPrice.data);
  }
  if (groups.ethMarket?.ok && groups.ethMarket.data?.mcap) {
    applyMarket(groups.ethMarket.data);
    cache.set('market', groups.ethMarket.data);
  }
  if (groups.ethGas?.ok && applyGas(groups.ethGas.data?.gas)) {
    cache.set('gas', groups.ethGas.data.gas);
  }
  if (groups.ethWma?.ok && groups.ethWma.data?.wma200 > 0) {
    wma200Value = groups.ethWma.data.wma200;
    document.getElementById('eth-wma200-price').textContent = '$' + Math.round(wma200Value).toLocaleString();
    applyWmaRatio();
    cache.set('wma200', wma200Value);
  }
  if (groups.bmnr?.ok && groups.bmnr.data?.holdings) {
    applyBmnr(groups.bmnr.data);
    cache.set('bmnr', groups.bmnr.data);
  }
  if (groups.mstr?.ok) applyMnavPayload(groups.mstr.data, groups.bmnr?.ok ? groups.bmnr.data : null);
}

async function recoverEthSummaryFailures(payload) {
  const groups = payload?.groups || {};
  const hadFailures = ['ethPrice', 'ethMarket', 'ethGas', 'ethWma', 'bmnr', 'mstr']
    .some(key => groups[key] && !groups[key].ok);
  const priceFailed = Boolean(groups.ethPrice && !groups.ethPrice.ok);
  if (priceFailed) {
    await fetchPrice();
    // Re-apply successful price-dependent BMNR/mNAV metrics after the
    // separately recovered ETH price has arrived.
    applyEthSummary(payload);
  }
  const jobs = [];
  if (groups.ethMarket && !groups.ethMarket.ok) jobs.push(fetchMarketAndSupply());
  if (groups.ethGas && !groups.ethGas.ok) jobs.push(fetchGas());
  if (groups.ethWma && !groups.ethWma.ok) jobs.push(fetchWma200());
  if (groups.bmnr && !groups.bmnr.ok) jobs.push(fetchBmnr());
  if (groups.mstr && !groups.mstr.ok) jobs.push(fetchMnav());
  if (jobs.length) await Promise.allSettled(jobs);
  if (hadFailures) cryptoUi.recoveryComplete?.();
}

document.addEventListener('mehk3y:crypto-summary', event => {
  applyEthSummary(event.detail);
  recoverEthSummaryFailures(event.detail).catch(error => console.error('ETH partial recovery', error));
});
const initialSummary = window.mehk3yCryptoSummary;
if (initialSummary.current) {
  applyEthSummary(initialSummary.current);
  recoverEthSummaryFailures(initialSummary.current).catch(error => console.error('ETH partial recovery', error));
} else {
  initialSummary.load().catch(async error => {
    console.error('crypto summary ETH fallback', error);
    await Promise.all([
      fetchPrice(), fetchMarketAndSupply(), fetchGas(),
      fetchWma200(), fetchBmnr(), fetchMnav(),
    ]);
  });
}

mehk3yStartPolling([
  { fn: fetchPrice,             ms: 15000   },
  { fn: fetchGas,               ms: 30000   },
  // Keep slow jobs off the BTC timer boundaries to leave room for retries.
  { fn: fetchMarketAndSupply,   ms: 683000   },
  { fn: fetchBmnr,              ms: 1861000  },
  { fn: fetchMnav,              ms: 3793000  },
  { fn: fetchWma200,            ms: 22003000 },
], () => { fetchPrice(); fetchGas(); });

})();
