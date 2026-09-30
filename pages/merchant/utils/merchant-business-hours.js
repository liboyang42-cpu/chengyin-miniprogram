const {formatHM, minutesOfDay} = require('../../../utils/time-picker-options');
const LABELS = ['一','二','三','四','五','六','日'];
function parse(value) {
  const text = String(value || '');
  const match = text.match(/(\d{2}):(\d{2})\s*[-–]\s*(?:次日)?(\d{2}):(\d{2})/);
  const all = /周一至周日|每天|每日/.test(text);
  const daysText = text.split(/\d{2}:/)[0];
  // 旧值只有「09:30-21:00」这样不带周几前缀的时间段。后端 TopicRouteCandidatePolicy.isBusinessDay
  // 把空前缀判成每天营业,回填必须同口径 —— 否则商家一进「经营时间」就是七天全灭、原样点完成被拒。
  const everyDay = !text || all || (!!text.trim() && !daysText.trim());
  return {days: LABELS.map(label => ({label,on: everyDay || daysText.indexOf(label) >= 0})),
    start: match ? formatHM(match[1],match[2]) : '10:00', end:match ? formatHM(match[3],match[4]) : '22:00'};
}
function serialize(draft) {
  const selected = draft.days.filter(day => day.on);
  if (!selected.length) return {error:'至少选择一个营业日'};
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.end)) return {error:'请选择有效时间'};
  const start = minutesOfDay(...draft.start.split(':')), end = minutesOfDay(...draft.end.split(':'));
  if (start === end) return {error:'开始与结束时间不能相同'};
  const days = selected.length === 7 ? '周一至周日' : '周' + selected.map(x=>x.label).join('、');
  return {value: days + ' ' + draft.start + '-' + (end < start ? '次日' : '') + draft.end, overnight: end < start};
}
module.exports = {parse,serialize};
