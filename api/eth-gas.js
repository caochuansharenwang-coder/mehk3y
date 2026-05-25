// /api/eth-gas — 当前 ETH gas (Gwei), 多 RPC 兜底
// Edge Runtime, China-friendly

export const config = { runtime: 'edge' };

const race = (p, ms) =>
  Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);

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

  for (const rpc of rpcs) {
    try {
      const fh = await rpcCall(rpc, 'eth_feeHistory', ['0x1', 'latest', [50]]);
      const baseFeeHex = fh.baseFeePerGas[fh.baseFeePerGas.length - 1];
      const priorityHex = fh.reward?.[0]?.[0] || '0x0';
      const baseFee = parseInt(baseFeeHex, 16);
      const priority = parseInt(priorityHex, 16);
      gas = +((baseFee + priority) / 1e9).toFixed(2);
      break;
    } catch { /* try next rpc */ }
  }

  if (gas == null) {
    for (const rpc of rpcs) {
      try {
        const hex = await rpcCall(rpc, 'eth_gasPrice');
        gas = +(parseInt(hex, 16) / 1e9).toFixed(2);
        break;
      } catch { /* try next */ }
    }
  }

  return new Response(JSON.stringify({ gas }), {
    headers: {
      'content-type':  'application/json; charset=utf-8',
      'cache-control': 'public, max-age=15, s-maxage=15, stale-while-revalidate=60',
    },
  });
}
