// Apple gift-card page — real-time fiat rates + click-to-calculate converter.

let _rates = { usd: 0, try: 0, ngn: 0 };  // per-unit CNY rates
const SYMBOLS = { usd: 'USD', try: 'TRY', ngn: 'NGN' };
const FLAGS   = { usd: '🇺🇸',  try: '🇹🇷',  ngn: '🇳🇬'  };

function calculate() {
  const result = document.getElementById('calc-result');
  if (!result) return;

  const cur    = document.getElementById('calc-cur')?.value || 'usd';
  const amount = parseFloat(document.getElementById('calc-amount')?.value);

  if (!isFinite(amount) || amount <= 0) {
    result.innerHTML = '<strong>—</strong>';
    return;
  }

  const rate = _rates[cur];
  if (!rate) {
    result.innerHTML = '<strong>加载中…</strong>';
    return;
  }

  const cny = amount * rate;
  result.innerHTML = `≈ <strong>¥ ${cny.toFixed(2)}</strong>`;
}

async function fetchFx() {
  const set = (id, txt, color) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = txt;
    if (color) el.style.color = color;
  };

  try {
    const r = await fetch('/api/fx', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();

    // Compact inline rate display: just the number, no unit suffix
    // (the surrounding label already says "1 USD ≈ X" etc.)
    set('fx-usd', d.usd.toFixed(2));
    set('fx-try', d.try.toFixed(3));
    set('fx-ngn', d.ngn.toFixed(2));

    // /api/fx returns NGN as "100 NGN → CNY"; normalise to per-unit.
    _rates.usd = d.usd;
    _rates.try = d.try;
    _rates.ngn = d.ngn / 100;

    // Auto-calculate once rates land so the result isn't stuck at "—".
    calculate();
  } catch (_) {
    ['fx-usd', 'fx-try', 'fx-ngn'].forEach(id => set(id, '—', '#dc2626'));
  }
}

// —— Wiring —— bind once DOM is ready. `defer` already guarantees this.
const btn      = document.getElementById('calc-btn');
const amountEl = document.getElementById('calc-amount');
const curEl    = document.getElementById('calc-cur');

if (btn)      btn.addEventListener('click', calculate);
if (amountEl) amountEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); calculate(); }
});
// Recompute immediately when the user changes currency too — feels right.
if (curEl) curEl.addEventListener('change', calculate);

fetchFx();
