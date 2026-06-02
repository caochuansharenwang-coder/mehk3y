/**
 * 拍立得照片生成器 - 工具函数模块
 * 提供各种辅助功能和公共方法
 */

const Utils = (function() {
    /**
     * 生成随机ID
     * @param {number} length - ID长度
     * @returns {string} - 随机ID
     */
    function generateRandomId(length = 8) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let id = '';
        for (let i = 0; i < length; i++) {
            id += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return id;
    }
    
    /**
     * 防抖函数
     * @param {Function} func - 要执行的函数
     * @param {number} wait - 等待时间（毫秒）
     * @returns {Function} - 防抖后的函数
     */
    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), wait);
        };
    }
    
    /**
     * 节流函数
     * @param {Function} func - 要执行的函数
     * @param {number} limit - 限制时间（毫秒）
     * @returns {Function} - 节流后的函数
     */
    function throttle(func, limit) {
        let inThrottle;
        return function(...args) {
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }
    
    /**
     * 格式化日期时间
     * @param {Date} date - 日期对象
     * @param {string} format - 格式字符串
     * @returns {string} - 格式化后的日期字符串
     */
    function formatDateTime(date, format = 'YYYY-MM-DD HH:mm:ss') {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        
        return format
            .replace('YYYY', year)
            .replace('MM', month)
            .replace('DD', day)
            .replace('HH', hours)
            .replace('mm', minutes)
            .replace('ss', seconds);
    }
    
    /**
     * 下载数据URL为文件
     * @param {string} dataURL - 数据URL
     * @param {string} fileName - 文件名
     */
    function downloadDataURL(dataURL, fileName) {
        const link = document.createElement('a');
        link.href = dataURL;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    
    /**
     * 播放音效
     * @param {string} soundSrc - 音效文件路径
     * @returns {Promise} - 完成播放的Promise
     */
    function playSound(soundSrc) {
        return new Promise((resolve, reject) => {
            try {
                const audio = new Audio(soundSrc);
                audio.onended = resolve;
                audio.onerror = reject;
                audio.play().catch(reject);
            } catch (error) {
                reject(error);
            }
        });
    }
    
    /**
     * 深度克隆对象
     * @param {Object} obj - 要克隆的对象
     * @returns {Object} - 克隆后的对象
     */
    function deepClone(obj) {
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }
        
        if (obj instanceof Date) {
            return new Date(obj.getTime());
        }
        
        if (obj instanceof Array) {
            return obj.map(item => deepClone(item));
        }
        
        if (obj instanceof Object) {
            const copy = {};
            Object.keys(obj).forEach(key => {
                copy[key] = deepClone(obj[key]);
            });
            return copy;
        }
        
        throw new Error('Unable to copy obj! Its type is not supported.');
    }
    
    /**
     * 随机生成指定范围的数字
     * @param {number} min - 最小值
     * @param {number} max - 最大值
     * @returns {number} - 随机数
     */
    function randomNumber(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    
    /**
     * 检测设备类型
     * @returns {Object} - 设备信息
     */
    function detectDevice() {
        const userAgent = navigator.userAgent.toLowerCase();
        const isMobile = /mobile|android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
        const isTablet = /(ipad|tablet|playbook|silk)|(android(?!.*mobile))/i.test(userAgent);
        const isDesktop = !isMobile && !isTablet;
        
        return {
            isMobile,
            isTablet,
            isDesktop,
            isIOS: /iphone|ipad|ipod/i.test(userAgent),
            isAndroid: /android/i.test(userAgent),
            isSafari: /safari/i.test(userAgent) && !/chrome/i.test(userAgent)
        };
    }
    
    // 公开API
    return {
        generateRandomId,
        debounce,
        throttle,
        formatDateTime,
        downloadDataURL,
        playSound,
        deepClone,
        randomNumber,
        detectDevice
    };
})();