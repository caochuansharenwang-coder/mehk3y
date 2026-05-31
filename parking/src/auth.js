/* auth.js - Google Sign-In + Worker 自签会话 token
 *
 * 流程：
 *   1. 用户点 Google 登录按钮 → GIS 回调拿到 Google idToken (1h 过期)
 *   2. 前端立即调 POST /api/auth/exchange，用 idToken 换 Worker 自签的 sessionToken (30 天)
 *   3. 之后所有需要鉴权的 API 都用 sessionToken，不再依赖 Google idToken
 *   4. sessionToken 过期 (30 天) 才需要重新走 Google 登录
 *
 * GIS 按钮的语言由 script URL 上的 ?hl= 决定，所以动态注入 <script> 而不是写死。
 */

import { API_CONFIG } from './api-config.js';

export const AUTH_CONFIG = {
    clientId: '182008322745-m6hlbs04om8jepp3j2jn2d0vt6fojtmp.apps.googleusercontent.com'
};

// 应用语言代码 → GIS hl 参数 (BCP 47 风格，注意中文用下划线)
const GOOGLE_LOCALE_MAP = {
    en: 'en',
    zh: 'zh_CN',
    ja: 'ja',
    ko: 'ko',
    fr: 'fr',
    de: 'de'
};

const STORAGE_KEY = 'truck_sim_auth';
const GIS_SCRIPT_ID = 'gis-client-script';

function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const json = decodeURIComponent(
            atob(base64).split('').map(c =>
                '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
            ).join('')
        );
        return JSON.parse(json);
    } catch (e) {
        console.warn('Failed to parse JWT', e);
        return null;
    }
}

export class Auth {
    constructor() {
        this.user = null;
        this.listeners = new Set();
        this._gisReady = false;
        this._loadedLang = null;
        this._pendingButtonContainer = null;
        this._pendingLang = null;

        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) this.user = JSON.parse(saved);
        } catch (_) {}
    }

    // 首次启动；lang 为当前应用语言，用于设置 GIS 脚本的 hl
    init(lang) {
        this._loadAndInit(lang);
    }

    // 切语言时调用：重新加载 GIS 脚本 + 让"已渲染按钮"以新语言重渲
    setLanguage(lang) {
        if (lang === this._loadedLang) return;
        this._gisReady = false;
        this._loadAndInit(lang);
    }

    _loadAndInit(lang) {
        // 自托管 / 本地 stub 模式（无后端）下不加载外部 Google Identity 脚本，保持站点 CSP 干净、零外部请求。
        if (!API_CONFIG.base) { this._loadedLang = lang; return; }
        const hl = GOOGLE_LOCALE_MAP[lang] || 'en';
        this._loadedLang = lang;

        // 移除旧脚本 (若有)，重新拉
        const old = document.getElementById(GIS_SCRIPT_ID);
        if (old) old.remove();
        // 清掉 google 全局 (重新加载脚本后才会重新初始化)
        try { if (window.google && window.google.accounts) delete window.google.accounts; } catch (_) {}

        const script = document.createElement('script');
        script.id = GIS_SCRIPT_ID;
        script.async = true;
        script.defer = true;
        script.src = `https://accounts.google.com/gsi/client?hl=${encodeURIComponent(hl)}`;
        script.onload = () => this._initGis();
        script.onerror = () => console.warn('Failed to load Google Identity Services script');
        document.head.appendChild(script);
    }

    _initGis() {
        if (typeof google === 'undefined' || !google.accounts || !google.accounts.id) {
            // 偶尔脚本 onload 早于全局赋值，轮询一下
            setTimeout(() => this._initGis(), 50);
            return;
        }
        google.accounts.id.initialize({
            client_id: AUTH_CONFIG.clientId,
            callback: (response) => this.handleCredential(response),
            auto_select: false,
            cancel_on_tap_outside: true
        });
        this._gisReady = true;
        if (this._pendingButtonContainer) {
            this.renderButton(this._pendingButtonContainer, this._pendingLang);
            this._pendingButtonContainer = null;
            this._pendingLang = null;
        }
    }

    // GIS 回调：拿到 Google idToken 后立即向 Worker 换 sessionToken
    async handleCredential(response) {
        if (!response || !response.credential) return;
        const idToken = response.credential;

        // 本地 stub 模式 (没接后端) → 直接解 Google idToken 用
        if (!API_CONFIG.base) {
            const payload = parseJwt(idToken);
            if (!payload) return;
            this.user = {
                sub: payload.sub,
                name: payload.name || payload.email,
                picture: payload.picture,
                email: payload.email || '',
                sessionToken: 'local-stub',
                expiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 3600
            };
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.user)); } catch (_) {}
            this.notify();
            return;
        }

        // 走 Worker exchange
        try {
            const res = await fetch(`${API_CONFIG.base}/auth/exchange`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ idToken })
            });
            if (!res.ok) {
                console.error('[auth] exchange failed', res.status);
                return;
            }
            const data = await res.json();
            if (!data || !data.sessionToken) {
                console.error('[auth] exchange returned no sessionToken');
                return;
            }
            this.user = {
                sub: data.user.sub,
                name: data.user.name,
                picture: data.user.picture,
                email: data.user.email || '',
                sessionToken: data.sessionToken,
                expiresAt: data.expiresAt
            };
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.user)); } catch (_) {}
            this.notify();
        } catch (err) {
            console.error('[auth] exchange threw', err);
        }
    }

    // 渲染 Google 登录按钮 (按钮文字最终由 script URL 的 ?hl= 决定，这里 locale 兜底)
    renderButton(container, lang) {
        if (!container) return;
        // 若当前加载的 GIS 脚本语言和请求语言不一致，先 reload 脚本
        if (lang && this._loadedLang !== lang) {
            this._pendingButtonContainer = container;
            this._pendingLang = lang;
            this.setLanguage(lang);
            return;
        }
        if (!this._gisReady) {
            this._pendingButtonContainer = container;
            this._pendingLang = lang;
            return;
        }
        container.innerHTML = '';
        google.accounts.id.renderButton(container, {
            theme: 'filled_black',
            size: 'large',
            shape: 'pill',
            text: 'signin_with',
            logo_alignment: 'left',
            locale: GOOGLE_LOCALE_MAP[lang] || 'en'
        });
    }

    signOut() {
        this.user = null;
        try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
        if (this._gisReady) {
            try { google.accounts.id.disableAutoSelect(); } catch (_) {}
        }
        this.notify();
    }

    isSignedIn() {
        if (!this.user || !this.user.sessionToken) return false;
        // sessionToken 由 Worker 自签，过期时间 (30 天) 直接存在 user.expiresAt 里
        if (typeof this.user.expiresAt === 'number' &&
            Math.floor(Date.now() / 1000) >= this.user.expiresAt) {
            this.signOut();
            return false;
        }
        return true;
    }

    onChange(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    notify() {
        this.listeners.forEach(fn => fn(this.user));
    }
}
