/* Shared helpers used by btc / eth / ip / esim / apple scripts.
 * Loaded with `defer` BEFORE each page-specific script — exposes globals
 * `mehk3yCache`, `mehk3yFetch`, `mehk3yPriceGate`, `mehk3yShowError`,
 * `mehk3yStartPolling`. Keep this file dependency-free. */

'use strict';

(function (g) {
  // localStorage wrapper. Each consumer namespaces its keys by passing a
  // unique `ns` (e.g. 'btc_v2', 'eth_v1') — keeps cache invalidation simple
  // when a page's shape changes.
  const makeCache = (ns) => {
    const prefix = ns + '_';
    return {
      set(k, v) {
        try { localStorage.setItem(prefix + k, JSON.stringify({ t: Date.now(), v })); } catch {}
      },
      get(k, maxAge) {
        try {
          const raw = localStorage.getItem(prefix + k);
          if (!raw) return null;
          const d = JSON.parse(raw);
          if (d && typeof d.t === 'number' && (Date.now() - d.t) < maxAge) return d.v;
        } catch {}
        return null;
      },
    };
  };

  // fetch with timeout + one retry on network failure. Throws on non-2xx so
  // callers can fall back to alternate sources.
  const ft = (url, ms = 8000, opts) => {
    const attempt = () => {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), ms);
      return fetch(url, Object.assign({ signal: c.signal }, opts || {}))
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r; })
        .finally(() => clearTimeout(t));
    };
    return attempt().catch(() =>
      new Promise(r => setTimeout(r, 1500)).then(attempt)
    );
  };

  // Lazy price gate — promise-based replacement for setInterval polling.
  // Callers do `await priceReady.wait()` to block until `priceReady.resolve(p)`
  // is called once (e.g. when fetchPrice() completes).
  const makePriceGate = () => {
    let current = 0;
    const waiters = [];
    return {
      get value() { return current; },
      resolve(p) {
        if (p > 0) {
          current = p;
          waiters.splice(0).forEach(fn => fn());
        }
      },
      // Returns a promise that resolves when price > 0, or rejects after maxMs.
      wait(maxMs) {
        if (current > 0) return Promise.resolve();
        return new Promise(resolve => {
          let done = false;
          const fire = () => { if (!done) { done = true; resolve(); } };
          waiters.push(fire);
          if (maxMs) setTimeout(fire, maxMs);
        });
      },
    };
  };

  const showError = (msg) => {
    const el = document.getElementById('error-toast');
    if (!el) return;
    if (msg) el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 5000); // toast fades after 5s
  };

  // Page-Visibility aware interval scheduler. Pass an array of
  // `{ fn, ms }` and it'll run them on tick, pausing while the tab is
  // hidden and immediately re-firing `fn` on visibilitychange resume.
  const startPolling = (jobs, onResume) => {
    let handles = [];
    const start = () => {
      if (handles.length) return;
      handles = jobs.map(j => setInterval(j.fn, j.ms));
    };
    const stop = () => {
      handles.forEach(clearInterval);
      handles = [];
    };
    start();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop();
      else { if (typeof onResume === 'function') onResume(); start(); }
    });
    return { start, stop };
  };

  g.mehk3yCache        = makeCache;
  g.mehk3yFetch        = ft;
  g.mehk3yPriceGate    = makePriceGate;
  g.mehk3yShowError    = showError;
  g.mehk3yStartPolling = startPolling;
})(typeof window !== 'undefined' ? window : globalThis);
