/* api-config.js - 后端 API 根路径
 *
 * 双模式：
 *   - base = null            → 本地 stub (leaderboard 走 localStorage、auth 直接通过)
 *   - base = '<url>/api'     → 走真实 Worker
 */

export const API_CONFIG = {
    // 本地开发可改成 'http://localhost:8787/api'
    base: null
};
