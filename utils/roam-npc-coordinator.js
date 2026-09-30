// utils/roam-npc-coordinator.js — 漫游 NPC 深模块(补充方案 §4.3)。
// 页面只 dispatch 领域事件;本模块隐藏 profile 加载/重试、事件排队、gate 配额、
// 气泡定时、埋点与降级。端口注入,单测用 in-memory 端口。
const { createNpcRoamGate } = require('./npc-roam-gate.js');

const EVENT_OF = {
  SESSION_STARTED: 'roam_start',
  SESSION_FINISHED: 'roam_end',
};
const BUBBLE_MS = 6000;
const PROFILE_RETRY_MS = 5000;
const MAX_QUEUE = 3;

function createRoamNpcCoordinator(ports) {
  const clock = ports.clock;
  const gate = createNpcRoamGate({ now: clock.now });
  let disposed = false;
  let giveUp = false;          // 只表示「profile 两次拉不到 → 永久静默」,与 feature flag 无关
  let profile = null;
  let profileTried = 0;
  let pendingEvts = [];        // profile 到货前的事件队列(≤MAX_QUEUE)
  let hideTimer = null;
  let sessionId = 0;
  const seenPoi = {};
  // 里程碑无需额外守卫:target 恒取当前最高档(≥80 后永远算 80),gate 的单事件配额+在途预占
  // 已保证各档最多 1 次、跨档同帧只发最高、失败可重试 1 次。

  // ★flag 每次现读,绝不 latch:app.loadFeatureFlags 是异步的(POST /api/config/features),
  // 本页可能在它返回前就 onLoad。若把「此刻 flag=false」记死,冷启动窗口内进页的用户
  // 整场会话静默、零日志零告警,而灰度数据会让人误判「功能坏了」。反向同理:flag 中途关掉要立刻噤声。
  function featureOn() {
    return !!(ports.featurePort && ports.featurePort.isEventOn());
  }

  // Chat 的开关依附 Event：即使客户端收到非法的 Chat=true/Event=false 组合，也必须 fail-safe 关。
  function chatOn() {
    return featureOn() && !!(ports.featurePort && ports.featurePort.isChatOn && ports.featurePort.isChatOn());
  }

  function start() {
    if (disposed || giveUp) return;
    if (!featureOn()) return;               // 不 latch —— flag 晚到时由 dispatch 兜起来
    if (profile || profileTried > 0) return; // 已在加载/已到货,别重复拉
    loadProfile();
  }

  function loadProfile() {
    profileTried++;
    ports.apiPort.fetchProfile(function (err, data) {
      if (disposed) return;
      if (err || !data || !data.profileId) {
        if (profileTried < 2) { clock.setTimeout(loadProfile, PROFILE_RETRY_MS); return; }
        giveUp = true; pendingEvts = []; return;   // 永久静默,主流程不受影响
      }
      profile = data;
      ports.analyticsPort.track('npc_profile_loaded', { bizType: 'roam', bizId: sessionId });
      const q = pendingEvts; pendingEvts = [];
      q.forEach(dispatch);
    });
  }

  function dispatch(evt) {
    if (disposed || giveUp || !evt) return;
    if (!featureOn()) return;
    // flag 晚到的情况:start() 那次因 flag 还没到而没拉 profile,这里补一次
    if (!profile) { start(); if (pendingEvts.length < MAX_QUEUE) pendingEvts.push(evt); return; }
    if (evt.type === 'POI_VISIT_RECORDED') {
      if (evt.firstVisit !== true) return;
      const k = evt.poiKey;                    // v2.1:坐标键,页面负责生成;poiId 生产中不存在
      if (!k) return;                          // 无键 = 去重不了,宁可不冒泡也不塌成同一键
      if (seenPoi[k]) return;
      seenPoi[k] = 1;
      fire('roam_poi_first_light', false);
    } else if (evt.type === 'UNIQUE_TILE_COUNT_CHANGED') {
      const c = evt.count | 0;
      const target = c >= 80 ? 'roam_milestone_80' : (c >= 25 ? 'roam_milestone_25' : null);
      if (!target) return;
      fire(target, false);
    } else if (EVENT_OF[evt.type]) {
      fire(EVENT_OF[evt.type], evt.type === 'SESSION_FINISHED');
    }
  }

  function fire(eventType, isFinish) {
    const a = gate.tryAcquire(eventType);
    if (!a.ok) return;
    ports.apiPort.fetchEventLine(profile.profileId, eventType, function (err, vo) {
      if (disposed) { gate.releaseUnshown(eventType); return; }
      const line = vo && vo.line;
      // line 为空 = 无预审话术(后端 cacheOnly 未命中)→ 静默,别冒泡也别记 impression
      if (err || !line) { gate.releaseUnshown(eventType); return; }
      // 提示层只消费受审核文案。profile 仅用于兼容现有缓存查询，绝不进入视图模型。
      const vm = { line: line };
      if (isFinish) {
        ports.viewPort.showFinishLine(vm);
        gate.confirmShown(eventType);
        trackImpression(eventType, line);
        return;
      }
      ports.viewPort.showBubble(vm, function (renderErr) {
        if (renderErr) { gate.releaseUnshown(eventType); return; }
        gate.confirmShown(eventType);
        trackImpression(eventType, line);
        if (hideTimer) clock.clearTimeout(hideTimer);
        hideTimer = clock.setTimeout(function () { ports.viewPort.showBubble(null, function () {}); }, BUBBLE_MS);
      });
    });
  }

  /**
   * Chat 不复用 event bubble 的 profile/队列；这里只是稳定入口的 gate + 当前漫游会话交接。
   * 页面负责 sheet、POST 和 abort，Coordinator 保持其既有「领域事件 → 视图端口」边界。
   */
  function openChat() {
    if (disposed || !chatOn() || !ports.viewPort || typeof ports.viewPort.openChat !== 'function') return false;
    if (hideTimer) {
      clock.clearTimeout(hideTimer);
      hideTimer = null;
    }
    // Chat 与顶部通知栈互斥：先主动收起低优先级 event bubble，避免两层争注意力。
    if (typeof ports.viewPort.showBubble === 'function') ports.viewPort.showBubble(null, function () {});
    return ports.viewPort.openChat(sessionId) !== false;
  }

  // 只在真实展示后调用。properties 不放话术原文、不放坐标(后端 FORBIDDEN_KEYS 会拒,
  // 但原文本就不该发);bizId 只放 Long。
  function trackImpression(eventType, line) {
    ports.analyticsPort.track('npc_bubble_impression', {
      bizType: 'roam',
      bizId: sessionId,
      eventType: eventType,
      lineLen: line.length,
    });
  }

  return {
    start,
    dispatch,
    openChat,
    setSessionId: function (sid) { sessionId = Number(sid) || 0; },
    dispose: function () {
      if (disposed) return;
      disposed = true;
      if (hideTimer) clock.clearTimeout(hideTimer);
      pendingEvts = [];
      if (ports.viewPort && typeof ports.viewPort.closeChat === 'function') ports.viewPort.closeChat();
    },
  };
}

module.exports = { createRoamNpcCoordinator };
