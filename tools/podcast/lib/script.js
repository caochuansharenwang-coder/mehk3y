// DeepSeek 生成双人对谈剧本
// 输出严格格式：[{ speaker: 'A'|'B', text: string }, ...]

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

/**
 * @param {{ title: string, body: string, source: string }} src
 * @param {{ maxMinutes?: number, charsPerMinute?: number }} opts
 */
export async function generateScript(src, { maxMinutes = 15, charsPerMinute = 300 } = {}) {
  const targetChars = maxMinutes * charsPerMinute;
  const minChars = Math.floor(targetChars * 0.85);

  const systemPrompt = `你是一档名为「深度对谈」的中文播客的资深节目策划。你的任务是把一篇文章/帖子改编成两位主持人的口播对谈剧本。

主持人设定:
- **赵老师**(标记为 A): 男主持人, 理性派, 提问驱动, 喜欢逼问"那这背后的逻辑是什么"、"等等, 这里有个细节我没听懂", 偶尔会犀利地反驳。
- **小雪**(标记为 B): 女主持人, 感性派, 类比驱动, 喜欢用日常生活的例子解释复杂概念, 会主动接上一句"哦我懂了, 这就像..."。

剧本铁律(必须严格遵守):
1. **格式**: 每行必须是 \`A: ...\` 或 \`B: ...\`, 严格交替主导(允许一方连续 1-2 句, 但不能某一方主导太久)。
2. **不要任何旁白、不要 markdown 加粗、不要 emoji**。
3. **开场不要寒暄废话**(禁止"各位听众朋友大家好"这种), 直接用一个钩子拉听众下水, 比如以一个反直觉的数字/故事/问题开场。
4. **口语化**: 用真实的中文口语, 不要书面语。允许"嗯", "对", "我跟你讲"这种, 但不要堆砌, 一段最多一个。
5. **信息密度**: 不要把文章一字不漏复述。挑出 3-5 个核心论点, 每个论点配 1 个具体例子或数字。
6. **冲突感**: 偶尔让两位主持人对一个观点有不同看法, 但最后达成共识(或留下开放问题)。
7. **避雷**: 不要用"在我看来"、"我觉得这个东西"、"非常 amazing"、"绝绝子"、"yyds" 这种网络废话。

7.5 **数字读音规则**(TTS 用,极其重要,违反等于次品):
   - **金额/数量/比例必须用中文数字**: "2500 元" 写成 "两千五百元"; "30%" 写成 "百分之三十"; "10 万+" 写成 "十万加"; "1.5 倍" 写成 "一点五倍"。
   - **年份/月份/日期/时间也用中文**: "2026 年" 写成 "二零二六年"; "3 月 18 日" 写成 "三月十八日"; "下午 3 点" 写成 "下午三点"。
   - **专有名词中的数字保留阿拉伯**: "iPhone 16"、"GPT-4"、"Web3" 不动。
   - **简短计数**: "3 类人"、"5 个原因"、"7 天" 这种短数字也最好转中文("三类人"、"五个原因"、"七天")。
   - **强调**: 整篇剧本不允许出现长串阿拉伯数字读法歧义,如出现一次,整篇返工。
8. **时长目标(硬约束)**: 总字数 **${minChars}–${targetChars} 字**(目标 ${maxMinutes} 分钟, 语速 ${charsPerMinute} 字/分)。**少于 ${minChars} 字不合格**, 必须扩展。
   - 原文信息不够时, 用以下手段补充(按优先级):
     1. **历史案例 / 行业先例** - 类似事件以前发生过什么, 结果如何
     2. **具体数据 / 比例** - 用真实数字代替"很多/不少"这种笼统说法
     3. **主持人交锋** - 让两位主持人对一个观点表态相反, 形成 1-2 轮辩论
     4. **用户/受众视角** - 谁会被影响, 怎么被影响, 为什么在意
     5. **对比同类** - 跟相似产品/平台/方法做对比
   - **但不要**重复同一观点凑字数, 不要堆砌语气词, 不要无意义铺垫。
9. **收尾**: 最后一两轮要有总结陈词 + 留一个钩子(比如"如果你也想..."或"下一期我们聊..."), 但不要喊订阅。

输出要求:
- 直接输出剧本, 不要解释你的思路。
- 不要 \`\`\` 代码块包裹。
- 第一行就是 \`A: ...\` 或 \`B: ...\`。`;

  const userPrompt = `请基于以下内容创作播客剧本。

原标题: ${src.title}
原文链接: ${src.source}

原文内容:
${src.body}

(开始)`;

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY 未配置，请在 .env 设置');

  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.85,
      max_tokens: 8000,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DeepSeek HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error('DeepSeek 返回为空');

  const lines = parseScript(raw);
  if (lines.length < 4) {
    throw new Error(`剧本解析失败，只匹配到 ${lines.length} 行。原始返回:\n${raw.slice(0, 500)}`);
  }
  return { lines, raw, usage: data.usage };
}

/**
 * 把 "A: xxx\nB: yyy" 解析成 [{speaker, text}]
 * 兼容全角冒号 / 中文括号包裹的主持人名字
 */
function parseScript(text) {
  // 去掉可能的 ```...``` 包裹
  const stripped = text.replace(/^```[a-z]*\n?|\n?```$/g, '').trim();

  const result = [];
  const lineRe = /^\s*([AB])\s*[:：]\s*(.+?)\s*$/;

  for (const rawLine of stripped.split('\n')) {
    const m = rawLine.match(lineRe);
    if (!m) continue;
    const speaker = m[1].toUpperCase();
    const text = m[2].trim();
    if (text) result.push({ speaker, text });
  }
  return result;
}

export function estimateMinutes(lines, charsPerMinute = 260) {
  const totalChars = lines.reduce((s, l) => s + l.text.length, 0);
  return { totalChars, minutes: +(totalChars / charsPerMinute).toFixed(1) };
}
