// lib/api-keys.js — 付费 API 的 key 校验、用量计费、限流。
//
// 存储复用站点已有的 Upstash/Vercel Redis (REST pipeline), 不引入新依赖。
// 数据结构:
//   apikey:<key>            HASH  { plan, dailyLimit, active, label, createdAt }
//   apikey:usage:<key>:<day> STR  当天已用次数 (INCR, 次日自动过期)
//   apikey:total:<key>       STR  累计调用次数
//
// 管理 key (建 key / 停用) 走后台脚本 scripts/api-key-admin.mjs, 不在此暴露。

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

// 校验 key 并在同一次往返里原子地累加用量。返回判定结果。
// 注意: 先读 key 元信息, 再按当日计数判限额。为减少往返, 用一个 pipeline。
export async function authorizeAndMeter(key) {
  if (!key || typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(key)) {
    return { ok: false, status: 401, error: 'invalid_key_format' };
  }

  const day = today();
  const usageKey = `apikey:usage:${key}:${day}`;

  // 读取 key 元信息 + 当前当日用量 (尚未自增)。
  const read = await redis([
    ['HGETALL', `apikey:${key}`],
    ['GET', usageKey],
  ]);
  if (read.missing) return { ok: false, status: 503, error: 'store_unconfigured' };
  if (!read.ok) return { ok: false, status: 503, error: 'store_error' };

  const flat = read.results[0]?.result || [];
  if (!flat.length) return { ok: false, status: 401, error: 'unknown_key' };

  const meta = {};
  for (let i = 0; i < flat.length; i += 2) meta[flat[i]] = flat[i + 1];
  if (meta.active === '0') return { ok: false, status: 403, error: 'key_disabled' };

  const dailyLimit = Number(meta.dailyLimit || 0); // 0 = 无限
  const used = Number(read.results[1]?.result || 0);
  if (dailyLimit > 0 && used >= dailyLimit) {
    return { ok: false, status: 429, error: 'daily_limit_exceeded', plan: meta.plan, dailyLimit, used };
  }

  // 通过 → 自增当日用量(首次访问设 48h 过期, 防键膨胀) + 累计计数。
  const inc = await redis([
    ['INCR', usageKey],
    ['EXPIRE', usageKey, 60 * 60 * 48],
    ['INCR', `apikey:total:${key}`],
  ]);
  const nowUsed = Number(inc.results?.[0]?.result || used + 1);

  return {
    ok: true,
    plan: meta.plan || 'free',
    label: meta.label || '',
    dailyLimit,
    used: nowUsed,
    remaining: dailyLimit > 0 ? Math.max(0, dailyLimit - nowUsed) : null,
  };
}
