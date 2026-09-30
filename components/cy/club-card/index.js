// cy-club-card · 俱乐部卡(2026-08-20 重设计)。收敛 pages/talent/list 三份内联拷贝为单组件。
// 关键闸:level=0 不显徽章(禁 Lv.0/空星);memberCount/topicCount 为 null 整段不渲染成 0;
// 能力芯片只显为 1 的且 ≤3;权益行只在「未加入且开了成员优先报名」时出现(加入本身免费)。
// 按钮三态:isOwner=管理 / isJoined=进入 / 其余按 joinPolicy 显「申请加入(需审批)/加入」。
Component({
  properties: {
    club: { type: Object, value: null },
    loading: { type: Boolean, value: false },
    interactive: { type: Boolean, value: false },
    // cta:覆盖按钮为单一动作(如商家合作页「发起合作」),act 固定 'cta',三态逻辑失效
    cta: { type: String, value: '' },
  },
  data: { _sub: '', _data: '', _abilities: [], _tags: [], _perk: '', _btn: null, _leaderMeta: '' },
  observers: {
    'club, cta': function (c, cta) {
      if (!c) return;
      const subParts = [];
      if (c.clubType) subParts.push(c.clubType);
      if (c.city || c.address) subParts.push(c.city || c.address);
      const dataParts = [];
      if (c.memberCount != null) dataParts.push(c.memberCount + ' 位成员');
      if (c.topicCount != null) dataParts.push(c.topicCount + ' 个近期团');
      const abilities = [];
      if (Number(c.canDesignRoute) === 1) abilities.push('能设计路线');
      if (Number(c.canNpc) === 1) abilities.push('能出 NPC');
      if (Number(c.canMerchantCoop) === 1) abilities.push('能对接商家');
      if (Number(c.hasGuideCert) === 1) abilities.push('导游资质');
      const tags = []
        .concat(splitList(c.keywords))
        .concat(splitList(c.tags))
        .filter(Boolean).slice(0, 3);
      const joined = c.isJoined === true || c.isJoined === 1;
      const owner = c.isOwner === true || c.isOwner === 1;
      const perk = (!owner && !joined && Number(c.prioritySignupEnabled) === 1)
        ? '免费加入 · 成员优先报名' : '';
      const btn = cta
        ? { label: cta, act: 'cta', kind: 'solid' }
        : owner
          ? { label: '管理', act: 'manage', kind: 'ghost' }
          : joined
            ? { label: '进入', act: 'enter', kind: 'secondary' }
            : { label: Number(c.joinPolicy) === 1 ? '申请加入' : '加入', act: 'join', kind: 'solid' };
      const lm = [];
      if (c.leaderLevel) lm.push('L' + c.leaderLevel + ' 领队');
      const firstLeaderTag = splitList(c.leaderTags)[0];
      if (firstLeaderTag) lm.push(firstLeaderTag);
      this.setData({
        _sub: subParts.join(' · '),
        _data: dataParts.join(' · '),
        _abilities: abilities.slice(0, 3),
        _tags: tags,
        _perk: perk,
        _btn: btn,
        _leaderMeta: lm.join(' · '),
      });
    },
  },
  methods: {
    onTap() { if (!this.data.loading) this.triggerEvent('tap'); },
    onAction() {
      const b = this.data._btn;
      if (b) this.triggerEvent('action', { act: b.act });
    },
  },
});

// keywords/tags 库里存法不一(CSV / 顿号 / JSON 数组串),统一解析,解析不出当没有。
// 只按逗号/分号/顿号切,不按空格 —— 「带队 15 场」这类带空格的短语是一个标签
function splitList(s) {
  if (!s) return [];
  if (Array.isArray(s)) return s;
  const str = String(s).trim();
  if (str[0] === '[') {
    try { const a = JSON.parse(str); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  return str.split(/[,;、，；]+/).map(function (x) { return x.trim(); }).filter(Boolean);
}
