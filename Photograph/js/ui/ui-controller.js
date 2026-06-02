/**
 * 拍立得照片生成器 - UI控制器模块
 * 负责处理用户界面交互和相机功能
 */

const UIController = (function() {
    // 初始化函数
    function init() {
        
        
        // 相机功能实现
        initCameraInterface();
        
        
    }
    
    // 初始化相机接口
    function initCameraInterface() {
        const cameraBtn = document.getElementById('cameraBtn');
        const cameraInterface = document.getElementById('cameraInterface');
        const closeCameraBtn = document.getElementById('closeCameraBtn');
        const cameraPreview = document.getElementById('cameraPreview');
        const takePhotoBtn = document.getElementById('takePhotoBtn');
        const switchCameraBtn = document.getElementById('switchCameraBtn');
        const deviceInfo = document.getElementById('deviceInfo');
        
        // 当前相机模式: 'user' 前置摄像头, 'environment' 后置摄像头
        let currentFacingMode = 'user';
        
        // 检查元素是否存在
        if (!cameraBtn || !cameraInterface) {
            console.error("相机界面元素缺失，无法初始化相机功能");
            return;
        }
        
        // 打开相机界面
        cameraBtn?.addEventListener('click', function() {
            
            if (cameraInterface) {
                cameraInterface.classList.add('active');
                
                // 初始化相机流
                initCameraStream(cameraPreview, deviceInfo, currentFacingMode);
            }
        });
        
        // 关闭相机界面
        closeCameraBtn?.addEventListener('click', function() {
            
            if (cameraInterface) {
                cameraInterface.classList.remove('active');
                
                // 停止相机流
                stopCameraStream(cameraPreview);
            }
        });
        
        // 拍照按钮
        takePhotoBtn?.addEventListener('click', function() {
            
            if (cameraPreview && cameraPreview.srcObject) {
                takePhoto(cameraPreview, currentFacingMode);
            } else {
                console.error("相机预览未初始化，无法拍照");
                alert("Camera not ready, please try again in a moment.");
            }
        });
        
        // 切换摄像头按钮
        switchCameraBtn?.addEventListener('click', function() {
            if (cameraPreview && cameraPreview.srcObject) {
                // 切换摄像头
                currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
                
                // 停止当前相机流
                stopCameraStream(cameraPreview);
                
                // 使用新的模式初始化相机
                initCameraStream(cameraPreview, deviceInfo, currentFacingMode);
            }
        });
    }
    
    // 初始化相机 - 完全针对iOS设备优化的拍照体验
    function initCameraStream(videoElement, infoElement, facingMode = 'user') {
        if (!videoElement) return;
        
        // 显示加载状态
        const loadingElement = document.getElementById('cameraLoading');
        if (loadingElement) loadingElement.style.display = 'flex';
        
        // 特别处理：清除任何之前可能存在的滤镜覆盖层
        const existingOverlay = document.getElementById('filter-overlay');
        if (existingOverlay && existingOverlay.parentNode) {
            existingOverlay.parentNode.removeChild(existingOverlay);
        }
        
        // 检测是否为iOS设备和WebView环境
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        const isWebView = window.navigator.standalone !== undefined || 
                         window.matchMedia('(display-mode: standalone)').matches ||
                         /WebView|wkwebview|UIWebView/.test(navigator.userAgent) ||
                         (window.webkit && window.webkit.messageHandlers);
        
        if (isIOS) {
            console.log("iOS设备检测到");
            if (isWebView) {
                console.log("WebView环境检测到，使用WebView专用相机模式");
            } else {
                console.log("Safari浏览器环境，使用iOS专用拍照模式");
            }
        }
        
        // 尝试获取用户媒体设备
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            try {
                // 针对不同环境的拍照约束优化
                let constraints;
                
                if (isIOS && isWebView) {
                    // WebView环境：使用最保守的设置避免直播模式
                    constraints = { 
                        video: { 
                            facingMode: facingMode, // WebView中使用简单模式
                            // WebView环境使用较低分辨率确保兼容性
                            width: { ideal: 1280, max: 1280 },
                            height: { ideal: 720, max: 720 }
                            // 完全避免frameRate设置，让WebView自动选择最佳模式
                        },
                        audio: false 
                    };
                    console.log("使用WebView优化约束");
                } else if (isIOS) {
                    // Safari环境：使用高质量拍照设置
                    constraints = { 
                        video: { 
                            facingMode: { ideal: facingMode },
                            width: { ideal: 1920, max: 1920 },
                            height: { ideal: 1080, max: 1080 }
                            // Safari中完全移除frameRate
                        },
                        audio: false 
                    };
                    console.log("使用Safari iOS优化约束");
                } else {
                    // 非iOS设备：标准设置
                    constraints = { 
                        video: { 
                            facingMode: { ideal: facingMode },
                            width: { ideal: 1280, max: 1920 },
                            height: { ideal: 720, max: 1080 },
                            frameRate: { ideal: 15 }
                        },
                        audio: false 
                    };
                }
                
                // 根据环境请求用户媒体
                navigator.mediaDevices.getUserMedia(constraints)
                    .then(stream => {
                        // 设置流
                        videoElement.srcObject = stream;
                        
                        // 禁用自动播放直到完全加载
                        videoElement.autoplay = false;
                        
                        // 确保视频元素尺寸稳定
                        videoElement.style.width = '100%';
                        videoElement.style.height = '100%';
                        videoElement.style.objectFit = 'cover';
                        
                        // 只有在使用前置摄像头时应用镜像效果
                        if (facingMode === 'user') {
                            videoElement.style.transform = 'scaleX(-1)';
                        } else {
                            videoElement.style.transform = 'scaleX(1)';
                        }
                        
                        // 显示当前使用的相机信息
                        if (infoElement) {
                            infoElement.textContent = facingMode === 'user' ? 
                                'Using front camera' : 'Using back camera';
                        }
                        
                        // 视频元素加载元数据后执行
                        videoElement.onloadedmetadata = function() {
                            // 延迟启动播放，让相机稳定
                            setTimeout(() => {
                                // 应用滤镜效果
                                applyFilterToPreview(videoElement);
                                
                                // 开始播放
                                videoElement.play()
                                    .then(() => {
                                        // 隐藏加载状态
                                        if (loadingElement) loadingElement.style.display = 'none';
                                    })
                                    .catch(playError => {
                                        console.error("播放相机流失败:", playError);
                                        if (loadingElement) loadingElement.textContent = "Camera error: " + playError.message;
                                    });
                            }, 300); // 短暂延迟让设备稳定
                        };
                    })
                    .catch(error => {
                        console.error("相机初始化失败:", error);
                        
                        // 如果是因为设备没有指定的摄像头（比如某些设备没有前置摄像头）
                        if (error.name === 'OverconstrainedError' || error.name === 'ConstraintNotSatisfiedError') {
                            // 环境兼容的回退约束
                            let fallbackConstraints;
                            
                            if (isIOS && isWebView) {
                                // WebView回退：最基本设置
                                fallbackConstraints = {
                                    video: {
                                        facingMode: facingMode,
                                        width: { ideal: 640, max: 1280 },
                                        height: { ideal: 480, max: 720 }
                                        // WebView回退完全不设置frameRate
                                    },
                                    audio: false
                                };
                                console.log("使用WebView回退约束");
                            } else if (isIOS) {
                                // iOS Safari回退
                                fallbackConstraints = {
                                    video: {
                                        facingMode: facingMode,
                                        width: { ideal: 1280, max: 1920 },
                                        height: { ideal: 720, max: 1080 }
                                        // iOS Safari回退不设置frameRate
                                    },
                                    audio: false
                                };
                                console.log("使用iOS Safari回退约束");
                            } else {
                                // 非iOS回退
                                fallbackConstraints = {
                                    video: {
                                        facingMode: facingMode,
                                        width: { ideal: 960, max: 1280 },
                                        height: { ideal: 540, max: 720 },
                                        frameRate: { ideal: 15 }
                                    },
                                    audio: false
                                };
                            }
                            
                            // 显示回退信息
                            if (loadingElement) loadingElement.textContent = "Trying alternative camera settings...";
                            
                            // 尝试使用回退设置
                            navigator.mediaDevices.getUserMedia(fallbackConstraints)
                                .then(stream => {
                                    videoElement.srcObject = stream;
                                    videoElement.autoplay = false;
                                    videoElement.style.width = '100%';
                                    videoElement.style.height = '100%';
                                    videoElement.style.objectFit = 'cover';
                                    
                                    // 应用适当的变换
                                    if (facingMode === 'user') {
                                        videoElement.style.transform = 'scaleX(-1)';
                                    } else {
                                        videoElement.style.transform = 'scaleX(1)';
                                    }
                                    
                                    // 显示摄像头信息
                                    if (infoElement) {
                                        infoElement.textContent = facingMode === 'user' ? 
                                            'Using front camera (fallback)' : 'Using back camera (fallback)';
                                    }
                                    
                                    videoElement.onloadedmetadata = function() {
                                        setTimeout(() => {
                                            applyFilterToPreview(videoElement);
                                            videoElement.play()
                                                .then(() => {
                                                    if (loadingElement) loadingElement.style.display = 'none';
                                                })
                                                .catch(playError => {
                                                    console.error("回退相机播放失败:", playError);
                                                    if (loadingElement) loadingElement.textContent = "Camera error: " + playError.message;
                                                });
                                        }, 300);
                                    };
                                })
                                .catch(fallbackError => {
                                    console.error("回退相机初始化也失败:", fallbackError);
                                    if (loadingElement) loadingElement.textContent = "Camera access failed: " + fallbackError.message;
                                    alert("Cannot access camera: " + fallbackError.message);
                                });
                        } else {
                            // 其他错误
                            if (loadingElement) loadingElement.textContent = "Camera access failed: " + error.message;
                            alert("Cannot access camera: " + error.message);
                        }
                    });
            } catch (error) {
                console.error("相机请求错误:", error);
                if (loadingElement) loadingElement.textContent = "Camera request error";
                alert("Error requesting camera: " + (error.message || "Unknown error"));
            }
        } else {
            console.error("浏览器不支持getUserMedia");
            if (loadingElement) loadingElement.textContent = "Your browser doesn't support camera";
            alert("Your browser does not support camera functionality.");
        }
    }
    
    // 停止相机流 - 特别优化iOS设备释放相机资源
    function stopCameraStream(videoElement) {
        if (videoElement && videoElement.srcObject) {
            // 检测是否为iOS设备
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
            
            // 对于iOS设备，先暂停视频元素
            if (isIOS && !videoElement.paused) {
                try {
                    videoElement.pause();
                } catch (e) {
                    console.log("无法暂停视频元素");
                }
            }
            
            const stream = videoElement.srcObject;
            const tracks = stream.getTracks();
            
            // 优化的释放资源流程
            tracks.forEach(track => {
                if (track.enabled) track.enabled = false; // 先禁用
                track.stop(); // 然后停止
            });
            
            // 彻底清除视频源
            videoElement.srcObject = null;
            
            // iOS设备额外清理
            if (isIOS) {
                videoElement.load(); // 重置视频元素状态
            }
            
            // 移除滤镜覆盖层
            const overlay = document.getElementById('filter-overlay');
            if (overlay && overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
            
            
        }
    }
    
    // 真正的iOS拍照模式：使用适合iOS的方式调用拍照而非直播
    function takePhoto(videoElement, facingMode = 'user') {
        if (!videoElement || !videoElement.srcObject) {
            console.error("视频元素或流不可用");
            return;
        }
        
        // 检测是否为iOS设备
        const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        
        // 针对iOS设备的特殊处理：暂停视频避免直播模式
        try {
            videoElement.pause();
        } catch (e) {
            console.log("无法暂停视频流，继续拍照");
        }
        
        // 检测环境并选择最佳拍照策略
        const detectiOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        const detectWebView = window.navigator.standalone !== undefined || 
                         window.matchMedia('(display-mode: standalone)').matches ||
                         /WebView|wkwebview|UIWebView/.test(navigator.userAgent) ||
                         (window.webkit && window.webkit.messageHandlers);
        
        if (detectiOS && detectWebView) {
            // WebView环境：使用特殊优化
            console.log("使用WebView专用拍照模式");
            if (facingMode === 'user') {
                // WebView前置相机：最小延迟
                showCountdown(1, () => {
                    showFlashAndCapture(videoElement, facingMode, 'webview');
                });
            } else {
                // WebView后置相机：立即拍照
                showFlashAndCapture(videoElement, facingMode, 'webview');
            }
        } else if (detectiOS) {
            // Safari iOS环境：标准iOS优化
            console.log("使用Safari iOS专用拍照模式");
            if (facingMode === 'user') {
                showCountdown(2, () => {
                    showFlashAndCapture(videoElement, facingMode, 'ios');
                });
            } else {
                showFlashAndCapture(videoElement, facingMode, 'ios');
            }
        } else {
            // 非iOS设备：标准流程
            if (facingMode === 'user') {
                showCountdown(3, () => {
                    showFlashAndCapture(videoElement, facingMode, false);
                });
            } else {
                showFlashAndCapture(videoElement, facingMode, false);
            }
        }
    }
    
    // 显示闪光效果并拍照 - 支持多种模式
    function showFlashAndCapture(videoElement, facingMode, mode = false) {
        // 显示闪光效果
        const flashEffect = document.createElement('div');
        flashEffect.className = 'flash-effect';
        document.querySelector('.camera-preview-container').appendChild(flashEffect);
        
        // 根据模式调整闪光效果持续时间
        let flashDuration = 600; // 默认
        if (mode === 'webview') {
            flashDuration = 300; // WebView最短
        } else if (mode === 'ios') {
            flashDuration = 400; // iOS中等
        }
        
        setTimeout(() => {
            flashEffect.remove();
        }, flashDuration);
        
        // 根据环境选择拍照模式
        if (mode === 'webview') {
            console.log("使用WebView专用拍照捕获模式");
            captureImageForWebView(videoElement, facingMode);
        } else if (mode === 'ios') {
            console.log("使用iOS Safari专用拍照捕获模式");
            captureImageForIOS(videoElement, facingMode);
        } else {
            // 标准拍照模式
            captureImage(videoElement, facingMode);
        }
    }
    
    // 显示倒计时
    function showCountdown(seconds, callback) {
        // 获取倒计时显示元素
        const countdownDisplay = document.getElementById('countdownDisplay');
        if (!countdownDisplay) {
            console.error("倒计时显示元素不存在");
            if (typeof callback === 'function') callback();
            return;
        }
        
        // 显示当前秒数
        countdownDisplay.textContent = seconds;
        countdownDisplay.style.display = 'block';
        
        // 添加脉冲动画效果
        countdownDisplay.classList.add('pulse');
        
        // 倒计时逻辑
        if (seconds > 1) {
            setTimeout(() => {
                // 移除动画效果，准备下一次动画
                countdownDisplay.classList.remove('pulse');
                
                // 继续倒计时
                setTimeout(() => {
                    showCountdown(seconds - 1, callback);
                }, 200);
            }, 800);
        } else {
            // 最后一秒
            setTimeout(() => {
                // 隐藏倒计时显示
                countdownDisplay.style.display = 'none';
                
                // 执行回调
                if (typeof callback === 'function') {
                    callback();
                }
            }, 1000);
        }
    }
    
    // 隐藏倒计时
    function hideCountdown() {
        const countdownDisplay = document.getElementById('countdownDisplay');
        if (countdownDisplay) {
            countdownDisplay.style.display = 'none';
        }
    }
    
    // 通用拍照功能：捕获高质量静态图像
    function captureImage(videoElement, facingMode = 'user') {
        // 创建一个临时canvas
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        
        // 设置canvas尺寸为视频的实际尺寸
        canvas.width = videoElement.videoWidth || 1280; // 默认标准质量
        canvas.height = videoElement.videoHeight || 720;
        
        // 根据摄像头类型决定是否应用镜像效果
        if (facingMode === 'user') {
            // 前置摄像头需要镜像
            context.translate(canvas.width, 0);
            context.scale(-1, 1);
        }
        
        // 标准绘制设置
        context.imageSmoothingEnabled = true;
        
        // 绘制视频帧到canvas
        context.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
        
        // 获取图像数据
        try {
            // 使用png格式确保兼容性
            const imageData = canvas.toDataURL('image/png', 0.9);
            
            // 检查屏幕宽度
            const screenWidth = window.innerWidth;
            
            // 如果是小屏幕并且有已存在的照片和下载按钮，先移除下载按钮
            if (screenWidth <= 1000) {
                const existingBtn = document.getElementById('smallScreenDownloadBtn');
                if (existingBtn) {
                    existingBtn.remove();
                }
            }
            
            // 延迟0.8秒后关闭相机界面，以便用户能完整看到闪光效果
            setTimeout(() => {
                // 关闭相机界面
                const cameraInterface = document.getElementById('cameraInterface');
                if (cameraInterface) {
                    cameraInterface.classList.remove('active');
                }
                
                // 停止相机流
                stopCameraStream(videoElement);
                
                // 创建拍立得照片
                PolaroidCore.createPolaroidPhoto(imageData);
            }, 800);
            
        } catch (error) {
            console.error("图像捕获失败:", error);
            alert("Failed to take photo, please try again.");
        }
    }
    
    // 新增：专为WebView环境优化的拍照捕获功能
    function captureImageForWebView(videoElement, facingMode = 'user') {
        // 创建一个临时canvas
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        
        // WebView环境：使用保守的分辨率设置确保兼容性
        canvas.width = videoElement.videoWidth || 1280; // 中等质量避免WebView限制
        canvas.height = videoElement.videoHeight || 720;
        
        // 根据摄像头类型决定是否应用镜像效果
        if (facingMode === 'user') {
            context.translate(canvas.width, 0);
            context.scale(-1, 1);
        }
        
        // WebView环境：使用基本绘制设置确保稳定性
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'medium'; // 中等质量避免性能问题
        
        // 绘制视频帧到canvas
        context.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
        
        // WebView环境：获取稳定的图像数据
        try {
            // 使用PNG格式确保WebView兼容性
            const imageData = canvas.toDataURL('image/png', 0.8);
            
            // 检查屏幕宽度
            const webViewScreenWidth = window.innerWidth;
            
            if (webViewScreenWidth <= 1000) {
                const existingBtn = document.getElementById('smallScreenDownloadBtn');
                if (existingBtn) {
                    existingBtn.remove();
                }
            }
            
            // WebView环境：使用最短延迟避免界面卡顿
            setTimeout(() => {
                const cameraInterface = document.getElementById('cameraInterface');
                if (cameraInterface) {
                    cameraInterface.classList.remove('active');
                }
                
                stopCameraStream(videoElement);
                
                console.log("使用WebView优化模式创建照片");
                PolaroidCore.createPolaroidPhoto(imageData);
            }, 400); // WebView使用最短延迟
            
        } catch (error) {
            console.error("WebView图像捕获失败:", error);
            alert("拍照失败，请重试");
        }
    }
    
    // 专为iOS Safari优化的拍照捕获功能
    function captureImageForIOS(videoElement, facingMode = 'user') {
        // 创建一个临时canvas
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        
        // iOS拍照优化：设置canvas尺寸为视频的实际尺寸，使用更高分辨率
        canvas.width = videoElement.videoWidth || 1920; // 默认高质量
        canvas.height = videoElement.videoHeight || 1080;
        
        // 根据摄像头类型决定是否应用镜像效果
        if (facingMode === 'user') {
            // 前置摄像头需要镜像
            context.translate(canvas.width, 0);
            context.scale(-1, 1);
        }
        
        // iOS拍照优化：使用高质量绘制设置
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        
        // 绘制视频帧到canvas - 使用iOS优化的绘制方法
        context.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
        
        // iOS拍照优化：获取高质量图像数据
        try {
            // 使用jpeg格式和高质量设置，更适合iOS拍照
            const imageData = canvas.toDataURL('image/jpeg', 0.95);
            
            // 检查屏幕宽度
            const iosScreenWidth = window.innerWidth;
            
            // 如果是小屏幕并且有已存在的照片和下载按钮，先移除下载按钮
            if (iosScreenWidth <= 1000) {
                const existingBtn = document.getElementById('smallScreenDownloadBtn');
                if (existingBtn) {
                    existingBtn.remove();
                }
            }
            
            // iOS优化：使用较短的延迟时间提升用户体验
            setTimeout(() => {
                // 关闭相机界面
                const cameraInterface = document.getElementById('cameraInterface');
                if (cameraInterface) {
                    cameraInterface.classList.remove('active');
                }
                
                // 停止相机流 - 彻底释放iOS相机资源
                stopCameraStream(videoElement);
                
                // 创建拍立得照片
                console.log("使用iOS优化模式创建照片");
                PolaroidCore.createPolaroidPhoto(imageData);
            }, 600); // iOS使用较短的延迟
            
        } catch (error) {
            console.error("图像捕获失败:", error);
            alert("Failed to take photo, please try again.");
        }
    }
    
    
    // 应用滤镜效果到相机预览 - 使用CSS滤镜代替Canvas处理以提高性能
    function applyFilterToPreview(videoElement) {
        // 使用CSS滤镜代替实时Canvas处理，减少性能开销
        if (videoElement) {
            // 应用CSS滤镜到视频元素
            videoElement.style.filter = 'contrast(110%) brightness(95%) saturate(95%) sepia(15%)';
            
            // 视频首次播放时稳定调整
            let firstPlayHandler = function() {
                // 创建一个静态的滤镜覆盖层，不进行实时更新
                if (!document.getElementById('filter-overlay')) {
                    // 创建覆盖层
                    const overlay = document.createElement('div');
                    overlay.id = 'filter-overlay';
                    overlay.style.position = 'absolute';
                    overlay.style.top = '0';
                    overlay.style.left = '0';
                    overlay.style.width = '100%';
                    overlay.style.height = '100%';
                    overlay.style.pointerEvents = 'none';
                    overlay.style.zIndex = '2';
                    
                    // 使用简单的背景色叠加而不是实时图像处理
                    overlay.style.backgroundColor = 'rgba(65, 105, 155, 0.15)'; // 轻微的蓝色调
                    overlay.style.mixBlendMode = 'overlay';
                    
                    // 添加到视频容器
                    const container = videoElement.parentElement;
                    if (container) {
                        container.style.position = 'relative';
                        container.appendChild(overlay);
                    }
                }
                
                // 移除事件监听器，确保只执行一次
                videoElement.removeEventListener('playing', firstPlayHandler);
            };
            
            // 当视频开始播放时执行一次性设置
            videoElement.addEventListener('playing', firstPlayHandler, false);
        }
    }
    
    // 公开API
    return {
        init: init
    };
})();