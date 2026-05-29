// 速率限制 - 阻止低强度滥用 /api/* 端点。
//
// 实现说明:
//   - 走 Edge Runtime, in-memory Map 按 IP 计数
//   - 每个 Edge 实例独立, 多实例 / 冷启动会重置 - 这是缺陷, 但对个人站够用
//   - 真要严格 / 跨实例限流换 Upstash Redis 或 Vercel KV
//
// 阈值: 每 IP 每分钟 30 次。普通用户用任何工具都到不了, 爬虫一上来就被拦。

export const config = {
  matcher: ['/api/(.*)'],
};

const buckets = new Map();
const WINDOW_MS = 60_000;
const MAX_REQS  = 30;
const GC_AT     = 1000; // 超过这么多 IP 就回收一次过期 bucket

export default function middleware(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim()
          || request.headers.get('x-real-ip')
          || 'anonymous';

  const now = Date.now();
  const b = buckets.get(ip);

  if (!b || now > b.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    if (buckets.size > GC_AT) {
      for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
    }
    return;
  }

  b.count++;
  if (b.count > MAX_REQS) {
    const retryAfter = Math.ceil((b.resetAt - now) / 1000);
    return new Response(
      JSON.stringify({ error: 'rate limited', retry_after: retryAfter }),
      {
        status: 429,
        headers: {
          'content-type':  'application/json',
          'retry-after':   String(retryAfter),
          'cache-control': 'no-store',
        },
      }
    );
  }
}
