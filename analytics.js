(function () {
  if (location.pathname === '/admin' || location.pathname === '/admin.html') return;

  function uid() {
    try {
      if (crypto && crypto.randomUUID) return crypto.randomUUID();
    } catch (e) {}
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  // 访客身份(长期) + 会话身份(本次浏览)
  var vid = '';
  var isReturning = false;
  try {
    vid = localStorage.getItem('mehk3y_vid') || '';
    if (vid) { isReturning = true; } else { vid = uid(); localStorage.setItem('mehk3y_vid', vid); }
  } catch (e) { vid = uid(); }

  var sid = '';
  var sessionStart = false;
  try {
    sid = sessionStorage.getItem('mehk3y_sid') || '';
    if (!sid) { sid = uid(); sessionStorage.setItem('mehk3y_sid', sid); sessionStart = true; }
  } catch (e) { sid = uid(); sessionStart = true; }

  function val(fn, dflt) { try { return fn(); } catch (e) { return dflt; } }

  var tz = val(function () { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }, '');
  var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};
  var params = new URLSearchParams(location.search);

  var payload = JSON.stringify({
    page: location.pathname,
    referrer: document.referrer || '',
    language: navigator.language || '',
    timezone: tz,
    // 屏幕 / 设备硬件
    screen: window.screen ? window.screen.width + 'x' + window.screen.height : '',
    viewport: window.innerWidth + 'x' + window.innerHeight,
    pixelRatio: window.devicePixelRatio || 1,
    colorDepth: window.screen ? window.screen.colorDepth : 0,
    cpuCores: navigator.hardwareConcurrency || 0,
    deviceMemory: navigator.deviceMemory || 0,
    touch: (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window,
    netType: conn.effectiveType || '',
    netDownlink: conn.downlink || 0,
    // 访客 / 会话
    vid: vid,
    sid: sid,
    isReturning: isReturning,
    sessionStart: sessionStart,
    // 来源渠道
    utmSource: params.get('utm_source') || '',
    utmMedium: params.get('utm_medium') || '',
    utmCampaign: params.get('utm_campaign') || ''
  });

  function send(path, body) {
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(path, new Blob([body], { type: 'application/json' }));
        return;
      }
    } catch (e) {}
    fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
  }

  send('/api/visit-log', payload);

  // 停留时长: 页面离开时上报本页停留毫秒数
  var start = Date.now();
  var sent = false;
  function reportDuration() {
    if (sent) return;
    sent = true;
    send('/api/visit-log', JSON.stringify({ type: 'duration', sid: sid, page: location.pathname, duration: Date.now() - start }));
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') reportDuration(); });
  window.addEventListener('pagehide', reportDuration);
})();
