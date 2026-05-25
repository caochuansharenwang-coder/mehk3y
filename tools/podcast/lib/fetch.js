// 抓取 X 推文 → 干净 Markdown
// 直接复用已装的 qiaomu-anything-to-notebooklm/scripts/fetch_url.sh
// 这样付费墙级联 + 反爬策略一并继承

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';

const exec = promisify(execFile);
const FETCH_SH = join(homedir(), '.claude/skills/qiaomu-anything-to-notebooklm/scripts/fetch_url.sh');

/**
 * 抓 X URL → 返回 { title, body, raw }
 */
export async function fetchSource(url) {
  const { stdout } = await exec('bash', [FETCH_SH, url], {
    maxBuffer: 10 * 1024 * 1024, // 10MB
    timeout: 120_000,
  });

  return parseMarkdown(stdout, url);
}

function parseMarkdown(raw, url) {
  // fetch_url.sh 的 jina.ai 输出格式带 frontmatter:
  //   Title: ...
  //   URL Source: ...
  //   Published Time: ...
  //   Markdown Content:
  //   <body>
  // 也可能是 YAML 风格 frontmatter（X 路径下）
  const titleMatch = raw.match(/^[Tt]itle:\s*["']?(.+?)["']?$/m);
  const title = (titleMatch?.[1] ?? 'Untitled').trim();

  // 切掉 frontmatter，只留正文
  let body = raw;
  const splitMarkers = ['Markdown Content:', '---\n\n'];
  for (const marker of splitMarkers) {
    const idx = body.indexOf(marker);
    if (idx > -1) {
      body = body.slice(idx + marker.length).trim();
      break;
    }
  }

  // 移除 markdown 图片占位符（TTS 读不出来）
  body = body.replace(/!\[.*?\]\([^)]+\)/g, '');
  // 移除单独的图片链接行
  body = body.replace(/^\[!\[.*?\]\([^)]+\)\]\([^)]+\)$/gm, '');
  // 合并多余空行
  body = body.replace(/\n{3,}/g, '\n\n').trim();

  return { title, body, raw, source: url };
}
