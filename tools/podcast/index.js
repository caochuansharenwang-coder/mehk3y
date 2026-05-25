#!/usr/bin/env node
// CLI 入口 - 复用 lib/pipeline.js 流水线

import { runPipeline } from './lib/pipeline.js';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));
const minutesArg = args.find((a) => a.startsWith('--minutes='));
const maxMinutes = minutesArg ? parseInt(minutesArg.split('=')[1], 10) : 15;
const keepTemp = args.includes('--keep-temp');

if (!url) {
  console.error('用法: node --env-file=.env index.js <URL> [--minutes=N] [--keep-temp]');
  process.exit(1);
}

const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

try {
  const result = await runPipeline(url, { maxMinutes, keepTemp }, (u) => {
    if (u.stage === 'fetching')     log(`抓取 ${url}`);
    else if (u.stage === 'fetched') log(`✓ 拿到《${u.title}》, 原文 ${u.sourceChars} 字`);
    else if (u.stage === 'scripting') log(`生成剧本 (DeepSeek, 目标 ${maxMinutes} 分钟)...`);
    else if (u.stage === 'scripted') log(`✓ 剧本 ${u.lineCount} 行 / ${u.scriptChars} 字 / 估时 ${u.estimatedMinutes} 分钟 (tokens: ${u.deepseekTokens})`);
    else if (u.stage === 'synthesizing' && u.currentLine > 0 && (u.currentLine % 5 === 0 || u.currentLine === u.totalLines))
      log(`  TTS [${u.provider}] ${u.currentLine}/${u.totalLines}`);
    else if (u.stage === 'synthesized') log(`✓ TTS 完毕 (voice A=${u.voiceA}, voice B=${u.voiceB})`);
    else if (u.stage === 'concating')   log(`拼接 (ffmpeg)...`);
    else if (u.stage === 'done')        log(`✓ 最终: ${u.audioPath}`);
  });

  console.log(`\n🎧 完成! open "${result.audioPath}"\n`);
} catch (err) {
  console.error(`\n❌ 失败: ${err.message}`);
  if (process.env.DEBUG && err.stack) console.error(err.stack);
  process.exit(1);
}
