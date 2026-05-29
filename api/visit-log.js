// /api/visit-log — backward-compatible explicit visit endpoint.
// Page views are tracked by the shared analytics.js beacon.

import { createVisitEntry, recordVisit, truncate } from '../lib/analytics-store.js';

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
  const entry = createVisitEntry(request);
  entry.page = truncate(payload.page || entry.page, 80);
  entry.referrer = truncate(payload.referrer || entry.referrer, 220);
  entry.screen = truncate(payload.screen, 40);

  console.log(JSON.stringify(entry));
  await recordVisit(entry);

  return json(res, 200, { ok: true });
}
