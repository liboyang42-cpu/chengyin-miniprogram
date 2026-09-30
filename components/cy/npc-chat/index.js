// cy-npc-chat：普通 POST 的客户端壳。流式观感只来自已审核全文的本地逐字呈现。
//
// ★ 两轨共用本组件,靠 scope 选端点:
//     scope='roam'     → /api/ai/npc/chat          bizId = 漫游会话 id
//     scope='merchant' → /api/ai/npc/merchant-chat bizId = 商家 id
//   共用的是「幂等 requestId + generation 隔离迟到响应 + 只显示已审核全文」这套壳,
//   它与是哪一轨无关;复制一份等于把这三条保证也复制一份,以后只会修好其中一份。
//   ⚠️ 两轨的**开关是分开的**(roamNpcChat 硬编码 false / merchantNpcChat 读配置),
//     由调用方各自判,组件不判 —— 组件判的话两轨就又绑一起了。
const analytics = require('../../../utils/analytics.js');

const MAX_MESSAGE_CODE_POINTS = 300;
const MAX_VISIBLE_MESSAGES = 20;
const TYPE_INTERVAL_MS = 24;

function codePoints(text) {
  return Array.from(text || '');
}

function makeRequestId() {
  // 与服务端的 UUID 契约一致；requestId 只做幂等键，不承载用户或业务信息。
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (char) {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : ((random & 0x3) | 0x8);
    return value.toString(16);
  });
}

Component({
  properties: {
    show: {
      type: Boolean,
      value: false,
      observer: function (visible) {
        if (!visible) this._resetForClose();
      },
    },
    sessionId: { type: Number, value: 0 },
    /** 'roam' | 'merchant'。决定打哪个端点、以及 bizId 缺席时说什么。 */
    scope: { type: String, value: 'roam' },
    /** scope='merchant' 时的标题(形象名)与空态招呼语,由店铺主页传入。 */
    npcName: { type: String, value: '' },
    greeting: { type: String, value: '' },
  },

  data: {
    messages: [],
    input: '',
    inputCount: 0,
    state: 'IDLE',
    isThinking: false,
    canSend: false,
    scrollIntoView: '',
  },

  lifetimes: {
    detached: function () { this.cancelPending(); },
  },

  methods: {
    onInput: function (event) {
      const chars = codePoints((event && event.detail && event.detail.value) || '').slice(0, MAX_MESSAGE_CODE_POINTS);
      const input = chars.join('');
      // 允许用户在等待时改问下一句：先 abort 旧 RequestTask，再用 generation 隔离迟到响应。
      this.setData({ input: input, inputCount: chars.length, canSend: !!input.trim() });
    },

    onSend: function () {
      const message = (this.data.input || '').trim();
      if (!message) return;
      if (!this.properties.sessionId) {
        this._appendAssistant(
          this.properties.scope === 'merchant'
            ? '这家店暂时不能对话。'
            : '先走几步开始这段漫游，再来问我吧。',
          'FAILED'
        );
        return;
      }

      this._invalidate(false);
      const generation = ++this._generation;
      const requestId = makeRequestId();
      const userMessage = this._message('user', message);
      const messages = this._capMessages((this.data.messages || []).concat(userMessage));
      this.setData({
        messages: messages,
        input: '',
        inputCount: 0,
        canSend: false,
        state: 'GENERATING',
        isThinking: true,
        scrollIntoView: 'npc-msg-' + userMessage.id,
      });
      this._track('npc_chat_submit');

      const app = getApp();
      const control = app.sendRequest({
        // ★ 两个字面量直接写在这里,不抽 helper:UI-GATE 的 U1 要求请求路径可枚举,
        //   helper 返回的字符串它核对不了,会判成「运行时变量路径」。
        url: this.properties.scope === 'merchant'
          ? '/api/ai/npc/merchant-chat'
          : '/api/ai/npc/chat',
        method: 'POST',
        data: { requestId: requestId, bizId: this.properties.sessionId, message: message },
        header: { 'content-type': 'application/json' },
        timeout: 30000,
        silentError: true,
        success: (res) => this._onResponse(generation, requestId, res),
        fail: () => this._onNetworkFailure(generation),
        successStatusAbnormal: () => this._onNetworkFailure(generation),
      });
      // request-client 的控制器覆盖静默重登后的 RequestTask；不直接持有一次 wx.request 的裸 task。
      if (this._isCurrent(generation)) this._requestControl = control;
    },

    onSheetClose: function () {
      this.cancelPending();
      this.triggerEvent('close');
    },

    /** 页面 onHide/onUnload/切场景时调用的公开生命周期方法。 */
    cancelPending: function () {
      this._invalidate(true);
    },

    _onResponse: function (generation, requestId, res) {
      if (!this._isCurrent(generation)) return;
      this._requestControl = null;
      const payload = res && res.data;
      // requestId 不匹配按迟到/串线处理，绝不把另一条请求的文本写进当前对话。
      if (!payload || payload.requestId !== requestId) {
        this._onNetworkFailure(generation);
        return;
      }
      if (res.code != 200 && res.code != '200') {
        this._trackComplete(payload);
        this._appendAssistant(payload.safeText || '这次没有收到有效回答，请稍后再试。', 'FAILED');
        return;
      }
      this._trackComplete(payload);
      if (payload.outcomeStatus === 'SUCCEEDED' && payload.safetyDecision === 'PASS') {
        this._startTypewriter(generation, payload.safeText || '', payload.audioUrl);
        return;
      }
      this._appendAssistant(payload.safeText || '这次暂时无法回答，请稍后再试。', this._stateOf(payload));
    },

    _onNetworkFailure: function (generation) {
      if (!this._isCurrent(generation)) return;
      this._requestControl = null;
      this._appendAssistant('网络不太稳定，这条问题还没有送达，可以再试一次。', 'FAILED');
    },

    _startTypewriter: function (generation, text, audioUrl) {
      this._playVoice(audioUrl);
      const assistant = this._message('assistant', '');
      const chars = codePoints(text);
      const messages = this._capMessages((this.data.messages || []).concat(assistant));
      this.setData({ messages: messages, state: 'DELIVERING', isThinking: false, scrollIntoView: 'npc-msg-' + assistant.id });
      let cursor = 0;
      const tick = () => {
        if (!this._isCurrent(generation)) return;
        cursor = Math.min(chars.length, cursor + 2);
        const next = (this.data.messages || []).map((item) =>
          item.id === assistant.id ? Object.assign({}, item, { text: chars.slice(0, cursor).join('') }) : item
        );
        this.setData({ messages: next, scrollIntoView: 'npc-msg-' + assistant.id });
        if (cursor < chars.length) {
          this._typeTimer = setTimeout(tick, TYPE_INTERVAL_MS);
        } else if (this._isCurrent(generation)) {
          this._typeTimer = null;
          this.setData({ state: 'DONE', isThinking: false, canSend: !!(this.data.input || '').trim() });
        }
      };
      tick();
    },

    _appendAssistant: function (text, state) {
      const assistant = this._message('assistant', text);
      const messages = this._capMessages((this.data.messages || []).concat(assistant));
      this.setData({
        messages: messages,
        state: state || 'FAILED',
        isThinking: false,
        canSend: !!(this.data.input || '').trim(),
        scrollIntoView: 'npc-msg-' + assistant.id,
      });
    },

    _stateOf: function (payload) {
      if (payload.errorCode === 'RATE_LIMITED') return 'RATE_LIMITED';
      if (payload.errorCode === 'INPUT_BLOCK' || payload.errorCode === 'OUTPUT_BLOCK') return 'BLOCKED';
      if (payload.errorCode === 'REQUEST_IN_PROGRESS' || payload.outcomeStatus === 'PROCESSING') return 'CHECKING';
      return 'FAILED';
    },

    _invalidate: function (showCancelled) {
      const wasActive = this.data.isThinking || this.data.state === 'DELIVERING';
      this._generation = (this._generation || 0) + 1;
      if (this._typeTimer) {
        clearTimeout(this._typeTimer);
        this._typeTimer = null;
      }
      if (this._requestControl && typeof this._requestControl.abort === 'function') this._requestControl.abort();
      this._requestControl = null;
      this._stopVoice();
      if (showCancelled && wasActive) {
        this._track('npc_chat_cancel');
        this.setData({ state: 'CANCELLED', isThinking: false, canSend: !!(this.data.input || '').trim() });
      }
    },

    _resetForClose: function () {
      this._invalidate(false);
      this.setData({
        messages: [], input: '', inputCount: 0, state: 'IDLE', isThinking: false,
        canSend: false, scrollIntoView: '',
      });
    },

    _playVoice: function (audioUrl) {
      if (this.properties.scope !== 'merchant' || !audioUrl) return;
      this._stopVoice();
      const audio = wx.createInnerAudioContext();
      this._voiceAudio = audio;
      audio.src = audioUrl;
      audio.onEnded(() => this._stopVoice());
      audio.onError(() => this._stopVoice());
      audio.play();
    },

    _stopVoice: function () {
      if (!this._voiceAudio) return;
      try { this._voiceAudio.stop(); this._voiceAudio.destroy(); } catch (e) {}
      this._voiceAudio = null;
    },

    _isCurrent: function (generation) {
      return this.properties.show && generation === this._generation;
    },

    _message: function (role, text) {
      this._messageSeq = (this._messageSeq || 0) + 1;
      return { id: Date.now() + '-' + this._messageSeq, role: role, text: text };
    },

    _capMessages: function (messages) {
      return messages.slice(-MAX_VISIBLE_MESSAGES);
    },

    _trackComplete: function (payload) {
      this._track('npc_chat_complete', {
        outcomeStatus: (payload && payload.outcomeStatus) || 'FAILED',
        safetyDecision: (payload && payload.safetyDecision) || 'NOT_RUN',
      });
    },

    _track: function (eventName, extra) {
      analytics.track(eventName, Object.assign({
        bizType: 'roam',
        bizId: Number(this.properties.sessionId) || 0,
      }, extra || {}));
    },
  },
});
