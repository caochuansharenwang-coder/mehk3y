/* theme.js — mehk3y.com
 * Self-hosted theme controller (CSP-compliant, script-src 'self').
 * Loaded synchronously in <head> to avoid FOUC.
 *
 * Three states cycle: auto → light → dark → auto …
 * Persists choice in localStorage.theme.
 */
(function () {
  'use strict';
  var KEY = 'theme';
  var html = document.documentElement;
  var HOME_TITLE = 'Mehk3y — 个人工具集 · 加密链上 · 网络检测';

  function normalizeHomeTitle() {
    var path = window.location.pathname.replace(/\/+$/, '') || '/';
    if (path === '/') document.title = HOME_TITLE;
  }

  function read() {
    try { return localStorage.getItem(KEY) || 'auto'; } catch (_) { return 'auto'; }
  }
  function write(v) { try { localStorage.setItem(KEY, v); } catch (_) {} }

  function apply(v) {
    if (v === 'auto') html.removeAttribute('data-theme');
    else html.setAttribute('data-theme', v);
    // Re-mark explicitly when auto so CSS can show the auto icon
    if (v === 'auto') html.setAttribute('data-theme', 'auto');
  }

  // Initial paint
  apply(read());
  normalizeHomeTitle();

  // Cycle and bind on DOM ready
  function next(v) { return v === 'auto' ? 'light' : v === 'light' ? 'dark' : 'auto'; }

  function bind() {
    var btns = document.querySelectorAll('[data-theme-toggle]');
    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var n = next(read());
        write(n);
        apply(n);
        btn.setAttribute('aria-label', '主题：' + n);
      });
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else { bind(); }
})();
