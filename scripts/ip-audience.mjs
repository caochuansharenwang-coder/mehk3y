#!/usr/bin/env node
// scripts/ip-audience.mjs — /ip 页访客画像报告。
//
// 用途: 700+/天的流量高度集中在 /ip 页(「我这个 IP 能不能安全登录 Claude」检测器),
//       这群人 = 想用 AI、正在折腾代理/机场、担心封号的高意图用户。
//       变现前先用真实数据看清: 他们来自哪、从哪来、用什么网络、是不是回头客。
//
// 数据源: 线上 Upstash/Vercel Redis 的 analytics:events 列表(最近 5000 条访问,
//         每条含 page / country / referrer / isp / isHosting / vid 等完整字段)。
//         本仓库不含凭证 —— 必须本地带环境变量运行。
//
// 运行:
//   UPSTASH_REDIS_REST_URL=...  UPSTASH_REDIS_REST_TOKEN=...  node scripts/ip-audience.mjs
//   # 或 Vercel KV 命名:
//   KV_REST_API_URL=...  KV_REST_API_TOKEN=...  node scripts/ip-audience.mjs
//
//   可选: PAGE=/ip   只看某页(默认 /ip)
//         TOP=15     每个榜单显示前 N 条(默认 15)

const URL_ENV = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').replace(/\/$/, '');
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const PAGE = process.env.PAGE || '/ip';
const TOP = Number(process.env.TOP || 15);

if (!URL_ENV || !TOKEN) {
  console.error('✗ 缺少 Redis 凭证。请设置 UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN');
  console.error('  (或 KV_REST_API_URL + KV_REST_API_TOKEN)，可从 Vercel 项目环境变量复制。');
  process.exit(1);
}

async function redis(command) {
  const res = await fetch(`${URL_ENV}/pipeline`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify([command]),
  });
  if (!res.ok) throw new Error(`Redis ${res.status}: ${await res.text()}`);
  const [out] = await res.json();
  return out?.result;
}

function safeJson(v) { try { return JSON.parse(v); } catch { return null; } }

// referrer → 归一化来源(去掉 path/query，标注「直接访问」)
function refSource(ref) {
  if (!ref) return '(直接访问 / 无 referrer)';
  try { return new URL(ref).hostname.replace(/^www\./, ''); } catch { return ref.slice(0, 40); }
}

function tally(items) {
  const m = new Map();
  for (const it of items) m.set(it, (m.get(it) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function bar(n, max, width = 24) {
  const len = max ? Math.round((n / max) * width) : 0;
  return '█'.repeat(len) + '·'.repeat(width - len);
}

function table(title, pairs, total) {
  console.log(`\n${title}`);
  if (!pairs.length) { console.log('  (无数据)'); return; }
  const max = pairs[0][1];
  for (const [k, n] of pairs.slice(0, TOP)) {
    const pct = total ? ((n / total) * 100).toFixed(1) : '0.0';
    console.log(`  ${bar(n, max)} ${String(n).padStart(5)}  ${pct.padStart(5)}%  ${k}`);
  }
}

(async () => {
  console.log(`正在拉取 analytics:events …`);
  const raw = await redis(['LRANGE', 'analytics:events', 0, 4999]);
  const all = (raw || []).map(safeJson).filter(Boolean);
  const ev = all.filter((e) => e.page === PAGE && !e.isBot);

  console.log(`\n══════════════════════════════════════════════════════════`);
  console.log(`  ${PAGE} 页访客画像   (events 样本 ${all.length} 条，其中本页非机器人 ${ev.length} 条)`);
  console.log(`══════════════════════════════════════════════════════════`);

  if (!ev.length) {
    console.log(`\n样本里没有 ${PAGE} 的访问记录。events 是滚动窗口(最多 5000 条)，`);
    console.log(`如果整站流量很大，旧的 /ip 记录可能已被挤出。可改小窗口或换 PAGE= 重试。`);
    return;
  }

  const total = ev.length;
  const uniqVid = new Set(ev.map((e) => e.vid).filter(Boolean)).size;
  const uniqIp = new Set(ev.map((e) => e.ip).filter((x) => x && x !== 'unknown')).size;
  console.log(`\n样本内: ${total} 次浏览 · ${uniqVid || '—'} 个独立访客(vid) · ${uniqIp} 个独立 IP`);

  table('🌍 国家 / 地区 (Vercel edge 判定 — 决定推什么、用什么语言)',
    tally(ev.map((e) => e.country || 'Unknown')), total);

  table('🔗 来源 referrer (从哪来 — 决定在哪投放/优化)',
    tally(ev.map((e) => refSource(e.referrer))), total);

  table('📶 网络类型 (机房/VPN 占比越高 = 越多人已在用代理，痛点越真)',
    tally(ev.map((e) => (e.isHosting ? '机房 / VPN / 代理' : (e.isp ? '住宅 / 移动' : '(未富化)')))), total);

  table('🏢 运营商 / ASN org (具体在用哪些机场/云/代理)',
    tally(ev.map((e) => e.isp).filter(Boolean)), total);

  table('🔁 新老访客',
    tally(ev.map((e) => (e.isReturning ? '回头客' : '新访客'))), total);

  table('💻 设备',
    tally(ev.map((e) => e.deviceType || (e.isMobile ? 'mobile' : 'desktop'))), total);

  table('🌐 浏览器语言',
    tally(ev.map((e) => (e.language || '').split(',')[0].trim()).filter(Boolean)), total);

  console.log(`\n──────────────────────────────────────────────────────────`);
  console.log(`解读提示:`);
  console.log(`  · 国家里 CN/HK 等占比高 → 主力是「想用 Claude 但 IP 被风控」人群，`);
  console.log(`    最该对接「干净/原生 IP 机场」与「住宅代理」返佣。`);
  console.log(`  · referrer 集中在某论坛/搜索 → 那里就是该重点经营的获客渠道。`);
  console.log(`  · 机房/VPN 占比高 → 用户已在花钱买代理，换更好方案的转化意愿强。`);
  console.log(`──────────────────────────────────────────────────────────`);
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
