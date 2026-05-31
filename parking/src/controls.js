/* controls.js - 2D半挂车停车模拟器控制器 */

export class Controls {
    constructor() {
        // 当前控制输入值 (传递给物理引擎)
        this.throttle = 0;      // 0 或 1 (油门)
        this.brake = 0;         // 0 或 1 (刹车)
        this.gear = 'D';        // 'D' (前进) 或 'R' (倒车)
        this.steerInput = 0;    // -1 (全左) 到 1 (全右)

        // 配置参数
        this.autoCenter = true; // 手指松开时方向盘是否自动回正

        // 方向盘状态
        this.wheelAngle = 0;            // 方向盘当前的旋转角度 (度数, 正值为右, 负值为左)
        this.maxWheelAngle = 540;       // 方向盘最大旋转度数 (540度 = 1.5圈)
        this.isDraggingWheel = false;
        this.lastWheelTouchAngle = 0;   // 上一帧手势角 (弧度)

        // 多点触控：每个控件追踪其独占的 touch identifier
        // 这样油门 / 刹车 / 方向盘 可以同时被不同手指操作而互不干扰
        this.wheelTouchId = null;
        this.gasTouchId = null;
        this.brakeTouchId = null;

        // 输入源分开记录，避免帧更新中相互覆盖
        this.touchThrottle = 0;
        this.touchBrake = 0;
        this.keyboardThrottle = 0;
        this.keyboardBrake = 0;
        // 手柄输入 (模拟量 0~1)；padSteer 为 null 表示本帧手柄未在转向，交还键盘/自动回正
        this.padThrottle = 0;
        this.padBrake = 0;
        this.padSteer = null;

        // Brake-throttle override：一旦踩了刹车，把油门锁住，直到用户彻底松开油门后再踩才解锁
        // 否则会出现"边踩油门边踩刹车 → 松刹车后又继续走"的怪异行为
        this.throttleLocked = false;

        // 键盘按键状态
        this.keys = {};

        // DOM 缓存
        this.dom = {};
    }

    // 初始化 DOM 引用并绑定事件
    init() {
        this.dom.wheel = document.getElementById('steering-wheel');
        this.dom.wheelVal = document.getElementById('steering-val');
        this.dom.gearD = document.getElementById('gear-d');
        this.dom.gearR = document.getElementById('gear-r');
        this.dom.pedalGas = document.getElementById('pedal-gas');
        this.dom.pedalBrake = document.getElementById('pedal-brake');

        this.setupPedals();
        this.setupGearSelector();
        this.setupSteeringWheel();
        this.setupKeyboard();
    }

    // 绑定单个踏板：使用 touch identifier 跟踪独立手指，支持多点同时按下
    bindPedal(el, getId, setId, setActive) {
        el.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (getId() !== null) return; // 已被某根手指占用，忽略后续手指
            const t = e.changedTouches[0];
            if (!t) return;
            setId(t.identifier);
            setActive(true);
        }, { passive: false });

        const releaseIfMatch = (e) => {
            const id = getId();
            if (id === null) return;
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === id) {
                    setId(null);
                    setActive(false);
                    return;
                }
            }
        };
        el.addEventListener('touchend', releaseIfMatch);
        el.addEventListener('touchcancel', releaseIfMatch);

        // 鼠标 (桌面端)
        el.addEventListener('mousedown', (e) => {
            e.preventDefault();
            if (getId() === null) setActive(true);
        });
        const mouseRelease = () => {
            if (getId() === null) setActive(false);
        };
        el.addEventListener('mouseup', mouseRelease);
        el.addEventListener('mouseleave', mouseRelease);
    }

    setupPedals() {
        this.bindPedal(
            this.dom.pedalGas,
            () => this.gasTouchId,
            (id) => { this.gasTouchId = id; },
            (active) => { this.touchThrottle = active ? 1 : 0; },
        );
        this.bindPedal(
            this.dom.pedalBrake,
            () => this.brakeTouchId,
            (id) => { this.brakeTouchId = id; },
            (active) => { this.touchBrake = active ? 1 : 0; },
        );
    }

    // 绑定挡位切换事件
    setupGearSelector() {
        const btnD = this.dom.gearD;
        const btnR = this.dom.gearR;

        const selectGear = (g) => {
            this.gear = g;
            btnD.classList.toggle('active', g === 'D');
            btnR.classList.toggle('active', g === 'R');
            if (this.onGearChange) this.onGearChange(g);
        };

        btnD.addEventListener('click', () => selectGear('D'));
        btnD.addEventListener('touchstart', (e) => {
            e.preventDefault();
            selectGear('D');
        }, { passive: false });

        btnR.addEventListener('click', () => selectGear('R'));
        btnR.addEventListener('touchstart', (e) => {
            e.preventDefault();
            selectGear('R');
        }, { passive: false });
    }

    // 核心：虚拟方向盘的拖拽与物理计算 (使用 touch identifier 支持多点触控)
    setupSteeringWheel() {
        const wheel = this.dom.wheel;

        const getTouchAngle = (clientX, clientY) => {
            const rect = wheel.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            return Math.atan2(clientY - cy, clientX - cx);
        };

        const beginDrag = (clientX, clientY) => {
            this.isDraggingWheel = true;
            this.lastWheelTouchAngle = getTouchAngle(clientX, clientY);
        };

        const updateDrag = (clientX, clientY) => {
            if (!this.isDraggingWheel) return;
            const currentAngle = getTouchAngle(clientX, clientY);
            let diff = (currentAngle - this.lastWheelTouchAngle) * (180 / Math.PI);
            // 跨越 ±180° 分界线时的跳变修正
            if (diff < -180) diff += 360;
            if (diff > 180) diff -= 360;
            this.wheelAngle = Math.max(-this.maxWheelAngle,
                Math.min(this.maxWheelAngle, this.wheelAngle + diff));
            this.lastWheelTouchAngle = currentAngle;
            this.updateSteerInputFromWheel();
        };

        const endDrag = () => {
            this.isDraggingWheel = false;
            this.wheelTouchId = null;
        };

        // 触控：只追踪在方向盘上首次按下的那根手指
        wheel.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (this.wheelTouchId !== null) return;
            const t = e.changedTouches[0];
            if (!t) return;
            this.wheelTouchId = t.identifier;
            beginDrag(t.clientX, t.clientY);
        }, { passive: false });

        // touchmove 在 window 上监听，但通过 identifier 过滤，
        // 这样另一根手指 (如踩油门) 移动不会影响方向盘
        window.addEventListener('touchmove', (e) => {
            if (this.wheelTouchId === null) return;
            for (let i = 0; i < e.changedTouches.length; i++) {
                const t = e.changedTouches[i];
                if (t.identifier === this.wheelTouchId) {
                    e.preventDefault();
                    updateDrag(t.clientX, t.clientY);
                    return;
                }
            }
        }, { passive: false });

        const onTouchEnd = (e) => {
            if (this.wheelTouchId === null) return;
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === this.wheelTouchId) {
                    endDrag();
                    return;
                }
            }
        };
        window.addEventListener('touchend', onTouchEnd);
        window.addEventListener('touchcancel', onTouchEnd);

        // 鼠标 (与触控互斥：触控激活时忽略鼠标)
        wheel.addEventListener('mousedown', (e) => {
            if (this.wheelTouchId !== null) return;
            e.preventDefault();
            beginDrag(e.clientX, e.clientY);
        });
        window.addEventListener('mousemove', (e) => {
            if (this.wheelTouchId === null && this.isDraggingWheel) {
                updateDrag(e.clientX, e.clientY);
            }
        });
        window.addEventListener('mouseup', () => {
            if (this.wheelTouchId === null) endDrag();
        });
    }

    // 根据方向盘的角度更新实际控制输出 steerInput (-1 ~ 1)
    updateSteerInputFromWheel() {
        this.steerInput = this.wheelAngle / this.maxWheelAngle;

        if (this.dom.wheel) {
            this.dom.wheel.style.transform = `rotate(${this.wheelAngle}deg)`;
        }
        if (this.dom.wheelVal) {
            const frontWheelDeg = Math.round(this.steerInput * 45);
            this.dom.wheelVal.textContent = `${frontWheelDeg}°`;
        }
    }

    // 绑定键盘按键 (桌面端测试)
    setupKeyboard() {
        window.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;

            if (e.code === 'KeyR') {
                const nextGear = (this.gear === 'D') ? 'R' : 'D';
                const btn = (nextGear === 'D') ? this.dom.gearD : this.dom.gearR;
                if (btn) btn.click();
            }

            if (e.code === 'Escape') {
                const btnRestart = document.getElementById('btn-restart');
                if (btnRestart) btnRestart.click();
            }
        });

        window.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });
    }

    // 每帧由 main 喂入手柄轴 (gamepad.axes 或 null)
    setPadAxes(axes) {
        if (!axes) { this.padThrottle = 0; this.padBrake = 0; this.padSteer = null; return; }
        this.padThrottle = axes.throttle || 0;
        this.padBrake = axes.brake || 0;
        this.padSteer = axes.steerActive ? axes.steer : null;
    }

    // 游戏帧更新：处理键盘平滑过渡 + 方向盘回正 + 合并触控/键盘/手柄输入
    update(dt) {
        // 1. 方向盘：拖拽 > 手柄 > 键盘 / 自动回正
        if (!this.isDraggingWheel) {
            // 手柄左摇杆直接定方向盘角度 (已含死区与灵敏度曲线)，松杆即归 null 让键盘/回正接管
            if (this.padSteer !== null) {
                this.wheelAngle = this.padSteer * this.maxWheelAngle;
                this.updateSteerInputFromWheel();
                return this._mergePedals();
            }
            const isLeftHeld = this.keys['KeyA'] || this.keys['ArrowLeft'];
            const isRightHeld = this.keys['KeyD'] || this.keys['ArrowRight'];

            if (isLeftHeld) {
                this.wheelAngle = Math.max(-this.maxWheelAngle, this.wheelAngle - 450 * dt);
                this.updateSteerInputFromWheel();
            } else if (isRightHeld) {
                this.wheelAngle = Math.min(this.maxWheelAngle, this.wheelAngle + 450 * dt);
                this.updateSteerInputFromWheel();
            } else if (this.autoCenter && this.wheelAngle !== 0) {
                const centerSpeed = 400 * dt;
                if (Math.abs(this.wheelAngle) < centerSpeed) {
                    this.wheelAngle = 0;
                } else {
                    this.wheelAngle -= Math.sign(this.wheelAngle) * centerSpeed;
                }
                this.updateSteerInputFromWheel();
            }
        }

        this._mergePedals();
    }

    // 合并触控/键盘/手柄的油门刹车 (键盘触控为 0/1，手柄为模拟量 0~1，取最大)
    _mergePedals() {
        // 键盘油门 / 刹车 (单独记录，避免覆盖触控输入)
        const isUpHeld = this.keys['KeyW'] || this.keys['ArrowUp'];
        const isDownHeld = this.keys['KeyS'] || this.keys['ArrowDown'];
        const isSpaceHeld = this.keys['Space'];

        this.keyboardBrake = (isDownHeld || isSpaceHeld) ? 1 : 0;
        this.keyboardThrottle = (isUpHeld && !isSpaceHeld) ? 1 : 0;

        // 合并三路输入：取最大值，保留手柄的模拟量
        const rawThrottle = Math.max(this.touchThrottle, this.keyboardThrottle, this.padThrottle);
        this.brake = Math.max(this.touchBrake, this.keyboardBrake, this.padBrake);

        // Brake-throttle override：刹车按下→锁油门；锁住期间油门彻底归零才解锁
        // (避免"踩油门同时踩刹车→松刹车"还继续走)
        if (this.brake > 0) this.throttleLocked = true;
        if (this.throttleLocked && rawThrottle === 0) this.throttleLocked = false;
        this.throttle = this.throttleLocked ? 0 : rawThrottle;

        // 同步踏板按下视觉效果
        if (this.dom.pedalGas) this.dom.pedalGas.classList.toggle('pressed', this.throttle > 0);
        if (this.dom.pedalBrake) this.dom.pedalBrake.classList.toggle('pressed', this.brake > 0);
    }

    // 强制清理输入状态 (在弹窗显示或重置关卡时调用)
    resetInputs() {
        this.throttle = 0;
        this.brake = 0;
        this.touchThrottle = 0;
        this.touchBrake = 0;
        this.keyboardThrottle = 0;
        this.keyboardBrake = 0;
        this.padThrottle = 0;
        this.padBrake = 0;
        this.padSteer = null;
        this.throttleLocked = false;
        this.wheelAngle = 0;
        this.isDraggingWheel = false;
        this.wheelTouchId = null;
        this.gasTouchId = null;
        this.brakeTouchId = null;
        this.keys = {};
        this.updateSteerInputFromWheel();
        if (this.dom.pedalGas) this.dom.pedalGas.classList.remove('pressed');
        if (this.dom.pedalBrake) this.dom.pedalBrake.classList.remove('pressed');
    }
}
