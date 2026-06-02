/**
 * 拍立得照片生成器 - 照片墙模块
 * 负责照片墙的管理、布局和显示
 */

const PhotoWall = (function() {
    // 私有变量
    let photoWallElement = null;
    let photoWallSection = null;
    
    // 存储已放置照片的位置信息，用于避免重叠
    let placedPhotoPositions = [];
    
    // 照片计数器，用于设置z-index确保新照片在上层
    let photoCounter = 0;
    
    // 照片墙是否已显示
    let isPhotoWallVisible = false;
    
    // 初始化函数
    function init() {
        photoWallElement = document.getElementById('photoWall');
        photoWallSection = document.getElementById('photoWallSection');
        
        if (!photoWallElement) {
            console.error("找不到photoWall元素，照片墙初始化失败");
            return;
        }
        
        if (!photoWallSection) {
            console.error("找不到photoWallSection元素，照片墙容器初始化失败");
            return;
        }
        
        // 初始时添加照片墙隐藏的类名
        document.body.classList.add('photo-wall-hidden');
        document.documentElement.classList.add('photo-wall-hidden');
        
        // 清空现有的照片和位置记录
        placedPhotoPositions = [];
        photoCounter = 0;
        
        // 移除现有照片
        const existingPhotos = photoWallElement.querySelectorAll('.photo-item');
        existingPhotos.forEach(photo => {
            photoWallElement.removeChild(photo);
        });
        
        // 检查屏幕宽度，决定是否启用照片墙功能
        checkScreenWidth();
        
        // 添加窗口大小变化监听器
        window.addEventListener('resize', function() {
            clearTimeout(window.resizeTimer);
            window.resizeTimer = setTimeout(function() {
                checkScreenWidth();
                updatePhotoWallLayout();
            }, 200);
        });
    }
    
    // 检查屏幕宽度，决定是否启用照片墙
    function checkScreenWidth() {
        const screenWidth = window.innerWidth;
        
        if (screenWidth <= 1000) {
            // 在小屏幕上强制隐藏照片墙，并不允许显示
            if (photoWallSection) {
                photoWallSection.style.display = 'none';
                photoWallSection.style.opacity = '0';
            }
            // 确保添加了照片墙隐藏的类名
            document.body.classList.add('photo-wall-hidden');
            document.documentElement.classList.add('photo-wall-hidden');
            isPhotoWallVisible = false;
        }
    }
    
    // 更新照片墙布局
    function updatePhotoWallLayout() {
        
        
        if (!photoWallElement) {
            photoWallElement = document.getElementById('photoWall');
            if (!photoWallElement) return;
        }
        
        // 照片墙尺寸现在由CSS控制，保持背景图的比例
        // 因此不需要手动设置尺寸
        const photoWallWidth = photoWallElement.offsetWidth;
        const photoWallHeight = photoWallElement.offsetHeight;
        
        
        
        // 重新布局所有照片
        const existingPhotos = photoWallElement.querySelectorAll('.photo-item');
        if (existingPhotos.length === 0) return;
        
        // 临时存储所有照片
        const photoElements = [];
        existingPhotos.forEach(photo => {
            photoElements.push({
                imgSrc: photo.querySelector('img')?.src
            });
            photoWallElement.removeChild(photo);
        });
        
        // 重置位置记录和计数器
        placedPhotoPositions = [];
        photoCounter = 0;
        
        // 重新添加所有照片
        photoElements.forEach(photo => {
            if (photo.imgSrc) {
                const img = new Image();
                img.src = photo.imgSrc;
                img.onload = function() {
                    addPhotoToWall(img);
                };
            }
        });
    }
    
    // 将照片添加到照片墙 - 严格网格布局版本
    function addPhotoToWall(photoElement) {
        if (!photoElement) {
            console.error("没有有效的照片元素可添加到照片墙");
            return;
        }
        
        
        photoCounter++; // 增加照片计数
        
        // 检查是否是第一张照片，如果是则显示照片墙
        if (!isPhotoWallVisible && photoWallSection) {
            showPhotoWall();
        }
        
        // 创建照片项
        const photoItem = document.createElement('div');
        photoItem.className = 'photo-item';
        
        // 获取照片墙的实际尺寸
        if (!photoWallElement) {
            photoWallElement = document.getElementById('photoWall');
            if (!photoWallElement) {
                console.error("无法找到照片墙元素");
                return;
            }
        }
        
        // 获取照片墙元素的尺寸
        const photoWallWidth = photoWallElement.offsetWidth;
        const photoWallHeight = photoWallElement.offsetHeight;
        
        // 计算动态照片尺寸，基于照片墙的实际尺寸
        // 让照片宽度为照片墙宽度的10.5%，但不小于110px且不大于135px
        const photoWidth = Math.max(110, Math.min(135, photoWallWidth * 0.105));
        const photoHeight = photoWidth * 1.2;
        
        // 创建一个临时的img元素来获取背景图片的实际尺寸
        const bgImageUrl = window.getComputedStyle(photoWallElement).backgroundImage.replace(/url\(['"]?([^'"]*)['"]?\)/g, '$1');
        
        // 开始异步处理照片添加过程
        handlePhotoAddition(photoElement, photoItem, photoWidth, photoHeight, bgImageUrl);
        
        // 返回创建的照片项引用
        return photoItem;
    }
    
    // 辅助函数：处理照片添加的异步过程
    async function handlePhotoAddition(photoElement, photoItem, photoWidth, photoHeight, bgImageUrl) {
        try {
            // 获取照片墙的实际尺寸
            if (!photoWallElement) {
                photoWallElement = document.getElementById('photoWall');
                if (!photoWallElement) {
                    console.error("无法找到照片墙元素");
                    return;
                }
            }
            
            const photoWallWidth = photoWallElement.offsetWidth;
            const photoWallHeight = photoWallElement.offsetHeight;
            
            // 获取背景图像实际尺寸及位置
            const bgImageArea = await new Promise((resolve) => {
                const tempImg = new Image();
                tempImg.onload = function() {
                    // 获取背景图像的自然尺寸
                    const imgNaturalWidth = tempImg.width;
                    const imgNaturalHeight = tempImg.height;
                    
                    // 计算背景图像在容器中的实际显示尺寸
                    const containerRatio = photoWallWidth / photoWallHeight;
                    const imageRatio = imgNaturalWidth / imgNaturalHeight;
                    
                    // 背景图像的实际显示尺寸和位置
                    let actualWidth, actualHeight, offsetX, offsetY;
                    
                    // 根据background-size: contain的规则计算
                    if (imageRatio > containerRatio) {
                        // 图像较宽，会贴合容器宽度
                        actualWidth = photoWallWidth;
                        actualHeight = photoWallWidth / imageRatio;
                        offsetX = 0;
                        offsetY = (photoWallHeight - actualHeight) / 2;
                    } else {
                        // 图像较高，会贴合容器高度
                        actualHeight = photoWallHeight;
                        actualWidth = photoWallHeight * imageRatio;
                        offsetX = (photoWallWidth - actualWidth) / 2;
                        offsetY = 0;
                    }
                    
                    // 返回背景图像的实际显示区域
                    resolve({
                        width: actualWidth,
                        height: actualHeight,
                        left: offsetX,
                        top: offsetY
                    });
                };
                
                // 设置图像源并开始加载
                tempImg.src = bgImageUrl;
                
                // 如果图像已在缓存中，可能不会触发onload
                if (tempImg.complete) {
                    tempImg.onload();
                }
            });
            
            
            
            // 定义放置区域参数 - 严格适应背景图片实际显示区域
            const safetyMargin = 30; // 安全边距，避免照片放在背景边缘
            
            // 有效的放置区域，限制在背景图显示范围内
            const effectiveLeft = bgImageArea.left + safetyMargin;
            const effectiveTop = bgImageArea.top + safetyMargin;
            const effectiveWidth = bgImageArea.width - (safetyMargin * 2);
            const effectiveHeight = bgImageArea.height - (safetyMargin * 2);
            
            // 确保有效区域不为负
            if (effectiveWidth <= 0 || effectiveHeight <= 0) {
                console.error("背景图有效区域太小，无法放置照片");
                return;
            }
            
            // 当前照片数量
            const currentCount = placedPhotoPositions.length;
            
            // 尝试找到一个不与其他照片重叠的位置
            let attempts = 0;
            const maxAttempts = 20;
            let positionValid = false;
            let leftPos, topPos;
            
            // 根据已放置照片数量调整重叠容忍度 - 照片越多，越接受一些重叠
            const overlapTolerance = Math.min(0.7, 0.5 + placedPhotoPositions.length * 0.015);
            
            // 创建照片墙的空间密度热图
            const generateDensityMap = () => {
                if (placedPhotoPositions.length === 0) {
                    return null; // 没有已放置的照片，不需要密度图
                }
                
                // 将有效区域划分为网格
                const gridSize = 20; // 网格大小，值越小精度越高
                const gridWidth = Math.ceil(effectiveWidth / gridSize);
                const gridHeight = Math.ceil(effectiveHeight / gridSize);
                
                // 初始化网格，每个单元格的值表示周围照片的密度
                const grid = Array(gridHeight).fill().map(() => Array(gridWidth).fill(0));
                
                // 计算每个网格单元的密度
                for (let y = 0; y < gridHeight; y++) {
                    for (let x = 0; x < gridWidth; x++) {
                        // 计算网格中心在实际坐标系中的位置
                        const centerX = effectiveLeft + x * gridSize + gridSize / 2;
                        const centerY = effectiveTop + y * gridSize + gridSize / 2;
                        
                        // 计算此位置与所有已放置照片的距离，得到密度值
                        let density = 0;
                        for (const pos of placedPhotoPositions) {
                            const distance = Math.sqrt(
                                Math.pow(pos.left + photoWidth/2 - centerX, 2) + 
                                Math.pow(pos.top + photoHeight/2 - centerY, 2)
                            );
                            
                            // 根据距离计算影响，距离越近影响越大
                            // photoWidth*1.2是影响半径
                            const influence = Math.max(0, 1 - distance / (photoWidth * 1.2));
                            density += influence;
                        }
                        
                        grid[y][x] = density;
                    }
                }
                
                return { grid, gridSize, gridWidth, gridHeight };
            };
            
            // 获取照片墙的密度热图
            const densityMap = generateDensityMap();
            
            while (!positionValid && attempts < maxAttempts) {
                // 根据照片数量选择不同的放置策略
                let placementStrategy;
                
                // 根据已放照片数量选择合适的策略
                if (placedPhotoPositions.length < 5) {
                    // 前5张照片使用预定区域放置策略，确保分布在不同区域
                    placementStrategy = 'fixed_regions';
                } else if (Math.random() < 0.85) { // 大多数情况
                    // 优先找较空的区域
                    placementStrategy = 'low_density';
                } else {
                    // 小概率完全随机，增加一些变化
                    placementStrategy = 'random';
                }
                
                if (placementStrategy === 'fixed_regions') {
                    // 前5张照片固定放在照片墙的5个不同区域，确保不会排成一排
                    
                    // 定义5个散布在照片墙各个区域的位置
                    const fixedRegions = [
                        { x: 0.2, y: 0.2 },  // 左上区域
                        { x: 0.8, y: 0.25 },  // 右上区域
                        { x: 0.5, y: 0.5 },  // 中央区域
                        { x: 0.25, y: 0.75 },  // 左下区域
                        { x: 0.75, y: 0.7 }   // 右下区域
                    ];
                    
                    // 根据当前照片数量，选择放置区域
                    const regionIndex = placedPhotoPositions.length % fixedRegions.length;
                    const baseRegion = fixedRegions[regionIndex];
                    
                    // 计算基准位置，添加随机偏移以避免照片完全对齐
                    const baseX = effectiveLeft + baseRegion.x * effectiveWidth;
                    const baseY = effectiveTop + baseRegion.y * effectiveHeight;
                    
                    // 在基准位置周围添加随机偏移（偏移范围为照片宽度的60%）
                    const offsetRange = photoWidth * 0.6;
                    const offsetX = (Math.random() - 0.5) * offsetRange;
                    const offsetY = (Math.random() - 0.5) * offsetRange;
                    
                    leftPos = baseX - photoWidth/2 + offsetX;
                    topPos = baseY - photoHeight/2 + offsetY;
                    
                    // 确保不超出有效区域
                    leftPos = Math.max(effectiveLeft, Math.min(effectiveLeft + effectiveWidth - photoWidth, leftPos));
                    topPos = Math.max(effectiveTop, Math.min(effectiveTop + effectiveHeight - photoHeight, topPos));
                    
                    // 记录日志
                    
                
                } else if (placementStrategy === 'uniform' && placedPhotoPositions.length > 0) {
                    // 均匀分布策略：尽量远离已有照片
                    // 先随机选择一些候选位置
                    const candidates = [];
                    for (let i = 0; i < 10; i++) {
                        candidates.push({
                            left: effectiveLeft + Math.random() * (effectiveWidth - photoWidth),
                            top: effectiveTop + Math.random() * (effectiveHeight - photoHeight)
                        });
                    }
                    
                    // 计算每个候选位置与最近照片的距离
                    let bestCandidate = candidates[0];
                    let maxMinDistance = 0;
                    
                    for (const candidate of candidates) {
                        let minDistance = Number.MAX_VALUE;
                        for (const pos of placedPhotoPositions) {
                            const distance = Math.sqrt(
                                Math.pow(pos.left - candidate.left, 2) + 
                                Math.pow(pos.top - candidate.top, 2)
                            );
                            minDistance = Math.min(minDistance, distance);
                        }
                        
                        if (minDistance > maxMinDistance) {
                            maxMinDistance = minDistance;
                            bestCandidate = candidate;
                        }
                    }
                    
                    leftPos = bestCandidate.left;
                    topPos = bestCandidate.top;
                }
                else if (placementStrategy === 'low_density' && densityMap) {
                    // 低密度区域策略：找照片最少的区域
                    // 找到密度最低的几个网格单元
                    const lowDensityCells = [];
                    const { grid, gridSize, gridWidth, gridHeight } = densityMap;
                    
                    // 收集所有网格单元及其密度
                    for (let y = 0; y < gridHeight; y++) {
                        for (let x = 0; x < gridWidth; x++) {
                            lowDensityCells.push({ x, y, density: grid[y][x] });
                        }
                    }
                    
                    // 按密度排序
                    lowDensityCells.sort((a, b) => a.density - b.density);
                    
                    // 从密度最低的30%单元格中随机选择一个
                    const selectionCount = Math.max(1, Math.floor(lowDensityCells.length * 0.3));
                    const selectedCell = lowDensityCells[Math.floor(Math.random() * selectionCount)];
                    
                    // 计算选中单元格中的随机位置
                    const cellLeft = effectiveLeft + selectedCell.x * gridSize;
                    const cellTop = effectiveTop + selectedCell.y * gridSize;
                    
                    // 在单元格内随机位置，增加一些变化
                    leftPos = cellLeft + Math.random() * (gridSize - photoWidth/2);
                    topPos = cellTop + Math.random() * (gridSize - photoHeight/2);
                    
                    // 确保不超出有效区域
                    leftPos = Math.max(effectiveLeft, Math.min(effectiveLeft + effectiveWidth - photoWidth, leftPos));
                    topPos = Math.max(effectiveTop, Math.min(effectiveTop + effectiveHeight - photoHeight, topPos));
                }
                else {
                    // 完全随机位置
                    leftPos = effectiveLeft + Math.random() * (effectiveWidth - photoWidth);
                    topPos = effectiveTop + Math.random() * (effectiveHeight - photoHeight);
                }
                
                // 检查这个位置是否与现有照片重叠
                positionValid = true;
                for (let i = 0; i < placedPhotoPositions.length; i++) {
                    const pos = placedPhotoPositions[i];
                    const distance = Math.sqrt(
                        Math.pow(pos.left - leftPos, 2) + 
                        Math.pow(pos.top - topPos, 2)
                    );
                    
                    // 如果距离小于照片宽度，则认为重叠
                    // 照片越多，允许的重叠度越大
                    if (distance < photoWidth * overlapTolerance) {
                        positionValid = false;
                        break;
                    }
                }
                
                attempts++;
            }
            
            
            
            // 记录照片位置以供引用
            placedPhotoPositions.push({left: leftPos, top: topPos});
            
            // 设置照片样式 - 精确定位和尺寸
            photoItem.style.top = `${topPos}px`;
            photoItem.style.left = `${leftPos}px`;
            photoItem.style.width = `${photoWidth}px`;
            photoItem.style.height = `${photoHeight}px`;
            
            // 大幅增加随机旋转角度，使照片看起来更自然散乱
            // 为不同照片使用不同的旋转策略
            
            // 使用正态分布随机数生成更自然的旋转角度
            const generateNormalRandom = () => {
                // Box-Muller变换生成正态分布随机数
                const u = 1 - Math.random(); // 避免取到0
                const v = 1 - Math.random();
                const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
                // 标准正态分布，均值0，标准差1
                return z;
            };
            
            // 为前五张照片使用更特殊的旋转策略
            let finalRotation;
            
            if (placedPhotoPositions.length < 5) {
                // 前5张照片使用预定角度，确保多样性
                // 这些角度覆盖了不同的旋转情况：左倾、右倾、适中
                const predefinedAngles = [-12, 8, -5, 15, -8];
                const angleIndex = placedPhotoPositions.length % predefinedAngles.length;
                const baseAngle = predefinedAngles[angleIndex];
                
                // 添加一些随机变化，但保持基本方向
                const angleVariation = 3; // 允许±3度的变化
                finalRotation = baseAngle + (Math.random() * 2 - 1) * angleVariation;
            } else {
                // 生成基于照片位置的角度，使旋转看起来更自然
                // 基本思想：中央照片倾斜较小，边缘照片倾斜较大，左右两侧倾斜方向相反
                
                // 计算照片的相对位置（0-1范围内的坐标）
                const relativeX = (leftPos - effectiveLeft) / effectiveWidth;
                
                // 根据X坐标决定旋转角度的基础方向
                // 左侧照片倾向于右旋转(正角度)，右侧照片倾向于左旋转(负角度)
                const baseDirection = 0.5 - relativeX; // -0.5到0.5之间
                
                // 不同策略的权重
                const strategies = [
                    { name: "position_based", weight: 0.4 },  // 基于位置的旋转
                    { name: "normal_random", weight: 0.4 },   // 正态分布随机旋转
                    { name: "extreme", weight: 0.2 }          // 极端旋转
                ];
                
                // 随机选择一种策略
                const totalWeight = strategies.reduce((sum, s) => sum + s.weight, 0);
                let randomWeight = Math.random() * totalWeight;
                let chosenStrategy = strategies[0].name;
                
                let cumulativeWeight = 0;
                for (const strategy of strategies) {
                    cumulativeWeight += strategy.weight;
                    if (randomWeight <= cumulativeWeight) {
                        chosenStrategy = strategy.name;
                        break;
                    }
                }
                
                // 根据选择的策略计算角度
                if (chosenStrategy === "position_based") {
                    // 基于位置的角度：左边照片向右倾斜，右边照片向左倾斜
                    const maxAngle = 15; // 最大倾斜角度
                    finalRotation = baseDirection * maxAngle * 2; // 角度范围：约-15到15度
                    
                    // 添加一些随机变化
                    finalRotation += (Math.random() * 6 - 3); // ±3度的随机变化
                }
                else if (chosenStrategy === "normal_random") {
                    // 正态分布随机旋转：大多数照片旋转角度适中，少数更极端
                    const normalRandom = generateNormalRandom();
                    const rotationRange = 15; // 主要旋转范围
                    finalRotation = normalRandom * (rotationRange / 2); // 大部分在±7.5度之间
                }
                else {
                    // 极端旋转：少数照片有更大的旋转角度
                    finalRotation = (Math.random() * 40 - 20); // -20到20度均匀分布
                }
            }
            
            // 应用最终旋转角度
            photoItem.style.transform = `rotate(${finalRotation}deg)`;
            photoItem.style.zIndex = photoCounter.toString();
            
            
            // 克隆图片并添加到photoItem
            const img = document.createElement('img');
            img.src = photoElement.src;
            img.alt = 'Polaroid photo';
            photoItem.appendChild(img);
            
            // 变量用于跟踪拖拽状态
            let isDragging = false;
            let startX, startY;
            let originalLeft, originalTop;
            let longPressTimer;
            let moveThreshold = 5; // 移动超过这个像素数才算拖拽
            let hasMovedEnough = false; // 跟踪是否移动超过阈值
            let feedbackTimer; // 轻微反馈动画定时器
            
            const LONG_PRESS_DURATION = 150; // 减少长按触发时间到150毫秒
            
            // 设置照片可拖拽样式
            photoItem.style.cursor = 'grab'; // 显示可抓取的光标
            
            // 移除文字提示器，仅保留视觉反馈
            
            // 鼠标/触摸按下事件 - 可能开始拖拽
            photoItem.addEventListener('mousedown', handleDragStart);
            photoItem.addEventListener('touchstart', handleDragStart, {passive: false});
            
            // 处理拖拽开始
            function handleDragStart(e) {
                // 阻止默认行为和冒泡
                e.preventDefault();
                e.stopPropagation();
                
                // 保存初始位置
                startX = e.clientX || (e.touches && e.touches[0].clientX);
                startY = e.clientY || (e.touches && e.touches[0].clientY);
                originalLeft = parseFloat(photoItem.style.left);
                originalTop = parseFloat(photoItem.style.top);
                hasMovedEnough = false;
                
                // 立即提供轻微的视觉反馈，表示可以长按
                photoItem.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
                
                // 移除显示提示的代码
                
                // 在50ms内提供轻微的缩放反馈
                feedbackTimer = setTimeout(() => {
                    photoItem.style.transform = photoItem.style.transform.replace('scale(1)', 'scale(1.02)');
                }, 50);
                
                // 设置长按定时器 - 减少时间以增加响应速度
                longPressTimer = setTimeout(() => {
                    // 长按后开始拖拽
                    isDragging = true;
                    
                    // 移除隐藏提示的代码
                    
                    // 改变鼠标指针样式和添加拖拽中样式
                    photoItem.style.cursor = 'grabbing';
                    photoItem.classList.add('dragging');
                    
                    // 提高当前拖拽照片的z-index，确保它显示在最上层
                    photoItem.style.zIndex = '1000';
                    
                    // 添加明显的放大效果，提供视觉反馈
                    const currentRotation = photoItem.style.transform.match(/rotate\(([^)]+)\)/);
                    const rotationValue = currentRotation ? currentRotation[1] : '0deg';
                    photoItem.style.transform = `rotate(${rotationValue}) scale(1.08)`;
                    
                    // 移除过渡效果，使拖动更加流畅
                    photoItem.style.transition = 'box-shadow 0.15s ease';
                    photoItem.style.boxShadow = '0 10px 25px rgba(0, 0, 0, 0.3)';
                    
                    // 添加轻微振动反馈（使用新的移动端功能模块）
                    import('../utils/mobileFeatures.js').then(({ vibrate }) => {
                        vibrate(20); // 轻微振动20毫秒
                    }).catch(error => {
                        // 回退到原有的navigator.vibrate方法
                        if (window.navigator && window.navigator.vibrate) {
                            window.navigator.vibrate(20);
                        }
                    });
                }, LONG_PRESS_DURATION);
                
                // 添加全局移动和释放事件监听器，使用passive: false以允许阻止默认行为
                document.addEventListener('mousemove', handleDragMove, {passive: false});
                document.addEventListener('touchmove', handleDragMove, {passive: false});
                document.addEventListener('mouseup', handleDragEnd);
                document.addEventListener('touchend', handleDragEnd);
            }
            
            // 处理拖拽移动
            function handleDragMove(e) {
                // 阻止默认行为，防止页面滚动
                e.preventDefault();
                
                // 计算移动的距离
                const pageX = e.clientX || (e.touches && e.touches[0].clientX);
                const pageY = e.clientY || (e.touches && e.touches[0].clientY);
                const deltaX = pageX - startX;
                const deltaY = pageY - startY;
                
                // 检查是否已经移动超过阈值
                if (!hasMovedEnough && (Math.abs(deltaX) > moveThreshold || Math.abs(deltaY) > moveThreshold)) {
                    hasMovedEnough = true;
                    
                    // 如果移动超过阈值但还没开始拖拽，立即开始拖拽
                    if (!isDragging) {
                        clearTimeout(longPressTimer); // 清除长按计时器
                        clearTimeout(feedbackTimer); // 清除反馈计时器
                        
                        // 移除隐藏提示的代码
                        
                        // 标记为拖拽状态
                        isDragging = true;
                        
                        // 改变鼠标指针样式和添加拖拽中样式
                        photoItem.style.cursor = 'grabbing';
                        photoItem.classList.add('dragging');
                        
                        // 提高z-index确保在最上层
                        photoItem.style.zIndex = '1000';
                        
                        // 添加明显的放大效果
                        const currentRotation = photoItem.style.transform.match(/rotate\(([^)]+)\)/);
                        const rotationValue = currentRotation ? currentRotation[1] : '0deg';
                        photoItem.style.transform = `rotate(${rotationValue}) scale(1.08)`;
                        
                        // 移除过渡效果，使拖动更加流畅
                        photoItem.style.transition = 'none';
                        photoItem.style.boxShadow = '0 10px 25px rgba(0, 0, 0, 0.3)';
                    }
                }
                
                // 如果已经开始拖拽，更新位置
                if (isDragging) {
                    // 更新照片位置 - 使用transform代替left/top以提高性能
                    const newLeft = originalLeft + deltaX;
                    const newTop = originalTop + deltaY;
                    
                    // 应用新位置
                    photoItem.style.left = `${newLeft}px`;
                    photoItem.style.top = `${newTop}px`;
                }
            }
            
            // 处理拖拽结束
            function handleDragEnd(e) {
                // 清除定时器
                clearTimeout(longPressTimer);
                clearTimeout(feedbackTimer);
                
                // 移除隐藏提示的代码
                
                // 如果正在拖拽，更新位置记录
                if (isDragging) {
                    // 获取当前位置
                    const currentLeft = parseFloat(photoItem.style.left);
                    const currentTop = parseFloat(photoItem.style.top);
                    
                    // 更新位置数组中的记录
                    const index = placedPhotoPositions.findIndex(
                        pos => pos.left === originalLeft && pos.top === originalTop
                    );
                    
                    if (index !== -1) {
                        placedPhotoPositions[index] = { left: currentLeft, top: currentTop };
                    }
                    
                    // 恢复样式 - 添加平滑过渡回原始状态
                    photoItem.style.transition = 'transform 0.2s ease, box-shadow 0.2s ease';
                    photoItem.style.cursor = 'grab';
                    photoItem.classList.remove('dragging');
                    photoItem.style.zIndex = photoCounter.toString();
                    
                    // 恢复原始旋转角度 - 平滑过渡
                    const rotation = photoItem.style.transform.match(/rotate\(([^)]+)\)/);
                    if (rotation && rotation[1]) {
                        photoItem.style.transform = `rotate(${rotation[1]})`;
                    }
                    
                    // 移除阴影
                    photoItem.style.boxShadow = '';
                    
                    // 在过渡结束后移除过渡效果
                    setTimeout(() => {
                        photoItem.style.transition = '';
                    }, 200);
                    
                    // 重置拖拽状态
                    isDragging = false;
                } else {
                    // 如果没有拖拽，是单击，恢复原状并显示预览
                    photoItem.style.boxShadow = '';
                    photoItem.style.transform = photoItem.style.transform.replace('scale(1.02)', 'scale(1)');
                    photoItem.style.transition = '';
                    
                    // 显示预览
                    showPhotoPreview();
                }
                
                // 移除全局事件监听器
                document.removeEventListener('mousemove', handleDragMove);
                document.removeEventListener('touchmove', handleDragMove);
                document.removeEventListener('mouseup', handleDragEnd);
                document.removeEventListener('touchend', handleDragEnd);
            }
            
            // 照片预览功能
            function showPhotoPreview() {
                // 创建照片预览弹窗
                const overlay = document.createElement('div');
                overlay.style.position = 'fixed';
                overlay.style.top = '0';
                overlay.style.left = '0';
                overlay.style.width = '100%';
                overlay.style.height = '100%';
                overlay.style.backgroundColor = 'rgba(0,0,0,0.8)';
                overlay.style.display = 'flex';
                overlay.style.flexDirection = 'column';
                overlay.style.alignItems = 'center';
                overlay.style.justifyContent = 'center';
                overlay.style.zIndex = '9999';
                overlay.style.cursor = 'pointer';
                
                // 创建一个容器用于图片和按钮 - 稍微缩小整体尺寸
                const contentContainer = document.createElement('div');
                contentContainer.style.display = 'flex';
                contentContainer.style.flexDirection = 'column';
                contentContainer.style.alignItems = 'center';
                contentContainer.style.maxWidth = '80%'; // 从90%减小到80%
                contentContainer.style.maxHeight = '80%'; // 从90%减小到80%
                contentContainer.style.position = 'relative';
                
                // 创建预览图 - 稍微缩小尺寸
                const largeImg = document.createElement('img');
                largeImg.src = img.src;
                largeImg.style.maxWidth = '85%';  // 减小最大宽度
                largeImg.style.maxHeight = 'calc(75vh - 60px)'; // 减小最大高度，为按钮留出空间
                largeImg.style.boxShadow = '0 0 20px rgba(0,0,0,0.5)';
                
                // 创建按钮容器 - 适当调整按钮区域
                const buttonContainer = document.createElement('div');
                buttonContainer.style.display = 'flex';
                buttonContainer.style.justifyContent = 'center';
                buttonContainer.style.marginTop = '15px'; // 从20px减小到15px
                buttonContainer.style.gap = '12px'; // 从15px减小到12px
                
                // 创建下载按钮 - 稍微缩小按钮尺寸
                const downloadBtn = document.createElement('button');
                downloadBtn.textContent = 'Download';
                downloadBtn.style.backgroundColor = '#052329';
                downloadBtn.style.color = 'white';
                downloadBtn.style.border = 'none';
                downloadBtn.style.padding = '6px 14px'; // 从8px 16px减小到6px 14px
                downloadBtn.style.borderRadius = '4px';
                downloadBtn.style.cursor = 'pointer';
                downloadBtn.style.fontFamily = "'Playfair Display', serif";
                downloadBtn.style.fontWeight = '400';
                downloadBtn.style.fontSize = '14px'; // 添加字体大小控制
                
                // 添加下载功能
                downloadBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    
                    const fileName = `polaroid_photo_${new Date().toISOString().slice(0,19).replace(/[-:]/g, '')}.png`;
                    
                    // 使用新的移动端功能模块保存图片
                    import('../utils/mobileFeatures.js').then(({ saveImageToDevice }) => {
                        saveImageToDevice(img.src, fileName);
                    }).catch(error => {
                        console.warn('无法使用移动端功能模块，使用传统下载方式:', error);
                        // 回退到传统下载方式
                        const link = document.createElement('a');
                        link.href = img.src;
                        link.download = fileName;
                        link.click();
                    });
                });
                
                // 创建删除按钮 - 保持与下载按钮一致的样式
                const deleteBtn = document.createElement('button');
                deleteBtn.textContent = 'Delete';
                deleteBtn.style.backgroundColor = '#052329';
                deleteBtn.style.color = 'white';
                deleteBtn.style.border = 'none';
                deleteBtn.style.padding = '6px 14px'; // 从8px 16px减小到6px 14px
                deleteBtn.style.borderRadius = '4px';
                deleteBtn.style.cursor = 'pointer';
                deleteBtn.style.fontFamily = "'Playfair Display', serif";
                deleteBtn.style.fontWeight = '400';
                deleteBtn.style.fontSize = '14px'; // 添加字体大小控制
                
                // 添加删除功能 - 直接删除无需确认
                deleteBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    
                    // 找到照片在位置数组中的索引
                    const index = placedPhotoPositions.findIndex(
                        pos => pos.left === parseFloat(photoItem.style.left) && 
                        pos.top === parseFloat(photoItem.style.top)
                    );
                    
                    // 从位置数组中移除
                    if (index !== -1) {
                        placedPhotoPositions.splice(index, 1);
                    }
                    
                    // 从DOM中移除照片
                    photoItem.remove();
                    
                    // 关闭弹窗
                    document.body.removeChild(overlay);
                });
                
                // 将按钮添加到按钮容器
                buttonContainer.appendChild(downloadBtn);
                buttonContainer.appendChild(deleteBtn);
                
                // 将图片和按钮容器添加到内容容器
                contentContainer.appendChild(largeImg);
                contentContainer.appendChild(buttonContainer);
                
                // 添加关闭功能
                overlay.onclick = function() {
                    document.body.removeChild(overlay);
                };
                
                // 阻止点击内容容器时关闭
                contentContainer.onclick = function(e) {
                    e.stopPropagation();
                };
                
                // 将内容容器添加到覆盖层
                overlay.appendChild(contentContainer);
                
                // 将覆盖层添加到body
                document.body.appendChild(overlay);
            }
            
            // 添加到照片墙
            photoWallElement.appendChild(photoItem);
            
        } catch (error) {
            console.error("照片添加过程出错:", error);
        }
        
        // 返回创建的照片项引用
        return photoItem;
    }
    
    // 为了兼容性保留一个简化版本的savePhotoToWall
    function savePhotoToWall(photoDataURL) {
        
        if (!photoDataURL) {
            console.error("没有照片数据可保存");
            return;
        }
        
        // 创建图像元素
        const img = document.createElement('img');
        img.src = photoDataURL;
        img.alt = '拍立得照片';
        
        // 使用新方法添加到照片墙
        addPhotoToWall(img);
    }
    
    // 移除照片墙网格功能
    
    // 清空照片墙
    function clearPhotoWall() {
        if (!photoWallElement) {
            photoWallElement = document.getElementById('photoWall');
            if (!photoWallElement) return;
        }
        
        // 移除所有照片
        const existingPhotos = photoWallElement.querySelectorAll('.photo-item');
        existingPhotos.forEach(photo => {
            photoWallElement.removeChild(photo);
        });
        
        // 重置位置记录和计数器
        placedPhotoPositions = [];
        photoCounter = 0;
        
        // 如果照片墙已显示，隐藏它
        if (isPhotoWallVisible && photoWallSection) {
            // 同时触发照片墙渐隐和相机模块位置变化
            // 设置照片墙透明度为0，触发淡出动画
            photoWallSection.style.opacity = '0';
            
            // 添加照片墙隐藏的类名，让相机模块位置通过CSS过渡效果变化
            document.body.classList.add('photo-wall-hidden');
            document.documentElement.classList.add('photo-wall-hidden');
            
            // 等待过渡动画完成后移除照片墙
            setTimeout(() => {
                photoWallSection.style.display = 'none';
                isPhotoWallVisible = false;
            }, 1500); // 等待淡出动画完成
        }
        
        
    }
    
    // 显示照片墙
    function showPhotoWall() {
        // 检查屏幕宽度，如果小于等于1000px，则不显示照片墙
        if (window.innerWidth <= 1000) {
            return; // 在小屏幕上不执行任何操作
        }
        
        // 首先显示照片墙容器元素(但透明度为0)
        photoWallSection.style.display = 'flex';
        photoWallSection.style.opacity = '0';
        
        // 强制重排，确保display变化已应用
        void photoWallSection.offsetWidth;
        
        // 同时触发照片墙渐显和相机模块位置变化
        // 移除照片墙隐藏的类名，让相机模块位置通过CSS过渡效果变化
        document.body.classList.remove('photo-wall-hidden');
        document.documentElement.classList.remove('photo-wall-hidden');
        
        // 设置透明度为1，触发淡入动画
        photoWallSection.style.opacity = '1';
        isPhotoWallVisible = true;
    }
    
    // 公开API
    return {
        init: init,
        addPhotoToWall: addPhotoToWall,
        savePhotoToWall: savePhotoToWall,
        updatePhotoWallLayout: updatePhotoWallLayout,
        clearPhotoWall: clearPhotoWall
    };
})();