/* cy-qr-voucher · QR 凭证模式(DS §5.9,Blackbird 参照)
 * 收编:优惠券亮码 / 订单核销码 / 漫游据点码 / 邀请二维码——所有"出示给对方扫"的凭证页。
 * 码卡永远浅色(扫码对比度物理要求),暗底页上即浅色浮层。 */
const reducedMotionBehavior = require('../../../behaviors/reduced-motion.js');

Component({
  options: { multipleSlots: true },
  behaviors: [reducedMotionBehavior],
  properties: {
    show:          { type: Boolean, value: false },
    embedded:      { type: Boolean, value: false }, // 已在宿主 scene-sheet 内时只渲染码卡正文
    // 正文(错误文案 / 说明 / 次级胶囊)按「外面是什么底」分两档,不能一律钉死浅色:
    // scrim = 组件自出的 player 弹层、以及漫游/开局那层 background:#000 的半屏(恒暗);
    // host  = 宿主把正文直接铺在页面底上(关于页「我的二维码」),那层底会随身份在
    //         商家日间 #F3F4F4 与玩家暗域之间翻 —— 浅字压浅底只剩 1.05:1,错误态等于没显示。
    surface:       { type: String,  value: 'scrim' }, // scrim | host
    qr:            { type: String,  value: '' },    // 二维码图 src(服务端图 / base64;组件不负责生成)
    code:          { type: String,  value: '' },    // 无图时的文本防伪码兜底(如据点核销短码)
    title:         { type: String,  value: '' },    // 居中标题:做什么能得什么
    desc:          { type: String,  value: '' },    // 一句说明
    countdown:     { type: String,  value: '' },    // 刷新倒计时文案(Caption,放码下方)
    secondaryText: { type: String,  value: '' },    // 次级胶囊动作,如"改用链接分享"/"刷新"
    state:         { type: String,  value: 'ready' }, // ready | loading | error
    errorText:     { type: String,  value: '二维码未加载' },
    // 空字符串 = 不渲染重试按钮。有些错误态**重试永远不会成功**(如关于页的身份码:
    // 后端接口还没接,契约上就是「如实落错误态」),给一个假重试比不给更糟 ——
    // 与 cy-error 的 retry="" 同一套约定(2026-08-19 F10 实拍到这个死按钮)。
    retryText:     { type: String,  value: '重试' },
    showLogo:      { type: Boolean, value: true },  // 中心城瘾 logo;他人二维码(如微信联系码)可关
    maskClosable:  { type: Boolean, value: true },
    zIndex:        { type: Number,  value: 900 },   // 浮层层级(T9:对齐 --cy-z-modal 档);宿主页有更高层时传入覆盖
  },
  methods: {
    onClose()     { this.triggerEvent('close'); },
    onSecondary() { this.triggerEvent('secondary'); },
    onRetry()     { this.triggerEvent('retry'); },
    onMask()      { if (this.data.maskClosable) this.triggerEvent('close'); },
    noop() {},
  },
});
