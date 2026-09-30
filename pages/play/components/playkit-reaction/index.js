// cy-playkit-reaction · 变色就点(原型真源:模板编辑页 v2 · playkit react)
//
// 这个玩法**没有** 3-2-1:它测的就是突然性,先数三下等于预告。
// 原型里 countIn 挂在限时条里,而变色就点没有限时开关 —— 天然不数,不是漏了。
//
// ★ 抢跑要单独判。不判的话所有人都会在变色前狂点,这游戏就没了 ——
// 能靠乱点赢的规则等于没有规则。
//
// ★ 等待时长必须随机(1.4–4.2 秒),而且**由服务端决定这一轮算不算数**:
// 客户端只报「我点的时候屏幕已经绿了多久」,服务端拿真实墙钟校验。
// 低于 MIN_HUMAN_REACTION_MS(120ms)的成绩后端会判抢跑 —— 设备可以谎报成绩,谎报不了时间。

const WAIT_MIN_MS = 1400;
const WAIT_MAX_MS = 4200;
const MIN_HUMAN_MS = 120;      // 与后端 AdvancedGameRuntimeServiceImpl 同值

const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');

/** 随机等待时长。固定间隔的话第二轮就能背下来,测的就不是反应了。 */
function pickWait(rand) {
  const r = typeof rand === 'function' ? rand() : Math.random();
  return Math.round(WAIT_MIN_MS + r * (WAIT_MAX_MS - WAIT_MIN_MS));
}

/** 三轮取最快:一轮的偶然性太大。空数组给 0,由调用方判「还没有成绩」。 */
function bestOf(times) {
  const list = (times || []).filter((n) => n > 0);
  return list.length ? Math.min.apply(null, list) : 0;
}

/** 达标 = 最快那次低于商家设的 goalMs,且没有一轮抢跑。 */
function passed(times, goalMs) {
  const best = bestOf(times);
  return best > 0 && best <= goalMs;
}

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    show: { type: Boolean, value: false },
    kicker: { type: String, value: '变绿就点' },
    rounds: { type: Number, value: 3 },
    goalMs: { type: Number, value: 320 },
  },
  data: {
    phase: 'idle',        // idle | wait | go | early | done
    big: '—',
    sub: '点一下开始',
  },
  observers: {
    'show, rounds': function (show, rounds) {
      this._stop();
      if (!show) return;
      this._armed = false;
      this._times = [];
      this.setData({
        phase: 'idle', big: '—', sub: '点一下开始',
      });
      // 变色就点没有限时开关,stage 因此天然不数 3-2-1 —— 那正是要的:这玩法测的就是突然性
      const stage = this.selectComponent('#cy-play-stage');
      if (stage) stage.begin();
    },
  },
  lifetimes: { detached() { this._stop(); } },
  // 切后台就把这一轮作废:回来时屏幕可能已经绿了很久,那个「成绩」是假的
  pageLifetimes: { hide() { this._abortRound(); } },
  methods: {
    _pickWait: pickWait,        // 纯算法出口,供单测
    _bestOf: bestOf,
    _passed: passed,
    _minHumanMs: () => MIN_HUMAN_MS,

    _stop() { if (this._timer) { clearTimeout(this._timer); this._timer = null; } },

    _abortRound() {
      if (this.data.phase !== 'wait' && this.data.phase !== 'go') return;
      this._stop();
      this.setData({ phase: 'idle', big: '—', sub: '刚才切走了,这一轮不算。点一下重来' });
    },

    /** 进入等待:红屏,随机若干毫秒后转绿。 */
    _arm() {
      this.setData({ phase: 'wait', big: '等', sub: '变绿再点 —— 早点了算抢跑' });
      /* 开表要报给服务端:成绩按服务器时间复核,不先开表提交会被判成「还没开始」。
         第一轮报一次就够,服务端记的是这一局的起点。 */
      if (!this._armed) { this._armed = true; this.triggerEvent('start'); }
      this._stop();
      this._timer = setTimeout(() => {
        this._goAt = Date.now();
        this.setData({ phase: 'go', big: '点!', sub: '' });
      }, pickWait());
    },

    onTap() {
      const phase = this.data.phase;

      if (phase === 'idle' || phase === 'early') { this._arm(); return; }

      if (phase === 'wait') {
        // 抢跑:这一轮作废,但不判整局输 —— 抢跑是操作失误,不是答错
        this._stop();
        motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'light' });
        this.setData({ phase: 'early', big: '抢跑', sub: '绿了才能点。点一下重来' });
        return;
      }

      if (phase !== 'go') return;

      const ms = Date.now() - this._goAt;
      // 低于人类反应下限的不收:那是提前按住不放蹭出来的,后端也会判抢跑
      if (ms < MIN_HUMAN_MS) {
        this.setData({ phase: 'early', big: '抢跑', sub: '这个快得不像人手。点一下重来' });
        return;
      }

      this._times.push(ms);
      const doneCount = this._times.length;
      // 「做成了」落在每一轮成绩落定这一刻
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });

      if (doneCount < (this.data.rounds || 3)) {
        this.setData({ phase: 'idle', big: ms + '', sub: '毫秒 · 点一下进入下一轮' });
        return;
      }

      const best = bestOf(this._times);
      const ok = passed(this._times, this.data.goalMs);
      this.setData({ phase: 'done', big: best + '', sub: '三轮里最快的一次' });
      // 判定屏由 stage 统一出:凡是「猜中了」都走同一张,答错不算通关
      const stage = this.selectComponent('#cy-play-stage');
      if (stage) { if (ok) stage.win('最快 ' + best + ' 毫秒'); else stage.fail(false); }
      // 成绩报服务端,由它拿真实墙钟复核 —— 本地这几个数只是显示
      this.triggerEvent('submit', { times: this._times.slice(), bestMs: best, passed: ok });
    },

    onVerdict(e) { this.triggerEvent('verdict', e.detail); },
    onClose() { this._stop(); this.triggerEvent('close'); },
  },
});
