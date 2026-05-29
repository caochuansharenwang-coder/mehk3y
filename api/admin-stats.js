import { isAuthenticated } from '../lib/admin-auth.js';
import { getRedisConfig, readAnalytics } from '../lib/analytics-store.js';

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(data));
}

function toWebRequest(req) {
  const host = req.headers.host || 'mehk3y.com';
  return new Request(`https://${host}${req.url || '/api/admin-stats'}`, {
    method: req.method,
    headers: req.headers,
  });
}

export default async function handler(req, res) {
  const request = toWebRequest(req);

  if (!(await isAuthenticated(request))) {
    return json(res, 401, { ok: false, error: 'unauthorized' });
  }

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit') || 300);
  const stats = await readAnalytics(limit);
  const redis = getRedisConfig();
  return json(res, 200, {
    ok: true,
    stats,
    diagnostics: {
      runtime: 'node',
      upstashUrl: Boolean(process.env.UPSTASH_REDIS_REST_URL),
      upstashToken: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN),
      kvUrl: Boolean(process.env.KV_REST_API_URL),
      kvToken: Boolean(process.env.KV_REST_API_TOKEN),
      redisReady: redis.ready,
    },
  });
}
