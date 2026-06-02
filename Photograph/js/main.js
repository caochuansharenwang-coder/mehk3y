/**
 * 拍立得照片生成器 - 主入口文件
 * 负责初始化和协调各个模块
 */

// 等待DOM加载完成后初始化应用
document.addEventListener('DOMContentLoaded', function() {
    
    // 预加载移动端功能模块到全局变量
    const loadMobileFeatures = async () => {
        try {
            const mobileFeatures = await import('./utils/mobileFeatures.js');
            window.mobileFeatures = mobileFeatures;
            console.log('移动端功能模块加载成功');
        } catch (error) {
            console.warn('移动端功能模块加载失败:', error);
        }
    };
    
    // 预加载Homemade Apple字体，确保日期文本能正常显示
    const fontLoader = async () => {
        
        try {
            // 尝试加载字体
            const font = new FontFace(
                'Homemade Apple', 
                `url(https://fonts.gstatic.com/s/homemadeapple/v18/Qw3EZQFXECDrI2q789EKQZJob0x6XHg.woff2)`
            );
            
            // 等待字体加载
            await font.load();
            
            // 将字体添加到文档
            document.fonts.add(font);
            
        } catch (err) {
            console.warn("字体加载失败，使用备用字体:", err);
        }
    };
    
    // 并行加载字体和移动端功能模块，然后初始化应用
    Promise.all([fontLoader(), loadMobileFeatures()]).then(() => {
        // 初始化核心模块
        PolaroidCore.init();
        
        // 初始化照片墙
        PhotoWall.init();
        
        // 初始化UI交互
        UIController.init();
    });
});