    const $ = (id) => document.getElementById(id);

    function countOf(rows, key) {
      return (rows || []).find((row) => row.key === key)?.count || 0;
    }

    function escapeHtml(value) {
      return String(value || '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    function renderPairs(id, rows) {
      if (!rows || !rows.length) {
        $(id).innerHTML = '<p class="hint">暂无数据</p>';
        return;
      }
      $(id).innerHTML = `<table><tbody>${rows.map((row) => `<tr><td><code>${escapeHtml(row.key)}</code></td><td style="text-align:right;font-weight:800">${row.count}</td></tr>`).join('')}</tbody></table>`;
    }

    function formatDuration(ms) {
      const s = Math.round((ms || 0) / 1000);
      if (!s) return '—';
      if (s < 60) return s + ' 秒';
      return Math.floor(s / 60) + ' 分 ' + (s % 60) + ' 秒';
    }

    function renderStats(stats) {
      $('storage-warning').classList.toggle('hidden', stats.configured !== false);
      const total = Number(stats.pageviewsTotal || 0) || (stats.pages || []).reduce((sum, row) => sum + row.count, 0);
      const today = (stats.todayPages || []).reduce((sum, row) => sum + row.count, 0);
      $('m-visits').textContent = total.toLocaleString('zh-CN');
      $('m-today').textContent = today.toLocaleString('zh-CN');
      $('m-mobile').textContent = countOf(stats.devices, 'mobile').toLocaleString('zh-CN');
      $('m-duration').textContent = formatDuration(stats.avgDurationMs);
      renderPairs('pages', stats.pages || []);
      renderPairs('today-pages', stats.todayPages || []);
      renderPairs('devices', stats.devices || []);
      renderPairs('os', stats.os || []);
      renderPairs('browsers', stats.browsers || []);
      renderPairs('countries', stats.countries || []);
      renderPairs('sources', stats.sources || []);
    }

    // 趋势图 -------------------------------------------------------------
    let trendData = [];
    let trendMode = 'day';

    function groupWeekly(days) {
      const weeks = [];
      for (let i = days.length - 1; i >= 0; i -= 7) {
        const slice = days.slice(Math.max(0, i - 6), i + 1);
        const visits = slice.reduce((s, d) => s + d.visits, 0);
        weeks.unshift({ label: slice[0].day.slice(5), visits });
      }
      return weeks;
    }

    function renderTrend() {
      let rows;
      if (trendMode === 'week') {
        rows = groupWeekly(trendData).slice(-12);
      } else {
        rows = trendData.slice(-30).map((d) => ({ label: d.day.slice(5), visits: d.visits }));
      }
      const max = Math.max(1, ...rows.map((r) => r.visits));
      $('chart').innerHTML = rows.map((r) => `
        <div class="bar ${r.visits ? '' : 'empty'}" style="height:${r.visits ? Math.max(3, Math.round((r.visits / max) * 100)) : 2}%"
          title="${escapeHtml(r.label)} · PV ${r.visits}"></div>`).join('');
      $('chart-x').innerHTML = rows.length
        ? `<span>${escapeHtml(rows[0].label)}</span><span>${escapeHtml(rows[rows.length - 1].label)}</span>`
        : '';
    }

    $('trend-toggle').querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => {
      trendMode = btn.dataset.mode;
      $('trend-toggle').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
      renderTrend();
    }));

    async function loadStats() {
      const response = await fetch('/api/admin-stats?limit=500', { cache: 'no-store' });
      if (response.status === 401 || response.status === 503) {
        $('dashboard').classList.add('hidden');
        $('login').classList.remove('hidden');
        if (response.status === 503) {
          const result = await response.json().catch(() => ({}));
          if (result.error === 'admin_unconfigured') {
            $('login-error').textContent = '后台鉴权尚未安全配置，请先设置 ADMIN_PASSWORD_HASH 和 ADMIN_SESSION_SECRET。';
          }
        }
        return;
      }
      const data = await response.json();
      $('login').classList.add('hidden');
      $('dashboard').classList.remove('hidden');
      renderStats(data.stats || {});
      trendData = data.trend || [];
      renderTrend();
    }

    $('login-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      $('login-error').textContent = '';
      const response = await fetch('/api/admin-login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: $('password').value }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        $('login-error').textContent = result.error === 'admin_unconfigured'
          ? '后台鉴权尚未安全配置，请先设置 ADMIN_PASSWORD_HASH 和 ADMIN_SESSION_SECRET。'
          : '密码不对。';
        return;
      }
      $('password').value = '';
      await loadStats();
      loadKeys();
    });

    $('logout').addEventListener('click', async () => {
      await fetch('/api/admin-login', { method: 'DELETE' });
      $('dashboard').classList.add('hidden');
      $('login').classList.remove('hidden');
    });

    $('refresh').addEventListener('click', loadStats);
    loadStats();

    // ── API Key 管理 ──
    async function loadKeys() {
      const tbody = $('k-list');
      try {
        const res = await fetch('/api/admin-keys', { headers: { 'accept': 'application/json' } });
        if (!res.ok) { tbody.innerHTML = '<tr><td colspan="8"><p class="hint">未授权或存储未配置。</p></td></tr>'; return; }
        const data = await res.json();
        const keys = data.keys || [];
        if (!keys.length) { tbody.innerHTML = '<tr><td colspan="8"><p class="hint">还没有 key，用上方表单创建。</p></td></tr>'; return; }
        tbody.innerHTML = keys.map((k) => {
          const masked = escapeHtml(k.key.slice(0, 10)) + '…' + escapeHtml(k.key.slice(-4));
          const status = k.active
            ? '<span style="color:var(--tint-green-fg)">●启用</span>'
            : '<span style="color:var(--dim)">○停用</span>';
          const limit = k.dailyLimit > 0 ? k.dailyLimit.toLocaleString() : '无限';
          const btn = k.active
            ? `<button class="btn k-toggle" data-key="${escapeHtml(k.key)}" data-active="0" type="button">停用</button>`
            : `<button class="btn k-toggle" data-key="${escapeHtml(k.key)}" data-active="1" type="button">启用</button>`;
          return `<tr><td>${status}</td><td><code title="${escapeHtml(k.key)}" style="font-size:11px">${masked}</code></td><td>${escapeHtml(k.plan)}</td><td>${limit}</td><td>${k.usedToday}</td><td>${k.total}</td><td>${escapeHtml(k.label)}</td><td>${btn}</td></tr>`;
        }).join('');
        tbody.querySelectorAll('.k-toggle').forEach((b) => {
          b.addEventListener('click', async () => {
            b.disabled = true;
            await fetch('/api/admin-keys', {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ key: b.dataset.key, active: b.dataset.active === '1' }),
            });
            loadKeys();
          });
        });
      } catch (_) {
        tbody.innerHTML = '<tr><td colspan="8"><p class="hint">加载失败。</p></td></tr>';
      }
    }

    $('k-create').addEventListener('click', async () => {
      const btn = $('k-create');
      btn.disabled = true;
      try {
        const res = await fetch('/api/admin-keys', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            plan: $('k-plan').value.trim() || 'free',
            dailyLimit: Number($('k-limit').value) || 0,
            label: $('k-label').value.trim(),
          }),
        });
        const data = await res.json();
        if (data.ok && data.key) {
          $('k-new-val').textContent = data.key;
          $('k-new').classList.remove('hidden');
          $('k-label').value = '';
          loadKeys();
        }
      } finally {
        btn.disabled = false;
      }
    });

    // dashboard 可见时(已登录)加载 key 列表; 刷新按钮也一并刷新。
    function maybeLoadKeys() {
      if (!$('dashboard').classList.contains('hidden')) loadKeys();
    }
    $('refresh').addEventListener('click', maybeLoadKeys);
    // 初次进入若已是登录态, 稍后再查一次 (等 loadStats 决定显隐)。
    setTimeout(maybeLoadKeys, 800);
