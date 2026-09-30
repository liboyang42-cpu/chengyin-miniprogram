const toast = require('../../../../utils/toast.js');
const app = getApp();
const { safeUserMessage } = require('../../../../utils/transport/safe-user-message.js');
const { buildActionKey, buildUnitId } = require('../../utils/play-action-key.js');

const { bundledMerchantGameAudioPath } = require('../../utils/merchant-game-assets.js');

Component({
  properties: {
    show: { type: Boolean, value: false },
    node: { type: Object, value: null },
    activityId: { type: null, value: '' },
    topicId: { type: null, value: '' },
    preview: { type: Boolean, value: false },
    mock: { type: Boolean, value: false }
  },
  data: {
    loading: false,
    acting: false,
    error: '',
    // unknown：请求已发出但结果未知。不是失败，也不能当成功——保持锁定，
    // 只能由 /state 权威回读释放（见 resolveUnknown）。
    unknown: false,
    unknownText: '',
    readingBack: false,
    state: null,
    currentStep: null,
    members: [],
    remainingSeconds: null,
    leaderboard: [],
    leaderboardLoading: false,
    leaderboardError: false,
    playingDrawId: ''
  },
  observers: {
    'show,node.nodeId': function (show, nodeId) {
      if (show && nodeId) this.start();
      if (!show) { this.stopTimer(); this.stopDrawAudio(); }
    }
  },
  lifetimes: { detached() { this.stopTimer(); this.destroyDrawAudio(); } },
  pageLifetimes: { hide() { this.stopDrawAudio(); } },
  methods: {
    request(url, method, data) {
      return new Promise((resolve, reject) => app.sendRequest({
        hideLoading: true,
        url,
        method,
        data: method === 'GET' ? data : JSON.stringify(data || {}),
        header: method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
        success: resolve,
        fail: reject
      }));
    },
    start() {
      if (this.data.loading) return;
      const node = this.data.node || {};
      if (this.data.preview || this.data.mock) {
        const config = node.advancedConfig || {};
        this.hydrate({ sessionId: 'preview', status: 'RUNNING', version: 0, config,
          draws: [], branch: config.branch && config.branch.enabled
            ? { currentStepId: config.branch.startStepId, visitedStepIds: [config.branch.startStepId] } : null,
          multiplayer: config.multiplayer && config.multiplayer.enabled
            ? { roles: {}, members: [], completedUnitIds: [], turnIndex: 0 } : null,
          deadlineAt: config.timer && config.timer.enabled ? Date.now() + config.timer.durationSeconds * 1000 : null,
          readyForBase: !(config.random && config.random.enabled) && !(config.branch && config.branch.enabled)
            && !(config.multiplayer && config.multiplayer.enabled) });
        return;
      }
      this.setData({ loading: true, error: '', state: null });
      this.request('/api/play/advanced/start', 'POST', {
        activityId: Number(this.data.activityId) || 0,
        topicId: Number(this.data.topicId) || 0,
        nodeId: Number(node.nodeId) || 0
      }).then(res => {
        if (res.code == 200 || res.code == '200') this.hydrate(res.data || {});
        else this.setData({ error: safeUserMessage(res, '高级玩法启动失败') });
      }).catch(() => this.setData({ error: '网络错误，请重试' }))
        .finally(() => this.setData({ loading: false }));
    },
    /** 把服务端权威视图抛给页面:v5.1 新玩法的壳是独立 sheet,套不进本面板(sheet 套 sheet),
     *  由页面在面板之外渲染。这里只递数据,不替页面决定弹哪个。 */
    emitSession(state) {
      this.triggerEvent('session', {
        sessionId: state && state.sessionId,
        version: state && state.version,
        playKit: (state && state.playKit) || null,
        /* 故事变量 map:{名字} 替换用。服务端不下发时是 undefined,页面按「没值」处理
           (没兜底就原样留花括号,不渲染成空串)。 */
        vars: (state && state.vars) || null,
        /* 拍物成卡:判过这一次的回包带着刚铸的卡(契约 §10.2「当场看到卡」)。只有那一次动作的回包有,
           回读 /state 没有 —— 页面据此当场揭晓。丢在这一层,那一屏就永远只说「这张过了」。 */
        objectCard: (state && state.objectCard) || null,
      });
    },
    /** 这一步没提交成功:页面据此让拍物成卡那一屏回到取景,别让玩家对着「处理中」干等。 */
    emitActionFail(action) {
      this.triggerEvent('actionfail', { action: action || '' });
    },
    hydrate(state) {
      const config = Object.assign({
        timer: { enabled: false }, random: { enabled: false, drawCount: 0, items: [] },
        branch: { enabled: false, steps: [] }, leaderboard: { enabled: false },
        multiplayer: { enabled: false, roles: [], requiredTurns: 1 }
      }, state.config || {});
      state.config = config;
      state.draws = state.draws || [];
      state.multiplayer = Object.assign({ roles: {}, members: [], completedUnitIds: [], turnIndex: 0 }, state.multiplayer || {});
      const branch = state.branch || {};
      const steps = config.branch && Array.isArray(config.branch.steps) ? config.branch.steps : [];
      const currentStep = steps.find(step => step.id === branch.currentStepId) || null;
      const multi = state.multiplayer || {};
      const roles = multi.roles || {};
      const members = (multi.members || []).map(member => Object.assign({}, member, {
        roleId: roles[String(member.memberId)] || ''
      }));
      this.setData({ state, currentStep, members, error: '' }, () => {
        this.syncTimer();
        if (config.leaderboard && config.leaderboard.enabled) this.loadLeaderboard();
      });
      this.emitSession(state);
    },
    action(name, payload) {
      if (this.data.acting || this.data.unknown || !this.data.state) return;
      if (this.data.preview || this.data.mock) return this.previewAction(name, payload || {});
      const sessionId = this.data.state.sessionId;
      const version = this.data.state.version;
      const body = payload || {};
      // 幂等键由「session + 服务端 version + 动作 + 入参」派生：同一次意图重试复用同一个键，
      // 服务端 selectByIdempotencyKey 才能 replay；写成功后 version 前进，下一动作自动换键。
      const idempotencyKey = buildActionKey(sessionId, version, name, body);
      if (!idempotencyKey) {
        this.setData({ error: '当前玩法状态不完整，请退出节点后重新进入' });
        return;
      }
      this.setData({ acting: true, error: '' });
      this.request('/api/play/advanced/action', 'POST', {
        sessionId, version, idempotencyKey, action: name, payload: body
      }).then(res => {
        if (res.code == 200 || res.code == '200') {
          this.hydrate(res.data || {});
          this.setData({ acting: false });
          return;
        }
        // 服务端说状态已更新 = 我方 version 落后，直接回读权威状态，别让用户拿旧 version 反复重发。
        if (/状态已更新/.test(res.msg || '')) {
          this.refreshState().then(() => {
            this.setData({ acting: false, error: safeUserMessage(res, '操作失败，请重试') });
            this.emitActionFail(name);
          });
          return;
        }
        this.setData({ error: safeUserMessage(res, '操作失败，请重试'), acting: false });
        this.emitActionFail(name);
      }).catch(() => { this._unknownAction = name; this.enterUnknown(version); });
    },
    /** 请求没拿到响应：服务端可能已经写入。禁止直接重发，改问 /state 拿对面自己产生的事实。 */
    enterUnknown(sentVersion) {
      this.setData({
        acting: false, unknown: true, error: '',
        unknownText: '结果还没确认，正在核对，请勿重复提交'
      });
      this._unknownVersion = sentVersion;
      this.resolveUnknown();
    },
    resolveUnknown() {
      if (this.data.readingBack) return Promise.resolve();
      this.setData({ readingBack: true });
      return this.request('/api/play/advanced/state', 'GET', { sessionId: this.data.state.sessionId })
        .then(res => {
          if (!(res.code == 200 || res.code == '200')) throw new Error('readback failed');
          const authoritative = res.data || {};
          const advanced = Number(authoritative.version) > Number(this._unknownVersion);
          // ★version 只在单人局是「我那一步」的独占证据。多人局里队友写入同样推高 version，
          // 拿它当证据会把真丢掉的动作判成成功、把提示清掉，用户再也不知道该重试。
          // 证不到就别下「成功」的结论；重试本身有 idempotencyKey 兜底，落过的不会重复写。
          const multiplayer = !!(((authoritative.config || {}).multiplayer || {}).enabled);
          const landed = advanced && !multiplayer;
          this.hydrate(authoritative);
          if (!landed) this.emitActionFail(this._unknownAction);
          this.setData({
            readingBack: false, unknown: false, unknownText: '',
            // 回读说没写进去，才允许重试；这句是结论不是猜测。
            error: landed ? ''
              : advanced ? '没能确认这一步是否提交成功，可以重试（重试不会重复提交）'
                : '刚才那一步没有提交成功，可以重试'
          });
        })
        .catch(() => {
          this.setData({
            readingBack: false,
            unknownText: '还是没核对上，网络恢复后点这里再试 · 期间请勿重复提交'
          });
          this.emitActionFail(this._unknownAction);
        });
    },
    previewAction(name, payload) {
      const state = JSON.parse(JSON.stringify(this.data.state));
      if (name === 'DRAW') {
        const items = (state.config.random.items || []).filter(item => !(state.draws || []).some(row => row.id === item.id));
        if (items.length) (state.draws || (state.draws = [])).push(items[0]);
      } else if (name === 'CHOOSE') {
        const option = (this.data.currentStep.options || []).find(row => row.id === payload.optionId);
        if (option) state.branch.currentStepId = option.nextStepId;
      } else if (name === 'COMPLETE_UNIT') {
        const units = state.multiplayer.completedUnitIds || (state.multiplayer.completedUnitIds = []);
        units.push(payload.unitId);
      }
      const randomReady = !(state.config.random && state.config.random.enabled)
        || state.draws.length >= Number(state.config.random.drawCount);
      const branchStep = state.config.branch && (state.config.branch.steps || []).find(s => s.id === (state.branch || {}).currentStepId);
      const branchReady = !(state.config.branch && state.config.branch.enabled) || (branchStep && branchStep.terminal);
      const multiReady = !(state.config.multiplayer && state.config.multiplayer.enabled)
        || (state.multiplayer.completedUnitIds || []).length >= Number(state.config.multiplayer.requiredTurns || 1);
      state.readyForBase = randomReady && branchReady && multiReady;
      state.version += 1;
      this.hydrate(state);
    },
    draw() { this.action('DRAW', {}); },
    initDrawAudio() {
      if (this._drawAudio) return;
      const audio = wx.createInnerAudioContext();
      audio.obeyMuteSwitch = false;
      audio.onPlay(() => {});
      audio.onPause(() => this.setData({ playingDrawId: '' }));
      // 切换音频时 stop 可能晚于新 play 回调 这里不能把新播放态清掉
      audio.onStop(() => {});
      audio.onEnded(() => this.setData({ playingDrawId: '' }));
      audio.onError(() => {
        this.setData({ playingDrawId: '' });
        toast('音频加载失败');
      });
      this._drawAudio = audio;
    },
    toggleDrawAudio(e) {
      const id = String(e.currentTarget.dataset.id || '');
      let url = String(e.currentTarget.dataset.url || '');
      if (!id || !url) return;
      if (url.startsWith('/audio/merchant-games/')) {
        url = bundledMerchantGameAudioPath(url);
        if (!url) {
          toast('音频素材不存在');
          return;
        }
      }
      this.initDrawAudio();
      if (this.data.playingDrawId === id) {
        this._drawAudio.pause();
        this.setData({ playingDrawId: '' });
        return;
      }
      this._drawAudio.stop();
      this._drawAudio.src = url;
      this._drawAudio.play();
      this.setData({ playingDrawId: id });
    },
    stopDrawAudio() {
      if (!this._drawAudio) return;
      this._drawAudio.stop();
      this.setData({ playingDrawId: '' });
    },
    destroyDrawAudio() {
      if (!this._drawAudio) return;
      this._drawAudio.destroy();
      this._drawAudio = null;
      this.setData({ playingDrawId: '' });
    },
    choose(e) { this.action('CHOOSE', { optionId: e.currentTarget.dataset.id }); },
    completeUnit() {
      const state = this.data.state || {};
      // unitId 也必须稳定：带时间戳的话重试会申报成「另一个轮次」，
      // 服务端那道 containsText 去重根本拦不住。
      this.action('COMPLETE_UNIT', { unitId: buildUnitId(state.sessionId, state.version) });
    },
    assignRole(e) {
      this.action('ASSIGN_ROLE', {
        memberId: Number(e.currentTarget.dataset.memberid), roleId: e.currentTarget.dataset.roleid
      });
    },
    loadLeaderboard() {
      if (this.data.preview || this.data.mock || this.data.leaderboardLoading) return;
      this.setData({ leaderboardLoading: true, leaderboardError: false });
      this.request('/api/play/advanced/leaderboard', 'GET', {
        activityId: Number(this.data.activityId) || 0,
        topicId: Number(this.data.topicId) || 0,
        nodeId: Number((this.data.node || {}).nodeId) || 0
      }).then(res => {
        if (res.code == 200 || res.code == '200') {
          const metric = this.data.state.config.leaderboard.metric;
          const rows = (res.data || []).map(row => Object.assign({}, row, {
            metricValue: metric === 'ELAPSED_TIME' ? `${row.elapsedSeconds || 0}s`
              : (metric === 'COMPLETED_UNITS' ? (row.completedUnits || 0) : (row.score || 0))
          }));
          this.setData({ leaderboard: rows });
          return;
        }
        this.setData({ leaderboardError: true });
      })
        // request 的 fail 是 reject:原来没有 catch,失败在控制台是一条 unhandled rejection,
        // 而榜单区既不转也不说 —— 玩家只能反复点「刷新」。落一个行内失败态,可再点刷新。
        .catch(() => this.setData({ leaderboardError: true }))
        .finally(() => this.setData({ leaderboardLoading: false }));
    },
    syncTimer() {
      this.stopTimer();
      const deadline = this.data.state && Number(this.data.state.deadlineAt);
      if (!deadline) { this.setData({ remainingSeconds: null }); return; }
      const tick = () => {
        const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        this.setData({ remainingSeconds: left });
        if (!left) { this.stopTimer(); if (!this.data.preview && !this.data.mock) this.refreshState(); }
      };
      tick();
      this._timer = setInterval(tick, 1000);
    },
    refreshState() {
      const state = this.data.state;
      if (!state || !state.sessionId) return Promise.resolve();
      return this.request('/api/play/advanced/state', 'GET', { sessionId: state.sessionId })
        .then(res => { if (res.code == 200 || res.code == '200') this.hydrate(res.data || {}); })
        .catch(() => {});
    },
    stopTimer() { if (this._timer) { clearInterval(this._timer); this._timer = null; } },
    continueBase() {
      if (!this.data.state || !this.data.state.readyForBase) return;
      this.triggerEvent('ready', { nodeId: (this.data.node || {}).nodeId });
    },
    close() { this.triggerEvent('close'); }
  }
});
