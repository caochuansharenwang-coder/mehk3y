/* dingtou.js — 定投复利计算器
 * Pure client-side projection. No inline handlers (CSP script-src 'self').
 *
 * Convention (matches common DCA calculators): monthly compounding at
 * annual/12, contributions made at the START of each month (annuity-due).
 *   value_{m} = (value_{m-1} + monthly) * (1 + annual/12)
 */
'use strict';

(function () {
  var $ = function (id) { return document.getElementById(id); };

  var initialEl = $('initial');
  var monthlyEl = $('monthly');
  var rateEl    = $('rate');
  var yearsEl   = $('years');
  var monthlyRange = $('monthly-range');
  var rateRange    = $('rate-range');
  var yearsRange   = $('years-range');

  var multEl     = $('mult');
  var fvEl       = $('fv');
  var fvWanEl    = $('fv-wan');
  var investedEl = $('invested');
  var gainsEl    = $('gains');
  var canvas     = $('chart');
  var ctx        = canvas.getContext('2d');

  // —— helpers ——
  function clampNum(el, dflt) {
    var v = parseFloat(el.value);
    if (!isFinite(v)) return dflt;
    var min = el.min !== '' ? parseFloat(el.min) : -Infinity;
    var max = el.max !== '' ? parseFloat(el.max) : Infinity;
    return Math.min(Math.max(v, min), max);
  }
  function money(n) { return '¥' + Math.round(n).toLocaleString('en-US'); }
  function wan(n) {
    n = Math.round(n);
    if (n >= 1e8) return '约 ' + (n / 1e8).toFixed(2) + ' 亿';
    if (n >= 1e4) return '约 ' + (n / 1e4).toFixed(1) + ' 万';
    return '';
  }
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // —— core projection (month-by-month, builds yearly series) ——
  function project(initial, monthly, annualPct, years) {
    var n = Math.round(years * 12);
    var rm = (annualPct / 100) / 12;
    var value = initial;
    var series = [{ y: 0, value: initial, invested: initial }];
    for (var m = 1; m <= n; m++) {
      value = (value + monthly) * (1 + rm);
      if (m % 12 === 0 || m === n) {
        series.push({ y: m / 12, value: value, invested: initial + monthly * m });
      }
    }
    var invested = initial + monthly * n;
    return { value: value, invested: invested, gains: value - invested, series: series };
  }

  // —— chart ——
  function drawChart(series) {
    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.clientWidth || canvas.parentElement.clientWidth;
    var cssH = 220;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    var padL = 8, padR = 8, padT = 10, padB = 22;
    var w = cssW - padL - padR, h = cssH - padT - padB;
    var maxV = 0, maxY = series[series.length - 1].y || 1;
    series.forEach(function (p) { if (p.value > maxV) maxV = p.value; });
    if (maxV <= 0) maxV = 1;

    var gridC = cssVar('--border') || '#e5e5e5';
    var textC = cssVar('--faint') || '#999';
    var fvC = '#f59e0b';
    var inC = cssVar('--border-2') || '#ccc';

    var X = function (yr) { return padL + (maxY ? (yr / maxY) * w : 0); };
    var Y = function (v) { return padT + h - (v / maxV) * h; };

    // horizontal gridlines + y labels (0, mid, max)
    ctx.font = '10px ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = gridC;
    ctx.fillStyle = textC;
    ctx.lineWidth = 1;
    [0, 0.5, 1].forEach(function (f) {
      var yy = padT + h - f * h;
      ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + w, yy); ctx.stroke();
      ctx.globalAlpha = 1;
      var label = wan(maxV * f) || ('¥' + Math.round(maxV * f).toLocaleString('en-US'));
      ctx.textAlign = 'left';
      ctx.fillText(label.replace('约 ', ''), padL + 2, yy - 7);
    });

    // x labels (start / mid / end years)
    ctx.textBaseline = 'alphabetic';
    [0, Math.round(maxY / 2), Math.round(maxY)].forEach(function (yr, i) {
      var xx = X(yr);
      ctx.textAlign = i === 0 ? 'left' : i === 2 ? 'right' : 'center';
      ctx.fillText(yr + '年', xx, cssH - 6);
    });

    // invested area (baseline)
    ctx.beginPath();
    ctx.moveTo(X(series[0].y), Y(series[0].invested));
    series.forEach(function (p) { ctx.lineTo(X(p.y), Y(p.invested)); });
    ctx.lineTo(X(series[series.length - 1].y), Y(0));
    ctx.lineTo(X(series[0].y), Y(0));
    ctx.closePath();
    ctx.fillStyle = inC; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;

    // total-value gradient area
    var grad = ctx.createLinearGradient(0, padT, 0, padT + h);
    grad.addColorStop(0, 'rgba(245,158,11,0.30)');
    grad.addColorStop(1, 'rgba(245,158,11,0.02)');
    ctx.beginPath();
    ctx.moveTo(X(series[0].y), Y(series[0].value));
    series.forEach(function (p) { ctx.lineTo(X(p.y), Y(p.value)); });
    ctx.lineTo(X(series[series.length - 1].y), Y(0));
    ctx.lineTo(X(series[0].y), Y(0));
    ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    // total-value line
    ctx.beginPath();
    series.forEach(function (p, i) {
      var xx = X(p.y), yy = Y(p.value);
      if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
    });
    ctx.strokeStyle = fvC; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();

    // end dot
    var last = series[series.length - 1];
    ctx.beginPath();
    ctx.arc(X(last.y), Y(last.value), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = fvC; ctx.fill();
    ctx.strokeStyle = cssVar('--surface') || '#fff'; ctx.lineWidth = 2; ctx.stroke();
  }

  // —— render ——
  function recompute() {
    var initial = clampNum(initialEl, 0);
    var monthly = clampNum(monthlyEl, 0);
    var rate    = clampNum(rateEl, 0);
    var years   = clampNum(yearsEl, 1);

    var r = project(initial, monthly, rate, years);
    var mult = r.invested > 0 ? r.value / r.invested : 0;

    multEl.textContent = (mult || 0).toFixed(2);
    fvEl.textContent = money(r.value);
    fvWanEl.textContent = wan(r.value) || '';
    investedEl.textContent = money(r.invested);
    gainsEl.textContent = money(r.gains);

    drawChart(r.series);
  }

  // —— sync a number input with its slider ——
  function pair(numEl, rangeEl) {
    if (!rangeEl) { numEl.addEventListener('input', recompute); return; }
    numEl.addEventListener('input', function () {
      var v = parseFloat(numEl.value);
      if (isFinite(v)) {
        var rmin = parseFloat(rangeEl.min), rmax = parseFloat(rangeEl.max);
        rangeEl.value = Math.min(Math.max(v, rmin), rmax);
      }
      clearActiveAssets();
      recompute();
    });
    rangeEl.addEventListener('input', function () {
      numEl.value = rangeEl.value;
      if (numEl === rateEl) clearActiveAssets();
      recompute();
    });
  }

  // —— asset presets ——
  var assetBtns = Array.prototype.slice.call(document.querySelectorAll('#assets .asset'));
  function clearActiveAssets() {
    assetBtns.forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
  }
  assetBtns.forEach(function (btn) {
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', function () {
      var rate = btn.getAttribute('data-rate');
      rateEl.value = rate;
      if (rateRange) rateRange.value = Math.min(Math.max(parseFloat(rate), parseFloat(rateRange.min)), parseFloat(rateRange.max));
      clearActiveAssets();
      btn.setAttribute('aria-pressed', 'true');
      recompute();
    });
  });

  pair(initialEl, null);
  pair(monthlyEl, monthlyRange);
  pair(rateEl, rateRange);
  pair(yearsEl, yearsRange);

  // redraw on resize (debounced) and on theme change (colors come from CSS vars)
  var rt;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(recompute, 120); });
  new MutationObserver(recompute).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  recompute();
})();
