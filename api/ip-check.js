// /api/ip-check — fetches geo + risk info for the caller's IP.
//
// Edge Runtime, China-friendly (Edge 全球部署, IP-API 调用从最近节点出去).
//
// Geo source strategy (concurrent, first-success-wins):
//   1. ip-api.com (HTTP) — 45 req/min, all fields incl. full country name
//   2. ipinfo.io  (HTTPS) — 50k/month free, no token
//   3. freeipapi.com — 60 req/min, HTTPS
//
// Risk: proxycheck.io (1000/day free; configure PROXYCHECK_KEY env var
// for 1000/day per-key).

export const config = { runtime: 'edge' };

const race = (p, ms) =>
  Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);

const tryJSON = async (url, ms = 6000) => {
  try {
    const r = await race(fetch(url), ms);
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
};

export default async function handler(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
          || request.headers.get('x-real-ip')
          || '127.0.0.1';

  const geoSources = [
    // ip-api.com — most complete fields, full country name
    async () => {
      const d = await tryJSON(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,region,regionName,city,timezone,isp,org,as,query`);
      if (!d || d.status !== 'success') return null;
      const asMatch = (d.as || '').match(/^(AS\d+)/);
      return {
        ip:          d.query || ip,
        country:     d.country || null,
        countryCode: d.countryCode || null,
        region:      d.regionName || d.region || null,
        city:        d.city || null,
        isp:         d.isp || d.org || null,
        org:         d.org || d.isp || null,
        asn:         asMatch ? asMatch[1] : (d.as || null),
        timezone:    d.timezone || null,
      };
    },
    // ipinfo.io — country comes back as ISO code only
    async () => {
      const d = await tryJSON(`https://ipinfo.io/${ip}/json`);
      if (!d || !d.ip) return null;
      const m = (d.org || '').match(/^(AS\d+)\s+(.+)$/);
      const asn = m ? m[1] : null;
      const orgName = m ? m[2] : (d.org || null);
      return {
        ip:          d.ip,
        country:     d.country || null,
        countryCode: d.country || null,
        region:      d.region || null,
        city:        d.city || null,
        isp:         orgName,
        org:         orgName,
        asn:         asn,
        timezone:    d.timezone || null,
      };
    },
    // freeipapi.com — last resort
    async () => {
      const d = await tryJSON(`https://free.freeipapi.com/api/json/${ip}`);
      if (!d || !d.ipAddress) return null;
      return {
        ip:          d.ipAddress,
        country:     d.countryName || null,
        countryCode: d.countryCode || null,
        region:      d.regionName || null,
        city:        d.cityName || null,
        isp:         d.asnOrganization || null,
        org:         d.asnOrganization || null,
        asn:         d.asn ? `AS${d.asn}` : null,
        timezone:    null,
      };
    },
  ];

  const firstSuccess = (fns) => new Promise((resolve) => {
    let remaining = fns.length;
    let resolved  = false;
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

  const proxyKey = (typeof process !== 'undefined' && process.env?.PROXYCHECK_KEY) || '';
  const proxyUrl = `https://proxycheck.io/v2/${ip}?vpn=1&asn=1&risk=1${proxyKey ? `&key=${proxyKey}` : ''}`;

  const [geo, proxyRaw] = await Promise.all([
    firstSuccess(geoSources),
    tryJSON(proxyUrl, 7000),
  ]);

  const pi = (proxyRaw && proxyRaw[ip]) || {};
  const type      = pi.type || null;
  const isProxy   = pi.proxy === 'yes';
  const isVPN     = type === 'VPN';
  const isTOR     = type === 'TOR';
  const isHosting = ['Hosting', 'Compromised Server'].includes(type);

  const ua = (request.headers.get('user-agent') || '').toLowerCase();
  const botPatterns = /bot|crawl|spider|slurp|facebookexternalhit|bingpreview|yandex|baidu|duckduck|semrush|ahref|mj12|dotbot|petalbot|bytespider|gptbot|claudebot/;
  const isCrawler = botPatterns.test(ua);

  const hasAbuse = (pi.risk || 0) >= 66;

  return new Response(JSON.stringify({
    ip:          geo.ip          || ip,
    country:     geo.country     || pi.country || null,
    countryCode: geo.countryCode || pi.isocode || null,
    city:        geo.city                       || null,
    region:      geo.region                     || null,
    isp:         geo.isp || pi.provider         || null,
    org:         geo.org || pi.org              || null,
    asn:         geo.asn || pi.asn              || null,
    timezone:    geo.timezone                   || null,
    proxy:       isProxy,
    isVPN,
    isTOR,
    isHosting,
    type,
    risk:        pi.risk || 0,
    isCrawler,
    hasAbuse,
  }), {
    headers: {
      'content-type':  'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
