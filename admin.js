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
      const newCount = countOf(stats.visitorType, 'new');
      const returningCount = countOf(stats.visitorType, 'returning');
      const sessions = newCount + returningCount;
      $('m-visits').textContent = total.toLocaleString('zh-CN');
      $('m-visitors').textContent = Number(stats.uniqueVisitors || 0).toLocaleString('zh-CN');
      $('m-ips').textContent = Number(stats.uniqueIps || 0).toLocaleString('zh-CN');
      $('m-today-ips').textContent = Number(stats.todayUniqueIps || 0).toLocaleString('zh-CN');
      $('m-mobile').textContent = countOf(stats.devices, 'mobile').toLocaleString('zh-CN');
      $('m-new').textContent = sessions ? Math.round((newCount / sessions) * 100) + '%' : '—';
      $('m-duration').textContent = formatDuration(stats.avgDurationMs);
      $('m-ppsession').textContent = stats.avgPagesPerSession ? Number(stats.avgPagesPerSession).toFixed(1) : '—';
      renderPairs('pages', stats.pages || []);
      renderPairs('today-pages', stats.todayPages || []);
      renderPairs('os', stats.os || []);
      renderPairs('browsers', stats.browsers || []);
      renderPairs('countries', stats.countries || []);
      renderPairs('isp', stats.isp || []);
      renderPairs('network-kind', stats.networkKind || []);
      renderPairs('sources', stats.sources || []);
      const deviceLabel = (event) => {
        if (event.deviceType === 'tablet') return '平板';
        if (event.deviceType === 'mobile' || event.isMobile) return '手机';
        return '桌面';
      };
      const hardware = (event) => [
        event.screen ? '屏 ' + event.screen : '',
        event.pixelRatio && event.pixelRatio !== 1 ? '@' + event.pixelRatio + 'x' : '',
        event.cpuCores ? event.cpuCores + '核' : '',
        event.deviceMemory ? event.deviceMemory + 'GB' : '',
        event.colorScheme ? (event.colorScheme === 'dark' ? '深色' : '浅色') : '',
        event.touch ? '触屏' : '',
        event.netType ? event.netType.toUpperCase() : '',
        event.netRtt ? event.netRtt + 'ms' : '',
        event.timezone || '',
        event.languages || event.language || '',
      ].filter(Boolean).join(' · ');
      $('events').innerHTML = (stats.events || []).map((event) => `
        <tr>
          <td>${escapeHtml(new Date(event.ts).toLocaleString('zh-CN'))}</td>
          <td><code>${escapeHtml(event.page)}${event.query ? escapeHtml(event.query) : ''}</code>${event.title ? `<div class="hint" style="margin-top:4px">${escapeHtml(event.title)}</div>` : ''}${event.utmSource ? ` <span class="badge">${escapeHtml(event.utmSource)}</span>` : ''}</td>
          <td><code>${escapeHtml(event.ip)}</code></td>
          <td>${escapeHtml(event.isp || '-')}${event.asn ? ` <span class="badge">${escapeHtml(event.asn)}</span>` : ''}${event.isHosting ? ' <span class="badge">机房/VPN</span>' : ''}</td>
          <td><span class="badge">${deviceLabel(event)}</span>${event.isReturning ? ' <span class="badge">回访</span>' : ''}${event.dnt ? ' <span class="badge">DNT</span>' : ''}${event.isBot ? ' <span class="badge">爬虫</span>' : ''}<div class="hint" style="margin-top:4px">${escapeHtml(hardware(event))}</div></td>
          <td>${escapeHtml([event.os, event.browser].filter(Boolean).join(' / ') || '-')}</td>
          <td>${escapeHtml([event.country, event.region, event.city].filter(Boolean).join(' / ') || '-')}</td>
          <td><code>${escapeHtml(event.referrer || '-')}</code></td>
          <td><code>${escapeHtml(event.userAgent)}</code></td>
        </tr>
      `).join('') || '<tr><td colspan="9">暂无访问记录</td></tr>';
      renderTopIps(stats.topIps || []);
    }

    function renderTopIps(rows) {
      if (!rows.length) { $('top-ips').innerHTML = '<p class="hint">暂无数据</p>'; return; }
      $('top-ips').innerHTML = `<table class="iplist"><tbody>${rows.map((row) => `
        <tr data-ip="${escapeHtml(row.key)}"><td><code>${escapeHtml(row.key)}</code></td><td style="text-align:right;font-weight:800">${row.count}</td></tr>`).join('')}</tbody></table>`;
      $('top-ips').querySelectorAll('tr').forEach((tr) => tr.addEventListener('click', () => loadIpTrail(tr.dataset.ip)));
    }

    async function loadIpTrail(ip) {
      $('trail-ip').textContent = ip;
      $('trail').innerHTML = '<p class="hint">加载中…</p>';
      const response = await fetch('/api/admin-stats?ip=' + encodeURIComponent(ip), { cache: 'no-store' });
      const data = await response.json();
      const trail = (data.trail || []).slice().sort((a, b) => new Date(a.ts) - new Date(b.ts));
      if (!trail.length) { $('trail').innerHTML = '<p class="hint">没有这个 IP 的明细记录。</p>'; return; }
      $('trail').innerHTML = trail.map((ev, i) => {
        let stay = '—';
        if (i < trail.length - 1) {
          const gap = new Date(trail[i + 1].ts) - new Date(ev.ts);
          if (gap > 0 && gap < 30 * 60000) stay = formatDuration(gap) + ' (约)';
        }
        return `<div class="trail-step">
          <span class="t">${escapeHtml(new Date(ev.ts).toLocaleString('zh-CN'))}</span>
          <span><code>${escapeHtml(ev.page)}${ev.query ? escapeHtml(ev.query) : ''}</code>
          <span class="hint">停留 ${stay} · ${escapeHtml([ev.os, ev.browser].filter(Boolean).join(' / '))}${ev.isBot ? ' · 爬虫' : ''}</span></span>
        </div>`;
      }).join('');
    }

    // 趋势图 -------------------------------------------------------------
    let trendData = [];
    let trendMode = 'day';

    function groupWeekly(days) {
      const weeks = [];
      for (let i = days.length - 1; i >= 0; i -= 7) {
        const slice = days.slice(Math.max(0, i - 6), i + 1);
        const visits = slice.reduce((s, d) => s + d.visits, 0);
        const uniqueIps = slice.reduce((s, d) => s + d.uniqueIps, 0);
        weeks.unshift({ label: slice[0].day.slice(5), visits, uniqueIps });
      }
      return weeks;
    }

    function renderTrend() {
      let rows;
      if (trendMode === 'week') {
        rows = groupWeekly(trendData).slice(-12);
      } else {
        rows = trendData.slice(-30).map((d) => ({ label: d.day.slice(5), visits: d.visits, uniqueIps: d.uniqueIps }));
      }
      const max = Math.max(1, ...rows.map((r) => r.visits));
      $('chart').innerHTML = rows.map((r) => `
        <div class="bar ${r.visits ? '' : 'empty'}" style="height:${r.visits ? Math.max(3, Math.round((r.visits / max) * 100)) : 2}%"
          title="${escapeHtml(r.label)} · 访问 ${r.visits} · 独立IP ${r.uniqueIps}"></div>`).join('');
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
      if (response.status === 401) {
        $('dashboard').classList.add('hidden');
        $('login').classList.remove('hidden');
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
      if (!response.ok) {
        $('login-error').textContent = '密码不对。';
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
