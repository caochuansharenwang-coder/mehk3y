# Basic English · 微信小程序

850 个 Ogden Basic English 核心词的小程序版本。

## 目录结构

```
miniprogram/
├── app.js / app.json / app.wxss   # 全局配置
├── project.config.json             # 开发者工具项目配置
├── sitemap.json                    # 收录规则
├── utils/
│   └── english.json                # 850 词数据（含 IPA、释义、例句、同义词）
└── pages/
    └── index/                      # 主页面
        ├── index.wxml              # 模板
        ├── index.wxss              # 样式
        ├── index.js                # 逻辑
        └── index.json              # 页面配置
```

## 如何运行

1. 下载安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. 打开开发者工具 → 「导入项目」→ 选择 `miniprogram/` 目录
3. AppID 选「测试号」或填入你自己的小程序 AppID（替换 `project.config.json` 里的 `touristappid`）
4. 编译运行

## 发布前配置

发音功能使用了**有道词典 TTS**：`https://dict.youdao.com/dictvoice`

发布前需要在微信公众平台后台配置 **request 合法域名白名单**：

- `https://dict.youdao.com`

否则真机预览/正式版小程序中发音会失败（开发工具勾选「不校验合法域名」可临时绕过）。

## 数据来源

- 词表：C.K. Ogden Basic English (1930)
- 音标：UK + US IPA（从 ogden.munch.love 提取）
- 中文释义、例句、同义词：人工整理

## 同源网页版

https://mehk3y.com/BasicEnglish
