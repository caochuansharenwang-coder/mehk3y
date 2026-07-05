import fs from 'node:fs';
import path from 'node:path';

export const config = { maxDuration: 30 };

const SITES_PATH = path.join(process.cwd(), 'data/aliens-eye/sites.json');
const MAX_LIMIT = 80;
const TIMEOUT_MS = 4500;
const MAX_BODY_CHARS = 120_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; Mehk3yAliensEye/1.0; +https://mehk3y.com/aliens-eye)';

let cachedSites = null;

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sites() {
  if (!cachedSites) {
    const raw = JSON.parse(fs.readFileSync(SITES_PATH, 'utf8'));
    cachedSites = Object.entries(raw).map(([name, template]) => ({ name, template }));
  }
  return cachedSites;
}

function normalizeUsername(value) {
  return String(value || '').trim().replace(/^@+/, '');
}

function buildUrl(template, username) {
  const encoded = encodeURIComponent(username);
  return template.includes('{}') ? template.split('{}').join(encoded) : template + encoded;
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

async function readLimitedText(response) {
  const reader = response.body?.getReader?.();
  if (!reader) return (await response.text()).slice(0, MAX_BODY_CHARS);

  const decoder = new TextDecoder();
  let text = '';
  while (text.length < MAX_BODY_CHARS) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (text.length >= MAX_BODY_CHARS) {
      try { await reader.cancel(); } catch {}
      break;
    }
  }
  return text.slice(0, MAX_BODY_CHARS);
}

function detect({ site, url, finalUrl, status, text, username }) {
  const lower = String(text || '').toLowerCase();
  const user = username.toLowerCase();
  const finalLower = String(finalUrl || url).toLowerCase();

  const notFoundPatterns = [
    '<title>not found',
    '<title>page not found',
    '<title>404',
    '<h1>not found',
    '<h1>page not found',
    'user not found',
    'profile not found',
    'account not found',
    'no such user',
    'sorry, this page isn',
    'sorry, this profile isn',
    'this user does not exist',
    'this account does not exist',
    '此用户不存在',
    '用户不存在'
  ];

  const positivePatterns = [
    `/${user}`,
    `@${user}`,
    `"${user}"`,
    `>${user}<`,
    `content="${user}`,
    'og:type" content="profile',
    "og:type' content='profile",
    '"@type":"person"',
    '"@type": "person"',
    `followers`,
    `following`
  ];

  const hasNotFound = notFoundPatterns.some(pattern => lower.includes(pattern));
  const hasChallenge = [
    'verify-human',
    '/captcha/',
    'captcha required',
    'cf-challenge',
    'cloudflare challenge',
    'please verify you are a human',
    'sign in to continue',
    'login to continue',
    'checking your browser'
  ].some(pattern => finalLower.includes(pattern) || lower.includes(pattern));
  const finalHasUser = finalLower.includes(encodeURIComponent(user)) || finalLower.includes(user);
  const bodyHasUser = lower.includes(user);
  const hasProfileSignal = positivePatterns.some(pattern => lower.includes(pattern));
  const okStatus = status >= 200 && status < 300;
  const hardNotFound = status === 404 || status === 410;

  let confidence = 0;
  if (okStatus) confidence += 35;
  if (finalHasUser) confidence += 28;
  if (bodyHasUser) confidence += 24;
  if (hasProfileSignal) confidence += 8;
  if (hasNotFound) confidence -= 60;
  if (hasChallenge) confidence -= 60;
  if (!okStatus) confidence -= 40;

  const found = okStatus && !hardNotFound && !hasNotFound && !hasChallenge && (bodyHasUser || (finalHasUser && hasProfileSignal));
  return {
    found,
    confidence: Math.max(0, Math.min(99, confidence)),
    site: site.name,
    url,
    finalUrl,
    host: hostOf(finalUrl || url),
    status
  };
}

async function scanOne(site, username) {
  const url = buildUrl(site.template, username);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'user-agent': USER_AGENT,
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    const contentType = response.headers.get('content-type') || '';
    const text = /text|html|json|xml/i.test(contentType) ? await readLimitedText(response) : '';
    return detect({ site, url, finalUrl: response.url, status: response.status, text, username });
  } catch (error) {
    return {
      found: false,
      confidence: 0,
      site: site.name,
      url,
      finalUrl: url,
      host: hostOf(url),
      status: 0,
      error: error?.name === 'AbortError' ? 'timeout' : (error?.message || 'fetch_failed')
    };
  } finally {
    clearTimeout(timer);
  }
}

async function scanBatch(batch, username, concurrency = 20) {
  const results = new Array(batch.length);
  let cursor = 0;

  async function worker() {
    while (cursor < batch.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await scanOne(batch[index], username);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, batch.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'method_not_allowed' });
  }

  let body;
  try { body = await readBody(req); } catch {
    return json(res, 400, { ok: false, error: 'invalid_json' });
  }

  const username = normalizeUsername(body.username);
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(username)) {
    return json(res, 400, { ok: false, error: 'invalid_username' });
  }

  const allSites = sites();
  const offset = Math.max(0, Math.min(Number(body.offset) || 0, allSites.length));
  const limit = Math.max(1, Math.min(Number(body.limit) || 60, MAX_LIMIT));
  const batch = allSites.slice(offset, offset + limit);
  const startedAt = Date.now();
  const scanned = await scanBatch(batch, username, 20);
  const found = scanned
    .filter(item => item.found)
    .sort((a, b) => b.confidence - a.confidence || a.site.localeCompare(b.site));

  return json(res, 200, {
    ok: true,
    username,
    offset,
    limit,
    total: allSites.length,
    checked: batch.length,
    nextOffset: offset + batch.length,
    done: offset + batch.length >= allSites.length,
    ms: Date.now() - startedAt,
    found
  });
}
