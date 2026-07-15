// /api/v1/check — 对外付费 IP 情报 API。
//
//   GET /api/v1/check?ip=1.2.3.4
//   鉴权: 请求头 `x-api-key: <key>`  或  查询参数 `?key=<key>`
//
// 返回标准化情报 + 本站估算的网络风险信号参考分。按 key 每日计费 + 限额。
// 不带 ip 参数时, 检测调用方自身出口 IP。
//
// 计费/限额逻辑见 lib/api-keys.js; 评分逻辑见 lib/ip-intel.js (与站内 /ip 一致)。
// 参考分仅依据代理、VPN、Tor、托管网络和上游风险信号，不代表任何第三方服务的判定。

import { lookupIp, isValidIp } from '../../lib/ip-intel.js';
import { authorizeAndMeter } from '../../lib/api-keys.js';

export const config = { runtime: 'edge' };

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'x-api-key, content-type',
      ...extraHeaders,
    },
  });
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') return json({}, 204);
  if (request.method !== 'GET') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const url = new URL(request.url);
  const key = request.headers.get('x-api-key') || url.searchParams.get('key') || '';

  // 鉴权 + 计费 (同一次调用里完成限额判定与用量累加)。
  const auth = await authorizeAndMeter(key);
  if (!auth.ok) {
    const hint = {
      invalid_key_format: '缺少或格式不正确的 API key。请在请求头 x-api-key 传入。',
      unknown_key: 'API key 无效。',
      key_disabled: 'API key 已停用。',
      daily_limit_exceeded: '已达当日调用上限，请升级套餐或次日再试。',
      store_unconfigured: '服务暂未就绪。',
      store_error: '服务暂时不可用，请稍后重试。',
    }[auth.error] || auth.error;
    return json({ ok: false, error: auth.error, message: hint, ...(auth.dailyLimit ? { dailyLimit: auth.dailyLimit, used: auth.used } : {}) }, auth.status);
  }

  // 目标 IP: 显式传入则查它, 否则查调用方出口 IP。
  let target = (url.searchParams.get('ip') || '').trim();
  if (!target) {
    target = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
          || request.headers.get('x-real-ip') || '';
  }
  if (!isValidIp(target)) {
    return json({ ok: false, error: 'invalid_ip', message: '请提供合法的 IPv4 或 IPv6 地址。' }, 400);
  }

  const proxyKey = (typeof process !== 'undefined' && process.env?.PROXYCHECK_KEY) || '';
  const data = await lookupIp(target, { proxyKey });

  return json({
    ok: true,
    query: target,
    data,
    quota: { plan: auth.plan, dailyLimit: auth.dailyLimit || null, used: auth.used, remaining: auth.remaining },
  }, 200, {
    'x-ratelimit-limit': String(auth.dailyLimit || 0),
    'x-ratelimit-remaining': auth.remaining == null ? 'unlimited' : String(auth.remaining),
  });
}
