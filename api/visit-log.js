// /api/visit-log — backward-compatible explicit visit endpoint.
// Page views are tracked by the shared analytics.js beacon.

import {
  createVisitEntry,
  normalizePage,
  recordDuration,
  recordVisit,
  sanitizeReferrer,
} from '../lib/analytics-store.js';

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

function noContent(res) {
  res.statusCode = 204;
  res.setHeader('cache-control', 'no-store');
  res.end();
}

function hasPrivacyOptOut(request) {
  return request.headers.get('dnt') === '1'
    || request.headers.get('sec-gpc') === '1';
}

async function toWebRequest(req) {
  const host = req.headers.host || 'mehk3y.com';
  const url = `https://${host}${req.url || '/api/visit-log'}`;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) throw new Error('payload_too_large');
    chunks.push(chunk);
  }
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  return new Request(url, { method: req.method, headers: req.headers, body });
}

function isCrossSite(req) {
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'cross-site') return true;
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host !== String(req.headers.host || 'mehk3y.com');
  } catch {
    return true;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'method_not_allowed' }, { allow: 'POST' });
  }
  if (isCrossSite(req)) return json(res, 403, { ok: false, error: 'cross_site_forbidden' });

  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    return json(res, 415, { ok: false, error: 'content_type_required' });
  }
  if (Number(req.headers['content-length'] || 0) > 4096) {
    return json(res, 413, { ok: false, error: 'payload_too_large' });
  }

  let request;
  try {
    request = await toWebRequest(req);
  } catch (error) {
    if (error?.message === 'payload_too_large') {
      return json(res, 413, { ok: false, error: 'payload_too_large' });
    }
    return json(res, 400, { ok: false, error: 'invalid_request' });
  }

  // Enforce browser privacy signals server-side as well as in analytics.js.
  if (hasPrivacyOptOut(request)) return noContent(res);

  const payload = await getPayload(request);

  // 停留时长上报: 不创建新事件, 只累加平均停留统计。
  if (payload.type === 'duration') {
    await recordDuration(payload.duration);
    return json(res, 200, { ok: true });
  }

  const entry = createVisitEntry(request);
  entry.page = normalizePage(payload.page || '/');
  entry.referrer = sanitizeReferrer(payload.referrer, request.url);

  entry.source = 'client';
  await recordVisit(entry);

  return json(res, 200, { ok: true });
}
