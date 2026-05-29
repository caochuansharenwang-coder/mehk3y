import { isAuthenticated } from '../lib/admin-auth.js';
import { readAnalytics } from '../lib/analytics-store.js';

export const config = { runtime: 'edge' };

export default async function handler(request) {
  if (!(await isAuthenticated(request))) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit') || 300);
  const stats = await readAnalytics(limit);
  return new Response(JSON.stringify({ ok: true, stats }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
