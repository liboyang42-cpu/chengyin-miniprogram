// cy-playkit-musiccorner · 治愈音乐角(Figma v5.1,node 47:289)
//
// 组件不持有 InnerAudioContext:音频要跨弹窗生命周期继续播(用户可能收起面板继续走路),
// 播放器归页面,组件只把"播/停"意图往上抛,并按 position/duration 画进度。
// 稿 47:299-47:314 的 17 根波形条高度照抄,不随机 —— 随机波形每次重渲染都在抖。
const BAR_HEIGHTS = [16, 38, 60, 30, 52, 22, 44, 66, 36, 58, 28, 50, 20, 42, 64, 34, 24];

/** 纯函数:秒 → M:SS(歌曲长度不会到小时) */
function formatTime(seconds) {
  const total = seconds > 0 ? Math.floor(seconds) : 0;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m + ':' + (s < 10 ? '0' + s : String(s));
}

/** 纯函数:播放进度 → 点亮几根波形条。0 时一根不亮,播完全亮。 */
function litBarCount(position, duration, barCount) {
  if (!(duration > 0) || !(position > 0)) return 0;
  const ratio = Math.min(1, position / duration);
  return Math.round(ratio * barCount);
}

const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');
// 2026-08-27 触感:落在播放/暂停开关上,light 档(会被反复切换,重了变吵)。
Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    show:      { type: Boolean, value: false },
    eyebrow:   { type: String,  value: '治愈音乐角' },
    arrived:   { type: Boolean, value: false },
    title:     { type: String,  value: '' },
    trackName: { type: String,  value: '店主的歌单' },
    duration:  { type: Number,  value: 0 },   // 秒
    position:  { type: Number,  value: 0 },   // 秒
    playing:   { type: Boolean, value: false },
    hint:      { type: String,  value: '' },
  },
  data: {
    bars: BAR_HEIGHTS,
    litBars: 0,
    percent: 0,
    positionLabel: '0:00',
  },
  observers: {
    'position, duration': function (position, duration) {
      const pct = duration > 0 ? Math.min(100, Math.round((position / duration) * 100)) : 0;
      this.setData({
        litBars: litBarCount(position, duration, BAR_HEIGHTS.length),
        percent: pct,
        positionLabel: formatTime(position),
      });
    },
  },
  methods: {
    _formatTime: formatTime,       // 纯算法出口,供单测
    _litBarCount: litBarCount,

    onToggle() {
      // 播放/暂停是开关型动作:轻一档就够,重了会在连续切换时变吵
      motion.haptic({ reducedMotion: this.data.reducedMotion });
      this.triggerEvent('toggle', { playing: !this.data.playing });
    },
    onClose() { this.triggerEvent('close'); },
  },
});
