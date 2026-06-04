# mehk3y.com

个人静态工具站，部署在 Vercel。**v2 视觉升级**：高级简约风、深色模式、Geist 字体、统一 SVG 图标。

## 工具页面

| 路径 | 用途 |
|---|---|
| `/crypto` | BTC + ETH 实时链上指标合一：MVRV · ahr999 · Gas · MSTR / BMNR 储备 |
| `/ip` | IP / 浏览器指纹 / Claude 可用性 检测 |
| `/apicheck` | API 中转站检测 |
| `/apple` | Apple 礼品卡购买渠道（支付宝/微信） |
| `/BasicEnglish` | Basic English 850 核心词 |
| `/shadowrocket` | Shadowrocket 配置工具 |
| `/perler` | 照片转拼豆像素图 |
| `/Photograph/` | 拍立得照片工具 |
| `/yuepaomoniqi` | 约炮模拟器 |
| `/parking/` | 停车工具 |
| `/admin` | 非首页入口：访问统计管理页 |

## 技术栈

- 静态 HTML + 原生 JS，无框架
- **自托管 Geist 字体**（Apache 2.0，vercel/geist-font）— `/fonts/Geist-Variable.woff2`
- **浅 / 深 / 跟随系统** 三态主题，CSP 友好（`script-src 'self'`）
- 共享样式 `common.css` · 共享工具 `common.js` · 主题控制 `theme.js`
- Vercel Serverless Functions (`api/`) · Edge Middleware 速率限制 (`middleware.js`)
- 部署：Vercel

## 设计系统

| Token | 用途 |
|---|---|
| `--bg / --surface / --surface-2` | 三级背景层 |
| `--text / --text-2 / --dim / --faint` | 四级文字 |
| `--accent / --accent-fg` | 主按钮（双向反色） |
| `--tint-{red,green,blue,orange,purple,...}-bg/fg` | 提示色（自动适配深浅模式） |
| `--r-sm/md/lg/xl` | 圆角刻度 |
| `--shadow-sm/md/lg` | 阴影刻度 |
| `--ease` | 统一缓动 `cubic-bezier(0.16,1,0.3,1)` |

## 本地开发

```bash
# 仅前端
python3 -m http.server 8000
# → http://localhost:8000

# 带 Vercel serverless 函数
npx vercel dev
```

## 环境变量 (可选)

| 变量 | 作用 |
|---|---|
| `PROXYCHECK_KEY` | proxycheck.io 免费 key |

## 文件布局

```
.
├── index.html               # 导航首页（v2 - SVG 图标 · JSON-LD）
├── *.html                   # 首页可达工具页面 + admin
├── common.css common.js     # 共享样式 + helpers
├── theme.js                 # 三态主题控制
├── fonts/                   # Geist 字体（Apache 2.0）
├── icon.svg                 # 站点 SVG favicon
├── *.js                     # 页面级脚本
├── qrcode.js                # QR 库 (esim 页用)
├── api/                     # Vercel serverless 函数
├── middleware.js            # 速率限制
├── manifest.webmanifest     # PWA
├── vercel.json              # 路由 + CSP + 缓存
├── sitemap.xml robots.txt
├── og-image.png
└── tools/podcast/           # Phase 1 本地 CLI (不部署)
```

## 路由

`vercel.json` 启用 `cleanUrls`，所以 `*.html` 页面可用无后缀路径访问。独立 `/btc`、`/eth` 已下线并返回 410，数据集中到 `/crypto`。

## License

私人项目，ARR。字体 Geist by Vercel (Apache 2.0)。
