// BTC Dashboard. Depends on common.js (mehk3yCache/Fetch/PriceGate/etc.).
//
// 所有上游数据全部通过 /api/* 走 Vercel Edge Runtime,
// 国内用户也能拿到稳定的全球边缘节点响应。
//
// IIFE 包裹 — 让 const cache/ft/price 不暴露到全局，方便和 eth.js 在同一页面共存（/crypto）。

(function () {
'use strict';

const cache = mehk3yCache('btc_v3');
const ft    = mehk3yFetch;
const price = mehk3yPriceGate();

async function fetchJsonAny(urls, ms = 8000) {
  let lastErr;
  for (const url of urls) {
    try {
      const r = await ft(url, ms);
      return await r.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('all endpoints failed');
}

function fmtUsd(v) {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  return '$' + Math.round(v).toLocaleString();
}

function applyPrice(pd) {
  if (!pd?.price) return;
  price.resolve(pd.price);
  const priceEl = document.getElementById('btc-price');
  priceEl.textContent = '$' + pd.price.toLocaleString('en-US', { maximumFractionDigits: 0 });
  const chg = pd.chg ?? 0;
  const el = document.getElementById('btc-chg');
  el.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
  el.style.color = chg >= 0 ? 'var(--green)' : 'var(--red)';
}

async function fetchPrice() {
  try {
    const r = await ft('/api/btc-price', 6000);
    const d = await r.json();
    if (d && d.price > 0) return d;
  } catch (_) {}
  return null;
}

async function fetchData() {
  try {
    const pd = await fetchPrice();
    if (pd) {
      applyPrice(pd);
      cache.set('price', pd);
      // Recompute price-dependent metrics now that we have a live price.
      const wmaC = cache.get('wma200', 86400000); if (wmaC) applyWma200(wmaC);
      const bpC  = cache.get('bp', 86400000);     if (bpC)  applyBp(bpC);
      const ahrC = cache.get('ahr999', 86400000); if (ahrC) applyAhr999(ahrC);
    }
  } catch(e) { console.error('fetchData', e); }
}

async function fetchBtcStatus() {
  // 全网算力 + 减半倒计时一次合并取
  try {
    const r = await ft('/api/btc-status', 8000);
    const d = await r.json();
    if (d.hashrate != null) {
      document.getElementById('hashrate').textContent = d.hashrate.toFixed(1) + ' EH/s';
      cache.set('hashrate', d.hashrate);
    }
    if (d.halving) {
      applyHalving(d.halving);
      cache.set('halving', d.halving);
    }
  } catch(e) { console.error('btc-status', e); }
}

function applyFng(val) {
  const valEl = document.getElementById('fng-value');
  valEl.textContent = val;
  document.getElementById('fng-dot').style.left = val + '%';
  let label, color, desc;
  if (val <= 20)      { label='极度恐惧'; color='var(--red)';    desc='市场极度恐慌，历史上往往是买入机会'; }
  else if (val <= 40) { label='恐惧';     color='var(--orange)'; desc='市场情绪偏空，投资者较为谨慎'; }
  else if (val <= 60) { label='中性';     color='#ca8a04';       desc='市场情绪中性，多空力量均衡'; }
  else if (val <= 80) { label='贪婪';     color='var(--green)';  desc='市场情绪偏多，注意控制仓位'; }
  else                { label='极度贪婪'; color='var(--green)';  desc='市场过度乐观，可考虑分批止盈'; }
  valEl.style.color = color;
  document.getElementById('fng-status').textContent = label;
  document.getElementById('fng-status').style.color = color;
  document.getElementById('fng-desc').textContent = desc;
}

async function fetchFng() {
  try {
    const d = await fetchJsonAny(['/api/fng', '/api/btc-sentiment'], 8000);
    if (d.value != null) {
      applyFng(d.value);
      cache.set('fng', d.value);
    }
  } catch(e) { console.error('FnG', e); }
}

function applyWma200(wma) {
  const priceEl = document.getElementById('btc-wma200-price');
  priceEl.textContent = '$' + Math.round(wma).toLocaleString();
  if (!price.value) return;
  const ratio = price.value / wma;
  document.getElementById('btc-wma200-ratio').textContent = ratio.toFixed(2);
  const noteEl = document.getElementById('btc-wma200-note');
  if (ratio < 1)        noteEl.textContent = '低于 200WMA — 极端熊市';
  else if (ratio < 1.5) noteEl.textContent = '接近 200WMA — 历史底部区间';
  else if (ratio < 3)   noteEl.textContent = '高于 200WMA — 正常牛市区间';
  else                  noteEl.textContent = '远超 200WMA — 过热信号';
}

async function fetchWma200() {
  try {
    const r = await ft('/api/wma200?asset=btc', 8000);
    const d = await r.json();
    if (d.wma200 > 0) { applyWma200(d.wma200); cache.set('wma200', d.wma200); }
  } catch(e) { console.error('200WMA', e); }
}

function applyBp(bp) {
  const priceEl = document.getElementById('bp-price');
  priceEl.textContent = '$' + Math.round(bp).toLocaleString();
  if (!price.value) return;
  const ratio = price.value / bp;
  document.getElementById('bp-ratio').textContent = ratio.toFixed(2);
  const noteEl = document.getElementById('bp-note');
  if (ratio < 1)        noteEl.textContent = '低于 BP — 极度低估，历史大底';
  else if (ratio < 1.5) noteEl.textContent = '接近 BP — 底部区间';
  else if (ratio < 3)   noteEl.textContent = '高于 BP — 正常估值区间';
  else                  noteEl.textContent = '远超 BP — 估值偏高';
}

function applyMvrv(mvrv) {
  const el = document.getElementById('mvrv-value');
  const noteEl = document.getElementById('mvrv-note');
  el.textContent = mvrv.toFixed(2);
  if (mvrv < 1)        { el.style.color='var(--green)';  noteEl.textContent='MVRV 小于 1 — 低估区间，历史大底'; }
  else if (mvrv < 2)   { el.style.color='var(--green)';  noteEl.textContent='正常偏低 — 持币 / 定投区间'; }
  else if (mvrv < 3.5) { el.style.color='var(--orange)'; noteEl.textContent='正常偏高 — 注意风险'; }
  else                 { el.style.color='var(--red)';    noteEl.textContent='MVRV 大于 3.5 — 过热，历史顶部'; }
}

async function fetchOnchain() {
  try {
    const r = await ft('/api/btc-onchain', 12000);
    const d = await r.json();
    if (d.balancedPrice > 0) { applyBp(d.balancedPrice); cache.set('bp', d.balancedPrice); }
    if (d.mvrv > 0)          { applyMvrv(d.mvrv);        cache.set('mvrv', d.mvrv); }
  } catch(e) { console.error('onchain', e); }
}

function applyHalving(d) {
  document.getElementById('halving-days').textContent = d.days + ' 天';
  document.getElementById('halving-pct').textContent = d.progress + '%';
  document.getElementById('halving-block').textContent = d.height.toLocaleString();
  document.getElementById('halving-date').textContent = d.date;
  document.getElementById('halving-fill').style.width = d.progress + '%';
}

function applyAhr999(ahr) {
  const el = document.getElementById('ahr999');
  el.textContent = ahr.toFixed(2);
  if (ahr < 0.45)      { el.style.color='var(--green)';  el.title='抄底区间'; }
  else if (ahr < 1.2)  { el.style.color='var(--green)';  el.title='定投区间'; }
  else if (ahr < 5)    { el.style.color='var(--orange)'; el.title='观望区间'; }
  else                 { el.style.color='var(--red)';    el.title='泡沫区间'; }
}

async function fetchAhr999() {
  await price.wait(12000);
  if (!price.value) return;
  try {
    const r = await ft('/api/ahr999', 8000);
    const d = await r.json();
    if (d.dma200 > 0 && d.expPrice > 0) {
      const ahr = (price.value / d.dma200) * (price.value / d.expPrice);
      applyAhr999(ahr);
      cache.set('ahr999', ahr);
    }
  } catch(e) { console.error('ahr999', e); }
}

function applyMnav(id, val) {
  const el = document.getElementById(id);
  if (!el || val == null || isNaN(val)) return;
  el.textContent = val.toFixed(2) + 'x';
  el.style.color = val < 1 ? 'var(--green)' : val < 2 ? 'var(--orange)' : 'var(--red)';
}
function setEl(id, text, color) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  if (color) el.style.color = color;
}

function fmtBtc(v) {
  const n = Math.abs(v);
  const s = n >= 1000 ? Math.round(n).toLocaleString() : n >= 10 ? n.toFixed(1) : n.toFixed(2);
  return s + ' BTC';
}

function applyMstrHoldingTrend(currentHoldings) {
  const KEY = 'btc_v3_mstr_history';
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

  const oldest = hist[0];
  const baseline = best || oldest;
  const days = best ? 7 : oldest ? Math.max(1, Math.floor((now - oldest.t) / 86400000)) : 7;
  const delta = baseline ? currentHoldings - baseline.h : 0;
  const daily = delta / days;
  const color = delta > 0 ? 'var(--green)' : delta < 0 ? 'var(--red)' : 'var(--dim)';
  const weekEl = document.getElementById('mstr-week-delta');
  const dayEl = document.getElementById('mstr-daily-delta');
  if (!weekEl || !dayEl) return;

  weekEl.textContent = (delta > 0 ? '+' : delta < 0 ? '−' : '') + fmtBtc(delta);
  dayEl.textContent = (daily > 0 ? '+' : daily < 0 ? '−' : '') + fmtBtc(daily);
  weekEl.style.color = color;
  dayEl.style.color = color;
  weekEl.title = best ? `较 ${best.d}` : '等待 7 日样本，当前显示自首次采样以来变化';
  dayEl.title = weekEl.title;
}

async function fetchMnavAll() {
  try {
    const d = await fetchJsonAny(['/api/mstr', '/api/strategy-btc'], 12000);
    if (d.error) return;
    const m = d.mstr;
    if (!m?.stock_price) return;

    const mcap = m.stock_price * (m.shares || 0);

    setEl('mstr-holdings', (m.btc_holdings || 0).toLocaleString() + ' BTC');
    setEl('mstr-pct',      m.btc_holdings ? (m.btc_holdings / 19_800_000 * 100).toFixed(2) + '%' : '—');
    setEl('mstr-stock',    '$' + m.stock_price, 'var(--blue)');
    setEl('mstr-mcap',     '市值 ' + fmtUsd(mcap));
    if (m.btc_holdings) applyMstrHoldingTrend(m.btc_holdings);

    await price.wait(12000);
    const btcPrice = price.value;
    if (btcPrice <= 0 || !m.btc_holdings) return;

    const btcVal = m.btc_holdings * btcPrice;
    const basic  = mcap / btcVal;
    const ev     = (mcap + (m.debt||0) + (m.pref||0)) / (btcVal + (m.cash||0));
    applyMnav('mstr-mnav', ev);
    applyMnav('mstr-basic', basic);
    setEl('mstr-holdings-usd', fmtUsd(btcVal));
    setEl('mstr-btcval',       fmtUsd(btcVal), 'var(--orange)');
    cache.set('mstr-mnav', { basic, ev, holdings: m.btc_holdings, price: m.stock_price, btcval: btcVal, mcap });
  } catch(e) { console.error('mNAV', e); }
}

function applyBtcSnapshot(d) {
  if (!d || d.asset !== 'btc') return false;
  if (d.price?.price > 0) {
    applyPrice(d.price);
    cache.set('price', d.price);
  }
  if (d.hashrate != null) {
    document.getElementById('hashrate').textContent = d.hashrate.toFixed(1) + ' EH/s';
    cache.set('hashrate', d.hashrate);
  }
  if (d.halving) {
    applyHalving(d.halving);
    cache.set('halving', d.halving);
  }
  if (d.fng != null) {
    applyFng(d.fng);
    cache.set('fng', d.fng);
  }
  if (d.wma200 > 0) {
    applyWma200(d.wma200);
    cache.set('wma200', d.wma200);
  }
  if (d.onchain?.balancedPrice > 0) {
    applyBp(d.onchain.balancedPrice);
    cache.set('bp', d.onchain.balancedPrice);
  }
  if (d.onchain?.mvrv > 0) {
    applyMvrv(d.onchain.mvrv);
    cache.set('mvrv', d.onchain.mvrv);
  }
  if (d.ahr999 > 0) {
    applyAhr999(d.ahr999);
    cache.set('ahr999', d.ahr999);
  }
  if (d.mstr?.stock_price) {
    const m = d.mstr;
    setEl('mstr-holdings', (m.btc_holdings || 0).toLocaleString() + ' BTC');
    setEl('mstr-pct', d.mstrComputed?.pctSupply != null ? d.mstrComputed.pctSupply.toFixed(2) + '%' : '—');
    setEl('mstr-stock', '$' + m.stock_price, 'var(--blue)');
    setEl('mstr-mcap', d.mstrComputed?.mcap ? '市值 ' + fmtUsd(d.mstrComputed.mcap) : '市值 $—');
    if (m.btc_holdings) applyMstrHoldingTrend(m.btc_holdings);
    if (d.mstrComputed?.ev) applyMnav('mstr-mnav', d.mstrComputed.ev);
    if (d.mstrComputed?.basic) applyMnav('mstr-basic', d.mstrComputed.basic);
    if (d.mstrComputed?.btcVal) {
      setEl('mstr-holdings-usd', fmtUsd(d.mstrComputed.btcVal));
      setEl('mstr-btcval', fmtUsd(d.mstrComputed.btcVal), 'var(--orange)');
    }
    cache.set('mstr-mnav', {
      basic: d.mstrComputed?.basic,
      ev: d.mstrComputed?.ev,
      holdings: m.btc_holdings,
      price: m.stock_price,
      btcval: d.mstrComputed?.btcVal,
      mcap: d.mstrComputed?.mcap,
    });
  }
  return true;
}

async function fetchBtcSnapshot() {
  // /data/btc.json 只是个加速首屏的预渲染快照 —— 不是数据源真相。
  // 真正的实时数据走下面的 /api/* 并行请求。所以快照失败不应弹错误 toast，
  // 否则会出现「数据全有但红色 ‘数据加载失败’ 提示」的诡异画面。
  try {
    const r = await ft('/data/btc.json?ts=' + Math.floor(Date.now() / 60000), 9000);
    const d = await r.json();
    if (applyBtcSnapshot(d)) cache.set('snapshot', d);
  } catch (e) {
    const cached = cache.get('snapshot', 6 * 3600000);
    if (cached) applyBtcSnapshot(cached);
    else console.warn('btc snapshot unavailable (fallback to live /api/*)', e);
  }
}

function loadCache() {
  const WEEK = 7 * 86400000;
  const p = cache.get('price', WEEK);
  if (p) {
    applyPrice(p);
  }
  const hr  = cache.get('hashrate', WEEK);    if (hr)   document.getElementById('hashrate').textContent = (typeof hr === 'number' ? hr.toFixed(1) : hr) + ' EH/s';
  const fng = cache.get('fng', 7200000);      if (fng)  applyFng(fng);
  const wma = cache.get('wma200', WEEK);      if (wma)  applyWma200(wma);
  const bp  = cache.get('bp', WEEK);          if (bp)   applyBp(bp);
  const halv= cache.get('halving', WEEK);     if (halv) applyHalving(halv);
  const ahr = cache.get('ahr999', WEEK);      if (ahr)  applyAhr999(ahr);
  const mvrv= cache.get('mvrv', WEEK);        if (mvrv) applyMvrv(mvrv);
  try {
    const mc = cache.get('mstr-mnav', 86400000);
    if (mc?.ev) {
      applyMnav('mstr-mnav', mc.ev);
      applyMnav('mstr-basic', mc.basic);
      setEl('mstr-holdings',     (mc.holdings||0).toLocaleString() + ' BTC');
      setEl('mstr-holdings-usd', mc.btcval ? fmtUsd(mc.btcval) : '$—');
      setEl('mstr-pct',          mc.holdings ? (mc.holdings / 19_800_000 * 100).toFixed(2) + '%' : '—');
      if (mc.holdings) applyMstrHoldingTrend(mc.holdings);
      setEl('mstr-stock',        '$' + mc.price, 'var(--blue)');
      setEl('mstr-mcap',         mc.mcap ? '市值 ' + fmtUsd(mc.mcap) : '市值 $—');
      setEl('mstr-btcval',       mc.btcval ? fmtUsd(mc.btcval) : '$—', 'var(--orange)');
    }
  } catch(_) {}
}

loadCache();
fetchBtcSnapshot();
Promise.all([
  fetchData(),
  fetchFng(),
  fetchWma200(),
  fetchBtcStatus(),
  fetchAhr999(),
  fetchOnchain(),
  fetchMnavAll(),
]);

mehk3yStartPolling([
  { fn: fetchData,      ms: 15000   },
  { fn: fetchFng,       ms: 600000  },
  { fn: fetchAhr999,    ms: 300000  },
  { fn: fetchWma200,    ms: 21600000 },
  { fn: fetchBtcStatus, ms: 600000  },
  { fn: fetchOnchain,   ms: 3600000 },
  { fn: fetchMnavAll,   ms: 3600000 },
], fetchData);

document.getElementById('refresh-btn')?.addEventListener('click', () => {
  const btn = document.getElementById('refresh-btn');
  if (btn.classList.contains('spinning')) return;
  btn.classList.add('spinning');
  Promise.all([
    fetchData(), fetchFng(), fetchWma200(), fetchBtcStatus(),
    fetchAhr999(), fetchOnchain(), fetchMnavAll(),
  ]).finally(() => {
    setTimeout(() => btn.classList.remove('spinning'), 500);
  });
});

})();
