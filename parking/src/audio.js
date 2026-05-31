/* audio.js - Web Audio API 声音合成器 */

export class AudioSynthesizer {
    constructor() {
        this.ctx = null;
        this.enabled = true;
        
        // 引擎声源节点
        this.engineOsc = null;
        this.engineGain = null;
        
        // 倒车警报器定时器与状态
        this.reverseBeepTimer = null;
        this.isReversing = false;
        
        // 保证浏览器互动后解锁音频上下文
        this.unlocked = false;
    }

    // 初始化/解锁 AudioContext
    init() {
        if (this.ctx) return;
        
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContextClass();
        } catch (e) {
            console.warn("当前浏览器不支持 Web Audio API");
            this.enabled = false;
        }
    }

    // 解锁音频上下文 (必须在用户点击/触摸事件中调用)
    // 只 resume + 标记解锁，不在这里启动引擎声：此刻 ctx 可能还没真正 running，
    // 过早 start 会得到一个哑振荡器。引擎声交给 updateEngine 在驾驶帧 (ctx 已 running) 惰性创建。
    unlock() {
        if (!this.enabled || this.unlocked) return;
        this.init();
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume().then(() => { this.unlocked = true; });
        } else if (this.ctx) {
            this.unlocked = true;
        }
    }

    // 切换整体声音开/关
    toggle(state) {
        this.enabled = state;
        if (!state) {
            this.stopAll();
        } else {
            this.unlock();
            if (this.unlocked) {
                this.startEngineSound();
                if (this.isReversing) this.startReverseBeep();
            }
        }
    }

    // 停止所有声音
    stopAll() {
        this.stopEngineSound();
        this.stopReverseBeep();
    }

    // 1. 合成柴油机轰鸣声
    startEngineSound() {
        if (!this.enabled || !this.ctx || this.engineOsc) return;

        try {
            // 使用三角波合成低沉频率
            this.engineOsc = this.ctx.createOscillator();
            this.engineOsc.type = 'triangle';
            this.engineOsc.frequency.setValueAtTime(32, this.ctx.currentTime); // 基础频率 32Hz
            
            // 旁路滤波器滤除高频杂音，使其更有厚重感
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(100, this.ctx.currentTime);

            // 音量控制
            this.engineGain = this.ctx.createGain();
            this.engineGain.gain.setValueAtTime(0.08, this.ctx.currentTime);

            // 连接节点
            this.engineOsc.connect(filter);
            filter.connect(this.engineGain);
            this.engineGain.connect(this.ctx.destination);

            this.engineOsc.start(0);
        } catch (e) {
            console.error("引擎声启动失败", e);
        }
    }

    // 动态调整引擎音调和音量 (根据卡车速度和油门状态)
    updateEngine(speed, isAccelerating) {
        if (!this.enabled || !this.unlocked || !this.ctx) return;
        // 自愈：已解锁且声音开启但引擎声未起 (例如首次解锁后还没 start)，这里补起
        if (!this.engineOsc) this.startEngineSound();
        if (!this.engineOsc) return;

        const absSpeed = Math.abs(speed);
        // 频率范围: 32Hz (怠速) 到 80Hz (最大速度)
        const targetFreq = 32 + absSpeed * 1.1 + (isAccelerating ? 10 : 0);
        
        // 音量范围: 怠速较轻，踩油门加速时变响
        const targetGain = 0.08 + (absSpeed / 45) * 0.08 + (isAccelerating ? 0.06 : 0);

        const now = this.ctx.currentTime;
        // 平滑过渡
        this.engineOsc.frequency.setTargetAtTime(targetFreq, now, 0.1);
        this.engineGain.gain.setTargetAtTime(targetGain, now, 0.1);
    }

    stopEngineSound() {
        if (this.engineOsc) {
            try {
                this.engineOsc.stop();
                this.engineOsc.disconnect();
            } catch (e) {}
            this.engineOsc = null;
            this.engineGain = null;
        }
    }

    // 2. 倒车“嘀嘀”警报声
    setReversing(active) {
        if (this.isReversing === active) return;
        this.isReversing = active;

        if (active) {
            this.startReverseBeep();
        } else {
            this.stopReverseBeep();
        }
    }

    startReverseBeep() {
        if (!this.enabled || !this.unlocked || !this.ctx || this.reverseBeepTimer) return;

        const playBeep = () => {
            if (!this.enabled || !this.unlocked || !this.isReversing) return;

            try {
                const osc = this.ctx.createOscillator();
                const gainNode = this.ctx.createGain();

                osc.type = 'sine';
                osc.frequency.setValueAtTime(950, this.ctx.currentTime); // 950Hz 经典倒车音调

                gainNode.gain.setValueAtTime(0.04, this.ctx.currentTime);
                // 警报声持续时间 0.35 秒，然后淡出
                gainNode.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.35);

                osc.connect(gainNode);
                gainNode.connect(this.ctx.destination);

                osc.start();
                osc.stop(this.ctx.currentTime + 0.4);
            } catch (e) {}
        };

        // 没隔 1 秒嘀一声
        playBeep();
        this.reverseBeepTimer = setInterval(playBeep, 1000);
    }

    stopReverseBeep() {
        if (this.reverseBeepTimer) {
            clearInterval(this.reverseBeepTimer);
            this.reverseBeepTimer = null;
        }
    }

    // 3. 碰撞“卡嚓”声 (白噪波合成)
    playCollision() {
        if (!this.enabled || !this.unlocked || !this.ctx) return;

        try {
            const bufferSize = this.ctx.sampleRate * 0.25; // 0.25秒时长
            const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const data = buffer.getChannelData(0);
            
            // 填充随机白噪波
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }

            const noiseNode = this.ctx.createBufferSource();
            noiseNode.buffer = buffer;

            // 低通滤波器营造沉闷撞击感
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(150, this.ctx.currentTime);
            filter.Q.setValueAtTime(5, this.ctx.currentTime);

            // 音量包络线：快速拉高并衰减
            const gainNode = this.ctx.createGain();
            gainNode.gain.setValueAtTime(0.5, this.ctx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.24);

            noiseNode.connect(filter);
            filter.connect(gainNode);
            gainNode.connect(this.ctx.destination);

            noiseNode.start();
        } catch (e) {
            console.error("碰撞音效播放失败", e);
        }
    }

    // 4. 通关喜庆音乐 (简单的琶音大三和弦)
    playVictory() {
        if (!this.enabled || !this.unlocked || !this.ctx) return;

        try {
            const now = this.ctx.currentTime;
            // C和弦音高: C4(261.63Hz), E4(329.63Hz), G4(392.00Hz), C5(523.25Hz)
            const notes = [261.63, 329.63, 392.00, 523.25];
            
            notes.forEach((freq, idx) => {
                const osc = this.ctx.createOscillator();
                const gainNode = this.ctx.createGain();

                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, now + idx * 0.12);

                gainNode.gain.setValueAtTime(0.12, now + idx * 0.12);
                gainNode.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.6);

                osc.connect(gainNode);
                gainNode.connect(this.ctx.destination);

                osc.start(now + idx * 0.12);
                osc.stop(now + idx * 0.12 + 0.65);
            });
        } catch (e) {}
    }
}
