const COOKIE_NAME = 'mehk3y_admin';
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function bytesToHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function base64UrlEncode(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function sha256(value) {
  return bytesToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

function env(name) {
  return (typeof process !== 'undefined' && process.env && process.env[name]) || '';
}

function authConfig() {
  const passwordHash = env('ADMIN_PASSWORD_HASH').trim().toLowerCase();
  const sessionSecret = env('ADMIN_SESSION_SECRET').trim();
  return {
    passwordHash,
    sessionSecret,
    ready: /^[a-f0-9]{64}$/.test(passwordHash) && sessionSecret.length >= 32,
  };
}

async function hmac(value) {
  const { sessionSecret, ready } = authConfig();
  if (!ready) throw new Error('admin auth is not configured');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(sessionSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return base64UrlEncode(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export async function passwordIsValid(password) {
  const cfg = authConfig();
  if (!cfg.ready) return false;
  const hash = await sha256(password || '');
  return timingSafeEqual(hash, cfg.passwordHash);
}

export function isAdminAuthConfigured() {
  return authConfig().ready;
}

export async function createSessionCookie() {
  if (!isAdminAuthConfigured()) throw new Error('admin auth is not configured');
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = base64UrlEncode(JSON.stringify({ exp }));
  const sig = await hmac(payload);
  return `${COOKIE_NAME}=${payload}.${sig}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export async function isAuthenticated(request) {
  if (!isAdminAuthConfigured()) return false;
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!match) return false;

  const [payload, sig] = match[1].split('.');
  if (!payload || !sig) return false;
  if (!timingSafeEqual(await hmac(payload), sig)) return false;

  try {
    const data = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
    return Number(data.exp || 0) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}
