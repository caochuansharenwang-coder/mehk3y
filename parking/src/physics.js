/* physics.js - 2D半挂车停车模拟器物理引擎 */

// 标准角度规范化：将角度限制在 [-PI, PI] 之间
export function normalizeAngle(angle) {
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    return angle;
}

// --- Separating Axis Theorem (SAT) 碰撞检测部分 ---

// 根据中心点、尺寸和角度，获取有向包围盒 (OBB) 的顶点及投影轴
export function getOBB(cx, cy, width, length, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    
    // 半宽度和半长度 (h为纵向/长度，w为横向/宽度)
    const hw = width / 2;
    const hl = length / 2;
    
    // 矩形局部坐标系下的四个角 (从车头方向顺时针: 右前、右后、左后、左前)
    const localCorners = [
        { dx: hl, dy: hw },   // 右前
        { dx: -hl, dy: hw },  // 右后
        { dx: -hl, dy: -hw }, // 左后
        { dx: hl, dy: -hw }   // 左前
    ];
    
    // 旋转并平移到全局坐标系
    const vertices = localCorners.map(c => ({
        x: cx + c.dx * cos - c.dy * sin,
        y: cy + c.dx * sin + c.dy * cos
    }));
    
    // 两个相互垂直的投影轴 (单位向量)
    const axes = [
        { x: cos, y: sin },       // 纵轴
        { x: -sin, y: cos }       // 横轴
    ];
    
    return {
        center: { x: cx, y: cy },
        width,
        length,
        angle,
        vertices,
        axes
    };
}

// 投影顶点到指定轴上，返回最小投影值和最大投影值
function projectOBB(obb, axis) {
    let min = Infinity;
    let max = -Infinity;
    
    for (let i = 0; i < obb.vertices.length; i++) {
        const v = obb.vertices[i];
        const proj = v.x * axis.x + v.y * axis.y;
        if (proj < min) min = proj;
        if (proj > max) max = proj;
    }
    
    return { min, max };
}

// 检测两个 OBB 碰撞体是否相交 (SAT 算法)
export function checkOBBCollision(obb1, obb2) {
    const axes = [...obb1.axes, ...obb2.axes];
    
    for (let i = 0; i < axes.length; i++) {
        const axis = axes[i];
        
        // 计算两个包围盒在当前轴上的投影范围
        const proj1 = projectOBB(obb1, axis);
        const proj2 = projectOBB(obb2, axis);
        
        // 如果投影区间不重叠，说明存在分离轴，未碰撞
        if (proj1.max < proj2.min || proj2.max < proj1.min) {
            return false;
        }
    }
    return true; // 所有投影轴上都重合，碰撞发生
}


// --- 车辆物理运动学模型 ---

export class Vehicle {
    constructor(x, y, thetaC, thetaT) {
        // 牵引车（车头）状态，参考点 (x, y) 为车头后轴中心
        this.x = x;
        this.y = y;
        this.theta = thetaC; // 车头航向角 (弧度, 0 表示指向正右方，顺时针为正)
        
        // 挂车（车厢）状态
        this.thetaT = thetaT; // 挂车航向角 (弧度)
        
        // 车辆几何特征尺寸 (单位：像素)
        this.wheelbase = 32;          // 车头轴距 (前轮到后轴)
        this.cabLength = 46;          // 车头包围盒长度
        this.cabWidth = 22;           // 车头包围盒宽度
        this.cabRearOverhang = 10;     // 车头后轴到车头尾部的距离
        
        this.trailerWheelbase = 80;   // 挂车轴距 (牵引鞍座 Kingpin 到挂车后轴)
        this.trailerLength = 105;     // 挂车包围盒长度
        this.trailerWidth = 24;       // 挂车包围盒宽度
        this.kingpinOffset = 10;      // 连接销到挂车前侧箱壁的距离

        // 动力学状态
        this.velocity = 0;            // 速度 (单位：像素/秒)
        this.steerAngle = 0;          // 当前前轮转向角 (弧度)
        this.maxSteer = 45 * Math.PI / 180; // 最大前轮偏转角 (45度)
        
        // 折头控制
        this.maxArticulation = 75 * Math.PI / 180; // 折头锁死夹角限制 (75度)
        this.isJackknifed = false;
    }

    // 重置车辆状态
    reset(x, y, thetaC, thetaT) {
        this.x = x;
        this.y = y;
        this.theta = thetaC;
        this.thetaT = thetaT;
        this.velocity = 0;
        this.steerAngle = 0;
        this.isJackknifed = false;
    }

    // 获取车头的 OBB 碰撞体
    getCabOBB() {
        // 车头后轴在 (x,y)，车头重心(中心点)位于后轴往前 cabLength/2 - cabRearOverhang 处
        const centerDist = this.cabLength / 2 - this.cabRearOverhang;
        const cx = this.x + centerDist * Math.cos(this.theta);
        const cy = this.y + centerDist * Math.sin(this.theta);
        return getOBB(cx, cy, this.cabWidth, this.cabLength, this.theta);
    }

    // 获取挂车的 OBB 碰撞体
    getTrailerOBB() {
        // 连接销(Kingpin)在车头后轴(x, y)。
        // 挂车箱体前沿在 Kingpin 往前 kingpinOffset 处，后沿在 Kingpin 往后 (trailerLength - kingpinOffset) 处
        // 挂车箱体中心点在 Kingpin 往后 (trailerLength / 2 - kingpinOffset) 处
        const centerDist = this.trailerLength / 2 - this.kingpinOffset;
        const tx = this.x - centerDist * Math.cos(this.thetaT);
        const ty = this.y - centerDist * Math.sin(this.thetaT);
        return getOBB(tx, ty, this.trailerWidth, this.trailerLength, this.thetaT);
    }

    // 执行物理状态推演
    update(dt, targetSteerAngle, throttleInput, brakeInput, gear) {
        // 1. 转向角插值平滑变化 (模拟司机打方向盘的时间延迟)
        const steerSpeed = 2.5; // 每秒旋转弧度
        const steerDiff = targetSteerAngle - this.steerAngle;
        this.steerAngle += Math.sign(steerDiff) * Math.min(Math.abs(steerDiff), steerSpeed * dt);
        this.steerAngle = Math.max(-this.maxSteer, Math.min(this.maxSteer, this.steerAngle));

        // 2. 模拟油门、刹车及摩擦阻力下的速度演变
        if (brakeInput > 0) {
            // 制动减速度按输入强度线性缩放 (手柄扳机模拟量；键盘/触控为满量 1)
            const brakeDecel = 90 * Math.min(1, brakeInput);
            if (this.velocity > 0) {
                this.velocity = Math.max(0, this.velocity - brakeDecel * dt);
            } else if (this.velocity < 0) {
                this.velocity = Math.min(0, this.velocity + brakeDecel * dt);
            }
        } else if (throttleInput > 0) {
            // 油门驱动，根据当前档位决定朝向；加速度按输入强度线性缩放 (手柄扳机模拟量)
            const accelForce = 22 * Math.min(1, throttleInput);
            const maxForwardSpeed = 45; // 前进限速 (像素/s)
            const maxReverseSpeed = 30; // 倒车限速 (像素/s)
            
            if (gear === 'D') {
                if (this.velocity < maxForwardSpeed) {
                    this.velocity = Math.min(maxForwardSpeed, this.velocity + accelForce * dt);
                } else {
                    this.velocity -= 10 * dt; // 阻力限速
                }
            } else {
                // 倒车 R 档，速度为负
                if (this.velocity > -maxReverseSpeed) {
                    this.velocity = Math.max(-maxReverseSpeed, this.velocity - accelForce * dt);
                } else {
                    this.velocity += 10 * dt;
                }
            }
        } else {
            // 自动滑行摩擦阻力
            const rollingResistance = 12;
            if (this.velocity > 0) {
                this.velocity = Math.max(0, this.velocity - rollingResistance * dt);
            } else if (this.velocity < 0) {
                this.velocity = Math.min(0, this.velocity + rollingResistance * dt);
            }
        }

        // 如果速度微乎其微，直接判定静止
        if (Math.abs(this.velocity) < 0.1) {
            this.velocity = 0;
        }

        // 2b. 折头自锁：如果已经处于 (或即将达到) 折头角上限，且当前的驱动方向
        // 会让 |relAngle| 进一步增大，就把速度卡为 0 —— 车不能再动，
        // 玩家必须反方向行驶 (或反向打方向) 才能让挂车解锁。
        const relAngle = normalizeAngle(this.theta - this.thetaT);
        if (this.velocity !== 0 && Math.abs(relAngle) >= this.maxArticulation) {
            const dRel = (this.velocity / this.wheelbase) * Math.tan(this.steerAngle)
                       - (this.velocity / this.trailerWheelbase) * Math.sin(relAngle);
            // 同号代表 |relAngle| 仍在增大 (朝深处折)
            if (Math.sign(dRel) === Math.sign(relAngle)) {
                this.velocity = 0;
            }
        }

        // 3. 计算车头运动学 (Bicycle Model)
        const dTheta = (this.velocity / this.wheelbase) * Math.tan(this.steerAngle);
        this.theta += dTheta * dt;
        this.x += this.velocity * Math.cos(this.theta) * dt;
        this.y += this.velocity * Math.sin(this.theta) * dt;

        // 4. 计算挂车运动学 (Articulated Vehicle Constraints)
        const dThetaT = (this.velocity / this.trailerWheelbase) * Math.sin(relAngle);
        this.thetaT += dThetaT * dt;

        this.theta = normalizeAngle(this.theta);
        this.thetaT = normalizeAngle(this.thetaT);

        // 5. 折头 (Jackknife) 限位修正：因离散积分可能略微超出限位，硬钳到边界
        const nextRelAngle = normalizeAngle(this.theta - this.thetaT);
        if (Math.abs(nextRelAngle) >= this.maxArticulation) {
            this.isJackknifed = true;
            const sign = Math.sign(nextRelAngle);
            this.thetaT = normalizeAngle(this.theta - sign * this.maxArticulation);
        } else {
            this.isJackknifed = false;
        }
    }

    // 复制当前车辆状态
    clone() {
        const v = new Vehicle(this.x, this.y, this.theta, this.thetaT);
        v.velocity = this.velocity;
        v.steerAngle = this.steerAngle;
        v.isJackknifed = this.isJackknifed;
        return v;
    }

    // 预测未来轨迹路径点 (倒车辅助线生成)
    // 返回 3 条折线：车头后轴 (cab)、挂车右后角 (trailerRight)、挂车左后角 (trailerLeft)
    //
    // 车头弧：κ_c = tan(steer) / Lc，由方向盘决定。
    // 挂车弧：用"前瞻折头角"做单次曲率预测：
    //   dhitch/dt = (v/Lc)·tan δ − (v/Lt)·sin(hitch)
    //   取 T = Lc/|v|，T·dhitch/dt = sign(v)·[tan δ − (Lc/Lt)·sin(hitch)]，|v| 消掉
    //   effHitch = hitch + sign(v)·[tan δ − (Lc/Lt)·sin(hitch)]
    //   κ_t = tan(effHitch) / Lt
    //   倒车 (sign(v)=−1) 时方向盘的贡献符号翻转 ⇒ 挂车弧自动与车头反向
    //   (即"倒车反打方向"的几何来源)。effHitch 钳到 ±maxArticulation 避免折头死区。
    predictPath(steps = 90, stepDt = 0.04, gear = 'D') {
        const pathPoints = {
            cab: [],
            trailerLeft: [],
            trailerRight: []
        };

        // 预测速度：始终用名义速度，让辅助线长度与实际速度脱钩
        // (否则慢速行驶时 |v| 很小、弧长会缩到几像素，造成"动一下线就缩没"的闪烁)
        const predSpeed = (gear === 'D') ? 35 : -25;

        const Lc = this.wheelbase;
        const Lt = this.trailerWheelbase;
        const rearEdgeOffset = this.trailerLength - this.kingpinOffset; // kingpin → 挂车后沿
        const halfWidth = this.trailerWidth / 2;

        // 车头瞬时曲率 (基于方向盘)
        const cabKappa = Math.tan(this.steerAngle) / Lc;

        // 挂车曲率 (前瞻折头角)
        const hitch = normalizeAngle(this.theta - this.thetaT);
        const dirSign = gear === 'R' ? -1 : 1;
        let effHitch = hitch + dirSign * (Math.tan(this.steerAngle) - (Lc / Lt) * Math.sin(hitch));
        effHitch = Math.max(-this.maxArticulation, Math.min(this.maxArticulation, effHitch));
        const trailerKappa = Math.tan(effHitch) / Lt;

        // 每步弧长 (有符号；倒车为负)
        const cabStep = predSpeed * stepDt;
        // 挂车后轴沿挂车纵轴的速度 = v·cos(hitch)
        const trailerStep = predSpeed * Math.cos(hitch) * stepDt;

        // 起点
        const cab0X = this.x;
        const cab0Y = this.y;
        const cabTheta0 = this.theta;
        const ta0X = this.x - Lt * Math.cos(this.thetaT); // 挂车后轴起始位置
        const ta0Y = this.y - Lt * Math.sin(this.thetaT);
        const trailerTheta0 = this.thetaT;

        // 在 (x0, y0, θ0) 起点、恒定曲率 κ、弧长 s 处的位姿
        // 参数化：θ(s) = θ0 + κ·s，位置随之沿圆 (或直线，当 κ≈0) 演化
        const pointOnArc = (x0, y0, theta0, kappa, s) => {
            if (Math.abs(kappa) < 1e-9) {
                return {
                    x: x0 + Math.cos(theta0) * s,
                    y: y0 + Math.sin(theta0) * s,
                    theta: theta0
                };
            }
            const R = 1 / kappa;
            const cx = x0 - R * Math.sin(theta0);
            const cy = y0 + R * Math.cos(theta0);
            const t = theta0 + kappa * s;
            return {
                x: cx + R * Math.sin(t),
                y: cy - R * Math.cos(t),
                theta: t
            };
        };

        for (let i = 0; i <= steps; i++) {
            // 车头圆弧
            const cabP = pointOnArc(cab0X, cab0Y, cabTheta0, cabKappa, cabStep * i);
            pathPoints.cab.push({ x: cabP.x, y: cabP.y });

            // 挂车圆弧：用挂车后轴作为基点，恒定曲率往后延伸
            const taP = pointOnArc(ta0X, ta0Y, trailerTheta0, trailerKappa, trailerStep * i);
            const kingpinX = taP.x + Lt * Math.cos(taP.theta);
            const kingpinY = taP.y + Lt * Math.sin(taP.theta);
            const rearCx = kingpinX - rearEdgeOffset * Math.cos(taP.theta);
            const rearCy = kingpinY - rearEdgeOffset * Math.sin(taP.theta);
            const perpCos = Math.cos(taP.theta + Math.PI / 2);
            const perpSin = Math.sin(taP.theta + Math.PI / 2);
            pathPoints.trailerRight.push({
                x: rearCx + halfWidth * perpCos,
                y: rearCy + halfWidth * perpSin
            });
            pathPoints.trailerLeft.push({
                x: rearCx - halfWidth * perpCos,
                y: rearCy - halfWidth * perpSin
            });
        }

        return pathPoints;
    }
}
