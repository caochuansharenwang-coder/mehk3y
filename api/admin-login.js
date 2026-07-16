import {
  clearSessionCookie,
  createSessionCookie,
  isAdminAuthConfigured,
  isAuthenticated,
  passwordIsValid,
} from '../lib/admin-auth.js';

export const config = { runtime: 'edge' };

async function readJson(request) {
  const declaredSize = Number(request.headers.get('content-length') || 0);
  if (declaredSize > 4096) throw new Error('payload_too_large');
  const text = await request.text();
  if (text.length > 4096) throw new Error('payload_too_large');
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}

export default async function handler(request) {
  if (request.method !== 'DELETE' && !isAdminAuthConfigured()) {
    return new Response(JSON.stringify({ ok: false, error: 'admin_unconfigured' }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  if (request.method === 'GET') {
    return new Response(JSON.stringify({ ok: await isAuthenticated(request) }), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  if (request.method === 'DELETE') {
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'set-cookie': clearSessionCookie(),
      },
    });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'allow': 'GET, POST, DELETE' },
    });
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return new Response(JSON.stringify({ ok: false, error: 'content_type_required' }), {
      status: 415,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  let body;
  try {
    body = await readJson(request);
  } catch (error) {
    if (error?.message === 'payload_too_large') {
      return new Response(JSON.stringify({ ok: false, error: 'payload_too_large' }), {
        status: 413,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    body = {};
  }

  const password = typeof body.password === 'string' && body.password.length <= 512
    ? body.password
    : '';
  if (!(await passwordIsValid(password))) {
    return new Response(JSON.stringify({ ok: false, error: 'bad_password' }), {
      status: 401,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'set-cookie': await createSessionCookie(),
    },
  });
}
