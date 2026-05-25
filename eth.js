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

function applyPrice(pd) {
  if (!pd) return;
  price.resolve(pd.price);
  document.getElementById('eth-price').textContent = '$' + pd.price.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const chgEl = document.getElementById('eth-chg');
  const chg = pd.chg ?? 0;
  chgEl.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
  chgEl.style.color = chg >= 0 ? 'var(--green)' : 'var(--red)';
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
  const priceEl = document.getElementById('eth-wma200-price');
  if (ratio < 1) {
    noteEl.textContent = '低于 200WMA — 极端低估区间';
    priceEl.style.color = 'var(--red)';
  } else if (ratio < 1.5) {
    noteEl.textContent = '接近 200WMA — 底部区间';
    priceEl.style.color = 'var(--orange)';
  } else if (ratio < 3) {
    noteEl.textContent = '高于 200WMA — 正常区间';
    priceEl.style.color = 'var(--green)';
  } else {
    noteEl.textContent = '远超 200WMA — 过热信号';
    priceEl.style.color = 'var(--red)';
  }
}

function applyMarket(md) {
  const mcapEl = document.getElementById('market-cap');
  mcapEl.textContent = '$' + (md.mcap / 1e9).toFixed(1) + 'B';
  mcapEl.style.color = 'var(--green)';

  const volEl = document.getElementById('volume-24h');
  volEl.textContent = '$' + (md.vol / 1e9).toFixed(1) + 'B';
  volEl.style.color = 'var(--blue)';

  const supplyEl = document.getElementById('supply-total');
  supplyEl.textContent = (md.totalSupply / 1e6).toFixed(2) + ' M';
  supplyEl.style.color = 'var(--blue)';

  const stakePct = (md.stakedEth / md.totalSupply * 100).toFixed(1);
  document.getElementById('supply-staked').textContent = (md.stakedEth / 1e6).toFixed(1) + ' M ETH';
  document.getElementById('supply-staked-pct').textContent = stakePct + '%';
  document.getElementById('supply-staked-pct').style.color = 'var(--green)';
  document.getElementById('supply-note').textContent = '质押年化约 3.5%';
}

async function fetchBmnr() {
  try {
    const r = await ft('/api/bmnr', 9000);
    const d = await r.json();
    if (!d || !d.holdings) throw new Error('no data');
    applyBmnr(d);
    cache.set('bmnr', d);
  } catch (e) { console.error('bmnr', e); }
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
  yieldEl.style.color = 'var(--green)';

  if (d.totalCorporateHoldings) {
    const share = d.holdings / d.totalCorporateHoldings * 100;
    const shareEl = document.getElementById('bmnr-share');
    shareEl.textContent = share.toFixed(1) + '%';
    shareEl.style.color = 'var(--blue)';
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
      el.textContent = (delta >= 0 ? '+' : '−') + fmtEth(Math.abs(delta));
      el.style.color = delta >= 0 ? 'var(--green)' : 'var(--red)';
      sub.textContent = `${days} 天样本 · ${(delta >= 0 ? '+' : '') + pct.toFixed(2)}%`;
    } else {
      el.textContent = fmtEth(currentHoldings);
      el.style.color = 'var(--dim)';
      sub.textContent = '当前持仓 · 等待 7 日样本';
    }
    return;
  }
  const delta = currentHoldings - best.h;
  const pct = (delta / best.h * 100);
  el.textContent = (delta >= 0 ? '+' : '−') + fmtEth(Math.abs(delta));
  el.style.color = delta >= 0 ? 'var(--green)' : 'var(--red)';
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
})();

async function fetchPrice() {
  try {
    const r = await ft('/api/eth-price', 6000);
    const d = await r.json();
    if (d && d.price > 0) {
      applyPrice(d);
      cache.set('price', d);
    }
  } catch (e) { console.error('price', e); }
}

async function fetchMarketAndSupply() {
  try {
    const r = await ft('/api/eth-market', 8000);
    const d = await r.json();
    if (d && d.mcap) {
      applyMarket(d);
      cache.set('market', d);
    }
  } catch(e) { console.error('market', e); }
}

async function fetchGas() {
  try {
    const r = await ft('/api/eth-gas', 8000);
    const d = await r.json();
    if (d.gas != null) {
      const g = d.gas;
      const disp = g >= 10 ? Math.round(g) : g >= 1 ? g.toFixed(1) : g.toFixed(2);
      document.getElementById('gas-price').textContent = disp + ' Gwei';
      document.getElementById('gas-price').style.color = g < 20 ? 'var(--green)' : g < 50 ? 'var(--orange)' : 'var(--red)';
    } else {
      document.getElementById('gas-price').textContent = '—';
    }
  } catch(_) {
    document.getElementById('gas-price').textContent = '—';
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
    }
  } catch(e) { console.error('200WMA', e); }
}

function applyMnav(id, val) {
  const el = document.getElementById(id);
  if (!el || val == null || isNaN(val)) return;
  el.textContent = val.toFixed(2) + 'x';
  el.style.color = val < 1 ? 'var(--green)' : val < 2 ? 'var(--orange)' : 'var(--red)';
}

async function fetchMnav() {
  await price.wait(8000);
  if (!price.value) return;
  try {
    const r = await ft('/api/mstr', 10000);
    const d = await r.json();
    if (d.error) return;
    const ethPrice = d.eth_price || price.value;
    if (ethPrice <= 0) return;

    const b = d.bmnr;
    if (b?.stock_price) {
      // 优先用 /api/bmnr 缓存中的 CoinGecko 数据 (更准)
      let bmnrEth = b.eth_holdings || 0;
      const cached = cache.get('bmnr', 1800000);
      if (cached?.holdings && cached.holdings > 0) bmnrEth = cached.holdings;

      if (bmnrEth > 0) {
        const mcap = b.stock_price * b.shares;
        const mnav = mcap / (bmnrEth * ethPrice);
        applyMnav('bmnr-mnav', mnav);
        document.getElementById('bmnr-detail').textContent = '股价 $' + b.stock_price + ' · 市值 ' + fmtUsd(mcap);
        cache.set('bmnr-mnav', { mnav, eth: bmnrEth, price: b.stock_price });
      }
    }
  } catch (e) { console.error('mNAV', e); }
}

Promise.all([
  fetchPrice(),
  fetchMarketAndSupply(),
  fetchGas(),
  fetchWma200(),
  fetchBmnr(),
  fetchMnav(),
]);

mehk3yStartPolling([
  { fn: fetchPrice,             ms: 15000   },
  { fn: fetchGas,               ms: 30000   },
  { fn: fetchMarketAndSupply,   ms: 600000  },
  { fn: fetchWma200,            ms: 21600000 },
  { fn: fetchBmnr,              ms: 1800000 },
  { fn: fetchMnav,              ms: 3600000 },
], () => { fetchPrice(); fetchGas(); });

document.getElementById('refresh-btn')?.addEventListener('click', () => {
  const btn = document.getElementById('refresh-btn');
  if (btn.classList.contains('spinning')) return;
  btn.classList.add('spinning');
  Promise.all([
    fetchPrice(), fetchMarketAndSupply(),
    fetchGas(), fetchWma200(), fetchBmnr(), fetchMnav(),
  ]).finally(() => {
    setTimeout(() => btn.classList.remove('spinning'), 500);
  });
});

})();
