// /api/visit-log — minimal visit logging for selected pages.
// IP addresses are personal data, so keep this intentionally small.

export const config = { runtime: 'edge' };

const MOBILE_UA = /android|iphone|ipad|ipod|mobile|windows phone|harmonyos/i;
const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|bingpreview|yandex|baidu|duckduck|semrush|ahref|mj12|dotbot|petalbot|bytespider|gptbot|claudebot/i;

function getClientIp(request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || request.headers.get('cf-connecting-ip')
      || null;
}

function truncate(value, max = 160) {
  return String(value || '').slice(0, max);
}

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

  const ua = request.headers.get('user-agent') || '';
  const payload = await getPayload(request);
  const entry = {
    event: 'visit',
    ts: new Date().toISOString(),
    ip: getClientIp(request),
    page: truncate(payload.page || '/yuepaomoniqi', 80),
    referrer: truncate(payload.referrer || request.headers.get('referer'), 200),
    userAgent: truncate(ua, 260),
    isMobile: MOBILE_UA.test(ua),
    isBot: BOT_UA.test(ua),
    language: truncate(request.headers.get('accept-language'), 120),
    screen: truncate(payload.screen, 40),
  };

  console.log(JSON.stringify(entry));

  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
