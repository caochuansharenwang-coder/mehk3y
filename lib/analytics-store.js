const MAX_EVENTS = 5000;

export function getRedisConfig() {
  const url = (typeof process !== 'undefined' && (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL)) || '';
  const token = (typeof process !== 'undefined' && (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN)) || '';
  return { url: url.replace(/\/$/, ''), token, ready: Boolean(url && token) };
}

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

export function parseOs(ua = '') {
  if (/windows nt 10/i.test(ua)) return 'Windows 10/11';
  if (/windows nt/i.test(ua)) return 'Windows';
  if (/iphone|ipad|ipod/i.test(ua)) {
    const m = ua.match(/os (\d+)[._](\d+)/i);
    return m ? `iOS ${m[1]}.${m[2]}` : 'iOS';
  }
  if (/mac os x/i.test(ua)) {
    const m = ua.match(/mac os x (\d+)[._](\d+)/i);
    return m ? `macOS ${m[1]}.${m[2]}` : 'macOS';
  }
  if (/harmonyos/i.test(ua)) return 'HarmonyOS';
  if (/android/i.test(ua)) {
    const m = ua.match(/android (\d+(?:\.\d+)?)/i);
    return m ? `Android ${m[1]}` : 'Android';
  }
  if (/linux/i.test(ua)) return 'Linux';
  if (/cros/i.test(ua)) return 'ChromeOS';
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

export function createVisitEntry(request) {
  const url = new URL(request.url);
  const ua = request.headers.get('user-agent') || '';
  return {
    ts: new Date().toISOString(),
    ip: getClientIp(request),
    page: normalizePage(url.pathname),
    method: request.method,
    referrer: truncate(request.headers.get('referer'), 220),
    userAgent: truncate(ua, 300),
    isMobile: isMobileUa(ua),
    isBot: isBotUa(ua),
    os: parseOs(ua),
    browser: parseBrowser(ua),
    deviceType: parseDeviceType(ua),
    language: truncate(request.headers.get('accept-language'), 140),
    country: truncate(request.headers.get('x-vercel-ip-country'), 40),
    region: truncate(request.headers.get('x-vercel-ip-country-region'), 80),
    city: truncate(request.headers.get('x-vercel-ip-city'), 120),
  };
}

export function normalizePage(pathname) {
  if (!pathname || pathname === '/') return '/';
  return pathname.replace(/\/$/, '') || '/';
}

export function shouldTrackRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!['GET', 'HEAD'].includes(request.method)) return false;
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

export async function recordVisit(entry) {
  const day = entry.ts.slice(0, 10);
  const mobileKey = entry.isMobile ? 'mobile' : 'desktop';
  const botKey = entry.isBot ? 'bot' : 'human';
  const eventJson = JSON.stringify(entry);

  return redisPipeline([
    ['ZINCRBY', 'analytics:pages', 1, entry.page],
    ['ZINCRBY', `analytics:pages:${day}`, 1, entry.page],
    ['ZINCRBY', 'analytics:devices', 1, mobileKey],
    ['ZINCRBY', 'analytics:agents', 1, botKey],
    ['ZINCRBY', 'analytics:os', 1, entry.os || 'Unknown'],
    ['ZINCRBY', 'analytics:browsers', 1, entry.browser || 'Other'],
    ['ZINCRBY', 'analytics:countries', 1, entry.country || 'Unknown'],
    ['PFADD', 'analytics:unique:ips', entry.ip],
    ['PFADD', `analytics:unique:ips:${day}`, entry.ip],
    ['LPUSH', 'analytics:events', eventJson],
    ['LTRIM', 'analytics:events', 0, MAX_EVENTS - 1],
  ]);
}

function zsetPairs(values = []) {
  const rows = [];
  for (let i = 0; i < values.length; i += 2) {
    rows.push({ key: values[i], count: Number(values[i + 1] || 0) });
  }
  return rows;
}

function safeJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}

export async function readAnalytics(limit = 300) {
  const cfg = getRedisConfig();
  if (!cfg.ready) return { configured: false, pages: [], devices: [], agents: [], os: [], browsers: [], countries: [], events: [], uniqueIps: 0 };

  const today = new Date().toISOString().slice(0, 10);
  const res = await redisPipeline([
    ['ZREVRANGE', 'analytics:pages', 0, 99, 'WITHSCORES'],
    ['ZREVRANGE', `analytics:pages:${today}`, 0, 99, 'WITHSCORES'],
    ['ZREVRANGE', 'analytics:devices', 0, 10, 'WITHSCORES'],
    ['ZREVRANGE', 'analytics:agents', 0, 10, 'WITHSCORES'],
    ['ZREVRANGE', 'analytics:os', 0, 20, 'WITHSCORES'],
    ['ZREVRANGE', 'analytics:browsers', 0, 20, 'WITHSCORES'],
    ['ZREVRANGE', 'analytics:countries', 0, 30, 'WITHSCORES'],
    ['PFCOUNT', 'analytics:unique:ips'],
    ['PFCOUNT', `analytics:unique:ips:${today}`],
    ['LRANGE', 'analytics:events', 0, Math.max(0, Math.min(limit, 1000) - 1)],
  ]);

  if (!res.ok) return { configured: true, error: res.error || `redis_status_${res.status || 'unknown'}` };

  const values = res.results.map((item) => item?.result);
  const events = (values[9] || []).map(safeJson).filter(Boolean);
  return {
    configured: true,
    pages: zsetPairs(values[0]),
    todayPages: zsetPairs(values[1]),
    devices: zsetPairs(values[2]),
    agents: zsetPairs(values[3]),
    os: zsetPairs(values[4]),
    browsers: zsetPairs(values[5]),
    countries: zsetPairs(values[6]),
    uniqueIps: Number(values[7] || 0),
    todayUniqueIps: Number(values[8] || 0),
    events,
  };
}
