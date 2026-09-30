// cy-mascot · 猫向导。稿里原始尺寸 120×110,按宽等比换算高度,不写死两个尺寸属性。
const MASCOT_RATIO = 110 / 120;
const DEFAULT_SIZE = 240;   // rpx;properties 默认值与 data 初值共用,免得改一处漏一处
const SRC = {
  normal: '/pages/play/images/mascot-cat.svg',
  blindfold: '/pages/play/images/mascot-cat-blind.svg',
};

Component({
  options: { addGlobalClass: false },
  properties: {
    // normal | blindfold;传别的值退回 normal(不给半张脸的空 image)
    mode: { type: String, value: 'normal' },
    size: { type: Number, value: DEFAULT_SIZE },   // rpx,盒宽
  },
  data: {
    src: SRC.normal,
    boxH: Math.round(DEFAULT_SIZE * MASCOT_RATIO),
  },
  observers: {
    'mode, size': function (mode, size) {
      const w = size > 0 ? size : DEFAULT_SIZE;
      this.setData({
        src: SRC[mode] || SRC.normal,
        boxH: Math.round(w * MASCOT_RATIO),
      });
    },
  },
});
