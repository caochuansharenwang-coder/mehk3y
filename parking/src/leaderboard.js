/* leaderboard.js - 排行榜接口
 *
 * 双模式：
 *   - API_CONFIG.base = null    → localStorage 桩 (仅本设备可见，离线可用)
 *   - API_CONFIG.base = '<url>' → 走真实后端 (Worker)
 *
 * Worker 部署见 worker/README.md，部署完把 URL 填到 src/api-config.js。
 */

import { API_CONFIG } from './api-config.js';

const STORAGE_KEY = 'truck_sim_leaderboard';
const LB = () => API_CONFIG.base && `${API_CONFIG.base}/leaderboard`;

function loadAll() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch (_) { return []; }
}
function saveAll(rows) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)); } catch (_) {}
}

// 关卡开始时调一次：服务端记下"开始时刻 + (可选)身份"，回 nonce；提交时凭 nonce 上报
// user 可以为 null (游客)：服务端开 guest session，submit 时再带 sessionToken 认领
// 返回 { nonce, ok, status }；status=401 通常代表 sessionToken 过期或被拒
export async function startLeaderboardSession(levelId, user) {
    const base = LB();
    if (base) {
        try {
            const body = { levelId };
            if (user && user.sessionToken) body.sessionToken = user.sessionToken;
            const res = await fetch(`${base}/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (!res.ok) {
                console.warn('[leaderboard] start failed', res.status);
                return { nonce: null, ok: false, status: res.status };
            }
            const data = await res.json();
            return { nonce: (data && data.nonce) || null, ok: true, status: 200 };
        } catch (err) {
            console.warn('[leaderboard] start threw', err);
            return { nonce: null, ok: false, status: 0 };
        }
    }
    return { nonce: 'local-stub', ok: true, status: 200 };
}

// 写入一条成绩 (同一用户同一关卡只保留最佳)
// nonce 由 startLeaderboardSession 返回；服务端用它定位会话 + 校验时间
export async function submitScore(levelId, user, timeSeconds, collisions, nonce) {
    if (!user || !user.sub) return null;
    const base = LB();

    if (base) {
        if (!nonce) {
            console.warn('[leaderboard] submit skipped: no session nonce');
            return null;
        }
        // 把 sessionToken 一起发上去：服务端如果发现这个 nonce 是 guest session，
        // 就用 sessionToken 里的身份把成绩记到对应账号。
        const body = { nonce, timeSeconds, collisions };
        if (user.sessionToken) body.sessionToken = user.sessionToken;
        const res = await fetch(`${base}/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (res.ok) return await res.json();
        // 失败时把服务端原因带回 (反作弊拒绝、会话过期等)，便于定位而非静默吞掉
        let error = '';
        try { error = (await res.json()).error || ''; } catch (_) {}
        console.warn('[leaderboard] submit rejected', res.status, error);
        return { ok: false, status: res.status, error };
    }

    // 本地桩
    const rows = loadAll();
    const existing = rows.find(r => r.levelId === levelId && r.userId === user.sub);
    if (existing) {
        if (timeSeconds < existing.timeSeconds) {
            existing.timeSeconds = timeSeconds;
            existing.collisions = collisions;
            existing.timestamp = Date.now();
        }
    } else {
        rows.push({
            levelId,
            userId: user.sub,
            name: user.name,
            picture: user.picture,
            timeSeconds,
            collisions,
            timestamp: Date.now()
        });
    }
    saveAll(rows);
    return { ok: true };
}

// 查询用户在某关卡的排名
export async function getRank(levelId, userId) {
    const base = LB();
    if (base) {
        const res = await fetch(`${base}/rank?levelId=${levelId}&userId=${userId}`);
        return res.ok ? await res.json() : null;
    }
    const rows = loadAll()
        .filter(r => r.levelId === levelId)
        .sort((a, b) => a.timeSeconds - b.timeSeconds);
    const idx = rows.findIndex(r => r.userId === userId);
    if (idx < 0) return null;
    return { rank: idx + 1, total: rows.length, entry: rows[idx] };
}

// 按时间预测排名 (游客用：还没登录，所以拿不到 userId)
// 返回 { rank, total, hypothetical: true }，total 已含这条假设成绩
export async function getRankByTime(levelId, timeSeconds) {
    const base = LB();
    if (base) {
        const res = await fetch(`${base}/rank?levelId=${levelId}&timeSeconds=${timeSeconds}`);
        return res.ok ? await res.json() : null;
    }
    const rows = loadAll()
        .filter(r => r.levelId === levelId)
        .sort((a, b) => a.timeSeconds - b.timeSeconds);
    const better = rows.filter(r => r.timeSeconds < timeSeconds).length;
    return { rank: better + 1, total: rows.length + 1, hypothetical: true };
}

// 查询某关卡前 N 名
export async function getTopN(levelId, n = 20) {
    const base = LB();
    if (base) {
        const res = await fetch(`${base}/top?levelId=${levelId}&n=${n}`);
        return res.ok ? await res.json() : [];
    }
    return loadAll()
        .filter(r => r.levelId === levelId)
        .sort((a, b) => a.timeSeconds - b.timeSeconds)
        .slice(0, n);
}
