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
let latestMstrPayload = null;

const zoneGroups = {
  btc:  ['btcPrice', 'btcStatus', 'fng', 'btcWma', 'btcOnchain', 'ahr999'],
  mstr: ['mstr'],
  eth:  ['ethPrice', 'ethMarket', 'ethGas', 'ethWma'],
  bmnr: ['bmnr', 'mstr'],
};

const zoneState = Object.fromEntries(Object.keys(zoneGroups).map(zone => [zone, {
  summaryErrors: new Map(),
  liveErrors: new Map(),
  sources: [],
  freshness: '等待更新',
  updatedAt: null,
}]));

function formatUpdatedAt(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '时间未知';
  return date.toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

function compactSources(groups) {
  const sources = [];
  groups.forEach(group => {
    String(group?.meta?.source || '').split(/\s*\/\s*/).forEach(source => {
      if (source && !sources.includes(source)) sources.push(source);
    });
  });
  return sources;
}

function renderZone(zone) {
  const state = zoneState[zone];
  const metaEl = document.getElementById(`${zone}-data-meta`);
  const errorEl = document.getElementById(`${zone}-data-error`);
  if (metaEl) {
    const sourceText = state.sources.length ? state.sources.join('、') : '已有本地缓存';
    const timeText = state.updatedAt ? formatUpdatedAt(state.updatedAt) : '等待更新';
    metaEl.textContent = `来源：${sourceText} · ${state.freshness} · 更新 ${timeText}`;
  }

  if (!errorEl) return;
  const messages = [
    ...state.summaryErrors.values(),
    ...state.liveErrors.values(),
  ];
  errorEl.hidden = messages.length === 0;
  errorEl.textContent = messages.length
    ? `部分数据暂不可用：${[...new Set(messages)].join('；')}。继续显示上一笔可用数据。`
    : '';
}

function applyZoneSummary(zone, groups) {
  const state = zoneState[zone];
  const keys = zoneGroups[zone];
  const available = keys.map(key => groups[key]).filter(Boolean);
  const successful = available.filter(group => group.ok);
  state.summaryErrors = new Map(
    keys
      .filter(key => groups[key] && !groups[key].ok)
      .map(key => [key, groups[key].meta?.label || key])
  );
  keys.forEach(key => {
    if (groups[key]?.ok) state.liveErrors.delete(key);
  });
  state.sources = compactSources(successful);
  const hasRealtime = successful.some(group => group.meta?.freshness?.includes('实时'));
  const hasCached = successful.some(group => !group.meta?.freshness?.includes('实时'));
  state.freshness = hasRealtime && hasCached ? '实时 + 分层缓存'
    : hasRealtime ? '实时数据' : '缓存数据';
  const timestamps = successful
    .map(group => Date.parse(group.meta?.updatedAt || ''))
    .filter(Number.isFinite);
  state.updatedAt = timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
  renderZone(zone);
}

function setOverall(text, state = '') {
  const el = document.getElementById('update-summary');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('is-ok', 'is-partial', 'is-error');
  if (state) el.classList.add(`is-${state}`);
}

function applySummaryStatus(payload) {
  Object.keys(zoneGroups).forEach(zone => applyZoneSummary(zone, payload.groups || {}));
  const summary = payload.summary || {};
  const successful = Number(summary.successful || 0);
  const total = Number(summary.total || Object.keys(payload.groups || {}).length);
  const failed = Math.max(0, total - successful);
  const updated = formatUpdatedAt(payload.generatedAt);
  if (!successful) {
    setOverall(`最新数据暂时无法获取 · ${updated} · 页面继续显示本地缓存`, 'error');
  } else if (failed) {
    setOverall(`${successful}/${total} 组数据已更新 · ${failed} 组沿用缓存 · ${updated}`, 'partial');
  } else {
    setOverall(`${total} 组数据已更新 · ${updated} · 价格每 15 秒、Gas 每 30 秒自动更新`, 'ok');
  }
}

function markIssue(zone, key, message) {
  const state = zoneState[zone];
  if (!state) return;
  state.liveErrors.set(key, message);
  renderZone(zone);
}

function markRecovered(zone, key, updatedAt = new Date().toISOString()) {
  const state = zoneState[zone];
  if (!state) return;
  state.liveErrors.delete(key);
  state.summaryErrors.delete(key);
  state.updatedAt = updatedAt;
  renderZone(zone);
}

function reportRecoveryResult() {
  const remaining = new Set();
  Object.values(zoneState).forEach(state => {
    state.summaryErrors.forEach((_, key) => remaining.add(key));
    state.liveErrors.forEach((_, key) => remaining.add(key));
  });
  const updated = formatUpdatedAt(new Date().toISOString());
  if (remaining.size) {
    setOverall(`分项恢复已完成 · 仍有 ${remaining.size} 项暂不可用 · ${updated}`, 'partial');
  } else {
    setOverall(`聚合缺失已通过分项请求恢复 · ${updated}`, 'ok');
  }
}

function showGlobalError(message) {
  const el = document.getElementById('error-toast');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  el.setAttribute('aria-hidden', 'false');
  el.setAttribute('role', 'alert');
  el.classList.add('show');
  clearTimeout(showGlobalError.timer);
  showGlobalError.timer = setTimeout(() => {
    el.classList.remove('show');
    el.hidden = true;
    el.setAttribute('aria-hidden', 'true');
    el.removeAttribute('role');
  }, 5000);
}

const summaryLoader = (() => {
  let current = null;
  let inFlight = null;
  let loadedAt = 0;

  async function load({ force = false } = {}) {
    if (inFlight) return inFlight;
    if (!force && current && Date.now() - loadedAt < 10000) return current;
    const suffix = force ? `?refresh=${Date.now()}` : '';
    inFlight = (async () => {
      const response = await ft(`/api/crypto-summary${suffix}`, 16000);
      const payload = await response.json();
      if (!payload?.groups || !payload?.summary) throw new Error('invalid crypto summary');
      current = payload;
      loadedAt = Date.now();
      applySummaryStatus(payload);
      document.dispatchEvent(new CustomEvent('mehk3y:crypto-summary', { detail: payload }));
      return payload;
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  return { load, get current() { return current; } };
})();

window.mehk3yCryptoSummary = summaryLoader;
window.mehk3yCryptoUi = {
  issue: markIssue,
  recovered: markRecovered,
  recoveryComplete: reportRecoveryResult,
};

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

const sharedMstrLoader = (() => {
  let value = null;
  let loadedAt = 0;
  let inFlight = null;
  return async function loadMstr() {
    if (value && Date.now() - loadedAt < 60000) return value;
    if (inFlight) return inFlight;
    inFlight = fetchJsonAny(['/api/mstr', '/api/strategy-btc'], 12000)
      .then(data => {
        if (!data?.mstr?.stock_price) throw new Error(data?.error || 'no MSTR data');
        value = data;
        loadedAt = Date.now();
        return data;
      })
      .finally(() => { inFlight = null; });
    return inFlight;
  };
})();

window.mehk3yLoadMstr = sharedMstrLoader;

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
  el.textContent = (chg > 0 ? '+' : '') + chg.toFixed(2) + '%';
  el.style.color = chg > 0 ? 'var(--crypto-positive)' : chg < 0 ? 'var(--crypto-negative)' : 'var(--text-2)';
  // MSTR may arrive before BTC price during a degraded fallback. Replaying
  // the last payload closes that race so mNAV and USD values do not stay blank.
  if (latestMstrPayload) applyMstrPayload(latestMstrPayload);
}

async function fetchPrice() {
  const r = await ft('/api/btc-price', 6000);
  const d = await r.json();
  if (!d || d.price <= 0) throw new Error('invalid BTC price');
  return d;
}

async function fetchData() {
  try {
    const pd = await fetchPrice();
    applyPrice(pd);
    cache.set('price', pd);
    // Recompute price-dependent metrics now that we have a live price.
    const wmaC = cache.get('wma200', 86400000); if (wmaC) applyWma200(wmaC);
    const bpC  = cache.get('bp', 86400000);     if (bpC)  applyBp(bpC);
    const ahrC = cache.get('ahr999', 86400000); if (ahrC) applyAhr999(ahrC);
    markRecovered('btc', 'btcPrice');
    return true;
  } catch(e) {
    console.error('fetchData', e);
    markIssue('btc', 'btcPrice', 'BTC 实时价格');
    return false;
  }
}

async function fetchBtcStatus() {
  // 全网算力 + 减半倒计时一次合并取
  try {
    const r = await ft('/api/btc-status', 8000);
    const d = await r.json();
    let applied = false;
    if (d.hashrate != null) {
      document.getElementById('hashrate').textContent = d.hashrate.toFixed(1) + ' EH/s';
      cache.set('hashrate', d.hashrate);
      applied = true;
    }
    if (d.halving) {
      applyHalving(d.halving);
      cache.set('halving', d.halving);
      applied = true;
    }
    if (!applied) throw new Error('invalid BTC status');
    markRecovered('btc', 'btcStatus');
    return true;
  } catch(e) {
    console.error('btc-status', e);
    markIssue('btc', 'btcStatus', 'BTC 网络状态');
    return false;
  }
}

function applyFng(val) {
  const valEl = document.getElementById('fng-value');
  valEl.textContent = val;
  document.getElementById('fng-dot').style.left = val + '%';
  let label, color, desc;
  if (val <= 20)      { label='极度恐惧'; color='var(--crypto-negative)'; desc='市场极度恐慌，历史上往往是买入机会'; }
  else if (val <= 40) { label='恐惧';     color='var(--crypto-neutral)';  desc='市场情绪偏空，投资者较为谨慎'; }
  else if (val <= 60) { label='中性';     color='var(--crypto-neutral)';  desc='市场情绪中性，多空力量均衡'; }
  else if (val <= 80) { label='贪婪';     color='var(--crypto-positive)'; desc='市场情绪偏多，注意控制仓位'; }
  else                { label='极度贪婪'; color='var(--crypto-negative)'; desc='市场过度乐观，可考虑分批止盈'; }
  valEl.style.color = color;
  document.getElementById('fng-status').textContent = label;
  document.getElementById('fng-status').style.color = color;
  document.getElementById('fng-desc').textContent = desc;
}

async function fetchFng() {
  try {
    const d = await fetchJsonAny(['/api/fng', '/api/btc-sentiment'], 8000);
    if (d.value == null) throw new Error('invalid F&G');
    applyFng(d.value);
    cache.set('fng', d.value);
    markRecovered('btc', 'fng');
    return true;
  } catch(e) {
    console.error('FnG', e);
    markIssue('btc', 'fng', '恐惧贪婪指数');
    return false;
  }
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
    if (!(d.wma200 > 0)) throw new Error('invalid BTC 200WMA');
    applyWma200(d.wma200);
    cache.set('wma200', d.wma200);
    markRecovered('btc', 'btcWma');
    return true;
  } catch(e) {
    console.error('200WMA', e);
    markIssue('btc', 'btcWma', 'BTC 200 周均线');
    return false;
  }
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
  if (mvrv < 1)        { el.style.color='var(--crypto-positive)'; noteEl.textContent='MVRV 小于 1 — 低估区间，历史大底'; }
  else if (mvrv < 2)   { el.style.color='var(--crypto-positive)'; noteEl.textContent='正常偏低 — 持币 / 定投区间'; }
  else if (mvrv < 3.5) { el.style.color='var(--crypto-neutral)';  noteEl.textContent='正常偏高 — 注意风险'; }
  else                 { el.style.color='var(--crypto-negative)'; noteEl.textContent='MVRV 大于 3.5 — 过热，历史顶部'; }
}

async function fetchOnchain() {
  try {
    const r = await ft('/api/btc-onchain', 12000);
    const d = await r.json();
    let applied = false;
    if (d.balancedPrice > 0) { applyBp(d.balancedPrice); cache.set('bp', d.balancedPrice); applied = true; }
    if (d.mvrv > 0)          { applyMvrv(d.mvrv);        cache.set('mvrv', d.mvrv); applied = true; }
    if (!applied) throw new Error('invalid on-chain data');
    markRecovered('btc', 'btcOnchain');
    return true;
  } catch(e) {
    console.error('onchain', e);
    markIssue('btc', 'btcOnchain', 'BTC 链上估值');
    return false;
  }
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
  if (ahr < 0.45)      { el.style.color='var(--crypto-positive)'; el.title='抄底区间'; }
  else if (ahr < 1.2)  { el.style.color='var(--crypto-positive)'; el.title='定投区间'; }
  else if (ahr < 5)    { el.style.color='var(--crypto-neutral)';  el.title='观望区间'; }
  else                 { el.style.color='var(--crypto-negative)'; el.title='泡沫区间'; }
}

async function fetchAhr999() {
  await price.wait(12000);
  if (!price.value) {
    markIssue('btc', 'ahr999', 'AHR999（等待价格）');
    return false;
  }
  try {
    const r = await ft('/api/ahr999', 8000);
    const d = await r.json();
    if (!(d.dma200 > 0 && d.expPrice > 0)) throw new Error('invalid AHR999');
    const ahr = (price.value / d.dma200) * (price.value / d.expPrice);
    applyAhr999(ahr);
    cache.set('ahr999', ahr);
    markRecovered('btc', 'ahr999');
    return true;
  } catch(e) {
    console.error('ahr999', e);
    markIssue('btc', 'ahr999', 'AHR999');
    return false;
  }
}

function applyMnav(id, val) {
  const el = document.getElementById(id);
  if (!el || val == null || isNaN(val)) return;
  el.textContent = val.toFixed(2) + 'x';
  el.style.color = val < 1 ? 'var(--crypto-positive)' : val < 2 ? 'var(--crypto-neutral)' : 'var(--crypto-negative)';
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
  const color = delta > 0 ? 'var(--crypto-positive)' : delta < 0 ? 'var(--crypto-negative)' : 'var(--text-2)';
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

function applyMstrPayload(d) {
  const m = d?.mstr;
  if (!m?.stock_price) return false;
  latestMstrPayload = d;
  const mcap = m.stock_price * (m.shares || 0);

  setEl('mstr-holdings', (m.btc_holdings || 0).toLocaleString() + ' BTC');
  setEl('mstr-pct',      m.btc_holdings ? (m.btc_holdings / 19_800_000 * 100).toFixed(2) + '%' : '—');
  setEl('mstr-stock',    '$' + m.stock_price);
  setEl('mstr-mcap',     '市值 ' + fmtUsd(mcap));
  if (m.btc_holdings) applyMstrHoldingTrend(m.btc_holdings);

  const btcPrice = price.value;
  if (btcPrice > 0 && m.btc_holdings) {
    const btcVal = m.btc_holdings * btcPrice;
    const basic  = mcap / btcVal;
    const ev     = (mcap + (m.debt || 0) + (m.pref || 0)) / (btcVal + (m.cash || 0));
    applyMnav('mstr-mnav', ev);
    applyMnav('mstr-basic', basic);
    setEl('mstr-holdings-usd', fmtUsd(btcVal));
    setEl('mstr-btcval', fmtUsd(btcVal));
    cache.set('mstr-mnav', {
      basic, ev, holdings: m.btc_holdings, price: m.stock_price, btcval: btcVal, mcap,
    });
  }
  return true;
}

async function fetchMnavAll() {
  try {
    const d = await sharedMstrLoader();
    if (!applyMstrPayload(d)) throw new Error('invalid MSTR data');
    markRecovered('mstr', 'mstr');
    markRecovered('bmnr', 'mstr');
    return true;
  } catch(e) {
    console.error('mNAV', e);
    markIssue('mstr', 'mstr', 'Strategy 公司储备与 mNAV');
    markIssue('bmnr', 'mstr', 'BMNR mNAV 股价数据');
    return false;
  }
}

function applyBtcSummary(payload) {
  const groups = payload?.groups || {};
  const btcPrice = groups.btcPrice;
  if (btcPrice?.ok && btcPrice.data?.price > 0) {
    applyPrice(btcPrice.data);
    cache.set('price', btcPrice.data);
  }

  const status = groups.btcStatus;
  if (status?.ok) {
    if (status.data.hashrate != null) {
      document.getElementById('hashrate').textContent = status.data.hashrate.toFixed(1) + ' EH/s';
      cache.set('hashrate', status.data.hashrate);
    }
    if (status.data.halving) {
      applyHalving(status.data.halving);
      cache.set('halving', status.data.halving);
    }
  }

  const fng = groups.fng;
  if (fng?.ok && fng.data.value != null) {
    applyFng(fng.data.value);
    cache.set('fng', fng.data.value);
  }

  const wma = groups.btcWma;
  if (wma?.ok && wma.data.wma200 > 0) {
    applyWma200(wma.data.wma200);
    cache.set('wma200', wma.data.wma200);
  }

  const onchain = groups.btcOnchain;
  if (onchain?.ok) {
    if (onchain.data.balancedPrice > 0) {
      applyBp(onchain.data.balancedPrice);
      cache.set('bp', onchain.data.balancedPrice);
    }
    if (onchain.data.mvrv > 0) {
      applyMvrv(onchain.data.mvrv);
      cache.set('mvrv', onchain.data.mvrv);
    }
  }

  const ahr = groups.ahr999;
  if (ahr?.ok && ahr.data.dma200 > 0 && ahr.data.expPrice > 0 && price.value > 0) {
    const value = (price.value / ahr.data.dma200) * (price.value / ahr.data.expPrice);
    applyAhr999(value);
    cache.set('ahr999', value);
  }

  if (groups.mstr?.ok) applyMstrPayload(groups.mstr.data);
}

async function recoverBtcSummaryFailures(payload) {
  const groups = payload?.groups || {};
  const hadFailures = Object.values(groups).some(group => group && !group.ok);
  const priceFailed = Boolean(groups.btcPrice && !groups.btcPrice.ok);
  if (priceFailed) {
    await fetchData();
    // Re-apply successful price-dependent groups (AHR999 and mNAV) now that
    // the separately recovered price is available.
    applyBtcSummary(payload);
  }
  const jobs = [];
  if (groups.btcStatus && !groups.btcStatus.ok) jobs.push(fetchBtcStatus());
  if (groups.fng && !groups.fng.ok) jobs.push(fetchFng());
  if (groups.btcWma && !groups.btcWma.ok) jobs.push(fetchWma200());
  if (groups.btcOnchain && !groups.btcOnchain.ok) jobs.push(fetchOnchain());
  if (groups.ahr999 && !groups.ahr999.ok) jobs.push(fetchAhr999());
  if (groups.mstr && !groups.mstr.ok) jobs.push(fetchMnavAll());
  if (jobs.length) await Promise.allSettled(jobs);
  if (hadFailures) reportRecoveryResult();
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
    setEl('mstr-stock', '$' + m.stock_price);
    setEl('mstr-mcap', d.mstrComputed?.mcap ? '市值 ' + fmtUsd(d.mstrComputed.mcap) : '市值 $—');
    if (m.btc_holdings) applyMstrHoldingTrend(m.btc_holdings);
    if (d.mstrComputed?.ev) applyMnav('mstr-mnav', d.mstrComputed.ev);
    if (d.mstrComputed?.basic) applyMnav('mstr-basic', d.mstrComputed.basic);
    if (d.mstrComputed?.btcVal) {
      setEl('mstr-holdings-usd', fmtUsd(d.mstrComputed.btcVal));
      setEl('mstr-btcval', fmtUsd(d.mstrComputed.btcVal));
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
  const fng = cache.get('fng', 7200000);      if (fng != null) applyFng(fng);
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
      setEl('mstr-stock',        '$' + mc.price);
      setEl('mstr-mcap',         mc.mcap ? '市值 ' + fmtUsd(mc.mcap) : '市值 $—');
      setEl('mstr-btcval',       mc.btcval ? fmtUsd(mc.btcval) : '$—');
    }
  } catch(_) {}
}

loadCache();
document.addEventListener('mehk3y:crypto-summary', event => {
  applyBtcSummary(event.detail);
  recoverBtcSummaryFailures(event.detail).catch(error => console.error('BTC partial recovery', error));
});
summaryLoader.load().catch(async error => {
  console.error('crypto summary', error);
  setOverall('聚合数据暂不可用，正在逐项恢复；页面会优先保留已有缓存', 'partial');
  await fetchBtcSnapshot();
  await Promise.all([
    fetchData(), fetchFng(), fetchWma200(), fetchBtcStatus(),
    fetchAhr999(), fetchOnchain(), fetchMnavAll(),
  ]);
  setOverall('已完成备用数据恢复；仍不可用的项目已在对应分区标出', 'partial');
});

mehk3yStartPolling([
  { fn: fetchData,      ms: 15000   },
  // Slow jobs are deliberately staggered so retries cannot bunch up against
  // the 30 requests/minute browser-IP limit at each 10-minute/hour boundary.
  { fn: fetchAhr999,    ms: 310000   },
  { fn: fetchFng,       ms: 613000   },
  { fn: fetchBtcStatus, ms: 647000   },
  { fn: fetchOnchain,   ms: 3617000  },
  { fn: fetchMnavAll,   ms: 3731000  },
  { fn: fetchWma200,    ms: 21701000 },
], fetchData);

let lastManualRefresh = 0;
document.getElementById('refresh-btn')?.addEventListener('click', async () => {
  const btn = document.getElementById('refresh-btn');
  const now = Date.now();
  if (btn.disabled || now - lastManualRefresh < 2000) return;
  lastManualRefresh = now;
  btn.disabled = true;
  btn.classList.add('spinning');
  btn.setAttribute('aria-busy', 'true');
  try {
    await summaryLoader.load({ force: true });
  } catch (error) {
    console.error('manual refresh', error);
    showGlobalError('刷新失败，页面继续显示上一笔可用数据');
    setOverall('刷新失败 · 已保留上一笔可用数据 · 请稍后再试', 'error');
  } finally {
    setTimeout(() => {
      btn.classList.remove('spinning');
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    }, 500);
  }
});

})();
