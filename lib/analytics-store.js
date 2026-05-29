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
    latitude: truncate(request.headers.get('x-vercel-ip-latitude'), 24),
    longitude: truncate(request.headers.get('x-vercel-ip-longitude'), 24),
    postal: truncate(request.headers.get('x-vercel-ip-postal-code'), 24),
  };
}

const HOSTING_RE = /amazon|aws|google|cloud|azure|microsoft|ovh|hetzner|digitalocean|linode|vultr|hosting|datacenter|data center|server|alibaba|tencent|huawei|oracle|leaseweb|contabo|m247|colo/i;

// 调用 freeipapi 富化 IP: 运营商(ASN org)、ASN、是否代理/VPN、经纬度。
// 选 freeipapi 是因为它支持服务端调用且自带 isProxy 标记。
// 尽力而为: 1.5s 超时, 失败就返回空, 绝不阻塞访问记录。
export async function enrichIp(ip) {
  if (!ip || ip === 'unknown' || /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc|fd)/i.test(ip)) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`https://free.freeipapi.com/api/json/${encodeURIComponent(ip)}`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.ipAddress) return null;
    const org = data.asnOrganization || '';
    return {
      isp: truncate(org, 80),
      org: truncate(org, 80),
      asn: data.asn ? `AS${data.asn}` : '',
      isHosting: Boolean(data.isProxy) || HOSTING_RE.test(org),
    };
  } catch {
    return null;
  }
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

  const commands = [
    ['ZINCRBY', 'analytics:pages', 1, entry.page],
    ['ZINCRBY', `analytics:pages:${day}`, 1, entry.page],
    ['ZINCRBY', 'analytics:devices', 1, mobileKey],
    ['ZINCRBY', 'analytics:agents', 1, botKey],
    ['ZINCRBY', 'analytics:os', 1, entry.os || 'Unknown'],
    ['ZINCRBY', 'analytics:browsers', 1, entry.browser || 'Other'],
    ['ZINCRBY', 'analytics:countries', 1, entry.country || 'Unknown'],
    ['INCR', 'analytics:pageviews:total'],
    ['PFADD', 'analytics:unique:ips', entry.ip],
    ['PFADD', `analytics:unique:ips:${day}`, entry.ip],
    ['LPUSH', 'analytics:events', eventJson],
    ['LTRIM', 'analytics:events', 0, MAX_EVENTS - 1],
  ];

  if (entry.vid) commands.push(['PFADD', 'analytics:unique:visitors', entry.vid]);
  if (entry.sid) commands.push(['PFADD', 'analytics:unique:sessions', entry.sid]);
  if (entry.sessionStart) commands.push(['ZINCRBY', 'analytics:visitor-type', 1, entry.isReturning ? 'returning' : 'new']);
  if (entry.isp) commands.push(['ZINCRBY', 'analytics:isp', 1, entry.isp]);
  if (entry.isHosting) commands.push(['ZINCRBY', 'analytics:network-kind', 1, 'hosting/vpn']);
  else if (entry.isp) commands.push(['ZINCRBY', 'analytics:network-kind', 1, 'residential/mobile']);
  if (entry.utmSource) commands.push(['ZINCRBY', 'analytics:sources', 1, entry.utmSource]);

  return redisPipeline(commands);
}

// type=duration 上报: 累加总停留时长与计数, 用于算平均停留。
export async function recordDuration(ms) {
  const value = Math.max(0, Math.min(Number(ms) || 0, 30 * 60 * 1000)); // 上限 30 分钟, 防异常值
  if (!value) return { ok: false };
  return redisPipeline([
    ['INCRBY', 'analytics:duration:total', value],
    ['INCR', 'analytics:duration:count'],
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
  if (!cfg.ready) return { configured: false, pages: [], devices: [], agents: [], os: [], browsers: [], countries: [], isp: [], networkKind: [], visitorType: [], sources: [], events: [], uniqueIps: 0 };

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
    ['ZREVRANGE', 'analytics:isp', 0, 20, 'WITHSCORES'],
    ['ZREVRANGE', 'analytics:network-kind', 0, 10, 'WITHSCORES'],
    ['ZREVRANGE', 'analytics:visitor-type', 0, 10, 'WITHSCORES'],
    ['ZREVRANGE', 'analytics:sources', 0, 20, 'WITHSCORES'],
    ['PFCOUNT', 'analytics:unique:visitors'],
    ['PFCOUNT', 'analytics:unique:sessions'],
    ['GET', 'analytics:pageviews:total'],
    ['GET', 'analytics:duration:total'],
    ['GET', 'analytics:duration:count'],
    ['LRANGE', 'analytics:events', 0, Math.max(0, Math.min(limit, 1000) - 1)],
  ]);

  if (!res.ok) return { configured: true, error: res.error || `redis_status_${res.status || 'unknown'}` };

  const values = res.results.map((item) => item?.result);
  const events = (values[18] || []).map(safeJson).filter(Boolean);
  const durationTotal = Number(values[16] || 0);
  const durationCount = Number(values[17] || 0);
  const uniqueSessions = Number(values[14] || 0);
  const pageviewsTotal = Number(values[15] || 0);
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
    isp: zsetPairs(values[9]),
    networkKind: zsetPairs(values[10]),
    visitorType: zsetPairs(values[11]),
    sources: zsetPairs(values[12]),
    uniqueVisitors: Number(values[13] || 0),
    uniqueSessions,
    pageviewsTotal,
    avgDurationMs: durationCount ? Math.round(durationTotal / durationCount) : 0,
    avgPagesPerSession: uniqueSessions ? Math.round((pageviewsTotal / uniqueSessions) * 10) / 10 : 0,
    events,
  };
}
