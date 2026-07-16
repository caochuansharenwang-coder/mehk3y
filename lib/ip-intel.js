// lib/ip-intel.js — 站内 /ip 页面使用的 IP 情报核心:
// 串行地理定位 fallback + proxycheck 风险 + 网络参考分。
//
// 设计为 Edge/Node 双兼容: 只用 fetch + 标准 API, 不依赖 node 内置模块。

const tryJSON = async (url, ms = 6000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const r = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

// 串行尝试地理源。只有前一个不可用时才联系下一个，避免一次检测把
// 访客 IP 同时发送给所有 fallback 服务。
const firstSuccess = async (fns) => {
  for (const fn of fns) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (_) {}
  }
  return {};
};

function geoSources(ip) {
  const encodedIp = encodeURIComponent(ip);
  return [
    // ipwho.is — HTTPS 主数据源，字段包含地区、时区、网络组织与 ASN。
    async () => {
      const d = await tryJSON(`https://ipwho.is/${encodedIp}`, 3500);
      if (!d || d.success === false || !d.ip) return null;
      const connection = d.connection || {};
      const timezone = typeof d.timezone === 'string' ? d.timezone : d.timezone?.id;
      return {
        ip: d.ip || ip, country: d.country || null, countryCode: d.country_code || null,
        region: d.region || null, city: d.city || null,
        isp: connection.isp || connection.org || null,
        org: connection.org || connection.isp || null,
        asn: connection.asn ? `AS${String(connection.asn).replace(/^AS/i, '')}` : null,
        timezone: timezone || null,
      };
    },
    // ipinfo.io — 主源失败后才请求；country 只给 ISO 码。
    async () => {
      const d = await tryJSON(`https://ipinfo.io/${encodedIp}/json`, 3500);
      if (!d || !d.ip) return null;
      const m = (d.org || '').match(/^(AS\d+)\s+(.+)$/);
      const orgName = m ? m[2] : (d.org || null);
      return {
        ip: d.ip, country: d.country || null, countryCode: d.country || null,
        region: d.region || null, city: d.city || null,
        isp: orgName, org: orgName, asn: m ? m[1] : null, timezone: d.timezone || null,
      };
    },
    // FreeIPAPI — 前两项都失败时才使用的最后兜底。
    async () => {
      const d = await tryJSON(`https://free.freeipapi.com/api/json/${encodedIp}`, 3500);
      if (!d || !d.ipAddress) return null;
      return {
        ip: d.ipAddress, country: d.countryName || null, countryCode: d.countryCode || null,
        region: d.regionName || null, city: d.cityName || null,
        isp: d.asnOrganization || null, org: d.asnOrganization || null,
        asn: d.asn ? `AS${d.asn}` : null, timezone: null,
      };
    },
  ];
}

// 网络风险信号参考分 (0–100)。这是本站启发式估算，不代表任何第三方服务的判定。
// 与 ip.js 的 trustScore 保持同一套权重。
export function trustScore(d) {
  let s = 100;
  if (d.isTOR)       s -= 80;
  else if (d.isVPN)  s -= 50;
  else if (d.proxy)  s -= 35;
  if (d.isHosting)   s -= 20;
  if (d.risk > 0)    s -= Math.min(25, Math.round(d.risk * 0.25));
  return Math.max(0, Math.min(100, s));
}

export function trustTier(s) {
  if (s >= 95) return '低风险信号';
  if (s >= 80) return '较低风险';
  if (s >= 50) return '需留意';
  if (s >= 25) return '较高风险';
  return '高风险信号';
}

export function normalizeIp(ip) {
  if (!ip || typeof ip !== 'string' || ip.length > 45) return null;

  const v4Parts = ip.split('.');
  if (v4Parts.length === 4 &&
      v4Parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) {
    return v4Parts.map(Number).join('.');
  }
  if (!ip.includes(':')) return null;

  try {
    const hostname = new URL(`http://[${ip}]/`).hostname;
    return hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1).toLowerCase()
      : null;
  } catch {
    return null;
  }
}

// 查一个 IP 的完整情报。返回标准化对象与本站网络风险信号参考分。
export async function lookupIp(ip, { proxyKey = '' } = {}) {
  const normalizedIp = normalizeIp(ip);
  if (!normalizedIp) throw new Error('invalid_ip');
  ip = normalizedIp;
  const encodedIp = encodeURIComponent(ip);
  const proxyUrl = `https://proxycheck.io/v2/${encodedIp}?vpn=1&asn=1&risk=1${proxyKey ? `&key=${encodeURIComponent(proxyKey)}` : ''}`;
  const [geo, proxyRaw] = await Promise.all([
    firstSuccess(geoSources(ip)),
    tryJSON(proxyUrl, 7000),
  ]);

  const pi = (proxyRaw && proxyRaw[ip]) || {};
  const type = pi.type || null;
  const isProxy = pi.proxy === 'yes';
  const isVPN = type === 'VPN';
  const isTOR = type === 'TOR';
  const isHosting = ['Hosting', 'Compromised Server'].includes(type);
  const risk = pi.risk || 0;

  const base = {
    ip: geo.ip || ip,
    country: geo.country || pi.country || null,
    countryCode: geo.countryCode || pi.isocode || null,
    city: geo.city || null,
    region: geo.region || null,
    isp: geo.isp || pi.provider || null,
    org: geo.org || pi.org || null,
    asn: geo.asn || pi.asn || null,
    timezone: geo.timezone || null,
    proxy: isProxy, isVPN, isTOR, isHosting, type, risk,
    hasAbuse: risk >= 66,
  };

  const score = trustScore(base);
  return {
    ...base,
    trustScore: score,
    trustTier: trustTier(score),
    networkRisk: score < 50 ? 'high' : (score < 80 ? 'medium' : 'low'),
  };
}

// 基本 IPv4 / IPv6 校验, 防止把任意字符串塞进上游 URL。
export function isValidIp(ip) {
  return Boolean(normalizeIp(ip));
}
