// Edge 中间件:
//   1. /api/* 速率限制 - 优先使用 Upstash 共享计数, 不可用时回退内存。
//   2. 全站页面访问的服务端兜底统计 - 只记录"爬虫/无 JS"访客。
//      真实用户由 analytics.js beacon 记录(信息更全), 爬虫不跑 JS 会被 beacon
//      漏掉, 这里用 isBot 判断后在后台补记, 因此不会和 beacon 重复计数。
//
// 说明: Redis 限流键只含截断后的 SHA-256 摘要并设置短 TTL, 不保存原始 IP。

import {
  createVisitEntry,
  getRedisConfig,
  isBlockedBot,
  isBotUa,
  recordVisit,
  shouldTrackRequest,
} from './lib/analytics-store.js';

export const config = {
  // lib 仍需进入 Serverless/Edge 函数包, 但不能被当作静态源码公开访问。
  matcher: [
    '/lib/:path*',
    '/.github/:path*',
    '/((?!assets/|fonts/|data/|.*\\.(?:js|css|png|jpg|jpeg|webp|avif|svg|ico|json|txt|xml|woff2?|ttf|map)$).*)',
  ],
};

const buckets = new Map();
const API_WINDOW_MS = 60_000;
const ADMIN_LOGIN_WINDOW_MS = 15 * 60_000;
const MAX_REQS = 30;       // /api/ 每 IP 每分钟上限
const MAX_ADMIN_LOGINS = 5;
const MAX_PAGES = 60;      // 页面每 IP 每分钟上限(真人多开标签也够用)
const GC_AT = 1000;        // 超过这么多 IP 就回收一次过期 bucket
const RETIRED_API_PATHS = new Set(['/api/v1/check', '/api/admin-keys']);
const READ_WRITE_API_METHODS = new Map([
  ['/api/visit-log', ['POST']],
  ['/api/admin-login', ['GET', 'POST', 'DELETE']],
]);

function clientIp(request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0].trim()
      || request.headers.get('x-real-ip')
      || 'anonymous';
}

function jsonResponse(status, data, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

function rateLimit(identifier, max = MAX_REQS, prefix = 'api', windowMs = API_WINDOW_MS) {
  const now = Date.now();
  const key = `${prefix}:${identifier}`;
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > GC_AT) {
      for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
    }
    return null;
  }
  b.count++;
  if (b.count > max) {
    const retryAfter = Math.ceil((b.resetAt - now) / 1000);
    return jsonResponse(429, { error: 'rate_limited', retry_after: retryAfter }, {
      'retry-after': String(retryAfter),
    });
  }
  return null;
}

async function hashIp(ip) {
  try {
    const bytes = new TextEncoder().encode(String(ip || 'anonymous'));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest).slice(0, 12))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    // Never fall back to retaining the raw IP.
    return 'unavailable';
  }
}

async function sharedRateLimit(ip, max, prefix, windowMs) {
  const identifier = await hashIp(ip);
  const redis = getRedisConfig();
  if (!redis.ready) return rateLimit(identifier, max, prefix, windowMs);

  const now = Date.now();
  const slot = Math.floor(now / windowMs);
  const key = `ratelimit:v1:${prefix}:${identifier}:${slot}`;
  const ttlSeconds = Math.ceil(windowMs / 1000) + 30;

  try {
    const response = await fetch(`${redis.url}/pipeline`, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${redis.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', key],
        ['EXPIRE', key, ttlSeconds, 'NX'],
      ]),
    });
    if (!response.ok) return rateLimit(identifier, max, prefix, windowMs);

    const results = await response.json();
    const count = Number(results?.[0]?.result);
    if (!Number.isFinite(count)) return rateLimit(identifier, max, prefix, windowMs);
    if (count <= max) return null;

    const retryAfter = Math.max(1, Math.ceil((((slot + 1) * windowMs) - now) / 1000));
    return jsonResponse(429, { error: 'rate_limited', retry_after: retryAfter }, {
      'retry-after': String(retryAfter),
    });
  } catch {
    return rateLimit(identifier, max, prefix, windowMs);
  }
}

function normalizeRoute(pathname) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

function methodNotAllowed(allowed) {
  return jsonResponse(405, { error: 'method_not_allowed' }, {
    'allow': allowed.join(', '),
  });
}

function redirectToCrypto(url, hash) {
  const destination = new URL('/crypto', url);
  destination.hash = hash;
  return new Response(null, {
    status: 308,
    headers: {
      'location': destination.toString(),
      'cache-control': 'public, max-age=86400',
    },
  });
}

function notFound() {
  return new Response('Not Found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// 拦截爬虫: 返回 403, 不缓存。搜索引擎/社交预览已在 isBlockedBot 内放行。
function blockBot() {
  return new Response('Forbidden', {
    status: 403,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function recordBotVisit(request) {
  const entry = createVisitEntry(request);
  entry.source = 'server';
  await recordVisit(entry);
}

export default async function middleware(request, context) {
  const url = new URL(request.url);
  const path = normalizeRoute(url.pathname);
  const ua = request.headers.get('user-agent') || '';
  const ip = clientIp(request);

  if (path === '/lib' || path.startsWith('/lib/') ||
      path === '/.github' || path.startsWith('/.github/')) {
    return notFound();
  }

  if (path === '/btc' || path === '/btc.html') {
    return redirectToCrypto(url, '#btc-heading');
  }
  if (path === '/eth' || path === '/eth.html') {
    return redirectToCrypto(url, '#eth-heading');
  }

  if (path === '/perler' || path === '/perler.html' ||
      path === '/yuepaomoniqi' || path === '/yuepaomoniqi.html' ||
      path === '/parking' || path === '/parking/index.html' ||
      path === '/gg-keeper' || path === '/gg-keeper/index.html' ||
      path === '/giffgaff' ||
      path === '/fish' || path === '/fish.html' ||
      path === '/kingyo' || path === '/kingyo.html') {
    return new Response('Gone', {
      status: 410,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  if (path.startsWith('/api/')) {
    if (RETIRED_API_PATHS.has(path)) {
      return jsonResponse(410, { error: 'gone' });
    }

    const allowed = READ_WRITE_API_METHODS.get(path) || ['GET', 'HEAD'];
    if (!allowed.includes(request.method)) return methodNotAllowed(allowed);

    // 接口: 坏爬虫直接 403, 其余使用共享短期限流。
    if (isBlockedBot(ua)) return blockBot();
    if (path === '/api/admin-login' && request.method === 'POST') {
      return await sharedRateLimit(
        ip,
        MAX_ADMIN_LOGINS,
        'admin-login',
        ADMIN_LOGIN_WINDOW_MS,
      ) || undefined;
    }
    return await sharedRateLimit(ip, MAX_REQS, 'api', API_WINDOW_MS) || undefined;
  }

  // 页面请求: 先拦坏爬虫(放行搜索引擎/社交预览), 再按 IP 限流。
  if (isBlockedBot(ua)) return blockBot();
  const limited = rateLimit(ip, MAX_PAGES, 'page');
  if (limited) return limited;

  // 对放行的搜索引擎/预览爬虫做服务端补记 (真实用户走 beacon, 避免重复)。
  if (isBotUa(ua) && shouldTrackRequest(request)) {
    const task = recordBotVisit(request).catch(() => {});
    if (context && typeof context.waitUntil === 'function') context.waitUntil(task);
  }
  return undefined;
}
