// Claude AI heavily risk-controls or blocks sessions originating from these
// countries (mainland CN, HK, MO, RU, KP, IR, SY, CU, BY, VE). When the exit
// IP lives in one of them, force the trust score to 0 regardless of how
// "clean" the IP looks — Claude will block the login anyway. Keyed by ISO-2.
const CLAUDE_RESTRICTED_CC = {
  CN: '中国大陆', HK: '香港', MO: '澳门',
  RU: '俄罗斯', KP: '朝鲜', IR: '伊朗', SY: '叙利亚',
  CU: '古巴',   BY: '白俄罗斯', VE: '委内瑞拉',
};

// Country code → representative IANA timezone, used as a fallback when the
// upstream IP API didn't return a precise `timezone`. Picks the most
// populous TZ for multi-TZ countries (US: LA, RU: Moscow, CA: Toronto).
const CC_TO_TZ = {
  CN: 'Asia/Shanghai', TW: 'Asia/Taipei', HK: 'Asia/Hong_Kong', MO: 'Asia/Macau',
  JP: 'Asia/Tokyo', KR: 'Asia/Seoul', SG: 'Asia/Singapore', MY: 'Asia/Kuala_Lumpur',
  TH: 'Asia/Bangkok', VN: 'Asia/Ho_Chi_Minh', ID: 'Asia/Jakarta', PH: 'Asia/Manila',
  IN: 'Asia/Kolkata', PK: 'Asia/Karachi', BD: 'Asia/Dhaka',
  IR: 'Asia/Tehran', IL: 'Asia/Jerusalem', AE: 'Asia/Dubai', SA: 'Asia/Riyadh',
  TR: 'Europe/Istanbul', RU: 'Europe/Moscow', UA: 'Europe/Kyiv',
  GB: 'Europe/London', IE: 'Europe/Dublin', FR: 'Europe/Paris', DE: 'Europe/Berlin',
  IT: 'Europe/Rome', ES: 'Europe/Madrid', PT: 'Europe/Lisbon', NL: 'Europe/Amsterdam',
  BE: 'Europe/Brussels', CH: 'Europe/Zurich', AT: 'Europe/Vienna',
  SE: 'Europe/Stockholm', NO: 'Europe/Oslo', DK: 'Europe/Copenhagen', FI: 'Europe/Helsinki',
  PL: 'Europe/Warsaw', CZ: 'Europe/Prague', GR: 'Europe/Athens', RO: 'Europe/Bucharest',
  US: 'America/Los_Angeles', CA: 'America/Toronto', MX: 'America/Mexico_City',
  BR: 'America/Sao_Paulo', AR: 'America/Argentina/Buenos_Aires', CL: 'America/Santiago',
  AU: 'Australia/Sydney', NZ: 'Pacific/Auckland',
  ZA: 'Africa/Johannesburg', EG: 'Africa/Cairo', NG: 'Africa/Lagos', KE: 'Africa/Nairobi',
};

// Country (ISO-2) → accepted browser language primary subtags. Multilingual
// regions list every official/widely-used language so that e.g. a Singapore
// IP with an `en-SG` browser, an Indian IP with `hi-IN`, or a Swiss IP with
// `de-CH` all count as "language matches" instead of false-flagging mismatch.
const CC_TO_LANGS = {
  CN: ['zh'], TW: ['zh'], HK: ['zh', 'en'], MO: ['zh', 'en'],
  JP: ['ja'], KR: ['ko'], TH: ['th'], VN: ['vi'],
  SG: ['en', 'zh', 'ms', 'ta'],
  MY: ['ms', 'en', 'zh', 'ta'],
  ID: ['id', 'en'], PH: ['en', 'tl', 'fil'],
  IN: ['en', 'hi'], PK: ['ur', 'en'], BD: ['bn', 'en'],
  LK: ['si', 'ta', 'en'], NP: ['ne', 'en'],
  US: ['en'], GB: ['en'], IE: ['en', 'ga'],
  AU: ['en'], NZ: ['en', 'mi'],
  CA: ['en', 'fr'],
  DE: ['de'], AT: ['de'],
  CH: ['de', 'fr', 'it', 'rm'],
  BE: ['nl', 'fr', 'de'],
  FR: ['fr'], IT: ['it'], ES: ['es', 'ca', 'gl', 'eu'],
  PT: ['pt'], NL: ['nl', 'fy'], LU: ['lb', 'fr', 'de'],
  SE: ['sv'], NO: ['no', 'nb', 'nn'], DK: ['da'],
  FI: ['fi', 'sv'], IS: ['is', 'en'],
  PL: ['pl'], CZ: ['cs'], SK: ['sk'], HU: ['hu'],
  RO: ['ro'], BG: ['bg'], GR: ['el'],
  RU: ['ru'], UA: ['uk', 'ru'], BY: ['be', 'ru'],
  TR: ['tr'], IL: ['he', 'ar', 'en'],
  SA: ['ar'], AE: ['ar', 'en'], EG: ['ar'],
  IR: ['fa'], IQ: ['ar', 'ku'],
  ZA: ['en', 'af', 'zu', 'xh'], KE: ['en', 'sw'],
  NG: ['en'], ET: ['am', 'en'],
  BR: ['pt'], AR: ['es'], MX: ['es'], CL: ['es'],
  CO: ['es'], PE: ['es'], VE: ['es'],
};

// Current UTC offset (in minutes) for an IANA timezone. Returns null if the
// runtime can't resolve it. Used for offset-based TZ comparison instead of
// zone-name string equality, which falsely flags neighbor zones with the
// same offset (Toronto vs New York, Berlin vs Paris) as "mismatched".
function tzOffsetMinutes(tz) {
  if (!tz) return null;
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const f = {};
    dtf.formatToParts(new Date()).forEach(p => { if (p.type !== 'literal') f[p.type] = p.value; });
    const asUTC = Date.UTC(+f.year, +f.month - 1, +f.day, +f.hour, +f.minute, +f.second);
    return Math.round((asUTC - Date.now()) / 60000);
  } catch (_) {
    return null;
  }
}

function getDeviceInfo(ip) {
  const ipTimezone = ip?.timezone || '';
  const ipCC       = (ip?.countryCode || '').toUpperCase();
  const localTz    = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const lang       = navigator.language || '';

  const ua = navigator.userAgent;
  let os = 'Unknown', browser = 'Unknown', browserVer = '';
  if      (/iPhone|iPad|iPod/.test(ua))       os = 'iOS';
  else if (/Android/.test(ua))                os = 'Android';
  else if (/Mac OS X/.test(ua))               os = 'macOS';
  else if (/Windows/.test(ua))                os = 'Windows';
  else if (/Linux/.test(ua))                  os = 'Linux';

  if      (/Edg\//.test(ua))                  { browser = 'Edge';    browserVer = ua.match(/Edg\/([\d]+)/)?.[1]; }
  else if (/OPR\//.test(ua))                  { browser = 'Opera';   browserVer = ua.match(/OPR\/([\d]+)/)?.[1]; }
  else if (/Firefox\//.test(ua))              { browser = 'Firefox'; browserVer = ua.match(/Firefox\/([\d]+)/)?.[1]; }
  else if (/Chrome\//.test(ua))               { browser = 'Chrome';  browserVer = ua.match(/Chrome\/([\d]+)/)?.[1]; }
  else if (/Version\/.*Safari/.test(ua))      { browser = 'Safari';  browserVer = ua.match(/Version\/([\d]+)/)?.[1]; }

  let canvasFp = 'N/A';
  try {
    const c = document.createElement('canvas');
    c.width = 240; c.height = 60;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f6f6f6'; ctx.fillRect(0, 0, 240, 60);
    ctx.fillStyle = '#0d0d0d'; ctx.font = 'bold 14px Arial';
    ctx.fillText('Claude IP Check', 10, 35);
    ctx.fillStyle = 'rgba(247,147,26,0.4)'; ctx.fillRect(0, 0, 60, 60);
    const data = c.toDataURL();
    let h = 0;
    for (let i = 0; i < data.length; i++) h = Math.imul(31, h) + data.charCodeAt(i) | 0;
    canvasFp = (h >>> 0).toString(16).toUpperCase().padStart(8, '0');
  } catch (_) {}

  let webglRenderer = 'N/A', webglFp = 'N/A';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      webglRenderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      let h = 0;
      for (let i = 0; i < webglRenderer.length; i++) h = Math.imul(31, h) + webglRenderer.charCodeAt(i) | 0;
      webglFp = (h >>> 0).toString(16).toUpperCase().padStart(8, '0');
    }
  } catch (_) {}

  // Timezone compare: UTC offset with 1h tolerance, NOT zone-name equality.
  // String equality flags Toronto vs New York or Berlin vs Paris as mismatched
  // even though they share the same offset year-round. We also fall back to a
  // country-derived representative TZ when the IP API didn't return one.
  const expectedTz  = ipTimezone || CC_TO_TZ[ipCC] || '';
  const expectedOff = tzOffsetMinutes(expectedTz);
  const localOff    = -new Date().getTimezoneOffset();
  let tzMismatch    = false;
  if (expectedTz && expectedOff != null) {
    tzMismatch = Math.abs(expectedOff - localOff) > 60;
  }

  // Language compare: against the IP region's accepted language list, NOT a
  // hard-coded "must start with en". Multilingual regions (CA/SG/IN/CH...)
  // are accepted on any one of their official languages. If the country is
  // unknown to the map, we don't flag at all (better silent than wrong).
  const localPrimary = (lang.split('-')[0] || '').toLowerCase();
  const acceptedLangs = CC_TO_LANGS[ipCC] || [];
  let langMismatch = false;
  if (localPrimary && acceptedLangs.length) {
    langMismatch = !acceptedLangs.includes(localPrimary);
  }

  return {
    localTz, lang,
    osStr: `${os} / ${browser}${browserVer ? ' ' + browserVer : ''}`,
    cookie: navigator.cookieEnabled,
    canvasFp, webglRenderer, webglFp,
    tzMismatch, langMismatch,
    expectedTz, expectedLangs: acceptedLangs,
  };
}

function trustScore(ip) {
  // Restricted region → forced 0. Claude blocks/heavily risk-controls these
  // regardless of how clean the IP otherwise looks.
  const cc = (ip.countryCode || '').toUpperCase();
  if (CLAUDE_RESTRICTED_CC[cc]) return 0;

  // Start from 100 and subtract for risk signals — easier to reason about
  // than "base + bonuses", and a fully-clean IP can actually reach top tier.
  // Calibrated against the reference scoring at ip.net.coffee/claude:
  //   - hosting/datacenter is a "warn" not a "danger" — softened from -35 to -20
  //   - VPN / proxy / Tor still drop the score significantly but no longer
  //     bottom it out (typical residential VPN should land in the 中性 tier,
  //     not the 可疑 tier — Claude tolerates many of them)
  //   - Browser fingerprint signals (TZ / language mismatch) are dropped
  //     entirely from the score: they are weak signals with high false-
  //     positive rates (overseas Chinese, EU travelers, neighbor-zone IPs).
  //     We still SHOW the mismatch in the device card, just don't ding for it.
  let s = 100;

  if (ip.isTOR)            s -= 80;
  else if (ip.isVPN)       s -= 50;
  else if (ip.proxy)       s -= 35;
  if (ip.isHosting)        s -= 20;

  // Numeric risk score from proxycheck (0–100). Lighter weight than before
  // (0.25 vs 0.3) so a moderate risk doesn't compound on top of an already
  // softened proxy/hosting deduction.
  if (ip.risk > 0)         s -= Math.min(25, Math.round(ip.risk * 0.25));

  return Math.max(0, Math.min(100, s));
}

function trustLabel(s) {
  // Tiers must stay in sync with the subtitle text in render(). Aligned with
  // ip.net.coffee/claude: 95+ 极度纯净, 80+ 纯净, 50+ 良好, 25+ 中性, <25 可疑.
  if (s >= 95) return { text: '极度纯净', color: '#0a6e1e', bg: '#f0fdf4' };
  if (s >= 80) return { text: '纯净',     color: '#16a34a', bg: '#f0fdf4' };
  if (s >= 50) return { text: '良好',     color: '#2563eb', bg: '#eff6ff' };
  if (s >= 25) return { text: '中性',     color: '#ca8a04', bg: '#fefce8' };
  return               { text: '可疑',    color: '#dc2626', bg: '#fef2f2' };
}

function badge(text, ok) {
  const color = ok  ? '#16a34a' : '#dc2626';
  const bg    = ok  ? '#f0fdf4' : '#fef2f2';
  return `<span style="background:${bg};color:${color};padding:2px 10px;border-radius:99px;font-size:12px;font-weight:600">${text}</span>`;
}

function warnBadge(text) {
  return `<span style="background:#fff7ed;color:#f7931a;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:600">${text}</span>`;
}

function row(label, valueHtml) {
  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">
    <span style="color:var(--dim);font-size:12px">${label}</span>
    <span style="font-size:12px;font-weight:600;text-align:right;max-width:65%">${valueHtml}</span>
  </div>`;
}

function card(label, content, extra) {
  return `<div class="card" style="${extra || ''}">
    <div class="card-label" style="margin-bottom:8px">${label}</div>
    ${content}
  </div>`;
}

function render(ip, dev, dnsResult, webrtcResult) {
  const score = trustScore(ip);
  const lbl   = trustLabel(score);
  const ccUp  = (ip.countryCode || '').toUpperCase();
  const restrictedName = CLAUDE_RESTRICTED_CC[ccUp] || null;

  const ipType = ip.isVPN ? 'VPN' : ip.isTOR ? 'Tor' : ip.proxy ? '代理 IP' : ip.isHosting ? '数据中心 IP' : '家庭 IP';
  const itColor = (ip.proxy || ip.isVPN || ip.isTOR) ? '#dc2626' : ip.isHosting ? '#f7931a' : '#16a34a';
  const itBg    = (ip.proxy || ip.isVPN || ip.isTOR) ? '#fef2f2' : ip.isHosting ? '#fff7ed' : '#f0fdf4';

  const tzLine = dev.tzMismatch
    ? `${warnBadge('时区不一致')}<br><small style="color:var(--dim);font-size:11px">本地: ${dev.localTz} / 出口: ${dev.expectedTz || ip.timezone || '—'}</small>`
    : `${badge('一致', true)} <small style="color:var(--dim);font-size:11px">${dev.localTz}</small>`;

  const langLine = dev.langMismatch
    ? `${warnBadge('语言不一致')}<br><small style="color:var(--dim);font-size:11px">本地: ${dev.lang}${dev.expectedLangs?.length ? ' / 出口常用: ' + dev.expectedLangs.join('/') : ''}</small>`
    : `${badge('一致', true)} <small style="color:var(--dim);font-size:11px">${dev.lang}</small>`;

  // DNS leak card
  let dnsContent;
  if (dnsResult.error) {
    dnsContent = `${row('状态', badge('检测失败', false))}`;
  } else if (dnsResult.ip) {
    const dnsLeaked = ip.ip && dnsResult.ip !== ip.ip;
    dnsContent = `
      ${row('状态', badge(dnsLeaked ? '检测到泄露' : '未检测到泄露', !dnsLeaked))}
      ${row('DNS 出口', `<code style="font-size:12px">${dnsResult.loc ? dnsResult.loc + ' ' : ''}${dnsResult.ip}</code>`)}
      ${row('服务商', dnsResult.org || '—')}
    `;
  } else {
    dnsContent = `
      ${row('状态', `<span style="color:var(--dim);font-size:12px">检测中…</span>`)}
      ${row('DNS 出口', `<span style="color:var(--dim);font-size:12px">—</span>`)}
      ${row('服务商', `<span style="color:var(--dim);font-size:12px">—</span>`)}
    `;
  }
  const dnsCard = `<div class="card">
    <div class="card-label" style="margin-bottom:12px">DNS 泄露检测</div>
    <div id="dns-card-inner">${dnsContent}</div>
  </div>`;

  // WebRTC leak card
  let webrtcContent;
  if (webrtcResult.ip || webrtcResult.done) {
    const leaked = webrtcResult.ip && ip.ip && webrtcResult.ip !== ip.ip;
    webrtcContent = `
      ${row('状态', badge(webrtcResult.ip ? (leaked ? '检测到泄露' : '未检测到泄露') : '未获取到公网 IP', webrtcResult.ip ? !leaked : true))}
      ${row('UDP 出口', `<code style="font-size:12px">${webrtcResult.loc ? webrtcResult.loc + ' ' : ''}${webrtcResult.ip || '—'}</code>`)}
      ${row('归属地', webrtcResult.geo || '—')}
    `;
  } else {
    webrtcContent = `
      ${row('状态', `<span style="color:var(--dim);font-size:12px">检测中…</span>`)}
      ${row('UDP 出口', `<span style="color:var(--dim);font-size:12px">—</span>`)}
      ${row('归属地', `<span style="color:var(--dim);font-size:12px">—</span>`)}
    `;
  }
  const webrtcCard = `<div class="card">
    <div class="card-label" style="margin-bottom:12px">WebRTC UDP 泄露检测</div>
    <div id="webrtc-card-inner">${webrtcContent}</div>
  </div>`;

  // Claude availability card — populated asynchronously by runClaudeCheck().
  // We only emit the loading shell here; the real rows are written by
  // renderClaudeInner() once the probes resolve.
  const claudeCard = `<div class="card">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:6px">
        <span class="card-label" style="margin:0">CLAUDE 可用性检测</span>
      </div>
      <button id="claude-refresh-btn" type="button"
              style="background:none;border:none;color:var(--dim);font-size:12px;cursor:pointer;padding:2px 6px"
              title="重新检测">刷新</button>
    </div>
    <div id="claude-card-inner">
      ${row('claude.ai',          `<span style="color:var(--dim);font-size:12px">检测中…</span>`)}
      ${row('anthropic.com',      `<span style="color:var(--dim);font-size:12px">检测中…</span>`)}
      ${row('Claude 服务状态',    `<span style="color:var(--dim);font-size:12px">检测中…</span>`)}
    </div>
  </div>`;

  return `
    <style>
      .ip-grid2 { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px; }
      @media(max-width:560px){ .ip-grid2 { grid-template-columns:1fr; } }
      .ip-card-full { margin-bottom:8px; }
    </style>

    <!-- Trust Score + Claude 可用性 — 2 columns -->
    <div class="ip-grid2">
      <div class="card" style="text-align:center">
        <div class="card-label" style="margin-bottom:8px">CLAUDE AI 信任评分</div>
        <div style="margin-bottom:4px;display:flex;align-items:center;justify-content:center;gap:10px">
          <span style="font-size:36px;font-weight:800;letter-spacing:-0.04em;color:${restrictedName ? '#dc2626' : lbl.color};line-height:1">${score}</span>
          <span style="background:${restrictedName ? '#fef2f2' : lbl.bg};color:${restrictedName ? '#dc2626' : lbl.color};padding:3px 10px;border-radius:99px;font-size:12px;font-weight:700">${restrictedName ? '不可访问' : lbl.text}</span>
        </div>
        <div style="color:var(--dim);font-size:11px;margin-bottom:10px">${
          restrictedName ? '处于不可访问区域，Claude 会严格风控' :
          score >= 95 ? '该 IP 信誉极好' :
          score >= 80 ? '该 IP 信誉优异' :
          score >= 50 ? '该 IP 存在轻微风险' :
          score >= 25 ? '该 IP 存在一定风险' :
                        '该 IP 风险极高'
        }</div>
        <div style="position:relative;height:8px;border-radius:99px;background:linear-gradient(90deg,#dc2626 0%,#f97316 25%,#eab308 50%,#84cc16 75%,#16a34a 100%);margin-bottom:5px">
          <div style="position:absolute;top:50%;left:${score}%;transform:translate(-50%,-50%);width:14px;height:14px;background:#fff;border:2px solid #0d0d0d;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.2)"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--dim)"><span>0 可疑</span><span>100 可信</span></div>
        ${restrictedName ? `<div style="margin-top:10px;padding:8px 10px;background:#fef2f2;border:1px solid #fee2e2;border-radius:10px;color:#dc2626;font-size:11px;font-weight:600;text-align:left;line-height:1.5">⚠️ 出口 IP 位于<strong>${restrictedName}</strong>，登录 Claude 容易触发封号风控</div>` : ''}
      </div>
      ${claudeCard}
    </div>

    <!-- IP属性 + 安全检测 — 2 columns -->
    <div class="ip-grid2">
      ${card('出口 IP 属性', `
        ${row('IP 地址', `<code style="font-size:12px">${ip.ip || '—'}</code>`)}
        ${row('地区', ip.country ? `${ip.country}${ip.countryCode ? ' (' + ip.countryCode + ')' : ''}` : '—')}
        ${row('城市', ip.city || '—')}
        ${row('ASN', ip.asn || '—')}
        ${row('运营商', ip.isp || ip.org || '—')}
        ${row('IP 类型', `<span style="background:${itBg};color:${itColor};padding:2px 10px;border-radius:99px;font-size:12px;font-weight:600">${ipType}</span>`)}
      `)}
      ${card('安全检测', `
        ${row('VPN',          badge(ip.isVPN  ? '已检测到' : '未检测到', !ip.isVPN))}
        ${row('代理 (Proxy)', badge(ip.proxy && !ip.isVPN && !ip.isTOR ? '已检测到' : '未检测到', !(ip.proxy && !ip.isVPN && !ip.isTOR)))}
        ${row('Tor',          badge(ip.isTOR  ? '已检测到' : '未检测到', !ip.isTOR))}
        ${row('数据中心',     badge(ip.isHosting ? '是' : '否', !ip.isHosting))}
        ${row('机器人 (Crawler)', badge(ip.isCrawler ? '是' : '否', !ip.isCrawler))}
        ${row('滥用记录',     ip.hasAbuse ? badge('有记录', false) : badge('无记录', true))}
      `)}
    </div>

    <!-- DNS泄露 + WebRTC泄露 — 2 columns -->
    <div class="ip-grid2">
      ${dnsCard}
      ${webrtcCard}
    </div>

    <!-- 设备指纹 — full width -->
    ${card('设备指纹信息', `
      ${row('时区',               tzLine)}
      ${row('语言',               langLine)}
      ${row('操作系统 / 浏览器',  dev.osStr)}
      ${row('Cookie',             badge(dev.cookie ? '已启用' : '已禁用', dev.cookie))}
      ${row('WebGL 渲染器',       `<span style="color:var(--dim);font-size:12px;word-break:break-all">${dev.webglRenderer}</span>`)}
      ${row('Canvas 指纹',        `<code style="font-size:12px">${dev.canvasFp}</code>`)}
      ${row('WebGL 指纹',         `<code style="font-size:12px">${dev.webglFp}</code>`)}
    `, 'margin-bottom:10px')}
  `;
}

async function fetchIpData() {
  // Single source: our /api/ip-check endpoint, which itself runs a 3-tier
  // upstream fallback chain (ip-api.com → ipinfo.io → freeipapi.com).
  // We dropped the previous browser-side fallbacks (ipapi.co, ip.sb) because:
  //   - ipapi.co's per-IP daily quota gives little real-world benefit beyond
  //     what the server-side chain already provides
  //   - ip.sb's path-arg form returns 404; only resolves the caller's own IP
  //   - removing them lets us tighten CSP connect-src
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 12000);
    const res  = await fetch('/api/ip-check', { signal: ctrl.signal });
    clearTimeout(tid);
    if (res.ok) return await res.json();
  } catch (_) {}
  return null;
}

// DNS leak detection: fetch Cloudflare trace to identify DNS resolver
async function detectDnsLeak() {
  try {
    const r = await fetch('https://cloudflare-dns.com/dns-query?name=whoami.cloudflare&type=TXT', {
      headers: { 'Accept': 'application/dns-json' }
    });
    if (!r.ok) return { error: true };
    const d = await r.json();
    // The resolver IP is in the edns client subnet or we use the response metadata
    // Fallback: use 1.1.1.1/cdn-cgi/trace for resolver info
    const traceR = await fetch('https://one.one.one.one/cdn-cgi/trace');
    const traceText = await traceR.text();
    const lines = {};
    traceText.split('\n').forEach(l => { const [k, v] = l.split('='); if (k) lines[k] = v; });
    return { ip: lines.ip || '—', loc: lines.loc || '', org: 'Cloudflare' };
  } catch (_) {
    return { error: true };
  }
}

// WebRTC UDP leak detection. Returns { ip, ipv6, done, geo? }.
//
// Why we need TWO STUN servers (Google + Cloudflare):
//   Single-STUN setups silently fail in any environment that blocks the
//   server's UDP path — the browser still emits `host` candidates but those
//   are mDNS-obfuscated as `<UUID>.local` on Chrome/Firefox/Safari, leaving
//   no IPv4 to extract. With two unrelated STUN endpoints, we only fail if
//   BOTH are unreachable.
//
// Why we capture IPv6:
//   On dual-stack or pure-v6 networks the only `srflx` candidate may be v6.
//   The previous IPv4-only regex would silently report "未获取到公网 IP".
//
// Private/CGNAT/special-use ranges are filtered out post-collection rather
// than during ICE callbacks so we still know whether ANY candidates fired
// (helps distinguish "WebRTC disabled" from "only private candidates").
function detectWebrtcLeak() {
  return new Promise(resolve => {
    let pc;
    try {
      pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun.cloudflare.com:3478' },
        ],
      });
    } catch (_) {
      resolve({ ip: null, done: true, geo: '浏览器不支持 WebRTC' });
      return;
    }

    const candidates = new Set();
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      try { pc.close(); } catch (_) {}

      const all = [...candidates];
      // IPv4 public-IP filter — matches the reference site's exclusions:
      //   - 0.0.0.0 / 0.x  (unspecified / "this network")
      //   - 127.x          (loopback)
      //   - 10.x           (RFC1918 private A)
      //   - 172.16–172.31  (RFC1918 private B; we used to exclude all 172/8)
      //   - 192.168.x      (RFC1918 private C)
      //   - 100.64–127.x   (RFC6598 CGNAT)
      //   - 198.18.x / 198.19.x (RFC2544 benchmarking)
      //   - 169.254.x      (link-local)
      const isPrivateV4 = (ip) => {
        if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
        if (ip === '0.0.0.0') return true;
        const [a, b] = ip.split('.').map(Number);
        if (a === 0 || a === 127 || a === 10) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
        if (a === 100 && b >= 64 && b <= 127) return true;
        if (a === 198 && (b === 18 || b === 19)) return true;
        if (a === 169 && b === 254) return true;
        return false;
      };
      const isV6 = (s) => s.includes(':');
      // IPv6 private/local: fc00::/7 (unique-local) + fe80::/10 (link-local)
      const isPrivateV6 = (ip) => /^(fc|fd|fe[89ab])/i.test(ip);

      const pubV4 = all.find(ip => !isV6(ip) && !isPrivateV4(ip));
      const pubV6 = all.find(ip =>  isV6(ip) && !isPrivateV6(ip));

      if (pubV4 || pubV6) {
        resolve({ ip: pubV4 || pubV6, ipv6: !pubV4 && !!pubV6, done: true });
      } else if (all.length === 0) {
        resolve({ ip: null, done: true, geo: 'WebRTC 已禁用或被屏蔽' });
      } else {
        resolve({ ip: null, done: true, geo: '未获取到公网 IP（可能仅 mDNS）' });
      }
    };

    pc.onicecandidate = (e) => {
      if (!e.candidate) { finish(); return; }
      const cand = e.candidate.candidate || '';
      // IPv4: classic 4-octet pattern.
      const m4 = cand.match(/(?:\d{1,3}\.){3}\d{1,3}/g);
      if (m4) m4.forEach(ip => candidates.add(ip));
      // IPv6: at least one '::' or two ':' groups. Restrict to plausible
      // hextets — overly-greedy regexes here can pick up STUN ufrag tokens.
      const m6 = cand.match(/(?:[a-f0-9]{1,4}:){2,7}[a-f0-9]{0,4}/i);
      if (m6) candidates.add(m6[0]);
    };

    try {
      pc.createDataChannel('');
      pc.createOffer().then(o => pc.setLocalDescription(o)).catch(() => finish());
    } catch (_) {
      finish();
      return;
    }
    // Bumped from 5s → 7s. STUN handshake routinely takes 2-3s on mobile;
    // 5s gave too many premature timeouts on slower networks.
    setTimeout(finish, 7000);
  });
}

// Lookup geo for a given IP. Use HTTPS-only sources because the page is
// served over HTTPS (mixed content would block http://ip-api.com).
async function lookupGeo(ip) {
  // 1. ipwho.is — HTTPS, free, 10k/month, returns full country + city
  try {
    const r = await fetch(`https://ipwho.is/${ip}`);
    if (r.ok) {
      const d = await r.json();
      if (d && d.success !== false) {
        return {
          loc: (d.country_code || '').toLowerCase(),
          geo: `${d.country || ''}${d.city ? ' ' + d.city : ''}`.trim(),
        };
      }
    }
  } catch (_) {}
  // 2. freeipapi.com — HTTPS fallback
  try {
    const r = await fetch(`https://free.freeipapi.com/api/json/${ip}`);
    if (r.ok) {
      const d = await r.json();
      return {
        loc: (d.countryCode || '').toLowerCase(),
        geo: `${d.countryName || ''}${d.cityName ? ' ' + d.cityName : ''}`.trim(),
      };
    }
  } catch (_) {}
  return {};
}

// ── Claude availability probes ──────────────────────────────────────────────
//
// We measure two things:
//   1. Browser→origin latency for claude.ai and www.anthropic.com. Uses
//      `fetch(url, { mode: 'no-cors' })` so we don't trip CORS. Opaque
//      responses are fine — we only care about wall-clock RTT. Browsers fire
//      the actual TCP+TLS+HTTP exchange even for opaque fetches, so a 403
//      from Cloudflare bot-management on claude.ai still gives a real RTT.
//   2. Anthropic's official Statuspage indicator from
//      status.claude.com/api/v2/status.json. (status.anthropic.com 302s here
//      anyway, and status.claude.com sets Access-Control-Allow-Origin: *.)
//
// Each probe is bounded by an AbortController timeout so a slow/blocked
// origin can never wedge the card.

async function probeLatency(url) {
  const t0 = performance.now();
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 5000);
    // Cache-buster so retries don't get short-circuited by the disk cache.
    await fetch(url + (url.includes('?') ? '&' : '?') + '_=' + Date.now(), {
      mode:        'no-cors',
      cache:       'no-store',
      credentials: 'omit',     // never leak cookies cross-origin
      redirect:    'follow',
      signal:      ctrl.signal,
    });
    clearTimeout(tid);
    return { ok: true, ms: Math.round(performance.now() - t0) };
  } catch (_) {
    // Network failure / aborted / blocked. ms reflects how long we waited.
    return { ok: false, ms: Math.round(performance.now() - t0) };
  }
}

async function probeClaudeStatus() {
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch('https://status.claude.com/api/v2/status.json', {
      cache: 'no-store',
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    if (!r.ok) return null;
    const d = await r.json();
    return {
      indicator:   d?.status?.indicator   || 'unknown',
      description: d?.status?.description || '',
      updatedAt:   d?.page?.updated_at    || null,
    };
  } catch (_) { return null; }
}

// Latency → user-facing status pill. Tiers chosen so a healthy edge-cached
// hit shows "良好" and a warm-pool 0-RTT QUIC hit (sub-100ms) still reads
// the same — we don't over-segment small numbers.
function latencyStatus(probe) {
  if (!probe.ok)            return { text: '不可达', color: '#dc2626', bg: '#fef2f2' };
  if (probe.ms < 200)       return { text: '良好',   color: '#16a34a', bg: '#f0fdf4' };
  if (probe.ms < 600)       return { text: '正常',   color: '#2563eb', bg: '#eff6ff' };
  if (probe.ms < 1500)      return { text: '较慢',   color: '#ca8a04', bg: '#fefce8' };
  return                           { text: '超时',   color: '#dc2626', bg: '#fef2f2' };
}

// Statuspage indicator → user-facing label + color. Aligns with Statuspage's
// own conventions (none/minor/major/critical/maintenance).
function statusIndicatorLabel(s) {
  if (!s) return { text: '查询失败', color: '#dc2626', bg: '#fef2f2' };
  switch (s.indicator) {
    case 'none':        return { text: '全部服务正常', color: '#16a34a', bg: '#f0fdf4' };
    case 'minor':       return { text: '部分服务异常', color: '#ca8a04', bg: '#fefce8' };
    case 'major':       return { text: '重大故障',     color: '#f7931a', bg: '#fff7ed' };
    case 'critical':    return { text: '全面瘫痪',     color: '#dc2626', bg: '#fef2f2' };
    case 'maintenance': return { text: '维护中',       color: '#2563eb', bg: '#eff6ff' };
    default:            return { text: s.description || '未知状态', color: '#909090', bg: '#f6f6f6' };
  }
}

let _ipData = null, _devData = null;

async function runCheck() {
  const btn = document.getElementById('retry-btn');
  btn.disabled = true;
  btn.textContent = '检测中…';
  document.getElementById('result').innerHTML = `
    <div style="text-align:center;padding:60px 0;color:var(--dim)">
      <div style="font-size:32px;margin-bottom:12px">⏳</div>
      <div style="font-size:14px">正在查询 IP 信息，请稍候…</div>
    </div>`;

  const ip = await fetchIpData();

  if (!ip) {
    document.getElementById('result').innerHTML = `
      <div style="text-align:center;padding:60px 0;color:var(--dim)">
        <div style="font-size:32px;margin-bottom:12px">❌</div>
        <div style="font-size:14px">无法获取 IP 信息，请检查网络后重试</div>
      </div>`;
    btn.disabled = false; btn.textContent = '重新检测';
    return;
  }

  _ipData = ip;
  const dev = getDeviceInfo(ip);
  _devData = dev;

  // Initial render with empty DNS/WebRTC (loading state shown via cards)
  const dnsResult = {};
  const webrtcResult = {};
  document.getElementById('result').innerHTML = render(ip, dev, dnsResult, webrtcResult);

  // Auto-trigger DNS + WebRTC checks (in parallel) right after main render.
  runDnsCheck();
  runWebrtcCheck();
  runClaudeCheck();
  // Bind the in-card refresh button — recreated on every full render, so we
  // (re-)wire it after innerHTML lands. CSP blocks inline onclick.
  document.getElementById('claude-refresh-btn')?.addEventListener('click', runClaudeCheck);

  btn.disabled = false; btn.textContent = '重新检测';
}

async function runDnsCheck() {
  const inner = document.getElementById('dns-card-inner');
  if (inner) inner.innerHTML = `
    ${row('状态', `<span style="color:var(--dim);font-size:12px">检测中…</span>`)}
    ${row('DNS 出口', `<span style="color:var(--dim);font-size:12px">—</span>`)}
    ${row('服务商', `<span style="color:var(--dim);font-size:12px">—</span>`)}
  `;

  const result = await detectDnsLeak();
  if (inner) {
    if (result.error) {
      inner.innerHTML = `${row('状态', badge('检测失败', false))}`;
    } else {
      const leaked = result.ip && _ipData.ip && result.ip !== _ipData.ip;
      inner.innerHTML = `
        ${row('状态', badge(leaked ? '检测到泄露' : '未检测到泄露', !leaked))}
        ${row('DNS 出口', `<code style="font-size:12px">${result.loc ? result.loc + ' ' : ''}${result.ip || '—'}</code>`)}
        ${row('服务商', result.org || '—')}
      `;
    }
  }
}

async function runWebrtcCheck() {
  const inner = document.getElementById('webrtc-card-inner');
  if (inner) inner.innerHTML = `
    ${row('状态', `<span style="color:var(--dim);font-size:12px">检测中…</span>`)}
    ${row('UDP 出口', `<span style="color:var(--dim);font-size:12px">—</span>`)}
    ${row('归属地', `<span style="color:var(--dim);font-size:12px">—</span>`)}
  `;

  const result = await detectWebrtcLeak();
  let geo = result.geo || '';
  let loc = '';
  if (result.ip) {
    const g = await lookupGeo(result.ip);
    geo = g.geo || '查询失败';
    loc = g.loc || '';
  }
  if (inner) {
    const leaked = result.ip && _ipData.ip && result.ip !== _ipData.ip;
    inner.innerHTML = `
      ${row('状态', badge(result.ip ? (leaked ? '检测到泄露' : '未检测到泄露') : '未获取到公网 IP', result.ip ? !leaked : true))}
      ${row('UDP 出口', `<code style="font-size:12px">${loc ? loc + ' ' : ''}${result.ip || '—'}</code>`)}
      ${row('归属地', geo || '—')}
    `;
  }
}

// Render a colored pill (text + bg + fg) — used for Claude availability rows
// where states span more than just green/red and we want richer semantics
// than the generic two-color badge() helper.
function pill(label) {
  return `<span style="background:${label.bg};color:${label.color};padding:2px 10px;border-radius:99px;font-size:12px;font-weight:600">${label.text}</span>`;
}

async function runClaudeCheck() {
  const inner = document.getElementById('claude-card-inner');
  const btn   = document.getElementById('claude-refresh-btn');
  if (!inner) return;

  // Loading state
  if (btn) { btn.disabled = true; btn.textContent = '检测中…'; }
  inner.innerHTML = `
    ${row('claude.ai',       `<span style="color:var(--dim);font-size:12px">检测中…</span>`)}
    ${row('anthropic.com',   `<span style="color:var(--dim);font-size:12px">检测中…</span>`)}
    ${row('Claude 服务状态', `<span style="color:var(--dim);font-size:12px">检测中…</span>`)}
  `;

  // Run all three probes in parallel — bounded by each probe's own timeout.
  const [claudeAi, anthropic, status] = await Promise.all([
    probeLatency('https://claude.ai/'),
    probeLatency('https://www.anthropic.com/'),
    probeClaudeStatus(),
  ]);

  const claudeLbl    = latencyStatus(claudeAi);
  const anthropicLbl = latencyStatus(anthropic);
  const statusLbl    = statusIndicatorLabel(status);

  const msTxt = (p) => p.ok
    ? `<span style="color:var(--dim);font-size:12px;margin-left:8px">${p.ms}ms</span>`
    : `<span style="color:var(--dim);font-size:12px;margin-left:8px">—</span>`;

  // Surface Anthropic's official status string (e.g. "All Systems Operational")
  // beside our localized label so the source of truth stays visible.
  const statusDetail = (status && status.description)
    ? `<span style="color:var(--dim);font-size:11px;margin-left:8px">${status.description}</span>`
    : '';

  inner.innerHTML = `
    ${row('claude.ai',        pill(claudeLbl)    + msTxt(claudeAi))}
    ${row('anthropic.com',    pill(anthropicLbl) + msTxt(anthropic))}
    ${row('Claude 服务状态',  pill(statusLbl)    + statusDetail)}
  `;

  if (btn) { btn.disabled = false; btn.textContent = '刷新'; }
}

// Bind retry button (CSP blocks inline onclick, so we wire it up here).
document.getElementById('retry-btn')?.addEventListener('click', runCheck);

runCheck();
