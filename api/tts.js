const MAX_TEXT_LENGTH = 220;

export const config = { runtime: 'edge' };

function normalizeText(input) {
  return String(input || '')
    .replace(/\bI'm\b/g, 'I am')
    .replace(/\bI'll\b/g, 'I will')
    .replace(/\bI'd\b/g, 'I would')
    .replace(/\bI've\b/g, 'I have')
    .replace(/\byou're\b/gi, 'you are')
    .replace(/\bit's\b/gi, 'it is')
    .replace(/\bthat's\b/gi, 'that is')
    .replace(/\bcan't\b/gi, 'cannot')
    .replace(/\bwon't\b/gi, 'will not')
    .replace(/\bdon't\b/gi, 'do not')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const text = normalizeText(searchParams.get('text'));
  if (!text) {
    return new Response(JSON.stringify({ error: 'Missing text' }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  const url = 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&q=' + encodeURIComponent(text);
  const upstream = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'audio/mpeg,audio/*;q=0.9,*/*;q=0.1'
    }
  });
  const contentType = upstream.headers.get('content-type') || '';
  if (!upstream.ok || !contentType.includes('audio/')) {
    return new Response(JSON.stringify({ error: 'TTS upstream failed' }), {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  return new Response(await upstream.arrayBuffer(), {
    status: 200,
    headers: {
      'content-type': 'audio/mpeg',
      'cache-control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800',
    },
  });
}
