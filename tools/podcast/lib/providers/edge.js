// Edge TTS provider (microsoft, free)
// 用 msedge-tts 包，底层走 azure 神经语音的浏览器端点
// 中文常用音色:
//   zh-CN-YunxiNeural    男, 年轻自然, 适合主持人 A
//   zh-CN-XiaoxiaoNeural 女, 活泼自然, 适合主持人 B
//   zh-CN-YunjianNeural  男, 沉稳新闻播报
//   zh-CN-YunyangNeural  男, 新闻播报
//   zh-CN-XiaoyiNeural   女, 温暖
//   zh-CN-YunxiaNeural   男, 儿童友好

import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

export const DEFAULTS = {
  voiceA: 'zh-CN-YunxiNeural',
  voiceB: 'zh-CN-XiaoxiaoNeural',
  sampleRate: 24000,
};

/**
 * @param {string} text
 * @param {{ voice: string, maxRetries?: number }} opts
 * @returns {Promise<Buffer>} mp3 buffer
 */
export async function synthesizeLine(text, { voice, maxRetries = 3 }) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      const { audioStream } = await tts.toStream(text);

      const chunks = [];
      await new Promise((resolve, reject) => {
        audioStream.on('data', (c) => chunks.push(c));
        audioStream.on('end', resolve);
        audioStream.on('close', resolve);
        audioStream.on('error', reject);
      });

      // msedge-tts 可能把 close 当成 end 用，确保 chunks 拿到了
      if (chunks.length === 0) throw new Error('Edge TTS returned empty audio');
      return Buffer.concat(chunks);
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }
  throw new Error(`Edge TTS 失败 (重试 ${maxRetries} 次): ${lastErr?.message}`);
}
