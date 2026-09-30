/**
 * behaviors/exit-motion.js —— 浮层退场动画(2026-08-21)
 *
 * 解决的问题:`wx:if="{{show}}"` 直连外部 show,关闭时组件瞬间卸载,退场动画根本没机会播。
 * 做法:组件内部另立 `_render` 控卸载 —— show 置 false 时先挂 `_closing`(调用方在 wxml 里
 * 拼成自己的 --closing 类,由 wxss 接退场 keyframes),定时器到点才把 _render 置 false。
 *
 * ⚠️ exitMs 是 WXSS 里退场动画时长的 JS 镜像(WXSS 变量 JS 读不到,只能两处各留一份)。
 * 两处漂移会让「动画没播完就卸载」或「播完还多等一拍」,由 sheet-modal-exit-motion-contract
 * 从 tokens.wxss 反解数值来判红 —— 改时长务必两处同步。
 *
 * ⚠️ 退场必须比进场快:DS 文档3 §B.1「上限 ~300ms;进场慢、退场快(exit 比 enter 快 ~20%)」。
 * 所以 sheet 进场 slow(350)/退场 standard(220)、modal 进场 standard(220)/退场 fast(140),
 * 不新造 token,直接降一档。
 *
 * 依赖:宿主组件必须也挂 behaviors/reduced-motion.js —— 减动效下直接卸载不空等。
 *
 * @param {number} exitMs 退场动画时长(毫秒),必须等于 wxss 里那条 --cy-motion-* 的值
 */
module.exports = function exitMotion(exitMs) {
  return Behavior({
    data: {
      _render: false,
      _closing: false,
    },
    observers: {
      show(value) {
        if (value) {
          // 退场播到一半又被打开:撤掉待卸载的定时器,否则它会把刚开的面板关掉
          if (this._exitTimer) { clearTimeout(this._exitTimer); this._exitTimer = null; }
          this.setData({ _render: true, _closing: false });
          return;
        }
        if (!this.data._render) return;   // 本来就没渲染,不必播退场
        if (this.data.reducedMotion) { this.setData({ _render: false, _closing: false }); return; }
        this.setData({ _closing: true });
        this._exitTimer = setTimeout(() => {
          this._exitTimer = null;
          this.setData({ _render: false, _closing: false });
        }, exitMs);
      },
    },
    lifetimes: {
      detached() {
        if (this._exitTimer) { clearTimeout(this._exitTimer); this._exitTimer = null; }
      },
    },
  });
};
