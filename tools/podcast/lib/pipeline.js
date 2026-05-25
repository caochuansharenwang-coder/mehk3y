// 抽象出来的端到端流水线，供 CLI (index.js) 和 HTTP server (server.js) 共用
// 通过 onProgress 回调把阶段/进度通知给调用方

import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchSource } from './fetch.js';
import { generateScript, estimateMinutes } from './script.js';
import { synthesizeAll } from './tts.js';
import { concatMp3s, cleanupTempLines } from './concat.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_ROOT = join(__dirname, '..', 'output');

/**
 * 端到端跑一次播客生成。
 *
 * @param {string | { url?: string, text?: string, title?: string }} source
 *        - string: 当 URL 处理 (向下兼容 CLI)
 *        - { url }: 抓取该 URL
 *        - { text, title? }: 直接用粘贴文本, 跳过抓取
 * @param {{ maxMinutes?: number, keepTemp?: boolean }} opts
 * @param {(update: object) => void} onProgress 阶段/进度通知
 * @returns {Promise<{ runDir: string, audioPath: string, title: string, duration: number, scriptText: string, sourceMd: string }>}
 */
export async function runPipeline(source, { maxMinutes = 15, keepTemp = false } = {}, onProgress = () => {}) {
  // 标准化输入
  if (typeof source === 'string') source = { url: source };
  if (!source.url && !source.text) throw new Error('runPipeline: 需要 url 或 text');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runDir = join(OUTPUT_ROOT, stamp);
  await mkdir(runDir, { recursive: true });

  // 1) 拿到正文 (抓取 / 粘贴文本)
  let src;
  if (source.text) {
    // 粘贴模式 - 跳过抓取
    const body = source.text.trim();
    const title = (source.title || body.slice(0, 30).replace(/\s+/g, ' ')).trim() || 'Untitled';
    src = { title, body, source: 'pasted-text' };
    onProgress({ stage: 'fetched', title, sourceChars: body.length });
  } else {
    onProgress({ stage: 'fetching' });
    src = await fetchSource(source.url);
    onProgress({ stage: 'fetched', title: src.title, sourceChars: src.body.length });
  }
  await writeFile(join(runDir, 'source.md'), `# ${src.title}\n\n${src.body}\n\n---\n来源: ${src.source}\n`);

  // 2) 剧本
  onProgress({ stage: 'scripting' });
  const { lines, raw, usage } = await generateScript(src, { maxMinutes });
  const est = estimateMinutes(lines);
  const scriptText = lines.map((l) => `${l.speaker === 'A' ? '赵老师' : '小雪'}: ${l.text}`).join('\n\n');
  await writeFile(join(runDir, 'script.txt'), scriptText);
  await writeFile(join(runDir, 'script.raw.txt'), raw);
  onProgress({
    stage: 'scripted',
    lineCount: lines.length,
    scriptChars: est.totalChars,
    estimatedMinutes: est.minutes,
    deepseekTokens: usage?.total_tokens,
  });

  // 3) TTS
  const providerName = (process.env.TTS_PROVIDER || 'edge').toLowerCase();
  const isEdge = providerName === 'edge';
  const linesDir = join(runDir, 'lines');
  await mkdir(linesDir, { recursive: true });

  onProgress({ stage: 'synthesizing', provider: providerName, totalLines: lines.length, currentLine: 0 });
  const ttsResult = await synthesizeAll(lines, {
    outDir: linesDir,
    concurrency: isEdge ? 4 : 2,
    gapMs: isEdge ? 0 : 200,
    onProgress: (done, total) => {
      onProgress({ stage: 'synthesizing', provider: providerName, totalLines: total, currentLine: done });
    },
  });
  onProgress({ stage: 'synthesized', voiceA: ttsResult.voiceA, voiceB: ttsResult.voiceB });

  // 4) 拼接
  onProgress({ stage: 'concating' });
  const slug = src.title.replace(/[\s\/\\:*?"<>|👑]+/g, '_').slice(0, 40);
  const audioPath = join(runDir, `${slug || 'podcast'}.mp3`);
  await concatMp3s(ttsResult.paths, audioPath, { gapSeconds: 0.25 });
  if (!keepTemp) await cleanupTempLines(ttsResult.paths);

  onProgress({ stage: 'done', audioPath });

  return {
    runDir,
    audioPath,
    title: src.title,
    duration: est.minutes,
    scriptText,
    sourceMd: src.body,
    voiceA: ttsResult.voiceA,
    voiceB: ttsResult.voiceB,
    provider: providerName,
  };
}
