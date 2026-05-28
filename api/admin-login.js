import { clearSessionCookie, createSessionCookie, isAuthenticated, passwordIsValid } from '../lib/admin-auth.js';

export const config = { runtime: 'edge' };

async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

export default async function handler(request) {
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

  const body = await readJson(request);
  if (!(await passwordIsValid(body.password || ''))) {
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
