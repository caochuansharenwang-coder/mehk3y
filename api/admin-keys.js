// /api/admin-keys — 后台管理付费 API 的 key (建/列/停用/启用)。
//
// 鉴权: 复用站点 admin 会话 cookie (lib/admin-auth.js)。必须已登录 /admin。
// 存储: 与 lib/api-keys.js 同一套 Redis 键结构 (apikey:<key> 等)。
//
//   GET    /api/admin-keys            列出所有 key + 用量
//   POST   /api/admin-keys            建 key   body: { plan, dailyLimit, label }
//   PATCH  /api/admin-keys            启停     body: { key, active }

import { isAuthenticated } from '../lib/admin-auth.js';

export const config = { runtime: 'edge' };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function redisCfg() {
  const url = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').replace(/\/$/, '');
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
  return { url, token, ready: Boolean(url && token) };
}

async function redis(commands) {
  const cfg = redisCfg();
  if (!cfg.ready) return { ok: false, missing: true, results: [] };
  try {
    const r = await fetch(`${cfg.url}/pipeline`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(commands),
    });
    if (!r.ok) return { ok: false, status: r.status, results: [] };
    return { ok: true, results: await r.json() };
  } catch (e) {
    return { ok: false, error: String(e), results: [] };
  }
}

const today = () => new Date().toISOString().slice(0, 10);

// 生成 key: mk_ + 32 字符 base64url (24 随机字节)。Edge 用 crypto.getRandomValues。
function genKey() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'mk_' + b64;
}

function metaFromFlat(flat) {
  const m = {};
  for (let i = 0; i < flat.length; i += 2) m[flat[i]] = flat[i + 1];
  return m;
}

export default async function handler(request) {
  if (!(await isAuthenticated(request))) return json({ ok: false, error: 'unauthorized' }, 401);
  if (!redisCfg().ready) return json({ ok: false, error: 'store_unconfigured' }, 503);

  // ── 列出所有 key ──
  if (request.method === 'GET') {
    let cursor = '0';
    const names = [];
    do {
      const res = await redis([['SCAN', cursor, 'MATCH', 'apikey:*', 'COUNT', '300']]);
      if (!res.ok) return json({ ok: false, error: 'store_error' }, 503);
      cursor = res.results[0]?.result?.[0] || '0';
      for (const k of (res.results[0]?.result?.[1] || [])) {
        if (!k.includes(':usage:') && !k.includes(':total:')) names.push(k);
      }
    } while (cursor !== '0');

    const day = today();
    const keys = [];
    for (const name of names) {
      const id = name.slice('apikey:'.length);
      const res = await redis([
        ['HGETALL', name],
        ['GET', `apikey:total:${id}`],
        ['GET', `apikey:usage:${id}:${day}`],
      ]);
      const m = metaFromFlat(res.results[0]?.result || []);
      keys.push({
        key: id, plan: m.plan || '', dailyLimit: Number(m.dailyLimit || 0),
        active: m.active !== '0', label: m.label || '', createdAt: m.createdAt || '',
        total: Number(res.results[1]?.result || 0), usedToday: Number(res.results[2]?.result || 0),
      });
    }
    keys.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return json({ ok: true, keys });
  }

  // ── 新建 key ──
  if (request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch {}
    const plan = String(body.plan || 'free').slice(0, 24);
    const dailyLimit = Math.max(0, Math.min(Number(body.dailyLimit) || 0, 10_000_000));
    const label = String(body.label || '').slice(0, 80);
    const key = genKey();
    const res = await redis([['HSET', `apikey:${key}`,
      'plan', plan, 'dailyLimit', String(dailyLimit),
      'active', '1', 'label', label, 'createdAt', new Date().toISOString()]]);
    if (!res.ok) return json({ ok: false, error: 'store_error' }, 503);
    return json({ ok: true, key, plan, dailyLimit, label });
  }

  // ── 启用 / 停用 ──
  if (request.method === 'PATCH') {
    let body = {};
    try { body = await request.json(); } catch {}
    const key = String(body.key || '');
    if (!/^mk_[A-Za-z0-9_-]{16,80}$/.test(key)) return json({ ok: false, error: 'invalid_key' }, 400);
    // 仅当 key 存在时操作
    const exists = await redis([['EXISTS', `apikey:${key}`]]);
    if (!exists.results?.[0]?.result) return json({ ok: false, error: 'unknown_key' }, 404);
    const active = body.active ? '1' : '0';
    const res = await redis([['HSET', `apikey:${key}`, 'active', active]]);
    if (!res.ok) return json({ ok: false, error: 'store_error' }, 503);
    return json({ ok: true, key, active: active === '1' });
  }

  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
