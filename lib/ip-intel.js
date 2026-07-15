// lib/ip-intel.js — 共享的 IP 情报核心: 多源地理定位 + proxycheck 风险 + 网络参考分。
//
// 同一套逻辑被两处复用:
//   - /api/ip-check  : 站内 /ip 页面用 (查调用者自己的 IP)
//   - /api/v1/check  : 对外付费 API (查任意 IP, 带 key 计费)
//
// 设计为 Edge/Node 双兼容: 只用 fetch + 标准 API, 不依赖 node 内置模块。

const race = (p, ms) => {
  let timer;
  return Promise.race([
    p,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); }),
  ]).finally(() => clearTimeout(timer));
};

const tryJSON = async (url, ms = 6000) => {
  try {
    const r = await race(fetch(url), ms);
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
};

// 并发取多个地理源, 第一个成功的赢; 全失败返回 {}。
const firstSuccess = (fns) => new Promise((resolve) => {
  let remaining = fns.length;
  let resolved = false;
  fns.forEach((fn) => {
    fn().then((v) => {
      if (resolved) return;
      if (v) { resolved = true; resolve(v); return; }
      if (--remaining === 0 && !resolved) { resolved = true; resolve({}); }
    }).catch(() => {
      if (--remaining === 0 && !resolved) { resolved = true; resolve({}); }
    });
  });
});

function geoSources(ip) {
  return [
    // ip-api.com — 字段最全, 含完整国家名
    async () => {
      const d = await tryJSON(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,region,regionName,city,timezone,isp,org,as,query`);
      if (!d || d.status !== 'success') return null;
      const asMatch = (d.as || '').match(/^(AS\d+)/);
      return {
        ip: d.query || ip, country: d.country || null, countryCode: d.countryCode || null,
        region: d.regionName || d.region || null, city: d.city || null,
        isp: d.isp || d.org || null, org: d.org || d.isp || null,
        asn: asMatch ? asMatch[1] : (d.as || null), timezone: d.timezone || null,
      };
    },
    // ipinfo.io — country 只给 ISO 码
    async () => {
      const d = await tryJSON(`https://ipinfo.io/${ip}/json`);
      if (!d || !d.ip) return null;
      const m = (d.org || '').match(/^(AS\d+)\s+(.+)$/);
      const orgName = m ? m[2] : (d.org || null);
      return {
        ip: d.ip, country: d.country || null, countryCode: d.country || null,
        region: d.region || null, city: d.city || null,
        isp: orgName, org: orgName, asn: m ? m[1] : null, timezone: d.timezone || null,
      };
    },
    // freeipapi.com — 兜底
    async () => {
      const d = await tryJSON(`https://free.freeipapi.com/api/json/${ip}`);
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

// 查一个 IP 的完整情报。返回标准化对象与本站网络风险信号参考分。
export async function lookupIp(ip, { proxyKey = '' } = {}) {
  const proxyUrl = `https://proxycheck.io/v2/${ip}?vpn=1&asn=1&risk=1${proxyKey ? `&key=${proxyKey}` : ''}`;
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
  if (!ip || typeof ip !== 'string' || ip.length > 45) return false;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const m = ip.match(v4);
  if (m) return m.slice(1).every((o) => Number(o) <= 255);
  return /^[0-9a-fA-F:]+$/.test(ip) && ip.includes(':');
}
