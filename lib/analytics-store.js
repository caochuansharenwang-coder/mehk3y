const ANALYTICS_PREFIX = 'analytics:privacy-v2';
const DAILY_TTL_SECONDS = 120 * 24 * 60 * 60;
const ANALYTICS_PAGES = new Set(['/', '/crypto', '/ip', '/privacy']);
const MIGRATION_KEY = `${ANALYTICS_PREFIX}:migration:20260716-cleanup-v1`;
const AUDIT_TEST_PAGE = '/totally-spoofed-audit-path';
const AUDIT_TEST_DAY = '2026-07-16';
let migrationPromise;

export function getRedisConfig() {
  const url = (typeof process !== 'undefined' && (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL)) || '';
  const token = (typeof process !== 'undefined' && (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN)) || '';
  return { url: url.replace(/\/$/, ''), token, ready: Boolean(url && token) };
}

// Used only by request security/rate-limiting code. Analytics never persists it.
export function getClientIp(request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || request.headers.get('cf-connecting-ip')
      || 'unknown';
}

export function isMobileUa(userAgent = '') {
  return /android|iphone|ipad|ipod|mobile|windows phone|harmonyos/i.test(userAgent);
}

export function isBotUa(userAgent = '') {
  return /bot|crawl|spider|slurp|facebookexternalhit|bingpreview|yandex|baidu|duckduck|semrush|ahref|mj12|dotbot|petalbot|bytespider|gptbot|claudebot/i.test(userAgent);
}

// Search crawlers and social link previews that are useful to visitors.
const ALLOWED_BOT_RE = /googlebot|google-inspectiontool|storebot-google|google-site-verification|mediapartners-google|bingbot|bingpreview|adidxbot|msnbot|slurp|duckduckbot|baiduspider|yandex|applebot|sogou|360spider|haosou|oai-searchbot|chatgpt-user|facebookexternalhit|facebookcatalog|twitterbot|telegrambot|whatsapp|linkedinbot|slackbot|discordbot|pinterest|skypeuripreview|vercel|uptimerobot/i;

// AI training crawlers, SEO scrapers and common scripted scraping clients.
const BLOCKED_BOT_RE = /gptbot|claude-?bot|claude-web|anthropic-ai|cohere-ai|ccbot|google-extended|perplexitybot|youbot|amazonbot|bytespider|imagesiftbot|diffbot|omgili|webzio|semrushbot|ahrefsbot|mj12bot|dotbot|blexbot|dataforseo|seekport|serpstatbot|megaindex|barkrowler|zoominfobot|petalbot|bytedance|magpie-crawler|scrapy|python-requests|python-urllib|aiohttp|go-http-client|node-fetch|axios|got \(|curl\/|wget|libwww-perl|java\/|jakarta|okhttp|httpclient|headlesschrome|phantomjs|puppeteer|playwright/i;

export function isAllowedBot(userAgent = '') {
  return ALLOWED_BOT_RE.test(userAgent);
}

export function isBlockedBot(userAgent = '') {
  const ua = String(userAgent || '').trim();
  if (!ua) return true;
  if (isAllowedBot(ua)) return false;
  return BLOCKED_BOT_RE.test(ua) || isBotUa(ua);
}

// Only broad families are retained; versions are intentionally discarded.
export function parseOs(ua = '') {
  if (/windows/i.test(ua)) return 'Windows';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if (/mac os x|macintosh/i.test(ua)) return 'macOS';
  if (/harmonyos/i.test(ua)) return 'HarmonyOS';
  if (/android/i.test(ua)) return 'Android';
  if (/cros/i.test(ua)) return 'ChromeOS';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Unknown';
}

export function parseBrowser(ua = '') {
  if (/edg\//i.test(ua)) return 'Edge';
  if (/opr\/|opera/i.test(ua)) return 'Opera';
  if (/micromessenger/i.test(ua)) return 'WeChat';
  if (/firefox\//i.test(ua)) return 'Firefox';
  if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) return 'Chrome';
  if (/safari\//i.test(ua) && !/chrome/i.test(ua)) return 'Safari';
  return 'Other';
}

export function parseDeviceType(ua = '') {
  if (/ipad|tablet/i.test(ua)) return 'tablet';
  if (isMobileUa(ua)) return 'mobile';
  return 'desktop';
}

export function truncate(value, max = 180) {
  return String(value || '').slice(0, max);
}

export function normalizePage(value) {
  let pathname = String(value || '/').split(/[?#]/, 1)[0];
  try {
    if (/^https?:\/\//i.test(pathname)) pathname = new URL(pathname).pathname;
  } catch {
    pathname = '/';
  }
  if (!pathname.startsWith('/')) return '/';
  pathname = pathname.replace(/\/{2,}/g, '/').slice(0, 80);
  if (pathname === '/') return '/';
  return pathname.replace(/\/$/, '') || '/';
}

export function isAnalyticsPage(value) {
  return ANALYTICS_PAGES.has(normalizePage(value));
}

export function sanitizeReferrer(value, ownUrl = 'https://mehk3y.com/') {
  if (!value) return '';
  const known = new Set(['search', 'social', 'messaging', 'developer', 'other']);
  const raw = String(value).trim().toLowerCase();
  if (known.has(raw)) return raw;
  try {
    const referrer = new URL(raw);
    const own = new URL(ownUrl);
    if (!['http:', 'https:'].includes(referrer.protocol) || referrer.origin === own.origin) return '';
    const host = referrer.hostname.replace(/^www\./, '');
    const isDomain = (domain) => host === domain || host.endsWith(`.${domain}`);
    if (/^google\.[a-z.]{2,12}$/.test(host)
        || ['bing.com', 'baidu.com', 'duckduckgo.com', 'yahoo.com', 'yandex.com', 'yandex.ru', 'sogou.com'].some(isDomain)) return 'search';
    if (['x.com', 'twitter.com', 't.co', 'facebook.com', 'instagram.com', 'linkedin.com', 'reddit.com', 'weibo.com', 'zhihu.com'].some(isDomain)) return 'social';
    if (['t.me', 'telegram.org', 'whatsapp.com', 'discord.com', 'slack.com'].some(isDomain)) return 'messaging';
    if (['github.com', 'gitlab.com', 'stackoverflow.com'].some(isDomain)) return 'developer';
    return 'other';
  } catch {
    return '';
  }
}

export function createVisitEntry(request) {
  const url = new URL(request.url);
  const ua = request.headers.get('user-agent') || '';
  const deviceType = parseDeviceType(ua);
  return {
    ts: new Date().toISOString(),
    page: normalizePage(url.pathname),
    referrer: sanitizeReferrer(request.headers.get('referer'), request.url),
    isMobile: deviceType === 'mobile',
    isBot: isBotUa(ua),
    os: parseOs(ua),
    browser: parseBrowser(ua),
    deviceType,
    country: truncate(request.headers.get('x-vercel-ip-country'), 2).toUpperCase(),
  };
}

export function shouldTrackRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!['GET', 'HEAD'].includes(request.method)) return false;
  if (!isAnalyticsPage(path)) return false;
  if (path.startsWith('/api/') || path.startsWith('/assets/') || path.startsWith('/fonts/') || path.startsWith('/data/')) return false;
  if (path.startsWith('/tools/') || path.startsWith('/admin') || path === '/admin.html') return false;
  if (/\.(?:js|css|png|jpg|jpeg|webp|avif|svg|ico|json|txt|xml|woff2?|ttf|map)$/i.test(path)) return false;
  const accept = request.headers.get('accept') || '';
  return !accept || accept.includes('text/html') || accept.includes('*/*');
}

async function redisPipeline(commands) {
  const cfg = getRedisConfig();
  if (!cfg.ready) return { ok: false, missing: true, results: [] };

  try {
    const response = await fetch(`${cfg.url}/pipeline`, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${cfg.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(commands),
    });
    if (!response.ok) return { ok: false, status: response.status, results: [] };
    const results = await response.json();
    return { ok: true, results };
  } catch (error) {
    return { ok: false, error: String(error), results: [] };
  }
}

async function runAnalyticsMigrations() {
  const claimed = await redisPipeline([
    ['SET', MIGRATION_KEY, 'running', 'NX', 'EX', 300],
  ]);
  if (!claimed.ok || claimed.results[0]?.result !== 'OK') return;

  try {
    // Remove all pre-privacy-v2 analytics keys, including dynamically named
    // visitor, session, IP and daily keys. Current aggregate keys are kept.
    let cursor = '0';
    const legacyKeys = new Set();
    do {
      const scan = await redisPipeline([
        ['SCAN', cursor, 'MATCH', 'analytics:*', 'COUNT', 500],
      ]);
      if (!scan.ok) throw new Error('legacy_scan_failed');
      const result = scan.results[0]?.result || ['0', []];
      cursor = String(result[0] || '0');
      for (const key of result[1] || []) {
        if (!String(key).startsWith(`${ANALYTICS_PREFIX}:`)) legacyKeys.add(String(key));
      }
    } while (cursor !== '0');
    const pendingLegacyKeys = [...legacyKeys];
    for (let index = 0; index < pendingLegacyKeys.length; index += 100) {
      const removed = await redisPipeline([
        ['DEL', ...pendingLegacyKeys.slice(index, index + 100)],
      ]);
      if (!removed.ok) throw new Error('legacy_delete_failed');
    }

    // Remove the single harmless audit PV that was created while proving the
    // old endpoint accepted forged paths. Correct totals only when that member
    // is still present, so this remains idempotent.
    const audit = await redisPipeline([
      ['ZSCORE', `${ANALYTICS_PREFIX}:pages`, AUDIT_TEST_PAGE],
      ['ZSCORE', `${ANALYTICS_PREFIX}:pages:${AUDIT_TEST_DAY}`, AUDIT_TEST_PAGE],
      ['HGET', `${ANALYTICS_PREFIX}:daily`, AUDIT_TEST_DAY],
      ['GET', `${ANALYTICS_PREFIX}:daily:${AUDIT_TEST_DAY}`],
    ]);
    if (!audit.ok) throw new Error('audit_lookup_failed');
    const overallCount = Math.max(0, Math.floor(Number(audit.results[0]?.result || 0)));
    const dailyCount = Math.max(0, Math.floor(Number(audit.results[1]?.result || 0)));
    const legacyDailyCount = Math.min(
      dailyCount,
      Math.max(0, Math.floor(Number(audit.results[2]?.result || 0)))
    );
    const currentDailyCount = Math.min(
      dailyCount,
      Math.max(0, Math.floor(Number(audit.results[3]?.result || 0)))
    );
    const cleanup = [
      ['ZREM', `${ANALYTICS_PREFIX}:pages`, AUDIT_TEST_PAGE],
      ['ZREM', `${ANALYTICS_PREFIX}:pages:${AUDIT_TEST_DAY}`, AUDIT_TEST_PAGE],
    ];
    if (overallCount) cleanup.push(['DECRBY', `${ANALYTICS_PREFIX}:pageviews:total`, overallCount]);
    if (legacyDailyCount) cleanup.push(['HINCRBY', `${ANALYTICS_PREFIX}:daily`, AUDIT_TEST_DAY, -legacyDailyCount]);
    if (currentDailyCount) cleanup.push(['DECRBY', `${ANALYTICS_PREFIX}:daily:${AUDIT_TEST_DAY}`, currentDailyCount]);
    const cleaned = await redisPipeline(cleanup);
    if (!cleaned.ok) throw new Error('audit_cleanup_failed');

    const finished = await redisPipeline([['SET', MIGRATION_KEY, 'done']]);
    if (!finished.ok) throw new Error('migration_marker_failed');
  } catch {
    // Release the short-lived claim so a later request can safely retry.
    await redisPipeline([['DEL', MIGRATION_KEY]]);
  }
}

export function ensureAnalyticsMigrations() {
  if (!migrationPromise) {
    migrationPromise = runAnalyticsMigrations().finally(() => {
      migrationPromise = null;
    });
  }
  return migrationPromise;
}

// Aggregate counters only: no event log, IP, visitor/session identifier or
// per-person trail is written to Redis.
export async function recordVisit(entry) {
  await ensureAnalyticsMigrations();
  const day = entry.ts.slice(0, 10);
  if (!isAnalyticsPage(entry.page)) return { ok: false, ignored: true };
  const device = entry.deviceType || (entry.isMobile ? 'mobile' : 'desktop');
  const dailyPageKey = `${ANALYTICS_PREFIX}:pages:${day}`;
  const dailyTrendKey = `${ANALYTICS_PREFIX}:daily:${day}`;
  const commands = [
    ['ZINCRBY', `${ANALYTICS_PREFIX}:pages`, 1, normalizePage(entry.page)],
    ['ZINCRBY', dailyPageKey, 1, normalizePage(entry.page)],
    ['EXPIRE', dailyPageKey, DAILY_TTL_SECONDS, 'NX'],
    ['ZINCRBY', `${ANALYTICS_PREFIX}:devices`, 1, device],
    ['ZINCRBY', `${ANALYTICS_PREFIX}:agents`, 1, entry.isBot ? 'bot' : 'human'],
    ['ZINCRBY', `${ANALYTICS_PREFIX}:os`, 1, entry.os || 'Unknown'],
    ['ZINCRBY', `${ANALYTICS_PREFIX}:browsers`, 1, entry.browser || 'Other'],
    ['ZINCRBY', `${ANALYTICS_PREFIX}:countries`, 1, entry.country || 'Unknown'],
    ['ZINCRBY', `${ANALYTICS_PREFIX}:sources`, 1, entry.referrer || 'direct'],
    ['INCR', `${ANALYTICS_PREFIX}:pageviews:total`],
    ['INCR', dailyTrendKey],
    ['EXPIRE', dailyTrendKey, DAILY_TTL_SECONDS, 'NX'],
    // Keep legacy trend data readable during migration, then retire it.
    ['EXPIRE', `${ANALYTICS_PREFIX}:daily`, DAILY_TTL_SECONDS, 'NX'],
  ];
  return redisPipeline(commands);
}

export async function readTrend(days = 90) {
  const cfg = getRedisConfig();
  if (!cfg.ready) return [];
  const list = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    list.push(new Date(now - i * 86400000).toISOString().slice(0, 10));
  }
  const res = await redisPipeline([
    ['MGET', ...list.map((day) => `${ANALYTICS_PREFIX}:daily:${day}`)],
    // Read the old hash as a fallback until its historical window ages out.
    ['HMGET', `${ANALYTICS_PREFIX}:daily`, ...list],
  ]);
  if (!res.ok) return [];
  const visits = res.results[0]?.result || [];
  const legacyVisits = res.results[1]?.result || [];
  return list.map((day, index) => ({
    day,
    visits: Number(visits[index] ?? legacyVisits[index] ?? 0),
    uniqueIps: 0,
  }));
}

// Legacy API compatibility. Individual IP trails are intentionally disabled.
export async function readIpTrail() {
  return [];
}

export async function recordDuration(ms) {
  const value = Math.max(0, Math.min(Number(ms) || 0, 30 * 60 * 1000));
  if (!value) return { ok: false };
  return redisPipeline([
    ['INCRBY', `${ANALYTICS_PREFIX}:duration:total`, value],
    ['INCR', `${ANALYTICS_PREFIX}:duration:count`],
  ]);
}

function zsetPairs(values = []) {
  const rows = [];
  for (let i = 0; i < values.length; i += 2) {
    rows.push({ key: values[i], count: Number(values[i + 1] || 0) });
  }
  return rows;
}

function emptyAnalytics(configured) {
  return {
    configured,
    pages: [],
    todayPages: [],
    devices: [],
    agents: [],
    os: [],
    browsers: [],
    countries: [],
    isp: [],
    networkKind: [],
    visitorType: [],
    sources: [],
    events: [],
    topIps: [],
    uniqueIps: 0,
    todayUniqueIps: 0,
    uniqueVisitors: 0,
    uniqueSessions: 0,
    pageviewsTotal: 0,
    avgDurationMs: 0,
    avgPagesPerSession: 0,
  };
}

export async function readAnalytics() {
  await ensureAnalyticsMigrations();
  const cfg = getRedisConfig();
  if (!cfg.ready) return emptyAnalytics(false);

  const today = new Date().toISOString().slice(0, 10);
  const res = await redisPipeline([
    ['ZREVRANGE', `${ANALYTICS_PREFIX}:pages`, 0, 99, 'WITHSCORES'],
    ['ZREVRANGE', `${ANALYTICS_PREFIX}:pages:${today}`, 0, 99, 'WITHSCORES'],
    ['ZREVRANGE', `${ANALYTICS_PREFIX}:devices`, 0, 10, 'WITHSCORES'],
    ['ZREVRANGE', `${ANALYTICS_PREFIX}:agents`, 0, 10, 'WITHSCORES'],
    ['ZREVRANGE', `${ANALYTICS_PREFIX}:os`, 0, 20, 'WITHSCORES'],
    ['ZREVRANGE', `${ANALYTICS_PREFIX}:browsers`, 0, 20, 'WITHSCORES'],
    ['ZREVRANGE', `${ANALYTICS_PREFIX}:countries`, 0, 30, 'WITHSCORES'],
    ['ZREVRANGE', `${ANALYTICS_PREFIX}:sources`, 0, 20, 'WITHSCORES'],
    ['GET', `${ANALYTICS_PREFIX}:pageviews:total`],
    ['GET', `${ANALYTICS_PREFIX}:duration:total`],
    ['GET', `${ANALYTICS_PREFIX}:duration:count`],
  ]);

  if (!res.ok) return { ...emptyAnalytics(true), error: res.error || `redis_status_${res.status || 'unknown'}` };

  const values = res.results.map((item) => item?.result);
  const durationTotal = Number(values[9] || 0);
  const durationCount = Number(values[10] || 0);
  return {
    ...emptyAnalytics(true),
    pages: zsetPairs(values[0]),
    todayPages: zsetPairs(values[1]),
    devices: zsetPairs(values[2]),
    agents: zsetPairs(values[3]),
    os: zsetPairs(values[4]),
    browsers: zsetPairs(values[5]),
    countries: zsetPairs(values[6]),
    sources: zsetPairs(values[7]),
    pageviewsTotal: Number(values[8] || 0),
    avgDurationMs: durationCount ? Math.round(durationTotal / durationCount) : 0,
  };
}
