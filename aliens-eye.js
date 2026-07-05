(function () {
  'use strict';

  const els = {
    username: document.getElementById('usernameInput'),
    search: document.getElementById('searchButton'),
    siteCount: document.getElementById('siteCount'),
    resultCount: document.getElementById('resultCountMetric'),
    usernameMetric: document.getElementById('usernameMetric'),
    resultTitle: document.getElementById('resultTitle'),
    resultList: document.getElementById('resultList'),
    status: document.getElementById('statusBox')
  };

  const state = {
    sites: [],
    filtered: [],
    username: ''
  };

  function normalizeUsername(value) {
    return String(value || '').trim().replace(/^@+/, '');
  }

  function hostFromTemplate(template) {
    try {
      return new URL(template.replace('{}', 'example')).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  function buildUrl(template, username) {
    const encoded = encodeURIComponent(username);
    return template.includes('{}') ? template.replaceAll('{}', encoded) : template + encoded;
  }

  function prepareSites(raw) {
    return Object.entries(raw).map(([name, template]) => {
      const site = {
        name,
        template,
        host: hostFromTemplate(template)
      };
      return site;
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  function render() {
    const username = normalizeUsername(els.username.value);
    state.username = username;
    state.filtered = state.sites;

    els.resultCount.textContent = state.filtered.length.toLocaleString();
    els.usernameMetric.textContent = username || '--';

    if (!username) {
      els.resultTitle.textContent = '等待输入用户名';
      els.resultList.innerHTML = '<div class="empty">输入用户名后开始生成结果。</div>';
      return;
    }

    els.resultTitle.textContent = `${username} 的全平台候选链接`;
    els.resultList.replaceChildren(...state.filtered.map(site => renderCard(site, username)));
    updateShareUrl(username);
  }

  function renderCard(site, username) {
    const url = buildUrl(site.template, username);
    const card = document.createElement('article');
    card.className = 'result-card';

    const mark = document.createElement('div');
    mark.className = 'site-mark';
    mark.textContent = site.name.slice(0, 2);

    const body = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'site-name';
    title.textContent = site.name;
    const link = document.createElement('div');
    link.className = 'site-url';
    link.textContent = url;
    body.append(title, link);

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    const open = document.createElement('a');
    open.className = 'icon-btn';
    open.href = url;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    open.textContent = '打开';

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'icon-btn';
    copy.textContent = '复制';
    copy.addEventListener('click', () => copyText(url, copy));

    actions.append(open, copy);
    card.append(mark, body, actions);
    return card;
  }

  function resultUrls() {
    if (!state.username) return [];
    return state.filtered.map(site => ({
      site: site.name,
      host: site.host,
      url: buildUrl(site.template, state.username)
    }));
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

  function wireEvents() {
    let timer = null;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(render, 80);
    };

    els.username.addEventListener('input', schedule);
    els.search.addEventListener('click', render);
  }

  async function boot() {
    wireEvents();
    readInitialParams();
    try {
      const response = await fetch('/data/aliens-eye/sites.json', { cache: 'force-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.sites = prepareSites(await response.json());
      els.siteCount.textContent = state.sites.length.toLocaleString();
      els.status.innerHTML = `<strong>数据：</strong>已加载 ${state.sites.length.toLocaleString()} 个平台模板。`;
      render();
    } catch (error) {
      els.siteCount.textContent = '--';
      els.resultTitle.textContent = '站点模板加载失败';
      els.resultList.innerHTML = '<div class="empty">无法加载 /data/aliens-eye/sites.json，请刷新页面。</div>';
      els.status.innerHTML = `<strong>错误：</strong>${String(error.message || error)}`;
    }
  }

  boot();
}());
