const modal = require('../../../utils/modal.js');
const { isPoolList, decoratePool } = require('../../../utils/coop-invite-view.js');
const cyToast = require('../../../utils/toast.js');
const motion = require('../../../utils/motion.js');
const { readReducedMotion } = require('../../../utils/motion-preference.js');
const { getScene } = require('../../../utils/scene-registry.js');
// 城瘾 · 俱乐部详情页(方案B:俱乐部=经典定向带团组织)
// 俱乐部信息 + TA 办的经典定向团(/api/club/topics)+ 成员;团卡片点进主题报名页复用现有报名/扫码。
const { toTimestamp } = require('../../../utils/datetime');
const app = getApp();
function aiDraftStorageKey() {
  const memberId = app.getUserID && app.getUserID();
  return memberId === null || memberId === undefined || memberId === ''
    ? '' : 'ai_topic_draft:m' + memberId;
}
const mockData = require('../../../utils/mockData.js');
const { aiPlanToDraft } = require('../utils/aiPlanToDraft.js');
const { buildGroupCodeIssuePayload, listGroupCodeActivities } = require('../../../utils/group-code-session.js');
const { merchantHomeUrl } = require('../../../utils/merchant-home-link.js');
const ticketSource = require('../../../utils/ticket-source.js');
// CU-C-38:主题分享卡的标题/封面口径与主题详情页共用一份实现
const { buildTopicShare, resolveTopicCover } = require('../../../utils/topic-share.js');
const { isRecord, bizFailureMessage } = require('../../../utils/response-shape.js');
const { buildMonthCalendar, shiftMonth } = require('../utils/club-event-calendar.js');
// 帖文卡的 variant 判定与广场共用一份,别在这儿复制
const { isCompletedShare, hasFeedPlayCover } = require('../../../utils/feed-play-card.js');
// CU-C-60:扫码核销复用全站唯一的路由表(utils/verification-scan)与写闸(防重提/结果未知),
// 不在本页另写一套解析。
const { resolveVerificationScan } = require('../../../utils/verification-scan.js');
const { createWriteActionWorkflow } = require('../../../utils/write-action-workflow.js');
const loading = require('../../../utils/loading.js');
const { postExcerpt } = require('../../../utils/danger-actions.js');

// AI 策划:频控超限文案(后端运行时拼 dailyLimit,数字随配置变)→ 只做包含匹配
const AI_QUOTA_MARK = '今日AI次数已用完';
const AI_IDEA_CHIPS = ['静安 情侣 夜间 Citywalk 90分钟', '外滩 亲子 半天 城市打卡', '苏州河 摄影 徒步 2小时'];
const RECEIVED_STATUS_TEXT = ['待确认', '已接受', '已拒绝', '已取消', '已顶替', '已过期'];
const INVITE_FEEDBACK_STATUS = [
  { text: '待回应', key: 'pending' },
  { text: '已接受', key: 'accepted' },
  { text: '已拒绝', key: 'rejected' },
  { text: '已取消', key: 'cancelled' },
  { text: '已顶替', key: 'replaced' },
  { text: '已过期', key: 'expired' },
];
const OWNER_STAGE_COPY = {
  publish: { label: '发布主题', hint: '先发布一个俱乐部项目' },
  invite: { label: '邀请商家', hint: '选择一个项目，开始对接商家' },
  pending: { label: '查看邀请进度', hint: '邀请已发出，等待商家回应' },
  accepted: { label: '管理项目', hint: '商家已接受，进入项目主办视图' },
  // CU-C-89:这个阶段是**俱乐部级**的(任意一个项目被承接就算到),没有单一「该项目」,
  // 入口也只能打开全团场次清单 —— 文案不能再按单项目口吻写,否则多项目的主理人认错待办对象。
  executionAccepted: { label: '活动运营', hint: '已承接项目，可查看全部项目的场次运营' },
  loading: { label: '读取管理进度…', hint: '正在核对项目与邀请状态' },
  error: { label: '重试管理进度', hint: '暂时无法确认当前阶段' },
  // 管理员没有经营阶段:邀商家/发布主题/开一场都是主理人的事。
  // ★ 不给它一个终态,ownerStage 会永远停在 'loading' —— 管理员打开管理 tab
  //   看到的就是一张标题写着「读取管理进度…」的卡,永远转不完(2026-08-26 修)。
  admin: { label: '带好眼下这一场', hint: '你能管人和执行:审批入会、管成员、看名册、出团码、进导演台。' },
};
// 带队进度时间线的四站,与上面的 OWNER_STAGE_COPY 同一台阶段机,只是换成「走到哪了」的说法。
const LEAD_STAGE_STATIONS = ['发布主题', '邀请商家', '等待商家回应', '商家已接受'];
const LEAD_STAGE_INDEX = { publish: 0, invite: 1, pending: 2, accepted: 3 };
const PUBLIC_TABS = [
  { key: 'posts', label: '帖子' },
  { key: 'events', label: '活动' },
  { key: 'overview', label: '概览' },
];
const EVENT_ROLE_PERMISSIONS = {
  EVENT_LEAD: ['club:read', 'club:activity:read', 'club:event:operate', 'club:event:checkin'],
  EVENT_CHECKIN: ['club:read', 'club:activity:read', 'club:event:checkin'],
};

function dateOf(s) { return (s && typeof s === 'string') ? s.slice(0, 10) : ''; }
// CU-C-82:举报入口把目标显示名带进治理页。只传一行短文案,截断由这里兜住。
function reportTargetName(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
}
function jsonBody(data) { return JSON.stringify(data || {}); }
function jsonHeader() { return { 'Content-Type': 'application/json' }; }
function clientRequestId(prefix) {
  return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}
const CLUB_POST_REQUEST_INTENTS_KEY = 'club_post_request_intents_v1';
const CLUB_POST_REQUEST_INTENT_TTL_MS = 24 * 60 * 60 * 1000;
function requestIntentHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
function clubPostRequestIntentsKey() {
  const memberId = app.getUserID && app.getUserID();
  return memberId === null || memberId === undefined || memberId === ''
    ? '' : CLUB_POST_REQUEST_INTENTS_KEY + ':m' + memberId;
}
function readClubPostRequestIntents() {
  try {
    wx.removeStorageSync(CLUB_POST_REQUEST_INTENTS_KEY);
    const key = clubPostRequestIntentsKey();
    const value = key ? wx.getStorageSync(key) : null;
    return isRecord(value) ? value : {};
  } catch (ignored) { return {}; }
}
function writeClubPostRequestIntents(intents) {
  try {
    const key = clubPostRequestIntentsKey();
    if (!key) return;
    if (Object.keys(intents).length) wx.setStorageSync(key, intents);
    else wx.removeStorageSync(key);
  } catch (ignored) {}
}
function planClubPostRequestIntent(action, payload, memory) {
  const signature = JSON.stringify(payload);
  const key = [action, payload.clubId, payload.id, requestIntentHash(signature)].join(':');
  const remembered = memory && memory[key];
  if (remembered && remembered.signature === signature) return remembered;
  const intents = readClubPostRequestIntents();
  const stored = intents[key];
  if (isRecord(stored) && stored.signature === signature
      && typeof stored.requestId === 'string'
      && /^[A-Za-z0-9._:-]{1,64}$/.test(stored.requestId)
      && Number(stored.expiresAt) > Date.now()) {
    const restored = { key, signature, requestId: stored.requestId };
    if (memory) memory[key] = restored;
    return restored;
  }
  if (Object.prototype.hasOwnProperty.call(intents, key)) delete intents[key];
  const intent = { key, signature, requestId: clientRequestId(action) };
  intents[key] = {
    signature,
    requestId: intent.requestId,
    expiresAt: Date.now() + CLUB_POST_REQUEST_INTENT_TTL_MS,
  };
  writeClubPostRequestIntents(intents);
  if (memory) memory[key] = intent;
  return intent;
}
function clearClubPostRequestIntent(intent, memory) {
  if (!intent || !intent.key) return;
  if (memory) delete memory[intent.key];
  const intents = readClubPostRequestIntents();
  if (!Object.prototype.hasOwnProperty.call(intents, intent.key)) return;
  delete intents[intent.key];
  writeClubPostRequestIntents(intents);
}
function isExplicitClientFailure(res, statusCode) {
  const status = Number(statusCode || (res && res.code));
  return Number.isInteger(status) && status >= 400 && status < 500;
}
function positiveId(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
function shapeEventAccesses(raw) {
  if (raw == null) return { rows: [], byActivity: {}, byTopic: {} };
  if (!Array.isArray(raw)) return null;
  const rows = [];
  const byActivity = {};
  const byTopic = {};
  for (let i = 0; i < raw.length; i += 1) {
    const row = raw[i];
    const activityId = positiveId(row && row.activityId);
    const topicId = positiveId(row && row.topicId);
    const roleCodes = row && row.roleCodes;
    const permissions = row && row.permissions;
    if (!activityId || !topicId || !Array.isArray(roleCodes) || roleCodes.length === 0
        || !Array.isArray(permissions)
        || !roleCodes.every(function (item) { return typeof item === 'string'; })
        || !permissions.every(function (item) { return typeof item === 'string'; })
        || !roleCodes.every(function (item) { return !!EVENT_ROLE_PERMISSIONS[item]; })
        || roleCodes.some(function (item, index) { return roleCodes.indexOf(item) !== index; })
        || permissions.some(function (item, index) { return permissions.indexOf(item) !== index; })
        || byActivity[String(activityId)]) return null;
    const expectedPermissions = [];
    roleCodes.forEach(function (roleCode) {
      EVENT_ROLE_PERMISSIONS[roleCode].forEach(function (permission) {
        if (expectedPermissions.indexOf(permission) < 0) expectedPermissions.push(permission);
      });
    });
    if (permissions.length !== expectedPermissions.length
        || !expectedPermissions.every(function (permission) {
          return permissions.indexOf(permission) >= 0;
        })) return null;
    const shaped = { activityId, topicId, roleCodes: roleCodes.slice(), permissions: permissions.slice() };
    rows.push(shaped);
    byActivity[String(activityId)] = shaped;
    byTopic[String(topicId)] = true;
  }
  return { rows, byActivity, byTopic };
}
function localDateText(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function isSuccess(res) { return !!res && (res.code === '200' || res.code === 200); }


function metricInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function metricRate(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

function shapeClubStats(raw, expectedClubId) {
  if (!isRecord(raw) || String(raw.clubId) !== String(expectedClubId) || !Array.isArray(raw.topics)) return null;
  const topicCount = metricInteger(raw.topicCount);
  const participants = metricInteger(raw.participants);
  const completed = metricInteger(raw.completed);
  const overallRate = metricRate(raw.overallRate);
  if (topicCount === null || participants === null || completed === null || overallRate === null) return null;
  const topics = [];
  for (let i = 0; i < raw.topics.length; i += 1) {
    const row = raw.topics[i];
    if (!isRecord(row)) return null;
    const rowParticipants = metricInteger(row.participants);
    const rowCompleted = metricInteger(row.completed);
    const completionRate = metricRate(row.completionRate);
    if (row.topicId == null || rowParticipants === null || rowCompleted === null || completionRate === null) return null;
    topics.push({
      topicId: row.topicId,
      name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : '未命名项目',
      participants: rowParticipants,
      completed: rowCompleted,
      completionRate,
      completionRateText: completionRate.toFixed(1) + '%',
    });
  }
  return {
    topicCount,
    participants,
    completed,
    overallRate,
    overallRateText: overallRate.toFixed(1) + '%',
    topics: topics.slice(0, 5),
  };
}

function decorateMessage(item) {
  const partner = item.partner || {};
  return Object.assign({}, item, {
    statusText: RECEIVED_STATUS_TEXT[Number(item.status)] || '合作动态',
    partnerName: partner.name || item.topicName || '俱乐部合作',
    timeText: item.createTime ? String(item.createTime).slice(5, 16) : '',
  });
}

function decorateInviteFeedback(item) {
  const partner = item.partner || {};
  const status = INVITE_FEEDBACK_STATUS[Number(item.status)] || { text: '状态待确认', key: 'unknown' };
  return Object.assign({}, item, {
    statusText: status.text,
    statusClass: status.key,
    partnerName: partner.name || '合作对象待补充',
    topicText: item.topicName || (item.topicId ? '主题 #' + item.topicId : '活动待补充'),
    timeText: item.createTime ? String(item.createTime).slice(5, 16) : '',
  });
}

// 主理人 L1-L5 等级对外文案(继承展示;level=0 不显示)
const LEVEL_LABELS = ['', 'L1 新手主理人', 'L2 稳定主理人', 'L3 成熟主理人', 'L4 城市运营者', 'L5 区域策划方'];
function levelTextOf(lv) { return (lv && LEVEL_LABELS[lv]) ? LEVEL_LABELS[lv] : (lv ? ('Lv.' + lv) : ''); }

// —— N2 活动卡 / N3 概览的派生文案(Figma 281:360、20:137)——
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// 「周四 8月29日, 18:30」。拿不到可解析的时间就退回原始 dateText,不吞掉信息。
function eventTimeText(raw) {
  const ts = raw ? toTimestamp(String(raw)) : 0;
  if (!ts) return raw ? String(raw).slice(0, 16).replace('T', ' ') : '';
  const d = new Date(ts);
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  return WEEKDAYS[d.getDay()] + ' ' + (d.getMonth() + 1) + '月' + d.getDate() + '日, '
    + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// 状态色沿用稿:招募中/审核中 = warning、进行中 = success、已结束 = tertiary。
// ⚠️ 只用本页真拿得到的字段判:ended(后端 endDate 比出来的)+ startDate。
// 审核中 / 未通过 两态 /api/club/topics 目前不回,不臆造。
function topicStatusOf(t) {
  if (t.ended) return { statusText: '已结束', statusTone: 'muted' };
  const start = t.startDate ? toTimestamp(String(t.startDate)) : 0;
  if (start && start <= Date.now()) return { statusText: '进行中', statusTone: 'live' };
  return { statusText: '招募中', statusTone: 'open' };
}

// 稿 N2 20:52 的三列数字块。这三个数 /api/club/topics 一直都在回
// (它整个 CmsTopic 端回来),只是前端从来没读过 —— 不是缺字段。
// ⚠️ 算不出来的给空,不给 0:「0 站」会被读成「这条路线没有站点」。
function topicStatOf(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  return unit === 'km' ? (Math.round(n * 10) / 10) + 'km' : String(n);
}

function decorateTopicCard(t) {
  return Object.assign({}, t, topicStatusOf(t), {
    timeText: eventTimeText(t.startDate),
    // productType 是现行真源，旧数据缺字段时才兼容 mode。
    categoryText: Number(t.productType == null ? t.mode : t.productType) === 2 ? '自由探索' : '城市定向',
    signupText: topicStatOf(t.signupCount),
    stationText: topicStatOf(t.locationCount),
    mileageText: topicStatOf(t.totalMileage, 'km'),
  });
}

// 榜单折叠(Figma 23:68「⋯ 中间 8 人」):前 3 + 折叠行 + 我周边/末 3。
// 后端回的是完整名次表,折叠在前端做 —— 换排序不用等接口改。
function foldLeaderboard(rows, myMemberId) {
  const list = (Array.isArray(rows) ? rows : []).map((r, i) => Object.assign({}, r, { rank: i + 1, isMe: String(r.memberId) === String(myMemberId) }));
  if (list.length <= 6) return list;
  let tailStart = list.length - 3;
  const myIdx = list.findIndex((r) => r.isMe);
  if (myIdx >= 3) tailStart = Math.min(tailStart, Math.max(3, myIdx - 1));
  const hidden = tailStart - 3;
  const out = list.slice(0, 3);
  if (hidden > 0) out.push({ gap: true, memberId: 'gap', hiddenCount: hidden });
  return out.concat(list.slice(tailStart));
}

// CU-C-72(9-25 裁决:按单个榜剔除):后端每个榜只列该榜成绩>0 的成员,
// 榜为空 = 真的该榜这一项没人有成绩。空态文案按当前榜各说一句,口径一致。
function leaderboardEmptyTitle(sortBy) {
  if (sortBy === 'mileage') return '本周还没有人跑出里程';
  if (sortBy === 'duration') return '本周还没有人跑出用时';
  return '本周还没有人产生贡献';
}

function splitTopics(list) {
  const rows = Array.isArray(list) ? list : [];
  return {
    upcomingTopics: rows.filter((t) => !t.ended),
    endedTopics: rows.filter((t) => t.ended),
  };
}

// 成员横向头像条:最多 4 位真人 + 第 5 位「+N」溢出位(Figma 23:18)
function buildMemberStrip(members, total) {
  const list = Array.isArray(members) ? members : [];
  const strip = list.slice(0, 4).map((m) => ({
    key: 'm' + m.memberId,
    memberId: m.memberId,
    avatar: m.avatar || '/images/d_profile.png',
    name: m.nickname || '城瘾玩家',
    role: m.isOwner ? '群主' : (Number(m.role) === 1 ? '管理员' : ''),
    roleTone: m.isOwner ? 'owner' : 'admin',
  }));
  const rest = (Number(total) || list.length) - strip.length;
  if (rest > 0) strip.push({ key: 'more', memberId: 0, avatar: '', name: '+' + rest, role: '', roleTone: '' });
  return strip;
}

function formatMemberCount(n) {
  n = Number(n) || 0;
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' 名成员';
}

function formatPostTime(s) {
  if (!s) return '';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (m) return m[1] + '年' + Number(m[2]) + '月' + Number(m[3]) + '日 于 ' + m[4] + ':' + m[5];
  return String(s).slice(0, 16).replace('T', ' ');
}

/**
 * 把「我参与过的」整形成可引用项。算不出名字的整条丢掉 ——
 * 列表里出现一行没有名字的记录,选了也只能发出一张空卡。
 */
function buildPostRefOptions(rows) {
  const out = [];
  (rows || []).forEach(function (row) {
    if (!row) return;
    const isActivity = Number(row.ownerType) === 2;
    const target = isActivity ? row.cmsActivity : row.cmsTopic;
    const refId = Number(row.ownerId);
    const name = target && String(target.name || '').trim();
    if (!name || !Number.isInteger(refId) || refId <= 0) return;
    out.push({
      key: (isActivity ? 'a' : 't') + refId,
      refType: isActivity ? 1 : 2,
      refId: refId,
      name: name,
      subText: isActivity ? '活动' : '主题',
    });
  });
  return out;
}

function normalizeClubPost(p, clubOwnerId) {
  const isPinned = p.isPinned === true || Number(p.isPinned) === 1;
  // 帖子带引用时,variant 由**引用类型**派生,判定复用广场那一份(utils/feed-play-card.js)——
  // 俱乐部这边不许再写第二套判据。refType 的编号就是广场的 dataType,所以直接喂进去。
  // 后端投影不出展示字段(被引对象已删/下架)时 sportName 是空,两个判定都会自然判假,
  // 卡片降级成普通图文帖 —— 不会渲染出一张标题空着的成绩卡。
  const ref = Object.assign({}, p, { dataType: p.refType, completed: true });
  return Object.assign({}, p, {
    memberId: p.authorMemberId,
    memberNickname: p.nickname,
    memberAvatar: p.avatar,
    contents: p.content,
    picList: p.images ? String(p.images).split(/[;,]/).filter(Boolean) : [],
    formattedCreateTime: formatPostTime(p.createTime),
    authorBadge: String(p.authorMemberId) === String(clubOwnerId) ? '主理人' : '',
    noticeBadge: Number(p.type) === 2 ? (isPinned ? '公告 · 置顶' : '公告') : '',
    isPinned: isPinned,
    version: Number(p.version || 0),
    isCompletionShare: isCompletedShare(ref),
    hasPlayCover: hasFeedPlayCover(ref),
  });
}

function enrichClub(club) {
  if (!club) return club;
  club.levelText = levelTextOf(club.level);
  // 稿 N1b 47:2 / N3 20:137 写的是「42 名成员」,不是光秃秃一个数字
  club.memberCountText = formatMemberCount(club.memberCount);
  club.clubTypeText = club.clubType || club.city || '城市探索';
  club.joinPolicyText = Number(club.joinPolicy) === 1 ? '需审批' : '公开';
  if (club.logo && app.getImgUrl) club.logo = app.getImgUrl(club.logo);
  if (club.cover && app.getImgUrl) club.cover = app.getImgUrl(club.cover);
  const descLine = club.description ? String(club.description).split('\n')[0].trim() : '';
  club.tagline = club.style || club.clubType
    || (descLine && descLine.length <= 24 ? descLine : '')
    || (club.leaderName ? club.leaderName + ' 主理' : '城瘾玩家俱乐部');
  return club;
}

function isDemoClubId(id) {
  return app.isDevEnv && app.isDevEnv() && String(id) === String(mockData.DEMO_NEARBY_CLUB_ID);
}

Page({
  data: {
    // 稿 40:3 末行「★ 减少动态效果兜底」的接线端。index.wxss 里 .cy-motion-reduced 的
    // 折叠面板兜底规则要靠根节点这个类才能匹配到 —— 之前 readReducedMotion 已 import
    // 但从没调用,规则等于死代码(截图实测:开了系统减动效,折叠面板照样播 -4px 位移)。
    reducedMotion: false,
    privacyGateShow: false,   // 隐私授权闸的显隐位(所有权在本页,见 showPrivacyGate)
    myAvatar: '',        // 发帖框显示登录用户自己的头像,空时才落默认图
    myNickname: '',      // 发帖入口第一行(Figma 285:398)是昵称,不是提示语
    sceneStack: [],
    sceneCurrent: null,
    sceneDirty: false,
    sceneConfirm: false,
    clubId: null,
    club: null,
    manageTopics: [],
    topicsLoaded: false,
    topicState: 'loading',
    eventViewTabs: [
      { key: 'list', label: '列表' },
      { key: 'calendar', label: '月历' },
    ],
    eventWeekdays: ['一', '二', '三', '四', '五', '六', '日'],
    eventView: 'list',
    eventCalendarMonth: localDateText(new Date()).slice(0, 7),
    eventCalendarTitle: '',
    eventCalendarCells: [],
    eventCalendarHasEvents: false,
    shareEditions: [],
    shareEditionState: 'idle',
    members: [],
    membersState: 'idle', // idle | loading | ready | business-error | network-error
    canSeeMembers: false,
    posts: [],
    postsLoaded: false,
    postText: '',
    // 发帖区默认收起,点一下才展开(2026-08-26)
    composerOpen: false,
    postImages: [],
    postAsAnnouncement: false,
    // 稿 N1b:帖子可以带上一次游玩记录,卡片形态由引用类型派生
    postRef: null,
    postRefPickerShow: false,
    postRefState: 'idle',       // idle | loading | ready | error
    postRefErrorText: '',
    postRefOptions: [],
    posting: false,
    postEditShow: false,
    postEditId: null,
    postEditText: '',
    postEditImages: '',
    postEditVersion: 0,
    postEditSubmitting: false,
    postEditDirty: false,          // CU-C-106:正文改过 → 关闭前先问一句
    postEditDiscardConfirm: false,
    postHistoryShow: false,
    postHistoryState: 'idle',
    postHistoryRows: [],
    openCommentPost: null,
    comments: [],
    commentText: '',
    commenting: false,
    leaderboard: [],
    leaderboardLoaded: false,
    leaderboardSortLabel: '综合',
    leaderboardEmptyTitle: '本周还没有人产生贡献',
    memberStrip: [],
    upcomingTopics: [],
    endedTopics: [],
    rankTabs: [
      { key: 'composite', label: '综合' },
      { key: 'mileage', label: '里程' },
      { key: 'duration', label: '完成用时' },
    ],
    myMemberId: null,
    rawMerchants: [],
    merchants: [],
    // Figma「管理员 管理页面」B2:可对接的活动 —— 商家把主题开放给俱乐部承接后出现在这里
    coopPool: [],
    coopPoolState: 'idle',   // idle | loading | ready | permission | error
    coopPoolError: '',
    coopApplyPendingId: '',  // 申请带队在途的 topicId(同步防重 + 按钮文案)
    merchantsLoaded: false,
    merchantKeyword: '',
    ownerProjectState: 'idle',
    projectRows: [],
    messageState: 'idle',
    messages: [],
    inviteFeedbackState: 'idle',
    sentInvites: [],
    ownerStage: 'loading',
    ownerPrimaryLabel: OWNER_STAGE_COPY.loading.label,
    ownerStageHint: OWNER_STAGE_COPY.loading.hint,
    // 带队进度时间线:「现在要做」只说下一步,这条说的是「我走到哪一站了」。
    leadTimelineNodes: [],
    leadTimelineSummary: '',
    leadTimelineOpen: false,
    clubStatsState: 'idle', // idle | loading | ready | error
    clubStats: null,
    clubStatsError: '',
    detailLoaded: false,
    notFound: false,
    // E-09(2026-09-16):三处「失败渲染成空」的状态位。有错误文案 = 显示错误态+重试,不显示空态。
    postsError: '',
    leaderboardError: '',
    merchantsError: '',
    // 团核销码(弹窗化,2026-07-31):选场次用 cy-sheet,出码用 cy-qr-voucher,
    // 两者互斥展示、从不同时叠加——不在 sheet 里再嵌一层 sheet。
    groupCodeVisible: false,
    groupCodeState: 'selecting', // selecting | loading | ready | error
    groupCodeTopicId: null,
    groupCodeActivityId: null,
    groupCodeTitle: '本团',
    groupCodeActivityOptions: [],
    groupCodeQrUrl: '',
    groupCodeCode: '',
    groupCodeCountdown: 0,
    groupCodeErrMsg: '',
    directorActivityPickerShow: false,
    directorActivityOptions: [],
    choiceSheetShow: false,
    choiceSheetTitle: '',
    choiceSheetHint: '',
    choiceSheetItems: [],
    ownerClubs: [],
    ownerPickerShow: false,
    isMerchantViewer: false,
    clubAccessState: 'idle', // idle | loading | ready | error
    canModerateContent: false,
    canReadMembers: false,
    canApproveMembers: false,
    canManageMembers: false,
    canManageRoles: false,
    delegatedRoleCount: 0,
    canSendNotify: false,
    canManageActivities: false,
    canOperateEvents: false,
    canCheckInEvents: false,
    hasEventScope: false,
    canUseManageTab: false,
    statusBarHeight: app.globalData.statusBarHeight,
    navBarHeight: app.globalData.navBarHeight,
    activeTab: 'posts',        // posts | events | overview | manage(owner only)
    clubTabs: PUBLIC_TABS,
    tabInitialized: false,
    // 管理 tab 的经营区块一次只展开一条('' 为全收起);治理项不在这里,在齿轮弹窗。
    openManageSection: '',
    // 齿轮 → 俱乐部设置弹窗。settingsPanel 是弹窗内二级展开('' / 'members' / 'tools'),
    // 不再开第二层 sheet —— DS 规定 sheet 不嵌 sheet。
    settingsShow: false,
    // 稿 M 268:223 的「查看客户 128 人」「俱乐部分润 ¥128.00」。开弹窗才去取,
    // 取不到就留空 —— 空白比一个假的 0 / ¥0.00 诚实。
    customerCountText: '',
    settledAmountText: '',
    // 开放设置的两个开关共用一套在途/报错字段,按 key 区分是哪一行
    openSettingSaving: '',
    openSettingErrorKey: '',
    openSettingErrorText: '',
    settingsPanel: '',
    // AI 策划活动(sheet 内联,主理人限定)
    aiSheetShow: false,
    aiIdeaChips: AI_IDEA_CHIPS,
    aiIdea: '',
    aiClubStyle: '',
    aiDurationMin: '',
    aiState: 'idle',           // idle | generating | done | error
    aiErrorText: '',
    aiCanRetry: true,          // 频控超限时关掉「重试」(重试必然再失败)
    aiPlan: null,
    aiMerchantSuggestions: [],
    aiPromoCopy: '',
  },
  blockSceneTouch() {},
  closeScene() {
    this.setData({ sceneStack: [], sceneCurrent: null, sceneDirty: false, sceneConfirm: false });
  },
  requestSceneClose() {
    if (this.data.sceneDirty) {
      this.setData({ sceneConfirm: true });
      return;
    }
    this.closeScene();
  },
  onSceneDirtyChange(e) {
    this.setData({ sceneDirty: !!(e.detail && e.detail.dirty) });
  },
  confirmSceneDiscard() {
    this.closeScene();
  },
  cancelSceneDiscard() {
    this.setData({ sceneConfirm: false });
  },
  // 编辑保存成功 ⇒ 重拉俱乐部详情,别让页面停在旧数据上
  onClubEdited() {
    this.setData({ sceneDirty: false, sceneConfirm: false });
    if (typeof this.loadDetail === 'function') this.loadDetail();
    else if (typeof this.getData === 'function') this.getData();
  },
  onClubDissolved() {
    this.closeScene();
    cyToast.success('俱乐部已解散');
    setTimeout(function () {
      wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/talent/list/index' }); } });
    }, 500);
  },

  onLoad(opt) {
    this._operationScope = opt && opt.scope === 'MERCHANT' ? 'MERCHANT' : '';
    // 纯内部态:wxml 渲染的是派生结果(manageTopics / upcomingTopics / endedTopics /
    // leaderboardSortLabel),从不直接渲染这两个。放 data 里每次 setData 都白白做一次
    // 逻辑层→视图层传输,传过去没人用 —— U4 判的正是这个。
    this._topics = [];
    this._leaderboardSort = 'composite';
    const id = opt && opt.id ? Number(opt.id) : null;
    this._requestedTab = opt && opt.tab === 'manage' ? 'manage' : '';
    this._requestedPostId = opt && opt.postId ? String(opt.postId) : '';
    this.setData({
      myMemberId: app.getUserID && app.getUserID(),
      isMerchantViewer: this._operationScope === 'MERCHANT'
        || (app.getUserRole && app.getUserRole()) === 'merchant',
      // 从项目详情 → 找俱乐部 → 这里,主题一路带过来
      topicId: (opt && opt.topicId) || '',
      topicName: (opt && opt.topicName) ? decodeURIComponent(opt.topicName) : '',
    });
    if (id) { this.setData({ clubId: id }); this.loadAll(); return; }
    // owner 入口(承接原 club/index 管理台):无 id → 解析我拥有的俱乐部
    if (opt && opt.owner) { this.resolveOwnerEntry(); return; }
    this.setData({ detailLoaded: true, notFound: true }); cyToast('缺少俱乐部');
  },

  // 首展由 onLoad 负责，避免双请求；从发布/邀请/主办视图返回后重拉阶段真源。
  onShow() {
    const reducedMotion = readReducedMotion();
    if (this.data.reducedMotion !== reducedMotion) this.setData({ reducedMotion });
    const myAvatar = app.getAvatar() || '';
    if (myAvatar !== this.data.myAvatar) this.setData({ myAvatar });
    const myNickname = (app.getNickname && app.getNickname()) || '';
    if (myNickname !== this.data.myNickname) this.setData({ myNickname });
    if (!this._hasShown) { this._hasShown = true; return; }
    if (this.data.clubId && this.data.club
        && (this.canGovern() || this.data.canUseManageTab)) this.loadAll();
    // CU-C-18:从「我发出的」撤回申请后返回,合作池那张卡要跟着变回「可再申请」,不能停在「已申请」。
    if (this.data.coopPoolState === 'ready') this.loadCoopPool(true);
  },

  // 承接原 club/index:主理人入口无具体 id → 拉 /api/club/my 自解析(单团直落 / 多团选团 / 无团去创建)
  resolveOwnerEntry() {
    const that = this;
    // 进页面拉数据:detailLoaded 初值为 false,cy-skeleton 已在显示,不再叠加 wx.showLoading
    app.sendRequest({
      hideLoading: true, url: '/api/club/my', method: 'POST', data: jsonBody({}), header: jsonHeader(),
      success(res) {
        // 业务失败(code!=200 / 缺 data)≠「你还没有俱乐部」:后者是 200+owned 为空。
        // 原来一律当空,toast 后 900ms 强制退出 —— 一次 5xx 就把主理人踢出管理台且没有重试。
        if (String(res && res.code) !== '200' || !res.data) {
          that.setData({ detailLoaded: true, notFound: true });
          return;
        }
        let owned = res.data.owned || [];
        if (owned && !Array.isArray(owned)) owned = [owned];
        if (owned.length === 0) {
          // 无俱乐部(非 owner 走 goManage 恢复键 / 罕见竞态)→ 不强推建群表单,提示后退出
          cyToast('你还没有俱乐部');
          setTimeout(function () { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/talent/list/index' }); } }); }, 900);
          return;
        }
        if (owned.length === 1) { that.setData({ clubId: Number(owned[0].id) }); that.loadAll(); return; }
        that.setData({ ownerClubs: owned, ownerPickerShow: true, detailLoaded: true });
      },
      fail() { that.setData({ detailLoaded: true, notFound: true }); }
    });
  },
  onPickOwnerClub(e) {
    const cid = Number(e.currentTarget.dataset.id);
    if (!cid) return;
    this.setData({ ownerPickerShow: false, clubId: cid });
    this.loadAll();
  },
  closeOwnerPicker() { this.setData({ ownerPickerShow: false }); wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/talent/list/index' }); } }); },

  onPullDownRefresh() { this.loadAll(function () { wx.stopPullDownRefresh(); }); },

  // 页面销毁:作废在途 AI 生成的回调,避免 setData after unload(sendRequest 不可中断)
  onUnload() { this._clubAiToken = (this._clubAiToken || 0) + 1; this.clearGroupCodeTimer(); },

  onRetry() {
    this.setData({ detailLoaded: false, notFound: false, club: null });
    // owner 入口还没解析出 clubId 时,loadAll 会直接 return —— 只重发详情请求等于永久骨架
    // (E-05:点「重新加载」永远转圈)。这种情况必须重走 /api/club/my 解析。
    if (!this.data.clubId) { this.resolveOwnerEntry(); return; }
    this.loadAll();
  },

  goManage() { this.resolveOwnerEntry(); },

  // 隐私授权闸:app.js 优先调这里(页内真弹窗),没有这个方法的页面才回退到 /pages/privacy 路由页 ——
  // 回退会把整页盖掉(CU-C-60 新增的 wx.scanCode 会触发系统隐私授权)。
  showPrivacyGate() {
    this.setData({ privacyGateShow: true });
  },
  onPrivacyGateSettled() {
    this.setData({ privacyGateShow: false });
  },

  loadAll(done) {
    // owner 入口未解析出 clubId 前(多团 picker 态)不发 id:null 请求(修下拉刷新触发的空请求+误 notFound)
    if (!this.data.clubId) { if (done) done(); return; }
    const that = this;
    let pending = 2;
    const tick = function () {
      if (--pending > 0) return;
      if (that.data.club && that.data.club.isOwner) {
        that.loadMerchants();
        that.loadOwnerManagement();
        that.loadClubStats();
      } else {
        that.setData({ clubStatsState: 'idle', clubStats: null, clubStatsError: '' });
        if (that.canGovern()) {
          // 管理员:喂阶段机的那几个读模型都是 owner-only,没人会再叫 updateOwnerStage
          // (applySentInviteFilter 因为 _sentInviteRows 为 null 直接早退)。
          // 这里显式叫一次,让它落到 admin 终态,别把「读取管理进度…」留在卡上。
          that.updateOwnerStage();
        }
      }
      if (done) done();
    };
    this.loadDetail(tick);
    this.loadTopics(tick);
    this.loadPosts();
    this.loadLeaderboard();
  },

  // 达人视角:可对接商家列表(/api/club/merchants),点「发邀请」发起合作(coop/invite 类型0)
  loadMerchants() {
    if (!this.data.club || !this.data.club.isOwner) {
      this.setData({ rawMerchants: [], merchants: [], merchantsLoaded: true });
      return;
    }
    const that = this;
    app.sendRequest({
      hideLoading: true, url: '/api/club/merchants', method: 'POST', data: jsonBody({}), header: jsonHeader(),
      success(res) {
        const list = (res.code == '200' && res.data) || [];
        that.setData({ rawMerchants: list, merchantsLoaded: true, merchantsError: '' });
        that.filterMerchants();
      },
      // E-09(2026-09-16):失败原来是空列表 → 「还没有开放对接的商家」。
      fail() { that.setData({ merchantsLoaded: true, merchantsError: '网络不稳定，商家列表没能加载出来' }); },
    });
  },

  // T16:找商家发现能力——按名称/承接能力/地址关键词筛选(客户端过滤已加载列表)
  onMerchantKeyword(e) {
    this.setData({ merchantKeyword: e.detail.value });
    this.filterMerchants();
  },
  filterMerchants() {
    const kw = (this.data.merchantKeyword || '').trim().toLowerCase();
    const raw = this.data.rawMerchants || [];
    if (!kw) { this.setData({ merchants: raw }); return; }
    const hit = raw.filter(function (m) {
      const hay = [m.name, m.merchantName, m.suitActivityTypes, m.address, m.city].join(' ').toLowerCase();
      return hay.indexOf(kw) >= 0;
    });
    this.setData({ merchants: hit });
  },
  goCoopList() { wx.navigateTo({ url: '/pages/coop/list/index' }); },
  goCooperation() { wx.navigateTo({ url: '/pages/coop/list/index?tab=sent' }); },

  // 客户按人聚合(来过几次、标签备注),与按团聚合的报名名册各走各的入口。
  goCustomers() {
    const cid = (this.data.club || {}).id || this.data.clubId;
    if (cid) wx.navigateTo({ url: '/pages/club/customers/index?clubId=' + cid });
  },

  // 俱乐部管理 tab 保留报名名册入口；收益统一归「我的资产」。
  goEnroll() {
    const c = this.data.club || {};
    const cid = c.id || this.data.clubId;
    if (cid) wx.navigateTo({ url: '/pages/club/enroll/index?clubId=' + cid + '&clubName=' + encodeURIComponent(c.name || '') });
  },

  goEventOps() {
    const club = this.data.club;
    if (!club || !(this.canGovern(club) || this.data.canManageActivities) || !this.data.clubId) return;
    wx.navigateTo({ url: '/pages/club/event-ops/index?clubId=' + this.data.clubId });
  },

  /**
   * CU-C-60:快捷动作「扫码」接真扫码。原来它只调 goEventOps —— 图标/文案/aria 都写着
   * 「扫码核销」,手势却跳场次编排页,用户根本看不到扫描器。解析与提交都不在本页重写:
   * 码 → 端点的路由在 utils/verification-scan.js(与商家页/参与详情同一份)。
   */
  onClubScan() {
    const club = this.data.club;
    if (!club || !(this.canGovern(club) || this.data.canManageActivities)) return;
    const that = this;
    wx.scanCode({
      success(res) {
        const scan = resolveVerificationScan(res && res.result);
        if (scan.kind === 'invalid') {
          // 码是好的、只是入口不对时给一条能点过去的指路,不弹一个 2 秒就消失的 toast。
          if (scan.path) {
            modal.show({
              title: '核销入口不对',
              content: scan.message,
              confirmText: scan.confirmText || '我知道了',
              cancelText: '留在这里',
              success(r) { if (r && r.confirm) wx.navigateTo({ url: scan.path }); },
            });
          } else {
            cyToast(scan.message);
          }
          return;
        }
        that.submitClubScan(scan.url, scan);
      },
      // 用户自己取消不是错误(与 play/merchant 页同一口径);相机/系统失败才提示。
      fail(error) {
        if (/cancel/i.test((error && error.errMsg) || '')) return;
        cyToast('未能打开扫码，请检查相机权限');
      },
    });
  },

  /**
   * 核销写请求的唯一出口。形状与 pages/merchant/index 的 _submitVerification 一致:
   * url 由调用方按共享扫码路由表(utils/verification-scan.js)的结果给 ——
   * 本页不再写第二份「哪种码去哪个口」的映射。防重提与「结果未知」全部收在写闸里。
   */
  submitClubScan(url, options) {
    const scan = options || {};
    if (!url) return;
    if (!this._scanWorkflow) this._scanWorkflow = createWriteActionWorkflow({ deadlineMs: 15000 });
    const key = url + ':' + (scan.code || '');
    if (this._scanWorkflow.isBusy(key)) { cyToast('核销处理中，请勿重复提交'); return; }
    loading.show(scan.loadingTitle);
    this._scanWorkflow.run(key, function (done) {
      return app.sendRequest(Object.assign({}, {
        url: url, data: scan.data, method: 'POST', header: jsonHeader(),
        autoErrorToast: false,
        success(res) { done({ status: 'success', response: res }); },
        fail() { done({ status: 'failed', response: { code: 500, msg: '网络错误，请重试' } }); },
        successStatusAbnormal(res) {
          done({ status: 'failed', response: { code: 500, msg: (res && res.msg) || '核销失败，请重试' } });
        },
      }));
    }, function (result) {
      loading.hide();
      // 结果未知 = 服务端可能已经写入。提示重试等于把「未知」变成重复核销。
      if (result.status === 'unknown') { cyToast('核销结果待确认，请勿重复核销'); return; }
      const res = result.response || {};
      // 成功用确认框留住结果(全仓成功 toast 只减不增:两秒就消失的提示替代不了「这张码已核销」这个状态)
      if (res.code == '200') modal.show({ title: scan.successTitle || '核销成功', content: res.msg || '', showCancel: false, confirmText: '知道了' });
      else cyToast(res.msg || '核销失败');
    });
  },

  // 快捷动作「结算」:主理人按主题看分润 / 商家应收 / 打款状态(scene-merchant-profit)。
  // 「结算与分润」走俱乐部维度的结算页(pages/club/settlement,#990 建好后一直没入口),
  // 不再落到主理人个人维度的 coop/finance —— 多团主理人在那看不出是哪个团的分润。
  goClubFinance() {
    const club = this.data.club;
    if (!club || !club.isOwner) return;
    const clubId = club.id || this.data.clubId;
    if (!clubId) return;
    wx.navigateTo({ url: '/pages/club/settlement/index?clubId=' + encodeURIComponent(clubId) });
  },

  // 快捷动作「出示二维码」:复用现成的团核销码链路(showGroupCode 同一套)。
  // 团码永远绑定具体场次,俱乐部级没有「一张通用码」—— 只有一个项目时直接进,
  // 否则把人送回项目列表自己点,不猜是哪个团(猜错就等于给错场次出码)。
  onClubGroupCode() {
    const club = this.data.club;
    if (!club || !(this.canGovern(club) || this.data.canCheckInEvents)) return;
    const topics = this.data.manageTopics || [];
    if (!topics.length) {
      cyToast('还没有项目，先发布一个主题');
      return;
    }
    if (topics.length > 1) {
      cyToast('在下面的项目里选具体的团出码');
      return;
    }
    this.clearGroupCodeTimer();
    this.setData({
      groupCodeVisible: true,
      groupCodeState: 'loading',
      groupCodeTopicId: topics[0].id,
      groupCodeActivityId: null,
      groupCodeTitle: topics[0].name || '本团',
      groupCodeActivityOptions: [],
      groupCodeErrMsg: '',
    });
    this.selectGroupCodeActivity();
  },

  goClubNotify() {
    const club = this.data.club;
    // 守卫与显示条件必须同源,否则「看不见但点得到」或反过来
    if (!club || !(club.isOwner || this.data.canSendNotify) || !this.data.clubId) return;
    wx.navigateTo({ url: '/pages/club/notify/index?clubId=' + this.data.clubId });
  },

  openActivityTools(e) {
    if (this._activityToolsLoading) return;
    const topicId = positiveId(e && e.currentTarget && e.currentTarget.dataset.id);
    const club = this.data.club;
    const canOpen = club && (this.canGovern(club) || this.data.canManageActivities
      || this.data.canOperateEvents || this.data.canCheckInEvents || this.data.canManageRoles
      || this.data.hasEventScope);
    if (!topicId || !canOpen || !this.data.clubId) return;
    const that = this;
    this._activityToolsLoading = true;
    app.sendRequest({
      url: '/api/topic/info-to-user',
      method: 'POST',
      data: { id: topicId },
      hideLoading: true,
      silentError: true,
      success(res) {
        let activities = listGroupCodeActivities(res && res.data && res.data.activityList);
        const hasClubWideAccess = !!(that.canGovern(club) || that.data.canManageActivities
          || that.data.canOperateEvents || that.data.canCheckInEvents || that.data.canManageRoles);
        if (!hasClubWideAccess) {
          const byActivity = that._eventAccessByActivity || {};
          activities = activities.filter(function (item) {
            return !!byActivity[String(item.id)];
          });
        }
        if (!isSuccess(res)) {
          // E-15f(2026-09-16):加载失败 ≠ 没有场次。原来两者共用同一句 toast,
          // 断网时主理人会读到「没有可管理的具体场次」—— 把一个假事实端给他。
          cyToast('场次加载失败，请稍后重试');
          return;
        }
        if (!activities.length) {
          cyToast('这个项目还没有可管理的具体场次');
          return;
        }
        if (activities.length === 1) {
          that.chooseActivityTool(activities[0].id, activities[0].name);
          return;
        }
        that.openChoiceSheet(
          '选择场次',
          '一周多场时在这里选，不会被系统菜单截断',
          activities.map(function (item) {
            return { key: String(item.id), label: item.name };
          }),
          function (item) { that.chooseActivityTool(item.key, item.label); }
        );
      },
      fail() { cyToast('场次加载失败，请稍后重试'); },
      complete() { that._activityToolsLoading = false; },
    });
  },

  chooseActivityTool(activityId, activityLabel) {
    const id = positiveId(activityId);
    const clubId = positiveId(this.data.clubId);
    const club = this.data.club;
    if (!id || !clubId || !club) return;
    // CU-C-57:场次角色页要说清作用对象。本场工具的候选文案已经是「活动名 · 开始时间」,
    // 顺着路由带过去,不另发一次请求。
    const label = typeof activityLabel === 'string' && activityLabel.trim()
      ? activityLabel.trim().slice(0, 40) : '';
    const labelQuery = label ? '&activityLabel=' + encodeURIComponent(label) : '';
    const eventAccess = (this._eventAccessByActivity || {})[String(id)] || null;
    const eventPermissions = eventAccess && Array.isArray(eventAccess.permissions)
      ? eventAccess.permissions : [];
    const canOperateEvent = club.isOwner || this.data.canManageActivities || this.data.canOperateEvents
      || club.viewerIsAdmin || eventPermissions.indexOf('club:event:operate') >= 0;
    const canCheckInEvent = club.isOwner || this.data.canManageActivities || this.data.canCheckInEvents
      || club.viewerIsAdmin || eventPermissions.indexOf('club:event:checkin') >= 0;
    const tools = [];
    if (canOperateEvent || canCheckInEvent) {
      tools.push({ label: '现场名册与核销', route: '/pages/club/event-ops/index?clubId=' + clubId + '&activityId=' + id });
    }
    if (club.isOwner || this.data.canManageRoles) {
      tools.push({ label: '分配领队与核销员', route: '/pages/club/roles/index?clubId=' + clubId + '&activityId=' + id + labelQuery });
    }
    if (canOperateEvent) {
      tools.push({ label: '通知本场成员', route: '/pages/club/notify/index?clubId=' + clubId + '&activityId=' + id });
    }
    if (!tools.length) return;
    if (tools.length === 1) {
      wx.navigateTo({ url: tools[0].route });
      return;
    }
    this.openChoiceSheet(
      '本场工具',
      '',
      tools.map(function (item) { return { key: item.route, label: item.label }; }),
      function (item) { wx.navigateTo({ url: item.key }); }
    );
  },

  // 2026-09-09 用户裁决:会费设置 / 会员与会费 / 探店日质量证据 三页整页删除。
  // 三个入口(goClubMembershipStatus / goClubMembershipSetting / goEditionReport)
  // 与会籍概览取数(loadMembershipSummary)一并撤走 —— 页面没了,留着就是死链。
  // ⚠️ 质量证据原来是 Q 结算的唯一入口,现在没有任何地方能交证据了,要产品确认 Q 怎么算。

  // 管理 tab 不再是第二套工作台：项目列表复用 /api/club/topics，
  // 这里只补两个已有读模型，用于阶段 primary 与合作反馈。
  loadOwnerManagement() {
    if (!this.data.club || !this.data.club.isOwner) return;
    this._sentInviteRows = null;
    this.setData({
      ownerProjectState: 'loading',
      projectRows: [],
      messageState: 'loading',
      messages: [],
      inviteFeedbackState: 'loading',
      sentInvites: [],
      ownerStage: 'loading',
      ownerPrimaryLabel: OWNER_STAGE_COPY.loading.label,
      ownerStageHint: OWNER_STAGE_COPY.loading.hint,
    });
    this.loadShareEditions();
    this.loadOwnerProjects();
    this.loadMessages();
  },

  loadClubStats() {
    if (!this.data.club || !this.data.club.isOwner || !this.data.clubId) {
      this.setData({ clubStatsState: 'idle', clubStats: null, clubStatsError: '' });
      return;
    }
    const that = this;
    const clubId = String(this.data.clubId);
    this.setData({ clubStatsState: 'loading', clubStats: null, clubStatsError: '' });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/stats/club',
      method: 'POST',
      data: jsonBody({ clubId }),
      header: jsonHeader(),
      success(res) {
        if (clubId !== String(that.data.clubId)) return;
        const stats = isSuccess(res) ? shapeClubStats(res.data, clubId) : null;
        if (!stats) {
          that.setData({
            clubStatsState: 'error',
            clubStats: null,
            clubStatsError: bizFailureMessage(res, '看板数据暂时不可用'),
          });
          return;
        }
        that.setData({ clubStatsState: 'ready', clubStats: stats, clubStatsError: '' });
      },
      fail() {
        if (clubId !== String(that.data.clubId)) return;
        that.setData({ clubStatsState: 'error', clubStats: null, clubStatsError: '网络连接失败' });
      },
    });
  },

  // 带票分享只能来自开售条款中的 executing_club_id 真源；经典项目列表没有该归属语义。
  loadShareEditions() {
    if (!this.data.club || !this.data.club.isOwner || !this.data.clubId) return;
    const that = this;
    const clubId = this.data.clubId;
    this.setData({ shareEditionState: 'loading', shareEditions: [] });
    app.sendRequest({
      hideLoading: true,
      url: '/api/club-compensation/editions',
      method: 'POST',
      data: jsonBody({ clubId: clubId }),
      header: jsonHeader(),
      success(res) {
        if (String(clubId) !== String(that.data.clubId)) return;
        const ok = isSuccess(res) && Array.isArray(res.data);
        if (!ok) {
          that.setData({ shareEditionState: 'error', shareEditions: [] });
          return;
        }
        const rows = res.data.filter(function (item) {
          return item && item.topicId != null
            && String(item.executingClubId) === String(clubId);
        }).map(function (item) {
          return Object.assign({}, item, { dateText: dateOf(item.startDate) });
        });
        that.setData({ shareEditionState: 'ready', shareEditions: rows });
      },
      fail() {
        if (String(clubId) !== String(that.data.clubId)) return;
        that.setData({ shareEditionState: 'error', shareEditions: [] });
      },
    });
  },

  loadOwnerProjects() {
    const that = this;
    const clubId = this.data.clubId;
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/project/my',
      method: 'POST',
      // 后端 type 过滤的是 projectType(经典/自由等)，不是 bizType；这里必须拉 all 再按 bizType 过滤。
      data: { ownerType: 'club', state: 'all', type: 'all', pageNum: 1, pageSize: 200 },
      success(res) {
        if (String(clubId) !== String(that.data.clubId)) return;
        const rows = isSuccess(res) && res.data && Array.isArray(res.data.rows) ? res.data.rows : null;
        if (!rows) {
          that.setData({ ownerProjectState: 'error', projectRows: [] });
          that.updateOwnerStage();
          return;
        }
        const currentRows = rows.filter(function (item) {
          return item.bizType !== 'activity' && String(item.clubId) === String(clubId);
        });
        that.setData({ ownerProjectState: 'ready', projectRows: currentRows });
        that.updateOwnerStage();
      },
      fail() {
        if (String(clubId) !== String(that.data.clubId)) return;
        that.setData({ ownerProjectState: 'error', projectRows: [] });
        that.updateOwnerStage();
      },
    });
  },

  loadMessages() {
    const that = this;
    const clubId = this.data.clubId;
    this._sentInviteRows = null;
    this.setData({ messageState: 'loading', messages: [], inviteFeedbackState: 'loading', sentInvites: [] });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/coop/list',
      method: 'POST',
      data: jsonBody({}),
      header: jsonHeader(),
      success(res) {
        if (String(clubId) !== String(that.data.clubId)) return;
        const received = isSuccess(res) && res.data && Array.isArray(res.data.received) ? res.data.received : null;
        const sent = isSuccess(res) && res.data && Array.isArray(res.data.sent) ? res.data.sent : null;
        if (!received || !sent) {
          that._sentInviteRows = null;
          that.setData({ messageState: 'error', messages: [], inviteFeedbackState: 'error', sentInvites: [] });
          that.updateOwnerStage();
          return;
        }
        const messages = received
          .filter(function (item) { return item.toType === 'club' && String(item.toId) === String(clubId); })
          .map(decorateMessage);
        that._sentInviteRows = sent;
        that.setData({ messageState: 'ready', messages: messages });
        that.applySentInviteFilter();
      },
      fail() {
        if (String(clubId) !== String(that.data.clubId)) return;
        that._sentInviteRows = null;
        that.setData({ messageState: 'error', messages: [], inviteFeedbackState: 'error', sentInvites: [] });
        that.updateOwnerStage();
      },
    });
  },

  applySentInviteFilter() {
    if (!Array.isArray(this._sentInviteRows)) return;
    if (this.data.topicState === 'error') {
      this.setData({ inviteFeedbackState: 'error', sentInvites: [] });
      this.updateOwnerStage();
      return;
    }
    if (this.data.topicState !== 'ready') return;
    const topicIds = new Set((this._topics || []).map(function (item) { return String(item.id); }));
    const sentInvites = this._sentInviteRows
      .filter(function (item) { return topicIds.has(String(item.topicId)); })
      .map(decorateInviteFeedback);
    this.setData({ inviteFeedbackState: 'ready', sentInvites: sentInvites });
    this.updateOwnerStage();
  },

  reloadMessages() { this.loadMessages(); },
  reloadInviteFeedback() { this.loadTopics(); this.loadMessages(); },

  updateOwnerStage() {
    // ★ 管理员没有经营阶段。阶段机的每个分支都依赖 ownerProjectState / inviteFeedbackState,
    //   而喂它们的 loadOwnerManagement() 对非 owner 直接早退 —— 于是 stage 永远算不出来、
    //   卡在初始的 'loading',管理 tab 顶上那张卡的标题就一直是「读取管理进度…」。
    //   收口放在这里而不是某个调用点:loadTopics 成功/失败都会再调一次,漏一处就又转回去。
    if (this.canGovern() && !(this.data.club && this.data.club.isOwner)) {
      const adminCopy = OWNER_STAGE_COPY.admin;
      this.setData({ ownerStage: 'admin', ownerPrimaryLabel: adminCopy.label, ownerStageHint: adminCopy.hint });
      return;
    }
    this._hasAcceptedExecutionProject = false;
    let stage = 'loading';
    if (this.data.topicState === 'error') {
      stage = 'error';
    } else if (this.data.topicState === 'ready') {
      const clubId = this.data.clubId;
      const topicIds = new Set((this._topics || []).map(function (item) { return String(item.id); }));
      const manageTopicIds = new Set((this.data.manageTopics || []).map(function (item) { return String(item.id); }));
      const accepted = (this.data.projectRows || []).some(function (item) {
        return String(item.clubId) === String(clubId) && item.acceptStatus === 'merchantAccepted';
      });
      const acceptedExecution = (this.data.messages || []).some(function (item) {
        return Number(item.status) === 1 && item.toType === 'club'
          && String(item.toId) === String(clubId) && manageTopicIds.has(String(item.topicId));
      });
      this._hasAcceptedExecutionProject = acceptedExecution;
      const pending = (this.data.sentInvites || []).some(function (item) {
        return topicIds.has(String(item.topicId)) && Number(item.status) === 0;
      });
      if (!topicIds.size) stage = 'publish';
      else if (acceptedExecution || (this.data.ownerProjectState === 'ready' && accepted)) stage = 'accepted';
      else if (this.data.ownerProjectState === 'error') stage = 'error';
      else if (this.data.ownerProjectState === 'ready' && this.data.inviteFeedbackState === 'error') stage = 'error';
      else if (this.data.ownerProjectState === 'ready' && this.data.inviteFeedbackState === 'ready') stage = pending ? 'pending' : 'invite';
    }
    const copy = stage === 'accepted' && this._hasAcceptedExecutionProject
      ? OWNER_STAGE_COPY.executionAccepted : OWNER_STAGE_COPY[stage];
    const timeline = this._hasAcceptedExecutionProject
      ? { nodes: [], summary: '' } : this.buildLeadTimeline(stage);
    this.setData({
      ownerStage: stage,
      ownerPrimaryLabel: copy.label,
      ownerStageHint: copy.hint,
      leadTimelineNodes: timeline.nodes,
      leadTimelineSummary: timeline.summary,
    });
  },

  // 带队四站:发布主题 → 邀请商家 → 等待商家回应 → 商家已接受。
  // ★ loading / error / admin 不是经营阶段,一律返回空 —— 画一条全灰的时间线
  //   等于告诉主理人「你一站都没走」,比不画更糟。
  buildLeadTimeline(stage) {
    const cursor = LEAD_STAGE_INDEX[stage];
    if (cursor === undefined) return { nodes: [], summary: '' };
    const topics = this._topics || [];
    const invites = this.data.sentInvites || [];
    const pending = invites.filter(function (item) { return Number(item.status) === 0; });
    // timeText 是 'MM-DD HH:mm',同年内字典序即时间序;取最近一次发出的时间。
    const latestInviteTime = invites
      .map(function (item) { return item.timeText || ''; })
      .filter(Boolean).sort().pop() || '';
    const descs = [
      topics.length ? ('已发布 ' + topics.length + ' 个项目') : '先发布一个俱乐部项目',
      invites.length ? ('已发出 ' + invites.length + ' 份邀请') : '选择一个项目，开始对接商家',
      pending.length ? (pending.length + ' 份等待商家回应') : '邀请发出后在这里等回应',
      '商家已接受，可进入项目主办视图',
    ];
    const nodes = LEAD_STAGE_STATIONS.map(function (title, index) {
      return {
        title: title,
        time: index === 1 ? latestInviteTime : '',
        desc: descs[index],
        status: index < cursor ? 'done'
          : (index === cursor ? (stage === 'accepted' ? 'done' : 'doing') : 'todo'),
      };
    });
    return { nodes: nodes, summary: '带队进度 · ' + LEAD_STAGE_STATIONS[cursor] };
  },

  onLeadTimelineToggle(e) {
    this.setData({ leadTimelineOpen: !!(e.detail && e.detail.expanded) });
  },

  onOwnerPrimary() {
    if (this.data.ownerStage === 'loading') return;
    if (this.data.ownerStage === 'error') { this.retryOwnerManagement(); return; }
    if (this.data.ownerStage === 'publish') { this.onCreateTeam(); return; }
    const stage = this.data.ownerStage;
    if (stage === 'accepted' && this._hasAcceptedExecutionProject) { this.goEventOps(); return; }
    const afterSwitch = function () {
      if (stage === 'invite') {
        wx.pageScrollTo({ selector: '#manage-merchants-section', duration: 250, offsetTop: 24 });
      } else if (stage === 'pending') {
        wx.pageScrollTo({ selector: '#manage-invite-section', duration: 250, offsetTop: 24 });
      }
    };
    if (stage === 'invite') {
      this.setData({ activeTab: 'manage', openCommentPost: null, openManageSection: 'merchants' }, afterSwitch);
    } else {
      this.setData({ activeTab: 'manage', openCommentPost: null }, afterSwitch);
    }
  },

  retryOwnerManagement() {
    this.loadTopics();
    this.loadOwnerManagement();
  },

  // ===== AI 策划活动(/api/ai/club/design):运营管理网格入口 → 内联半屏 sheet =====
  // 门禁:后端按身份拦(player 报「当前身份暂不支持AI创作…」),前端也用 club.isOwner 挡掉无效点击。

  onClubAiOpen() {
    if (!this.data.club || !this.data.club.isOwner) return;
    this.setData({ aiSheetShow: true });
  },
  // 关 sheet 同时作废在途生成并回 idle,否则重开会看到上一次的残留结果/转圈(与入口C 的 close 行为对齐)
  onClubAiClose() {
    this.onClubAiCancel();
    this.setData({ aiSheetShow: false });
  },
  onClubAiIdea(e) { this.setData({ aiIdea: e.detail.value }); },
  onClubAiStyle(e) { this.setData({ aiClubStyle: e.detail.value }); },
  onClubAiDuration(e) { this.setData({ aiDurationMin: e.detail.value }); },
  onClubAiChip(e) { this.setData({ aiIdea: e.currentTarget.dataset.c || '' }); },

  onClubAiGenerate() {
    const idea = (this.data.aiIdea || '').trim();
    if (!idea) { cyToast('先用一句话说说想法'); return; }
    if (this.data.aiState === 'generating') return;
    const body = { idea: idea, clubStyle: (this.data.aiClubStyle || '').trim() };
    const dur = parseInt(this.data.aiDurationMin, 10);
    if (dur > 0) body.targetDurationMin = dur;
    const token = (this._clubAiToken || 0) + 1;
    this._clubAiToken = token;
    const that = this;
    this.setData({ aiState: 'generating', aiErrorText: '' });
    app.sendRequest({
      url: '/api/ai/club/design', method: 'POST', hideLoading: true,
      // silentError:code!=200 时 request-client 会自动弹一次 toast,这里改在 sheet 里内联报错,避免双弹+toast 被面板挡
      silentError: true,
      data: JSON.stringify(body),
      header: { 'Content-Type': 'application/json' },
      success(res) {
        if (token !== that._clubAiToken) return;   // 已取消 / 被新一次生成取代
        if (res.code != '200') {
          const msg = (res && res.msg) || '生成失败,请重试';
          that.showClubAiError(msg, msg.indexOf(AI_QUOTA_MARK) < 0);
          return;
        }
        const d = res.data || {};
        // parseError 非 null = AI 响应解析炸了,plan/merchantSuggestions/promoCopy 均不可信(后端 VO javadoc)
        if (d.parseError) { that.showClubAiError(d.parseError, true); return; }
        // plan 为 null 且无 parseError = AI 没给方案(静默空成功),与「解析炸了」是两回事
        if (!d.plan) { that.showClubAiError('AI 这次没给出方案,换个说法再试试', true); return; }
        that._aiResp = d;
        that.setData({
          aiState: 'done',
          aiPlan: d.plan,
          aiMerchantSuggestions: d.merchantSuggestions || [],
          aiPromoCopy: d.promoCopy || '',
        });
      },
      fail() {
        if (token !== that._clubAiToken) return;
        that.showClubAiError('网络错误,请检查网络后重试', true);
      },
      // HTTP statusCode!=200(如部署期 502)时 request-client 只弹 toast 就 return,success/fail 都不调
      // → 不兜底状态机会永远停在 generating(面板转圈、且 :239 的在途守卫让重试也点不动)。
      complete() {
        if (token !== that._clubAiToken) return;
        if (that.data.aiState === 'generating') that.showClubAiError('生成失败,请稍后重试', true);
      },
    });
  },

  showClubAiError(text, canRetry) {
    this.setData({ aiState: 'error', aiErrorText: text, aiCanRetry: !!canRetry });
  },

  onClubAiCancel() {
    this._clubAiToken = (this._clubAiToken || 0) + 1;   // 作废在途请求的回调(sendRequest 不可中断)
    this.setData({ aiState: 'idle' });
  },

  onClubAiCopy() {
    const copy = this.data.aiPromoCopy;
    if (!copy) return;
    wx.setClipboardData({ data: copy });   // 自带「内容已复制」提示,不再补 toast
  },

  // 一键采用:适配成 fabu 的 ai_topic_draft → 走 storage 交接(URL query 扁平,承载不了 chapters)
  onClubAiAdopt() {
    const resp = this._aiResp;
    if (!resp || !resp.plan) return;
    wx.removeStorageSync('ai_topic_draft');
    const key = aiDraftStorageKey();
    if (!key) { this.showClubAiError('请先登录再继续编辑', false); return; }
    wx.setStorageSync(key, aiPlanToDraft(resp));
    const cid = (this.data.club && this.data.club.id) || this.data.clubId;
    this.setData({ aiSheetShow: false });
    modal.show({
      title: '方案已带到发布页',
      content: '标题、简介和节点已回填。封面图和活动分类 AI 给不了,需要你手动补齐后才能发布。',
      showCancel: false, confirmText: '去发布',
      success() { wx.navigateTo({ url: '/pages/publish/fabu/index?clubId=' + cid }); },
    });
  },

  // §17.2 商家看俱乐部主页 → 发起俱乐部合作(coop/invite 类型1,含选主题+条款)。
  // 从本俱乐部主页发起,目标已明确 ⇒ 带上 clubId/name,coop/invite 收到 presetTarget 后
  // 跳过类型切换 + 「选择俱乐部」列表,直接进条款+发送(第8批 UI 修改:去掉多余的选择步骤)。
  goClubCoop() {
    const c = this.data.club;
    const cid = (c && c.id) || this.data.clubId;
    const q = ['type=1'];
    if (this._operationScope) q.push('scope=MERCHANT');
    if (cid) q.push('toId=' + cid);
    if (c && c.name) q.push('toName=' + encodeURIComponent(c.name));
    if (c && c.logo) q.push('toLogo=' + encodeURIComponent(c.logo));
    if (c) {
      const clubMeta = [c.memberCount != null ? c.memberCount + ' 位成员' : '', c.city || ''].filter(Boolean).join(' · ');
      if (clubMeta) q.push('toMeta=' + encodeURIComponent(clubMeta));
    }
    // 带主题进来的,主题已经定了 —— 别让人在表单里再选一遍
    if (this.data.topicId) {
      q.push('topicId=' + this.data.topicId);
      if (this.data.topicName) q.push('topicName=' + encodeURIComponent(this.data.topicName));
    }
    wx.navigateTo({ url: '/pages/coop/invite/index?' + q.join('&') });
  },

  // 点商家卡 → 统一主页的「关于」。名单行本来就带 memberId(发邀请那条也用它),
  // 不必再拿 merchantId 多绕一次解析。
  goMerchantProfile(e) {
    const url = merchantHomeUrl(e.currentTarget.dataset.memberid);
    if (url) wx.navigateTo({ url: url });
    else cyToast('该商家暂不可查看');
  },

  // 发邀请入口已随卡片重设计移到商家主页底部「发起合作」栏(cy-profile,type=0);
  // 原 onInviteMerchant 按用户 Figma 定稿(找场地卡去按钮)随之退役,2026-08-20 删除。

  // 本团贡献榜(/api/club/leaderboard)
  // sortBy: composite(综合分,默认) / mileage(里程) / duration(完成用时,升序)。排序在后端做,
  // 因为综合分的权重是后端常量 —— 前端自己排会两边口径漂移。
  loadLeaderboard() {
    const that = this;
    const sortBy = this._leaderboardSort || 'composite';
    app.sendRequest({
      hideLoading: true, url: '/api/club/leaderboard', method: 'POST',
      data: jsonBody({ id: this.data.clubId, sortBy }), header: jsonHeader(),
      success(res) {
        const list = (res.code == '200' && res.data) || [];
        that.setData({ leaderboard: foldLeaderboard(list.map((it) => that.decorateRank(it, sortBy)), that.data.myMemberId), leaderboardLoaded: true, leaderboardError: '', leaderboardEmptyTitle: leaderboardEmptyTitle(sortBy) });
      },
      // E-09(2026-09-16):失败渲染成「还没有人通关」= 把不知道说成没有。留错误态+重试。
      fail() { that.setData({ leaderboardLoaded: true, leaderboardError: '网络不稳定，榜单没能加载出来' }); },
    });
  },

  // 榜单文案。主数值跟着当前 tab 走 —— 切到里程榜还在显示综合分,用户会以为排序坏了。
  decorateRank(item, sortBy) {
    // 后端是 BigDecimal.setScale(1),但 Jackson 发的是 JSON 数字:15.0 到了 JS 就是 15,
    // 直接拼串会得到「15 km」而隔壁是「42.3 km」,小数位一行一个样。统一补回 1 位。
    const fx = (v) => Number(v || 0).toFixed(1);
    // completionDuration 为 null/缺省 = 单节点或没有有效计时,不是 0 分钟完成。
    const durationMin = Number(item.durationMin || 0);
    const durationText = durationMin > 0
      ? (Math.floor(durationMin / 60) ? Math.floor(durationMin / 60) + '小时' + (durationMin % 60) + '分' : durationMin + '分')
      : '—';
    const mileageText = fx(item.mileage) + ' km';
    let primaryText;
    if (sortBy === 'mileage') primaryText = mileageText;
    else if (sortBy === 'duration') primaryText = durationText;
    else primaryText = fx(item.score) + ' 分';
    return Object.assign({}, item, { durationText, mileageText, primaryText });
  },

  // 稿把三档排序从 chip tabs 收成榜头右侧一个「综合 ▾」。三选一用系统 actionSheet:
  // 原生控件自带无障碍与安全区,自己搭一个下拉只是多一份要维护的弹层。
  // 稿把三档排序从 chip tabs 收成榜头右侧一个「综合 ▾」。
  // ⚠️ 不走原生 actionSheet —— 本页有一条禁令合同(club-journey-audit-fix)钉着:
  //    原生菜单 6 项上限、长文案会被截断,而且失败时点了没有任何反馈。
  //    这里只有三档、当下不触顶,但本页早就有 openChoiceSheet 这套半屏清单,
  //    复用它比再养一条「只有这处例外」的规则便宜。
  onRankSortTap() {
    const that = this;
    const tabs = this.data.rankTabs || [];
    this.openChoiceSheet('排序方式', '', tabs.map((t) => ({ key: t.key, label: t.label })), function (picked) {
      if (!picked || picked.key === that._leaderboardSort) return;
      that.setData({
                leaderboardSortLabel: picked.label,
        leaderboardLoaded: false,
      });
      that.loadLeaderboard();
    });
  },

  // 动态治理:删除(作者/群主/管理员)+ 举报
  // 三段式第一段:确认。文案(后果 + 「此操作不可撤销」)在 utils/danger-actions.js。
  // CU-C-107:把待删正文前段一并带进确认标题 —— 列表里多条动态时,只问「删除这条动态?」核对不了目标。
  onDeletePost(e) {
    const id = e.currentTarget.dataset.id;
    const post = this.findPost(id);
    const dc = this.selectComponent && this.selectComponent('#dcPost');
    if (dc) dc.open('club.post.delete', { id: id, name: postExcerpt(post && post.content) });
  },
  _doDeletePost(id) {
    const that = this, dc = this.selectComponent && this.selectComponent('#dcPost');
    if (dc) dc.busyOn();
    app.sendRequest({
      url: '/api/club/post/delete', method: 'POST', data: jsonBody({ id: id }), header: jsonHeader(),
      success(res) {
        if (res.code == '200') { if (dc) dc.done(); that.loadPosts(); }
        else if (dc) dc.failed(res.msg || '删除失败');
      },
      fail() { if (dc) dc.failed('网络异常，请重试'); },
    });
  },
  onReportPost(e) {
    const id = e.currentTarget.dataset.id;
    modal.show({
      title: '举报动态', content: '确认举报?平台将尽快处理。', confirmText: '举报',
      success(r) {
        if (!r.confirm) return;
        app.sendRequest({ url: '/api/club/post/report', method: 'POST', data: jsonBody({ id: id }), header: jsonHeader(), success(res) { cyToast(res.msg || '已举报'); } });
      }
    });
  },

  loadPosts() {
    const that = this;
    if (isDemoClubId(this.data.clubId)) {
      const posts = mockData.getDemoClubPosts().map(function (p) {
        return normalizeClubPost(p, that.data.club && that.data.club.memberId);
      });
      that.setData({ posts: posts, postsLoaded: true }, function () { that.scrollToRequestedPost(); });
      return;
    }
    app.sendRequest({
      hideLoading: true, url: '/api/club/post/list', method: 'POST', data: jsonBody({ id: this.data.clubId, clubId: this.data.clubId }), header: jsonHeader(),
      success(res) {
        // E-09(2026-09-16):失败原来是 rows=[] → 渲染成「还没有帖子」(把「不知道」说成「没有」)。
        if (res.code != '200' || !Array.isArray(res.data)) {
          that.setData({ postsLoaded: true, postsError: bizFailureMessage(res, '帖子没能加载出来') });
          return;
        }
        const posts = res.data.map(function (p) {
          return normalizeClubPost(p, that.data.club && that.data.club.memberId);
        });
        that.setData({ posts: posts, postsLoaded: true, postsError: '' }, function () { that.scrollToRequestedPost(); });
      },
      fail() { that.setData({ postsLoaded: true, postsError: '网络不稳定，帖子没能加载出来' }); },
    });
  },

  openComposer() { this.setData({ composerOpen: true }); },

  scrollToRequestedPost() {
    const postId = this._requestedPostId;
    if (!postId || !(this.data.posts || []).some(function (post) { return String(post.id) === postId; })) return;
    this._requestedPostId = '';
    wx.pageScrollTo({ selector: '#club-post-' + postId, duration: 250, offsetTop: 24 });
  },
  closeComposer() { this.setData({ composerOpen: false }); },

  onPostText(e) { this.setData({ postText: e.detail.value }); },

  onToggleAnnouncement() {
    if (!this.data.canModerateContent) return;
    this.setData({ postAsAnnouncement: !this.data.postAsAnnouncement });
  },

  onPickPostImage() {
    const that = this;
    const left = 9 - this.data.postImages.length;
    if (left <= 0) { cyToast('最多9张'); return; }
    app.chooseImage(function (urls) {
      if (urls && urls.length) that.setData({ postImages: that.data.postImages.concat(urls).slice(0, 9) });
    }, left);
  },

  onRemovePostImage(e) {
    const i = e.currentTarget.dataset.index;
    const arr = this.data.postImages.slice();
    arr.splice(i, 1);
    this.setData({ postImages: arr });
  },

  onPostSubmit() {
    const text = (this.data.postText || '').trim();
    const imgs = this.data.postImages;
    if (!text && !imgs.length) { cyToast('说点什么，或加张图'); return; }
    if (this.data.posting) return;
    const ref = this.data.postRef;
    this.setData({ posting: true });
    const that = this;
    app.sendRequest({
      url: '/api/club/post/create', method: 'POST',
      data: JSON.stringify({
        clubId: this.data.clubId,
        content: text,
        images: imgs.join(','),
        type: this.data.postAsAnnouncement ? 2 : 0,
        // 没选就一个字段都不带 —— 半个引用(只有类型没有 ID)会被服务端挡下,
        // 但更该在这里就不产生
        refType: ref ? ref.refType : null,
        refId: ref ? ref.refId : null,
      }),
      header: { 'Content-Type': 'application/json', 'Authorization': app.getAuthorization() },
      success(res) {
        that.setData({ posting: false });
        if (res.code == '200') {
          that.setData({ postText: '', postImages: [], postAsAnnouncement: false, postRef: null });
          that.loadPosts();
        }
        else cyToast((res && res.msg) || '发布失败');
      },
      fail() { that.setData({ posting: false }); cyToast('网络异常，请重试'); },
    });
  },

  /* ——— 「带上一次游玩记录」———
   * 列表吃 /api/registration/my-joined:我报名参加过的主题与活动本来就在那儿,
   * 不为这个选择器另开一条查询。ownerType 与引用类型的对应是**这一处**定死的:
   *   ownerType=2(活动)→ refType=1(活动完赛)   ownerType=1(主题)→ refType=2(主题/模板)
   * 编号本身照抄广场帖的 dataType,前端那套 variant 判定才认得。
   */
  openPostRefPicker() {
    this.setData({ postRefPickerShow: true });
    if (this.data.postRefState !== 'ready') this.loadPostRefOptions();
  },
  closePostRefPicker() { this.setData({ postRefPickerShow: false }); },
  onClearPostRef() { this.setData({ postRef: null }); },

  loadPostRefOptions() {
    const that = this;
    this.setData({ postRefState: 'loading', postRefErrorText: '' });
    app.sendRequest({
      hideLoading: true, silentError: true,
      url: '/api/registration/my-joined', method: 'POST',
      data: jsonBody({}), header: jsonHeader(),
      success(res) {
        if (!isSuccess(res) || !Array.isArray(res.data)) {
          that.setData({ postRefState: 'error', postRefErrorText: bizFailureMessage(res, '暂时读不到你的游玩记录') });
          return;
        }
        that.setData({ postRefState: 'ready', postRefOptions: buildPostRefOptions(res.data) });
      },
      fail() { that.setData({ postRefState: 'error', postRefErrorText: '网络异常，没能读到你的游玩记录' }); },
    });
  },

  onPickPostRef(e) {
    const opt = this.data.postRefOptions[Number(e.currentTarget.dataset.index)];
    if (!opt) return;
    this.setData({ postRef: opt, postRefPickerShow: false });
  },

  findPost(postId) {
    return (this.data.posts || []).find(function (item) {
      return String(item.id) === String(postId);
    }) || null;
  },

  onEditPost(e) {
    const post = this.findPost(e.currentTarget.dataset.id);
    if (!post) return;
    const isAuthor = String(post.authorMemberId) === String(this.data.myMemberId);
    if (!isAuthor && !(this.data.canModerateContent && Number(post.type) === 2)) return;
    this._postEditOrigin = post.content || '';
    this.setData({
      postEditShow: true,
      postEditId: post.id,
      postEditText: post.content || '',
      postEditImages: post.images || '',
      postEditVersion: Number(post.version || 0),
      postEditSubmitting: false,
      postEditDirty: false,
      postEditDiscardConfirm: false,
    });
  },

  onPostEditText(e) {
    const value = e.detail.value;
    // CU-C-106:改动以正文为准(图片这次不改);关面板前要用它决定是否需要问一句。
    this.setData({ postEditText: value, postEditDirty: String(value || '') !== String(this._postEditOrigin || '') });
  },

  closePostEdit() {
    if (this.data.postEditSubmitting) return;
    this.setData({
      postEditShow: false, postEditId: null, postEditText: '', postEditImages: '',
      postEditDirty: false, postEditDiscardConfirm: false,
    });
  },

  /* CU-C-106:panel 只挡住了遮罩与拖拽关闭,右上 ✕ 走 close —— 原来 closePostEdit 无条件清空,
     刚写的正文就没了,而新发帖框「收起→重开」是保留的(两处退出语义不一致)。
     有改动时面板只发 requestclose(干净时它还会接着发 close,交给 closePostEdit)。 */
  requestClosePostEdit() {
    if (!this.data.postEditDirty) return;
    if (this.data.postEditDiscardConfirm) return;
    this.setData({ postEditDiscardConfirm: true });
  },

  confirmDiscardPostEdit() { this.setData({ postEditDiscardConfirm: false }); this.closePostEdit(); },
  cancelDiscardPostEdit() { this.setData({ postEditDiscardConfirm: false }); },

  submitPostEdit() {
    const content = (this.data.postEditText || '').trim();
    if (!content && !this.data.postEditImages) {
      cyToast('说点什么，或保留图片');
      return;
    }
    if (this.data.postEditSubmitting) return;
    this._postRequestIntents = this._postRequestIntents || {};
    const intent = planClubPostRequestIntent('club-post-edit', {
      clubId: this.data.clubId,
      id: this.data.postEditId,
      content,
      images: this.data.postEditImages,
      version: this.data.postEditVersion,
    }, this._postRequestIntents);
    this.setData({ postEditSubmitting: true });
    const that = this;
    app.sendRequest({
      url: '/api/club/post/update', method: 'POST',
      data: jsonBody({
        id: this.data.postEditId,
        content,
        images: this.data.postEditImages,
        version: this.data.postEditVersion,
        requestId: intent.requestId,
      }),
      header: jsonHeader(),
      success(res) {
        if (res.code == '200') {
          clearClubPostRequestIntent(intent, that._postRequestIntents);
          that.setData({ postEditShow: false, postEditId: null, postEditText: '', postEditImages: '', postEditDirty: false, postEditDiscardConfirm: false });
          that.loadPosts();
          cyToast('已更新');
          return;
        }
        if (isExplicitClientFailure(res)) clearClubPostRequestIntent(intent, that._postRequestIntents);
        cyToast((res && res.msg) || '更新失败');
      },
      fail() { cyToast('网络异常，请重试'); },
      successStatusAbnormal(res, statusCode) {
        if (isExplicitClientFailure(res, statusCode)) {
          clearClubPostRequestIntent(intent, that._postRequestIntents);
        }
        cyToast((res && res.msg) || '更新失败');
      },
      complete() { that.setData({ postEditSubmitting: false }); },
    });
  },

  onTogglePin(e) {
    const post = this.findPost(e.currentTarget.dataset.id);
    if (!post || !this.data.canModerateContent || Number(post.type) !== 2) return;
    const that = this;
    const pinned = Number(post.isPinned) !== 1;
    this._postRequestIntents = this._postRequestIntents || {};
    const intent = planClubPostRequestIntent('club-post-pin', {
      clubId: this.data.clubId,
      id: post.id,
      pinned,
      version: Number(post.version || 0),
    }, this._postRequestIntents);
    app.sendRequest({
      url: '/api/club/post/pin', method: 'POST',
      data: jsonBody({
        id: post.id,
        pinned,
        version: Number(post.version || 0),
        requestId: intent.requestId,
      }),
      header: jsonHeader(),
      success(res) {
        if (res.code == '200') clearClubPostRequestIntent(intent, that._postRequestIntents);
        else if (isExplicitClientFailure(res)) {
          clearClubPostRequestIntent(intent, that._postRequestIntents);
        }
        cyToast((res && res.msg) || (res.code == '200' ? '已更新' : '操作失败'));
        if (res.code == '200') that.loadPosts();
      },
      fail() { cyToast('网络异常，请重试'); },
      successStatusAbnormal(res, statusCode) {
        if (isExplicitClientFailure(res, statusCode)) {
          clearClubPostRequestIntent(intent, that._postRequestIntents);
        }
        cyToast((res && res.msg) || '操作失败');
      },
    });
  },

  onViewPostHistory(e) {
    const postId = e.currentTarget.dataset.id;
    if (!postId) return;
    this.setData({ postHistoryShow: true, postHistoryState: 'loading', postHistoryRows: [] });
    const that = this;
    app.sendRequest({
      hideLoading: true,
      url: '/api/club/post/history', method: 'POST',
      data: jsonBody({ id: postId }), header: jsonHeader(),
      success(res) {
        if (res.code != '200' || !Array.isArray(res.data)) {
          that.setData({ postHistoryState: 'error' });
          return;
        }
        const rows = res.data.map(function (row) {
          return Object.assign({}, row, {
            versionText: '修改前 v' + (Number(row.snapshotVersion || 0) + 1),
            timeText: formatPostTime(row.createTime),
          });
        });
        that.setData({ postHistoryState: 'ready', postHistoryRows: rows });
      },
      fail() { that.setData({ postHistoryState: 'error' }); },
    });
  },

  closePostHistory() {
    this.setData({ postHistoryShow: false, postHistoryState: 'idle', postHistoryRows: [] });
  },

  // CU-C-108:帖子列表与俱乐部详情是**并发**拉的,首屏 loadPosts 经常在 club 到达之前就结算 ——
  // 那时拿不到 clubOwnerId,整批作者徽标是空的;之后任何一次 loadPosts(点赞/评论/编辑)才带上。
  // 用户看到的就是「主理人」标记跟点赞有关系。详情回来之后按同一判据重跑一次装饰。
  applyClubOwnerBadge() {
    const ownerId = this.data.club && this.data.club.memberId;
    const posts = this.data.posts || [];
    if (!ownerId || !posts.length) return;
    let changed = false;
    const next = posts.map(function (p) {
      // 判据只有一处:再过一遍 normalizeClubPost 取徽标,不在这里另写一个三元
      const badge = normalizeClubPost(p, ownerId).authorBadge;
      if (p.authorBadge === badge) return p;
      changed = true;
      return Object.assign({}, p, { authorBadge: badge });
    });
    if (changed) this.setData({ posts: next });
  },

  loadDetail(cb) {
    const that = this;
    if (isDemoClubId(this.data.clubId)) {
      const club = enrichClub(mockData.getDemoClubDetail());
      const legacyCanGovern = that.canGovern(club);
      const sameClub = that.data.club && String(that.data.club.id) === String(club.id);
      const immediateCanUseManageTab = legacyCanGovern || (sameClub && that.data.canUseManageTab);
      const canKeepTab = that.data.tabInitialized && (immediateCanUseManageTab || that.data.activeTab !== 'manage');
      const requestedTab = that._requestedTab === 'manage' && legacyCanGovern ? 'manage' : '';
      const initialTab = canKeepTab ? that.data.activeTab : (requestedTab || that.defaultTabForClub(club));
      if (requestedTab) that._requestedTab = '';
      that.setData({ club: club, canSeeMembers: false, canUseManageTab: immediateCanUseManageTab, detailLoaded: true, notFound: false, activeTab: initialTab, clubTabs: that.tabsForClub(club, immediateCanUseManageTab), tabInitialized: true });
      cb && cb();
      return;
    }
    app.sendRequest({
      hideLoading: true, url: '/api/club/detail', method: 'POST', data: jsonBody({ id: this.data.clubId }), header: jsonHeader(),
      success(res) {
        const club = enrichClub((res.code == '200' && res.data) || null);
        const canSee = !!(club && (club.isOwner || club.isJoined));
        const legacyCanGovern = that.canGovern(club);
        const sameClub = !!club && that.data.club && String(that.data.club.id) === String(club.id);
        const immediateCanUseManageTab = legacyCanGovern || (sameClub && that.data.canUseManageTab);
        const canKeepTab = !!club && that.data.tabInitialized && (immediateCanUseManageTab || that.data.activeTab !== 'manage');
        const requestedTab = that._requestedTab === 'manage' && legacyCanGovern ? 'manage' : '';
        const initialTab = canKeepTab ? that.data.activeTab : (requestedTab || that.defaultTabForClub(club));
        if (requestedTab) that._requestedTab = '';
        that.setData({ club: club, canSeeMembers: canSee, canUseManageTab: immediateCanUseManageTab, detailLoaded: true, notFound: !club, activeTab: initialTab, clubTabs: that.tabsForClub(club, immediateCanUseManageTab), tabInitialized: that.data.tabInitialized || !!club });
        that.applyClubOwnerBadge();  // CU-C-108:club 到了,把早到的帖子徽标补上
        if (canSee) {
          that.loadMembers();
          that.loadClubAccess();
        } else {
          that.revokeClubAccess('idle');
        }
      },
      fail() { that.setData({ detailLoaded: true, notFound: true }); cyToast('加载失败'); },
      complete() { cb && cb(); },
    });
  },

  loadTopics(cb) {
    const that = this;
    this.setData({ topicsLoaded: false, topicState: 'loading' });
    if (isDemoClubId(this.data.clubId)) {
      const list = mockData.getDemoClubTopics().map(function (t) {
        return decorateTopicCard(Object.assign({}, t, {
          dateText: dateOf(t.startDate),
          ended: false,
        }));
      });
      that._topics = list;
      const split = splitTopics(list);
      // 把两个键写明,不用 Object.assign 摊开 —— U4 只能核对字面量里的顶层字段,
      // 摊开就成了「动态 setData」,得去 ui-integrity-baseline 按 file:line 登记,
      // 而那种键一改上面几行就漂,等于给门禁埋了个会自己烂掉的豁免。
      that.setData({
        manageTopics: that.scopedManageTopics(list),
        topicsLoaded: true,
        topicState: 'ready',
        upcomingTopics: split.upcomingTopics,
        endedTopics: split.endedTopics,
      });
      that.refreshEventCalendar();
      that.applySentInviteFilter();
      cb && cb();
      return;
    }
    app.sendRequest({
      hideLoading: true, url: '/api/club/topics', method: 'POST', data: jsonBody({ id: this.data.clubId }), header: jsonHeader(),
      success(res) {
        if (!isSuccess(res) || !Array.isArray(res.data)) {
          that._topics = [];
      that.setData({ manageTopics: [], topicsLoaded: true, topicState: 'error', upcomingTopics: [], endedTopics: [] });
          that.applySentInviteFilter();
          that.updateOwnerStage();
          return;
        }
        const rows = res.data;
        const now = Date.now();
        const list = rows.map(function (t) {
          const end = t.endDate ? toTimestamp(String(t.endDate)) : 0;
          return decorateTopicCard(Object.assign({}, t, {
            dateText: dateOf(t.startDate),
            ended: end > 0 && end < now,
          }));
        });
        that._topics = list;
        const split = splitTopics(list);
        // 把两个键写明,不用 Object.assign 摊开 —— U4 只能核对字面量里的顶层字段,
        // 摊开就成了「动态 setData」,得去 ui-integrity-baseline 按 file:line 登记,
        // 而那种键一改上面几行就漂,等于给门禁埋了个会自己烂掉的豁免。
        that.setData({
          manageTopics: that.scopedManageTopics(list),
          topicsLoaded: true,
          topicState: 'ready',
          upcomingTopics: split.upcomingTopics,
          endedTopics: split.endedTopics,
        });
        that.refreshEventCalendar();
        that.applySentInviteFilter();
      },
      fail() {
        that._topics = [];
      that.setData({ manageTopics: [], topicsLoaded: true, topicState: 'error', upcomingTopics: [], endedTopics: [] });
        that.applySentInviteFilter();
        that.updateOwnerStage();
      },
      complete() { cb && cb(); },
    });
  },

  scopedManageTopics(topics) {
    const list = Array.isArray(topics) ? topics : [];
    const club = this.data.club;
    if (club && (this.canGovern(club) || this.data.canManageActivities || this.data.canOperateEvents
        || this.data.canCheckInEvents || this.data.canManageRoles)) return list;
    if (this.data.clubAccessState !== 'ready' || !this.data.hasEventScope) return [];
    const topicIds = this._eventTopicIds || {};
    return list.filter(function (item) {
      const topicId = positiveId(item && item.id);
      return !!(topicId && topicIds[String(topicId)]);
    });
  },

  refreshManageTopics() {
    this.setData({ manageTopics: this.scopedManageTopics(this._topics) });
  },

  onEventViewChange(e) {
    const view = (e.detail && e.detail.key) || (e.currentTarget && e.currentTarget.dataset.view);
    if (view !== 'list' && view !== 'calendar') return;
    this.setData({ eventView: view });
    if (view === 'calendar') this.refreshEventCalendar();
  },

  onShiftEventMonth(e) {
    const delta = Number(e.currentTarget && e.currentTarget.dataset.delta);
    if (!Number.isInteger(delta) || !delta) return;
    this.setData({ eventCalendarMonth: shiftMonth(this.data.eventCalendarMonth, delta) });
    this.refreshEventCalendar();
  },

  refreshEventCalendar() {
    const calendar = buildMonthCalendar(this.data.eventCalendarMonth, this._topics);
    const hasEvents = calendar.cells.some(function (cell) {
      return cell.inMonth && cell.events.length > 0;
    });
    this.setData({
      eventCalendarTitle: calendar.title,
      eventCalendarCells: calendar.cells,
      eventCalendarHasEvents: hasEvents,
    });
  },

  loadMembers() {
    const that = this;
    this.setData({ members: [], membersState: 'loading', memberStrip: [] });
    app.sendRequest({
      hideLoading: true, url: '/api/club/members', method: 'POST', data: jsonBody({ clubId: this.data.clubId }), header: jsonHeader(),
      success(res) {
        if (res.code != '200' || !Array.isArray(res.data)) {
          that.setData({ members: [], membersState: 'business-error', memberStrip: [] });
          return;
        }
        that.setData({ members: res.data, membersState: 'ready', memberStrip: buildMemberStrip(res.data, that.data.club && that.data.club.memberCount) });
      },
      fail() { that.setData({ members: [], membersState: 'network-error', memberStrip: [] }); },
    });
  },

  // 内容治理权限来自 access/me,角色撤销后立即回落;但 club.viewerIsAdmin(源头是
  // club_member.role=1,由 /set-member-role 同步维护)仍在 wxml 里撑着治理入口的显隐
  // —— 两套真源并存是实况,别当 club_member.role 已经退役。
  revokeClubAccess(state, keepRequest) {
    if (!keepRequest) this._clubAccessRequestSeq = (this._clubAccessRequestSeq || 0) + 1;
    const club = this.data.club;
    const legacyCanGovern = this.canGovern(club);
    this._eventAccessByActivity = {};
    this._eventTopicIds = {};
    const activeTab = !legacyCanGovern && this.data.activeTab === 'manage'
      ? this.defaultTabForClub(club) : this.data.activeTab;
    this.setData({
      clubAccessState: state || 'error',
      canModerateContent: false,
      canReadMembers: legacyCanGovern,
      canApproveMembers: legacyCanGovern,
      canManageMembers: false,
      canManageRoles: false,
      // ★ 通知不吃 legacy 兜底:CLUB_LEGACY_ADMIN 在后端没有 NOTIFY_SEND。
      //   access 拉不到时宁可少给入口,也不给一个点进去必被拒的假入口。
      canSendNotify: false,
      canManageActivities: false,
      canOperateEvents: false,
      canCheckInEvents: false,
      hasEventScope: false,
      canUseManageTab: legacyCanGovern,
      clubTabs: legacyCanGovern ? PUBLIC_TABS.concat([{ key: 'manage', label: '管理' }]) : PUBLIC_TABS,
      activeTab: activeTab,
    });
    this.refreshManageTopics();
  },

  loadClubAccess() {
    const that = this;
    const clubId = this.data.clubId;
    const requestSeq = (this._clubAccessRequestSeq || 0) + 1;
    this._clubAccessRequestSeq = requestSeq;
    this.revokeClubAccess('loading', true);
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/club/access/me',
      method: 'POST',
      data: jsonBody({ clubId: clubId }),
      header: jsonHeader(),
      success(res) {
        if (requestSeq !== that._clubAccessRequestSeq
            || String(clubId) !== String(that.data.clubId)) return;
        const access = isSuccess(res) && isRecord(res.data) ? res.data : null;
        const scopedClub = access && isRecord(access.club) ? access.club : null;
        const permissions = access && Array.isArray(access.permissions)
          && access.permissions.every(function (item) { return typeof item === 'string'; })
          ? access.permissions : null;
        if (!access || access.active !== true || !scopedClub
            || String(scopedClub.id) !== String(clubId) || !permissions) {
          that.revokeClubAccess('error', true);
          return;
        }
        const has = function (permission) { return permissions.indexOf(permission) >= 0; };
        const roleCodes = Array.isArray(access.roleCodes)
          && access.roleCodes.every(function (item) { return typeof item === 'string'; })
          ? access.roleCodes : [];
        const eventAccess = shapeEventAccesses(access.eventAccesses);
        if (!eventAccess) {
          that.revokeClubAccess('error', true);
          return;
        }
        const canManageClub = has('club:write');
        const legacyCanGovern = that.canGovern();
        const canReadMembers = legacyCanGovern || has('club:member:list:read');
        const canApproveMembers = legacyCanGovern || has('club:member:approve');
        const canManageMembers = has('club:member:manage');
        const canManageContent = has('club:content:manage');
        const canManageRoles = has('club:role:manage');
        // ★ 2026-08-26:legacyCanGovern(= #845 的 canGovern:owner 或 role=1)只对应后端
        //   MEMBER_* 那几项。ClubPermissionPolicy 给 CLUB_LEGACY_ADMIN 的是
        //   CLUB_READ / MEMBER_LIST_READ / MEMBER_APPROVE / MEMBER_MANAGE /
        //   CONTENT_MANAGE / ACTIVITY_READ —— **没有 NOTIFY_SEND**。
        //   把它或进通知入口 = 旧管理员看得见、点进去被后端拒 = 假入口。
        const canSendNotify = has('club:notify:send');
        const canManageActivities = has('club:activity:manage');
        const canOperateEvents = has('club:event:operate');
        const canCheckInEvents = has('club:event:checkin');
        const canReadFinance = has('club:finance:read');
        const hasEventScope = eventAccess.rows.length > 0;
        const canUseManageTab = legacyCanGovern || canManageClub || canApproveMembers || canManageMembers || canManageContent || canManageRoles || canSendNotify
          || canManageActivities || canOperateEvents || canCheckInEvents || canReadFinance || hasEventScope;
        const requestedManage = that._requestedTab === 'manage' && canUseManageTab;
        const nextActiveTab = requestedManage ? 'manage' : that.data.activeTab;
        if (requestedManage) that._requestedTab = '';
        that._eventAccessByActivity = eventAccess.byActivity;
        that._eventTopicIds = eventAccess.byTopic;
        that.setData({
          clubAccessState: 'ready',
          canModerateContent: canManageClub || canManageContent,
          canReadMembers: canReadMembers,
          canApproveMembers: canApproveMembers,
          canManageMembers: canManageMembers,
          canManageRoles: canManageRoles,
          // 稿 M 268:223:角色与权限那一行右侧的「N 已委派」。只有 ROLE_MANAGE
          // 才拿得到这个数(治理信息不进公开的 /api/club/detail),没有就不显示。
          delegatedRoleCount: Number(access.delegatedRoleCount) || 0,
          canSendNotify: canSendNotify,
          canManageActivities: canManageActivities,
          canOperateEvents: canOperateEvents,
          canCheckInEvents: canCheckInEvents,
          hasEventScope: hasEventScope,
          canUseManageTab: canUseManageTab,
          clubTabs: canUseManageTab
            ? PUBLIC_TABS.concat([{ key: 'manage', label: '管理' }]) : PUBLIC_TABS,
          activeTab: nextActiveTab,
        });
        that.refreshManageTopics();
      },
      fail() {
        if (requestSeq === that._clubAccessRequestSeq
            && String(clubId) === String(that.data.clubId)) {
          that.revokeClubAccess('error', true);
        }
      },
      successStatusAbnormal() {
        if (requestSeq === that._clubAccessRequestSeq
            && String(clubId) === String(that.data.clubId)) {
          that.revokeClubAccess('error', true);
        }
      },
    });
  },

  // CU-C-83(9-25 裁决:加「客户档案」直达):
  //  · 无客户管理权限的人 —— 点成员行照旧直接打开脱敏公开主页(公开资料就是给所有人的落点)。
  //  · 有权限的主理人/管理员 —— 多一个落点:弹半屏清单选「公开资料」或「客户档案」。
  //    客户档案跳该成员在本俱乐部的 CRM 客户详情,沿用客户列表 openCustomer 的现成路由。
  //    原来这一档要么一律去公开资料、要么按权限悄悄改道进客户详情(名称与实际用途打架);
  //    现在两个入口都摆明,点哪个去哪个。
  goMemberProfile(e) {
    const memberId = e.currentTarget.dataset.memberId;
    if (!memberId) return;
    const that = this;
    const goPublic = () => wx.navigateTo({ url: '/pages/userinfo/userinfo?userId=' + memberId });
    if (!this.canReadCustomerProfile()) { goPublic(); return; }
    this.openChoiceSheet('查看该成员', '', [
      { key: 'public', label: '公开资料' },
      { key: 'customer', label: '客户档案' },
    ], function (picked) {
      if (picked && picked.key === 'customer') {
        const clubId = that.data.clubId;
        if (clubId) {
          wx.navigateTo({ url: '/pages/club/customer-detail/index?clubId=' + clubId + '&memberId=' + memberId });
          return;
        }
      }
      goPublic();
    });
  },

  // 客户档案入口的权限闸,与设置里「查看客户」/CRM 计数同一把尺:主理人或管理员。
  canReadCustomerProfile() {
    const club = this.data.club || {};
    return !!(club.isOwner || club.viewerIsAdmin);
  },

  // 加入俱乐部：公开团即时加入，审批团只进入待审态。
  onJoin() {
    const that = this;
    if (isDemoClubId(this.data.clubId)) {
      cyToast('演示俱乐部，加入功能仅供预览');
      return;
    }
    // 稿 P3 30:2:审批团的申请下面有申请人写的一句话。只有审批团才问 ——
    // 公开直进的团点了就是成员,没人会去读那句话。
    const club = this.data.club || {};
    if (Number(club.joinPolicy) === 1) {
      modal.show({
        title: '申请加入', content: '给主理人说一句吧，比如你是谁、想跟哪种局。',
        editable: true, placeholderText: '朋友推荐来的，想跟一次夜行（选填）',
        confirmText: '提交申请',
        success(r) { if (r && r.confirm) that.submitJoin(String(r.content || '').slice(0, 60)); },
      });
      return;
    }
    this.submitJoin('');
  },

  submitJoin(joinMessage) {
    const that = this;
    app.sendRequest({
      url: '/api/club/join', method: 'POST',
      data: jsonBody({ id: this.data.clubId, joinMessage: joinMessage || '' }), header: jsonHeader(),
      success(res) {
        if (res.code == '200') {
          that.loadDetail();
          if (res.data && res.data.state === 'pending') {
            modal.show({
              title: '申请已提交', content: '等待审核。通过后才能进入群聊和使用成员功能。',
              showCancel: false,
            });
            return;
          }
          // 群聊入口 2026-09-09 按稿从俱乐部页撤掉,这里也不再引导进群
          modal.show({
            title: '已加入俱乐部', content: '欢迎！去「活动」看看最近有什么局。',
            showCancel: false,
          });
        } else {
          cyToast((res && res.msg) || '加入失败');
        }
      },
      fail() { cyToast('加入失败'); },
    });
  },

  goJoinRequests() {
    if (!this.data.club || !(this.canGovern() || this.data.canApproveMembers)) return;
    const that = this;
    wx.navigateTo({
      url: '/pages/club/join-requests/index?clubId=' + this.data.clubId,
      success(navigation) {
        if (navigation.eventChannel) navigation.eventChannel.on('joinRequestsChanged', function () {
          that.loadDetail();
          that.loadMembers();
        });
      }
    });
  },

  goClubRoles() {
    if (!this.data.club || !(this.data.club.isOwner || this.data.canManageRoles)
        || !this.data.clubId) return;
    wx.navigateTo({ url: '/pages/club/roles/index?clubId=' + this.data.clubId });
  },

  goMemberRoles(e) {
    const memberId = positiveId(e && e.currentTarget && e.currentTarget.dataset.memberId);
    const clubId = positiveId(this.data.clubId);
    const club = this.data.club;
    if (!club || !(club.isOwner || this.data.canManageRoles) || !clubId || !memberId
        || String(memberId) === String(club.memberId)) return;
    wx.navigateTo({ url: '/pages/club/roles/index?clubId=' + clubId + '&memberId=' + memberId });
  },

  goClubGovernance() {
    if (!this.data.club || !(this.canGovern() || this.data.canManageMembers)
        || !this.data.clubId) return;
    wx.navigateTo({ url: '/pages/club/governance/index?clubId=' + this.data.clubId });
  },

  goMemberGovernance(e) {
    const memberId = positiveId(e && e.currentTarget && e.currentTarget.dataset.memberId);
    const clubId = positiveId(this.data.clubId);
    const club = this.data.club;
    if (!club || !(this.canGovern(club) || this.data.canManageMembers) || !clubId || !memberId
        || String(memberId) === String(club.memberId)) return;
    wx.navigateTo({ url: '/pages/club/governance/index?clubId=' + clubId + '&memberId=' + memberId });
  },

  reportClubMember(e) {
    const dataset = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const memberId = positiveId(dataset.memberId);
    const clubId = positiveId(this.data.clubId);
    if (!this.data.canSeeMembers || !memberId || !clubId
        || String(memberId) === String(this.data.myMemberId)) return;
    // CU-C-82:举报页要写得清「举报的是谁」。目标名从行上带过去(此处不重查名单)。
    const nickname = reportTargetName(dataset.nickname);
    wx.navigateTo({
      url: '/pages/club/governance/index?clubId=' + clubId
        + '&mode=report&targetMemberId=' + memberId
        + (nickname ? '&targetName=' + encodeURIComponent(nickname) : ''),
    });
  },

  reportClub() {
    const clubId = positiveId(this.data.clubId);
    if (!this.data.canSeeMembers || !clubId) return;
    const clubName = reportTargetName(this.data.club && this.data.club.name);
    wx.navigateTo({
      url: '/pages/club/governance/index?clubId=' + clubId
        + '&mode=report&targetType=CLUB&targetId=' + clubId
        + (clubName ? '&targetName=' + encodeURIComponent(clubName) : ''),
    });
  },

  reportTopicActivity(e) {
    const topicId = positiveId(e && e.currentTarget && e.currentTarget.dataset.id);
    if (!this.data.canSeeMembers || !topicId || this._activityReportLoading) return;
    // CU-C-149:卡面上的入口已按作者隐藏,这里再守一道 —— 名单刚刷新、渲染还没跟上时,
    // 不该把人一路带进举报页填完再被后端打回来。判据与动态行 :160 / 成员行 :337 一致。
    const topic = (this._topics || []).find(function (item) { return String(item.id) === String(topicId); });
    if (topic && String(topic.memberId) === String(this.data.myMemberId)) return;
    const that = this;
    this._activityReportLoading = true;
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/topic/info-to-user',
      method: 'POST',
      data: { id: topicId },
      success(res) {
        const activities = listGroupCodeActivities(res && res.data && res.data.activityList);
        if (!isSuccess(res) || !activities.length) {
          cyToast('这个项目还没有可举报的具体活动');
          return;
        }
        if (activities.length === 1) {
          that.reportActivity(activities[0].id, activities[0].name);
          return;
        }
        that.openChoiceSheet(
          '选择要举报的场次',
          '',
          activities.map(function (item) {
            return { key: String(item.id), label: item.name };
          }),
          function (item) { that.reportActivity(item.key, item.label); }
        );
      },
      fail() { cyToast('活动列表加载失败，请稍后重试'); },
      complete() { that._activityReportLoading = false; },
    });
  },

  reportActivity(activityId, activityName) {
    const clubId = positiveId(this.data.clubId);
    const id = positiveId(activityId);
    if (!this.data.canSeeMembers || !clubId || !id) return;
    // CU-C-82:场次候选文案已是「活动名 · 开始时间」,一并带给举报页 —— 举报人不用对着空白表单
    // 回忆自己举报的是哪一场。没带名字时举报页仍显示目标 ID。
    const name = reportTargetName(activityName);
    wx.navigateTo({
      url: '/pages/club/governance/index?clubId=' + clubId
        + '&mode=report&targetType=ACTIVITY&targetId=' + id
        + (name ? '&targetName=' + encodeURIComponent(name) : ''),
    });
  },

  goClubAppeal() {
    const clubId = positiveId(this.data.clubId);
    if (!clubId) return;
    wx.navigateTo({ url: '/pages/club/governance/index?clubId=' + clubId + '&mode=appeal' });
  },

  // 主理人发起新团 → 锁定本俱乐部归属(直达 fabu),后端再校验俱乐部身份
  onCreateTeam() {
    if (!this.data.club || !(this.data.club.isOwner || this.data.canManageActivities)) return;
    const cid = (this.data.club && this.data.club.id) || this.data.clubId;
    this.openChoiceSheet(
      '发布主题',
      '选定后会先进入连续选点，随时取消即可回到编辑器继续填写',
      [
        { key: '1', label: '城市定向 · 顺序探索' },
        { key: '2', label: '自由探索 · 全点开放' },
      ],
      function (item) {
        const mode = item.key;
        wx.navigateTo({ url: '/pages/publish/fabu/index?clubId=' + cid + '&mode=' + mode });
      }
    );
  },

  // “开一场”统一进入活动运营；ONCE/WEEKLY/CUSTOM_DATES、容量、负责人和候补只保留一条真源。
  onOpenClubSession() {
    const club = this.data.club;
    const clubId = positiveId((club && club.id) || this.data.clubId);
    if (!club || !club.isOwner || !clubId) return;
    wx.navigateTo({ url: '/pages/club/event-ops/index?clubId=' + clubId + '&recurrence=ONCE' });
  },

  // 退出俱乐部(成员;群主不可退,后端拦)。退出同步移出团群。
  // CU-C-71:重入代价由 club.join_policy 决定(policy≠1 即时加入,后端 ClubMemberServiceImpl),
  // 文案必须跟着策略走 —— 全团统一写「重新申请并等主理人通过」对公开团是假话。
  onQuit() {
    const dc = this.selectComponent && this.selectComponent('#dcQuit');
    if (!dc) return;
    const club = this.data.club || {};
    const needsApproval = Number(club.joinPolicy) === 1;
    dc.open('club.quit', {
      name: club.name || '这个俱乐部',
      rejoin: needsApproval
        ? '要重新申请并等主理人通过'
        : '可以直接再点「加入俱乐部」，不需要审批',
      rejoinHint: needsApproval
        ? '随时可以重新提交申请，等主理人通过'
        : '随时可以再点「加入俱乐部」进来',
    });
  },
  _doQuit() {
    const that = this, dc = this.selectComponent && this.selectComponent('#dcQuit');
    if (dc) dc.busyOn();
    app.sendRequest({
      url: '/api/club/quit', method: 'POST', data: jsonBody({ id: that.data.clubId }), header: jsonHeader(),
      success(res) {
        if (res.code == '200') { if (dc) dc.done(); that.loadDetail(); }
        else if (dc) dc.failed((res && res.msg) || '退出失败');
      },
      fail() { if (dc) dc.failed('网络异常，请重试'); },
    });
  },

  // 预览动态配图
  onPreviewImage(e) {
    const detail = e.detail || {};
    const urls = detail.picList || e.currentTarget.dataset.urls;
    const cur = urls && urls[detail.picIndex || 0];
    if (urls && urls.length) wx.previewImage({ current: cur, urls: urls });
  },

  onPostDetail(e) {
    this.onToggleComments(e);
  },

  // 帖子引用的那张成绩卡/模板卡被点:跳被引主题。
  // 后端两种引用都回填了 sportTopicId(活动取其所属主题、主题即自身),
  // 拿不到就退回展开评论 —— 跟点卡片其余地方一样,不做死区。
  // 「试玩」:模板卡上的第二个按钮。不接它就是死按钮 —— 卡片照常渲染,点了什么都不发生。
  // ⚠️ 与 onPostReference 分开:一个是「看这条主题」,一个是「现在就去玩」,
  //    落点不同(主题详情 vs 玩法页),合成一个会让其中一个走错地方。
  onPostReferencePlay(e) {
    const index = e.detail && e.detail.index;
    const post = this.data.posts[index];
    if (!post || !post.sportTopicId) return this.onToggleComments(e);
    wx.navigateTo({ url: '/pages/play/index?topicId=' + post.sportTopicId });
  },

  onPostReference(e) {
    const index = e.detail && e.detail.index;
    const post = this.data.posts[index];
    if (!post || !post.sportTopicId) return this.onToggleComments(e);
    wx.navigateTo({ url: '/pages/topic/index/index?id=' + post.sportTopicId });
  },

  onPostUser(e) {
    const memberId = e.detail && e.detail.memberId;
    if (memberId) wx.navigateTo({ url: '/pages/userinfo/userinfo?userId=' + memberId });
  },

  // 评论治理:删除(作者/群主/管理员)+ 举报
  onDeleteComment(e) {
    const dc = this.selectComponent && this.selectComponent('#dcComment');
    if (dc) dc.open('club.comment.delete', { id: e.currentTarget.dataset.id, postId: this.data.openCommentPost });
  },
  _doDeleteComment(id, postId) {
    const that = this, dc = this.selectComponent && this.selectComponent('#dcComment');
    if (dc) dc.busyOn();
    app.sendRequest({
      url: '/api/club/post/comment/delete', method: 'POST', data: jsonBody({ id: id }), header: jsonHeader(),
      success(res) {
        if (res.code == '200') { if (dc) dc.done(); that.loadComments(postId); that.loadPosts(); }
        else if (dc) dc.failed(res.msg || '删除失败');
      },
      fail() { if (dc) dc.failed('网络异常，请重试'); },
    });
  },
  onReportComment(e) {
    const id = e.currentTarget.dataset.id;
    // CU-C-138:与卡面入口同一判据 —— 自己的评论不该给自己开审核单。渲染有延迟时这一行才是真闸,
    // 后端 commentReport 再兜住绕过本页的直调。
    const comment = (this.data.comments || []).find(function (item) { return String(item.id) === String(id); });
    if (comment && String(comment.memberId) === String(this.data.myMemberId)) return;
    modal.show({
      title: '举报评论', content: '确认举报?平台将尽快处理。', confirmText: '举报',
      success(r) {
        if (!r.confirm) return;
        app.sendRequest({ url: '/api/club/post/comment/report', method: 'POST', data: jsonBody({ id: id }), header: jsonHeader(), success(res) { cyToast(res.msg || '已举报'); } });
      }
    });
  },

  // 主理人管理自己发布的主题时进俱乐部活动详情(导演台已并入该页,旧 game-director 退役);
  // 其余身份仍进玩家报名视图。
  goTopic(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const canManage = !!(this.data.club
      && (this.canGovern() || this.data.canManageActivities));
    const url = canManage
      ? '/pages/club/topic-detail/index?topicId=' + id + this.clubIdQuery()
      : '/pages/topic/index/index?id=' + id;
    wx.navigateTo({ url: url });
  },

  // P0(2026-09-05 审核):活动详情页的管理入口(管理场次/团码/导演台)都要 clubId,
  // 之前只带 topicId 进去 ⇒ 九个入口全 notReady。
  clubIdQuery() {
    const club = this.data.club || {};
    const clubId = club.id || this.data.clubId;
    return clubId ? '&clubId=' + encodeURIComponent(clubId) : '';
  },

  goManageTopic(e) {
    const id = positiveId(e && e.currentTarget && e.currentTarget.dataset.id);
    if (!id || !this.data.club) return;
    if (this.canGovern() || this.data.canManageActivities || this.data.canOperateEvents) {
      wx.navigateTo({ url: '/pages/club/topic-detail/index?topicId=' + id + this.clubIdQuery() });
      return;
    }
    if (this.data.hasEventScope && (this._eventTopicIds || {})[String(id)]) {
      this.openActivityTools(e);
    }
  },

  goGameDirector(e) {
    const club = this.data.club;
    const dataset = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const enabled = dataset.gameModuleEnabled === true || dataset.gameModuleEnabled === 'true';
    if (!club || !this.canGovern(club) || !dataset.topicId || !enabled) return;
    const that = this;
    app.sendRequest({
      url: '/api/topic/info-to-user',
      method: 'POST',
      data: { id: dataset.topicId },
      hideLoading: true,
      silentError: true,
      success(res) {
        const activities = listGroupCodeActivities(res && res.data && res.data.activityList);
        if (!(res && (res.code === '200' || res.code === 200)) || !activities.length) {
          cyToast('还没有可管理的活动场次');
          return;
        }
        if (activities.length === 1) {
          that.navigateGameDirectorActivity(activities[0].id, dataset.topicId);
          return;
        }
        that._directorTopicId = dataset.topicId;
        that.setData({ directorActivityPickerShow: true, directorActivityOptions: activities });
      },
      fail() { cyToast('网络异常，请稍后重试'); },
    });
  },

  // 2026-09-03:导演台不再是独立页面,它的十张卡按 Figma 新的全流程稿收编进活动详情页。
  // 三个参数缺一不可:topicId 决定页面主体(H1-H6),activityId 决定进不进导演台状态机,
  // clubId 决定管理身份。topicId 从触发这次查询的那个 dataset 一路传下来 ——
  // /api/topic/info-to-user 本来就是按主题问的,调用点手里一直有它,只是以前没往下传。
  navigateGameDirectorActivity(activityId, topicId) {
    const club = this.data.club;
    if (!club || !this.canGovern(club) || !activityId) return;
    const clubId = club.id || this.data.clubId;
    wx.navigateTo({
      url: '/pages/club/topic-detail/index?topicId=' + encodeURIComponent(topicId || '')
        + '&clubId=' + encodeURIComponent(clubId || '')
        + '&activityId=' + encodeURIComponent(activityId),
    });
  },

  openChoiceSheet(title, hint, items, onPick) {
    this._choiceOnPick = onPick;
    this.setData({
      choiceSheetShow: true,
      choiceSheetTitle: title || '',
      choiceSheetHint: hint || '',
      choiceSheetItems: items || [],
    });
  },

  closeChoiceSheet() {
    this._choiceOnPick = null;
    this.setData({
      choiceSheetShow: false,
      choiceSheetTitle: '',
      choiceSheetHint: '',
      choiceSheetItems: [],
    });
  },

  onChoiceSheetSelect(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset.key;
    const items = this.data.choiceSheetItems || [];
    const selected = items.find(function (item) { return String(item.key) === String(key); });
    const onPick = this._choiceOnPick;
    this.closeChoiceSheet();
    if (selected && typeof onPick === 'function') onPick(selected);
  },

  closeDirectorActivityPicker() {
    this.setData({ directorActivityPickerShow: false, directorActivityOptions: [] });
  },

  onDirectorActivitySelect(e) {
    const activityId = e && e.currentTarget && e.currentTarget.dataset.id;
    const selected = this.data.directorActivityOptions.find(function (item) {
      return String(item.id) === String(activityId);
    });
    if (!selected) return;
    this.closeDirectorActivityPicker();
    this.navigateGameDirectorActivity(selected.id, this._directorTopicId);
  },

  // 团核销码:改弹窗化前是 wx.navigateTo 到独立页面(pages/club/group-code),
  // 现在改用 cy-sheet 内嵌,关闭后直接回到本页,不再是"返回上一级"的页面栈语义。
  // ⚠️ pages/club/group-code 页面路由本身不删——pages/play 那个入口仍在用 navigateTo(批4 范围)。
  showGroupCode(e) {
    const topicId = e.currentTarget.dataset.id;
    const topicName = e.currentTarget.dataset.name || '';
    const club = this.data.club;
    if (!topicId || !club || !(this.canGovern(club) || this.data.canCheckInEvents)) return;
    this.clearGroupCodeTimer();
    this.setData({
      groupCodeVisible: true,
      groupCodeState: 'loading',
      groupCodeTopicId: topicId,
      groupCodeActivityId: null,
      groupCodeTitle: topicName || '本团',
      groupCodeActivityOptions: [],
      groupCodeErrMsg: '',
    });
    this.selectGroupCodeActivity();
  },

  friendlyGroupCodeError(message, fallback) {
    const text = String(message || '');
    if (/登录|认证|401|token/i.test(text)) return '登录已过期，请重新进入';
    if (/网络|timeout|fail|502|503/i.test(text)) return '网络异常，请稍后重试';
    return fallback || '团码暂时没能生成，请稍后重试';
  },

  selectGroupCodeActivity() {
    const that = this;
    this.setData({ groupCodeState: 'loading', groupCodeErrMsg: '' });
    app.sendRequest({
      url: '/api/topic/info-to-user',
      method: 'POST',
      data: { id: this.data.groupCodeTopicId },
      hideLoading: true,
      silentError: true,
      success(res) {
        const activities = listGroupCodeActivities(res && res.data && res.data.activityList);
        if (!(res && (res.code === '200' || res.code === 200)) || !activities.length) {
          that.setData({ groupCodeState: 'error', groupCodeErrMsg: that.friendlyGroupCodeError(res && res.msg, '暂无可出示团码的场次') });
          return;
        }
        if (activities.length === 1) {
          that.setData({ groupCodeActivityId: activities[0].id, groupCodeTitle: activities[0].name }, () => that.issueGroupCode());
          return;
        }
        that.setData({ groupCodeState: 'selecting', groupCodeActivityOptions: activities });
      },
      fail() {
        that.setData({ groupCodeState: 'error', groupCodeErrMsg: '网络异常，请重试' });
      },
      successStatusAbnormal(res) {
        that.setData({ groupCodeState: 'error', groupCodeErrMsg: that.friendlyGroupCodeError(res && res.msg, '场次暂时没能加载，请稍后重试') });
      },
    });
  },

  onGroupCodeSelectActivity(e) {
    const activityId = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name || '本团';
    if (!buildGroupCodeIssuePayload(activityId)) return;
    this.setData({ groupCodeActivityId: activityId, groupCodeTitle: name }, () => this.issueGroupCode());
  },

  issueGroupCode() {
    const that = this;
    const payload = buildGroupCodeIssuePayload(this.data.groupCodeActivityId);
    if (!payload) {
      this.setData({ groupCodeState: 'error', groupCodeErrMsg: '请选择具体场次' });
      return;
    }
    this.clearGroupCodeTimer();
    this.setData({ groupCodeState: 'loading', groupCodeErrMsg: '' });
    app.sendRequest({
      url: '/api/verify/groupcode/issue',
      method: 'POST',
      data: payload,
      hideLoading: true,
      silentError: true,
      success(res) {
        const data = res && res.data;
        if (res && (res.code === '200' || res.code === 200) && data && data.code) {
          // CU-C-78:与团码页同一契约 —— 没有码图不能当成功。cy-qr-voucher 在
          // 「ready 且无 qr 但有 code」时会把签名令牌当文字铺满码区(对短券码是退路,对团码是乱码)。
          if (!data.qrcodeUrl) {
            that.setData({ groupCodeState: 'error', groupCodeQrUrl: '', groupCodeCode: '',
              groupCodeErrMsg: that.friendlyGroupCodeError(res && res.msg, '团码二维码生成失败，请稍后重试') });
            return;
          }
          that.setData({ groupCodeQrUrl: data.qrcodeUrl, groupCodeCode: data.code, groupCodeState: 'ready' });
          that.startGroupCodeCountdown(Math.floor((data.ttlMs || 300000) / 1000));
          return;
        }
        that.setData({ groupCodeState: 'error', groupCodeErrMsg: that.friendlyGroupCodeError(res && res.msg, '团码暂时没能生成，请稍后重试') });
      },
      fail() {
        that.setData({ groupCodeState: 'error', groupCodeErrMsg: '网络异常，请重试' });
      },
      successStatusAbnormal(res) {
        that.setData({ groupCodeState: 'error', groupCodeErrMsg: that.friendlyGroupCodeError(res && res.msg, '团码暂时没能生成，请稍后重试') });
      },
    });
  },

  startGroupCodeCountdown(seconds) {
    const that = this;
    this.setData({ groupCodeCountdown: seconds });
    this._groupCodeTimer = setInterval(function () {
      const remaining = that.data.groupCodeCountdown - 1;
      if (remaining <= 0) {
        that.issueGroupCode();
        return;
      }
      that.setData({ groupCodeCountdown: remaining });
    }, 1000);
  },

  clearGroupCodeTimer() {
    if (this._groupCodeTimer) {
      clearInterval(this._groupCodeTimer);
      this._groupCodeTimer = null;
    }
  },

  onGroupCodeRetry() {
    if (buildGroupCodeIssuePayload(this.data.groupCodeActivityId)) this.issueGroupCode();
    else this.selectGroupCodeActivity();
  },

  onCloseGroupCode() {
    this.clearGroupCodeTimer();
    this.setData({ groupCodeVisible: false });
  },

  // 动态点赞/取消
  onLikePost(e) {
    const id = (e.detail && e.detail.postId) || e.currentTarget.dataset.id;
    const that = this;
    app.sendRequest({
      url: '/api/club/post/like', method: 'POST', data: jsonBody({ postId: id }), header: jsonHeader(),
      success(res) { if (res.code == '200') that.loadPosts(); },
      fail() { cyToast('操作失败'); },
    });
  },

  // 展开/收起评论区
  onToggleComments(e) {
    const id = (e.detail && e.detail.postId) || e.currentTarget.dataset.id;
    if (this.data.openCommentPost === id) { this.setData({ openCommentPost: null, comments: [] }); return; }
    this.setData({ openCommentPost: id, comments: [], commentText: '' });
    this.loadComments(id);
  },

  loadComments(postId) {
    const that = this;
    app.sendRequest({
      hideLoading: true, url: '/api/club/post/comment/list', method: 'POST', data: jsonBody({ postId: postId }), header: jsonHeader(),
      success(res) {
        const rows = (res.code == '200' && res.data) || [];
        that.setData({ comments: rows.map(function (c) { return Object.assign({}, c, { timeText: c.createTime ? String(c.createTime).slice(0, 16).replace('T', ' ') : '' }); }) });
      },
    });
  },

  onCommentInput(e) { this.setData({ commentText: e.detail.value }); },

  onCommentSubmit() {
    const postId = this.data.openCommentPost;
    const text = (this.data.commentText || '').trim();
    if (!postId) return;
    if (!text) { cyToast('说点什么'); return; }
    if (this.data.commenting) return;
    this.setData({ commenting: true });
    const that = this;
    app.sendRequest({
      url: '/api/club/post/comment/create', method: 'POST',
      data: JSON.stringify({ postId: postId, content: text }),
      header: { 'Content-Type': 'application/json', 'Authorization': app.getAuthorization() },
      success(res) {
        that.setData({ commenting: false });
        if (res.code == '200') { that.setData({ commentText: '' }); that.loadComments(postId); that.loadPosts(); }
        else cyToast((res && res.msg) || '评论失败');
      },
      fail() { that.setData({ commenting: false }); cyToast('网络异常，请重试'); },
    });
  },

  // 主理人移除成员
  removeMember(e) {
    if (!this.data.club || !(this.canGovern() || this.data.canManageMembers)) return;
    const dc = this.selectComponent && this.selectComponent('#dcMember');
    if (dc) dc.open('club.member.remove', {
      name: e.currentTarget.dataset.memberName || '这位成员',
      memberId: e.currentTarget.dataset.memberId,
    });
  },
  _doRemoveMember(memberId) {
    const that = this, dc = this.selectComponent && this.selectComponent('#dcMember');
    if (dc) dc.busyOn();
    app.sendRequest({
      url: '/api/club/remove-member', method: 'POST', data: jsonBody({ clubId: that.data.clubId, memberId: memberId }), header: jsonHeader(),
      success(res) {
        if (res.code == '200') { if (dc) dc.done(); that.loadMembers(); that.loadDetail(); }
        else if (dc) dc.failed((res && res.msg) || '移除失败');
      },
      fail() { if (dc) dc.failed('网络异常，请重试'); },
    });
  },

  // 三段式第二段:一个危险动作一个确认组件实例、一个确认回调。
  // 不做「一个 onDangerConfirm 按 key 派发」—— 那会让一个控件同时写四个接口,
  // 动作台账(scripts/uiaudit)没法把控件和它真正写的那个接口对上。
  onConfirmDeletePost(e) { this._doDeletePost(e.detail.params.id); },
  onConfirmDeleteComment(e) { this._doDeleteComment(e.detail.params.id, e.detail.params.postId); },
  onConfirmQuit() { this._doQuit(); },
  onConfirmRemoveMember(e) { this._doRemoveMember(e.detail.params.memberId); },

  /** 退出俱乐部的更轻替代:留在俱乐部,只关掉群消息提醒。 */
  onQuitAlt() {
    cyToast('在群聊右上角可以关掉消息提醒', { duration: 2600 });
  },

  goBack() { wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/talent/list/index' }); } }); },

  defaultTabForClub(club) {
    // 双身份时以当前俱乐部内的 owner/member 关系优先；只有纯访客才默认概览。
    return club && (club.isOwner || club.isJoined) ? 'posts' : 'overview';
  },

  // 2026-08-26:管理员(role=1)也拿到管理 tab。判据用 detail 已下发的 viewerIsAdmin,
  // 不额外请求;真闸在后端 canGovernClub,前端只是别把入口藏起来。
  canGovern(club) {
    const c = club || this.data.club;
    return !!(c && (c.isOwner || c.viewerIsAdmin));
  },

  tabsForClub(club, canUseManageTab) {
    const accessAllowsManage = canUseManageTab === undefined
      ? this.data.canUseManageTab : !!canUseManageTab;
    return this.canGovern(club) || (club && accessAllowsManage)
      ? PUBLIC_TABS.concat([{ key: 'manage', label: '管理' }])
      : PUBLIC_TABS;
  },

  switchTab(e) {
    const tab = (e.detail && e.detail.key) || (e.currentTarget && e.currentTarget.dataset.tab);
    if (!tab) return;
    if (tab === 'manage' && !(this.canGovern() || this.data.canUseManageTab)) return;
    if (this.data.activeTab === tab) return;
    this.setData({ activeTab: tab, openCommentPost: null });
  },

  // 3-5 票源归因的**唯一产出口**:主理人在「自由探索期次」里逐期分享带票链接。
  // 归因参数只在「本俱乐部真的是这一期的主体」时才拼(clubId 取本页 clubId,不接受外部传入),
  // 玩家侧的 app.onLaunch/onShow 捕获,建单时透传,支付成功由后端冻结闸做最终裁定。
  onShareAppMessage(event) {
    const club = this.data.club;
    const cid = this.data.clubId;
    const postId = event && event.target && event.target.dataset
      ? event.target.dataset.postId : null;
    if (postId && cid) {
      return {
        title: (club && club.name ? club.name + ' · ' : '') + '俱乐部帖文',
        path: '/pages/club/detail/index?id=' + cid + '&postId=' + postId,
      };
    }
    const topicId = event && event.target && event.target.dataset
      ? event.target.dataset.topicId : null;
    if (topicId && cid) {
      const edition = (this.data.shareEditions || []).find(function (item) {
        return String(item.topicId) === String(topicId)
          && String(item.executingClubId) === String(cid);
      });
      if (edition) {
        /* CU-C-38:带票分享以前只有标题,卡片图是空白;主题详情页那条路又能出图 —— 同一个主题
           两条分享路长得不一样。标题与封面口径统一走 utils/topic-share,这一屏的封面来自
           /api/club-compensation/editions 的 topicCover(主题长图),取不到就不传 imageUrl。 */
        return buildTopicShare({
          topicId: topicId,
          name: edition.topicName,
          fallbackTitle: (club && club.name) || '城瘾',
          cover: resolveTopicCover({ imgUrl: edition.topicCover }, function (path) { return app.getImgUrl(path); }),
          path: ticketSource.buildSharePath('/pages/topic/index/index', {
            topicId: topicId,
            clubId: cid,
            clubCode: 'club-' + cid + '-t' + topicId,
          }),
        });
      }
    }
    return {
      title: (club && club.name) || '城瘾俱乐部',
      path: cid ? ('/pages/club/detail/index?id=' + cid) : '/pages/talent/list/index',
    };
  },

  // 分享钮在整行 bindtap 之上,catchtap 只为阻断冒泡(否则点分享会顺带跳进管理页)。
  stopShareBubble() {},

  // 齿轮改为打开「俱乐部设置」弹窗:编辑资料 / 入会申请 / 成员管理 / 报名名册 / 项目工具 / 解散。
  // 治理与低频工具从管理 tab 整体搬到这里,管理 tab 只留经营(2026-08-26)。
  onSettings() {
    if (!(this.canGovern() || this.data.canUseManageTab)) return;
    this.setData({ settingsShow: true, settingsPanel: '' });
    this.loadSettingsCounts();
  },

  // 弹窗右侧那两个数。都走已有接口,只在有权限看那一行的人身上发请求;
  // 同一次进页面只取一次(_settingsCountsFor 记的是取过的 clubId)。
  loadSettingsCounts() {
    const that = this;
    const club = this.data.club || {};
    const clubId = club.id || this.data.clubId;
    if (!clubId || String(this._settingsCountsFor || '') === String(clubId)) return;
    this._settingsCountsFor = clubId;
    if (club.isOwner || club.viewerIsAdmin) {
      app.sendRequest({
        hideLoading: true, silentError: true,
        url: '/api/club/crm/customers/count', method: 'POST',
        data: jsonBody({ clubId: clubId }), header: jsonHeader(),
        success(res) {
          if (String(clubId) !== String(that.data.club && that.data.club.id || that.data.clubId)) return;
          const total = isSuccess(res) && isRecord(res.data) ? Number(res.data.total) : NaN;
          if (Number.isFinite(total) && total > 0) that.setData({ customerCountText: total + ' 人' });
        },
        // 读不到就在同一个位置说读不到。留空会被读成「这个俱乐部一个客户都没有」——
        // 那是另一件事,不能拿加载失败去冒充。
        fail() { that.setData({ customerCountText: '暂时读不到' }); },
      });
    }
    if (club.isOwner) {
      app.sendRequest({
        hideLoading: true, silentError: true,
        url: '/api/club/settlement/summary', method: 'POST',
        data: jsonBody({ clubId: clubId }), header: jsonHeader(),
        success(res) {
          if (String(clubId) !== String(that.data.club && that.data.club.id || that.data.clubId)) return;
          // 金额只透传服务端算好的字符串,前端一分钱都不算。
          const text = isSuccess(res) && isRecord(res.data) ? res.data.settledAmountText : null;
          if (typeof text === 'string' && text) that.setData({ settledAmountText: text });
        },
        // 钱这一行尤其不能留空:空白会被读成「这个月一分没有」。
        fail() { that.setData({ settledAmountText: '暂时读不到' }); },
      });
    }
  },
  closeSettings() { this.setData({ settingsShow: false, settingsPanel: '' }); },

  /* 稿 M 268:223「开放设置」的两个开关。
     写完回读服务端给的值再渲染 —— 界面上那个「已开启/已关闭」要么是库里的事实,
     要么是一条明说没保存成的错误,不作第三种。
     ⚠️ 开关只是入口:真闸在后端(发帖在 /api/club/post/create,承接在商家池那条查询上)。
     ⚠️ 两个 handler 是照抄的,别合并成一张 {url, field} 表 —— 那样 url 和 setData 的键
        都变成运行时变量,U1(接口路径必须是可枚举字面量)与 U4(动态 setData 必须登记)
        双双判红。全仓能 grep 出「谁调了这个接口」比省这二十行值钱。 */
  togglePublicVisible() {
    const that = this;
    const club = this.data.club;
    if (!club || !club.isOwner || this.data.openSettingSaving) return;
    const next = Number(club.publicVisible) === 0 ? 1 : 0;
    this.setData({ openSettingSaving: 'publicVisible', openSettingErrorKey: '', openSettingErrorText: '' });
    app.sendRequest({
      hideLoading: true, silentError: true,
      url: '/api/club/open-settings/public-visible', method: 'POST',
      data: jsonBody({ id: club.id || this.data.clubId, publicVisible: next }), header: jsonHeader(),
      success(res) {
        const saved = isSuccess(res) && isRecord(res.data) ? Number(res.data.publicVisible) : NaN;
        if (!Number.isFinite(saved)) {
          that.setData({ openSettingSaving: '', openSettingErrorKey: 'publicVisible',
            openSettingErrorText: bizFailureMessage(res, '没有确认这个开关是否保存，请重试') });
          return;
        }
        that.setData({ openSettingSaving: '', openSettingErrorKey: '', openSettingErrorText: '',
          'club.publicVisible': saved });
      },
      fail() {
        that.setData({ openSettingSaving: '', openSettingErrorKey: 'publicVisible',
          openSettingErrorText: '网络异常，开关没有保存' });
      },
    });
  },

  toggleMemberPost() {
    const that = this;
    const club = this.data.club;
    if (!club || !club.isOwner || this.data.openSettingSaving) return;
    const next = Number(club.memberPostAllowed) === 0 ? 1 : 0;
    this.setData({ openSettingSaving: 'memberPost', openSettingErrorKey: '', openSettingErrorText: '' });
    app.sendRequest({
      hideLoading: true, silentError: true,
      url: '/api/club/open-settings/member-post', method: 'POST',
      data: jsonBody({ id: club.id || this.data.clubId, memberPostAllowed: next }), header: jsonHeader(),
      success(res) {
        const saved = isSuccess(res) && isRecord(res.data) ? Number(res.data.memberPostAllowed) : NaN;
        if (!Number.isFinite(saved)) {
          that.setData({ openSettingSaving: '', openSettingErrorKey: 'memberPost',
            openSettingErrorText: bizFailureMessage(res, '没有确认这个开关是否保存，请重试') });
          return;
        }
        that.setData({ openSettingSaving: '', openSettingErrorKey: '', openSettingErrorText: '',
          'club.memberPostAllowed': saved });
      },
      fail() {
        that.setData({ openSettingSaving: '', openSettingErrorKey: 'memberPost',
          openSettingErrorText: '网络异常，开关没有保存' });
      },
    });
  },

  toggleMerchantCoop() {
    const that = this;
    const club = this.data.club;
    if (!club || !club.isOwner || this.data.openSettingSaving) return;
    const next = Number(club.merchantUndertakeOpen) === 0 ? 1 : 0;
    this.setData({ openSettingSaving: 'merchantCoop', openSettingErrorKey: '', openSettingErrorText: '' });
    app.sendRequest({
      hideLoading: true, silentError: true,
      url: '/api/club/open-settings/merchant-coop', method: 'POST',
      data: jsonBody({ id: club.id || this.data.clubId, merchantUndertakeOpen: next }), header: jsonHeader(),
      success(res) {
        const saved = isSuccess(res) && isRecord(res.data) ? Number(res.data.merchantUndertakeOpen) : NaN;
        if (!Number.isFinite(saved)) {
          that.setData({ openSettingSaving: '', openSettingErrorKey: 'merchantCoop',
            openSettingErrorText: bizFailureMessage(res, '没有确认这个开关是否保存，请重试') });
          return;
        }
        that.setData({ openSettingSaving: '', openSettingErrorKey: '', openSettingErrorText: '',
          'club.merchantUndertakeOpen': saved });
      },
      fail() {
        that.setData({ openSettingSaving: '', openSettingErrorKey: 'merchantCoop',
          openSettingErrorText: '网络异常，开关没有保存' });
      },
    });
  },
  toggleSettingsPanel(e) {
    const key = e.currentTarget.dataset.key || '';
    this.setData({ settingsPanel: this.data.settingsPanel === key ? '' : key });
  },
  // 编辑资料仍走原来的半屏 scene,只是入口从齿轮直达改成设置弹窗里的一行
  openClubEdit() {
    if (!this.canGovern()) return;
    const scene = getScene('club-edit', { clubId: this.data.clubId });
    if (!scene) return;
    this.setData({ settingsShow: false, settingsPanel: '', sceneStack: [scene], sceneCurrent: scene, sceneDirty: false, sceneConfirm: false });
  },

  toggleManageSection(e) {
    const key = e.currentTarget.dataset.key || '';
    const next = this.data.openManageSection === key ? '' : key;
    this.setData({ openManageSection: next });
    // 折叠段展开时才取数;这一段默认收起,进页就拉是白拉一次
    if (next === 'coop-pool') this.loadCoopPool(this.data.coopPoolState === 'ready');
  },

  /* Figma「管理员 管理页面」B2 可对接的活动。
   * 数据就是合作池(/api/coop/pool/list)—— 商家把主题「开放给俱乐部承接」后落在这里。
   * 2026-09-15 合作池 tab 收编进收发件箱后,这里是俱乐部**发现并申请**带队的唯一入口:
   *   申请就地提交(applyCoopPool,从 coop/list 搬来,只此一份);申请记录与撤回在协作邀请「我发出的」。 */
  // silent:已有列表时后台刷新,不把屏上的卡换成骨架。
  loadCoopPool(silent) {
    if (!this.data.club || !this.data.club.isOwner) {
      this.setData({ coopPoolState: 'permission', coopPoolError: '只有主理人能看可对接的活动' });
      return;
    }
    if (!silent) this.setData({ coopPoolState: 'loading', coopPoolError: '' });
    const that = this;
    app.sendRequest({
      hideLoading: true, silentError: true,
      url: '/api/coop/pool/list', method: 'POST', data: jsonBody({}), header: jsonHeader(),
      success(res) {
        const d = res && res.data;
        // 形状不对就当没拿到,不把坏响应渲染成空列表 —— 空列表会被读成「没有可对接的活动」
        if (String(res && res.code) !== '200' || !d || typeof d.hasClub !== 'boolean' || !isPoolList(d.rows)) {
          that.setData({ coopPool: [], coopPoolState: 'error', coopPoolError: bizFailureMessage(res, '合作池没加载出来') });
          return;
        }
        if (d.hasClub === false) {
          that.setData({ coopPool: [], coopPoolState: 'permission', coopPoolError: '成为俱乐部主理人后才能申请承接' });
          return;
        }
        that.setData({ coopPool: decoratePool(d.rows), coopPoolState: 'ready', coopPoolError: '' });
      },
      fail() { that.setData({ coopPool: [], coopPoolState: 'error', coopPoolError: '网络不稳定，请检查连接后重试' }); },
    });
  },
  retryCoopPool() { this.setData({ coopPoolState: 'idle' }); this.loadCoopPool(); },
  // 申请带队(留言可选)。申请只表意向,商家会回一张带条款的正式邀约,接受后才成合作(§3.6)。
  applyCoopPool(e) {
    const topicId = e.currentTarget.dataset.topicid;
    const name = e.currentTarget.dataset.name || '该主题';
    if (!topicId || this._coopApplyPending) return;
    this._coopApplyPending = true;
    this.setData({ coopApplyPendingId: String(topicId) });
    const that = this;
    const done = function (tip) {
      that._coopApplyPending = false;
      that.setData({ coopApplyPendingId: '' });
      if (tip) cyToast(tip);
    };
    // 授权:商家婉拒/回邀约走「合作状态」订阅通知,须在点击手势内请求
    require('../../../utils/subscribe.js').request(['coopStatus']);
    modal.show({
      title: '申请带队「' + name + '」',
      editable: true,
      placeholderText: '给商家带句话(可选):带队经验、可带人数…',
      confirmText: '提交申请',
      success(r) {
        if (!r.confirm) { done(''); return; }
        app.sendRequest({
          url: '/api/coop/pool/apply', method: 'POST',
          data: jsonBody({ topicId: topicId, message: r.content || '' }), header: jsonHeader(),
          success(res) {
            if (String(res && res.code) === '200') {
              done('已申请，可在协作邀请「我发出的」查看');
              that.loadCoopPool();   // 回读:该卡变「已申请」
            } else {
              done((res && res.msg) || '申请失败');
            }
          },
          // 结果未知:回读池子状态,不让人对着旧的「可申请」再点一次
          fail() { done('申请结果待确认，已刷新'); that.loadCoopPool(); },
        });
      },
      fail() { done('操作确认没有打开，请重试'); },
    });
  },
  goCoopSent() { wx.navigateTo({ url: '/pages/coop/list/index?tab=sent' }); },
});
