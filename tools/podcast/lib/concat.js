// 用 ffmpeg 把一堆 mp3 按顺序拼成一个, 中间塞 gapSeconds 静音
// 用 ffmpeg-static 提供的 binary，并通过 aresample 统一采样率(各 provider 输出格式不同)

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { unlink } from 'node:fs/promises';
import ffmpegPath from 'ffmpeg-static';

const exec = promisify(execFile);

/**
 * @param {string[]} inputPaths
 * @param {string} outputPath
 * @param {{ gapSeconds?: number, sampleRate?: number }} opts
 */
export async function concatMp3s(inputPaths, outputPath, { gapSeconds = 0.3, sampleRate = 32000 } = {}) {
  if (!ffmpegPath) throw new Error('ffmpeg-static 未正确安装, 请 npm install ffmpeg-static');

  const N = inputPaths.length;
  if (N === 0) throw new Error('没有要拼接的文件');
  if (N === 1) {
    await exec('cp', [inputPaths[0], outputPath]);
    return;
  }

  // 输入: N 个 mp3 + (可选) 1 个 anullsrc 静音
  const args = [];
  for (const p of inputPaths) args.push('-i', p);

  const useSilence = gapSeconds > 0 && N > 1;
  if (useSilence) {
    args.push('-f', 'lavfi', '-t', String(gapSeconds),
      '-i', `anullsrc=channel_layout=mono:sample_rate=${sampleRate}`);
  }
  const silenceIdx = N;

  // 每个 audio 都先 aresample 统一到 sampleRate, 避免 concat filter 因采样率不一致报错
  const filterParts = [];
  for (let i = 0; i < N; i++) {
    filterParts.push(`[${i}:a]aresample=${sampleRate}[a${i}]`);
  }

  if (useSilence) {
    // anullsrc 复用为 N-1 份
    const silLabels = Array.from({ length: N - 1 }, (_, k) => `[s${k}]`).join('');
    filterParts.push(`[${silenceIdx}:a]asplit=${N - 1}${silLabels}`);

    // concat: [a0][s0][a1][s1]...[a_{N-1}]
    const seq = [];
    for (let i = 0; i < N; i++) {
      seq.push(`[a${i}]`);
      if (i < N - 1) seq.push(`[s${i}]`);
    }
    filterParts.push(`${seq.join('')}concat=n=${2 * N - 1}:v=0:a=1[out]`);
  } else {
    const seq = Array.from({ length: N }, (_, i) => `[a${i}]`).join('');
    filterParts.push(`${seq}concat=n=${N}:v=0:a=1[out]`);
  }

  args.push(
    '-filter_complex', filterParts.join(';'),
    '-map', '[out]',
    '-ac', '1',
    '-ar', String(sampleRate),
    '-b:a', '128k',
    '-y',
    outputPath
  );

  await exec(ffmpegPath, args, { maxBuffer: 50 * 1024 * 1024 });
}

export async function cleanupTempLines(paths) {
  await Promise.allSettled(paths.map((p) => unlink(p)));
}
