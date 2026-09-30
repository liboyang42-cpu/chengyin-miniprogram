// 状态编排层：统一全页 / 大区块状态的语义、动作和无障碍文案。
// CTA 始终由页面显式传入；默认表只描述事实，不制造没有处理方的按钮。
const STATE_DEFAULTS = {
  empty:           { renderer: 'empty', emptyKind: 'empty',           title: '暂无内容',       sub: '这里还没有内容' },
  loading:         { renderer: 'empty', emptyKind: 'loading',         title: '加载中',         sub: '' },
  offline:         { renderer: 'empty', emptyKind: 'offline',         title: '网络好像断开了', sub: '检查网络连接后重试' },
  network:         { renderer: 'empty', emptyKind: 'offline',         title: '网络没连上',     sub: '连接恢复后可继续' },
  'no-permission': { renderer: 'empty', emptyKind: 'no-permission',   title: '暂时不能查看',   sub: '当前账号没有查看权限' },
  'not-started':   { renderer: 'empty', emptyKind: 'not-started',     title: '还没开始',       sub: '开始后内容会显示在这里' },
  'missing-param': { renderer: 'empty', emptyKind: 'missing-param',   title: '页面参数不完整', sub: '这个链接可能已失效，返回上一页重新进入' },
  data:            { renderer: 'error', emptyKind: '',                title: '这部分没加载成功', sub: '已加载的内容仍可查看' },
  error:           { renderer: 'error', emptyKind: '',                title: '出错了',         sub: '网络开了点小差，请稍后再试' },
};

// 整页「加载没成功」类:用户在这页已无事可做,页面传 auto-back 时改零钮 fail 半屏 + 自动返回。
// 空态 / 加载中 / 无权限(常带「去登录」真出路)不在此列。
const AUTO_BACK_KINDS = { error: 1, data: 1, network: 1, offline: 1, 'missing-param': 1 };
const wantsAutoBack = (autoBack, kind) => !!autoBack && !!AUTO_BACK_KINDS[kind];

Component({
  properties: {
    kind: { type: String, value: 'empty' },
    title: { type: String, value: '' },
    sub: { type: String, value: '' },
    primary: { type: String, value: '' },
    secondary: { type: String, value: '' },
    fill: { type: Boolean, value: false },
    size: { type: String, value: '' },
    // inherit | player | merchant；视觉颜色继续只消费调用上下文里的全局 token。
    theme: { type: String, value: 'inherit' },
    aria: { type: String, value: '' },
    autoBack: { type: Boolean, value: false },
    // 页面有自己的「该去的页面」:传 custom-back 并 bind:back
    customBack: { type: Boolean, value: false },
  },
  data: {
    _renderer: 'empty',
    _emptyKind: 'empty',
    _title: '暂无内容',
    _sub: '这里还没有内容',
    _primary: '',
    _autoBack: false,
  },
  observers: {
    'kind, title, sub, aria, primary': function (kind, title, sub, aria, primary) {
      const defaults = STATE_DEFAULTS[kind] || STATE_DEFAULTS.error;
      const resolvedTitle = title || defaults.title;
      const resolvedSub = sub || defaults.sub;
      let action = String(primary || '').trim();
      if (action === resolvedTitle || action === '出错了') {
        action = (defaults.renderer === 'error' || kind === 'network' || kind === 'offline') ? '重试' : '';
      }
      this.setData({
        _renderer: defaults.renderer,
        _emptyKind: defaults.emptyKind,
        _title: resolvedTitle,
        _sub: resolvedSub,
        _primary: action,
        _autoBack: wantsAutoBack(this.data.autoBack, kind),
      });
    },
    // 与上面分开监听:不赌两组属性在初始化时的赋值先后
    'autoBack': function (autoBack) {
      this.setData({ _autoBack: wantsAutoBack(autoBack, this.data.kind) });
    },
  },
  methods: {
    onPrimary() { this.triggerEvent('primary'); },
    onSecondary() { this.triggerEvent('secondary'); },
    onBack() { this.triggerEvent('back'); },
  },
});
