// cy-playkit-pricepair · 猜图(原型真源:模板编辑页 v2 · playkit guess)
//
// ★ 正确项不下发:这个玩法整个就是「挑出正确的那张」,答案到了客户端它就只剩点击。
// 已判过的那一张由服务端随结果返回。
//
// 名字放在图**外面**(2026-09-09 用户拍板):原来整张彩色卡片就是图片,名字压在
// 卡片内部底边,看起来就是「标题在图片里」。现在色块只装图和判定角标,
// 名字和说明落在页面底色上、左对齐。
//
// 还有次数就别急着揭晓:上一版点错一张就把答案亮出来、整题结束,那「还能错 N 次」
// 这行字是骗人的。

const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');

/* 底色按固定顺序轮转,不给商家配:颜色一放开,四张海报会出现十种不搭的组合。
   ⚠️ 顺序照抄原型,别按「红蓝黑紫」的直觉排 —— 实测原型是红、薰衣草、深、蓝,
   第 3 张那个深色是用来把一行两张拆开的,换位置整版就平了。 */
/* 海报底色按顺序轮转,顺序照原型逐位抄 —— 上一版把第 2 位和第 4 位调了个个儿,
   四张排在一起颜色的节奏就不一样了(红紫黑蓝 vs 红蓝黑紫)。 */
const TINTS = ['#f0402f', '#3563e9', '#2a2a28', '#8a6bf2', '#0f7a55', '#b7791f'];   /* ds-ok 海报底色 */
/* 深色那一格里的字要翻浅,其余都是深字 —— 与原型 index % 6 === 2 同一条判据 */
const inkOn = (i) => (i % 6 === 2 ? '#e4ddd2' : '#111114');

const paint = (list) => (list || []).map((it, i) => ({
  id: it.id || ('i' + i),
  name: it.name || ('图 ' + (i + 1)),
  note: it.note || '',
  imageUrl: it.imageUrl || '',
  tint: TINTS[i % TINTS.length],
  ink: inkOn(i),
  state: '', mark: '',
}));

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '' },
    items: { type: Array, value: [] },
    limitSeconds: { type: Number, value: 0 },
    maxTries: { type: Number, value: 0 },
  },
  data: {
    // 同 playkit-qa:派生数据换键名,别写回被监听的 items —— 那会自触发死循环
    posters: [],
    revealed: false,
  },
  observers: {
    'show, items': function (show, items) {
      if (!show) return;
      this.setData({ posters: paint(items), revealed: false });
      const stage = this.selectComponent('#cy-play-stage');
      if (stage) stage.begin();
    },
  },
  methods: {
    _paint: paint,          // 纯算法出口,供单测
    _tints: () => TINTS.slice(),
    _inkOn: inkOn,

    onPick(e) {
      if (this.data.revealed) return;
      const i = Number(e.currentTarget.dataset.i);
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      /* 带上这张海报自己的 id:服务端按 id 判「是不是当前这一对里的」,
         下标在服务端那边没有意义(它手里的顺序不一定是屏上这个)。 */
      const poster = this.data.posters[i] || {};
      this.triggerEvent('submit', { index: i, pickId: poster.id });
    },

    /** 服务端判完回调。ok=false 且还有次数时不揭晓,让人接着挑。 */
    settle(ok, detail) {
      const d = detail || {};
      const stage = this.selectComponent('#cy-play-stage');
      if (ok) {
        this.setData({
          revealed: true,
          posters: this.data.posters.map((it, i) => Object.assign({}, it,
            i === d.index ? { state: 'is-right', mark: '就是它' } : { state: 'is-dim' })),
        });
        if (stage) stage.win(d.feedback || '');
        return;
      }
      const exhausted = stage ? stage.miss() : true;
      if (stage && stage.nudge) stage.nudge();   // 答错整块台面抖一下(原型 .phone.shake)
      this.setData({
        revealed: exhausted,
        posters: this.data.posters.map((it, i) => Object.assign({}, it,
          i === d.index ? { state: 'is-wrong', mark: '不是' } : it)),
      });
      if (exhausted && stage) stage.fail(false);
    },

    onVerdict(e) { this.triggerEvent('verdict', e.detail); },
    onClose() { this.triggerEvent('close'); },
  },
});
