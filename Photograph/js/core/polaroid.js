/**
 * 拍立得照片生成器 - 核心功能模块
 * 负责处理照片上传、拍立得效果生成和照片保存
 */

const PolaroidCore = (function() {
    // 私有变量
    let polaroidCanvas = null;
    let polaroidContainer = null;
    let imageUpload = null;
    let saveBtn = null;
    let resetBtn = null;
    let currentPhotoDataURL = null;
    let autoSaveExecuted = false;
    let polaroidFramePath = '';
    

    
    // 初始化函数
    function init() {
        
        
        // 获取DOM元素
        polaroidCanvas = document.getElementById('polaroidCanvas');
        polaroidContainer = document.getElementById('polaroidContainer');
        imageUpload = document.getElementById('imageUpload');
        
        // 设置拍立得边框图片路径
        const baseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
        polaroidFramePath = baseUrl + 'assets/frame.png';
        

        
        
        // 确保前层图片正确显示
        const cameraFrontLayer = document.querySelector('.camera-front-layer');
        if (cameraFrontLayer) {
            cameraFrontLayer.style.display = 'block';
        }
        
        // 预加载相框图片
        const preloadFrameImg = new Image();
        preloadFrameImg.src = polaroidFramePath;
        
        // 确保Canvas元素存在并设置正确的大小
        if (polaroidCanvas) {
            // 增加Canvas分辨率到1080p
            polaroidCanvas.width = 1080;
            polaroidCanvas.height = 1296; // 保持原来的宽高比例 (1080 * 1.2)
            
            
            // 确保Canvas元素可见和正确尺寸，但不添加背景
            polaroidCanvas.style.display = 'block';
            polaroidCanvas.style.width = '100%';
            polaroidCanvas.style.height = 'auto';
        } else {
            console.error("找不到polaroidCanvas元素，请检查HTML结构");
        }
        
        // 添加canvas更新事件监听
        polaroidCanvas.addEventListener('renderComplete', function() {
            try {
                
                currentPhotoDataURL = polaroidCanvas.toDataURL('image/png');
                
            } catch(e) {
                console.error("renderComplete事件中无法获取照片数据:", e);
            }
        });
        
        // 添加动画结束监听器（监听transition结束）
        if (polaroidContainer) {
            polaroidContainer.addEventListener('transitionend', function(e) {
                // 只处理opacity或top属性的过渡结束
                if (e.propertyName === 'opacity' || e.propertyName === 'top') {
                    
                    // 用户已经看到照片，在延迟2秒后开始保存流程，给用户更多时间观看照片
                    if (currentPhotoDataURL && !autoSaveExecuted) {
                        autoSaveExecuted = true;
                        
                        // 检查屏幕宽度，根据不同宽度采用不同的行为
                        const screenWidth = window.innerWidth;
                        
                        // 延迟2秒后再执行下一步操作
                        setTimeout(function() {
                            // 捕获Canvas内容
                            const photoElement = captureCanvasAsImage();
                            
                            if (screenWidth <= 1000) {
                                // 在小屏幕上，保持照片显示在相机出口位置
                                // 不要隐藏照片，也不要重置相机
                                
                                // 为照片添加下载按钮
                                addDownloadButtonForSmallScreen();
                                
                                // 照片保持可见，不进行其他操作
                            } else {
                                // 大屏幕上的原有行为：隐藏相机照片，添加到照片墙
                                polaroidContainer.style.transition = 'none';
                                polaroidContainer.style.display = 'none';
                                
                                // 照片已经从相机中消失，立即添加到照片墙
                                if (photoElement) {
                                    PhotoWall.addPhotoToWall(photoElement);
                                    
                                    // 重置相机
                                    resetCamera();
                                }
                            }
                        }, 2000); // 延迟2秒
                    }
                }
            });
        }
        
        // 为小屏幕添加下载按钮的函数
        function addDownloadButtonForSmallScreen() {
            // 检查是否已存在下载按钮，如果存在则先移除
            const existingBtn = document.getElementById('smallScreenDownloadBtn');
            if (existingBtn) {
                existingBtn.remove();
            }
            
            // 创建下载按钮
            const downloadBtn = document.createElement('button');
            downloadBtn.id = 'smallScreenDownloadBtn';
            downloadBtn.textContent = 'Download';
            downloadBtn.className = 'download-button';
            
            // 设置按钮样式 - 不再使用绝对定位，而是放在正常流程中
            Object.assign(downloadBtn.style, {
                display: 'block',
                backgroundColor: '#052329',
                color: 'white',
                border: 'none',
                padding: '10px 20px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 'normal',
                fontSize: '16px',
                fontFamily: "'Playfair Display', serif",
                margin: '10px auto 100px',  // 增加底部外边距，避免与社交媒体按钮冲突
                width: '140px',
                textAlign: 'center',
                zIndex: '10',
                boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
                transition: 'all 0.3s'
            });
            
            // 添加悬停效果
            downloadBtn.onmouseover = function() {
                this.style.backgroundColor = '#0B4A56';
                this.style.transform = 'translateY(-2px)';
                this.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
            };
            
            downloadBtn.onmouseout = function() {
                this.style.backgroundColor = '#052329';
                this.style.transform = 'none';
                this.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
            };
            
            // 添加下载功能
            downloadBtn.addEventListener('click', function() {
                if (currentPhotoDataURL) {
                    // 检测是否是移动设备
                    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                    const fileName = `polaroid_photo_${new Date().toISOString().slice(0,19).replace(/[-:]/g, '')}.png`;
                    
                    if (isMobile) {
                        // 移动设备尝试使用Files API（如果支持）
                        if (navigator.share && currentPhotoDataURL) {
                            // 从dataURL获取Blob
                            fetch(currentPhotoDataURL)
                                .then(res => res.blob())
                                .then(blob => {
                                    // 创建文件对象
                                    const file = new File([blob], fileName, { type: 'image/png' });
                                    
                                    // 使用Web Share API
                                    navigator.share({
                                        title: 'Polaroid Photo',
                                        files: [file]
                                    }).catch(err => {
                                        console.warn('Share API failed, falling back to regular download', err);
                                        // 回退到常规下载方法
                                        performRegularDownload();
                                    });
                                })
                                .catch(err => {
                                    console.error('Error creating shareable file:', err);
                                    performRegularDownload();
                                });
                        } else {
                            // 回退到常规下载
                            performRegularDownload();
                        }
                    } else {
                        // 桌面设备使用常规下载
                        performRegularDownload();
                    }
                    
                    // 常规下载方法
                    function performRegularDownload() {
                        // 使用新的移动端功能模块保存图片
                        import('../utils/mobileFeatures.js').then(({ saveImageToDevice }) => {
                            saveImageToDevice(currentPhotoDataURL, fileName);
                        }).catch(error => {
                            console.warn('无法使用移动端功能模块，使用传统下载方式:', error);
                            // 回退到传统下载方式
                            const link = document.createElement('a');
                            link.href = currentPhotoDataURL;
                            link.download = fileName;
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                        });
                    }
                }
            });
            
            // 将按钮添加到action-buttons之后
            const actionButtons = document.querySelector('.action-buttons');
            if (actionButtons && actionButtons.parentNode) {
                actionButtons.parentNode.insertBefore(downloadBtn, actionButtons.nextSibling);
            } else {
                // 后备方案：添加到相机固定包装器下
                const cameraFixedWrapper = document.querySelector('.camera-fixed-wrapper');
                if (cameraFixedWrapper && cameraFixedWrapper.parentNode) {
                    cameraFixedWrapper.parentNode.appendChild(downloadBtn);
                }
            }
        }
        
        // 监听图片上传事件
        if (imageUpload) {
            imageUpload.addEventListener('change', handleImageUpload);
            
        } else {
            console.error("未找到图片上传元素");
        }
        
        // 显示空白相框
        displayEmptyFrame();
    }
    
    // 处理图片上传
    function handleImageUpload(e) {
        const file = e.target.files[0];
        
        if (!file) {
            return;
        }
        
        // 检查是否为图片文件
        if (!file.type.match('image.*')) {
            alert('Please upload an image file.');
            return;
        }
        
        // 检查屏幕宽度
        const screenWidth = window.innerWidth;
        
        // 如果是小屏幕且已有照片显示，先删除下载按钮
        if (screenWidth <= 1000) {
            const existingBtn = document.getElementById('smallScreenDownloadBtn');
            if (existingBtn) {
                existingBtn.remove();
            }
        }
        
        const reader = new FileReader();
        
        reader.onload = function(event) {
            // 立即隐藏相框 - 确保先是完全隐藏状态
            polaroidContainer.style.display = 'none';
            polaroidContainer.classList.remove('animated');
            polaroidContainer.classList.add('hidden');
            
            // 设置初始位置（顶部）
            polaroidContainer.style.opacity = '0';
            polaroidContainer.style.top = '0';
            
            // 强制重排DOM，以确保隐藏状态生效
            void polaroidContainer.offsetWidth;
            
            // 准备动画设置但不启动
            if (polaroidContainer) {
                // 确保canvas内容可见，但不添加额外背景
                polaroidCanvas.style.border = 'none';
                
                // 完全重设所有样式，确保没有冲突
                polaroidContainer.style.display = 'block';
                polaroidContainer.style.backgroundColor = 'transparent';
                polaroidContainer.style.padding = '0';
                polaroidContainer.style.boxShadow = '0 3px 10px rgba(0,0,0,0.2)';
                polaroidContainer.style.transition = 'none'; // 禁用任何过渡效果
                
                // 设置初始位置 - 相机内部
                polaroidContainer.style.opacity = '0';
                polaroidContainer.style.top = '-20px';
                
                // 移除所有可能的类
                polaroidContainer.classList.remove('hidden');
                polaroidContainer.classList.remove('animated');
                
                // 强制重排DOM，确保初始样式生效
                void polaroidContainer.offsetWidth;
                
                // 设置动画过渡
                polaroidContainer.style.transition = 'opacity 0.7s ease-out, top 1.5s ease-out';
            } else {
                console.error("【错误】找不到polaroidContainer元素");
                return;
            }
            
            // 显示拍立得效果 - 开始创建图片，合成完成后会自动开始动画
            createPolaroidPhoto(event.target.result);
            
            // 重置自动保存标志
            autoSaveExecuted = false;
        };
        
        reader.onerror = function(e) {
            console.error('文件读取失败', e);
            alert('File reading failed, please try again.');
        };
        
        // 开始读取文件
        try {
            reader.readAsDataURL(file);
        } catch (err) {
            console.error("读取文件时出错:", err);
            alert('Error reading file, please try again.');
        }
    }
    
    // 创建拍立得照片 - 解决Canvas安全限制问题
    function createPolaroidPhoto(userImageSrc) {
        
        
        const ctx = polaroidCanvas.getContext('2d');
        
        // 创建图片元素
        const frameImg = new Image();
        const userImg = new Image();
        
        // 加载用户图片
        userImg.onload = function() {
            
            
            // 加载相框图片
            frameImg.onload = function() {
                
                
                try {
                    
                    
                    // 清除canvas
                    ctx.clearRect(0, 0, polaroidCanvas.width, polaroidCanvas.height);
                    
                    // 绘制白色背景
                    ctx.fillStyle = 'white';
                    ctx.fillRect(0, 0, polaroidCanvas.width, polaroidCanvas.height);
                    
                    // 在canvas上绘制用户图片（调整为接近正方形的比例）
                    const imgWidth = polaroidCanvas.width * 0.86;
                    // 调整高度使照片区域更接近正方形
                    const imgHeight = imgWidth; // 1:1 比例的正方形
                    const imgX = (polaroidCanvas.width - imgWidth) / 2;
                    const imgY = 30; // 稍微上移一点
                    
                    // 创建一个临时canvas来处理图片
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = imgWidth;
                    tempCanvas.height = imgHeight;
                    const tempCtx = tempCanvas.getContext('2d');
                    
                    // 绘制用户图片到临时canvas
                    drawImageProp(tempCtx, userImg, 0, 0, imgWidth, imgHeight);
                    
                    // 应用富士蓝调复古滤镜效果
                    applyPolaroidFilter(tempCtx, imgWidth, imgHeight);
                    
                    // 将处理后的图片绘制到主canvas
                    ctx.drawImage(tempCanvas, imgX, imgY);
                    
                    // 在绘制相框之前准备动画
                    if (polaroidContainer) {
                        // 完全重设所有样式，确保没有冲突
                        polaroidContainer.style.display = 'block';
                        polaroidContainer.style.backgroundColor = 'transparent';
                        polaroidContainer.style.padding = '0';
                        polaroidContainer.style.boxShadow = '0 3px 10px rgba(0,0,0,0.2)';
                        polaroidContainer.style.transition = 'none'; // 禁用任何过渡效果
                        
                        // 设置初始位置 - 相机内部
                        polaroidContainer.style.opacity = '0';
                        polaroidContainer.style.top = '-20px';
                        
                        // 移除所有可能的类
                        polaroidContainer.classList.remove('hidden');
                        polaroidContainer.classList.remove('animated');
                        
                        // 强制重排DOM，确保初始样式生效
                        void polaroidContainer.offsetWidth;
                        
                        // 设置动画过渡 - 显著延长时间使动画更加缓慢
                        polaroidContainer.style.transition = 'opacity 1.5s ease-out, top 6s ease-out';
                    }
                    
                    // 绘制相框 - 确保相框保持高质量
                    ctx.save();
                    // 使用高质量的绘制模式
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';
                    ctx.drawImage(frameImg, 0, 0, polaroidCanvas.width, polaroidCanvas.height);
                    ctx.restore();
                    
                    // 在绘制相框后添加日期文本，这样文本会显示在相框上面
                    // 格式化当前日期，例如 Mar.13.2025
                    const now = new Date();
                    const month = now.toLocaleString('en-US', { month: 'short' }); // Mar
                    const day = now.getDate(); // 13
                    const year = now.getFullYear(); // 完整年份，例如2025
                    const dateText = `${month}.${day}.${year}`;
                    
                    // 设置更大的字体大小
                    const fontSize = 68; // 固定字体大小为68px
                    
                    // 设置文本样式
                    ctx.save();
                    ctx.font = `${fontSize}px 'Homemade Apple', cursive, serif`; // 使用Homemade Apple字体，添加备用字体
                    ctx.fillStyle = "rgba(0, 0, 0, 0.8)"; // 稍微减小不透明度，使其更自然
                    ctx.textAlign = "center";
                    
                    // 在相框底部绘制日期 - 位置调整为相框底部留白区域
                    const textY = polaroidCanvas.height - 110; // 距离底部固定80像素
                    ctx.fillText(dateText, polaroidCanvas.width / 2, textY);
                    ctx.restore();
                    
                    // 立即开始动画
                    if (polaroidContainer) {
                        // 立即触发拍立得"打印"开始的震动 - 照片动画开始的瞬间
                        try {
                            console.log('📷 拍立得照片开始"打印"，立即触发震动反馈...');
                            
                            // 使用更快节奏的震动模式：短震动，间隔更短
                            if (typeof window.mobileFeatures !== 'undefined' && window.mobileFeatures.vibrate) {
                                // 快节奏震动模式：短-短-短，间隔很短
                                window.mobileFeatures.vibrate([150, 50, 150, 50, 150]);
                                console.log('✅ 照片"打印"震动：[150, 50, 150, 50, 150]ms');
                            } else {
                                // 回退到传统方法，同样使用快节奏
                                if ('vibrate' in navigator) {
                                    navigator.vibrate([150, 50, 150, 50, 150]);
                                    console.log('✅ 照片"打印"震动（标准API）：[150, 50, 150, 50, 150]ms');
                                } else {
                                    console.warn('⚠️ 设备不支持震动功能');
                                }
                            }
                        } catch (error) {
                            console.warn('❌ 震动功能执行失败:', error);
                        }
                        
                        // 设置最终状态 - 从相机中滑出
                        polaroidContainer.style.opacity = '1';
                        polaroidContainer.style.top = '40px';
                        
                        
                    } else {
                        console.error("【显示错误】polaroidContainer不存在");
                    }
                    
                    // 存储处理后的图片数据，从Canvas获取
                    try {
                        // 获取处理后的照片数据URL - 使用PNG格式以保持高分辨率和质量
                        currentPhotoDataURL = polaroidCanvas.toDataURL('image/png', 1.0);
                        
                    } catch(e) {
                        console.error("获取Canvas数据URL失败:", e);
                        // 如果从Canvas获取失败，回退到原始图片
                        
                        currentPhotoDataURL = userImageSrc;
                    }
                    
                    // 生成renderComplete事件
                    const renderCompleteEvent = new CustomEvent('renderComplete', { 
                        detail: { success: true, dataURL: currentPhotoDataURL } 
                    });
                    polaroidCanvas.dispatchEvent(renderCompleteEvent);
                    
                    // 注意：不再使用延时自动保存
                    // 而是使用transitionend事件来检测动画结束
                    
                } catch (e) {
                    console.error("照片合成过程中出错:", e);
                    
                    // 发出合成失败事件
                    const renderCompleteEvent = new CustomEvent('renderComplete', { 
                        detail: { success: false, error: e } 
                    });
                    polaroidCanvas.dispatchEvent(renderCompleteEvent);
                }
            };
            
            // 处理相框加载失败的情况，尝试继续处理而不是停止
            frameImg.onerror = function(e) {
                console.error("相框图片加载失败:", e);
                
                
                try {
                    // 在相框加载失败的情况下，只使用用户图片
                    ctx.clearRect(0, 0, polaroidCanvas.width, polaroidCanvas.height);
                    
                    // 绘制用户图片时留出边距，模拟相框效果，保持正方形比例
                    const padding = 20;
                    const imgWidth = polaroidCanvas.width - (padding * 2);
                    // 使图片区域接近正方形
                    const imgHeight = imgWidth; // 1:1 比例的正方形
                    
                    // 在canvas上绘制白色背景
                    ctx.fillStyle = 'white';
                    ctx.fillRect(0, 0, polaroidCanvas.width, polaroidCanvas.height);
                    
                    // 使用高质量的绘制模式
                    ctx.save();
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';
                    
                    // 绘制用户图片
                    drawImageProp(ctx, userImg, padding, padding, imgWidth, imgHeight);
                    ctx.restore();
                    
                    // 添加日期文本
                    // 格式化当前日期，例如 Mar.13.2025
                    const now = new Date();
                    const month = now.toLocaleString('en-US', { month: 'short' }); // Mar
                    const day = now.getDate(); // 13
                    const year = now.getFullYear(); // 完整年份，例如2025
                    const dateText = `${month}.${day}.${year}`;
                    
                    // 设置更大的字体大小
                    const fontSize = 68; // 固定字体大小为68px
                    
                    // 设置文本样式
                    ctx.save();
                    ctx.font = `${fontSize}px 'Homemade Apple', cursive, serif`; // 使用Homemade Apple字体，添加备用字体
                    ctx.fillStyle = "rgba(0, 0, 0, 0.8)"; // 稍微减小不透明度，使其更自然
                    ctx.textAlign = "center";
                    
                    // 在相框底部绘制日期 - 位置调整为相框底部留白区域
                    const textY = polaroidCanvas.height - 80; // 距离底部固定80像素
                    ctx.fillText(dateText, polaroidCanvas.width / 2, textY);
                    ctx.restore();
                    
                    // 获取照片数据 - 使用PNG格式以保持高分辨率和质量
                    currentPhotoDataURL = polaroidCanvas.toDataURL('image/png', 1.0);
                    
                    // 准备动画样式
                    if (polaroidContainer) {
                        // 完全重设所有样式，确保没有冲突
                        polaroidContainer.style.display = 'block';
                        polaroidContainer.style.backgroundColor = 'transparent';
                        polaroidContainer.style.padding = '0';
                        polaroidContainer.style.boxShadow = '0 3px 10px rgba(0,0,0,0.2)';
                        polaroidContainer.style.transition = 'none'; // 禁用任何过渡效果
                        
                        // 设置初始位置 - 相机内部
                        polaroidContainer.style.opacity = '0';
                        polaroidContainer.style.top = '-20px';
                        
                        // 移除所有可能的类
                        polaroidContainer.classList.remove('hidden');
                        polaroidContainer.classList.remove('animated');
                        
                        // 强制重排DOM，确保初始样式生效
                        void polaroidContainer.offsetWidth;
                        
                        // 设置动画过渡 - 显著延长时间使动画更加缓慢
                        polaroidContainer.style.transition = 'opacity 3s ease-out, top 6s ease-out';
                        
                        // 立即开始动画，无需等待
                        polaroidContainer.style.opacity = '1';
                        polaroidContainer.style.top = '40px';
                    }
                    
                    
                } catch(e2) {
                    console.error("在没有相框的情况下处理照片失败:", e2);
                    alert("Photo processing failed, please refresh the page and try again.");
                }
            };
            
            // 设置相框图片源
            frameImg.src = polaroidFramePath;
        };
        
        // 处理用户图片加载失败的情况
        userImg.onerror = function(e) {
            console.error("用户图片加载失败:", e);
            console.warn("图片加载失败，可能是由于跨域问题或文件格式不支持");
            
            // 创建替代的空白图像
            try {
                // 清除canvas
                ctx.clearRect(0, 0, polaroidCanvas.width, polaroidCanvas.height);
                
                // 绘制白色背景
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, polaroidCanvas.width, polaroidCanvas.height);
                
                // 绘制错误信息
                ctx.fillStyle = 'black';
                ctx.font = '20px Arial';
                ctx.textAlign = 'center';
                ctx.fillText('Image loading failed', polaroidCanvas.width/2, polaroidCanvas.height/2);
                ctx.fillText('Please upload again', polaroidCanvas.width/2, polaroidCanvas.height/2 + 30);
                
                // 保存错误信息作为当前照片数据 - 使用PNG格式
                currentPhotoDataURL = polaroidCanvas.toDataURL('image/png', 1.0);
            } catch(e2) {
                console.error("创建错误提示失败:", e2);
            }
            
            alert("Image loading failed, please upload again or choose another image.");
        };
        
        // 设置用户图片源
        userImg.src = userImageSrc;
        
        // 每次创建新照片时，重置自动保存标志
        autoSaveExecuted = false;
    }
    
    // 应用经典宝丽来拍立得风格滤镜效果
    function applyPolaroidFilter(ctx, width, height) {
        // 获取图像数据
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        
        // 创建查找表（LUT）用于色调映射
        const rLUT = new Uint8Array(256);
        const gLUT = new Uint8Array(256);
        const bLUT = new Uint8Array(256);
        
        // 初始化宝丽来风格的色调映射 - 降低亮度并减少黄色调
        for (let i = 0; i < 256; i++) {
            // 红色通道 - 轻微降低整体亮度，减少过度暖色调
            rLUT[i] = Math.min(255, Math.max(0, 
                i < 64 ? i * 0.95 : // 降低暗部红色
                i < 190 ? i * 1.02 : // 轻微提升中间调红色，但不要太多
                i * 0.95 // 压制高光红色，降低亮度
            ));
            
            // 绿色通道 - 降低绿色以减少黄色调
            gLUT[i] = Math.min(255, Math.max(0, 
                i < 50 ? i * 0.88 : // 降低暗部绿色
                i < 150 ? i * 0.92 : // 降低中间调绿色
                i * 0.95 // 降低高光绿色，减少黄色倾向
            ));
            
            // 蓝色通道 - 适度降低，但不要太多，保持一些蓝色以增加平衡
            bLUT[i] = Math.min(255, Math.max(0, 
                i < 80 ? i * 0.85 : // 适度降低暗部蓝色
                i < 160 ? i * 0.90 : // 轻微降低中间调蓝色
                i * 0.95 // 轻微降低高光蓝色
            ));
        }
        
        // 应用滤镜效果
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            
            // 应用LUT
            data[i] = rLUT[r];
            data[i + 1] = gLUT[g];
            data[i + 2] = bLUT[b];
            
            // 增加对比度 - 宝丽来照片对比度通常较高
            const brightness = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
            const contrast = 0.22; // 对比度强度增强
            
            data[i] = Math.min(255, Math.max(0, data[i] + (data[i] - 128) * contrast));
            data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + (data[i + 1] - 128) * contrast));
            data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + (data[i + 2] - 128) * contrast));
            
            // 宝丽来特有的暗部处理 - 提升暗部红色，降低暗部蓝色
            if (brightness < 0.40) {
                const warmShift = 0.10 * (1 - brightness * 2.5); // 越暗色调偏移越大
                data[i] = Math.min(255, data[i] + warmShift * 30); // 增加暗部红色
                data[i + 1] = Math.min(255, data[i + 1] + warmShift * 15); // 轻微增加暗部绿色
                data[i + 2] = Math.max(0, data[i + 2] - warmShift * 30); // 降低暗部蓝色
            }
            
            // 高光处理 - 更加柔和、自然的高光效果
            if (brightness > 0.75) { // 提高阈值，只影响更亮的部分
                const subtleHighlight = 0.08 * (brightness - 0.75) * 2.5; // 降低强度
                data[i] = Math.min(255, data[i] + subtleHighlight * 10); // 轻微增加高光红色
                data[i + 1] = Math.min(255, data[i + 1] + subtleHighlight * 8); // 更少增加高光绿色，减少黄色
            }
            
            // 轻微的交叉处理效果 - 降低强度，使整体效果更自然
            const crossAmount = 0.05; // 降低交叉处理强度
            
            // 整体降低亮度
            const darkeningFactor = 0.93; // 全局亮度降低约7%
            data[i] = Math.min(255, Math.max(0, data[i] * darkeningFactor));
            data[i + 1] = Math.min(255, Math.max(0, data[i + 1] * darkeningFactor));
            data[i + 2] = Math.min(255, Math.max(0, data[i + 2] * darkeningFactor));
            
            // 简化后的交叉处理，减少黄色
            if (brightness > 0.65) { // 提高亮部阈值
                // 更加有限的亮部处理，减少对绿色通道的增强
                data[i] = Math.min(255, data[i] * (1 + crossAmount * (brightness - 0.65)));
                // 仅轻微增加绿色，避免黄色过强
                data[i + 1] = Math.min(255, data[i + 1] * (1 + crossAmount * 0.4 * (brightness - 0.65)));
            }
        }
        
        // 添加富士胶片特有的增强颗粒感效果
        const grainAmount = 12; // 显著增强颗粒强度
        const grainDensity = 0.85; // 增加颗粒覆盖密度（更低的值表示更多像素受影响）
        
        for (let i = 0; i < data.length; i += 4) {
            // 计算基于亮度的颗粒效果
            const pixelBrightness = (data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114) / 255;
            
            // 在暗部应用更多颗粒，在亮部应用较少颗粒（模拟真实胶片）
            const brightnessFactor = pixelBrightness < 0.5 ? 
                1.3 - pixelBrightness * 0.6 : // 暗部有更强的颗粒
                0.8 - pixelBrightness * 0.3;  // 亮部有较弱的颗粒
                
            // 随机决定是否对该像素应用颗粒，增加密度
            if (Math.random() > grainDensity) {
                // 根据亮度调整颗粒强度，暗部强，亮部弱
                const localGrainAmount = grainAmount * brightnessFactor;
                
                // 生成稍微相关的颗粒值，使颗粒感看起来更自然
                const baseGrain = (Math.random() - 0.5) * localGrainAmount;
                
                // 为不同通道应用略微不同的颗粒，创造更自然的胶片感
                const redGrain = baseGrain * 0.9 + (Math.random() - 0.5) * 2;
                const greenGrain = baseGrain * 0.85 + (Math.random() - 0.5) * 2;
                const blueGrain = baseGrain * 1.2 + (Math.random() - 0.5) * 3; // 蓝色通道颗粒更强
                
                data[i] = Math.min(255, Math.max(0, data[i] + redGrain));
                data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + greenGrain));
                data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + blueGrain));
            }
        }
        
        // 将处理后的图像数据放回canvas
        ctx.putImageData(imageData, 0, 0);
    }
    
    // 绘制图片并保持比例（类似于object-fit: cover）
    function drawImageProp(ctx, img, x, y, w, h) {
        // 默认值
        if (typeof x !== 'number') x = 0;
        if (typeof y !== 'number') y = 0;
        if (typeof w === 'undefined') w = ctx.canvas.width;
        if (typeof h === 'undefined') h = ctx.canvas.height;
        
        // 计算缩放比例
        const imgRatio = img.width / img.height;
        const containerRatio = w / h;
        
        let newW, newH, offsetX, offsetY;
        
        // 根据比例决定如何裁剪
        if (containerRatio > imgRatio) {
            newW = w;
            newH = w / imgRatio;
            offsetX = 0;
            offsetY = (h - newH) / 2;
        } else {
            newH = h;
            newW = h * imgRatio;
            offsetX = (w - newW) / 2;
            offsetY = 0;
        }
        
        // 绘制图片
        ctx.drawImage(img, x + offsetX, y + offsetY, newW, newH);
    }
    
    // 重置相机
    function resetCamera() {
        
        
        // 完全隐藏相框元素
        polaroidContainer.classList.remove('animated');
        polaroidContainer.style.transition = 'none'; // 禁用过渡动画
        polaroidContainer.style.display = 'none';
        polaroidContainer.style.opacity = '0';
        polaroidContainer.style.top = '-20px';
        
        // 立即清除canvas和重置状态
        const ctx = polaroidCanvas.getContext('2d');
        ctx.clearRect(0, 0, polaroidCanvas.width, polaroidCanvas.height);
        
        // 显示空白相框
        displayEmptyFrame();
        
        // 清除当前照片数据
        currentPhotoDataURL = null;
        
        // 确保前层图片仍然可见
        const cameraFrontLayer = document.querySelector('.camera-front-layer');
        if (cameraFrontLayer) {
            cameraFrontLayer.style.display = 'block';
        }
        
        
    }
    
    // 显示空白相框
    function displayEmptyFrame() {
        const emptyFrame = new Image();
        emptyFrame.onload = function() {
            const ctx = polaroidCanvas.getContext('2d');
            ctx.drawImage(emptyFrame, 0, 0, polaroidCanvas.width, polaroidCanvas.height);
            
        };
        emptyFrame.src = polaroidFramePath;
    }
    
    // saveCurrentPhoto方法已移除，现在由transitionend事件触发自动保存
    
    // 捕获Canvas内容为图像
    function captureCanvasAsImage() {
        try {
            
            
            // 创建一个新的img元素
            const img = document.createElement('img');
            
            // 设置图像显示尺寸
            img.width = polaroidCanvas.width;
            img.height = polaroidCanvas.height;
            img.alt = '拍立得照片';
            
            // 尝试直接从Canvas获取最新图像
            try {
                const canvasDataURL = polaroidCanvas.toDataURL('image/png', 1.0);
                
                img.src = canvasDataURL;
                return img;
            } catch (err) {
                
                // 使用已存储的图片URL作为备选
                if (currentPhotoDataURL) {
                    img.src = currentPhotoDataURL;
                    return img;
                }
            }
            
            // 如果没有可用的图片URL，显示错误
            console.error("没有有效的照片数据可用于捕获");
            return null;
        } catch (e) {
            console.error("捕获canvas内容失败:", e);
            return null;
        }
    }
    
    // 公开API
    return {
        init: init,
        resetCamera: resetCamera,
        createPolaroidPhoto: createPolaroidPhoto
    };
})();