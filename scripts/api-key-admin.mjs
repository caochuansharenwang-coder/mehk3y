#!/usr/bin/env node
// scripts/api-key-admin.mjs — 付费 API 的 key 管理 (本地运行, 需 Redis 凭证)。
//
// 用法 (从 Vercel 复制环境变量):
//   UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... \
//     node scripts/api-key-admin.mjs <命令> [参数]
//
// 命令:
//   create <plan> <dailyLimit> [label]   新建 key, 打印明文 (只显示这一次)
//   disable <key>                        停用 key
//   enable  <key>                        启用 key
//   info    <key>                        查看 key 元信息 + 累计/当日用量
//   list                                 列出所有 key
//
// 示例:
//   node scripts/api-key-admin.mjs create free 100 "试用"
//   node scripts/api-key-admin.mjs create pro  10000 "张三-月付"

import { randomBytes } from 'node:crypto';

const URL_ENV = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').replace(/\/$/, '');
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
if (!URL_ENV || !TOKEN) {
  console.error('✗ 缺少 Redis 凭证 (UPSTASH_REDIS_REST_URL / TOKEN)。');
  process.exit(1);
}

async function redis(commands) {
  const r = await fetch(`${URL_ENV}/pipeline`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error(`Redis ${r.status}: ${await r.text()}`);
  return r.json();
}

const today = () => new Date().toISOString().slice(0, 10);
const [cmd, ...args] = process.argv.slice(2);

async function main() {
  switch (cmd) {
    case 'create': {
      const [plan = 'free', dailyLimit = '100', label = ''] = args;
      const key = 'mk_' + randomBytes(24).toString('base64url');
      await redis([['HSET', `apikey:${key}`,
        'plan', plan, 'dailyLimit', String(Number(dailyLimit) || 0),
        'active', '1', 'label', label, 'createdAt', new Date().toISOString()]]);
      console.log('✅ 已创建 API key (请妥善保存, 仅显示这一次):\n');
      console.log('   ' + key + '\n');
      console.log(`   套餐: ${plan} · 每日上限: ${dailyLimit} · 备注: ${label || '(无)'}`);
      console.log(`\n   调用示例:`);
      console.log(`   curl "https://mehk3y.com/api/v1/check?ip=8.8.8.8" -H "x-api-key: ${key}"`);
      break;
    }
    case 'disable':
    case 'enable': {
      const [key] = args;
      if (!key) return console.error('✗ 需要 <key>');
      await redis([['HSET', `apikey:${key}`, 'active', cmd === 'enable' ? '1' : '0']]);
      console.log(`✅ ${key} 已${cmd === 'enable' ? '启用' : '停用'}`);
      break;
    }
    case 'info': {
      const [key] = args;
      if (!key) return console.error('✗ 需要 <key>');
      const res = await redis([
        ['HGETALL', `apikey:${key}`],
        ['GET', `apikey:total:${key}`],
        ['GET', `apikey:usage:${key}:${today()}`],
      ]);
      const flat = res[0]?.result || [];
      if (!flat.length) return console.log('(不存在)');
      const meta = {};
      for (let i = 0; i < flat.length; i += 2) meta[flat[i]] = flat[i + 1];
      console.log('Key:', key);
      console.table(meta);
      console.log('累计调用:', res[1]?.result || 0, '· 今日:', res[2]?.result || 0);
      break;
    }
    case 'list': {
      // SCAN 遍历所有 apikey:* (排除 usage/total 派生键)。
      let cursor = '0', keys = [];
      do {
        const res = await redis([['SCAN', cursor, 'MATCH', 'apikey:*', 'COUNT', '200']]);
        cursor = res[0]?.result?.[0] || '0';
        for (const k of (res[0]?.result?.[1] || [])) {
          if (!k.includes(':usage:') && !k.includes(':total:')) keys.push(k);
        }
      } while (cursor !== '0');
      if (!keys.length) { console.log('(暂无 key)'); break; }
      for (const k of keys) {
        const res = await redis([['HGETALL', k], ['GET', `apikey:total:${k.slice(7)}`]]);
        const flat = res[0]?.result || [];
        const m = {};
        for (let i = 0; i < flat.length; i += 2) m[flat[i]] = flat[i + 1];
        console.log(`${m.active === '0' ? '✗' : '✓'} ${k.slice(7)}  [${m.plan}/${m.dailyLimit}]  累计${res[1]?.result || 0}  ${m.label || ''}`);
      }
      break;
    }
    default:
      console.log('命令: create <plan> <dailyLimit> [label] | disable <key> | enable <key> | info <key> | list');
  }
}

main().catch((e) => { console.error('✗', e.message); process.exit(1); });
