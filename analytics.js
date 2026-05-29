(function () {
  if (location.pathname === '/admin' || location.pathname === '/admin.html') return;
  var tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
  var payload = JSON.stringify({
    page: location.pathname,
    referrer: document.referrer || '',
    screen: window.screen ? window.screen.width + 'x' + window.screen.height : '',
    viewport: window.innerWidth + 'x' + window.innerHeight,
    timezone: tz,
    language: navigator.language || ''
  });

  if (navigator.sendBeacon) {
    navigator.sendBeacon('/api/visit-log', new Blob([payload], { type: 'application/json' }));
    return;
  }

  fetch('/api/visit-log', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: payload,
    keepalive: true
  }).catch(function () {});
})();
