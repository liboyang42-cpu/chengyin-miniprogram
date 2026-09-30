// cy-merchant-card · 商家卡(DS §5.3,2026-08-20 重设计:封面头图 + cityRole + 服务行)。
// variant=list:玩家发现卡;variant=venue:俱乐部找场地卡(承接档案替换服务行)。
// 位置行只在 verified(location_verified)非 0 且有 distance 时出现——0 表示压根没坐标,禁止渲染 0.0km。
//
// CU-M-61:封面/Logo 无图时的兜底图标按**品类**给(utils/category-icon.js),不再全员
// 一只咖啡杯 —— 书店和花店曾长得一模一样。品类拿不到时退回中性店铺图标,不冒充品类。
const { resolveCategoryIcon } = require('../../../utils/category-icon.js');

Component({
  properties: {
    variant: { type: String, value: 'list' },     // list | venue
    size: { type: String, value: 'md' },          // 兼容旧调用,当前无视觉分支
    status: { type: String, value: 'open' },      // open|closed|unverified|partner|node|loading|disabled|none(不显状态芯片,给数据源没有营业状态的场景如 relation)
    partner: { type: Boolean, value: false },     // 合作商家金角标(status=partner 时自动置真,兼容旧调用)
    cover: { type: String, value: '' },           // coverImage / gallery[0];空走纯色底+品类图标
    logo: { type: String, value: '' },
    categoryName: { type: String, value: '' },    // 品类名;无图时按它选图标,空=中性店铺图标
    name: { type: String, value: '' },
    cityRole: { type: String, value: '' },        // 城瘾独有:比 slogan 优先占位
    desc: { type: String, value: '' },            // slogan,一行截断,空不占位
    statusText: { type: String, value: '' },
    distance: { type: String, value: '' },
    district: { type: String, value: '' },
    verified: { type: null, value: null },        // location_verified;0/null 时距离整行不画
    tags: { type: Array, value: [] },
    serviceTag: { type: String, value: '' },      // 服务类型短标:体验 / 服务 / 券
    serviceText: { type: String, value: '' },     // 商家愿意提供的服务;空 = 无服务,整行隐藏
    actionText: { type: String, value: '去看看' },
    interactive: { type: Boolean, value: false },
    // venue 承接档案(/api/club/merchants 全量实体字段)
    capacity: { type: null, value: null },
    availableTime: { type: String, value: '' },
    chargeType: { type: null, value: null },      // 0 免费 / 1 收费
    suitTypes: { type: String, value: '' },       // suitActivityTypes 原串,组件截前 2 段
    coopOpen: { type: null, value: null },        // venue:0 → 整卡降饱和,按钮「暂不接洽」
  },
  data: { _pl: '', _pi: '', _ptone: 'muted', _partner: false, _tags: [], _meta: '', _suit: '', _catIcon: resolveCategoryIcon('') },
  observers: {
    'status, partner': function (s, p) {
      const m = {
        'open': ['营业中', 'clock', 'success', false],
        'closed': ['已打烊', '', 'muted', false],
        'unverified': ['待认证', 'warning', 'warning', false],
        'partner': ['营业中', 'clock', 'success', true],
        'node': ['线路节点', 'flag', 'info', false],
      }[s] || ['', '', 'muted', false];
      this.setData({ _pl: m[0], _pi: m[1], _ptone: m[2], _partner: p || m[3] });
    },
    tags(t) { this.setData({ _tags: (t || []).slice(0, 3) }); },
    categoryName(name) { this.setData({ _catIcon: resolveCategoryIcon(name) }); },
    'distance, district, statusText, verified': function (dist, distr, st, v) {
      // verified 为 0/null 时距离作废;商圈与营业文案不依赖坐标
      const useDist = dist && v != null && Number(v) !== 0;
      const parts = [];
      if (useDist) parts.push(dist);
      if (distr) parts.push(distr);
      if (st) parts.push(st);
      this.setData({ _meta: parts.join(' · ') });
    },
    suitTypes(s) {
      // 只按逗号/分号/顿号/斜杠切,不按空格 ——「City Walk」这类带空格短语是一个类型
      const parts = String(s || '').split(/[,;、，；\/]+/).map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 2);
      this.setData({ _suit: parts.join(' · ') });
    },
  },
  methods: {
    onTap() { const s = this.data.status; if (s !== 'disabled' && s !== 'loading') this.triggerEvent('tap'); },
    onAction() { this.triggerEvent('action'); },
    onService() { this.triggerEvent('service'); },
  },
});
