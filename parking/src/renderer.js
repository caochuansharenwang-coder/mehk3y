/* renderer.js - 2D半挂车停车模拟器 Canvas 渲染引擎 */

export class CanvasRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        
        // 渲染配置
        this.showPrediction = true;
        this.showOBB = false; // 调试碰撞箱用
        
        // 动态摄像机状态
        this.camera = {
            x: 400,
            y: 225,
            zoom: 1.0,
            targetZoom: 1.0,
            // 关卡开场远景模式：弹窗打开时框住车位 + 车辆，关闭时再平滑过渡到车辆
            introMode: false,
            introTarget: null,    // 远景视图快照 (x, y, zoom)，introMode 期间锁死
            introExitDelay: 0,    // 玩家点"开始练习"后再停留这么久 (秒) 才开始过渡
            inTransition: false,  // 过渡阶段标志：用减半的 lerp 速度，到位后自动复位
            isDragging: false     // 玩家正在拖动地图：true 时暂停自动跟随
        };

        // 小地图缩略图距画布顶部的距离 (编辑器里下移，避免被顶部工具栏挡住)
        this.minimapY = 65;

        // 烟雾粒子系统 (尾气)
        this.particles = [];
        // 烟雾排放计时
        this.smokeTimer = 0;
    }

    // 适配 Retina 屏，处理 Canvas 分辨率
    resize() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        
        this.ctx.scale(dpr, dpr);
        
        return {
            width: rect.width,
            height: rect.height
        };
    }

    // 计算开场远景目标：车位居中，缩放幅度不大
    // 视口只要求容下"车位 → 车辆距离 + padding"，车辆允许靠近视口边缘
    // (车位是焦点；车辆是否完全可见次要)
    computeIntroTarget(vehicle, parkingSpot, canvasWidth, canvasHeight) {
        const dx = vehicle.x - parkingSpot.x;
        const dy = vehicle.y - parkingSpot.y;
        const dist = Math.hypot(dx, dy);
        const padding = 200; // 世界坐标边距
        const required = dist + padding;
        const zoomFit = Math.min(canvasWidth / required, canvasHeight / required);
        return {
            x: parkingSpot.x,
            y: parkingSpot.y,
            // 限制在 [0.75, 1.0] 之间：不会缩得太小，又比正常游戏 (1.45) 明显拉远
            zoom: Math.max(0.75, Math.min(zoomFit, 1.0))
        };
    }

    // 更新摄像机位置与缩放：introMode 时拉远框住车位 + 车辆；否则紧跟车头后轴
    updateCamera(vehicle, parkingSpot, canvasWidth, canvasHeight, dt) {
        // 玩家正在拖动地图：暂停所有自动 lerp，让相机锁在拖动位置
        if (this.camera.isDragging) return;

        // 过场延时倒计时：玩家点"开始练习"后先停 introExitDelay 秒再开始过渡
        if (this.camera.introExitDelay > 0) {
            this.camera.introExitDelay -= dt;
            if (this.camera.introExitDelay <= 0) {
                this.camera.introExitDelay = 0;
                this.camera.introMode = false;
                this.camera.inTransition = true;
            }
        }

        let targetX, targetY, targetZoom;

        if (this.camera.introMode && this.camera.introTarget) {
            // 锁定到 loadLevel 时拍下的快照，避免车辆位置变化导致远景漂移
            targetX = this.camera.introTarget.x;
            targetY = this.camera.introTarget.y;
            targetZoom = this.camera.introTarget.zoom;
        } else {
            targetX = vehicle.x;
            targetY = vehicle.y;
            // 采用较大的固定视口缩放 (1.45)，使卡车细节放大，便于观察轮子、转向与挂钩
            // 竖屏下调小一点点避免越界
            targetZoom = (canvasHeight > canvasWidth) ? 1.25 : 1.45;
        }

        // 过渡阶段用减半的 lerp 速度 (2.5/秒)，正常跟随用 5.0/秒
        const lerpRate = this.camera.inTransition ? 2.5 : 5.0;
        const lerpSpeed = lerpRate * dt;
        this.camera.x += (targetX - this.camera.x) * lerpSpeed;
        this.camera.y += (targetY - this.camera.y) * lerpSpeed;
        this.camera.zoom += (targetZoom - this.camera.zoom) * lerpSpeed;

        // 过渡到位 (位置 5 像素以内、缩放差 0.05 以内) 后切回正常跟随速度
        if (this.camera.inTransition) {
            const dx = targetX - this.camera.x;
            const dy = targetY - this.camera.y;
            if (Math.hypot(dx, dy) < 5 && Math.abs(targetZoom - this.camera.zoom) < 0.05) {
                this.camera.inTransition = false;
            }
        }
    }

    // 粒子更新与排放
    updateParticles(vehicle, dt) {
        // 排放尾气烟雾 (车头运动且有油门时排放快些)
        this.smokeTimer += dt;
        const absVel = Math.abs(vehicle.velocity);
        const smokeInterval = absVel > 5 ? 0.05 : 0.15;

        if (this.smokeTimer >= smokeInterval) {
            this.smokeTimer = 0;
            
            // 烟囱位置：车头后轴往前 15 像素，往左/右偏移 6 像素
            const smokeX = vehicle.x + 15 * Math.cos(vehicle.theta) - 6 * Math.sin(vehicle.theta);
            const smokeY = vehicle.y + 15 * Math.sin(vehicle.theta) + 6 * Math.cos(vehicle.theta);
            
            this.particles.push({
                x: smokeX,
                y: smokeY,
                vx: -vehicle.velocity * 0.1 * Math.cos(vehicle.theta) + (Math.random() - 0.5) * 5,
                vy: -vehicle.velocity * 0.1 * Math.sin(vehicle.theta) + (Math.random() - 0.5) * 5,
                alpha: 0.4,
                size: 2 + Math.random() * 4,
                life: 1.0, // 存活时间秒
                maxLife: 1.0
            });
        }

        // 更新粒子状态，过滤死亡粒子
        this.particles = this.particles.filter(p => {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.life -= dt;
            p.alpha = (p.life / p.maxLife) * 0.4;
            p.size += 8 * dt; // 扩散变大
            return p.life > 0;
        });
    }

    // 清空画布并绘制主画面 (包含大视图的主场景与小地图)
    render(vehicle, parkingSpot, obstacles, isAligned, dt, gear = 'D') {
        const { width: W, height: H } = this.canvas.getBoundingClientRect();
        
        // 1. 清屏
        this.ctx.fillStyle = '#0f1118';
        this.ctx.fillRect(0, 0, W, H);

        // 2. 摄像机视口变换 (主画面：大缩放跟踪车身)
        this.ctx.save();
        this.ctx.translate(W / 2, H / 2);
        this.ctx.scale(this.camera.zoom, this.camera.zoom);
        this.ctx.translate(-this.camera.x, -this.camera.y);

        // 3. 绘制环境网格线
        this.drawGrid(-2000, -2000, 4000, 4000, 50);

        // 4. 绘制目标停车位
        this.drawParkingSpot(parkingSpot, isAligned);

        // 5. 倒车辅助线 (仅在 R 档时显示：车头一根线，挂车两根线，跟随方向盘动)
        if (this.showPrediction && gear === 'R') {
            const predPoints = vehicle.predictPath(90, 0.04, 'R');
            this.drawReverseGuide(predPoints);
        }

        // 6. 绘制尾气粒子
        this.drawParticles();

        // 7. 绘制半挂车辆 (车头 + 挂车)
        this.drawVehicle(vehicle);

        // 8. 绘制障碍物
        this.drawObstacles(obstacles);

        // 恢复视口变换 (回到屏幕空间)
        this.ctx.restore();

        // 9. 绘制小地图缩略图 (UI 叠加层)
        this.drawMinimapOverlay(vehicle, parkingSpot, obstacles, W, H);
    }

    // 绘制背景网格
    drawGrid(x, y, w, h, size) {
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        for (let i = x; i <= x + w; i += size) {
            this.ctx.moveTo(i, y);
            this.ctx.lineTo(i, y + h);
        }
        for (let j = y; j <= y + h; j += size) {
            this.ctx.moveTo(x, j);
            this.ctx.lineTo(x + w, j);
        }
        this.ctx.stroke();
    }

    // 绘制停车位
    drawParkingSpot(spot, isAligned) {
        this.ctx.save();
        this.ctx.translate(spot.x, spot.y);
        this.ctx.rotate(spot.angle);

        // 开场远景模式下做脉冲闪烁，提示玩家"目标车位在此"
        // pulse ∈ [0, 1] 周期 1.2Hz
        let pulse = 0;
        if (this.camera.introMode) {
            pulse = 0.5 + 0.5 * Math.sin(Date.now() / 1000 * Math.PI * 2 * 1.2);
        }

        // 确定发光颜色
        const borderColor = isAligned ? '#39ff14' : '#00ffcc';

        // 绘制阴影发光效果 (闪烁时加大 glow)
        this.ctx.shadowColor = borderColor;
        this.ctx.shadowBlur = (isAligned ? 15 : 6) + pulse * 24;

        // 虚线车位框 (闪烁时加粗)
        this.ctx.strokeStyle = borderColor;
        this.ctx.lineWidth = 2.5 + pulse * 1.5;
        this.ctx.setLineDash([8, 6]);
        this.ctx.strokeRect(-spot.length / 2, -spot.width / 2, spot.length, spot.width);
        this.ctx.setLineDash([]); // 还原

        // 车位中央底色 (闪烁时填充更明显)
        const baseFill = isAligned ? 0.1 : 0.05;
        const fillAlpha = baseFill + pulse * 0.18;
        this.ctx.fillStyle = isAligned
            ? `rgba(57,255,20,${fillAlpha})`
            : `rgba(0,255,204,${fillAlpha})`;
        this.ctx.fillRect(-spot.length/2, -spot.width/2, spot.length, spot.width);

        this.ctx.shadowBlur = 0; // 取消发光，绘制字体
        this.ctx.fillStyle = borderColor;
        this.ctx.font = '800 24px Outfit';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText('P', 0, 0);

        this.ctx.restore();
    }

    // 绘制倒车辅助线：车头 1 根 (灰色) + 挂车后角 2 根 (青色)
    drawReverseGuide(paths) {
        this.ctx.save();
        this.ctx.lineCap = 'round';

        const strokePolyline = (points) => {
            this.ctx.beginPath();
            for (let i = 0; i < points.length; i++) {
                if (i === 0) this.ctx.moveTo(points[i].x, points[i].y);
                else this.ctx.lineTo(points[i].x, points[i].y);
            }
            this.ctx.stroke();
        };

        // 1. 车头轨迹 (后轴中心，灰色细虚线)
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([4, 6]);
        strokePolyline(paths.cab);

        // 2. 挂车两后角轨迹 (青色实虚线，醒目)
        this.ctx.strokeStyle = 'rgba(0, 255, 204, 0.7)';
        this.ctx.lineWidth = 2.5;
        this.ctx.setLineDash([8, 5]);
        strokePolyline(paths.trailerLeft);
        strokePolyline(paths.trailerRight);

        this.ctx.restore();
    }

    // 绘制烟雾粒子
    drawParticles() {
        this.ctx.save();
        this.particles.forEach(p => {
            this.ctx.fillStyle = `rgba(200, 200, 200, ${p.alpha})`;
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            this.ctx.fill();
        });
        this.ctx.restore();
    }

    // 绘制障碍物 (带反光条纹的墙体，或发光锥桶)
    drawObstacles(obstacles) {
        obstacles.forEach(obs => {
            this.ctx.save();
            this.ctx.translate(obs.x, obs.y);
            this.ctx.rotate(obs.angle);

            if (obs.type === 'wall') {
                // 绘制高质感实体墙
                const w = obs.length; // OBB中，length 对应平面上的X方向，width 对应Y方向
                const h = obs.width;
                
                // 绘制灰色基底
                this.ctx.fillStyle = '#242a38';
                this.ctx.fillRect(-w/2, -h/2, w, h);
                this.ctx.strokeStyle = '#3d475c';
                this.ctx.lineWidth = 2;
                this.ctx.strokeRect(-w/2, -h/2, w, h);

                // 绘制黄黑相间警示条纹
                this.ctx.save();
                this.ctx.beginPath();
                this.ctx.rect(-w/2, -h/2, w, h);
                this.ctx.clip(); // 剪裁仅在方框内绘制条纹

                this.ctx.strokeStyle = '#ffff00';
                this.ctx.lineWidth = 4;
                const step = 15;
                // 斜线起点在 local-x = offset, 终点在 offset + h
                // 要让所有可能与墙相交的斜线都画出来，起点最远要到 -w/2 - h
                // (否则细长墙 w << h 时大部分斜线被早早跳过，只剩一条)
                const stripeStart = -w / 2 - h;
                const stripeEnd = w / 2;
                for (let offset = stripeStart; offset < stripeEnd; offset += step) {
                    this.ctx.beginPath();
                    this.ctx.moveTo(offset, -h/2 - 2);
                    this.ctx.lineTo(offset + h, h/2 + 2);
                    this.ctx.stroke();
                }
                this.ctx.restore();
            } else if (obs.type === 'cone') {
                // 绘制发光锥桶 (俯视图：橙色圆圈 + 白色中心)
                this.ctx.shadowColor = 'rgba(255, 102, 0, 0.6)';
                this.ctx.shadowBlur = 8;
                
                // 橙色底座
                this.ctx.fillStyle = '#ff6600';
                this.ctx.fillRect(-8, -8, 16, 16);

                // 锥体圆环
                this.ctx.fillStyle = '#ff6600';
                this.ctx.beginPath();
                this.ctx.arc(0, 0, 7, 0, Math.PI*2);
                this.ctx.fill();

                // 白色反光环
                this.ctx.fillStyle = '#ffffff';
                this.ctx.beginPath();
                this.ctx.arc(0, 0, 4, 0, Math.PI*2);
                this.ctx.fill();

                // 顶部圆心
                this.ctx.fillStyle = '#ff6600';
                this.ctx.beginPath();
                this.ctx.arc(0, 0, 2, 0, Math.PI*2);
                this.ctx.fill();
            }

            this.ctx.restore();
        });
    }

    // 绘制半挂车整体 (绘制车头及车厢)
    drawVehicle(vehicle) {
        this.ctx.save();

        // 1. 绘制挂车 (Trailer) ———— 挂车先绘制，这样车头覆盖在鞍座上，图层更合理
        this.ctx.save();
        this.ctx.translate(vehicle.x, vehicle.y); // 从 Kingpin 处定位
        this.ctx.rotate(vehicle.thetaT);

        // 计算挂车箱体中心偏差 (Kingpin recessed)
        const trCenterDist = -(vehicle.trailerLength / 2 - vehicle.kingpinOffset);
        
        // 绘制挂车箱体 (Blue Container)
        this.ctx.fillStyle = '#1c2d42';
        this.ctx.strokeStyle = '#325075';
        this.ctx.lineWidth = 2;
        // 绘制圆角集装箱
        this.drawRoundRect(this.ctx, trCenterDist - vehicle.trailerLength/2, -vehicle.trailerWidth/2, vehicle.trailerLength, vehicle.trailerWidth, 4, true, true);

        // 绘制集装箱横条纹纹理 (增强立体感)
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        this.ctx.lineWidth = 1.5;
        const stripeStep = 6;
        const startX = trCenterDist - vehicle.trailerLength / 2 + 12;
        const endX = trCenterDist + vehicle.trailerLength / 2 - 12;
        for (let sx = startX; sx < endX; sx += stripeStep) {
            this.ctx.beginPath();
            this.ctx.moveTo(sx, -vehicle.trailerWidth / 2 + 2);
            this.ctx.lineTo(sx, vehicle.trailerWidth / 2 - 2);
            this.ctx.stroke();
        }

        // 绘制挂车尾门锁杆
        this.ctx.strokeStyle = '#cbd5e1';
        this.ctx.lineWidth = 2;
        const trailerBackX = trCenterDist - vehicle.trailerLength / 2;
        this.ctx.beginPath();
        this.ctx.moveTo(trailerBackX, -6);
        this.ctx.lineTo(trailerBackX, 6);
        this.ctx.stroke();

        // 绘制挂车后双轴轮胎 (通常在后部)
        // 轮轴中心大约在挂车轴距后方
        const axleDist = -vehicle.trailerWheelbase; // 相对于 Kingpin (0,0) 的距离
        this.drawTire(axleDist, -vehicle.trailerWidth / 2 - 1, 10, 4); // 左轴前轮
        this.drawTire(axleDist - 8, -vehicle.trailerWidth / 2 - 1, 10, 4); // 左轴后轮
        this.drawTire(axleDist, vehicle.trailerWidth / 2 + 1 - 4, 10, 4); // 右轴前轮
        this.drawTire(axleDist - 8, vehicle.trailerWidth / 2 + 1 - 4, 10, 4); // 右轴后轮

        // 绘制挂车车厢边缘红白相间反光贴
        this.ctx.fillStyle = '#ff0033';
        this.ctx.fillRect(trCenterDist - vehicle.trailerLength/2 + 2, -vehicle.trailerWidth/2, 6, 1);
        this.ctx.fillRect(trCenterDist + vehicle.trailerLength/2 - 8, -vehicle.trailerWidth/2, 6, 1);
        this.ctx.fillRect(trCenterDist - vehicle.trailerLength/2 + 2, vehicle.trailerWidth/2 - 1, 6, 1);
        this.ctx.fillRect(trCenterDist + vehicle.trailerLength/2 - 8, vehicle.trailerWidth/2 - 1, 6, 1);

        this.ctx.restore();

        // 2. 绘制牵引车头 (Tractor)
        this.ctx.save();
        this.ctx.translate(vehicle.x, vehicle.y); // 后轴中心即为 (x,y)
        this.ctx.rotate(vehicle.theta);

        // 2.1 绘制大灯光束 (Headlights translucent cone)
        this.ctx.save();
        const lightLen = 140;
        const frontDist = vehicle.cabLength - vehicle.cabRearOverhang;
        const gradL = this.ctx.createLinearGradient(frontDist, -8, frontDist + lightLen, -25);
        gradL.addColorStop(0, 'rgba(255, 255, 200, 0.2)');
        gradL.addColorStop(1, 'rgba(255, 255, 200, 0.0)');
        this.ctx.fillStyle = gradL;
        this.ctx.beginPath();
        this.ctx.moveTo(frontDist, -8);
        this.ctx.lineTo(frontDist + lightLen, -30);
        this.ctx.lineTo(frontDist + lightLen, 0);
        this.ctx.closePath();
        this.ctx.fill();

        const gradR = this.ctx.createLinearGradient(frontDist, 8, frontDist + lightLen, 25);
        gradR.addColorStop(0, 'rgba(255, 255, 200, 0.2)');
        gradR.addColorStop(1, 'rgba(255, 255, 200, 0.0)');
        this.ctx.fillStyle = gradR;
        this.ctx.beginPath();
        this.ctx.moveTo(frontDist, 8);
        this.ctx.lineTo(frontDist + lightLen, 0);
        this.ctx.lineTo(frontDist + lightLen, 30);
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.restore();

        // 2.2 绘制车头机架及轮廓 (Sleek Metallic Charcoal)
        const cabStart = -vehicle.cabRearOverhang;
        this.ctx.fillStyle = '#2d3340';
        this.ctx.strokeStyle = '#434c5e';
        this.ctx.lineWidth = 1.8;
        this.drawRoundRect(this.ctx, cabStart, -vehicle.cabWidth/2, vehicle.cabLength, vehicle.cabWidth, 5, true, true);

        // 2.3 绘制玻璃车窗 (Glossy dark glass)
        this.ctx.fillStyle = 'rgba(10, 15, 25, 0.85)';
        // 前挡风玻璃 (梯形/弧形)
        const windShieldX = cabStart + vehicle.cabLength - 16;
        this.ctx.fillRect(windShieldX, -vehicle.cabWidth/2 + 2, 6, vehicle.cabWidth - 4);
        // 侧车窗
        this.ctx.fillRect(windShieldX - 10, -vehicle.cabWidth/2 + 1, 8, 2);
        this.ctx.fillRect(windShieldX - 10, vehicle.cabWidth/2 - 3, 8, 2);

        // 2.4 绘制车头闪亮的进气格栅和后金属底板 (细节)
        this.ctx.fillStyle = '#4e5a70';
        this.ctx.fillRect(cabStart + vehicle.cabLength - 3, -8, 3, 16); // 格栅
        
        this.ctx.fillStyle = '#1e222b';
        this.ctx.fillRect(cabStart + 4, -8, 12, 16); // 后金属滑板

        // 2.5 绘制车头后驱动轴轮子 (黄色高亮轮，调大偏置使其明显突出 3px)
        this.drawTire(0, -vehicle.cabWidth/2 - 3, 10, 4, '#ffff00', '#ccaa00');
        this.drawTire(0, vehicle.cabWidth/2 + 3 - 4, 10, 4, '#ffff00', '#ccaa00');

        // 2.6 绘制车头前转向轴轮子 (随 steerAngle 动态旋转，亮黄色高亮，在车身上层绘制)
        this.ctx.save();
        this.ctx.translate(vehicle.wheelbase, -vehicle.cabWidth/2 - 1);
        this.ctx.rotate(vehicle.steerAngle);
        this.drawTire(0, -2, 10, 4, '#ffff00', '#ccaa00');
        this.ctx.restore();

        this.ctx.save();
        this.ctx.translate(vehicle.wheelbase, vehicle.cabWidth/2 + 1);
        this.ctx.rotate(vehicle.steerAngle);
        this.drawTire(0, -2, 10, 4, '#ffff00', '#ccaa00');
        this.ctx.restore();

        // 2.7 绘制第五轮鞍座 (Fifth Wheel Connector - Kingpin 中心点)
        this.ctx.fillStyle = '#0a0d14';
        this.ctx.strokeStyle = '#57657d';
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        this.ctx.arc(0, 0, 5, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.stroke();

        this.ctx.restore();

        // 3. 绘制折头警报标志 (如果发生 Jackknife，在车辆结合处画一个红色发光半圆弧)
        if (vehicle.isJackknifed) {
            this.ctx.save();
            this.ctx.translate(vehicle.x, vehicle.y);
            this.ctx.strokeStyle = 'rgba(255, 0, 85, 0.7)';
            this.ctx.lineWidth = 3.5;
            this.ctx.shadowColor = '#ff0055';
            this.ctx.shadowBlur = 10;
            this.ctx.setLineDash([3, 4]);
            this.ctx.beginPath();
            // 在车头与挂车之间绘制虚线红色弧度
            this.ctx.arc(0, 0, 25, vehicle.theta, vehicle.thetaT, vehicle.thetaT < vehicle.theta);
            this.ctx.stroke();
            this.ctx.restore();
        }

        // 4. 绘制挂车延长辅助定位线 (这极大地方便了倒车方向瞄准车位)
        if (this.showPrediction) {
            this.ctx.save();
            this.ctx.translate(vehicle.x, vehicle.y);
            this.ctx.rotate(vehicle.thetaT);
            
            // 从挂车尾端延伸出两条细红色辅助虚线
            const trCenterDist = -(vehicle.trailerLength / 2 - vehicle.kingpinOffset);
            const backX = trCenterDist - vehicle.trailerLength / 2;
            const extLength = 120; // 延伸线长度

            this.ctx.strokeStyle = 'rgba(255, 255, 0, 0.25)';
            this.ctx.lineWidth = 1.2;
            this.ctx.setLineDash([3, 5]);
            
            // 左后角延长线
            this.ctx.beginPath();
            this.ctx.moveTo(backX, -vehicle.trailerWidth / 2);
            this.ctx.lineTo(backX - extLength, -vehicle.trailerWidth / 2);
            this.ctx.stroke();

            // 右后角延长线
            this.ctx.beginPath();
            this.ctx.moveTo(backX, vehicle.trailerWidth / 2);
            this.ctx.lineTo(backX - extLength, vehicle.trailerWidth / 2);
            this.ctx.stroke();

            this.ctx.restore();
        }

        // 5. 调试用碰撞箱边界框 (OBB 顶点连线)
        if (this.showOBB) {
            this.drawOBBWireframe(vehicle.getCabOBB(), '#ff00ff');
            this.drawOBBWireframe(vehicle.getTrailerOBB(), '#ffff00');
        }

        this.ctx.restore();
    }

    // 辅助轮胎绘制 (支持自定义轮胎填充色与边框色，便于用黄色标出车头轮子)
    drawTire(x, y, w, h, tireColor = '#090a0d', strokeColor = '#222630') {
        this.ctx.fillStyle = tireColor;
        this.ctx.strokeStyle = strokeColor;
        this.ctx.lineWidth = 1.2;
        this.drawRoundRect(this.ctx, x - w/2, y, w, h, 2, true, true);
        
        // 轮胎花纹细线 (如果轮胎是亮黄色，花纹线使用半透明黑色；否则使用半透明白色)
        this.ctx.fillStyle = tireColor === '#ffff00' ? 'rgba(0, 0, 0, 0.15)' : 'rgba(255, 255, 255, 0.06)';
        this.ctx.fillRect(x - w/4, y + 1, w/2, h - 2);
    }

    // 辅助绘制圆角矩形
    drawRoundRect(ctx, x, y, width, height, radius, fill, stroke) {
        if (typeof radius === 'number') {
            radius = {tl: radius, tr: radius, br: radius, bl: radius};
        }
        ctx.beginPath();
        ctx.moveTo(x + radius.tl, y);
        ctx.lineTo(x + width - radius.tr, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius.tr);
        ctx.lineTo(x + width, y + height - radius.br);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height);
        ctx.lineTo(x + radius.bl, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius.bl);
        ctx.lineTo(x, y + radius.tl);
        ctx.quadraticCurveTo(x, y, x + radius.tl, y);
        ctx.closePath();
        if (fill) ctx.fill();
        if (stroke) ctx.stroke();
    }

    // 调试碰撞体连线
    drawOBBWireframe(obb, color) {
        this.ctx.save();
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        obb.vertices.forEach((v, idx) => {
            if (idx === 0) this.ctx.moveTo(v.x, v.y);
            else this.ctx.lineTo(v.x, v.y);
        });
        this.ctx.closePath();
        this.ctx.stroke();
        this.ctx.restore();
    }

    // 绘制全局小地图缩略图 (UI 叠加层)
    drawMinimapOverlay(vehicle, parkingSpot, obstacles, W, H) {
        const miniW = 140;
        const miniH = 78;
        
        // 放置于左上角；y 默认 65，编辑器里下移避开顶部工具栏
        const miniX = 16;
        const miniY = this.minimapY;

        // 1. 绘制磨砂背景和边框
        this.ctx.save();
        this.ctx.fillStyle = 'rgba(10, 12, 16, 0.85)';
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        this.ctx.lineWidth = 1.5;
        this.drawRoundRect(this.ctx, miniX, miniY, miniW, miniH, 8, true, true);

        // 1b. 裁剪到缩略图框内：自建关内容可能超出 800×450 投影范围，避免画到框外
        const r = 8;
        this.ctx.beginPath();
        this.ctx.moveTo(miniX + r, miniY);
        this.ctx.arcTo(miniX + miniW, miniY, miniX + miniW, miniY + miniH, r);
        this.ctx.arcTo(miniX + miniW, miniY + miniH, miniX, miniY + miniH, r);
        this.ctx.arcTo(miniX, miniY + miniH, miniX, miniY, r);
        this.ctx.arcTo(miniX, miniY, miniX + miniW, miniY, r);
        this.ctx.closePath();
        this.ctx.clip();

        // 2. 世界坐标投影比例: width=800, height=450 -> miniW=140, miniH=78
        const toMiniX = (wx) => miniX + (wx / 800) * miniW;
        const toMiniY = (wy) => miniY + (wy / 450) * miniH;

        // 3. 绘制目标车位
        this.ctx.save();
        const msX = toMiniX(parkingSpot.x);
        const msY = toMiniY(parkingSpot.y);
        const msW = (parkingSpot.length / 800) * miniW;
        const msH = (parkingSpot.width / 450) * miniH;

        this.ctx.translate(msX, msY);
        this.ctx.rotate(parkingSpot.angle);
        
        this.ctx.fillStyle = 'rgba(0, 255, 204, 0.15)';
        this.ctx.strokeStyle = '#00ffcc';
        this.ctx.lineWidth = 1;
        this.ctx.fillRect(-msW/2, -msH/2, msW, msH);
        this.ctx.strokeRect(-msW/2, -msH/2, msW, msH);
        this.ctx.restore();

        // 4. 绘制障碍物
        obstacles.forEach(obs => {
            this.ctx.save();
            const moX = toMiniX(obs.x);
            const moY = toMiniY(obs.y);
            const moW = (obs.length / 800) * miniW;
            const moH = (obs.width / 450) * miniH;

            this.ctx.translate(moX, moY);
            this.ctx.rotate(obs.angle);

            this.ctx.fillStyle = obs.type === 'wall' ? 'rgba(255, 255, 255, 0.25)' : 'rgba(255, 102, 0, 0.7)';
            this.ctx.fillRect(-moW/2, -moH/2, moW, moH);
            this.ctx.restore();
        });

        // 5. 绘制卡车连线与挂载标记
        const mvX = toMiniX(vehicle.x);
        const mvY = toMiniY(vehicle.y);

        const trCenterDist = vehicle.trailerLength / 2 - vehicle.kingpinOffset;
        const tx = vehicle.x - trCenterDist * Math.cos(vehicle.thetaT);
        const ty = vehicle.y - trCenterDist * Math.sin(vehicle.thetaT);
        const mtx = toMiniX(tx);
        const mty = toMiniY(ty);

        // 牵引连接线
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([2, 2]);
        this.ctx.beginPath();
        this.ctx.moveTo(mvX, mvY);
        this.ctx.lineTo(mtx, mty);
        this.ctx.stroke();
        this.ctx.setLineDash([]);

        // 挂车车厢 (青色点矩形)
        this.ctx.save();
        this.ctx.fillStyle = '#00ffcc';
        this.ctx.translate(mtx, mty);
        this.ctx.rotate(vehicle.thetaT);
        this.ctx.fillRect(-6, -2, 10, 4);
        this.ctx.restore();

        // 车头 (红色点矩形)
        this.ctx.save();
        this.ctx.fillStyle = '#ff3366';
        this.ctx.translate(mvX, mvY);
        this.ctx.rotate(vehicle.theta);
        this.ctx.fillRect(-3, -1.5, 5, 3);
        this.ctx.restore();

        // 6. 右下角水印
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        this.ctx.font = '800 7px Outfit';
        this.ctx.textAlign = 'right';
        this.ctx.textBaseline = 'bottom';
        this.ctx.fillText('MAP', miniX + miniW - 5, miniY + miniH - 3);

        this.ctx.restore();
    }
}
