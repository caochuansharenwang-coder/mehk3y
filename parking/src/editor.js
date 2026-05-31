/* editor.js - 可视化关卡编辑器
 *
 * 复用游戏 canvas + CanvasRenderer 画基础场景 (网格/车位/障碍/起点车ghost)，
 * 再在屏幕空间叠加选中高亮 + 旋转/缩放手柄。负责：选取、拖动、旋转、缩放、
 * 相机平移缩放、检视面板滑块、发布前 OBB 可解性自检。
 *
 * 与 main.js 的分工：editor 管画布交互 + 检视面板；main 管生命周期 + 存档/发布/试玩 API。
 */

import { Vehicle, checkOBBCollision } from './physics.js';
import { t } from './i18n.js';

// 元素尺寸约束 (与 worker sanitizeLevelGeometry 范围一致)
const SPOT = { wMin: 24, wMax: 160, lMin: 60, lMax: 320 };
const WALL = { tMin: 4, tMax: 60, lMin: 20, lMax: 800 };
const CONE_SIZE = 22;
const HANDLE_HIT = 16; // 手柄命中半径 (屏幕像素)

function blankLevel() {
    return {
        name: '',
        initialState: { x: 480, y: 240, thetaC: 0, thetaT: 0 },
        parkingSpot: { x: 200, y: 240, width: 36, length: 125, angle: 0 },
        obstacles: []
    };
}

// 点是否落在某 OBB 内 (中心 cx,cy，沿 angle 的半长 hx / 半宽 hy)
function pointInOBB(px, py, cx, cy, hx, hy, angle) {
    const dx = px - cx, dy = py - cy;
    const c = Math.cos(-angle), s = Math.sin(-angle);
    const lx = dx * c - dy * s, ly = dx * s + dy * c;
    return Math.abs(lx) <= hx && Math.abs(ly) <= hy;
}

export class LevelEditor {
    constructor(canvas, renderer) {
        this.canvas = canvas;
        this.renderer = renderer;
        this.active = false;
        this.level = blankLevel();
        this.ghost = new Vehicle(0, 0, 0, 0);
        this.selection = null;   // { type:'start'|'spot'|'obstacle', index? }
        this.drag = null;        // { mode:'move'|'rotate'|'resize-l'|'resize-w'|'pan', ... }
        this._bound = false;
        this.onChange = null;    // 回调：working level 变化时通知 main (更新标题等)

        // 多指触控：追踪所有活动指针，2 指 → 捏合缩放/平移
        this._pointers = new Map(); // pointerId -> {x, y} (屏幕坐标)
        this._pinch = null;         // { dist, mx, my }
        // 触屏手指比鼠标粗，放大手柄命中区
        this.handleHit = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ? 26 : 16;

        this._onDown = this._onDown.bind(this);
        this._onMove = this._onMove.bind(this);
        this._onUp = this._onUp.bind(this);
        this._onWheel = this._onWheel.bind(this);
    }

    // ---- 生命周期 ----
    open(level) {
        this.level = level ? JSON.parse(JSON.stringify(level)) : blankLevel();
        if (!this.level.obstacles) this.level.obstacles = [];
        this.selection = null;
        this.active = true;
        // 相机：取消跟随/开场，框住车位附近
        const cam = this.renderer.camera;
        cam.introMode = false; cam.inTransition = false; cam.isDragging = false;
        cam.x = this.level.parkingSpot.x; cam.y = this.level.parkingSpot.y; cam.zoom = 1.1;
        this.renderer.minimapY = 92; // 下移到工具栏正下方 (不要太低)
        this._bindControls();
        this.refreshInspector();
        this._setName(this.level.name || '');
    }

    close() {
        this.active = false;
        this.renderer.minimapY = 65; // 还原小地图位置
        this._unbindControls();
    }

    getWorkingLevel() {
        // 起点车保持直车 (thetaT = thetaC)
        this.level.initialState.thetaT = this.level.initialState.thetaC;
        this.level.name = (document.getElementById('ed-name')?.value || '').trim();
        return JSON.parse(JSON.stringify(this.level));
    }

    // ---- 坐标变换 ----
    _rect() { return this.canvas.getBoundingClientRect(); }
    _worldFromScreen(sx, sy) {
        const { width: W, height: H } = this._rect();
        const cam = this.renderer.camera;
        return { x: cam.x + (sx - W / 2) / cam.zoom, y: cam.y + (sy - H / 2) / cam.zoom };
    }
    _screenFromWorld(wx, wy) {
        const { width: W, height: H } = this._rect();
        const cam = this.renderer.camera;
        return { x: (wx - cam.x) * cam.zoom + W / 2, y: (wy - cam.y) * cam.zoom + H / 2 };
    }
    _evtScreen(e) {
        const r = this._rect();
        const p = e.touches ? e.touches[0] : e;
        return { x: p.clientX - r.left, y: p.clientY - r.top };
    }

    // ---- 选中元素的几何 (中心 + 半长半宽 + 角度) ----
    _elemGeom(sel) {
        const L = this.level;
        if (sel.type === 'spot') {
            const s = L.parkingSpot;
            return { cx: s.x, cy: s.y, hx: s.length / 2, hy: s.width / 2, angle: s.angle, obj: s };
        }
        if (sel.type === 'obstacle') {
            const o = L.obstacles[sel.index];
            return { cx: o.x, cy: o.y, hx: o.length / 2, hy: o.width / 2, angle: o.angle, obj: o };
        }
        // start：以整车包围估算 (kingpin 在 x,y；整车中心约在 heading 反方向 30)
        const is = L.initialState;
        const cx = is.x - 30 * Math.cos(is.thetaC), cy = is.y - 30 * Math.sin(is.thetaC);
        return { cx, cy, hx: 75, hy: 14, angle: is.thetaC, obj: is, isStart: true };
    }

    _resizable(sel) { return sel.type === 'spot' || (sel.type === 'obstacle' && this.level.obstacles[sel.index].type === 'wall'); }
    _rotatable(sel) { return sel.type === 'start' || sel.type === 'spot' || (sel.type === 'obstacle' && this.level.obstacles[sel.index].type === 'wall'); }

    // 手柄世界坐标
    _handles(sel) {
        const g = this._elemGeom(sel);
        const c = Math.cos(g.angle), s = Math.sin(g.angle);
        const h = {};
        if (this._rotatable(sel)) {
            const off = g.hy + 34 / this.renderer.camera.zoom;
            h.rotate = { x: g.cx - s * off, y: g.cy + c * off };
        }
        if (this._resizable(sel)) {
            h.resizeL = { x: g.cx + c * g.hx, y: g.cy + s * g.hx };           // 沿长轴 +X 端
            h.resizeW = { x: g.cx - s * g.hy, y: g.cy + c * g.hy };           // 沿短轴 +Y 边
        }
        return h;
    }

    // ---- 指针交互 ----
    _bindControls() {
        if (this._bound) return;
        this.canvas.addEventListener('pointerdown', this._onDown);
        window.addEventListener('pointermove', this._onMove);
        window.addEventListener('pointerup', this._onUp);
        window.addEventListener('pointercancel', this._onUp);
        this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
        this._bound = true;
    }
    _unbindControls() {
        if (!this._bound) return;
        this.canvas.removeEventListener('pointerdown', this._onDown);
        window.removeEventListener('pointermove', this._onMove);
        window.removeEventListener('pointerup', this._onUp);
        window.removeEventListener('pointercancel', this._onUp);
        this.canvas.removeEventListener('wheel', this._onWheel);
        this._pointers.clear(); this._pinch = null; this.drag = null;
        this._bound = false;
    }

    _onWheel(e) {
        if (!this.active) return;
        e.preventDefault();
        const cam = this.renderer.camera;
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        cam.zoom = Math.max(0.4, Math.min(3, cam.zoom * factor));
    }

    _onDown(e) {
        if (!this.active) return;
        const sp = this._evtScreen(e);
        if (e.pointerId != null) this._pointers.set(e.pointerId, { x: sp.x, y: sp.y });

        // 双指 → 进入捏合缩放/平移，取消任何单指拖动
        if (this._pointers.size >= 2) {
            this.drag = null;
            this._pinch = null; // 下一帧 move 时初始化
            return;
        }

        // 1. 若已选中，先测手柄
        if (this.selection) {
            const hs = this._handles(this.selection);
            for (const [k, w] of Object.entries(hs)) {
                const s = this._screenFromWorld(w.x, w.y);
                if (Math.hypot(s.x - sp.x, s.y - sp.y) <= this.handleHit) {
                    this.drag = { mode: k === 'rotate' ? 'rotate' : (k === 'resizeL' ? 'resize-l' : 'resize-w') };
                    return;
                }
            }
        }
        // 2. 命中测试元素 (障碍优先，从后往前；再车位；再起点)
        const w = this._worldFromScreen(sp.x, sp.y);
        const hit = this._hitTest(w.x, w.y);
        if (hit) {
            this.selection = hit;
            this.refreshInspector();
            this.drag = { mode: 'move', lastX: w.x, lastY: w.y };
            return;
        }
        // 3. 空白 → 平移相机
        this.selection = null;
        this.refreshInspector();
        this.drag = { mode: 'pan', lastX: sp.x, lastY: sp.y };
    }

    _hitTest(wx, wy) {
        const L = this.level;
        for (let i = L.obstacles.length - 1; i >= 0; i--) {
            const o = L.obstacles[i];
            const hx = o.type === 'cone' ? CONE_SIZE / 2 + 4 : o.length / 2;
            const hy = o.type === 'cone' ? CONE_SIZE / 2 + 4 : o.width / 2;
            if (pointInOBB(wx, wy, o.x, o.y, Math.max(hx, 10), Math.max(hy, 10), o.angle)) return { type: 'obstacle', index: i };
        }
        const s = L.parkingSpot;
        if (pointInOBB(wx, wy, s.x, s.y, s.length / 2, s.width / 2, s.angle)) return { type: 'spot' };
        const g = this._elemGeom({ type: 'start' });
        if (pointInOBB(wx, wy, g.cx, g.cy, g.hx, g.hy, g.angle)) return { type: 'start' };
        return null;
    }

    _onMove(e) {
        if (!this.active) return;
        const sp = this._evtScreen(e);
        if (e.pointerId != null && this._pointers.has(e.pointerId)) this._pointers.set(e.pointerId, { x: sp.x, y: sp.y });

        // 双指捏合：缩放 + 平移，锚定手指中点下的世界点
        if (this._pointers.size >= 2) {
            const pts = [...this._pointers.values()];
            const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
            const mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2;
            const cam = this.renderer.camera;
            if (this._pinch && this._pinch.dist > 0) {
                const before = this._worldFromScreen(mx, my);             // 旧 cam/zoom 下中点对应的世界点
                cam.zoom = Math.max(0.4, Math.min(3, cam.zoom * (dist / this._pinch.dist)));
                const { width: W, height: H } = this._rect();
                cam.x = before.x - (mx - W / 2) / cam.zoom;               // 让该世界点仍落在当前中点
                cam.y = before.y - (my - H / 2) / cam.zoom;
            }
            this._pinch = { dist, mx, my };
            return;
        }

        if (!this.drag) return;
        if (this.drag.mode === 'pan') {
            const cam = this.renderer.camera;
            cam.x -= (sp.x - this.drag.lastX) / cam.zoom;
            cam.y -= (sp.y - this.drag.lastY) / cam.zoom;
            this.drag.lastX = sp.x; this.drag.lastY = sp.y;
            return;
        }
        const w = this._worldFromScreen(sp.x, sp.y);
        const g = this._elemGeom(this.selection);
        if (this.drag.mode === 'move') {
            const dx = w.x - this.drag.lastX, dy = w.y - this.drag.lastY;
            g.obj.x += dx; g.obj.y += dy;
            this.drag.lastX = w.x; this.drag.lastY = w.y;
        } else if (this.drag.mode === 'rotate') {
            const ang = Math.atan2(w.y - g.cy, w.x - g.cx) - Math.PI / 2; // 手柄在 +Y 方向
            if (this.selection.type === 'start') { g.obj.thetaC = ang; g.obj.thetaT = ang; }
            else g.obj.angle = ang;
        } else if (this.drag.mode === 'resize-l') {
            const c = Math.cos(g.angle), s = Math.sin(g.angle);
            const proj = Math.abs((w.x - g.cx) * c + (w.y - g.cy) * s);
            const lim = this.selection.type === 'spot' ? SPOT : WALL;
            g.obj.length = Math.max(lim.lMin, Math.min(lim.lMax, proj * 2));
        } else if (this.drag.mode === 'resize-w') {
            const proj = Math.abs(-(w.x - g.cx) * Math.sin(g.angle) + (w.y - g.cy) * Math.cos(g.angle));
            if (this.selection.type === 'spot') g.obj.width = Math.max(SPOT.wMin, Math.min(SPOT.wMax, proj * 2));
            else g.obj.width = Math.max(WALL.tMin, Math.min(WALL.tMax, proj * 2));
        }
        this.refreshInspector();
    }

    _onUp(e) {
        if (e && e.pointerId != null) this._pointers.delete(e.pointerId);
        if (this._pointers.size < 2) this._pinch = null;   // 退出捏合
        if (this._pointers.size === 0) this.drag = null;   // 全部抬起才结束拖动
    }

    // ---- 工具栏/检视操作 (供 main 或自身按钮调用) ----
    addObstacle(type) {
        const cam = this.renderer.camera;
        const o = type === 'cone'
            ? { x: cam.x, y: cam.y, width: CONE_SIZE, length: CONE_SIZE, angle: 0, type: 'cone' }
            : { x: cam.x, y: cam.y, width: 8, length: 120, angle: 0, type: 'wall' };
        this.level.obstacles.push(o);
        this.selection = { type: 'obstacle', index: this.level.obstacles.length - 1 };
        this.refreshInspector();
    }
    deleteSelected() {
        if (this.selection && this.selection.type === 'obstacle') {
            this.level.obstacles.splice(this.selection.index, 1);
            this.selection = null;
            this.refreshInspector();
        }
    }
    _setName(v) { const el = document.getElementById('ed-name'); if (el) el.value = v; }

    // ---- 检视面板 (HTML 侧栏，与画布手柄双向同步) ----
    bindInspector() {
        const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('input', fn); };
        const clickOn = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
        on('ed-slider-spot-w', e => { if (this.selection?.type === 'spot') { this.level.parkingSpot.width = +e.target.value; this.refreshInspector(); } });
        on('ed-slider-spot-l', e => { if (this.selection?.type === 'spot') { this.level.parkingSpot.length = +e.target.value; this.refreshInspector(); } });
        on('ed-slider-wall-l', e => { const o = this._selObstacle(); if (o) { o.length = +e.target.value; this.refreshInspector(); } });
        on('ed-slider-wall-t', e => { const o = this._selObstacle(); if (o) { o.width = +e.target.value; this.refreshInspector(); } });
        on('ed-slider-angle', e => {
            const deg = +e.target.value, rad = deg * Math.PI / 180;
            if (this.selection?.type === 'start') { this.level.initialState.thetaC = rad; this.level.initialState.thetaT = rad; }
            else if (this.selection?.type === 'spot') this.level.parkingSpot.angle = rad;
            else { const o = this._selObstacle(); if (o) o.angle = rad; }
            this.refreshInspector();
        });
        clickOn('ed-add-wall', () => this.addObstacle('wall'));
        clickOn('ed-add-cone', () => this.addObstacle('cone'));
        clickOn('ed-delete', () => this.deleteSelected());
    }

    _selObstacle() {
        if (this.selection?.type === 'obstacle') return this.level.obstacles[this.selection.index];
        return null;
    }

    refreshInspector() {
        const show = (id, on) => { const el = document.getElementById(id); if (el) el.classList.toggle('hidden', !on); };
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        const txt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        const sel = this.selection;
        const isSpot = sel?.type === 'spot';
        const isWall = sel?.type === 'obstacle' && this.level.obstacles[sel.index]?.type === 'wall';
        const isCone = sel?.type === 'obstacle' && this.level.obstacles[sel.index]?.type === 'cone';
        const isStart = sel?.type === 'start';
        show('ed-insp-empty', !sel);
        show('ed-insp-title', !!sel);
        show('ed-row-spot', isSpot);
        show('ed-row-wall', isWall);
        show('ed-row-angle', isStart || isSpot || isWall);
        show('ed-delete', sel?.type === 'obstacle');
        if (sel) {
            const label = isSpot ? t('edSelSpot') : isWall ? t('edSelWall') : isCone ? t('edSelCone') : t('edSelStart');
            txt('ed-insp-title', label);
        }
        if (isSpot) {
            const s = this.level.parkingSpot;
            set('ed-slider-spot-w', Math.round(s.width)); txt('ed-val-spot-w', Math.round(s.width));
            set('ed-slider-spot-l', Math.round(s.length)); txt('ed-val-spot-l', Math.round(s.length));
            set('ed-slider-angle', Math.round(s.angle * 180 / Math.PI)); txt('ed-val-angle', Math.round(s.angle * 180 / Math.PI) + '°');
        } else if (isWall) {
            const o = this.level.obstacles[sel.index];
            set('ed-slider-wall-l', Math.round(o.length)); txt('ed-val-wall-l', Math.round(o.length));
            set('ed-slider-wall-t', Math.round(o.width)); txt('ed-val-wall-t', Math.round(o.width));
            set('ed-slider-angle', Math.round(o.angle * 180 / Math.PI)); txt('ed-val-angle', Math.round(o.angle * 180 / Math.PI) + '°');
        } else if (isStart) {
            const deg = Math.round(this.level.initialState.thetaC * 180 / Math.PI);
            set('ed-slider-angle', deg); txt('ed-val-angle', deg + '°');
        }
        if (this.onChange) this.onChange();
    }

    // ---- 渲染 (每帧由 main 的循环调用) ----
    draw(dt) {
        if (!this.active) return;
        const is = this.level.initialState;
        this.ghost.reset(is.x, is.y, is.thetaC, is.thetaC);
        this.renderer.render(this.ghost, this.level.parkingSpot, this.level.obstacles, false, dt, 'D');
        if (this.selection) this._drawSelection();
    }

    _drawSelection() {
        const ctx = this.canvas.getContext('2d');
        const g = this._elemGeom(this.selection);
        ctx.save();
        // 高亮轮廓
        const cs = this._screenFromWorld(g.cx, g.cy);
        const z = this.renderer.camera.zoom;
        ctx.translate(cs.x, cs.y); ctx.rotate(g.angle);
        ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
        ctx.strokeRect(-g.hx * z, -g.hy * z, g.hx * 2 * z, g.hy * 2 * z);
        ctx.restore();
        // 手柄
        const hs = this._handles(this.selection);
        const r = Math.max(7, this.handleHit * 0.42); // 触屏上更大更好点
        const dot = (w, color) => {
            const s = this._screenFromWorld(w.x, w.y);
            ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
            ctx.fillStyle = color; ctx.fill();
            ctx.lineWidth = 2; ctx.strokeStyle = '#0b0d12'; ctx.stroke();
        };
        if (hs.rotate) {
            const cc = this._screenFromWorld(g.cx, g.cy), rs = this._screenFromWorld(hs.rotate.x, hs.rotate.y);
            ctx.beginPath(); ctx.moveTo(cc.x, cc.y); ctx.lineTo(rs.x, rs.y);
            ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 1.5; ctx.setLineDash([]); ctx.stroke();
            dot(hs.rotate, '#4ade80');
        }
        if (hs.resizeL) dot(hs.resizeL, '#38bdf8');
        if (hs.resizeW) dot(hs.resizeW, '#38bdf8');
    }

    // ---- 发布前可解性自检 (复用 OBB)：起点不碰障碍 + 存在合法停好位姿 ----
    validate() {
        const L = this.level;
        const obsOBB = (o) => {
            const c = Math.cos(o.angle), s = Math.sin(o.angle), hw = o.length / 2, hh = o.width / 2;
            const lc = [[hw, hh], [-hw, hh], [-hw, -hh], [hw, -hh]];
            return { vertices: lc.map(([dx, dy]) => ({ x: o.x + dx * c - dy * s, y: o.y + dx * s + dy * c })), axes: [{ x: c, y: s }, { x: -s, y: c }] };
        };
        const hits = (v) => {
            const cab = v.getCabOBB(), tr = v.getTrailerOBB();
            return L.obstacles.some(o => { const ob = obsOBB(o); return checkOBBCollision(cab, ob) || checkOBBCollision(tr, ob); });
        };
        const v = new Vehicle(L.initialState.x, L.initialState.y, L.initialState.thetaC, L.initialState.thetaC);
        if (hits(v)) return { ok: false, reason: t('edInvalidStart') };
        const off = v.trailerLength / 2 - v.kingpinOffset;
        let goalOk = false;
        for (const a of [L.parkingSpot.angle, L.parkingSpot.angle + Math.PI]) {
            const kx = L.parkingSpot.x + off * Math.cos(a), ky = L.parkingSpot.y + off * Math.sin(a);
            v.reset(kx, ky, a, a);
            if (!hits(v)) { goalOk = true; break; }
        }
        if (!goalOk) return { ok: false, reason: t('edInvalidGoal') };
        return { ok: true };
    }
}
