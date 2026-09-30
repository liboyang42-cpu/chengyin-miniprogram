'use strict';

// 本表解释的是 official_event.status。cms_activity.status 是**审核码**(0 待审/1 通过/2 未过),
// 不适用本表 —— 活动那一侧读后端 ActivityLifecycle 算好的 state/stateText(CU-M-106:
// 拿审核码 1 查这张表会得到「即将开始」,而同一行在列表按档期说「进行中」)。
// 官方活动在公开视图与发布者视图存在一处真实文案差异：status=1 分别是“即将开始”与“待发布”。
//
// variant 用 cy-badge 的 variant 名(neutral|info|success|warning|danger|rare)。
// 2026-09-01:原来写的是 cy-tag 的名字(green/blue/done/mono),状态标签迁到 cy-badge 后
// 两套名字对不上。改在这里而不是逐个调用点映射 —— 这张表是 5 个消费方的唯一真源。
// variant 按规范真源 §4 的状态色映射（2026-08-05 用户裁决）：
//   进行中=绿 / 未开始=灰 / 已发布=蓝 / 已结束=灰 / 已完成=红 / 取消=红
// 裁决没逐一点名的几档，按同一把尺子归类：
//   草稿、结算中、已下线 → 中性（done/mono），它们都不是"正在进行"也不是终止失败态
//   报名中 → 蓝，它是"已发布、对外可见"这一类
const STATUS = {
  0: { publicText: '', ownerText: '草稿', variant: 'neutral', live: false },
  1: { publicText: '即将开始', ownerText: '待发布', variant: 'neutral', live: false },
  2: { publicText: '报名中', ownerText: '报名中', variant: 'info', live: true },
  3: { publicText: '进行中', ownerText: '进行中', variant: 'success', live: true },
  4: { publicText: '结算中', ownerText: '结算中', variant: 'neutral', live: false },
  5: { publicText: '已结束', ownerText: '已结束', variant: 'neutral', live: false },
  6: { publicText: '已结束', ownerText: '已结束', variant: 'neutral', live: false },
  9: { publicText: '已下线', ownerText: '已下线', variant: 'neutral', live: false }
};

function activityStatusMeta(status, audience) {
  const item = STATUS[Number(status)];
  if (!item) return { text: '', variant: 'neutral', live: false };
  return {
    text: audience === 'owner' ? item.ownerText : item.publicText,
    variant: item.variant,
    live: item.live
  };
}

function activityStatusText(status, audience) {
  return activityStatusMeta(status, audience).text;
}

module.exports = { activityStatusMeta, activityStatusText };
