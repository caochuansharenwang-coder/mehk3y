// /api/visit-log — backward-compatible explicit visit endpoint.
// Page views are tracked by the shared analytics.js beacon.

import { createVisitEntry, enrichIp, recordDuration, recordVisit, truncate } from '../lib/analytics-store.js';

async function getPayload(request) {
  try {
    const text = await request.text();
    if (!text) return {};
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function json(res, status, data, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  for (const [key, value] of Object.entries(extraHeaders)) res.setHeader(key, value);
  res.end(JSON.stringify(data));
}

async function toWebRequest(req) {
  const host = req.headers.host || 'mehk3y.com';
  const url = `https://${host}${req.url || '/api/visit-log'}`;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  return new Request(url, { method: req.method, headers: req.headers, body });
}

export default async function handler(req, res) {
  const request = await toWebRequest(req);

  if (request.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'method_not_allowed' }, { allow: 'POST' });
  }

  const payload = await getPayload(request);

  // 停留时长上报: 不创建新事件, 只累加平均停留统计。
  if (payload.type === 'duration') {
    await recordDuration(payload.duration);
    return json(res, 200, { ok: true });
  }

  const entry = createVisitEntry(request);
  entry.page = truncate(payload.page || entry.page, 80);
  entry.referrer = truncate(payload.referrer || entry.referrer, 220);
  if (payload.language) entry.language = truncate(payload.language, 140);
  if (payload.timezone) entry.timezone = truncate(payload.timezone, 60);

  // 设备硬件
  entry.screen = truncate(payload.screen, 40);
  entry.viewport = truncate(payload.viewport, 40);
  entry.pixelRatio = Number(payload.pixelRatio) || 1;
  entry.colorDepth = Number(payload.colorDepth) || 0;
  entry.cpuCores = Number(payload.cpuCores) || 0;
  entry.deviceMemory = Number(payload.deviceMemory) || 0;
  entry.touch = Boolean(payload.touch);
  entry.netType = truncate(payload.netType, 16);
  entry.netDownlink = Number(payload.netDownlink) || 0;

  // 访客 / 会话
  entry.vid = truncate(payload.vid, 48);
  entry.sid = truncate(payload.sid, 48);
  entry.isReturning = Boolean(payload.isReturning);
  entry.sessionStart = Boolean(payload.sessionStart);

  // 来源渠道
  entry.utmSource = truncate(payload.utmSource, 60);
  entry.utmMedium = truncate(payload.utmMedium, 60);
  entry.utmCampaign = truncate(payload.utmCampaign, 80);

  // IP 富化: 运营商 / ASN / 是否机房·VPN (尽力而为, 不阻塞)
  const ipInfo = await enrichIp(entry.ip);
  if (ipInfo) {
    entry.isp = ipInfo.isp;
    entry.org = ipInfo.org;
    entry.asn = ipInfo.asn;
    entry.isHosting = ipInfo.isHosting;
  }

  console.log(JSON.stringify(entry));
  await recordVisit(entry);

  return json(res, 200, { ok: true });
}
