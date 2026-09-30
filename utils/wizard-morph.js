/**
 * utils/wizard-morph.js —— 开场 CTA → 进度条的共享元素形变(2026-09-06)
 *
 * 三条向导(主理人申请 / 建团 / 商家入驻)共用这一份。参考视频里那颗开场按钮
 * 不是「消失后再出现进度条」,是它自己飞上去变过去的 —— 右半截转灰才说得通:
 * 胶囊的右半边就是进度条的「未填」部分。
 *
 * 两条硬约束,改之前先看:
 *   ① 只动 transform / opacity / border-radius。
 *      width/left/top 都在 motion-property-ratchet 的布局属性名单里,动了既判红也掉帧。
 *      所以横向差异也用 scaleX/translateX 表达,不用 width/left ——
 *      ⚠️ **不要假设 CTA 与进度轨等宽**:建团页 .cc-page 已有一层 --cy-page-x,
 *      .intro 又加一层,CTA 比进度轨多缩进一个页边距(实测 326 vs 358)。
 *      早先那版只动纵向,建团就会横向差 2×页边距并在交接时跳一下。
 *   ② 位移按**中心对中心**算,不是顶边/左边对齐。scale 以中心为原点,
 *      按边算会差半个尺寸(纵向实测 22px),看起来就是「定位不准」。
 *
 * 起止几何全部运行时量,不写死,所以换机型/换页边距都对得上。
 */

// transition 是 400ms(style/wizard-intro.wxss);这里多给 20ms 再收尾,
// 免得在最后一帧就把形变层撤掉、留下一次可见的跳变。改 transition 时这里要跟着改。
var DURATION = 420;

/**
 * @param {Object} page      页面实例(this)
 * @param {Object} opt
 *   opt.segSel     {string}   进度段选择器(各页不同:.prog__seg / .cc-seg / .progress-segment)
 *   opt.enterData  {Object}   切到表单态要 setData 的字段(如 {mode:'form'} 或 {introMode:false})
 *   opt.afterEnter {Function} 表单态就位后要做的事(通常是 refreshStep(1))
 *   opt.ctaSel     {string}   开场 CTA 壳选择器,默认 .intro-cta
 */
function runIntroMorph(page, opt) {
  var ctaSel = opt.ctaSel || '.intro-cta';
  var enterOnly = function () {
    page.setData(opt.enterData);
    if (opt.afterEnter) opt.afterEnter();
  };
  wx.createSelectorQuery().in(page).select(ctaSel).boundingClientRect(function (cta) {
    // 量不到就老老实实直接切,不留半截动画
    if (!cta) { enterOnly(); return; }
    var enter = {};
    for (var k in opt.enterData) enter[k] = opt.enterData[k];
    enter.morphing = true;
    page.setData(enter, function () {
      if (opt.afterEnter) opt.afterEnter();
      wx.createSelectorQuery().in(page).selectAll(opt.segSel).boundingClientRect(function (segs) {
        if (!segs || !segs.length) { endIntroMorph(page); return; }
        var first = segs[0];
        var last = segs[segs.length - 1];
        var trackW = last.right - first.left;
        page.setData({
          morph: {
            x: cta.left, y: cta.top, w: cta.width, h: cta.height,
            dx: (first.left + trackW / 2) - (cta.left + cta.width / 2),
            dy: (first.top + first.height / 2) - (cta.top + cta.height / 2),
            sx: trackW / cta.width,
            sy: first.height / cta.height,
            fx: first.width / trackW,
          },
        }, function () {
          // 下一帧再翻开关,否则起止两态落在同一帧里,transition 根本不跑
          wx.nextTick(function () { page.setData({ morphRun: true }); });
          page._morphTimer = setTimeout(function () { endIntroMorph(page); }, DURATION);
        });
      }).exec();
    });
  }).exec();
}

/** 收尾:撤掉形变层,把进度条交还给真节点。 */
function endIntroMorph(page) {
  cancelIntroMorph(page);
  page.setData({ morphing: false, morph: null, morphRun: false });
}

/** 离页时用这个:只掐掉定时器,不 setData ——
 *  往正在卸载的页面写状态,正是隔壁那几道 epoch 防线在防的事。 */
function cancelIntroMorph(page) {
  if (page._morphTimer) { clearTimeout(page._morphTimer); page._morphTimer = null; }
}

module.exports = {
  runIntroMorph: runIntroMorph,
  endIntroMorph: endIntroMorph,
  cancelIntroMorph: cancelIntroMorph,
  DURATION: DURATION,
};
