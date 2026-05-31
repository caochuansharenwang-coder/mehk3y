/* main.js - 2D半挂车停车模拟器主程序 */

import { Vehicle, checkOBBCollision, normalizeAngle } from './physics.js';
import { Controls } from './controls.js';
import { CanvasRenderer } from './renderer.js';
import { AudioSynthesizer } from './audio.js';
import { LEVELS } from './levels.js';
import { t, localize, getLang, setLang, onLangChange, SUPPORTED_LANGS, LANG_NAMES } from './i18n.js';
import { SESSION_CONFIG, SessionTimer } from './session.js';
import { Auth } from './auth.js';
import { submitScore, getRank, getRankByTime, getTopN, startLeaderboardSession } from './leaderboard.js';
import { LevelEditor } from './editor.js';
import * as customLevels from './customLevels.js';
import { GamepadInput } from './gamepad.js';

// 第一步：仅该账号可创作/编辑关卡 (与 worker 的 LEVEL_AUTHOR_ALLOW 对应)；开放给所有人时去掉门即可
const BETA_EMAIL = 'tankxuu@gmail.com';

// 转义用户输入 (自建关卡名) 防 HTML 注入
function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// 成绩用时格式化 (带百分秒)：< 60s → "15.42s"；>= 60s → "1m 23.45s"
// 用百分秒整数化避免 toFixed 在 59.999... 这类临界值上少进一位
function formatScoreTime(seconds) {
    const hundredths = Math.round(Math.max(0, seconds) * 100);
    const totalSec = Math.floor(hundredths / 100);
    const cs = hundredths % 100;
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    const csStr = cs.toString().padStart(2, '0');
    return m > 0 ? `${m}m ${s}.${csStr}s` : `${s}.${csStr}s`;
}

class GameApp {
    constructor() {
        // 初始化核心模块
        this.controls = new Controls();
        this.canvas = document.getElementById('game-canvas');
        this.renderer = new CanvasRenderer(this.canvas);
        this.editor = new LevelEditor(this.canvas, this.renderer);
        this.editorActive = false;          // 编辑器是否打开 (打开时游戏循环交给 editor.draw)
        this.currentLevelIsCustom = false;  // 当前关卡是否自定义 (自定义不进在线排行榜)
        this.gamepad = new GamepadInput();  // Xbox 手柄输入
        this.gamepad.onAction = (name) => this._handleGamepadAction(name);
        this.audio = new AudioSynthesizer();
        
        // 游戏状态
        this.currentLevelId = 1;
        this.currentLevel = null;
        this.vehicle = null;
        
        // 统计指标
        this.timeElapsed = 0;
        this.collisionCount = 0;
        this.gameActive = false; // 是否在进行驾驶，为 false 时显示教学或结算面板
        
        // 对齐判定计时器 (要求对齐静止保持 1.5 秒)
        this.alignTimer = 0;
        this.alignDurationRequired = 1.5; 
        
        // 上一帧时间戳
        this.lastTime = 0;
        
        // 关卡完成记录
        this.completedLevels = JSON.parse(localStorage.getItem('truck_simulator_completed') || '[]');

        // 会话计时器 (默认关闭，启用方式见 src/session.js)
        this.session = new SessionTimer(SESSION_CONFIG);
        this.session.onLimit = () => this.handleSessionLimit();

        // 用户认证 (Google Sign-In)
        this.auth = new Auth();
        // 排行榜弹窗当前选中关卡 (排行榜按关卡切换)
        this.leaderboardLevelId = 1;
        // 结算排名区刷新请求序号 (并发时只让最新一次落地)
        this._rankRefreshSeq = 0;
        // 排行榜会话 nonce (开始关卡时拿，提交成绩时用；防止客户端篡改时间)
        this._leaderboardNonce = null;
        // 刚 submit 完服务端回的排名 (KV 最终一致性，立刻查可能查不到，直接用 submit 的返回值)
        this._lastSubmittedRank = null;
    }

    // 初始化 App
    init() {
        this.controls.init();
        this.renderer.resize();

        // 监听视口大小改变
        window.addEventListener('resize', () => {
            this.renderer.resize();
        });

        // 绑定网页顶部按钮
        this.bindHeaderButtons();
        // 绑定弹窗及引导按钮
        this.bindModalButtons();
        // 绑定音频自动解锁
        this.bindAudioUnlock();
        // 绑定地图拖动 (松手回到原跟随目标)
        this.bindMapDrag();
        // 绑定登录/排行榜
        this.bindAuthUI();
        // 绑定关卡编辑器 UI
        this.bindEditorUI();

        // 启动 Google Sign-In；GIS 按钮的语言由 script URL 的 ?hl= 决定，所以这里传当前语言进去
        this.auth.init(getLang());
        this.auth.onChange(() => {
            this.updateLoginPill();
            document.getElementById('login-modal').classList.add('hidden');
            const resultModalOpen = !document.getElementById('result-modal').classList.contains('hidden');
            if (this.auth.isSignedIn()) {
                // 刚登录：把收藏/历史与账号同步 (跨设备)，同步完若关卡弹窗开着则重绘这两区
                customLevels.syncPrefs(this.auth.user).then(changed => {
                    if (!changed) return;
                    const lm = document.getElementById('levels-modal');
                    if (lm && !lm.classList.contains('hidden')) { this.renderFavorites(); this.renderHistory(); this._syncFavBtn(); }
                });
                // 保留现有 nonce —— 它可能是游客模式下 server 已经记了开始时间的，
                // submit 会带 sessionToken 让 server 把成绩归到当前账号
                if (this.pendingScore) {
                    this._submitPendingScore();
                } else if (resultModalOpen) {
                    this.refreshResultRankSection();
                }
            } else {
                // 登出：旧 nonce 跟之前账号绑定，作废，换一个新的 guest 会话
                this._leaderboardNonce = null;
                this._lastSubmittedRank = null;
                this._startLeaderboardSession();
                if (resultModalOpen) this.refreshResultRankSection();
            }
        });
        this.updateLoginPill();

        // 应用初始语言；切语言时把 GIS 脚本也按新 hl 重载，按钮语言才能跟着切
        this.applyTranslations();
        onLangChange((lang) => {
            this.applyTranslations();
            this.auth.setLanguage(lang);
        });

        // 先读分享 id (loadLevel 会同步 URL、清掉 ?level，所以要在加载前取)
        const sharedId = new URLSearchParams(location.search).get('level');

        // 加载初始关卡
        this.loadLevel(this.currentLevelId);

        // 分享链接：?level=<id> → 拉取并直接游玩该自定义关卡
        if (sharedId) {
            customLevels.getLevel(sharedId).then(lvl => {
                if (lvl) this.loadLevelObject(lvl);
                else this.showToast(t('edSaveFailed'));
            }).catch(() => {});
        }

        // 启动帧循环
        requestAnimationFrame((t) => this.loop(t));
    }

    // 把所有 data-i18n 标记的元素文本刷新为当前语言；同时刷新动态显示的关卡名/教程
    applyTranslations() {
        document.documentElement.lang = getLang();
        // 页面 <title> 和 description meta 也跟着切
        document.title = t('pageTitle');
        const descMeta = document.getElementById('meta-description');
        if (descMeta) descMeta.setAttribute('content', t('pageDescription'));
        document.querySelectorAll('[data-i18n]').forEach(el => {
            el.textContent = t(el.getAttribute('data-i18n'));
        });
        if (this.currentLevel) {
            document.getElementById('current-level-name').textContent = localize(this.currentLevel.name);
            const tutTitle = document.getElementById('tutorial-title');
            const tutText = document.getElementById('tutorial-text');
            if (tutTitle) tutTitle.textContent = localize(this.currentLevel.name);
            if (tutText) {
                if (this.currentLevelIsCustom && !this.currentLevelIsTemp) this._renderCustomWelcome(this.currentLevel, tutText);
                else tutText.textContent = localize(this.currentLevel.tutorial);
            }
        }
        // 关卡弹窗开着 → 重绘卡片；菜单弹窗开着 → 同步语言下拉
        const levelsModal = document.getElementById('levels-modal');
        if (levelsModal && !levelsModal.classList.contains('hidden')) this.renderLevelsGrid();
        const menuModal = document.getElementById('menu-modal');
        if (menuModal && !menuModal.classList.contains('hidden')) this.renderLangSelect();
        // 编辑器发布按钮文案 (非 data-i18n，手动随语言刷新)
        if (this.editorActive) this._syncPublishUI();
        // 排行榜弹窗如果开着也重渲一遍
        const lbModal = document.getElementById('leaderboard-modal');
        if (lbModal && !lbModal.classList.contains('hidden')) {
            this.renderLeaderboardTabs();
            this.renderLeaderboardList();
        }
        // 结算弹窗里的排名区 (登录提示 / 排名文本切语言)
        const resultModal = document.getElementById('result-modal');
        if (resultModal && !resultModal.classList.contains('hidden')) {
            this.refreshResultRankSection();
        }
        // 登录弹窗开着的话，按新语言重渲 Google 按钮 (locale 跟随)
        const loginModal = document.getElementById('login-modal');
        if (loginModal && !loginModal.classList.contains('hidden') && this.auth) {
            this.auth.renderButton(document.getElementById('google-signin-container'), getLang());
        }
    }

    // 让玩家可以拖动 Canvas 来查看地图，松手后由 updateCamera 自动 lerp 回原跟随目标
    bindMapDrag() {
        const canvas = this.canvas;
        const camera = this.renderer.camera;
        let activeId = null;       // 当前生效的指针 ID (touch identifier 或 'mouse')
        let startClientX = 0;      // 指针起点 (CSS 像素)
        let startClientY = 0;
        let startCamX = 0;         // 相机起点 (世界坐标)
        let startCamY = 0;

        const onDown = (clientX, clientY, id) => {
            if (this.editorActive) return; // 编辑器自己处理画布指针
            if (activeId !== null) return;
            activeId = id;
            startClientX = clientX;
            startClientY = clientY;
            startCamX = camera.x;
            startCamY = camera.y;
            camera.isDragging = true;
        };

        const onMove = (clientX, clientY) => {
            if (!camera.isDragging) return;
            // 屏幕位移 → 世界位移：手指拖右，相机要往左移 (反向)
            const dx = (clientX - startClientX) / camera.zoom;
            const dy = (clientY - startClientY) / camera.zoom;
            camera.x = startCamX - dx;
            camera.y = startCamY - dy;
        };

        const onUp = () => {
            if (!camera.isDragging) return;
            camera.isDragging = false;
            activeId = null;
            // 不需要主动 snap：下一帧 updateCamera 会自动 lerp 回 introTarget 或车辆位置
        };

        // 鼠标：down 在 canvas 上，move/up 用 window (允许拖出 canvas)
        canvas.addEventListener('mousedown', (e) => {
            onDown(e.clientX, e.clientY, 'mouse');
        });
        window.addEventListener('mousemove', (e) => {
            if (activeId === 'mouse') onMove(e.clientX, e.clientY);
        });
        window.addEventListener('mouseup', () => {
            if (activeId === 'mouse') onUp();
        });

        // 触摸：单指拖动 (UI 控件如踏板/方向盘是独立 DOM 元素，touch 不会冒泡到 canvas)
        canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;
            const t = e.touches[0];
            onDown(t.clientX, t.clientY, t.identifier);
        }, { passive: true });

        canvas.addEventListener('touchmove', (e) => {
            if (activeId === null || activeId === 'mouse') return;
            for (let i = 0; i < e.changedTouches.length; i++) {
                const t = e.changedTouches[i];
                if (t.identifier === activeId) {
                    onMove(t.clientX, t.clientY);
                    e.preventDefault(); // 阻止页面滚动
                    return;
                }
            }
        }, { passive: false });

        const endIfMatch = (e) => {
            if (activeId === null || activeId === 'mouse') return;
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === activeId) {
                    onUp();
                    return;
                }
            }
        };
        canvas.addEventListener('touchend', endIfMatch);
        canvas.addEventListener('touchcancel', endIfMatch);
    }

    // 绑定音频解锁（当玩家在屏幕任意地方点击或触摸时解锁音频）
    bindAudioUnlock() {
        // 覆盖所有首次手势：click/touchstart 之外，还要 pointerdown(踩踏板/拖方向盘的 mousedown)
        // 和 keydown(键盘玩家)，否则首次手势不是 click 时声音一直解锁不了 (默认开着却不响)
        const events = ['pointerdown', 'touchstart', 'click', 'keydown'];
        const unlock = () => {
            this.audio.unlock();
            events.forEach(ev => window.removeEventListener(ev, unlock));
        };
        events.forEach(ev => window.addEventListener(ev, unlock));
    }

    // 绑定顶部 HUD 按钮
    bindHeaderButtons() {
        // 轨迹预测开关
        const btnPred = document.getElementById('btn-toggle-prediction');
        btnPred.addEventListener('click', () => {
            this.renderer.showPrediction = !this.renderer.showPrediction;
            btnPred.classList.toggle('active', this.renderer.showPrediction);
            this.showToast(t(this.renderer.showPrediction ? 'toastTrajectoryOn' : 'toastTrajectoryOff'));
        });

        // 声音开关
        const btnSound = document.getElementById('btn-toggle-sound');
        const soundIcon = document.getElementById('sound-icon');
        btnSound.addEventListener('click', () => {
            const isEnabled = !btnSound.classList.contains('active');
            btnSound.classList.toggle('active', isEnabled);
            this.audio.toggle(isEnabled);
            
            // 切换 SVG 图标状态 (简易处理)
            if (isEnabled) {
                soundIcon.innerHTML = `<path fill="currentColor" d="M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.85 14,18.71V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.77 16.5,12M3,9V15H7L12,20V4L7,9H3Z"/>`;
            } else {
                soundIcon.innerHTML = `<path fill="currentColor" d="M12,4L9.91,6.09L12,8.18M4.27,3L3,4.27L7.73,9H3V15H7L12,20V13.27L16.25,17.53C15.58,18.04 14.83,18.46 14,18.7V20.77C15.38,20.45 16.63,19.82 17.68,18.96L19.73,21L21,19.73L12,10.73M19,12C19,12.94 18.8,13.82 18.46,14.64L19.97,16.15C20.62,14.91 21,13.5 21,12C21,7.72 18,4.14 14,3.23V5.29C16.89,6.15 19,8.83 19,12M16.5,12C16.5,10.23 15.5,8.71 14,7.97V10.18L16.45,12.63C16.5,12.43 16.5,12.21 16.5,12Z"/>`;
            }
            this.showToast(t(isEnabled ? 'toastSoundOn' : 'toastSoundOff'));
        });

        // 重新开始按钮
        document.getElementById('btn-restart').addEventListener('click', () => {
            this.resetLevel();
        });

        // 右上角菜单 (语言/排行榜/开发者)
        document.getElementById('btn-levels-menu').addEventListener('click', () => {
            this.openMenuModal();
        });
        // 关卡名下拉 → 纯关卡选择
        document.getElementById('btn-level-switch').addEventListener('click', () => {
            this.openLevelsModal();
        });
        // 快捷键卡 键盘/手柄 tab 切换 (检测到手柄自动切到手柄 tab)
        this.bindTipsTabs();
    }

    bindTipsTabs() {
        const kbTab = document.getElementById('tips-tab-kb');
        const padTab = document.getElementById('tips-tab-pad');
        const kbPane = document.getElementById('tips-pane-kb');
        const padPane = document.getElementById('tips-pane-pad');
        if (!kbTab || !padTab) return;
        const show = (pad) => {
            kbTab.classList.toggle('active', !pad);
            padTab.classList.toggle('active', pad);
            kbPane.classList.toggle('hidden', pad);
            padPane.classList.toggle('hidden', !pad);
        };
        kbTab.addEventListener('click', () => show(false));
        padTab.addEventListener('click', () => show(true));
        // 接上手柄自动切到手柄 tab
        window.addEventListener('gamepadconnected', () => show(true));
    }

    // 右上角菜单弹窗
    openMenuModal() {
        this.renderLangSelect();
        document.getElementById('dev-info').classList.add('hidden');
        document.getElementById('menu-modal').classList.remove('hidden');
    }

    // 绑定弹窗按钮
    bindModalButtons() {
        // 教学层“开始练习”
        document.getElementById('btn-start-level').addEventListener('click', () => {
            document.getElementById('level-tutorial').classList.add('hidden');
            this.gameActive = true;
            this.controls.resetInputs();
            // 真正开始驾驶才向服务端申请会话，让 startedAt 对齐计时起点 (反作弊不误杀)
            this._startLeaderboardSession();
            // 关闭开场远景：先停留 1s，再以减半速度平滑放大并移动到车辆位置
            this.renderer.camera.introExitDelay = 1.0;
        });

        // 关卡选择弹窗“关闭”
        document.getElementById('btn-close-levels').addEventListener('click', () => {
            document.getElementById('levels-modal').classList.add('hidden');
        });

        // 未登录引导：登录后创建关卡
        document.getElementById('btn-signin-create').addEventListener('click', () => {
            document.getElementById('levels-modal').classList.add('hidden');
            this.openLoginModal();
        });

        // 浏览更多关卡 (画廊)
        document.getElementById('btn-browse-gallery').addEventListener('click', () => this.openGalleryModal());
        document.getElementById('btn-close-gallery').addEventListener('click', () => {
            document.getElementById('gallery-modal').classList.add('hidden');
        });
        document.getElementById('gallery-sort').addEventListener('change', (e) => this.renderGallery(e.target.value));

        // 收藏/取消收藏当前自制关
        document.getElementById('btn-fav-toggle').addEventListener('click', () => {
            if (!this.currentLevel || !this.currentLevelIsCustom || this.currentLevelIsTemp) return;
            customLevels.toggleFavorite(this.currentLevel, this.auth.user);
            this._syncFavBtn();
            this.renderFavorites();
        });

        // 结算面板“下一关”
        document.getElementById('btn-next-level').addEventListener('click', () => {
            document.getElementById('result-modal').classList.add('hidden');
            // 自定义关 / 最后一关：没有"下一关"，改为打开关卡选择
            const ordered = this.accessibleLevels();
            const isLast = ordered.length > 0 && ordered[ordered.length - 1].id === this.currentLevelId;
            if (this.currentLevelIsCustom || isLast) { this.openLevelsModal(); return; }
            const idx = ordered.findIndex(l => l.id === this.currentLevelId);
            const next = ordered[idx + 1] || ordered[0];
            this.loadLevel(next.id);
        });

        // 会话弹窗：继续 (走 SESSION_CONFIG.requestContinue 钩子，可接入广告/积分)
        document.getElementById('btn-session-continue').addEventListener('click', async () => {
            const btn = document.getElementById('btn-session-continue');
            if (btn.disabled) return;
            btn.disabled = true;
            try {
                const result = await SESSION_CONFIG.requestContinue({
                    levelId: this.currentLevelId,
                    elapsedSeconds: this.session.elapsed
                });
                if (result && result.allow) {
                    document.getElementById('session-modal').classList.add('hidden');
                    this.session.reset();
                    this.gameActive = true;
                }
                // allow=false 时保持弹窗 (未来这里可以根据 result.reason 展示广告/支付引导)
            } finally {
                btn.disabled = false;
            }
        });

        // 会话弹窗：重置 (走 SESSION_CONFIG.requestReset 钩子)
        document.getElementById('btn-session-reset').addEventListener('click', async () => {
            const btn = document.getElementById('btn-session-reset');
            if (btn.disabled) return;
            btn.disabled = true;
            try {
                const result = await SESSION_CONFIG.requestReset({
                    levelId: this.currentLevelId,
                    elapsedSeconds: this.session.elapsed
                });
                if (!result || result.allow !== false) {
                    document.getElementById('session-modal').classList.add('hidden');
                    this.session.reset();
                    this.resetLevel();
                }
            } finally {
                btn.disabled = false;
            }
        });

        // 结算面板“重新练习”
        document.getElementById('btn-result-restart').addEventListener('click', () => {
            document.getElementById('result-modal').classList.add('hidden');
            this.resetLevel();
        });
    }

    // 更新右上角计时器 (mm:ss)，反映 this.timeElapsed
    updatePlayTimerDisplay() {
        const el = document.getElementById('play-timer');
        if (!el) return;
        const total = Math.floor(this.timeElapsed);
        const m = Math.floor(total / 60);
        const s = total % 60;
        el.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    }

    // 会话计时器达到上限：暂停游戏并弹出会话弹窗
    handleSessionLimit() {
        this.gameActive = false;
        this.audio.setReversing(false);
        // 把"已练习 N 秒"填到弹窗文案 ({s} 占位符)
        const msgEl = document.getElementById('session-message');
        if (msgEl) {
            msgEl.textContent = t('sessionMessage', { s: Math.round(this.session.elapsed) });
        }
        document.getElementById('session-modal').classList.remove('hidden');
    }

    // 显示轻量级 Toast 浮动提示
    showToast(message) {
        const toast = document.getElementById('message-toast');
        toast.textContent = message;
        // 元素初始带 .hidden (display:none !important)，必须先摘掉，否则 .show 的 opacity 永远被压住、toast 永不显示
        toast.classList.remove('hidden');
        toast.classList.add('show');
        
        // 2秒后淡出
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => {
            toast.classList.remove('show');
        }, 2000);
    }

    // 沙盒关卡用：在四面外墙围出的区域内随机生成车位 (位置 + 角度)，远离车辆起点
    randomizeSpot(level) {
        const tpl = level.parkingSpot;
        const init = level.initialState;
        // 外墙内沿: 左 24 / 右 776 / 上 24 / 下 426；再留 4px 余量
        const xMin = 28, xMax = 772, yMin = 28, yMax = 422;
        const minDistFromVehicle = 160;

        for (let i = 0; i < 60; i++) {
            const angle = Math.random() * Math.PI * 2;
            const c = Math.abs(Math.cos(angle));
            const s = Math.abs(Math.sin(angle));
            const bboxW = tpl.length * c + tpl.width * s; // 旋转后的 AABB 宽
            const bboxH = tpl.length * s + tpl.width * c; // 旋转后的 AABB 高
            const xLow = xMin + bboxW / 2, xHigh = xMax - bboxW / 2;
            const yLow = yMin + bboxH / 2, yHigh = yMax - bboxH / 2;
            if (xHigh <= xLow || yHigh <= yLow) continue;
            const x = xLow + Math.random() * (xHigh - xLow);
            const y = yLow + Math.random() * (yHigh - yLow);
            if (Math.hypot(x - init.x, y - init.y) < minDistFromVehicle) continue;
            return { ...tpl, x, y, angle };
        }
        // 50 次随机都没找到合适位置 (实践上不会发生) → 回退到模板原值
        return { ...tpl };
    }

    // 加载一个关卡
    // 当前账号是否能玩 beta 关卡
    isBetaAllowed() {
        return this.auth.isSignedIn() && this.auth.user && this.auth.user.email === BETA_EMAIL;
    }

    // 已对所有人开放：任何登录用户都能创作关卡 (决定是否显示「我的关卡」与「新建」入口)
    canAuthorLevels() {
        return this.auth.isSignedIn();
    }

    // 手柄离散动作 (由 gamepad 边沿检测触发)，映射到本游戏现有功能
    _handleGamepadAction(name) {
        const clickIf = (id) => document.getElementById(id) && document.getElementById(id).click();
        switch (name) {
            case 'confirm': {
                // 教学页可见时 = 开始练习；否则 = 切换 D/R 挡
                const tut = document.getElementById('level-tutorial');
                if (tut && !tut.classList.contains('hidden')) clickIf('btn-start-level');
                else this._toggleGear();
                break;
            }
            case 'restart': clickIf('btn-restart'); break;
            case 'toggleTrajectory': clickIf('btn-toggle-prediction'); break;
            case 'toggleSound': clickIf('btn-toggle-sound'); break;
            case 'openLevels': clickIf('btn-level-switch'); break;
            case 'recenterCamera': {
                // 俯视相机自动跟随；这里把缩放复位即可
                const c = this.renderer.camera;
                c.zoom = (this.canvas.clientHeight > this.canvas.clientWidth) ? 1.25 : 1.45;
                break;
            }
            // 'shift:noop'：shift 层暂无对应系统，不处理
        }
    }

    _toggleGear() {
        const next = this.controls.gear === 'D' ? 'R' : 'D';
        const btn = document.getElementById(next === 'D' ? 'gear-d' : 'gear-r');
        if (btn) btn.click();
    }

    // 当前用户可见的关卡 (按数组顺序)：beta 关卡只对授权账号可见
    accessibleLevels() {
        return LEVELS.filter(l => !l.beta || this.isBetaAllowed());
    }

    // 内置 (LEVELS) 或自定义 (customLevels 缓存) 关卡查找
    getLevelById(id) {
        return LEVELS.find(l => l.id === id) || customLevels.cachedLevel(id) || null;
    }

    loadLevel(id) {
        const def = this.getLevelById(id);
        if (def) this._enterLevel(def);
    }

    // 直接喂关卡对象 (编辑器试玩未保存的关 / 分享链接 / 我的关卡)
    loadLevelObject(def) {
        if (def) this._enterLevel(def);
    }

    _enterLevel(def) {
        // 标记为随机车位的关卡：浅克隆并替换 parkingSpot，避免污染原始模板 (resetLevel 时能重新摇)
        const level = def.randomSpot
            ? { ...def, parkingSpot: this.randomizeSpot(def) }
            : def;

        this.currentLevelId = def.id != null ? def.id : '__test__';
        this.currentLevel = level;
        // 自定义关 = 不在内置 LEVELS 里；临时关 = 未保存的试玩关 (无 id)，不进排行榜
        this.currentLevelIsCustom = !LEVELS.some(l => l.id === def.id);
        this.currentLevelIsTemp = def.id == null;

        // 更新 HUD 文字 (使用当前语言)
        document.getElementById('current-level-name').textContent = localize(level.name);
        
        // 初始化或重置半挂车物理状态
        if (!this.vehicle) {
            this.vehicle = new Vehicle(
                level.initialState.x,
                level.initialState.y,
                level.initialState.thetaC,
                level.initialState.thetaT
            );
        } else {
            this.vehicle.reset(
                level.initialState.x,
                level.initialState.y,
                level.initialState.thetaC,
                level.initialState.thetaT
            );
        }

        // 重置统计
        this.timeElapsed = 0;
        this.collisionCount = 0;
        this.alignTimer = 0;
        this.gameActive = false;
        this.pendingScore = null; // 进新关卡，上一次未提交的成绩作废
        this._leaderboardNonce = null; // 排行榜会话也作废
        this._lastSubmittedRank = null; // 上一关的排名缓存也作废
        this.updatePlayTimerDisplay();
        // 注意：排行榜会话 (nonce) 不在这里申请。
        // 服务端用 startedAt 做反作弊 (上报时间不能低于服务端经过时间的 90%)，
        // 若在加载时就开始计时，玩家在教学页停留的时间会被算进经过时间，
        // 导致正规的快速成绩被误判为作弊。改为在玩家真正开始驾驶 (gameActive=true)
        // 时才申请会话 —— 见 btn-start-level 与 resetLevel。

        // 设置倒车声状态为 false
        this.audio.setReversing(false);

        // 设置教学弹窗内容并显示 (使用当前语言)
        document.getElementById('tutorial-title').textContent = localize(level.name);
        const tutText = document.getElementById('tutorial-text');
        if (this.currentLevelIsCustom && !this.currentLevelIsTemp) {
            this._renderCustomWelcome(level, tutText);
        } else {
            tutText.textContent = localize(level.tutorial);
        }
        document.getElementById('level-tutorial').classList.remove('hidden');

        // 关闭其他可能开启的弹窗
        document.getElementById('levels-modal').classList.add('hidden');
        document.getElementById('result-modal').classList.add('hidden');
        document.getElementById('session-modal').classList.add('hidden');

        // 会话计时器归零，重新开始累计
        this.session.reset();

        // 强制重置方向盘及踏板按键
        this.controls.resetInputs();
        
        // 开场：相机进入远景模式，snap 到框住车位 + 车辆的视图
        // 把远景视图 "拍照存档"，introMode 期间锁死，避免车辆位置变动导致漂移
        const W = this.canvas.clientWidth;
        const H = this.canvas.clientHeight;
        const intro = this.renderer.computeIntroTarget(this.vehicle, level.parkingSpot, W, H);
        this.renderer.camera.x = intro.x;
        this.renderer.camera.y = intro.y;
        this.renderer.camera.zoom = intro.zoom;
        this.renderer.camera.introTarget = intro;
        this.renderer.camera.introMode = true;
        this.renderer.camera.introExitDelay = 0;
        this.renderer.camera.inTransition = false;

        this._syncUrlLevel();
        // 记录历史 (仅已保存的自制关)
        if (this.currentLevelIsCustom && !this.currentLevelIsTemp) customLevels.recordHistory(level, this.auth.user);
    }

    // 同步地址栏：玩已保存的自建关 → 带上 ?level=<id> (方便直接复制分享)；其它情况清掉该参数
    _syncUrlLevel() {
        try {
            const url = new URL(location.href);
            if (this.currentLevelIsCustom && !this.currentLevelIsTemp && this.currentLevelId != null) {
                url.searchParams.set('level', this.currentLevelId);
            } else {
                url.searchParams.delete('level');
            }
            history.replaceState(null, '', url);
        } catch (_) {}
    }

    // 自建关欢迎弹窗：标题下显示创作者 / 更新时间 / 最佳成绩
    _renderCustomWelcome(level, el) {
        const parts = [];
        if (level.authorName) parts.push(escHtml(t('byAuthor', { name: level.authorName })));
        if (level.updatedAt) {
            let d = '';
            try { d = new Date(level.updatedAt).toLocaleDateString(); } catch (_) {}
            if (d) parts.push(escHtml(t('updatedAt', { date: d })));
        }
        parts.push(`<span id="welcome-best">${escHtml(t('bestScore', { time: '…' }))}</span>`);
        el.innerHTML = parts.join('<br>');
        const lid = level.id;
        getTopN(lid, 1).then(top => {
            if (this.currentLevelId !== lid) return; // 已切到别的关
            const span = document.getElementById('welcome-best');
            if (!span) return;
            span.textContent = (top && top.length)
                ? t('bestScore', { time: formatScoreTime(top[0].timeSeconds) })
                : t('bestNone');
        }).catch(() => {});
    }

    // 重置当前关卡
    resetLevel() {
        if (!this.currentLevel) return;
        // 内置/自定义按 id 重新解析 (随机车位关会重摇)；试玩临时关回退到当前对象
        this._enterLevel(this.getLevelById(this.currentLevelId) || this.currentLevel);
        // 跳过教学页直接开始
        document.getElementById('level-tutorial').classList.add('hidden');
        this.gameActive = true;
        // 重置即开车，立刻申请会话让 startedAt 对齐计时起点
        this._startLeaderboardSession();
        // 重置时跳过开场远景与过渡，直接把相机 snap 到车辆位置 (重置应是瞬时的)
        this.renderer.camera.introMode = false;
        this.renderer.camera.introExitDelay = 0;
        this.renderer.camera.inTransition = false;
        this.renderer.camera.x = this.vehicle.x;
        this.renderer.camera.y = this.vehicle.y;
        const H = this.canvas.clientHeight;
        const W = this.canvas.clientWidth;
        this.renderer.camera.zoom = (H > W) ? 1.25 : 1.45;
        this.showToast(t('toastReset'));
    }

    // 检查挂车是否与车位完美对齐
    checkParkingAlignment() {
        const spot = this.currentLevel.parkingSpot;
        const vehicle = this.vehicle;

        // 判定：挂车箱体四角是否全部落在车位框内 (不显式看角度)。
        //  - 车位窄 (≈挂车大小) 时，几何上自然要求车身对正、居中 → 仍是精准停车 (内置关行为基本不变)
        //  - 车位大时，只要把车厢整个开进框里即可，不要求角度
        const trailer = vehicle.getTrailerOBB();
        const ca = Math.cos(spot.angle), sa = Math.sin(spot.angle);
        const halfL = spot.length / 2, halfW = spot.width / 2;
        const slack = 2; // 容许极小的浮点/像素溢出
        for (const p of trailer.vertices) {
            const dx = p.x - spot.x, dy = p.y - spot.y;
            const localLong = dx * ca + dy * sa;   // 沿车位长度方向
            const localLat = -dx * sa + dy * ca;   // 沿车位宽度方向
            if (Math.abs(localLong) > halfL + slack || Math.abs(localLat) > halfW + slack) return false;
        }
        return true;
    }

    // 游戏主循环 (Loop)
    loop(timestamp) {
        if (!this.lastTime) this.lastTime = timestamp;
        let dt = (timestamp - this.lastTime) / 1000;
        this.lastTime = timestamp;

        // 限制 dt 异常大（例如切到其他标签页再切回时）
        if (dt > 0.1) dt = 0.1;

        // 编辑器打开时：把这一帧交给编辑器渲染，跳过游戏逻辑 (也不轮询手柄)
        if (this.editorActive) {
            this.editor.draw(dt);
            requestAnimationFrame((t) => this.loop(t));
            return;
        }

        // 手柄：每帧轮询，按钮动作经 onAction 触发，轴值喂给 controls
        this.gamepad.poll(timestamp);
        this.controls.setPadAxes(this.gamepad.axes);

        if (this.gameActive) {
            this.timeElapsed += dt;
            this.updatePlayTimerDisplay();
            // 会话计时器 (达到上限会暂停游戏并弹窗，详见 SESSION_CONFIG)
            this.session.tick(dt);

            // 1. 更新方向盘回正等控制器内部时钟
            this.controls.update(dt);

            // 2. 计算卡车物理位移
            // 将控制器中归一化的 steerInput (-1 ~ 1) 映射为实际前轮偏转弧度
            const targetSteerAngle = this.controls.steerInput * this.vehicle.maxSteer;
            this.vehicle.update(dt, targetSteerAngle, this.controls.throttle, this.controls.brake, this.controls.gear);

            // 3. 驱动引擎声效及倒车嘀嘀嘀音效
            const isAccelerating = this.controls.throttle > 0;
            this.audio.updateEngine(this.vehicle.velocity, isAccelerating);
            this.audio.setReversing(this.vehicle.velocity < 0);

            // 4. 更新尾气烟雾
            this.renderer.updateParticles(this.vehicle, dt);

            // 5. 碰撞检测
            this.handleCollisionCheck();

            // 6. 折头警报横幅控制
            const warningBanner = document.getElementById('warning-banner');
            if (this.vehicle.isJackknifed) {
                warningBanner.classList.remove('hidden');
            } else {
                warningBanner.classList.add('hidden');
            }

            // 7. 对齐停车判定
            this.handleParkingAlignmentCheck(dt);
        }

        // 8. 摄像机跟踪
        if (this.currentLevel) {
            this.renderer.updateCamera(this.vehicle, this.currentLevel.parkingSpot, this.canvas.clientWidth, this.canvas.clientHeight, dt);
        }

        // 9. 渲染 Canvas 画面
        if (this.vehicle && this.currentLevel) {
            const isAligned = this.checkParkingAlignment();
            this.renderer.render(this.vehicle, this.currentLevel.parkingSpot, this.currentLevel.obstacles, isAligned, dt, this.controls.gear);
        }

        // 下一帧
        requestAnimationFrame((t) => this.loop(t));
    }

    // 处理碰撞检测判定
    handleCollisionCheck() {
        const cabOBB = this.vehicle.getCabOBB();
        const trailerOBB = this.vehicle.getTrailerOBB();
        let collisionDetected = false;

        // 检测车头或车厢是否与关卡障碍物碰撞
        for (let i = 0; i < this.currentLevel.obstacles.length; i++) {
            const obs = this.currentLevel.obstacles[i];
            const obsOBB = {
                vertices: this.getObstacleVertices(obs),
                axes: [
                    { x: Math.cos(obs.angle), y: Math.sin(obs.angle) },
                    { x: -Math.sin(obs.angle), y: Math.cos(obs.angle) }
                ]
            };

            if (checkOBBCollision(cabOBB, obsOBB) || checkOBBCollision(trailerOBB, obsOBB)) {
                collisionDetected = true;
                break;
            }
        }

        // 如果发生碰撞
        if (collisionDetected) {
            this.collisionCount++;
            this.audio.playCollision();
            this.showToast(t('toastCollision'));
            
            // 碰撞惩罚：车辆闪烁并重置回关卡起点
            this.vehicle.reset(
                this.currentLevel.initialState.x,
                this.currentLevel.initialState.y,
                this.currentLevel.initialState.thetaC,
                this.currentLevel.initialState.thetaT
            );
            this.controls.resetInputs();
            this.alignTimer = 0;
        }
    }

    // 辅助获取障碍物矩形的顶点坐标
    getObstacleVertices(obs) {
        const cos = Math.cos(obs.angle);
        const sin = Math.sin(obs.angle);
        const hw = obs.length / 2; // obs.length 在地图上为 X (纵向)
        const hh = obs.width / 2;  // obs.width 在地图上为 Y (横向)

        const localCorners = [
            { dx: hw, dy: hh },
            { dx: -hw, dy: hh },
            { dx: -hw, dy: -hh },
            { dx: hw, dy: -hh }
        ];

        return localCorners.map(c => ({
            x: obs.x + c.dx * cos - c.dy * sin,
            y: obs.y + c.dx * sin + c.dy * cos
        }));
    }

    // 处理对齐成功后的 1.5s 计时判定
    handleParkingAlignmentCheck(dt) {
        const isAligned = this.checkParkingAlignment();
        const isStationary = Math.abs(this.vehicle.velocity) < 0.5; // 车必须几乎静止

        if (isAligned && isStationary) {
            this.alignTimer += dt;
            
            // 倒计时提示
            const remain = Math.max(0, this.alignDurationRequired - this.alignTimer);
            if (remain > 0) {
                this.showToast(t('toastAlignHold', { s: remain.toFixed(1) }));
            } else {
                // 通关！
                this.triggerVictory();
            }
        } else {
            // 对齐中断，重置计时器
            this.alignTimer = 0;
        }
    }

    // 触发通关逻辑
    triggerVictory() {
        this.gameActive = false;
        this.audio.setReversing(false);
        this.audio.playVictory();

        // 记录本地关卡解锁进度
        if (!this.completedLevels.includes(this.currentLevelId)) {
            this.completedLevels.push(this.currentLevelId);
            localStorage.setItem('truck_simulator_completed', JSON.stringify(this.completedLevels));
        }

        // 渲染统计指标并显示结算弹窗 (单位 "s" 通用，旁边的标签由 i18n 提供"用时/Time"等)
        document.getElementById('stat-time').textContent = formatScoreTime(this.timeElapsed);
        document.getElementById('stat-collisions').textContent = this.collisionCount;

        // 自定义关 / 最后一关：按钮文案改为"再玩一次/从头开始"；否则"下一关"
        const btnNext = document.getElementById('btn-next-level');
        const ordered = this.accessibleLevels();
        const isLast = ordered.length > 0 && ordered[ordered.length - 1].id === this.currentLevelId;
        btnNext.textContent = t(this.currentLevelIsCustom || isLast ? 'selectLevelCta' : 'nextLevel');

        if (this.currentLevelIsTemp) {
            // 未保存的试玩关：不进排行榜，结算只显示用时
            this.pendingScore = null;
            this.refreshResultRankSection();
        } else {
            // 本次成绩缓存：登录前胜利→记下 pending，玩家登录后由 auth.onChange 自动补交
            this.pendingScore = {
                levelId: this.currentLevelId,
                timeSeconds: this.timeElapsed,
                collisions: this.collisionCount
            };
            // 已登录走 _submitPendingScore (它内部 finally 会 refresh 排名区)；未登录直接显示登录按钮
            if (this.auth.isSignedIn()) {
                this._submitPendingScore();
            } else {
                this.refreshResultRankSection();
            }
        }

        document.getElementById('result-modal').classList.remove('hidden');
    }

    // 把 pendingScore 上传，成功后清掉并刷新排名区
    async _submitPendingScore() {
        if (!this.pendingScore || !this.auth.isSignedIn()) return;
        // 没有会话 nonce → 现申请一个再提交 (登录后才通关、或 loadLevel 的 start 还没回的情形)
        if (!this._leaderboardNonce) {
            const ok = await this._startLeaderboardSession();
            if (!ok || !this._leaderboardNonce) {
                this.showToast(t('scoreUploadFailed'));
                this.refreshResultRankSection();
                return;
            }
        }
        const p = this.pendingScore;
        try {
            const r = await submitScore(p.levelId, this.auth.user, p.timeSeconds, p.collisions, this._leaderboardNonce);
            if (r && r.ok) {
                if (this.pendingScore === p) this.pendingScore = null;
                this._leaderboardNonce = null; // 一次性使用
                // 服务端用内存里的最新 rows 算了排名直接回，避免 KV 最终一致性带来的"刚提交查不到"
                if (r.rank) this._lastSubmittedRank = r.rank;
            } else {
                console.warn('[leaderboard] submitScore returned null/no-ok', r);
                this._leaderboardNonce = null; // 这把 nonce 大概率废了 (被消费/过期/无效)，下次重申请
                // 把服务端拒绝原因显示出来，便于定位 (例如"时间低于本关下限"/"会话过期")
                this.showToast(t('scoreUploadFailed') + (r && r.error ? ` (${r.error})` : ''));
            }
        } catch (err) {
            console.error('[leaderboard] submitScore threw:', err);
            this.showToast(t('scoreUploadFailed'));
        } finally {
            this.refreshResultRankSection();
        }
    }

    // 向后端申请新一轮的反作弊会话 nonce
    // 登录/未登录都申请：游客拿到的是 guest session，submit 时再带 sessionToken 把成绩认领走
    // 返回 true/false 表示是否拿到了 nonce；401 时同时把 auth 状态登出并弹提示
    async _startLeaderboardSession() {
        if (!this.currentLevel) return false;
        if (this.currentLevelIsTemp) return false; // 未保存的试玩关不进排行榜 (已保存的自建关参与)
        try {
            const user = this.auth && this.auth.isSignedIn() ? this.auth.user : null;
            const r = await startLeaderboardSession(this.currentLevelId, user);
            if (r && r.nonce) {
                this._leaderboardNonce = r.nonce;
                return true;
            }
            if (r && r.status === 401) {
                // Token 被服务端拒绝 (一般是过期) → 登出，让玩家重新登录
                if (this.auth && this.auth.isSignedIn()) {
                    this.auth.signOut();
                    this.showToast(t('sessionExpired'));
                }
            }
            return false;
        } catch (err) {
            console.warn('[leaderboard] start session failed:', err);
            return false;
        }
    }

    // ----- 登录 / 排行榜 -----

    bindAuthUI() {
        // 方向盘上方 Login 按钮 → 打开登录弹窗
        document.getElementById('btn-login').addEventListener('click', () => this.openLoginModal());
        document.getElementById('btn-logout').addEventListener('click', () => this.auth.signOut());
        document.getElementById('btn-close-login').addEventListener('click', () => {
            document.getElementById('login-modal').classList.add('hidden');
        });
        // 菜单弹窗：关闭 / 排行榜 / 开发者
        document.getElementById('btn-close-menu').addEventListener('click', () => {
            document.getElementById('menu-modal').classList.add('hidden');
        });
        document.getElementById('btn-menu-leaderboard').addEventListener('click', () => {
            document.getElementById('menu-modal').classList.add('hidden');
            this.openLeaderboardModal();
        });
        document.getElementById('btn-menu-developer').addEventListener('click', () => {
            document.getElementById('dev-info').classList.toggle('hidden');
        });
        // 排行榜弹窗的关闭 (底部按钮 + 右上角 X)
        const closeLb = () => document.getElementById('leaderboard-modal').classList.add('hidden');
        document.getElementById('btn-close-leaderboard').addEventListener('click', closeLb);
        document.getElementById('btn-close-leaderboard-x').addEventListener('click', closeLb);

        // 所有弹窗：点击内容区外的蒙版即关闭 (session-modal 是强制选择，排除)
        document.querySelectorAll('.modal').forEach(modal => {
            if (modal.id === 'session-modal') return;
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.classList.add('hidden');
            });
        });

        // 分享按钮：HUD 计时器下面 (玩中分享当前关卡)
        document.getElementById('btn-share-playing').addEventListener('click', () => this.sharePlaying());
        // 结算弹窗里的分享 (通关后分享成绩)
        document.getElementById('btn-share-result').addEventListener('click', () => this.shareCompleted());
    }

    // ----- 分享 -----

    sharePlaying() {
        if (!this.currentLevel) return;
        this._share(t('sharePlayingText', { level: localize(this.currentLevel.name) }));
    }

    shareCompleted() {
        if (!this.currentLevel) return;
        this._share(t('shareCompletedText', {
            level: localize(this.currentLevel.name),
            time: formatScoreTime(this.timeElapsed)
        }));
    }

    // 不管用 Web Share 还是剪贴板兜底，都先把文案复制到剪贴板 + 弹 toast：
    // 用户万一选到不带文字的分享渠道也能粘贴文案。然后再调原生分享单。
    async _share(text) {
        const url = window.location.href;
        const title = t('pageTitle');
        const payload = `${text} ${url}`;

        // 1. 先复制到剪贴板 + toast (best effort)
        let copied = false;
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(payload);
                copied = true;
            } else {
                // 极端 fallback：临时 textarea + execCommand
                const ta = document.createElement('textarea');
                ta.value = payload;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                copied = document.execCommand('copy');
                document.body.removeChild(ta);
            }
        } catch (err) {
            console.warn('clipboard copy failed', err);
        }
        if (copied) this.showToast(t('shareCopied'));

        // 2. 再调原生分享单 (有的话)；没有就停在剪贴板这一步
        if (navigator.share) {
            try {
                await navigator.share({ title, text, url });
            } catch (err) {
                if (err && err.name !== 'AbortError') console.warn('share failed', err);
            }
        }
    }

    // 同步右上 login pill：未登录显示"Sign In"按钮；已登录显示头像 + 名字 + 登出
    updateLoginPill() {
        const btn = document.getElementById('btn-login');
        const chip = document.getElementById('user-chip');
        if (this.auth.isSignedIn()) {
            btn.classList.add('hidden');
            chip.classList.remove('hidden');
            const u = this.auth.user;
            document.getElementById('user-avatar').src = u.picture || '';
            document.getElementById('user-name').textContent = u.name || u.email || '';
        } else {
            btn.classList.remove('hidden');
            chip.classList.add('hidden');
        }
    }

    openLoginModal() {
        document.getElementById('login-modal').classList.remove('hidden');
        // 渲染 Google 按钮 + 传当前语言 (GIS 默认按浏览器语言走，会出现界面语言对不上的情况)
        this.auth.renderButton(document.getElementById('google-signin-container'), getLang());
    }

    // 刷新结算弹窗里的排名区 (登录态 / 排名 / 入口按钮)
    // 进入函数立即同步清空 section，再 await。即使在 await 期间被新一次调用插队
    // (新一次也会清空)，最终也只有最新那次的内容落地，绝不会出现"两套排名"
    async refreshResultRankSection() {
        const myReq = ++this._rankRefreshSeq;
        const section = document.getElementById('result-rank-section');
        if (!section) return;
        section.innerHTML = ''; // 同步清空，防重复

        // 未保存的试玩关不参与排行榜，结算页不显示排名区 (已保存的自建关正常显示)
        if (this.currentLevelIsTemp) return;

        const signedIn = this.auth.isSignedIn();

        // 拉 rank：登录用 userId 查；游客用 timeSeconds 查"假如这把记录会排第几"
        let rankInfo;
        if (signedIn) {
            // 优先用 submit 时服务端回的排名 (避免 KV 最终一致性导致刚提交完查不到)
            rankInfo = this._lastSubmittedRank;
            if (!rankInfo) {
                rankInfo = await getRank(this.currentLevelId, this.auth.user.sub);
                if (myReq !== this._rankRefreshSeq) return;
            }
        } else if (this.timeElapsed > 0) {
            rankInfo = await getRankByTime(this.currentLevelId, this.timeElapsed);
            if (myReq !== this._rankRefreshSeq) return;
        }

        // 重新清空一次：await 期间可能被别处插入内容，确保我们这次是最终落地的
        section.innerHTML = '';
        const frag = document.createDocumentFragment();

        const display = document.createElement('div');
        display.className = 'result-rank-display';
        if (rankInfo && rankInfo.rank) {
            const key = signedIn ? 'yourRank' : 'guestRank';
            display.innerHTML = t(key, { n: rankInfo.rank, total: rankInfo.total })
                .replace(/(\d+)/g, '<strong>$1</strong>');
            frag.appendChild(display);
        } else if (signedIn) {
            display.textContent = t('noScoresYet');
            frag.appendChild(display);
        }
        // 游客 + 没拿到 rank：不渲染排名行，下方按钮自然顶上来

        const viewBtn = document.createElement('button');
        viewBtn.className = 'btn-secondary';
        viewBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="14" height="14" style="vertical-align: -2px"><path fill="currentColor" d="M7,2V13H10V22L17,10H13L17,2H7Z"/></svg>
            <span style="margin-left:6px">${t('viewFullRanking')}</span>
        `;
        viewBtn.addEventListener('click', () => {
            this.leaderboardLevelId = this.currentLevelId;
            this.openLeaderboardModal();
        });
        frag.appendChild(viewBtn);

        // 游客额外加一行"登录以记录"提示
        if (!signedIn) {
            const loginBtn = document.createElement('button');
            loginBtn.className = 'btn-login-prompt';
            loginBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12,4A4,4 0 0,1 16,8A4,4 0 0,1 12,12A4,4 0 0,1 8,8A4,4 0 0,1 12,4M12,14C16.42,14 20,15.79 20,18V20H4V18C4,15.79 7.58,14 12,14Z"/></svg>
                <span>${t('signInToRank')}</span>
            `;
            loginBtn.addEventListener('click', () => this.openLoginModal());
            frag.appendChild(loginBtn);
        }

        section.appendChild(frag);
    }

    // 排行榜弹窗
    openLeaderboardModal() {
        // 默认定位到当前关卡的榜 tab (内置数字关或自建关均可)
        if (this.currentLevelId != null) this.leaderboardLevelId = this.currentLevelId;
        this.renderLeaderboardTabs();
        this.renderLeaderboardList();
        document.getElementById('leaderboard-modal').classList.remove('hidden');
    }

    renderLeaderboardTabs() {
        const tabs = document.getElementById('leaderboard-tabs');
        if (!tabs) return;
        tabs.innerHTML = '';
        this.accessibleLevels().forEach((lvl, idx) => {
            const tab = document.createElement('button');
            tab.className = 'leaderboard-tab';
            if (lvl.id === this.leaderboardLevelId) tab.classList.add('active');
            tab.textContent = `${idx + 1}`;
            tab.title = localize(lvl.name);
            tab.addEventListener('click', () => {
                this.leaderboardLevelId = lvl.id;
                this.renderLeaderboardTabs();
                this.renderLeaderboardList();
            });
            tabs.appendChild(tab);
        });
        // 自建关：内置 tab 之外，给当前查看的自建关补一个高亮 tab (★)
        if (!LEVELS.some(l => l.id === this.leaderboardLevelId)) {
            const lvl = customLevels.cachedLevel(this.leaderboardLevelId)
                || (this.currentLevelId === this.leaderboardLevelId ? this.currentLevel : null);
            const tab = document.createElement('button');
            tab.className = 'leaderboard-tab active';
            tab.textContent = '★';
            tab.title = lvl ? localize(lvl.name) : '';
            tabs.appendChild(tab);
        }
        // tab 下显示当前选中关卡名
        const nameEl = document.getElementById('leaderboard-level-name');
        if (nameEl) {
            const cur = this.getLevelById(this.leaderboardLevelId)
                || (this.currentLevelId === this.leaderboardLevelId ? this.currentLevel : null);
            nameEl.textContent = cur ? localize(cur.name) : '';
        }
    }

    async renderLeaderboardList() {
        const list = document.getElementById('leaderboard-list');
        if (!list) return;
        list.innerHTML = '';
        const top = await getTopN(this.leaderboardLevelId, 20);
        if (!top || top.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'leaderboard-empty';
            empty.textContent = t('noScoresYet');
            list.appendChild(empty);
            return;
        }
        const selfId = this.auth.isSignedIn() ? this.auth.user.sub : null;
        top.forEach((row, idx) => {
            const el = document.createElement('div');
            el.className = 'leaderboard-row';
            if (row.userId === selfId) el.classList.add('is-self');
            const timeStr = formatScoreTime(row.timeSeconds);
            el.innerHTML = `
                <div class="leaderboard-rank">#${idx + 1}</div>
                <img class="leaderboard-avatar" src="${row.picture || ''}" alt="">
                <div class="leaderboard-name">${row.name || ''}</div>
                <div class="leaderboard-time">${timeStr}</div>
            `;
            list.appendChild(el);
        });
    }

    // 打开关卡选择面板
    openLevelsModal() {
        this.renderCurrentLevelInfo();
        this.renderFavorites();
        this.renderHistory();
        this.renderLevelsGrid();
        const signedIn = this.canAuthorLevels();
        const sec = document.getElementById('my-levels-section');
        if (sec) {
            if (signedIn) { sec.classList.remove('hidden'); this.renderMyLevels(); }
            else sec.classList.add('hidden');
        }
        // 未登录：底部显示"登录后创建自己的关卡"
        const signinBtn = document.getElementById('btn-signin-create');
        if (signinBtn) signinBtn.classList.toggle('hidden', signedIn);
        this._reorderLevelsModal();
        document.getElementById('levels-modal').classList.remove('hidden');
    }

    // 浏览按钮置顶；玩过自制关 (有历史) 后把系统关卡移到最底部并加分隔线
    _reorderLevelsModal() {
        const content = document.querySelector('#levels-modal .modal-content');
        if (!content) return;
        const byId = (id) => document.getElementById(id);
        const browse = byId('btn-browse-gallery'), cli = byId('current-level-info');
        const fav = byId('fav-levels-section'), builtins = byId('levels-list');
        const mine = byId('my-levels-section'), signin = byId('btn-signin-create');
        const hist = byId('history-levels-section'), divider = byId('system-divider');
        const hasHistory = customLevels.listHistory().length > 0;
        let order;
        if (hasHistory) {
            divider.classList.remove('hidden');
            order = [browse, cli, fav, mine, signin, hist, divider, builtins];
        } else {
            divider.classList.add('hidden');
            order = [browse, cli, builtins, fav, mine, signin, hist];
        }
        // 依次 appendChild = 移到末尾，topbar 不在列表里所以保持在最前
        order.forEach(el => { if (el) content.appendChild(el); });
    }

    // 弹窗开头：当前关卡信息 (仅自制关) + 收藏按钮
    renderCurrentLevelInfo() {
        const box = document.getElementById('current-level-info');
        if (!box) return;
        const lvl = this.currentLevel;
        const show = this.currentLevelIsCustom && !this.currentLevelIsTemp && lvl && this.currentLevelId != null;
        box.classList.toggle('hidden', !show);
        if (!show) return;
        document.getElementById('cli-name').textContent = localize(lvl.name);
        document.getElementById('cli-author').textContent = lvl.authorName ? t('byAuthor', { name: lvl.authorName }) : '';
        this._syncFavBtn();
    }

    _syncFavBtn() {
        const fav = customLevels.isFavorite(this.currentLevelId);
        const btn = document.getElementById('btn-fav-toggle');
        if (btn) btn.classList.toggle('is-fav', fav);
        const icon = document.getElementById('fav-icon');
        if (icon) icon.textContent = fav ? '★' : '☆';
        const label = document.getElementById('fav-label');
        if (label) label.textContent = t(fav ? 'favorited' : 'favorite');
    }

    // 收藏分类：列出已收藏的自制关，可直接玩 / 取消收藏
    renderFavorites() {
        const section = document.getElementById('fav-levels-section');
        const list = document.getElementById('fav-levels-list');
        if (!section || !list) return;
        const favs = customLevels.listFavorites();
        section.classList.toggle('hidden', favs.length === 0);
        list.innerHTML = '';
        favs.forEach(f => {
            const card = document.createElement('div');
            card.className = 'level-card';
            card.innerHTML = `
                <div class="level-card-title">${escHtml(f.name || '—')}</div>
                <div class="level-card-desc">${f.authorName ? escHtml(t('byAuthor', { name: f.authorName })) : ''}</div>
                <button class="level-card-edit" data-act="unfav" title="${t('favorited')}">★</button>`;
            card.addEventListener('click', () => this._playCustomById(f.id));
            card.querySelector('[data-act=unfav]').addEventListener('click', (e) => {
                e.stopPropagation();
                customLevels.removeFavorite(f.id, this.auth.user);
                this.renderFavorites();
                this._syncFavBtn();
            });
            list.appendChild(card);
        });
    }

    // 按 id 取最新自制关并游玩 (收藏/历史卡片点击共用)
    async _playCustomById(id) {
        document.getElementById('levels-modal').classList.add('hidden');
        const lvl = await customLevels.getLevel(id);
        if (lvl) this.loadLevelObject(lvl); else this.showToast(t('edSaveFailed'));
    }

    // 历史分类：最近玩过的自制关 (最多 6)
    renderHistory() {
        const section = document.getElementById('history-levels-section');
        const list = document.getElementById('history-levels-list');
        if (!section || !list) return;
        const hist = customLevels.listHistory();
        section.classList.toggle('hidden', hist.length === 0);
        list.innerHTML = '';
        hist.forEach(h => {
            const card = document.createElement('div');
            card.className = 'level-card';
            card.innerHTML = `
                <div class="level-card-title">${escHtml(h.name || '—')}</div>
                <div class="level-card-desc">${h.authorName ? escHtml(t('byAuthor', { name: h.authorName })) : ''}</div>`;
            card.addEventListener('click', () => this._playCustomById(h.id));
            list.appendChild(card);
        });
    }

    // 关卡画廊：所有已发布关卡 + 排序
    openGalleryModal() {
        document.getElementById('gallery-modal').classList.remove('hidden');
        const sel = document.getElementById('gallery-sort');
        this.renderGallery(sel ? sel.value : 'new');
    }

    async renderGallery(sort) {
        const list = document.getElementById('gallery-list');
        if (!list) return;
        this._gallerySeq = (this._gallerySeq || 0) + 1;
        const seq = this._gallerySeq;
        list.innerHTML = `<div class="leaderboard-empty">${t('loading')}</div>`;
        const levels = await customLevels.gallery(sort);
        if (seq !== this._gallerySeq) return; // 期间又切了排序
        list.innerHTML = '';
        if (!levels.length) {
            const empty = document.createElement('div');
            empty.className = 'leaderboard-empty';
            empty.textContent = t('galleryEmpty');
            list.appendChild(empty);
            return;
        }
        levels.forEach(g => {
            const card = document.createElement('div');
            card.className = 'level-card gallery-card';
            const author = g.authorName ? escHtml(t('byAuthor', { name: g.authorName })) : '';
            card.innerHTML = `
                <div class="gallery-card-text">
                    <div class="level-card-title">${escHtml(g.name || '—')}</div>
                    <div class="level-card-desc">${author}</div>
                    <div class="level-card-stats">▶ ${g.plays || 0}　★ ${g.favs || 0}</div>
                </div>
                <canvas class="gallery-thumb"></canvas>`;
            this._drawLevelThumb(card.querySelector('.gallery-thumb'), g);
            card.addEventListener('click', () => {
                document.getElementById('gallery-modal').classList.add('hidden');
                this._playCustomById(g.id);
            });
            list.appendChild(card);
        });
    }

    // 在小 canvas 上画关卡示意缩略图 (车辆/障碍/车位，按全部内容自动缩放居中)
    _drawLevelThumb(canvas, lvl) {
        if (!canvas) return;
        const cssW = 88, cssH = 62, dpr = window.devicePixelRatio || 1;
        canvas.width = cssW * dpr; canvas.height = cssH * dpr;
        canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        // 淡渐变底，避免内容稀疏时显得纯黑/空
        const bg = ctx.createLinearGradient(0, 0, 0, cssH);
        bg.addColorStop(0, '#141925'); bg.addColorStop(1, '#0b0e15');
        ctx.fillStyle = bg; ctx.fillRect(0, 0, cssW, cssH);
        const corners = (o) => {
            const c = Math.cos(o.angle || 0), s = Math.sin(o.angle || 0), hl = (o.length || 0) / 2, hw = (o.width || 0) / 2;
            return [[hl, hw], [-hl, hw], [-hl, -hw], [hl, -hw]].map(([dx, dy]) => ({ x: o.x + dx * c - dy * s, y: o.y + dx * s + dy * c }));
        };
        // 由起点推出车头 + 挂车的有向矩形 (尺寸/锚点与 physics.js 的 Vehicle 一致：起点 = 车头后轴 = 连接销)
        const vehicleRects = (is) => {
            const tc = is.thetaC || 0, tt = (is.thetaT != null ? is.thetaT : tc);
            return [
                { x: is.x + 13 * Math.cos(tc), y: is.y + 13 * Math.sin(tc), length: 46, width: 22, angle: tc },     // 车头 (中心在后轴前 cabLength/2 - cabRearOverhang)
                { x: is.x - 42.5 * Math.cos(tt), y: is.y - 42.5 * Math.sin(tt), length: 105, width: 24, angle: tt } // 挂车 (中心在连接销后 trailerLength/2 - kingpinOffset)
            ];
        };
        const pts = [];
        const sp = lvl.parkingSpot; if (sp) corners(sp).forEach(p => pts.push(p));
        (lvl.obstacles || []).forEach(o => corners(o).forEach(p => pts.push(p)));
        const veh = lvl.initialState ? vehicleRects(lvl.initialState) : null;
        if (veh) veh.forEach(r => corners(r).forEach(p => pts.push(p)));
        if (!pts.length) {
            // 缺几何数据：画占位符而不是留白
            ctx.fillStyle = 'rgba(255,255,255,0.16)';
            ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('?', cssW / 2, cssH / 2);
            return;
        }
        let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
        pts.forEach(p => { minx = Math.min(minx, p.x); miny = Math.min(miny, p.y); maxx = Math.max(maxx, p.x); maxy = Math.max(maxy, p.y); });
        const pad = 12, bw = (maxx - minx) + pad * 2, bh = (maxy - miny) + pad * 2;
        const scale = Math.min(cssW / bw, cssH / bh);
        const ox = (cssW - bw * scale) / 2, oy = (cssH - bh * scale) / 2;
        const tx = (x) => ox + (x - minx + pad) * scale, ty = (y) => oy + (y - miny + pad) * scale;
        // 关键元素设最小像素尺寸，缩放再小也不会消失
        const rect = (o, fill, stroke, minPx = 2) => {
            ctx.save(); ctx.translate(tx(o.x), ty(o.y)); ctx.rotate(o.angle || 0);
            const w = Math.max((o.length || 0) * scale, minPx), h = Math.max((o.width || 0) * scale, minPx);
            if (fill) { ctx.fillStyle = fill; ctx.fillRect(-w / 2, -h / 2, w, h); }
            if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.strokeRect(-w / 2, -h / 2, w, h); }
            ctx.restore();
        };
        (lvl.obstacles || []).forEach(o => {
            if (o.type === 'cone') { ctx.fillStyle = '#ff8c1a'; ctx.beginPath(); ctx.arc(tx(o.x), ty(o.y), 2, 0, Math.PI * 2); ctx.fill(); }
            else rect(o, 'rgba(255,255,255,0.3)', null, 1.5);
        });
        if (sp) rect(sp, 'rgba(0,255,204,0.14)', '#00ffcc', 3);
        // 车辆：挂车在后、车头在前，统一用品红色系 (呼应原起点标记)
        if (veh) {
            rect(veh[1], 'rgba(255,60,110,0.32)', 'rgba(255,95,135,0.8)', 2);
            rect(veh[0], 'rgba(255,60,110,0.62)', 'rgba(255,125,155,0.95)', 2);
        }
    }

    // ---- 关卡编辑器：UI 绑定与生命周期 ----
    bindEditorUI() {
        this.editor.bindInspector();
        const click = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
        click('btn-create-level', () => { document.getElementById('levels-modal').classList.add('hidden'); this.enterEditor(null); });
        click('ed-back', () => this.exitEditor());
        click('ed-test', () => this.editorTestPlay());
        click('ed-save', () => this.editorSave(false));
        click('ed-publish', () => this.editorSave(true));
        click('ed-publish-caret', () => document.getElementById('ed-publish-menu').classList.toggle('hidden'));
        click('ed-unpublish', () => this.editorUnpublish());
        click('ed-resume', () => this.enterEditor(this.editor.level));
        click('ed-zoom-in', () => { const c = this.renderer.camera; c.zoom = Math.min(3, c.zoom * 1.15); });
        click('ed-zoom-out', () => { const c = this.renderer.camera; c.zoom = Math.max(0.4, c.zoom / 1.15); });
        // 更多操作 → 删除关卡 (二次确认)
        click('ed-more', () => document.getElementById('ed-more-menu').classList.toggle('hidden'));
        click('ed-delete-level', async () => {
            document.getElementById('ed-more-menu').classList.add('hidden');
            const id = this.editor.level && this.editor.level.id;
            if (!id) { this.showToast(t('edEmptyMine')); return; } // 未保存的关无可删
            if (!confirm(t('edConfirmDelete'))) return;
            try { await customLevels.deleteLevel(id, this.auth.user); } catch (_) {}
            this.exitEditor();
        });
    }

    enterEditor(level) {
        this.gameActive = false;
        this.editorActive = true;
        this.editorSuspended = false;
        document.body.classList.add('editor-mode');
        ['levels-modal', 'result-modal', 'session-modal', 'level-tutorial', 'ed-more-menu'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
        document.getElementById('ed-resume')?.classList.add('hidden');
        document.getElementById('editor-overlay')?.classList.remove('hidden');
        document.getElementById('ed-publish-menu')?.classList.add('hidden');
        this.editor.open(level);
        this._syncPublishUI();
    }

    // 发布按钮状态：未发布=「发布」；已发布=「已发布」+ 下拉箭头 (内含取消发布)
    _syncPublishUI() {
        const pub = !!(this.editor.level && this.editor.level.published);
        const btn = document.getElementById('ed-publish');
        if (btn) btn.textContent = t(pub ? 'edPublishedState' : 'edPublish');
        document.getElementById('ed-publish-caret')?.classList.toggle('hidden', !pub);
        if (!pub) document.getElementById('ed-publish-menu')?.classList.add('hidden');
    }

    async editorUnpublish() {
        document.getElementById('ed-publish-menu')?.classList.add('hidden');
        const lvl = this.editor.getWorkingLevel();
        if (!lvl.id || !this.editor.level.published) return;
        lvl.published = false;
        try {
            const saved = await customLevels.saveLevel(lvl, this.auth.user);
            this.editor.level.id = saved.id;
            this.editor.level.published = saved.published; // false
            this._syncPublishUI();
            this.showToast(t('edUnpublished'));
        } catch (e) {
            this.showToast(t('edSaveFailed') + (e && e.message ? ': ' + e.message : ''));
        }
    }

    exitEditor() {
        this.editorActive = false;
        this.editorSuspended = false;
        this.editor.close();
        document.body.classList.remove('editor-mode');
        document.getElementById('editor-overlay')?.classList.add('hidden');
        document.getElementById('ed-resume')?.classList.add('hidden');
        // 回到普通游戏：加载一个内置关卡
        this.loadLevel(typeof this.currentLevelId === 'number' ? this.currentLevelId : 1);
    }

    // 试玩当前编辑中的关卡 (不丢失编辑状态，可通过"返回编辑器"按钮回来)
    editorTestPlay() {
        const lvl = this.editor.getWorkingLevel();
        this.editorActive = false;
        this.editorSuspended = true;
        this.editor.close(); // 仅解绑指针，editor.level 保留
        document.body.classList.remove('editor-mode');
        document.getElementById('editor-overlay')?.classList.add('hidden');
        document.getElementById('ed-resume')?.classList.remove('hidden');
        this.loadLevelObject(lvl);
    }

    async editorSave(publish) {
        const lvl = this.editor.getWorkingLevel();
        if (!lvl.name) { this.showToast(t('edNameRequired')); return; }
        if (!this.auth.isSignedIn()) { this.showToast(t('edSignInRequired')); return; }
        if (publish) {
            const v = this.editor.validate();
            if (!v.ok) { this.showToast(t('edPublishBlocked', { reason: v.reason })); return; }
        }
        lvl.published = publish || !!this.editor.level.published;
        try {
            const saved = await customLevels.saveLevel(lvl, this.auth.user);
            this.editor.level.id = saved.id;            // 记住 id，后续保存即更新
            this.editor.level.published = saved.published;
            this._syncPublishUI();
            this.showToast(t(publish ? 'edPublished' : 'edSaved'));
            if (publish) {
                const url = location.origin + location.pathname + '?level=' + saved.id;
                try { await navigator.clipboard.writeText(url); this.showToast(t('edShareCopied')); } catch (_) {}
            }
        } catch (e) {
            this.showToast(t('edSaveFailed') + (e && e.message ? ': ' + e.message : ''));
        }
    }

    // 渲染"我的关卡"列表
    async renderMyLevels() {
        const list = document.getElementById('my-levels-list');
        if (!list) return;
        list.innerHTML = '';
        let levels = [];
        try { levels = await customLevels.listMine(this.auth.user); } catch (_) {}
        if (!levels.length) {
            const empty = document.createElement('div');
            empty.className = 'leaderboard-empty';
            empty.textContent = t('edEmptyMine');
            list.appendChild(empty);
            return;
        }
        levels.forEach(lvl => {
            const card = document.createElement('div');
            card.className = 'level-card';
            const badge = lvl.published
                ? `<span class="custom-badge">${t('edPublish')}</span>`
                : `<span class="draft-badge">draft</span>`;
            // 卡片整体点击 = 游玩；右上角保留"编辑"入口 (删除已移到编辑器内)
            let upd = '';
            if (lvl.updatedAt) {
                let d = ''; try { d = new Date(lvl.updatedAt).toLocaleDateString(); } catch (_) {}
                if (d) upd = `<div class="level-card-desc">${escHtml(t('updatedAt', { date: d }))}</div>`;
            }
            card.innerHTML = `
                <div class="level-card-title">${escHtml(lvl.name || '—')}${badge}</div>
                ${upd}
                <button class="level-card-edit" data-act="edit" title="${t('createLevel')}">✎</button>`;
            card.addEventListener('click', () => {
                document.getElementById('levels-modal').classList.add('hidden');
                this.loadLevelObject(lvl);
            });
            card.querySelector('[data-act=edit]').addEventListener('click', (e) => {
                e.stopPropagation();
                document.getElementById('levels-modal').classList.add('hidden');
                this.enterEditor(lvl);
            });
            list.appendChild(card);
        });
    }

    // 渲染关卡卡片网格
    renderLevelsGrid() {
        const grid = document.getElementById('levels-list');
        if (!grid) return;
        grid.innerHTML = '';

        // 序号按可见顺序显示 (读作 1..N)，与内部 id 解耦；beta 关只对授权账号出现
        this.accessibleLevels().forEach((lvl, idx) => {
            const card = document.createElement('div');
            card.className = 'level-card';
            if (lvl.id === this.currentLevelId) card.classList.add('active');
            if (this.completedLevels.includes(lvl.id)) card.classList.add('completed');

            const doneTag = this.completedLevels.includes(lvl.id) ? t('completedTag') : '';
            const betaBadge = lvl.beta ? '<span class="beta-badge">BETA</span>' : '';
            card.innerHTML = `
                <div class="level-card-num">${t('scenarioPrefix')} ${idx + 1} ${doneTag}</div>
                <div class="level-card-title">${localize(lvl.name)}${betaBadge}</div>
                <div class="level-card-desc">${localize(lvl.description)}</div>
            `;

            card.addEventListener('click', () => {
                this.loadLevel(lvl.id);
            });

            grid.appendChild(card);
        });
    }

    // 渲染语言下拉 (弹窗第一排左侧)
    renderLangSelect() {
        const sel = document.getElementById('lang-select');
        if (!sel) return;
        // 首次渲染时填 option 并绑 change；之后只同步选中项
        if (!sel._initialized) {
            SUPPORTED_LANGS.forEach(lang => {
                const opt = document.createElement('option');
                opt.value = lang;
                opt.textContent = LANG_NAMES[lang];
                sel.appendChild(opt);
            });
            sel.addEventListener('change', () => setLang(sel.value));
            sel._initialized = true;
        }
        sel.value = getLang();
    }
}

// 页面加载完成后自动运行
window.addEventListener('DOMContentLoaded', () => {
    const app = new GameApp();
    app.init();
});
