(function () {
  'use strict';

  const els = {
    username: document.getElementById('usernameInput'),
    platform: document.getElementById('platformInput'),
    search: document.getElementById('searchButton'),
    openTop: document.getElementById('openTopButton'),
    copyAll: document.getElementById('copyAllButton'),
    exportCsv: document.getElementById('exportButton'),
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
    username: '',
    category: 'all'
  };

  const categoryKeywords = {
    code: ['github', 'gitlab', 'bitbucket', 'code', 'dev', 'npm', 'pypi', 'stackoverflow', 'stackexchange', 'docker', 'replit', 'codeberg', 'sourceforge'],
    social: ['twitter', 'x.com', 'facebook', 'instagram', 'linkedin', 'tiktok', 'snapchat', 'threads', 'mastodon', 'bsky', 'bluesky', 'vk.com'],
    forum: ['reddit', 'forum', 'discuss', 'community', 'hackernews', 'news.ycombinator', 'linux.org', 'lobste.rs', 'medium.com/@'],
    media: ['youtube', 'twitch', 'soundcloud', 'spotify', 'vimeo', 'behance', 'dribbble', 'pinterest', 'deviantart', 'artstation', 'flickr']
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

  function classify(site) {
    const haystack = `${site.name} ${site.template} ${site.host}`.toLowerCase();
    for (const [category, keywords] of Object.entries(categoryKeywords)) {
      if (keywords.some(keyword => haystack.includes(keyword))) return category;
    }
    return 'other';
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
      site.category = classify(site);
      site.search = `${site.name} ${site.host} ${site.template} ${site.category}`.toLowerCase();
      return site;
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  function filteredSites() {
    const keyword = els.platform.value.trim().toLowerCase();
    return state.sites.filter(site => {
      if (state.category !== 'all' && site.category !== state.category) return false;
      if (keyword && !site.search.includes(keyword)) return false;
      return true;
    });
  }

  function render() {
    const username = normalizeUsername(els.username.value);
    state.username = username;
    state.filtered = filteredSites();

    els.resultCount.textContent = state.filtered.length.toLocaleString();
    els.usernameMetric.textContent = username || '--';

    document.querySelectorAll('[data-category]').forEach(button => {
      button.classList.toggle('active', button.dataset.category === state.category);
    });

    if (!username) {
      els.resultTitle.textContent = '等待输入用户名';
      els.resultList.innerHTML = '<div class="empty">输入用户名后开始生成结果。</div>';
      return;
    }

    if (state.filtered.length === 0) {
      els.resultTitle.textContent = `没有匹配平台：${username}`;
      els.resultList.innerHTML = '<div class="empty">当前平台筛选没有结果，换一个关键词或切回“全部”。</div>';
      return;
    }

    els.resultTitle.textContent = `${username} 的候选链接`;
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
      category: site.category,
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

  function copyCurrentLinks() {
    const rows = resultUrls();
    if (!rows.length) return;
    copyText(rows.map(row => row.url).join('\n'), els.copyAll);
  }

  function exportCurrentCsv() {
    const rows = resultUrls();
    if (!rows.length) return;
    const header = ['site', 'host', 'category', 'url'];
    const csv = [header, ...rows.map(row => header.map(key => row[key]))]
      .map(row => row.map(csvCell).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `aliens-eye-${state.username || 'results'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function csvCell(value) {
    const text = String(value || '');
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function openTopResults() {
    const rows = resultUrls().slice(0, 20);
    rows.forEach((row, index) => {
      setTimeout(() => window.open(row.url, '_blank', 'noopener,noreferrer'), index * 80);
    });
  }

  function updateShareUrl(username) {
    const url = new URL(window.location.href);
    url.searchParams.set('u', username);
    const platform = els.platform.value.trim();
    if (platform) url.searchParams.set('q', platform);
    else url.searchParams.delete('q');
    if (state.category !== 'all') url.searchParams.set('cat', state.category);
    else url.searchParams.delete('cat');
    history.replaceState(null, '', url);
  }

  function readInitialParams() {
    const params = new URLSearchParams(window.location.search);
    els.username.value = params.get('u') || '';
    els.platform.value = params.get('q') || '';
    state.category = params.get('cat') || 'all';
  }

  function wireEvents() {
    let timer = null;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(render, 80);
    };

    els.username.addEventListener('input', schedule);
    els.platform.addEventListener('input', schedule);
    els.search.addEventListener('click', render);
    els.copyAll.addEventListener('click', copyCurrentLinks);
    els.exportCsv.addEventListener('click', exportCurrentCsv);
    els.openTop.addEventListener('click', openTopResults);

    document.addEventListener('click', event => {
      const category = event.target.closest('[data-category]');
      if (!category) return;
      state.category = category.dataset.category;
      render();
    });
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
