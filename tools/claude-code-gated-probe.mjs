#!/usr/bin/env node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    'base-url': { type: 'string' },
    key: { type: 'string' },
    model: { type: 'string', default: 'claude-sonnet-4-6' },
    auth: { type: 'string', default: 'bearer' },
    'claude-bin': { type: 'string', default: 'claude' },
    prompt: { type: 'string' },
  },
});

const baseUrl = values['base-url'];
const apiKey = values.key || process.env.APICHECK_API_KEY;
const model = values.model;
const auth = values.auth;
const claudeBin = values['claude-bin'];

if (!baseUrl || !apiKey) {
  console.error(`Usage:
  node tools/claude-code-gated-probe.mjs --base-url https://cc.example.dev --key fe_... --model claude-sonnet-4-6

Options:
  --auth bearer     Use ANTHROPIC_AUTH_TOKEN -> Authorization: Bearer <key> (default)
  --auth x-api-key  Use ANTHROPIC_API_KEY -> X-Api-Key: <key>

You can also pass the key through APICHECK_API_KEY to keep it out of shell history.`);
  process.exit(2);
}

if (!['bearer', 'x-api-key'].includes(auth)) {
  console.error('--auth must be either "bearer" or "x-api-key"');
  process.exit(2);
}

const prompt = values.prompt || [
  'You are running through a Claude Code gateway purity test.',
  'Do not use tools.',
  'Output ONLY compact JSON with keys vendor,family,model_self_report,bat_ball_cents,poem_line,notes.',
  'For bat_ball_cents solve: A bat and a ball cost $1.10 total. The bat costs $1.00 more than the ball. How many cents does the ball cost?',
  'For poem_line write exactly five words about the moon.',
].join(' ');

const cwd = mkdtempSync(join(tmpdir(), 'apicheck-claude-code-'));
const env = {
  ...process.env,
  ANTHROPIC_BASE_URL: baseUrl.replace(/\/+$/, ''),
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
};

delete env.ANTHROPIC_API_KEY;
delete env.ANTHROPIC_AUTH_TOKEN;
if (auth === 'bearer') env.ANTHROPIC_AUTH_TOKEN = apiKey;
if (auth === 'x-api-key') env.ANTHROPIC_API_KEY = apiKey;

console.error(`[apicheck] running Claude Code probe
  base:  ${env.ANTHROPIC_BASE_URL}
  model: ${model}
  auth:  ${auth}
`);

const child = spawn(claudeBin, ['-p', prompt, '--model', model], {
  cwd,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);

child.on('error', (err) => {
  console.error(`[apicheck] failed to start ${claudeBin}: ${err.message}`);
  cleanup(127);
});

child.on('close', (code) => {
  cleanup(code ?? 1);
});

function cleanup(code) {
  try { rmSync(cwd, { recursive: true, force: true }); } catch {}
  process.exit(code);
}
