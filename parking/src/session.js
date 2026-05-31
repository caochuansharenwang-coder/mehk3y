/* session.js - 玩耍时长会话计时器
 *
 * 每隔 intervalSeconds 秒，触发一次"会话弹窗"，玩家须选择"继续"或"重置"。
 * 这是为后续接入"看广告 / 支付积分才能继续"的变现机制预留的中间层 ——
 *   - requestContinue() 在玩家点"继续"时被调用，可在这里展示广告 / 扣积分；
 *     返回 { allow: true } 才会真正放行；返回 { allow: false } 则保持弹窗。
 *   - requestReset() 同理，重置一般无需付费，默认放行。
 * 接入广告/积分接口时，只需把这两个函数替换成真实实现，UI 与计时逻辑无需改动。
 */

export const SESSION_CONFIG = {
    // 是否启用 (默认关闭；准备好接入广告/积分时改为 true)
    enabled: false,

    // 一次会话上限秒数
    intervalSeconds: 60,

    /**
     * 玩家点"继续"时调用。可在此处接入广告/积分接口。
     * @param {{ levelId: number, elapsedSeconds: number }} ctx
     * @returns {Promise<{ allow: boolean, reason?: string }>}
     *
     * 示例：接入"积分扣费"的真实实现
     *   requestContinue: async ({ levelId }) => {
     *       const res = await fetch('/api/credits/spend', {
     *           method: 'POST',
     *           body: JSON.stringify({ amount: 1, reason: 'continue', levelId })
     *       });
     *       if (!res.ok) return { allow: false, reason: 'insufficient_credits' };
     *       return { allow: true };
     *   }
     *
     * 示例：接入"看广告解锁"
     *   requestContinue: async () => {
     *       const watched = await window.adSDK.showRewardedAd();
     *       return { allow: !!watched };
     *   }
     */
    requestContinue: async (_ctx) => ({ allow: true }),

    /**
     * 玩家点"重置"时调用。默认直接放行；如果未来重置也想计费 / 上报，可替换此函数。
     * @param {{ levelId: number, elapsedSeconds: number }} ctx
     * @returns {Promise<{ allow: boolean, reason?: string }>}
     */
    requestReset: async (_ctx) => ({ allow: true })
};

export class SessionTimer {
    constructor(config) {
        this.config = config;
        this.elapsed = 0;
        this.paused = false;
        this.onLimit = null; // 时间到回调
    }

    // 每帧调用 (传入 dt，秒)
    tick(dt) {
        if (!this.config.enabled || this.paused) return;
        this.elapsed += dt;
        if (this.elapsed >= this.config.intervalSeconds) {
            this.paused = true;
            if (this.onLimit) this.onLimit();
        }
    }

    reset() {
        this.elapsed = 0;
        this.paused = false;
    }

    pause() { this.paused = true; }
    resume() { this.paused = false; }
}
