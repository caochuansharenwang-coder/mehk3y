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
      $(id).innerHTML = `<table>
        <thead class="sr-only"><tr><th scope="col">项目</th><th scope="col">数量</th></tr></thead>
        <tbody>${rows.map((row) => `<tr><td><code>${escapeHtml(row.key)}</code></td><td style="text-align:right;font-weight:800">${row.count}</td></tr>`).join('')}</tbody>
      </table>`;
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
      $('chart-summary').textContent = rows.length
        ? `${trendMode === 'week' ? '最近 12 周' : '最近 30 天'}页面浏览量：${rows.map((row) => `${row.label} ${row.visits} 次`).join('；')}`
        : '暂无访问趋势数据。';
    }

    $('trend-toggle').querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => {
      trendMode = btn.dataset.mode;
      $('trend-toggle').querySelectorAll('button').forEach((b) => {
        const active = b === btn;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', String(active));
      });
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
        requestAnimationFrame(() => $('password').focus());
        return;
      }
      const data = await response.json();
      const dashboardWasHidden = $('dashboard').classList.contains('hidden');
      $('login').classList.add('hidden');
      $('dashboard').classList.remove('hidden');
      renderStats(data.stats || {});
      trendData = data.trend || [];
      renderTrend();
      if (dashboardWasHidden) requestAnimationFrame(() => $('dashboard-title').focus());
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
        $('password').focus();
        $('password').select();
        return;
      }
      $('password').value = '';
      await loadStats();
    });

    $('logout').addEventListener('click', async () => {
      await fetch('/api/admin-login', { method: 'DELETE' });
      $('dashboard').classList.add('hidden');
      $('login').classList.remove('hidden');
      $('login-error').textContent = '';
      requestAnimationFrame(() => $('password').focus());
    });

    $('refresh').addEventListener('click', loadStats);
    loadStats();
