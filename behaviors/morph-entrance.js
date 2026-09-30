/**
 * behaviors/morph-entrance.js —— 弹窗 morph 进出场(2026-08-26)
 *
 * 面板从**触发它的那个元素**的位置长出来、关闭时缩回去,而不是整块从屏幕外上下滑。
 * 参考稿 x.com/anshpng/status/2092095630554394709(顶栏版,这里是底部镜像)。
 *
 * 宿主传 anchor-selector 才启用;不传则本 behavior 的 observers 全部提前返回,
 * 一个 setData 都不发。
 *
 * ## 依赖(宿主必须同时挂)
 *   · behaviors/exit-motion.js   —— 提供 _render / _closing
 *   · behaviors/reduced-motion.js —— 提供 reducedMotion
 * 少挂任何一个,退场和减动效分支都会失效。
 *
 * ## 为什么抽成 behavior
 * cy-sheet 和 cy-publish-sheet 各自实现过一遍,改一次 FLIP 算法要动 2 个 js + 2 个 wxss
 * + 1 个测试(Shotgun Surgery 已实际发生两次:去掉写死 .92 那次、修「收回停一下」那次)。
 * 本仓 exit-motion.js 就是同形状的工厂式 behavior 先例。
 *
 * @param {object}  opts
 * @param {string}  opts.shellSelector 承载变换的元素选择器(组件内作用域)
 * @param {boolean} opts.radius        起点是否输出 border-radius。
 *   ⚠️ 只有当承载变换的元素**自己带背景**时才置 true。cy-publish-sheet 的变换在
 *   .ps__morph 外壳上,而外壳没有 background/overflow,真圆角在里层 .ps__panel ——
 *   在那种结构上输出圆角是画不出来的无效重绘(2026-08-26 评审实测)。
 */
module.exports = function morphEntrance({ shellSelector, radius = true }) {
  /* 缩放下限。只为兜住 0(隐藏/未布局的锚点会量出 0 尺寸,scale(x,0) 在部分 webview 上
   * 会整个元素不渲染)。⚠️ 别往大了调:实测「筛选」按钮 29px 高配 ~590px 的面板,
   * 真实比值 0.049 —— 下限一旦设到 0.05 就会把它夹住,起点比按钮胖一圈。 */
  const MIN_SCALE = 0.02;
  /* 量不到锚点时的降级起点:从中间压扁展开。降级也必须是个能播的起点,
   * 返回空串的话面板会原地闪现。 */
  const FALLBACK = 'transform: translate3d(0,0,0) scale(.96, .10);';

  return Behavior({
    properties: {
      // 触发元素的选择器(页面作用域,如 '#publish-fab');不传 ⇒ 完全不启用
      anchorSelector: { type: String, value: '' },
    },
    data: {
      // 末态开关:插入时是起点态,渲染落地后才置 true,transition 才有起跑线
      _morphOpen: false,
      // 起点变换的行内值(FLIP 算出来的 translate3d + scale [+ 圆角])
      _morphStyle: '',
    },
    observers: {
      show(value) {
        if (!this.data.anchorSelector) return;

        /* ⚠️ 退场期间**不能**把 _morphOpen 置回 false。
         * 它和 exit-motion 的 _closing 是两次不同的 setData:_morphOpen 先落地时,
         * 末态类被摘掉,面板立刻掉回基础规则(transition:none + opacity:0)⇒ 瞬间消失,
         * 然后干等一个退场时长才卸载 —— 用户报的「收回时停一下」就是这段空白,
         * 退场动画根本没播过。末态类留到 _render 置 false 时才清。 */
        if (!value) { this._exitPlaying = true; return; }

        /* 减动效:不量、不等异步回合,直接落末态。走量测的话要等一个回合,
         * 期间面板是起点态,会先空白闪一两帧再突现。
         * ⚠️ 必须同时清掉 _morphStyle:留着上一次的值,这一帧会按**上一次的锚点**画起点。 */
        if (this.data.reducedMotion) {
          this._exitPlaying = false;
          this.setData({ _morphStyle: '', _morphOpen: true });
          return;
        }

        /* 退场没播完就被重开:锚点位置没变,直接长回去,不重量 ——
         * 重量要等一个异步回合,而 _morphOpen 此刻已是 false,面板会先「跳回全缩」再长开。 */
        if (this._exitPlaying && this.data._morphStyle) {
          this._exitPlaying = false;
          this.setData({ _morphOpen: true });
          return;
        }

        this._exitPlaying = false;
        /* ⚠️ 必须在 setData **回调**里量,不能同步量。
         * exit-motion 的 setData({_render:true}) 与这里在同一 tick 同步发出,
         * 面板那时还没上屏 —— 2026-08-26 实测:首次打开侥幸量对了,**第二次打开量到的是
         * 触发元素自己的 rect**(选择器没命中,返回了上一个结果),算出 scale≈1,
         * 等于完全没有动画。setData 的回调在渲染完成后触发,是这里唯一可靠的时机。 */
        this.setData({ _morphOpen: false }, () => this._measureAnchor());
      },
      _render(value) {
        // ⚠️ 这道闸不能省:没传锚点的调用(cy-sheet 有 83 处)每次关闭都会走到这里,
        //    不拦的话每次都白发一个 setData。「不传就零影响」是逐个观察者都要守的。
        if (!this.data.anchorSelector) return;
        // 退场真播完、组件卸载了才重置,给下一次打开留干净的起点
        if (!value) {
          this._exitPlaying = false;
          this.setData({ _morphOpen: false, _morphStyle: '' });
        }
      },
    },
    methods: {
      /* 量触发元素**和承载变换的元素**,算出把后者压成前者那么大的那组变换(FLIP)。
       *
       * ⚠️ 这里必须用**全局** wx.createSelectorQuery 跨到宿主页面去量触发元素 ——
       *   组件伸手拿宿主的节点确实是 Feature Envy,但触发元素本来就在页面里,
       *   this.createSelectorQuery() 够不着。cy-dropdown 量的是它自己的内部触发器,
       *   情形不同,不能照搬。想彻底解耦得让调用方自己量好 rect 传进来,
       *   代价是每个调用方都要写一遍量测 —— 两个试点还不值得。 */
      _measureAnchor() {
        const q = wx.createSelectorQuery();
        q.select(this.data.anchorSelector).boundingClientRect();
        q.in(this).select(shellSelector).boundingClientRect();
        q.exec((res) => {
          this.setData({ _morphStyle: this._flipStyle(res && res[0], res && res[1]) });
          wx.nextTick(() => this.setData({ _morphOpen: true }));
        });
      },

      /* 把 shell 压成 anchor 的那组变换。缩放围绕 shell 中心,所以位移取两个**中心点**之差。
       *
       * ⚠️ 别把缩放比写死。第一版写的是 scale(.92, .12) —— x 只缩到 92%,起点是一条
       *   几乎占满屏宽的扁条,transform-origin 定得再准也没用,看着就是「从屏幕某个高度
       *   展开」而不是「从按钮长出来」。用户实测一眼看出不对。
       *
       * 位移一律 translate3d(抄自 vaul,emilkowalski/vaul):2D translate 提合成层不稳。 */
      _flipStyle(anchor, shell) {
        if (!anchor || !shell || !shell.width || !shell.height) return FALLBACK;
        const sx = Math.max(MIN_SCALE, anchor.width / shell.width);
        const sy = Math.max(MIN_SCALE, anchor.height / shell.height);
        const dx = Math.round((anchor.left + anchor.width / 2) - (shell.left + shell.width / 2));
        const dy = Math.round((anchor.top + anchor.height / 2) - (shell.top + shell.height / 2));
        const t = 'transform: translate3d(' + dx + 'px, ' + dy + 'px, 0) scale(' +
          sx.toFixed(4) + ', ' + sy.toFixed(4) + ');';
        if (!radius) return t;
        /* 起点圆角取触发元素的一半高(按钮多半是胶囊),再除以 sy 反向补偿 ——
         * 不补的话圆角会被 scale 一起缩掉、起点变成直角。
         * 上限 999px:补偿值本来就会被浏览器按短边钳制,算出天文数字没有意义。 */
        const r = Math.min(999, Math.round((anchor.height / 2) / sy));
        return t + ' border-radius: ' + r + 'px;';
      },
    },
  });
};
