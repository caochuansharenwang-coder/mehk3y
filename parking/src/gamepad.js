/* gamepad.js - Xbox 手柄支持 (Gamepad API)
 *
 * 实现需求里的"输入框架"部分：
 *   - 径向死区 (Radial Deadzone)：左右摇杆按 2D 向量做死区，防漂移
 *   - 扳机独立模拟量：LT / RT 各自读 0.0~1.0 (线性刹车/油门)
 *   - 灵敏度曲线：左摇杆 X 转向用 input^1.5 (中位平滑)
 *   - 修饰层 (Shift Layer)：按住 LS 切换动作层
 *   - 边沿检测 / 去抖：按一下只触发一次
 *   - 调试日志：层状态 + 死区过滤后的轴值 (window.GAMEPAD_DEBUG 开启轴日志)
 *
 * 注意：按键布局原始需求是按完整卡车模拟器写的 (转向灯/巡航/雨刷/喇叭/GPS…)，
 * 本游戏没有这些系统，所以只绑定本游戏真实存在的动作；修饰层框架已就位，
 * shift 层暂无对应动作 (仅记录)，等以后游戏加了相应系统再往里填。
 */

// W3C "standard" gamepad 布局按钮索引 (Xbox 手柄即此布局)
const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, DU: 12, DD: 13, DL: 14, DR: 15 };
const STICK_DEADZONE = 0.18;
const TRIGGER_DEADZONE = 0.06;

// 径向死区：对 (x,y) 整体取模长，模长 < dz 归零；否则重缩放使死区边缘=0、满偏=1，方向不变
function radialDeadzone(x, y, dz) {
    const mag = Math.hypot(x, y);
    if (mag < dz) return { x: 0, y: 0, mag: 0 };
    const scaled = (mag - dz) / (1 - dz);
    const k = scaled / mag;
    return { x: x * k, y: y * k, mag: scaled };
}

export class GamepadInput {
    constructor() {
        this.axes = null;        // 每帧的轴状态 { steer, steerActive, throttle, brake, camX, camY } | null
        this.onAction = null;    // (name, { modifier }) => void，由 main 接到具体游戏动作
        this.modifier = false;   // 修饰层 (LS 按住) 是否激活
        this._prev = {};         // 上一帧各按钮 pressed 状态 (边沿检测)
        this._lastAxisLog = 0;

        window.addEventListener('gamepadconnected', (e) => console.log('[gamepad] connected:', e.gamepad && e.gamepad.id));
        window.addEventListener('gamepaddisconnected', () => { console.log('[gamepad] disconnected'); this.axes = null; this._prev = {}; });
    }

    _activePad() {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (const p of pads) if (p && p.connected) return p;
        return null;
    }

    // 每帧调用 (now = RAF 时间戳 ms)
    poll(now) {
        const p = this._activePad();
        if (!p) { this.axes = null; return; }

        // --- 轴：径向死区 ---
        const ls = radialDeadzone(p.axes[0] || 0, p.axes[1] || 0, STICK_DEADZONE);
        const rs = radialDeadzone(p.axes[2] || 0, p.axes[3] || 0, STICK_DEADZONE);

        // 转向：左摇杆 X + 灵敏度曲线 input^1.5 (保留符号)
        const steer = Math.sign(ls.x) * Math.pow(Math.abs(ls.x), 1.5);

        // 扳机独立模拟量 (LT/RT 各自 0~1)，各加一点死区
        const rt = p.buttons[BTN.RT] ? p.buttons[BTN.RT].value : 0;
        const lt = p.buttons[BTN.LT] ? p.buttons[BTN.LT].value : 0;
        const throttle = rt > TRIGGER_DEADZONE ? rt : 0;
        const brake = lt > TRIGGER_DEADZONE ? lt : 0;

        this.axes = { steer, steerActive: ls.x !== 0, throttle, brake, camX: rs.x, camY: rs.y };

        // --- 修饰层：LS 按住 ---
        const mod = !!(p.buttons[BTN.LS] && p.buttons[BTN.LS].pressed);
        if (mod !== this.modifier) {
            this.modifier = mod;
            console.log('[gamepad] layer:', mod ? 'SHIFT (modifier held)' : 'standard');
        }

        // --- 按钮边沿检测 (rising edge = 本帧按下、上帧未按下) ---
        const edge = (idx) => {
            const pressed = !!(p.buttons[idx] && p.buttons[idx].pressed);
            const was = !!this._prev[idx];
            this._prev[idx] = pressed;
            return pressed && !was;
        };
        const fire = (name) => {
            console.log(`[gamepad] action: ${name}${this.modifier ? ' [shift]' : ''}`);
            if (this.onAction) this.onAction(name, { modifier: this.modifier });
        };

        // 预先读取并刷新所有相关按钮的边沿状态 (确保 _prev 不泄漏)
        const A = edge(BTN.A), B = edge(BTN.B), X = edge(BTN.X), Y = edge(BTN.Y);
        const START = edge(BTN.START), RS = edge(BTN.RS);
        const DU = edge(BTN.DU), DD = edge(BTN.DD), DL = edge(BTN.DL), DR = edge(BTN.DR);
        const LB = edge(BTN.LB), RB = edge(BTN.RB), BACK = edge(BTN.BACK);
        edge(BTN.LS); // 消费 LS 边沿 (它作修饰键，无独立动作)

        if (this.modifier) {
            // Shift 层：本游戏暂无对应系统 (转向灯/喇叭/GPS… 都不存在)，仅记录，框架已就位
            if (A || B || X || Y || DU || DD || DL || DR || LB || RB) fire('shift:noop');
        } else {
            // 标准层 —— 只绑定本游戏真实存在的动作
            if (A) fire('confirm');             // 教学页→开始练习；游戏中→切换 D/R 挡
            if (X) fire('restart');             // 重置当前关
            if (B) fire('toggleTrajectory');    // 轨迹辅助线开关
            if (Y) fire('toggleSound');         // 音效开关
            if (START) fire('openLevels');      // 打开关卡菜单
            if (RS) fire('recenterCamera');     // 相机复位
            // LB/RB/D-pad：对应的灯光/巡航/喇叭等系统本游戏没有，暂不绑定
        }

        // --- 调试：死区过滤后的轴值 (开 window.GAMEPAD_DEBUG = true) ---
        if (window.GAMEPAD_DEBUG && now - this._lastAxisLog > 400) {
            this._lastAxisLog = now;
            console.log(`[gamepad] steer=${steer.toFixed(2)} throttle=${throttle.toFixed(2)} brake=${brake.toFixed(2)} layer=${this.modifier ? 'shift' : 'std'}`);
        }
    }
}
