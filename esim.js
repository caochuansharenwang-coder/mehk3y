// /esim — LPA Activation Code parser
//
// LPA Activation Code format (GSMA SGP.22 §4.1):
//   LPA:1$<SM-DP+ Address>$<Matching ID>[$<Confirmation Code Required Flag>]
//
// In practice carriers use it in 3 common shapes:
//   LPA:1$smdp.example.com$ABCD-1234-EFGH
//   LPA:1$smdp.example.com$ABCD-1234-EFGH$1                 (CC required)
//   LPA:1$smdp.example.com$$ACTIVATION-TOKEN                (no Matching ID)
//
// The "Confirmation Code" itself is NOT in the LPA string — the trailing flag
// just tells the LPA app to prompt the user for it. But many user-facing tools
// (and some carriers) tack the actual code onto the end as a 4th field, like:
//   LPA:1$smdp.example.com$ABCD-1234$1234567
// We accept both styles and surface whatever's there as "Confirmation Code".

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const input  = $('lpa-input');
  const result = $('parse-result');

  const SAMPLE = 'LPA:1$rsp.truphone.com$QR-G-5C-3F2A-1B8C7D';

  // -------- parsing --------

  function parseLPA(raw) {
    if (!raw) return { error: '请输入激活码。' };
    let s = raw.trim();

    // Some carriers prefix with extra whitespace, BOM, or wrap in quotes.
    s = s.replace(/^\uFEFF/, '').replace(/^["'`]+|["'`]+$/g, '').trim();

    if (!/^LPA:/i.test(s)) {
      return { error: '激活码必须以 LPA: 开头。请确认你复制的是完整字符串。' };
    }

    // Split on $; the spec uses $ as field delimiter and forbids $ in any field.
    const parts = s.split('$');

    if (parts.length < 3) {
      return { error: '格式不完整：缺少 SM-DP+ 服务器或 Matching ID 字段。' };
    }

    // parts[0] = "LPA:1" (or LPA:2 in newer drafts) — pull version off it.
    const versionMatch = parts[0].match(/^LPA:(\d+)$/i);
    const version = versionMatch ? versionMatch[1] : null;

    const smdp        = (parts[1] || '').trim();
    const matchingID  = (parts[2] || '').trim();
    // 4th field: per spec it's the CC-required flag ('1' or empty), but in
    // practice it's often the literal Confirmation Code. Surface it as-is.
    const fourth      = (parts[3] || '').trim();
    const ccRequired  = fourth === '1';
    const confirmCode = ccRequired ? '' : fourth;

    if (!smdp) {
      return { error: '缺少 SM-DP+ 服务器地址。' };
    }
    // SM-DP+ should be a hostname; reject if it looks like a URL with scheme.
    if (/^https?:/i.test(smdp)) {
      return { error: 'SM-DP+ 字段应该是域名（如 smdp.example.com），不要带 https:// 前缀。' };
    }

    return {
      version, smdp, matchingID, confirmCode, ccRequired,
      reassembled: rebuild({ version: version || '1', smdp, matchingID, confirmCode, ccRequired }),
    };
  }

  function rebuild({ version, smdp, matchingID, confirmCode, ccRequired }) {
    let s = `LPA:${version || '1'}$${smdp}$${matchingID || ''}`;
    if (confirmCode) s += `$${confirmCode}`;
    else if (ccRequired) s += `$1`;
    return s;
  }

  // -------- rendering --------

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fieldRow(label, value, { copyable = true, mutedIfEmpty = false } = {}) {
    const empty = !value;
    const display = empty
      ? `<span class="field-value muted">— 无</span>`
      : `<span class="field-value">${escapeHtml(value)}</span>`;
    const copy = copyable && !empty
      ? `<button class="copy-btn" data-copy="${escapeHtml(value)}">复制</button>`
      : '';
    return `<div class="field">
      <span class="field-label">${escapeHtml(label)}</span>
      ${display}
      ${copy}
    </div>`;
  }

  function render(parsed) {
    if (parsed.error) {
      result.classList.remove('empty');
      result.innerHTML = `<div class="alert alert-err">${escapeHtml(parsed.error)}</div>`;
      return;
    }

    const note = parsed.ccRequired
      ? `<div class="alert alert-ok" style="margin-top:12px"><b>提示：</b>激活码末尾的 <code>$1</code> 表示运营商要求确认码（Confirmation Code），但确认码本身没在激活码里 —— 找运营商的邮件 / 短信 / 后台获取。</div>`
      : '';

    result.classList.remove('empty');
    result.innerHTML = `
      ${fieldRow('版本', parsed.version || '1', { copyable: false })}
      ${fieldRow('SM-DP+ 服务器', parsed.smdp)}
      ${fieldRow('Matching ID', parsed.matchingID || '', { mutedIfEmpty: true })}
      ${fieldRow('Confirmation Code', parsed.confirmCode || '', { mutedIfEmpty: true })}
      ${fieldRow('完整激活码', parsed.reassembled)}
      ${note}
      <div id="qr-container"></div>
    `;

    renderQR(parsed.reassembled);
  }

  // -------- QR rendering --------

  // Build an SVG element from the QRCode matrix. Uses a single <path> made of
  // axis-aligned rects (one per dark module) for compact output.
  function buildQRSvg(text) {
    if (typeof QRCode === 'undefined') return null;
    let qr;
    try { qr = QRCode.encode(text, 'M'); }
    catch (e) {
      // Fall back to error correction L if data is too long for M.
      try { qr = QRCode.encode(text, 'L'); } catch (_) { return null; }
    }
    const cell = 8;
    const margin = 4 * cell;
    const dim = qr.size * cell + margin * 2;
    let path = '';
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        if (qr.modules[y][x]) {
          path += `M${margin + x * cell},${margin + y * cell}h${cell}v${cell}h-${cell}z`;
        }
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" role="img" aria-label="LPA Activation Code QR"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
  }

  function renderQR(text) {
    const box = $('qr-container');
    if (!box) return;
    const svg = buildQRSvg(text);
    if (!svg) {
      box.innerHTML = '';
      return;
    }
    // Build a data URL for "save as PNG" download. Browsers honor the SVG
    // mime type, and right-click → save works on the link.
    const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    box.innerHTML = `
      <div class="qr-wrap">
        ${svg}
        <div class="qr-meta">
          <b>扫码即用</b>
          在 EasyEUICC / OpenEUICC 里点 <code>+</code> → "Scan QR" 直接对准这张图，比手动填三个字段快得多。
          <div class="qr-actions">
            <a href="${dataUrl}" download="lpa-activation.svg">下载 SVG</a>
          </div>
        </div>
      </div>
    `;
  }

  function clear() {
    input.value = '';
    result.classList.add('empty');
    result.innerHTML = '';
    input.focus();
  }

  // -------- clipboard helpers --------

  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = '已复制';
        btn.classList.add('ok');
        setTimeout(() => { btn.textContent = orig; btn.classList.remove('ok'); }, 1200);
      }
    } catch (e) {
      // Fallback: select via temporary textarea (works without clipboard perm).
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (_) {}
      ta.remove();
    }
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        input.value = text;
        render(parseLPA(text));
      }
    } catch (e) {
      // Permission denied (Safari etc.) — just focus the textarea instead.
      input.focus();
      result.classList.remove('empty');
      result.innerHTML = `<div class="alert alert-err">浏览器拒绝读取剪贴板，请手动粘贴到文本框。</div>`;
    }
  }

  // -------- event wiring --------

  $('btn-parse').addEventListener('click', () => render(parseLPA(input.value)));
  $('btn-paste').addEventListener('click', pasteFromClipboard);
  $('btn-clear').addEventListener('click', clear);
  $('btn-sample').addEventListener('click', () => {
    input.value = SAMPLE;
    render(parseLPA(SAMPLE));
  });

  // Auto-parse as the user types (debounced).
  let typingTimer = null;
  input.addEventListener('input', () => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      const v = input.value.trim();
      if (v) render(parseLPA(v));
      else { result.classList.add('empty'); result.innerHTML = ''; }
    }, 300);
  });

  // Cmd/Ctrl+Enter to parse from anywhere.
  input.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      render(parseLPA(input.value));
    }
  });

  // Delegate clicks on dynamically-rendered copy buttons.
  result.addEventListener('click', (e) => {
    const btn = e.target.closest('.copy-btn');
    if (!btn) return;
    const text = btn.getAttribute('data-copy');
    if (text) copyText(text, btn);
  });
})();
