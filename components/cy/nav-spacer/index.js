// cy-nav-spacer · 配合 cy-nav-bar(fixed)的等高占位:状态栏+返回行,内容从它下面开始。
// 不用 --cy-safe-top(env() 在模拟器取不到会塌矮),直接读 globalData 实测高度。
const app = getApp();
Component({
  data: {
    h: (app.globalData.statusBarHeight || 44) + (app.globalData.navBarHeight || 44),
  },
});
