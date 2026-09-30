/**
 * 商家版浅色主题：onShow 切 light 导航栏，onHide/onUnload 恢复 C 端 dark。
 */
const { applyTheme } = require('./theme.js');

function merchantPageShow() {
  applyTheme('light');
}

function merchantPageRestore() {
  applyTheme('dark');
}

module.exports = { merchantPageShow, merchantPageRestore };
