(function () {
  'use strict';

  const els = {
    form: document.getElementById('searchForm'),
    username: document.getElementById('usernameInput'),
    search: document.getElementById('searchButton'),
    siteCount: document.getElementById('siteCount'),
    checkedCount: document.getElementById('resultCountMetric'),
    foundCount: document.getElementById('foundCountMetric'),
    usernameMetric: document.getElementById('usernameMetric'),
    resultTitle: document.getElementById('resultTitle'),
    resultList: document.getElementById('resultList'),
    status: document.getElementById('statusBox')
  };

  const state = {
    total: 840,
    checked: 0,
    found: [],
    username: '',
    running: false
  };

  function normalizeUsername(value) {
    return String(value || '').trim().replace(/^@+/, '');
  }

  function updateShareUrl(username) {
    const url = new URL(window.location.href);
    url.searchParams.set('u', username);
    url.searchParams.delete('q');
    url.searchParams.delete('cat');
    history.replaceState(null, '', url);
  }

  function readInitialParams() {
    const params = new URLSearchParams(window.location.search);
    els.username.value = params.get('u') || '';
  }

  function setIdle(username) {
    state.username = username;
    state.checked = 0;
    state.found = [];
    state.running = false;
    els.checkedCount.textContent = '0';
    els.foundCount.textContent = '0';
    els.usernameMetric.textContent = username || '--';
    els.resultTitle.textContent = username ? `${username} 的扫描结果` : '等待输入用户名';
    els.resultList.innerHTML = username
      ? '<div class="empty">点击“开始扫描”，只显示检测到存在的账号。</div>'
      : '<div class="empty">输入用户名后开始扫描。</div>';
  }

  function renderResults(options = {}) {
    els.checkedCount.textContent = state.checked.toLocaleString();
    els.foundCount.textContent = state.found.length.toLocaleString();
    els.usernameMetric.textContent = state.username || '--';

    if (!state.username) {
      setIdle('');
      els.username.focus();
      return;
    }

    els.resultTitle.textContent = `${state.username} 的扫描结果`;
    if (!state.found.length) {
      els.resultList.innerHTML = state.running
        ? '<div class="empty">扫描中，目前还没有命中。</div>'
        : '<div class="empty">扫描完成，没有检测到存在的公开账号。</div>';
    } else {
      els.resultList.replaceChildren(...state.found.map(renderCard));
    }

    updateShareUrl(state.username);
    if (options.scroll) {
      requestAnimationFrame(() => {
        els.resultTitle.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  function renderCard(result) {
    const targetUrl = result.finalUrl || result.url;
    const card = document.createElement('article');
    card.className = 'result-card';

    const mark = document.createElement('div');
    mark.className = 'site-mark';
    mark.textContent = result.site.slice(0, 2);

    const body = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'site-name';
    title.textContent = result.site;

    const link = document.createElement('div');
    link.className = 'site-url';
    link.textContent = `${targetUrl} · ${result.status || 'ok'} · ${result.confidence}%`;
    body.append(title, link);

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    const open = document.createElement('a');
    open.className = 'icon-btn';
    open.href = targetUrl;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    open.textContent = '打开';

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'icon-btn';
    copy.textContent = '复制';
    copy.addEventListener('click', () => copyText(targetUrl, copy));

    actions.append(open, copy);
    card.append(mark, body, actions);
    return card;
  }

  function copyText(text, button) {
    navigator.clipboard.writeText(text).then(() => {
      const old = button.textContent;
      button.textContent = '已复制';
      button.classList.add('active');
      setTimeout(() => {
        button.textContent = old;
        button.classList.remove('active');
      }, 1100);
    }).catch(() => {
      button.textContent = '失败';
    });
  }

  async function scanBatch(username, offset) {
    const response = await fetch('/api/aliens-eye-scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, offset, limit: 60 })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || `HTTP ${response.status}`);
    }
    return data;
  }

  function mergeFound(current, incoming) {
    const byKey = new Map(current.map(item => [item.site + item.url, item]));
    incoming.forEach(item => byKey.set(item.site + item.url, item));
    return [...byKey.values()].sort((a, b) => b.confidence - a.confidence || a.site.localeCompare(b.site));
  }

  async function startScan() {
    const username = normalizeUsername(els.username.value);
    if (!username) {
      setIdle('');
      els.username.focus();
      return;
    }

    state.username = username;
    state.checked = 0;
    state.found = [];
    state.running = true;
    els.search.disabled = true;
    els.search.textContent = '扫描中...';
    els.status.innerHTML = `<strong>扫描：</strong>正在检查 ${state.total.toLocaleString()} 个平台。`;
    renderResults({ scroll: true });

    let offset = 0;
    try {
      while (true) {
        const data = await scanBatch(username, offset);
        if (state.username !== username) return;

        state.total = data.total;
        state.checked = Math.min(data.nextOffset, data.total);
        state.found = mergeFound(state.found, data.found || []);

        els.siteCount.textContent = data.total.toLocaleString();
        els.status.innerHTML = `<strong>扫描：</strong>已检查 ${state.checked.toLocaleString()} / ${data.total.toLocaleString()}，命中 ${state.found.length.toLocaleString()} 个。`;
        renderResults();

        if (data.done) break;
        offset = data.nextOffset;
      }

      state.running = false;
      els.status.innerHTML = `<strong>完成：</strong>已检查 ${state.checked.toLocaleString()} 个平台，显示 ${state.found.length.toLocaleString()} 个命中结果。`;
      renderResults();
    } catch (error) {
      state.running = false;
      els.status.innerHTML = `<strong>错误：</strong>${String(error.message || error)}`;
      renderResults();
    } finally {
      els.search.disabled = false;
      els.search.textContent = '开始扫描';
    }
  }

  function wireEvents() {
    els.form.addEventListener('submit', event => {
      event.preventDefault();
      startScan();
    });
  }

  async function boot() {
    wireEvents();
    readInitialParams();
    try {
      const response = await fetch('/data/aliens-eye/sites.json', { cache: 'force-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const siteMap = await response.json();
      state.total = Object.keys(siteMap).length;
      els.siteCount.textContent = state.total.toLocaleString();
      els.foundCount.textContent = '0';
      els.status.innerHTML = `<strong>数据：</strong>已加载 ${state.total.toLocaleString()} 个平台模板。`;
      setIdle(normalizeUsername(els.username.value));
    } catch (error) {
      els.siteCount.textContent = '--';
      els.foundCount.textContent = '--';
      els.resultTitle.textContent = '站点模板加载失败';
      els.resultList.innerHTML = '<div class="empty">无法加载 /data/aliens-eye/sites.json，请刷新页面。</div>';
      els.status.innerHTML = `<strong>错误：</strong>${String(error.message || error)}`;
    }
  }

  boot();
}());
