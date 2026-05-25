#!/usr/bin/env node
// HTTP 服务 - 把 CLI 流水线包成 web API, 给 mehk3y.com/podcast.html 调用
//
// 启动: node --env-file=.env server.js
// 默认端口 3000, 可设 PORT
//
// 端点:
//   POST /api/jobs        创建任务 -> { jobId }
//   GET  /api/jobs/:id    查询状态 -> { stage, ... }
//   GET  /audio/:id.mp3   音频流 (Range 支持)
//   GET  /script/:id.txt  剧本文本
//   GET  /health          健康检查

import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { runPipeline } from './lib/pipeline.js';

const PORT = parseInt(process.env.PORT || '3000', 10);

// 允许来源 - 多个用逗号分隔. 开发可以用 *
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://mehk3y.com,http://localhost:3000,http://localhost:5173,*').split(',');

// 任务表 (in-memory, 重启会清空 - 对 MVP 够用)
const jobs = new Map();

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (c) => {
      total += c.length;
      if (total > maxBytes) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function publicJob(job) {
  // 把内部状态裁剪成对前端友好的视图
  const { id, status, stage, error, title, duration, currentLine, totalLines, estimatedMinutes, provider, voiceA, voiceB, createdAt, doneAt } = job;
  return {
    id, status, stage, error, title, duration,
    progress: stage === 'synthesizing' ? { current: currentLine || 0, total: totalLines || 0 } : null,
    estimatedMinutes,
    provider, voiceA, voiceB,
    audioUrl: status === 'done' ? `/audio/${id}.mp3` : null,
    scriptUrl: status === 'done' ? `/script/${id}.txt` : null,
    createdAt, doneAt,
  };
}

const server = createServer(async (req, res) => {
  cors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // POST /api/jobs
  if (req.method === 'POST' && url.pathname === '/api/jobs') {
    let body;
    try { body = JSON.parse(await readBody(req)); }
    catch (e) { return json(res, 400, { error: 'invalid JSON' }); }

    const { url: xUrl, text, title, minutes } = body || {};
    if ((!xUrl || typeof xUrl !== 'string') && (!text || typeof text !== 'string')) {
      return json(res, 400, { error: 'url 或 text 必填一个' });
    }
    if (text && text.length > 30000) {
      return json(res, 400, { error: 'text 超过 30k 字符上限' });
    }

    const maxMinutes = Math.min(Math.max(parseInt(minutes, 10) || 15, 3), 20);
    const id = randomUUID().split('-')[0];
    const job = {
      id,
      status: 'pending',
      stage: 'pending',
      mode: text ? 'text' : 'url',
      url: xUrl,
      maxMinutes,
      createdAt: Date.now(),
    };
    jobs.set(id, job);

    const sourceArg = text ? { text, title } : { url: xUrl };

    // 异步跑流水线
    runPipeline(sourceArg, { maxMinutes }, (update) => {
      Object.assign(job, update);
      job.status = update.stage === 'done' ? 'done' : 'running';
    }).then((result) => {
      Object.assign(job, { status: 'done', stage: 'done', ...result, doneAt: Date.now() });
    }).catch((err) => {
      Object.assign(job, { status: 'failed', stage: 'failed', error: err.message, doneAt: Date.now() });
      console.error(`[job ${id}] failed:`, err);
    });

    return json(res, 200, { jobId: id });
  }

  // GET /api/jobs/:id
  if (req.method === 'GET' && url.pathname.startsWith('/api/jobs/')) {
    const id = url.pathname.slice('/api/jobs/'.length);
    const job = jobs.get(id);
    if (!job) return json(res, 404, { error: 'job not found' });
    return json(res, 200, publicJob(job));
  }

  // GET /audio/:id.mp3 (Range 支持, 给音频播放器)
  if (req.method === 'GET' && url.pathname.startsWith('/audio/')) {
    const id = url.pathname.slice('/audio/'.length).replace(/\.mp3$/, '');
    const job = jobs.get(id);
    if (!job || job.status !== 'done' || !job.audioPath) {
      res.writeHead(404); res.end(); return;
    }
    serveFile(req, res, job.audioPath, 'audio/mpeg');
    return;
  }

  // GET /script/:id.txt
  if (req.method === 'GET' && url.pathname.startsWith('/script/')) {
    const id = url.pathname.slice('/script/'.length).replace(/\.txt$/, '');
    const job = jobs.get(id);
    if (!job || job.status !== 'done') {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(job.scriptText || '');
    return;
  }

  // GET /health
  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, { ok: true, jobs: jobs.size, uptime: process.uptime() });
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

function serveFile(req, res, path, contentType) {
  let stat;
  try { stat = statSync(path); } catch { res.writeHead(404); res.end(); return; }

  const range = req.headers.range;
  if (range) {
    const [unit, parts] = range.split('=');
    const [startS, endS] = (parts || '').split('-');
    const start = parseInt(startS, 10) || 0;
    const end = endS ? parseInt(endS, 10) : stat.size - 1;
    res.writeHead(206, {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Content-Length': end - start + 1,
    });
    createReadStream(path, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Content-Length': stat.size,
    });
    createReadStream(path).pipe(res);
  }
}

server.listen(PORT, () => {
  console.log(`🎙  Podcast server listening on http://localhost:${PORT}`);
  console.log(`   POST /api/jobs       创建任务`);
  console.log(`   GET  /api/jobs/:id   查询状态`);
  console.log(`   GET  /audio/:id.mp3  音频`);
  console.log(`   GET  /health         健康检查`);
});
