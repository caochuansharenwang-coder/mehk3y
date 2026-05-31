// /api-docs.js — “在线试用” 交互。CSP 友好 (script-src 'self', 无内联)。
(function () {
  var keyEl = document.getElementById('try-key');
  var ipEl  = document.getElementById('try-ip');
  var btn   = document.getElementById('try-btn');
  var out   = document.getElementById('try-out');
  if (!btn || !out) return;

  function show(text, cls) {
    out.textContent = '';
    var span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = text;
    out.appendChild(span);
  }

  async function run() {
    var key = (keyEl.value || '').trim();
    var ip  = (ipEl.value || '').trim();
    if (!key) { show('// 请先填入 x-api-key', 'c'); keyEl.focus(); return; }

    btn.disabled = true;
    show('// 请求中…', 'c');

    var url = '/api/v1/check' + (ip ? ('?ip=' + encodeURIComponent(ip)) : '');
    try {
      var res = await fetch(url, { headers: { 'x-api-key': key } });
      var data = await res.json();
      out.textContent = 'HTTP ' + res.status + '\n\n' + JSON.stringify(data, null, 2);
    } catch (e) {
      show('// 请求失败: ' + (e && e.message ? e.message : e), 'c');
    } finally {
      btn.disabled = false;
    }
  }

  btn.addEventListener('click', run);
  [keyEl, ipEl].forEach(function (el) {
    el.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') run(); });
  });
})();
