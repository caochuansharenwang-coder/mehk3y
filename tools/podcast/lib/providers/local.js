// Local CosyVoice2 HTTP provider (Windows self-hosted)
// Windows API returns audio/wav; convert to mp3 here so the existing concat pipeline stays unchanged.

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import ffmpegPath from 'ffmpeg-static';

const exec = promisify(execFile);

export const DEFAULTS = {
  voiceA: 'local-cosyvoice2-a',
  voiceB: 'local-cosyvoice2-b',
  sampleRate: 24000,
};

const DEFAULT_PROMPT_TEXT = '希望你以后能够做的比我还好呦。';

/**
 * @param {string} text
 * @param {{ voice?: string, maxRetries?: number }} opts
 * @returns {Promise<Buffer>} mp3 buffer
 */
export async function synthesizeLine(text, { maxRetries = 3 } = {}) {
  const url = process.env.LOCAL_TTS_URL;
  if (!url) throw new Error('LOCAL_TTS_URL 未配置');

  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const wav = await requestWav(text, url);
      return await wavToMp3(wav);
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw new Error(`Local CosyVoice2 TTS 失败 (重试 ${maxRetries} 次): ${lastErr?.message}`);
}

async function requestWav(text, url) {
  const timeoutMs = Number(process.env.LOCAL_TTS_TIMEOUT_MS || 120000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        prompt_text: process.env.LOCAL_TTS_PROMPT_TEXT || DEFAULT_PROMPT_TEXT,
        speed: Number(process.env.LOCAL_TTS_SPEED || 1),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText.slice(0, 500)}`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('audio/wav') && !contentType.includes('audio/x-wav')) {
      throw new Error(`Local TTS 返回非 WAV 内容: ${contentType || 'unknown content-type'}`);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new Error('Local TTS returned empty audio');
    return buf;
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(`Local TTS 请求超时 (${timeoutMs}ms)`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function wavToMp3(wavBuffer) {
  if (!ffmpegPath) throw new Error('ffmpeg-static 未正确安装, 请 npm install ffmpeg-static');

  const dir = await mkdtemp(join(tmpdir(), 'podcast-local-tts-'));
  const id = randomUUID();
  const wavPath = join(dir, `${id}.wav`);
  const mp3Path = join(dir, `${id}.mp3`);

  try {
    await writeFile(wavPath, wavBuffer);
    await exec(ffmpegPath, [
      '-y',
      '-i', wavPath,
      '-ac', '1',
      '-ar', String(DEFAULTS.sampleRate),
      '-b:a', '128k',
      mp3Path,
    ], { maxBuffer: 50 * 1024 * 1024 });
    return await readFile(mp3Path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
