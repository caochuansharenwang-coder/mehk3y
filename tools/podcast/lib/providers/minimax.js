// MiniMax T2A v2 provider (付费, 默认禁用)
// 文档: https://platform.minimaxi.com/document/T2A%20V2

const TTS_URL = 'https://api.minimax.chat/v1/t2a_v2';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const DEFAULTS = {
  voiceA: 'presenter_male',
  voiceB: 'presenter_female',
  model: 'speech-02-turbo', // 默认改成 turbo (比 hd 便宜 ~5x)
  sampleRate: 32000,
};

/**
 * @param {string} text
 * @param {{ voice: string, speed?: number, vol?: number, model?: string, maxRetries?: number }} opts
 * @returns {Promise<Buffer>} mp3 buffer
 */
export async function synthesizeLine(text, {
  voice,
  speed = 1.0,
  vol = 1.0,
  model = DEFAULTS.model,
  maxRetries = 6,
}) {
  const apiKey = process.env.MINIMAX_API_KEY;
  const groupId = process.env.MINIMAX_GROUP_ID;
  if (!apiKey || !groupId) throw new Error('MINIMAX_API_KEY / MINIMAX_GROUP_ID 未配置');

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(`${TTS_URL}?GroupId=${groupId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        text,
        stream: false,
        voice_setting: { voice_id: voice, speed, vol, pitch: 0 },
        audio_setting: { sample_rate: DEFAULTS.sampleRate, bitrate: 128000, format: 'mp3', channel: 1 },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`MiniMax HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const status = data?.base_resp?.status_code;

    if (status === 1002 && attempt < maxRetries) {
      const backoff = Math.min(4000 * Math.pow(1.5, attempt), 20000);
      await sleep(backoff);
      continue;
    }

    if (status !== 0) {
      throw new Error(`MiniMax 业务错误 ${status}: ${data?.base_resp?.status_msg}`);
    }

    const audioHex = data?.data?.audio;
    if (!audioHex) {
      throw new Error(`MiniMax 返回缺少 audio 字段:\n${JSON.stringify(data).slice(0, 300)}`);
    }
    return Buffer.from(audioHex, 'hex');
  }
  throw new Error('MiniMax 重试次数耗尽，仍然限流');
}
