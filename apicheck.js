/* apicheck.js — API 中转站纯度检测前端。
   表单 → POST /api/llm-probe → 渲染判定 / 信号 / 元数据 / 原始响应。
   表单内容 (除 key 外) 暂存 localStorage，方便重复检测。 */
(function () {
  'use strict';

  var form = document.getElementById('probe-form');
  var resultEl = document.getElementById('result');
  var goBtn = document.getElementById('go');
  var presetsEl = document.getElementById('presets');
  var $ = function (id) { return document.getElementById(id); };

  // 常用模型快捷填入。
  var PRESETS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o3', 'claude-3-5-sonnet-20241022', 'claude-sonnet-4-5', 'deepseek-chat', 'gemini-2.0-flash'];
  PRESETS.forEach(function (m) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'preset'; b.textContent = m;
    b.addEventListener('click', function () {
      $('model').value = m;
      // claude 系默认仍走 openai 兼容（多数中转如此），用户可自行切换。
    });
    presetsEl.appendChild(b);
  });

  // —— 记忆上次输入（不存 key）——
  var STORE = 'apicheck.form';
  try {
    var saved = JSON.parse(localStorage.getItem(STORE) || '{}');
    if (saved.baseUrl) $('baseUrl').value = saved.baseUrl;
    if (saved.model) $('model').value = saved.model;
    if (saved.format) $('format').value = saved.format;
  } catch (_) {}

  function persist() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        baseUrl: $('baseUrl').value.trim(),
        model: $('model').value.trim(),
        format: $('format').value,
      }));
    } catch (_) {}
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    run();
  });

  function run() {
    var baseUrl = $('baseUrl').value.trim();
    var apiKey = $('apiKey').value.trim();
    var model = $('model').value.trim();
    var format = $('format').value;
    if (!baseUrl || !apiKey || !model) return;
    persist();

    goBtn.disabled = true;
    goBtn.innerHTML = '<span class="spinner"></span>检测中…';
    resultEl.innerHTML = '<div class="sig info"><span class="dot"></span>正在发起多项探测（连通性 / 身份 / 一致性 / 流式），约需 5–20 秒…</div>';

    fetch('/api/llm-probe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseUrl: baseUrl, apiKey: apiKey, model: model, format: format }),
    })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (out) {
        if (!out.body || out.body.ok === false && !out.body.probes) {
          renderError(out.body && out.body.error ? out.body.error : ('请求失败 (HTTP ' + out.status + ')'));
          return;
        }
        render(out.body);
      })
      .catch(function (err) {
        renderError('网络错误：' + (err && err.message ? err.message : err));
      })
      .finally(function () {
        goBtn.disabled = false;
        goBtn.textContent = '重新检测';
      });
  }

  function renderError(msg) {
    resultEl.innerHTML = '<div class="err-box">' + esc(msg) + '</div>';
  }

  var VERDICT = {
    clean:       { cls: 'v-clean',   title: '看起来真实', color: 'var(--green)', desc: '各项指纹与请求模型相符，未发现明显的偷换 / 降级迹象。' },
    caution:     { cls: 'v-caution', title: '基本可用 · 有存疑点', color: '#d97706', desc: '能正常调用，但部分指纹不完整或存在小差异，建议留意下方信号。' },
    suspect:     { cls: 'v-suspect', title: '高度可疑', color: 'var(--red)', desc: '出现模型字段被偷换 / 厂商不符等强信号，疑似挂羊头卖狗肉或降级。' },
    unreachable: { cls: 'v-suspect', title: '无法检测', color: 'var(--red)', desc: '基础对话请求就失败了，可能是地址 / Key / 模型名有误，或渠道不可用。' },
  };

  function gauge(score, color) {
    var r = 28, c = 2 * Math.PI * r, off = c * (1 - score / 100);
    return '<div class="gauge"><svg width="64" height="64" viewBox="0 0 64 64">' +
      '<circle cx="32" cy="32" r="' + r + '" fill="none" stroke="var(--border)" stroke-width="6"/>' +
      '<circle cx="32" cy="32" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="6" stroke-linecap="round" ' +
      'stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '"/>' +
      '</svg><div class="num" style="color:' + color + '">' + score + '</div></div>';
  }

  function meta(k, v, mono) {
    if (v == null || v === '') return '';
    return '<div class="meta"><div class="k">' + esc(k) + '</div><div class="v' + (mono ? ' mono' : '') + '">' + esc(v) + '</div></div>';
  }

  function fmtMs(ms) { return ms == null ? '—' : (ms >= 1000 ? (ms / 1000).toFixed(2) + 's' : ms + 'ms'); }

  function render(d) {
    var a = d.analysis || {};
    var v = VERDICT[a.verdict] || VERDICT.caution;
    var html = '';

    // —— 判定卡 ——
    html += '<div class="verdict">' +
      gauge(a.score || 0, v.color) +
      '<div class="verdict-text">' +
        '<div class="verdict-title ' + v.cls + '">' + esc(v.title) + '</div>' +
        '<div class="verdict-desc">' + esc(v.desc) + '</div>' +
      '</div></div>';

    // —— 元数据 ——
    var chat = d.probes && d.probes.chat || {};
    var stream = d.probes && d.probes.stream || {};
    var models = d.probes && d.probes.models || {};
    var mg = '';
    mg += meta('请求模型', d.model);
    mg += meta('返回 model', chat.returnedModel || '（未返回）', true);
    mg += meta('首字延迟', fmtMs(chat.ms));
    if (a.claimedVendor) mg += meta('自报厂商', a.claimedVendor);
    if (a.expectedVendor) mg += meta('预期厂商', a.expectedVendor);
    if (chat.usage) {
      var u = chat.usage;
      var tot = u.total_tokens != null ? u.total_tokens : ((u.input_tokens || 0) + (u.output_tokens || 0));
      mg += meta('Token 用量', tot ? tot + ' tok' : '有');
    }
    mg += meta('流式', stream.ok ? '✓ 支持' : '✗ 不可用');
    if (models && models.total != null) mg += meta('/models 数量', models.total + (models.listed ? ' · 含目标' : ' · 未列出'));
    if (chat.systemFingerprint) mg += meta('fingerprint', chat.systemFingerprint, true);
    if (chat.id) mg += meta('响应 id', chat.id, true);
    if (mg) html += '<div class="meta-grid">' + mg + '</div>';

    // —— 信号列表 ——
    if (a.signals && a.signals.length) {
      html += '<div class="sig-list">';
      a.signals.forEach(function (s) {
        var cls = ({ good: 'good', bad: 'bad', warn: 'warn', info: 'info' })[s.level] || 'neutral';
        html += '<div class="sig ' + cls + '"><span class="dot"></span><span>' + esc(s.text) + '</span></div>';
      });
      html += '</div>';
    }

    // —— 模型自报正文（身份探针原文）——
    if (chat.content) {
      html += '<details class="raw"><summary>身份探针返回的原文</summary><pre>' + esc(chat.content) + '</pre></details>';
    }

    // —— 完整原始 JSON ——
    html += '<details class="raw"><summary>完整探测结果 (JSON)</summary><pre>' + esc(JSON.stringify(d, null, 2)) + '</pre></details>';

    resultEl.innerHTML = html;
  }
})();
