(function () {
  // Remove identifiers created by the previous analytics implementation.
  try { localStorage.removeItem('mehk3y_vid'); } catch (e) {}
  try { sessionStorage.removeItem('mehk3y_sid'); } catch (e) {}

  if (location.pathname === '/admin' || location.pathname === '/admin.html') return;

  // Respect explicit browser privacy signals before doing any analytics work.
  var dnt = navigator.doNotTrack === '1' || window.doNotTrack === '1';
  var gpc = navigator.globalPrivacyControl === true;
  if (dnt || gpc) return;

  function referrerCategory() {
    if (!document.referrer) return '';
    try {
      var url = new URL(document.referrer);
      if (url.origin === location.origin) return '';
      var host = url.hostname.toLowerCase().replace(/^www\./, '');
      var isDomain = function (domain) { return host === domain || host.endsWith('.' + domain); };
      if (/^google\.[a-z.]{2,12}$/.test(host)
          || ['bing.com', 'baidu.com', 'duckduckgo.com', 'yahoo.com', 'yandex.com', 'yandex.ru', 'sogou.com'].some(isDomain)) return 'search';
      if (['x.com', 'twitter.com', 't.co', 'facebook.com', 'instagram.com', 'linkedin.com', 'reddit.com', 'weibo.com', 'zhihu.com'].some(isDomain)) return 'social';
      if (['t.me', 'telegram.org', 'whatsapp.com', 'discord.com', 'slack.com'].some(isDomain)) return 'messaging';
      if (['github.com', 'gitlab.com', 'stackoverflow.com'].some(isDomain)) return 'developer';
      return 'other';
    } catch (e) {
      return '';
    }
  }

  // Aggregate-only, first-party analytics. Deliberately excludes identifiers,
  // URL queries, hardware details, precise location and network telemetry.
  var payload = JSON.stringify({
    page: location.pathname,
    referrer: referrerCategory()
  });

  function send(body) {
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/visit-log', new Blob([body], { type: 'application/json' }));
        return;
      }
    } catch (e) {}
    fetch('/api/visit-log', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body,
      keepalive: true
    }).catch(function () {});
  }

  send(payload);

  // Duration is added only to a site-wide aggregate and cannot be linked to a
  // visitor, session or individual page-view record.
  var start = Date.now();
  var sent = false;
  function reportDuration() {
    if (sent) return;
    sent = true;
    send(JSON.stringify({ type: 'duration', duration: Date.now() - start }));
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') reportDuration();
  });
  window.addEventListener('pagehide', reportDuration);
})();
