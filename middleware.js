// Edge 中间件:
//   1. /api/* 速率限制 - 阻止低强度滥用 (每 IP 每分钟 30 次, in-memory)。
//   2. 全站页面访问的服务端兜底统计 - 只记录"爬虫/无 JS"访客。
//      真实用户由 analytics.js beacon 记录(信息更全), 爬虫不跑 JS 会被 beacon
//      漏掉, 这里用 isBot 判断后在后台补记, 因此不会和 beacon 重复计数。
//
// 说明: in-memory Map 每个 Edge 实例独立, 冷启动会重置 - 对个人站够用。

import { createVisitEntry, enrichIp, isBotUa, recordVisit, shouldTrackRequest } from './lib/analytics-store.js';

export const config = {
  // 匹配所有页面与 API, 排除静态资源。
  matcher: ['/((?!assets/|fonts/|data/|.*\\.(?:js|css|png|jpg|jpeg|webp|avif|svg|ico|json|txt|xml|woff2?|ttf|map)$).*)'],
};

const buckets = new Map();
const WINDOW_MS = 60_000;
const MAX_REQS  = 30;
const GC_AT     = 1000; // 超过这么多 IP 就回收一次过期 bucket

// IP 富化结果缓存, 避免同一爬虫反复抓站时狂打 geo 接口。
const ipCache = new Map();
const IP_TTL_MS = 30 * 60_000;

function clientIp(request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0].trim()
      || request.headers.get('x-real-ip')
      || 'anonymous';
}

function rateLimit(ip) {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now > b.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    if (buckets.size > GC_AT) {
      for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
    }
    return null;
  }
  b.count++;
  if (b.count > MAX_REQS) {
    const retryAfter = Math.ceil((b.resetAt - now) / 1000);
    return new Response(JSON.stringify({ error: 'rate limited', retry_after: retryAfter }), {
      status: 429,
      headers: { 'content-type': 'application/json', 'retry-after': String(retryAfter), 'cache-control': 'no-store' },
    });
  }
  return null;
}

async function cachedEnrichIp(ip) {
  const hit = ipCache.get(ip);
  if (hit && hit.exp > Date.now()) return hit.info;
  const info = await enrichIp(ip);
  ipCache.set(ip, { info, exp: Date.now() + IP_TTL_MS });
  if (ipCache.size > 2000) ipCache.clear();
  return info;
}

async function recordBotVisit(request) {
  const entry = createVisitEntry(request);
  const url = new URL(request.url);
  entry.utmSource = url.searchParams.get('utm_source') || '';
  entry.query = url.search.slice(0, 200);
  entry.source = 'server';
  const ipInfo = await cachedEnrichIp(entry.ip);
  if (ipInfo) {
    entry.isp = ipInfo.isp;
    entry.org = ipInfo.org;
    entry.asn = ipInfo.asn;
    entry.isHosting = ipInfo.isHosting;
  }
  await recordVisit(entry);
}

export default function middleware(request, context) {
  const url = new URL(request.url);

  if (url.pathname.startsWith('/api/')) {
    return rateLimit(clientIp(request)) || undefined;
  }

  // 页面请求: 只对爬虫做服务端补记 (真实用户走 beacon, 避免重复)。
  const ua = request.headers.get('user-agent') || '';
  if (isBotUa(ua) && shouldTrackRequest(request)) {
    const task = recordBotVisit(request).catch(() => {});
    if (context && typeof context.waitUntil === 'function') context.waitUntil(task);
  }
  return undefined;
}
