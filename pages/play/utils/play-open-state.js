/**
 * 营业态换算的单一真源:businessTime / openStatus → 展示用 openText / openDot。
 *
 * 为什么抽出来:2026-08-14 自审实证——`normNode()` 产出的是 `businessTime` 和
 * `openStatus`,**从来不产 `openText`**;而 poiCard(index.js:470)、mode2 六宫格瓦片
 * 和新的商家权益页都在读 `n.openText || ''`,于是那几处营业信息**永久不显示**。
 * 真正的换算逻辑当时只长在 `openSheet()` 内部,别的调用方拿不到 ⇒ 抄一份就多一处会漂的副本。
 *
 * 规则(与原 openSheet 内联逻辑逐条一致,行为不变):
 *   1. 后端三态 `openStatus`(营业中/即将打烊/已打烊)优先;
 *   2. 后端没给,用 `businessTime` 走客户端两态兜底;
 *   3. 都解析不出 ⇒ openText 为空,调用方据此整行不渲染(不编「营业时间未知」)。
 */
const geo = require('../../../utils/geo.js');

const OPEN_OK = 'var(--cy-color-play-accent)';
const OPEN_SOON = 'var(--cy-color-play-accent)';
const OPEN_OFF = 'var(--cy-color-text-tertiary)';

/**
 * @param {object} node 至少含 businessTime / openStatus
 * @param {number} [nowMinutes] 当天分钟数;不传取当前时刻(便于测试注入固定时刻)
 * @returns {{openText: string, openCol: string, openDot: string}} openText 为空表示「不显示这一行」
 */
function resolveOpenState(node, nowMinutes) {
  if (!node) return { openText: '', openCol: '', openDot: '' };
  const status = node.openStatus;
  if (status) {
    if (status === '营业中') return { openText: status, openCol: OPEN_OK, openDot: OPEN_OK };
    if (status === '即将打烊') return { openText: status, openCol: OPEN_SOON, openDot: OPEN_SOON };
    return { openText: status, openCol: OPEN_OFF, openDot: OPEN_OFF };
  }
  const minutes = typeof nowMinutes === 'number'
    ? nowMinutes
    : (function () { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }());
  const inWindow = geo.bizWindowState(node.businessTime, minutes);
  if (inWindow === true) return { openText: '营业中', openCol: OPEN_OK, openDot: OPEN_OK };
  if (inWindow === false) return { openText: '已打烊', openCol: OPEN_OFF, openDot: OPEN_OFF };
  // null:businessTime 解析不出 —— 保持空,让调用方整行不渲染
  return { openText: '', openCol: '', openDot: '' };
}

module.exports = { resolveOpenState, OPEN_OK, OPEN_SOON, OPEN_OFF };
