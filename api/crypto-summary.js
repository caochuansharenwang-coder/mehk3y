// /api/crypto-summary — Crypto dashboard initial payload.
//
// This endpoint invokes the existing upstream adapters in-process. It never
// calls mehk3y.com/api/*, so there is no public-API recursion and the browser
// only spends one request on the initial dashboard load.

import btcPriceHandler from './btc-price.js';
import btcStatusHandler from './btc-status.js';
import fngHandler from './fng.js';
import wma200Handler from './wma200.js';
import btcOnchainHandler from './btc-onchain.js';
import ahr999Handler from './ahr999.js';
import mstrHandler from './mstr.js';
import ethPriceHandler from './eth-price.js';
import ethMarketHandler from './eth-market.js';
import ethGasHandler from './eth-gas.js';
import bmnrHandler from './bmnr.js';

// This file intentionally uses Vercel's Node Web Handler form: the Node
// runtime avoids Edge's low concurrent-connection ceiling while these
// independent upstream adapters run in parallel. The result is still cached
// at Vercel's CDN via the response headers below.

const DEFINITIONS = {
  btcPrice: {
    label: 'BTC 价格', source: 'OKX / CoinGecko', freshness: '实时（最多 15 秒边缘缓存）',
    ttl: 15_000,
    run: () => btcPriceHandler(),
  },
  btcStatus: {
    label: 'BTC 网络状态', source: 'mempool.space', freshness: '缓存（约 5 分钟）',
    ttl: 300_000,
    run: () => btcStatusHandler(),
  },
  fng: {
    label: '恐惧贪婪指数', source: 'Alternative.me', freshness: '日更（约 30 分钟边缘缓存）',
    ttl: 1_800_000,
    run: () => fngHandler(),
  },
  btcWma: {
    label: 'BTC 200 周均线', source: 'OKX / Binance', freshness: '缓存（约 6 小时）',
    ttl: 21_600_000,
    run: () => wma200Handler(new Request('https://internal/crypto-summary?asset=btc')),
  },
  btcOnchain: {
    label: 'BTC 链上估值', source: 'Looknode / CoinMetrics', freshness: '缓存（约 1 小时）',
    ttl: 3_600_000,
    run: () => btcOnchainHandler(),
  },
  ahr999: {
    label: 'AHR999', source: 'OKX / Binance', freshness: '缓存（约 6 小时）',
    ttl: 21_600_000,
    run: () => ahr999Handler(),
  },
  mstr: {
    label: '公司储备与 mNAV', source: 'Looknode', freshness: '缓存（约 30 分钟）',
    ttl: 1_800_000,
    run: () => mstrHandler(),
  },
  ethPrice: {
    label: 'ETH 价格', source: 'OKX / CoinGecko', freshness: '实时（最多 15 秒边缘缓存）',
    ttl: 15_000,
    run: () => ethPriceHandler(),
  },
  ethMarket: {
    label: 'ETH 市场与供应', source: 'CoinGecko', freshness: '缓存（约 5 分钟）',
    ttl: 300_000,
    run: () => ethMarketHandler(),
  },
  ethGas: {
    label: 'ETH Gas', source: 'Ethereum 公共 RPC', freshness: '实时（最多 15 秒边缘缓存）',
    ttl: 15_000,
    run: () => ethGasHandler(),
  },
  ethWma: {
    label: 'ETH 200 周均线', source: 'OKX / Binance', freshness: '缓存（约 6 小时）',
    ttl: 21_600_000,
    run: () => wma200Handler(new Request('https://internal/crypto-summary?asset=eth')),
  },
  bmnr: {
    label: 'BMNR 公司储备', source: 'CoinGecko', freshness: '缓存（约 5 分钟）',
    ttl: 300_000,
    run: () => bmnrHandler(),
  },
};

// Best-effort warm-isolate cache. Correctness never depends on it, but it
// prevents slow indicators from hitting upstream providers every time the
// 15-second aggregate CDN object is refreshed.
const groupCache = new Map();
const GROUP_TIMEOUT_MS = 10_000;

function withTimeout(promise, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timeout`)), GROUP_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function runGroup(key, definition, updatedAt) {
  const cached = groupCache.get(key);
  if (cached && Date.now() - cached.storedAt < definition.ttl) {
    return [key, cached.group];
  }
  try {
    // One slow provider must never hold the entire dashboard open. The
    // browser gives this endpoint 16 seconds, leaving time to return a useful
    // partial payload before the client starts its fallback path.
    const response = await withTimeout(definition.run(), definition.label);
    let data = null;
    try { data = await withTimeout(response.json(), `${definition.label} JSON`); } catch { /* handled below */ }

    if (!response.ok || !data || data.error) {
      const detail = data?.error || `HTTP ${response.status}`;
      throw new Error(detail);
    }

    const group = {
      ok: true,
      data,
      meta: {
        label: definition.label,
        source: definition.source,
        freshness: definition.freshness,
        updatedAt: data.asOf || updatedAt,
      },
    };
    groupCache.set(key, { storedAt: Date.now(), group });
    return [key, group];
  } catch (error) {
    return [key, {
      ok: false,
      data: null,
      error: String(error?.message || error || 'upstream failed'),
      meta: {
        label: definition.label,
        source: definition.source,
        freshness: definition.freshness,
        updatedAt,
      },
    }];
  }
}

export async function handleSummary() {
  const generatedAt = new Date().toISOString();
  const entries = await Promise.all(
    Object.entries(DEFINITIONS).map(([key, definition]) => runGroup(key, definition, generatedAt))
  );
  const groups = Object.fromEntries(entries);
  const total = entries.length;
  const successful = entries.filter(([, group]) => group.ok).length;
  const payload = {
    generatedAt,
    summary: { successful, failed: total - successful, total },
    groups,
  };

  return new Response(JSON.stringify(payload), {
    status: successful ? 200 : 503,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // One short-lived edge object replaces 12 initial browser API requests.
      'cache-control': 'public, max-age=5, s-maxage=15, stale-while-revalidate=60',
    },
  });
}

export default { fetch: handleSummary };
