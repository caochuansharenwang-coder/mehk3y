/* dingtou.js — 定投复利计算器
 * Pure client-side. No inline handlers (CSP script-src 'self').
 *
 * Modes:
 *   forward — given monthly contribution, project future value.
 *   goal    — given a target amount, solve the required monthly contribution.
 *
 * Convention: monthly compounding at annual/12, contributions at the START
 * of each month (annuity-due) — matches common DCA calculators.
 * Optional: two-stage return (forward only) and inflation adjustment.
 */
'use strict';

(function () {
  var $ = function (id) { return document.getElementById(id); };
  var main = $('main');

  var initialEl = $('initial');
  var monthlyEl = $('monthly');
  var targetEl  = $('target');
  var rateEl    = $('rate');
  var yearsEl   = $('years');
  var monthlyRange = $('monthly-range');
  var targetRange  = $('target-range');
  var rateRange    = $('rate-range');
  var yearsRange   = $('years-range');

  var inflOn   = $('infl-on');
  var inflRate = $('infl-rate');
  var stageOn  = $('stage-on');
  var splitEl  = $('split');
  var rate2El  = $('rate2');

  var multEl     = $('mult');
  var needEl     = $('need');
  var needSubEl  = $('need-sub');
  var fvEl       = $('fv');
  var fvSubEl    = $('fv-sub');
  var investedEl = $('invested');
  var gainsEl    = $('gains');
  var canvas     = $('chart');
  var ctx        = canvas.getContext('2d');

  var mode = 'forward';

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
    var neg = n < 0 ? '-' : ''; n = Math.abs(n);
    if (n >= 1e8) return '约 ' + neg + (n / 1e8).toFixed(2) + ' 亿';
    if (n >= 1e4) return '约 ' + neg + (n / 1e4).toFixed(1) + ' 万';
    return '';
  }
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function monthlyRate(annualPct) { return (annualPct / 100) / 12; }

  // monthly rate for month m (1-based), honoring optional two-stage split
  function rateForMonth(m, rm1, rm2, splitMonth, twoStage) {
    return (twoStage && m > splitMonth) ? rm2 : rm1;
  }

  // project month-by-month, build yearly series
  function project(initial, monthly, n, rm1, rm2, splitMonth, twoStage) {
    var value = initial;
    var series = [{ y: 0, value: initial, invested: initial }];
    for (var m = 1; m <= n; m++) {
      var rm = rateForMonth(m, rm1, rm2, splitMonth, twoStage);
      value = (value + monthly) * (1 + rm);
      if (m % 12 === 0 || m === n) {
        series.push({ y: m / 12, value: value, invested: initial + monthly * m });
      }
    }
    var invested = initial + monthly * n;
    return { value: value, invested: invested, gains: value - invested, series: series };
  }

  // solve required monthly (annuity-due, single rate) so FV == target
  function solveMonthly(initial, target, n, rm) {
    var fvInitial, dueFactor;
    if (rm === 0) { fvInitial = initial; dueFactor = n; }
    else {
      var g = Math.pow(1 + rm, n);
      fvInitial = initial * g;
      dueFactor = ((g - 1) / rm) * (1 + rm);
    }
    if (dueFactor <= 0) return 0;
    var need = (target - fvInitial) / dueFactor;
    return need > 0 ? need : 0;
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

    ctx.textBaseline = 'alphabetic';
    [0, Math.round(maxY / 2), Math.round(maxY)].forEach(function (yr, i) {
      var xx = X(yr);
      ctx.textAlign = i === 0 ? 'left' : i === 2 ? 'right' : 'center';
      ctx.fillText(yr + '年', xx, cssH - 6);
    });

    // invested baseline area
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

    var last = series[series.length - 1];
    ctx.beginPath();
    ctx.arc(X(last.y), Y(last.value), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = fvC; ctx.fill();
    ctx.strokeStyle = cssVar('--surface') || '#fff'; ctx.lineWidth = 2; ctx.stroke();
  }

  // —— render ——
  function recompute() {
    var initial = clampNum(initialEl, 0);
    var rate    = clampNum(rateEl, 0);
    var years   = clampNum(yearsEl, 1);
    var n       = Math.round(years * 12);
    var rm1     = monthlyRate(rate);

    var twoStage = stageOn.checked && mode === 'forward';
    var rm2 = monthlyRate(clampNum(rate2El, 0));
    var splitMonth = Math.round(clampNum(splitEl, 0) * 12);

    var monthly, r;
    if (mode === 'goal') {
      var target = clampNum(targetEl, 0);
      monthly = solveMonthly(initial, target, n, rm1);
      r = project(initial, monthly, n, rm1, rm1, 0, false);
      needEl.textContent = money(monthly);
      needSubEl.textContent = '坚持 ' + years + ' 年即可攒到 ' + money(target)
        + (wan(target) ? '（' + wan(target) + '）' : '');
    } else {
      monthly = clampNum(monthlyEl, 0);
      r = project(initial, monthly, n, rm1, rm2, splitMonth, twoStage);
      var mult = r.invested > 0 ? r.value / r.invested : 0;
      multEl.textContent = (mult || 0).toFixed(2);
    }

    // shared cards
    fvEl.textContent = money(r.value);
    investedEl.textContent = money(r.invested);
    gainsEl.textContent = money(r.gains);

    // future-value sub-line: inflation-adjusted real value, else 万/亿 hint
    if (inflOn.checked) {
      var real = r.value / Math.pow(1 + clampNum(inflRate, 0) / 100, years);
      fvSubEl.textContent = '今天购买力 ≈ ' + money(real);
      fvSubEl.className = 'stat-sub real';
    } else {
      fvSubEl.textContent = wan(r.value) || '';
      fvSubEl.className = 'stat-sub';
    }

    drawChart(r.series);
  }

  // —— sync number input with its slider ——
  function pair(numEl, rangeEl, isRate) {
    if (!rangeEl) { numEl.addEventListener('input', recompute); return; }
    numEl.addEventListener('input', function () {
      var v = parseFloat(numEl.value);
      if (isFinite(v)) {
        var rmin = parseFloat(rangeEl.min), rmax = parseFloat(rangeEl.max);
        rangeEl.value = Math.min(Math.max(v, rmin), rmax);
      }
      if (isRate) clearActiveAssets();
      recompute();
    });
    rangeEl.addEventListener('input', function () {
      numEl.value = rangeEl.value;
      if (isRate) clearActiveAssets();
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

  // —— mode switch ——
  Array.prototype.slice.call(document.querySelectorAll('#mode-switch button')).forEach(function (btn) {
    btn.addEventListener('click', function () {
      mode = btn.getAttribute('data-mode');
      main.setAttribute('data-mode', mode);
      document.querySelectorAll('#mode-switch button').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b === btn));
      });
      recompute();
    });
  });

  // —— advanced toggles (checkbox drives row visibility) ——
  function bindAdv(checkbox, rowId) {
    var row = $(rowId);
    function sync() { row.classList.toggle('on', checkbox.checked); recompute(); }
    checkbox.addEventListener('change', sync);
    row.classList.toggle('on', checkbox.checked);
  }
  bindAdv(inflOn, 'adv-infl');
  bindAdv(stageOn, 'adv-stage');
  inflRate.addEventListener('input', recompute);
  splitEl.addEventListener('input', recompute);
  rate2El.addEventListener('input', recompute);

  pair(initialEl, null);
  pair(monthlyEl, monthlyRange, false);
  pair(targetEl, targetRange, false);
  pair(rateEl, rateRange, true);
  pair(yearsEl, yearsRange, false);

  var rt;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(recompute, 120); });
  new MutationObserver(recompute).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  recompute();
})();
