# mehk3y.com

个人静态工具站，部署在 Vercel。**v2 视觉升级**：高级简约风、固定浅色界面、Geist 字体、统一 SVG 图标。

## 工具页面

| 路径 | 用途 |
|---|---|
| `/crypto` | BTC + ETH 实时链上指标合一：MVRV · ahr999 · Gas · MSTR / BMNR 储备 |
| `/ip` | 出口 IP、代理、DNS 解析器、WebRTC 与网络环境检测 |
| `/privacy` | 隐私说明 |
| `/admin` | 非首页入口：访问统计管理页 |

## 技术栈

- 静态 HTML + 原生 JS，无框架
- **自托管 Geist 字体**（Apache 2.0，vercel/geist-font）— `/fonts/Geist-Variable.woff2`
- **固定浅色界面**，不跟随系统外观切换
- 共享样式 `common.css` · 共享工具 `common.js`
- Vercel Serverless Functions (`api/`) · Edge Middleware 速率限制 (`middleware.js`)
- **隐私友好的第一方汇总统计**：尊重 DNT / GPC，不保存长期访客 ID、原始 IP、逐次访问事件、查询参数或设备硬件遥测
- 部署：Vercel

## 设计系统

| Token | 用途 |
|---|---|
| `--bg / --surface / --surface-2` | 三级背景层 |
| `--text / --text-2 / --dim / --faint` | 四级文字 |
| `--accent / --accent-fg` | 主按钮（双向反色） |
| `--tint-{red,green,blue,orange,purple,...}-bg/fg` | 浅色界面的提示色 |
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

## 环境变量

| 变量 | 作用 |
|---|---|
| `PROXYCHECK_KEY` | proxycheck.io 免费 key |
| `ADMIN_PASSWORD_HASH` | `/admin` 的 PBKDF2-SHA256 密码记录 |
| `ADMIN_SESSION_SECRET` | 独立的高熵会话签名密钥（至少 32 字符） |

后台默认关闭：只有两个 `ADMIN_*` 变量同时有效才会启用，缺少任一项时登录和旧 Cookie 都会 fail closed。生成示例：

```bash
# 将“你的强密码”替换为新密码；输出整行保存为 ADMIN_PASSWORD_HASH
ADMIN_PASSWORD='你的强密码' node -e "const c=require('crypto'),s=c.randomBytes(24),i=310000,h=c.pbkdf2Sync(process.env.ADMIN_PASSWORD,s,i,32,'sha256');console.log(['pbkdf2-sha256',i,s.toString('hex'),h.toString('hex')].join('$'))"
openssl rand -hex 32
```

将结果分别保存到 Vercel Production 环境变量，不要写入仓库，也不要用密码记录兼作会话密钥。代码仍可临时读取旧的 64 位 SHA-256 值，便于平滑迁移；完成轮换后应只使用 PBKDF2 格式。

## 文件布局

```
.
├── index.html               # 导航首页（v2 - SVG 图标 · JSON-LD）
├── *.html                   # 首页可达工具页面 + admin
├── common.css common.js     # 共享样式 + helpers
├── fonts/                   # Geist 字体（Apache 2.0）
├── icon.png icon-192.png    # 站点图标与 PWA 图标
├── *.js                     # 页面级脚本
├── api/                     # Vercel serverless 函数
├── middleware.js            # 速率限制
├── manifest.webmanifest     # PWA
├── vercel.json              # 路由 + CSP + 缓存
├── sitemap.xml robots.txt
├── og-image-20260715.jpg    # 版本化首页 / 通用分享图
└── tools/podcast/           # Phase 1 本地 CLI (不部署)
```

## 路由

`vercel.json` 启用 `cleanUrls` 与无尾斜杠规范 URL，所以 `*.html` 页面使用无后缀路径访问。独立 `/btc`、`/eth` 会永久跳转到 `/crypto` 中对应的 BTC / ETH 分区。

## License

私人项目，ARR。字体 Geist by Vercel (Apache 2.0)。
