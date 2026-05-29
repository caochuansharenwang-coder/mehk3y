// /api/visit-log — backward-compatible explicit visit endpoint.
// Most page views are tracked by middleware; this endpoint can still be used by
// page scripts or manual tests.

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

export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'method_not_allowed' }), {
      status: 405,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'allow': 'POST',
      },
    });
  }

  const payload = await getPayload(request);
  const entry = createVisitEntry(request);
  entry.page = truncate(payload.page || entry.page, 80);
  entry.referrer = truncate(payload.referrer || entry.referrer, 220);
  entry.screen = truncate(payload.screen, 40);

  console.log(JSON.stringify(entry));
  await recordVisit(entry);

  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
