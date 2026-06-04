// /api/llm-probe — 中转站 / API 渠道纯度检测后端。
//
//   POST /api/llm-probe
//   body: { baseUrl, apiKey, model, format?: 'openai'|'anthropic' }
//
// 浏览器直连中转站会被 CORS 拦截 (而且站内 CSP 是 connect-src 'self')，
// 所以由本函数代为发起探测请求，再把结构化结果回传给前端 apicheck.js。
//
// 探测维度:
//   1. /models 列表是否包含目标模型
//   2. 基础对话: 延迟 / 状态码 / 返回的 model 字段是否被偷换 / id 格式 / system_fingerprint / usage
//   3. 身份探针: 让模型自报家门，揪出「挂 GPT-4 实际转便宜模型」
//   4. 流式 (stream:true) 是否真正可用
//   5. temp=0 两次一致性
//
// 注意: 本函数不存储任何 key，请求结束即丢弃。

export const config = { runtime: 'edge' };

const TIMEOUT_MS = 25000;
const MAX_BODY = 4096; // 截断回显，避免把超长正文塞回前端

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

// 规整 baseUrl: 去尾斜杠。允许用户填到 /v1 或根域。
function normalizeBase(raw) {
  let u = String(raw || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u.replace(/\/+$/, '');
}

// 拼接 chat/completions 端点：兼容用户填 .../v1 或根域两种写法。
function chatUrl(base, format) {
  if (format === 'anthropic') {
    return /\/v1$/.test(base) ? base + '/messages' : base + '/v1/messages';
  }
  if (/\/(chat\/completions)$/.test(base)) return base;
  if (/\/v1$/.test(base)) return base + '/chat/completions';
  return base + '/v1/chat/completions';
}

function modelsUrl(base, format) {
  if (format === 'anthropic') return /\/v1$/.test(base) ? base + '/models' : base + '/v1/models';
  if (/\/v1$/.test(base)) return base + '/models';
  return base + '/v1/models';
}

function authHeaders(apiKey, format) {
  if (format === 'anthropic') {
    return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  }
  return { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' };
}

async function timedFetch(url, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const ms = Date.now() - t0;
    return { res, ms };
  } catch (e) {
    const ms = Date.now() - t0;
    const aborted = e?.name === 'AbortError';
    return { error: aborted ? `请求超时 (>${TIMEOUT_MS / 1000}s)` : (e?.message || '网络错误'), ms };
  } finally {
    clearTimeout(t);
  }
}

// 从 openai / anthropic 两种响应里抽取统一字段。
function extract(format, data) {
  if (format === 'anthropic') {
    const text = Array.isArray(data?.content)
      ? data.content.map((c) => c?.text || '').join('')
      : '';
    return {
      content: text,
      model: data?.model || null,
      id: data?.id || null,
      systemFingerprint: null,
      usage: data?.usage || null,
      finishReason: data?.stop_reason || null,
    };
  }
  const choice = data?.choices?.[0];
  return {
    content: choice?.message?.content || '',
    model: data?.model || null,
    id: data?.id || null,
    systemFingerprint: data?.system_fingerprint || null,
    usage: data?.usage || null,
    finishReason: choice?.finish_reason || null,
  };
}

function buildBody(format, model, messages, opts = {}) {
  if (format === 'anthropic') {
    return JSON.stringify({
      model,
      max_tokens: opts.maxTokens || 256,
      temperature: opts.temperature ?? 0,
      stream: !!opts.stream,
      messages,
    });
  }
  return JSON.stringify({
    model,
    messages,
    temperature: opts.temperature ?? 0,
    max_tokens: opts.maxTokens || 256,
    stream: !!opts.stream,
  });
}

// 一次非流式对话探测。
async function probeChat(base, headers, format, model, messages, opts) {
  const url = chatUrl(base, format);
  const { res, ms, error } = await timedFetch(url, {
    method: 'POST',
    headers,
    body: buildBody(format, model, messages, opts),
  });
  if (error) return { ok: false, error, ms };
  const raw = await res.text();
  let data = null;
  try { data = JSON.parse(raw); } catch (_) {}
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || raw.slice(0, 300) || `HTTP ${res.status}`;
    return { ok: false, status: res.status, error: msg, ms };
  }
  return { ok: true, status: res.status, ms, ...extract(format, data) };
}

// 流式探测：只验证能否拿到 SSE 数据块，不收全文。
async function probeStream(base, headers, format, model) {
  const url = chatUrl(base, format);
  const msgs = [{ role: 'user', content: 'say hi' }];
  const { res, ms, error } = await timedFetch(url, {
    method: 'POST',
    headers,
    body: buildBody(format, model, msgs, { stream: true, maxTokens: 32 }),
  });
  if (error) return { ok: false, error, ms };
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    return { ok: false, status: res.status, error: txt.slice(0, 200) || `HTTP ${res.status}`, ms };
  }
  const ct = res.headers.get('content-type') || '';
  const looksSSE = /event-stream/.test(ct);
  let firstChunk = '';
  try {
    const reader = res.body?.getReader();
    if (reader) {
      const { value } = await reader.read();
      firstChunk = value ? new TextDecoder().decode(value).slice(0, 120) : '';
      reader.cancel().catch(() => {});
    }
  } catch (_) {}
  const gotData = looksSSE || /^data:/m.test(firstChunk) || firstChunk.length > 0;
  return { ok: gotData, contentType: ct, ms, sample: firstChunk };
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  let body;
  try { body = await request.json(); } catch (_) { return json({ ok: false, error: '请求体不是合法 JSON' }, 400); }

  const base = normalizeBase(body.baseUrl);
  const apiKey = String(body.apiKey || '').trim();
  const model = String(body.model || '').trim();
  const format = body.format === 'anthropic' ? 'anthropic' : 'openai';

  if (!base) return json({ ok: false, error: '请填写中转站地址 (Base URL)' }, 400);
  if (!apiKey) return json({ ok: false, error: '请填写 API Key' }, 400);
  if (!model) return json({ ok: false, error: '请填写要检测的模型名' }, 400);
  // 仅允许 http(s)，挡住 file:// 之类的 SSRF 尝试。
  if (!/^https?:\/\//i.test(base)) return json({ ok: false, error: '地址必须以 http(s):// 开头' }, 400);

  const headers = authHeaders(apiKey, format);
  const result = { ok: true, model, format, base, probes: {}, ts: Date.now() };

  // —— 1. /models 列表 ——
  const mUrl = modelsUrl(base, format);
  const mFetch = await timedFetch(mUrl, { method: 'GET', headers });
  if (mFetch.error) {
    result.probes.models = { ok: false, error: mFetch.error, ms: mFetch.ms };
  } else {
    const txt = await mFetch.res.text();
    let mData = null; try { mData = JSON.parse(txt); } catch (_) {}
    const list = Array.isArray(mData?.data) ? mData.data : Array.isArray(mData) ? mData : [];
    const ids = list.map((x) => x?.id || x?.name).filter(Boolean);
    result.probes.models = {
      ok: mFetch.res.ok,
      status: mFetch.res.status,
      ms: mFetch.ms,
      total: ids.length,
      listed: ids.includes(model),
      sample: ids.slice(0, 60),
    };
  }

  // —— 2. 基础对话 (身份探针合并到这一发，省一次调用) ——
  // 让模型用固定 JSON 自报家门 + 一道确定性算术题 (验证 temp=0 一致性)。
  const idPrompt = [
    { role: 'system', content: 'You are a diagnostic endpoint. Answer concisely.' },
    {
      role: 'user',
      content:
        'Output ONLY a minified JSON object, no markdown, with keys: ' +
        '"vendor" (the company that built you, e.g. OpenAI/Anthropic/Google/Meta/DeepSeek/Alibaba), ' +
        '"family" (your model family/name as YOU know it), ' +
        '"cutoff" (your knowledge cutoff, YYYY-MM). ' +
        'Then a newline, then the exact string: 7*8=56? answer with one word yes or no.',
    },
  ];
  const main = await probeChat(base, headers, format, model, idPrompt, { temperature: 0, maxTokens: 200 });
  result.probes.chat = main.ok
    ? {
        ok: true, status: main.status, ms: main.ms,
        returnedModel: main.model, id: main.id,
        systemFingerprint: main.systemFingerprint,
        usage: main.usage, finishReason: main.finishReason,
        content: (main.content || '').slice(0, MAX_BODY),
      }
    : { ok: false, status: main.status || null, error: main.error, ms: main.ms };

  // 只有基础对话成功才继续后续探测，否则没意义。
  if (main.ok) {
    // —— 3. 一致性：再发一次相同请求，比对正文 ——
    const repeat = await probeChat(base, headers, format, model, idPrompt, { temperature: 0, maxTokens: 200 });
    if (repeat.ok) {
      const a = (main.content || '').trim();
      const b = (repeat.content || '').trim();
      result.probes.consistency = {
        ok: true, ms: repeat.ms,
        identical: a === b,
        // 简单相似度：较短串占较长串的最长公共前缀比例，给前端一个参考。
        prefixRatio: a && b ? commonPrefix(a, b) / Math.max(a.length, b.length) : 0,
        secondModel: repeat.model,
      };
    } else {
      result.probes.consistency = { ok: false, error: repeat.error };
    }

    // —— 4. 流式 ——
    result.probes.stream = await probeStream(base, headers, format, model);

    // —— 5. 行为指纹：一道有唯一正确答案、弱模型易答错的题，作为「是否真高端模型」的辅助信号。
    //    仅作参考 (现代模型大多能答对)，主要价值是把答案原文摆给用户自己判断。
    const fp = await probeChat(base, headers, format, model, [
      { role: 'user', content: 'Solve and reply with ONLY the final number, no explanation. A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How many cents does the ball cost?' },
    ], { temperature: 0, maxTokens: 40 });
    result.probes.behavior = fp.ok
      ? { ok: true, ms: fp.ms, content: (fp.content || '').slice(0, 200) }
      : { ok: false, error: fp.error };
  }

  // —— 6. 综合分析 (在后端给出 signals，前端负责展示判定) ——
  result.analysis = analyze(result, model);

  return json(result);
}

function commonPrefix(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

// 把各探针结果归纳成可读 signals + 一个粗判定。
// 判定是启发式的，不能 100% 证明造假，仅作参考 —— 前端会写明这一点。
function analyze(r, requested) {
  const signals = [];
  const chat = r.probes.chat || {};
  let score = 0; // 越高越「干净」，满分 100

  // 门禁/拒绝识别：有些渠道 (尤其「Claude Code 专用」中转) 会拒绝常规 API 调用，
  // 表现为 3xx 跳转、纯文本 Service Unavailable，或返回一句固定文案 (如 "Please use Claude Code CLI")。
  // 这类情况无法测纯度，但要明确告诉用户「是被门禁挡了」，而不是笼统报无法连接。
  const GATE_RE = /(please use|only.*(via|through|use)).{0,30}(claude\s*code|cli)|claude\s*code\s*cli|仅(限|供).*(cli|claude\s*code|客户端)|use\s+claude\s+code/i;
  const gateText = (chat.content || '') + ' ' + (chat.error || '');
  const looksGated =
    GATE_RE.test(gateText) ||
    (!chat.ok && (String(chat.status || '').startsWith('3') || /service unavailable|forbidden|use proxy/i.test(chat.error || '')));

  if (looksGated) {
    return {
      verdict: 'gated', score: 0,
      signals: [
        { level: 'bad', text: '该渠道拒绝常规 API 调用，疑似「Claude Code / CLI 专用」中转' +
          (chat.status ? `（HTTP ${chat.status}）` : '') + '：' + ((chat.content || chat.error || '').slice(0, 120)) },
        { level: 'info', text: '此类渠道只放行特定客户端（如真实 Claude Code CLI），无法通过本工具检测纯度。要测只能把对应客户端指向它实跑一轮。' },
      ],
    };
  }

  if (!chat.ok) {
    return { verdict: 'unreachable', score: 0, signals: [{ level: 'bad', text: '基础对话请求失败，无法检测：' + (chat.error || '未知错误') }] };
  }
  score = 60; // 能正常对话，先给基准分

  // model 字段是否被偷换
  const returned = (chat.returnedModel || '').toLowerCase();
  const want = requested.toLowerCase();
  if (chat.returnedModel) {
    if (returned === want) {
      signals.push({ level: 'good', text: `返回的 model 字段与请求一致 (${chat.returnedModel})` });
      score += 12;
    } else if (returned.includes(want) || want.includes(returned)) {
      signals.push({ level: 'warn', text: `返回的 model 字段为 ${chat.returnedModel}，与请求 ${requested} 不完全一致（可能是版本号差异）` });
      score += 4;
    } else {
      signals.push({ level: 'bad', text: `⚠ 返回的 model 字段是 ${chat.returnedModel}，与你请求的 ${requested} 完全不同 — 中转站可能把请求转发到了别的模型` });
      score -= 25;
    }
  } else {
    signals.push({ level: 'warn', text: '响应里没有 model 字段（部分中转站会抹掉，无法核对）' });
  }

  // id 格式指纹
  if (chat.id) {
    if (r.format === 'openai' && /^chatcmpl-/.test(chat.id)) {
      signals.push({ level: 'good', text: `响应 id 为标准 OpenAI 格式 (${chat.id.slice(0, 16)}…)` });
      score += 6;
    } else if (r.format === 'anthropic' && /^msg_/.test(chat.id)) {
      signals.push({ level: 'good', text: `响应 id 为标准 Anthropic 格式 (${chat.id.slice(0, 16)}…)` });
      score += 6;
    } else {
      signals.push({ level: 'warn', text: `响应 id 格式非标准 (${chat.id.slice(0, 24)}…)，可能由中转站自行生成` });
    }
  }

  // system_fingerprint：真 OpenAI 较新模型通常会带
  if (r.format === 'openai') {
    if (chat.systemFingerprint) {
      signals.push({ level: 'good', text: `带有 system_fingerprint (${chat.systemFingerprint})，更像官方直连` });
      score += 6;
    } else {
      signals.push({ level: 'info', text: '无 system_fingerprint（部分模型/中转本就不返回，仅供参考）' });
    }
  }

  // usage
  if (chat.usage && (chat.usage.total_tokens || chat.usage.input_tokens || chat.usage.completion_tokens != null)) {
    signals.push({ level: 'good', text: '返回了 token usage 统计' });
    score += 4;
  } else {
    signals.push({ level: 'warn', text: '未返回 token usage（无法核对计费口径）' });
  }

  // 身份探针：从正文里找 vendor，和请求模型的「应有厂商」对比
  const expectedVendor = guessVendor(requested);
  const content = chat.content || '';
  const claimedVendor = extractVendor(content);
  if (claimedVendor) {
    if (!expectedVendor) {
      signals.push({ level: 'info', text: `模型自报厂商：${claimedVendor}` });
    } else if (claimedVendor.toLowerCase().includes(expectedVendor) || expectedVendor.includes(claimedVendor.toLowerCase())) {
      signals.push({ level: 'good', text: `身份探针：模型自报为 ${claimedVendor}，与 ${requested} 的预期厂商一致` });
      score += 12;
    } else {
      signals.push({ level: 'bad', text: `⚠ 身份探针：你请求的是 ${requested}（应为 ${expectedVendor} 系），但模型自称 ${claimedVendor} — 强烈怀疑被转发到了其他厂商的模型` });
      score -= 30;
    }
  } else {
    signals.push({ level: 'info', text: '身份探针：模型未按要求自报厂商（不一定有问题，部分模型会拒答此类问题）' });
  }

  // 算术一致性 / 拒答
  if (/\b56\b/.test(content) || /\byes\b/i.test(content)) {
    signals.push({ level: 'good', text: '基础推理题 (7*8=56) 回答正确' });
    score += 3;
  }

  // 行为指纹：bat-and-ball 经典陷阱题，正确答案 5 分 (常见错答 10 分)。
  // 仅作辅助信号 —— 现代主流模型基本都能答对，但能筛掉部分被降级到的弱模型。
  const beh = r.probes.behavior;
  if (beh?.ok) {
    const txt = beh.content || '';
    if (/\b0?5\b\s*(cents|分|￠)?/.test(txt) && !/\b10\b/.test(txt)) {
      signals.push({ level: 'good', text: '行为指纹：陷阱推理题 (bat & ball) 答对 5 分' });
      score += 4;
    } else if (/\b10\b/.test(txt)) {
      signals.push({ level: 'warn', text: `行为指纹：陷阱题答错（答了含 10 的结果，弱模型典型错误）— 原文「${txt.slice(0, 40)}」` });
      score -= 6;
    } else {
      signals.push({ level: 'info', text: `行为指纹：陷阱题回答「${txt.slice(0, 40)}」（需自行判断对错，正确为 5）` });
    }
  }

  // temp=0 一致性
  const cons = r.probes.consistency;
  if (cons?.ok) {
    if (cons.identical) {
      signals.push({ level: 'good', text: 'temp=0 两次请求输出完全一致（确定性正常）' });
      score += 5;
    } else if (cons.prefixRatio > 0.6) {
      signals.push({ level: 'info', text: 'temp=0 两次输出高度相似但不完全相同（多数厂商正常现象）' });
    } else {
      signals.push({ level: 'warn', text: 'temp=0 两次输出差异较大 — 可能后端做了负载均衡，分发到了不同模型/实例' });
      score -= 5;
    }
  }

  // 流式
  const st = r.probes.stream;
  if (st) {
    if (st.ok) signals.push({ level: 'good', text: '流式输出 (stream) 可用' });
    else signals.push({ level: 'warn', text: '流式输出不可用或异常：' + (st.error || '未返回 SSE 数据') });
  }

  // /models
  const m = r.probes.models;
  if (m?.ok) {
    if (m.listed) signals.push({ level: 'good', text: `/models 列表包含 ${requested}（共 ${m.total} 个模型）` });
    else signals.push({ level: 'warn', text: `/models 列表中未找到 ${requested}（但仍能调用，部分中转不在列表里公开全部模型）` });
  }

  score = Math.max(0, Math.min(100, score));
  let verdict = 'clean';
  if (score < 45) verdict = 'suspect';
  else if (score < 70) verdict = 'caution';

  return { verdict, score, expectedVendor: expectedVendor || null, claimedVendor: claimedVendor || null, signals };
}

// 根据模型名猜「应有厂商」，用于身份探针比对。
function guessVendor(model) {
  const m = model.toLowerCase();
  if (/(gpt|o1|o3|o4|chatgpt|davinci|text-embedding)/.test(m)) return 'openai';
  if (/claude/.test(m)) return 'anthropic';
  if (/gemini|palm|bison/.test(m)) return 'google';
  if (/llama/.test(m)) return 'meta';
  if (/deepseek/.test(m)) return 'deepseek';
  if (/qwen|tongyi/.test(m)) return 'alibaba';
  if (/glm|chatglm/.test(m)) return 'zhipu';
  if (/grok/.test(m)) return 'xai';
  if (/mistral|mixtral/.test(m)) return 'mistral';
  if (/moonshot|kimi/.test(m)) return 'moonshot';
  return '';
}

// 从模型自报的 JSON / 文本里抽 vendor 关键字。
function extractVendor(text) {
  if (!text) return '';
  // 先试 JSON
  const jsonMatch = text.match(/\{[^{}]*"vendor"\s*:\s*"([^"]+)"[^{}]*\}/i);
  if (jsonMatch) return jsonMatch[1].trim();
  const kv = text.match(/"vendor"\s*:\s*"([^"]+)"/i);
  if (kv) return kv[1].trim();
  // 退化：关键字扫描
  const map = [
    ['anthropic', /anthropic|claude/i], ['openai', /openai|chatgpt/i],
    ['google', /google|gemini|deepmind/i], ['meta', /\bmeta\b|llama/i],
    ['deepseek', /deepseek/i], ['alibaba', /alibaba|qwen|tongyi/i],
    ['zhipu', /zhipu|chatglm|\bglm\b/i], ['xai', /\bxai\b|grok/i],
    ['mistral', /mistral/i], ['moonshot', /moonshot|kimi/i],
  ];
  for (const [name, re] of map) if (re.test(text)) return name;
  return '';
}
