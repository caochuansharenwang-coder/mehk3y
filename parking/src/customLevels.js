/* customLevels.js - 用户自建关卡的存取接口
 *
 * 双模式 (与 leaderboard.js 一致)：
 *   - API_CONFIG.base = '<url>' → 走 Worker (clevel:/user_levels: KV)
 *   - API_CONFIG.base = null    → localStorage 桩 (仅本设备，离线/无后端时可用)
 *
 * 关卡对象：{ id?, name, initialState, parkingSpot, obstacles, published }
 * 服务端会补 authorSub/authorName/createdAt/updatedAt。
 */

import { API_CONFIG } from './api-config.js';

const LV = () => API_CONFIG.base && `${API_CONFIG.base}/levels`;
const STORAGE_KEY = 'truck_sim_custom_levels';

// id -> level 内存缓存 (分享链接游玩 / 编辑回填用)
const _cache = new Map();
function cachePut(level) { if (level && level.id) _cache.set(level.id, level); return level; }
export function cachedLevel(id) { return _cache.get(id) || null; }

function loadLocal() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch (_) { return []; }
}
function saveLocal(arr) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); } catch (_) {}
}
function genLocalId() { return 'loc_' + Math.random().toString(36).slice(2, 10); }

// 新建 (无 id) 或更新 (带 id) 一个关卡，返回服务端/本地存好的完整记录
export async function saveLevel(level, user) {
    const base = LV();
    if (base) {
        const res = await fetch(`${base}/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken: user && user.sessionToken, level })
        });
        if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            throw new Error(e.error || `save failed (${res.status})`);
        }
        const data = await res.json();
        return cachePut(data.level);
    }
    // 本地桩
    const arr = loadLocal();
    let rec;
    if (level.id) {
        const i = arr.findIndex(l => l.id === level.id);
        if (i < 0) throw new Error('level not found');
        rec = { ...arr[i], ...level, updatedAt: Date.now() };
        arr[i] = rec;
    } else {
        rec = {
            ...level,
            id: genLocalId(),
            authorSub: (user && user.sub) || 'local',
            authorName: (user && user.name) || '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            published: !!level.published
        };
        arr.push(rec);
    }
    saveLocal(arr);
    return cachePut(rec);
}

// 列出当前用户的全部关卡 (含草稿)
export async function listMine(user) {
    const base = LV();
    if (base) {
        const res = await fetch(`${base}/mine`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken: user && user.sessionToken })
        });
        if (!res.ok) return [];
        const data = await res.json();
        (data.levels || []).forEach(cachePut);
        return data.levels || [];
    }
    const arr = loadLocal();
    arr.forEach(cachePut);
    return arr;
}

// 读取单个关卡 (分享链接游玩)。服务端仅返回已发布关卡
export async function getLevel(id) {
    if (_cache.has(id)) return _cache.get(id);
    const base = LV();
    if (base) {
        const res = await fetch(`${base}/get?id=${encodeURIComponent(id)}`);
        if (!res.ok) return null;
        const data = await res.json();
        return cachePut(data.level);
    }
    const found = loadLocal().find(l => l.id === id) || null;
    return found ? cachePut(found) : null;
}

// ---- 收藏 / 历史 ----
// 本地 (localStorage) 始终是即时读写的工作副本；登录后再按账号同步到服务端 (prefs:<sub>)，跨设备。
const FAV_KEY = 'truck_sim_fav_levels';
const HIST_KEY = 'truck_sim_history_levels';
const HIST_MAX = 6;
const PREFS = () => API_CONFIG.base && `${API_CONFIG.base}/prefs`;

function loadFavs() { try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch (_) { return []; } }
function saveFavs(a) { try { localStorage.setItem(FAV_KEY, JSON.stringify(a)); } catch (_) {} }
function loadHist() { try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch (_) { return []; } }
function saveHist(a) { try { localStorage.setItem(HIST_KEY, JSON.stringify(a)); } catch (_) {} }

// 登录用户：把本地收藏/历史推到服务端 (fire-and-forget)
function pushPrefs(user) {
    const base = PREFS();
    if (!base || !user || !user.sessionToken) return;
    fetch(`${base}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken: user.sessionToken, favorites: loadFavs(), history: loadHist() })
    }).catch(() => {});
}

// 登录时调用：拉服务端 prefs 并与本地合并 (收藏取并集；历史按 playedAt 取最近 6)，再回推使两端一致
export async function syncPrefs(user) {
    const base = PREFS();
    if (!base || !user || !user.sessionToken) return false;
    let server;
    try {
        const res = await fetch(`${base}/get`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken: user.sessionToken })
        });
        if (!res.ok) return false;
        server = await res.json();
    } catch (_) { return false; }

    const dedupById = (arr) => {
        const seen = new Set(), out = [];
        for (const e of arr) { if (e && e.id != null && !seen.has(e.id)) { seen.add(e.id); out.push(e); } }
        return out;
    };
    const favs = dedupById([...loadFavs(), ...(server.favorites || [])]);
    const hist = dedupById([...loadHist(), ...(server.history || [])])
        .sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0))
        .slice(0, HIST_MAX);
    saveFavs(favs); saveHist(hist);
    pushPrefs(user); // 合并结果回推
    return true;
}

// 通知服务端某关收藏状态变化 (维护全网收藏人数)，仅登录用户
function favSignal(id, on, user) {
    const base = LV();
    if (!base || !user || !user.sessionToken) return;
    fetch(`${base}/fav`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken: user.sessionToken, id, on })
    }).catch(() => {});
}

export function listFavorites() { return loadFavs(); }
export function isFavorite(id) { return loadFavs().some(f => f.id === id); }
export function removeFavorite(id, user) { saveFavs(loadFavs().filter(f => f.id !== id)); pushPrefs(user); favSignal(id, false, user); }
// 收藏只存展示所需的轻量快照 (id/名字/作者)，游玩时再按 id 取最新
export function toggleFavorite(level, user) {
    const favs = loadFavs();
    const i = favs.findIndex(f => f.id === level.id);
    let result;
    if (i >= 0) { favs.splice(i, 1); result = false; }
    else { favs.push({ id: level.id, name: level.name, authorName: level.authorName || '', updatedAt: level.updatedAt || 0 }); result = true; }
    saveFavs(favs);
    pushPrefs(user);
    favSignal(level.id, result, user);
    return result;
}

// 已发布关卡画廊 (后端聚合，含 plays/favs)；sort = new | plays | favs
export async function gallery(sort) {
    const base = LV();
    if (!base) return [];
    try {
        const res = await fetch(`${base}/gallery?sort=${encodeURIComponent(sort || 'new')}`);
        if (!res.ok) return [];
        const data = await res.json();
        return data.levels || [];
    } catch (_) { return []; }
}

export function listHistory() { return loadHist(); }
export function recordHistory(level, user) {
    if (!level || level.id == null) return;
    let hist = loadHist().filter(h => h.id !== level.id); // 去重
    hist.unshift({ id: level.id, name: level.name, authorName: level.authorName || '', updatedAt: level.updatedAt || 0, playedAt: Date.now() });
    hist = hist.slice(0, HIST_MAX);
    saveHist(hist);
    pushPrefs(user);
}

// 删除自己的关卡
export async function deleteLevel(id, user) {
    const base = LV();
    _cache.delete(id);
    if (base) {
        const res = await fetch(`${base}/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken: user && user.sessionToken, id })
        });
        return res.ok;
    }
    saveLocal(loadLocal().filter(l => l.id !== id));
    return true;
}
