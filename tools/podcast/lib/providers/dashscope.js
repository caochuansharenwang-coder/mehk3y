// DashScope CosyVoice TTS provider (阿里云, 便宜 + 中文质量好)
// 走官方 WebSocket 流式协议
// 文档: https://help.aliyun.com/zh/dashscope/developer-reference/cosyvoice-large-model-for-speech-synthesis
//
// 常用 CosyVoice-v1 音色 (中文):
//   男声:
//     longcheng   龙橙   阳光男声 (推荐主持人 A)
//     longhua     龙华   标准男声
//     longshu     龙书   知识男声
//     loongbo     龙博   沉稳男声
//   女声:
//     longxiaochun 龙小淳 知性女声 (推荐主持人 B)
//     longwan      龙婉   知性女声
//     longxiaobai  龙小白 温暖女声
//     loongbella   龙宝   元气女声
//     loongstella  龙姐   大姐姐
//     loongnan     龙楠   邻家女孩

import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';

export const DEFAULTS = {
  voiceA: 'longcheng',
  voiceB: 'longxiaochun',
  model: 'cosyvoice-v1',
  sampleRate: 22050,
};

const WS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';

/**
 * @param {string} text
 * @param {{ voice: string, model?: string, maxRetries?: number }} opts
 * @returns {Promise<Buffer>}
 */
export async function synthesizeLine(text, { voice, model = DEFAULTS.model, maxRetries = 3 }) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await synthOnce(text, { voice, model });
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }
  throw new Error(`DashScope TTS 失败 (重试 ${maxRetries} 次): ${lastErr?.message}`);
}

function synthOnce(text, { voice, model }) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY 未配置');

  return new Promise((resolve, reject) => {
    const taskId = randomUUID().replace(/-/g, '');
    const chunks = [];
    let finished = false;

    const ws = new WebSocket(WS_URL, {
      headers: {
        Authorization: `bearer ${apiKey}`,
        'X-DashScope-DataInspection': 'enable',
      },
    });

    const cleanup = () => {
      try { ws.close(); } catch {}
    };

    const timer = setTimeout(() => {
      if (!finished) {
        cleanup();
        reject(new Error('DashScope TTS 超时 (30s)'));
      }
    }, 30000);

    ws.on('open', () => {
      // 1) run-task
      ws.send(JSON.stringify({
        header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
        payload: {
          task_group: 'audio',
          task: 'tts',
          function: 'SpeechSynthesizer',
          model,
          parameters: { voice, format: 'mp3', sample_rate: DEFAULTS.sampleRate },
          input: {},
        },
      }));
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        // 音频二进制流
        chunks.push(data);
        return;
      }
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      const event = msg?.header?.event;

      if (event === 'task-started') {
        // 2) continue-task: 发文本
        ws.send(JSON.stringify({
          header: { action: 'continue-task', task_id: taskId },
          payload: { input: { text } },
        }));
        // 3) finish-task
        ws.send(JSON.stringify({
          header: { action: 'finish-task', task_id: taskId },
          payload: { input: {} },
        }));
      } else if (event === 'task-finished') {
        finished = true;
        clearTimeout(timer);
        cleanup();
        if (chunks.length === 0) reject(new Error('DashScope 返回空音频'));
        else resolve(Buffer.concat(chunks));
      } else if (event === 'task-failed') {
        finished = true;
        clearTimeout(timer);
        cleanup();
        const code = msg?.header?.error_code || 'unknown';
        const text = msg?.header?.error_message || JSON.stringify(msg);
        reject(new Error(`DashScope task-failed [${code}]: ${text}`));
      }
    });

    ws.on('error', (err) => {
      finished = true;
      clearTimeout(timer);
      reject(err);
    });

    ws.on('close', () => {
      if (!finished) {
        clearTimeout(timer);
        reject(new Error('WebSocket 在完成前关闭'));
      }
    });
  });
}
