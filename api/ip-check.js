// /api/ip-check — 站内 /ip 页面用: 查调用者自身出口 IP 的地理 + 风险信息。
//
// 核心逻辑统一在 lib/ip-intel.js (与对外付费 API /api/v1/check 共用同一套
// 多源地理定位、proxycheck 风险判定与网络参考分, 避免两边口径漂移)。
//
// 本端点不鉴权 (仅查调用方自己的 IP), 保持原有响应字段以兼容 ip.js。

import { lookupIp } from '../lib/ip-intel.js';

export const config = { runtime: 'edge' };

export default async function handler(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
          || request.headers.get('x-real-ip')
          || '127.0.0.1';

  const ua = (request.headers.get('user-agent') || '').toLowerCase();
  const isCrawler = /bot|crawl|spider|slurp|facebookexternalhit|bingpreview|yandex|baidu|duckduck|semrush|ahref|mj12|dotbot|petalbot|bytespider|gptbot|claudebot/.test(ua);

  const proxyKey = (typeof process !== 'undefined' && process.env?.PROXYCHECK_KEY) || '';
  const d = await lookupIp(ip, { proxyKey });

  // 兼容 ip.js 现有字段（参考分由前端按相同权重计算并展示）。
  return new Response(JSON.stringify({
    ip: d.ip, country: d.country, countryCode: d.countryCode,
    city: d.city, region: d.region, isp: d.isp, org: d.org,
    asn: d.asn, timezone: d.timezone,
    proxy: d.proxy, isVPN: d.isVPN, isTOR: d.isTOR, isHosting: d.isHosting,
    type: d.type, risk: d.risk, isCrawler, hasAbuse: d.hasAbuse,
  }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
