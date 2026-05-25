// TTS 调度层
// 根据 TTS_PROVIDER 选择 provider，统一对外暴露 synthesizeAll + getDefaults

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import * as edge from './providers/edge.js';
import * as minimax from './providers/minimax.js';
import * as dashscope from './providers/dashscope.js';
import * as local from './providers/local.js';

const PROVIDERS = { edge, minimax, dashscope, local };

export function getProvider() {
  const name = (process.env.TTS_PROVIDER || 'edge').toLowerCase();
  const p = PROVIDERS[name];
  if (!p) throw new Error(`未知 TTS_PROVIDER: ${name}, 可选: ${Object.keys(PROVIDERS).join(', ')}`);
  return { name, ...p };
}

/**
 * 按行批量合成. concurrency 控制并发, gapMs 是同步间最短间隔.
 *
 * @param {Array<{speaker:'A'|'B', text:string}>} lines
 * @param {{ outDir: string, voiceA?: string, voiceB?: string, concurrency?: number, gapMs?: number, onProgress?: (i:number,total:number)=>void }} opts
 * @returns {Promise<{ paths: string[], provider: string, voiceA: string, voiceB: string }>}
 */
export async function synthesizeAll(lines, { outDir, voiceA, voiceB, concurrency = 2, gapMs = 0, onProgress }) {
  const provider = getProvider();
  const upper = provider.name.toUpperCase();
  const vA = voiceA ?? process.env[`${upper}_VOICE_A`] ?? provider.DEFAULTS.voiceA;
  const vB = voiceB ?? process.env[`${upper}_VOICE_B`] ?? provider.DEFAULTS.voiceB;

  const total = lines.length;
  const paths = new Array(total);
  let done = 0;
  let nextIdx = 0;

  const worker = async () => {
    while (nextIdx < total) {
      const my = nextIdx++;
      const line = lines[my];
      const voice = line.speaker === 'A' ? vA : vB;
      const buf = await provider.synthesizeLine(line.text, { voice });
      const filename = join(outDir, `line_${String(my).padStart(4, '0')}_${line.speaker}.mp3`);
      await writeFile(filename, buf);
      paths[my] = filename;
      done++;
      onProgress?.(done, total);
      if (gapMs > 0 && nextIdx < total) await new Promise((r) => setTimeout(r, gapMs));
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));
  return { paths, provider: provider.name, voiceA: vA, voiceB: vB };
}
