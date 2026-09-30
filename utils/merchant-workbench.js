const { chinaParts } = require('./datetime.js');
function splitPublishedTopics(topics) {
  const topicList = [];
  const freeExploreList = [];

  (topics || []).forEach((topic) => {
    if (Number(topic.productType) === 2) freeExploreList.push(topic);
    else topicList.push(topic);
  });

  return { topicList, freeExploreList };
}

// 工作台行动 checklist。数据源只用既有的
// /api/merchant/todo-summary 字段,不新增接口调用。
// 标签直接挂在 checklist 行内,长度受卡宽约束 ⇒ 用短名(待处理/待核销/待扫码/退款)
const TODO_ITEMS = [
  { key: 'pendingOrders', label: '待处理', action: 'orders' },
  { key: 'pendingVerify', label: '待核销', action: 'verify' },
  { key: 'pendingScanConfirm', label: '待扫码', action: 'scanConfirm' },
  { key: 'refundCount', label: '退款', action: 'refund' },
];
const TODO_SUMMARY_KEYS = TODO_ITEMS.map((item) => item.key).concat('biddingTopics', 'verifiedCount');

// 计数一律取非负整数:后端偶发下发 null / 字符串 / 负数时不能把 NaN 写进大字卡。
function toCount(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.floor(num);
}

function buildTodayBoard(todo) {
  const source = todo || {};
  return {
    // 行动 checklist:只列真有待办的项,零项时由页面走空态
    checklist: TODO_ITEMS
      .map((item) => ({ key: item.key, label: item.label, action: item.action, count: toCount(source[item.key]) }))
      .filter((item) => item.count > 0),
  };
}

// 项目卡只放能按项目归属的待办。退款没有稳定项目外键，因此只进工作台全局售后提醒，
// 不错误分摊到某一张项目卡。
// tone 决定 chip 的语义色(待核销=成功绿 / 待扫码=警告琥珀),与设计稿一致
const CARD_TODO_ITEMS = [
  { key: 'pendingVerify', label: '待核销', tone: 'verify' },
  { key: 'pendingScanConfirm', label: '待扫码', tone: 'scan' },
];

// 项目主键 =(ownerType, ownerId):1 主题 / 2 活动。两者 id 各自独立编号,
// 只拿 id 当键会让 topic#7 和 activity#7 互相串号。
function projectKey(ownerType, ownerId) {
  return String(ownerType) + ':' + String(ownerId);
}

function indexTodoByProject(byProject) {
  const map = {};
  (Array.isArray(byProject) ? byProject : []).forEach((row) => {
    if (row && row.ownerType != null && row.ownerId != null) {
      map[projectKey(row.ownerType, row.ownerId)] = row;
    }
  });
  return map;
}

// 动态只按项目计数:卡上只出一个铃铛角标,正文在「消息与动态」页里看,不在工作台铺开。
function countEventsByProject(events) {
  const map = {};
  (events || []).forEach((event) => {
    if (!event || event.ownerType == null || event.ownerId == null) return;
    const key = projectKey(event.ownerType, event.ownerId);
    map[key] = (map[key] || 0) + 1;
  });
  return map;
}

// 卡面状态签(稿 3910:580):按真实档期判,不恒写「进行中」。
// 档期未知(无 startDate)不给状态 —— 宁可空着,也不编一个状态骗商家(与今日项目同一条纪律)。
// today 缺省用本机日历日,与 isEndedProject 同一兜底;调用方要钉某一天就显式传。
function statusLabelOf(startVal, endVal, today) {
  const start = toDayStr(startVal);
  if (!start) return '';
  const rawEnd = toDayStr(endVal) || start;
  const end = rawEnd < start ? start : rawEnd; // 坏 endDate 退化单日,同 isOnDay
  const day = today || localToday();
  if (day < start) return '未开始';
  if (day > end) return '已结束';
  return '进行中';
}

// 「已结束」的唯一判据(与卡面状态签同一真源,不另算日期):
// 档期未知(startDate 缺失)不算结束 —— 宁可留着让商家自己看,也不静默吞掉一条项目。
function isEndedProject(startVal, endVal, today) {
  return statusLabelOf(startVal, endVal, today || localToday()) === '已结束';
}

// 类目签:主题按 mode(1 城市定向 / 2 自由探索),活动统一「活动」;认不出就不显示
function catLabelOf(mode) {
  if (mode == 1) return '城市定向';
  if (mode == 2) return '自由探索';
  return '';
}

function makeProjectCard(base, todoByProject, eventCount, todoError) {
  const key = projectKey(base.ownerType, base.ownerId);
  const todo = todoByProject[key] || {};
  const parts = CARD_TODO_ITEMS
    .map((item) => ({ key: item.key, label: item.label, tone: item.tone, count: toCount(todo[item.key]) }))
    .filter((item) => item.count > 0);
  // 待办没取到 ≠ 今天没待办。这时卡上这一格**留空**:既不谎报"无待办",
  // 也不在每张卡上写一句报错文案(那是给自己看的日志,不是给商家看的界面)。
  // 失败只由区块顶部那一条重试提示报告,一处就够。
  if (todoError) {
    return Object.assign({}, base, {
      counts: {},
      todoCount: 0,
      todoChips: [],
      todoText: '',
      msgCount: eventCount[key] || 0,
      // 待办没取到 ⇒ 不知道有没有待核销。这时给「承接进度」而不是「去核销」:
      // 猜错的代价不对称 —— 说「去核销」而其实没有可核销的,商家白跑一趟扫码页。
      cardAction: base.role === 'join' ? { key: 'progress', text: '承接进度' } : null,
    });
  }
  const pendingVerify = toCount(todo.pendingVerify);
  return Object.assign({}, base, {
    counts: CARD_TODO_ITEMS.reduce((acc, item) => {
      acc[item.key] = toCount(todo[item.key]);
      return acc;
    }, {}),
    /* 稿 134:185 卡底右边那颗动作:审核中那张写「承接进度 ›」,已确认且有待核销的写「去核销 ›」。
       ⚠️ 只有承接卡有 —— 主办卡在稿 260:277 上底行只有「N 报名 · N 浏览」,没有动作。
          用户 2026-09-10:「卡面动作不是所有的」。
       ⚠️ 「去核销」必须真的进扫码核销。#814 删过一个文案说核销、实际跳台账的假入口,别再犯。 */
    cardAction: base.role === 'join'
      ? (pendingVerify > 0
          ? { key: 'verify', text: '去核销' }
          : { key: 'progress', text: '承接进度' })
      : null,
    todoCount: parts.reduce((sum, item) => sum + item.count, 0),
    // 每件事一枚 chip:标签和数字各自成立,不靠颜色表意(红点只是"今天有事"的信号)
    todoChips: parts,
    todoText: '今日无待办',
    msgCount: eventCount[key] || 0,
  });
}

// 工作台项目卡:承接的主题、主办的主题、主办的活动三种来源合成同一列卡片,
// 活动和主题平起平坐 —— 只有身份(承接/主办)分,不按业务类型分档。
function buildProjectCards(input) {
  const src = input || {};
  const today = src.today || localToday();
  const todoByProject = indexTodoByProject(src.todoByProject);
  const eventCount = countEventsByProject(src.events);
  // byProject 整个缺席 = 后端还是旧版(小程序先于 ECS 上线的窗口)。这时说「今日无待办」
  // 是假的,按「没取到」处理:卡上那格留空。
  const todoUnavailable = src.todoError || !Array.isArray(src.todoByProject);
  const cards = [];
  (src.joinList || []).forEach((item) => {
    cards.push(makeProjectCard({
      key: 'join-' + item.id,
      role: 'join',
      roleName: '承接',
      roleLabel: '我承接的',
      title: item.topicName || item.addressName || '未命名项目',
      meta: item.assignmentText || '查看承接进度',
      /* 稿 134:185(M15)卡底那一行:「承接方 · 幸会咖啡」。
         承接方 = 商家自己报名时填的那个点位名(ViewRegistrationMerchant.addressName)——
         同一条路线上一家商家可以承接多个点位,卡上必须说清这一张是哪一个,
         否则两张卡除了状态徽标以外长得一模一样。缺就整行不出。 */
      acceptorName: item.addressName || '',
      statusLabel: statusLabelOf(item.startDate, item.endDate, today),
      catLabel: catLabelOf(item.mode),
      // 缩略图:承接侧取主题封面(ViewRegistrationMerchant.topicImgUrl,可能是逗号分隔多图)
      thumb: item.topicImgUrl || '',
      id: item.id,
      projectSource: item.projectSource || 'registration',
      ownerType: 1,
      ownerId: item.topicId,
    }, todoByProject, eventCount, todoUnavailable));
  });
  (src.hostList || []).forEach((item) => {
    const isActivity = item.bizType === 'activity';
    cards.push(makeProjectCard({
      key: (isActivity ? 'act-' : 'host-') + item.id,
      role: 'host',
      roleName: '主办',
      roleLabel: '我主办的',
      title: item.titleText,
      meta: item.startDateStr || (isActivity ? '查看报名与核销' : '查看商家、进度与分润'),
      statusLabel: statusLabelOf(item.startTime || item.startDate, item.endTime || item.endDate, today),
      catLabel: isActivity ? '活动' : catLabelOf(item.mode),
      thumb: item.imgUrl || '',
      id: item.id,
      bizType: isActivity ? 'activity' : 'topic',
      ownerType: isActivity ? 2 : 1,
      ownerId: item.id,
    }, todoByProject, eventCount, todoUnavailable));
  });
  return cards;
}

function hasTodoSummaryPayload(todo) {
  if (!todo || typeof todo !== 'object' || Array.isArray(todo)) return false;
  return TODO_SUMMARY_KEYS.every((key) => {
    if (!Object.prototype.hasOwnProperty.call(todo, key)) return false;
    const raw = todo[key];
    if (typeof raw === 'number') return Number.isSafeInteger(raw) && raw >= 0;
    if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) return false;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= 0;
  });
}

// 「今日项目」= 今天真的落在项目档期里,不是列表第一条。
// 日期一律按 'YYYY-MM-DD' 字符串比:后端 ViewRegistrationMerchant 的
// startDate/endDate 就是 @JsonFormat("yyyy-MM-dd") 下发的。转 Date 再比会踩时区
// —— new Date('2026-08-05') 按 UTC 午夜解析,再用本地 getDate() 取值会整体偏一天。
function toDayStr(value) {
  if (!value) return '';
  const matched = String(value).trim().match(/^\d{4}-\d{2}-\d{2}/);
  return matched ? matched[0] : '';
}

// 「今天」取设备本地日历日,不用 toISOString()(那是 UTC,东八区凌晨会退回昨天)。
function localToday(now) {
  const d = now || new Date();
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 今天 ∈ [startDate, endDate]。endDate 缺失 ⇒ 当单日项目,只认 startDate 当天。
// startDate 缺失 ⇒ 档期未知,不算今日:宁可走空态,也不能编一条出来给商家看。
function isOnDay(item, today) {
  const start = toDayStr(item && item.startDate);
  if (!start) return false;
  // endDate 早于 startDate 是脏数据。不夹一下的话区间为空,项目连开场当天都不显示 ——
  // 静默消失比显示错误更难被发现,所以坏 endDate 一律退化成单日。
  const rawEnd = toDayStr(item && item.endDate) || start;
  const end = rawEnd < start ? start : rawEnd;
  return start <= today && today <= end;
}

// 同一天命中多条时取最早开始的那条(先开场的先干)。零命中返回 null,由页面走空态。
function pickTodayProject(list, today) {
  const day = today || localToday();
  const hits = (list || []).filter((item) => isOnDay(item, day));
  if (!hits.length) return null;
  return hits.reduce((a, b) => (toDayStr(a.startDate) <= toDayStr(b.startDate) ? a : b));
}

// 2026-09-23 用户裁决:工作台项目卡都是已确定接待的项目,「本站可接待」这种状态字没有信息量;
// 俱乐部要来时,写的是「谁、哪天几点到」。runs = /api/merchant/upcoming-runs(已按开始时间升序、
// 只含本商家中标主题),按主题取最近一场「俱乐部场次且已有人付款」;有「预计到店」区间用区间起点,
// 否则用场次开始时间。没俱乐部、或还没人付款的场次不算「俱乐部要来」,不写。
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];
function visitTextOf(run) {
  if (!run) return '';
  const p = chinaParts(run.arrivalStart || run.startTime);
  if (!p) return '';
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  return run.clubName + ' · ' + p.month + '月' + p.day + '日 周' + WEEKDAY[p.weekday] + ' ' + pad(p.hours) + ':' + pad(p.minutes) + ' 到店';
}

function attachVisitTexts(cards, runs) {
  const firstByTopic = {};
  (Array.isArray(runs) ? runs : []).forEach((run) => {
    const key = run && run.topicId != null ? String(run.topicId) : '';
    if (!key || firstByTopic[key] || !run.clubName || !(Number(run.paidCount) > 0)) return;
    firstByTopic[key] = run;
  });
  return (Array.isArray(cards) ? cards : []).map((card) => {
    if (!card || card.role !== 'join') return card;
    return Object.assign({}, card, { visitText: visitTextOf(firstByTopic[String(card.ownerId)]) });
  });
}

module.exports = {
  attachVisitTexts,
  splitPublishedTopics,
  buildTodayBoard,
  buildProjectCards,
  hasTodoSummaryPayload,
  pickTodayProject,
  localToday,
  isEndedProject,
  // 卡面状态签的单一真源:商家工作台与「我的」主页项目预览都从这里取,别各写一套日期判定。
  statusLabelOf,
};
