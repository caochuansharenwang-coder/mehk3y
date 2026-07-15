// /api/eth-gas — 当前 ETH gas (Gwei), 多 RPC 兜底
// Edge Runtime, China-friendly

export const config = { runtime: 'edge' };

const race = (p, ms) => {
  let timer;
  return Promise.race([
    p,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); }),
  ]).finally(() => clearTimeout(timer));
};

const rpcCall = async (url, method, params = []) => {
  const r = await race(
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
    }).then(r => r.json()),
    6000
  );
  if (r.error) throw new Error(r.error.message || 'rpc error');
  return r.result;
};

const rpcs = [
  'https://ethereum-rpc.publicnode.com',
  'https://eth.llamarpc.com',
  'https://rpc.flashbots.net',
  'https://cloudflare-eth.com',
  'https://rpc.ankr.com/eth',
  'https://eth.drpc.org',
];

export default async function handler() {
  let gas = null;

  // Race the six providers in parallel (the Edge connection ceiling is six)
  // instead of waiting up to 72 seconds through two serial fallback loops.
  try {
    gas = await Promise.any(rpcs.map(async (rpc) => {
      const fh = await rpcCall(rpc, 'eth_feeHistory', ['0x1', 'latest', [50]]);
      const baseFeeHex = fh.baseFeePerGas[fh.baseFeePerGas.length - 1];
      const priorityHex = fh.reward?.[0]?.[0] || '0x0';
      const baseFee = parseInt(baseFeeHex, 16);
      const priority = parseInt(priorityHex, 16);
      const value = +((baseFee + priority) / 1e9).toFixed(2);
      if (!Number.isFinite(value) || value <= 0) throw new Error('invalid fee history');
      return value;
    }));
  } catch { /* fall back to eth_gasPrice below */ }

  if (gas == null) {
    try {
      gas = await Promise.any(rpcs.map(async (rpc) => {
        const hex = await rpcCall(rpc, 'eth_gasPrice');
        const value = +(parseInt(hex, 16) / 1e9).toFixed(2);
        if (!Number.isFinite(value) || value <= 0) throw new Error('invalid gas price');
        return value;
      }));
    } catch { /* handled as a 502 below */ }
  }

  return new Response(JSON.stringify({ gas }), {
    status: gas == null ? 502 : 200,
    headers: {
      'content-type':  'application/json; charset=utf-8',
      'cache-control': gas == null
        ? 'no-store'
        : 'public, max-age=15, s-maxage=15, stale-while-revalidate=60',
    },
  });
}
