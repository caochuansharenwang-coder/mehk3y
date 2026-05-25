# Podcast CLI (Phase 1)

X 推文 → 中文双人对谈播客（≤ 20 分钟）。

本地 CLI 跑通后再考虑 web 化（Phase 2）。

## 一次性准备

```bash
# 1. ffmpeg
brew install ffmpeg

# 2. 复制环境变量模板，填上真实 key
cd tools/podcast
cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY / MINIMAX_API_KEY / MINIMAX_GROUP_ID
```

API key 在哪拿：
- **DeepSeek**: https://platform.deepseek.com/ → API Keys → Create new
- **MiniMax**: https://platform.minimaxi.com/ → 接口密钥（API Key）+ 账户管理（Group ID），**两个都要**

## 生成一期播客

```bash
node --env-file=.env index.js "https://x.com/snail_9106/status/2055878441455464825"

# 指定时长
node --env-file=.env index.js "<X URL>" --minutes=20

# 保留分行临时音频（调试）
node --env-file=.env index.js "<X URL>" --keep-temp
```

输出在 `output/{timestamp}/`:
- `source.md` — 抓到的原文（fetch_url.sh 处理过）
- `script.txt` — 剧本（带主持人名）
- `script.raw.txt` — DeepSeek 原始返回
- `{title}.mp3` — 最终播客
- `lines/` — 分行音频（带 `--keep-temp` 才保留）

## 链路

```
X URL
  ├─[fetch_url.sh]──→ Markdown
  ├─[DeepSeek V3]───→ 双人剧本 (赵老师 ↔ 小雪)
  ├─[MiniMax T2A]──→ 每行单独合成
  └─[ffmpeg concat]─→ 最终 MP3
```

## 成本估算

每期 15-20 分钟播客：
- DeepSeek V3: ~¥0.05（剧本生成 ~8K tokens）
- MiniMax HD: ~¥0.6（合成 ~4000 字）
- **合计 ≈ ¥0.7**

## 调试

```bash
DEBUG=1 node --env-file=.env index.js "<X URL>"   # 打印 stack trace
```
