// 首页「继续探索」数据归一。报名记录是事实源，入口仍回票夹，避免绕过既有报名/游玩权限校验。
const { formatElapsed } = require('../play-ui-contract.js');

function buildContinueExplore(registrations) {
  const registration = Array.isArray(registrations) ? registrations[0] : null;
  if (!registration || !registration.id) return null;

  const isTopic = Number(registration.ownerType) === 1;
  const owner = isTopic ? registration.cmsTopic : registration.cmsActivity;
  if (!owner) return null;

  return {
    kicker: '继续探索',
    registrationId: registration.id,
    ownerType: isTopic ? 1 : 2,
    title: owner.name || '继续探索',
    sub: owner.addressName || (isTopic ? '你的主题还在等待探索' : '你的活动还在等待参加'),
    cover: owner.imgUrl || String(owner.imgArr || '').split(/[,;]/).filter(Boolean)[0] || '',
    focusPath: '/subpackageMember/signup/index?focusId=' + registration.id + '&stype=' + (isTopic ? 0 : 2),
  };
}

// 第二轮拍板 22:服务端记着的进行中游戏会话(/api/play/run-session/list,已按报名/通行证/活动结束日过滤)。
// 直达游玩页;能不能继续仍由游玩页 /api/play/nodes 的权威态把门,这里不绕过。
function buildContinueGame(sessions) {
  const session = Array.isArray(sessions) ? sessions[0] : null;
  if (!session) return null;
  const activityId = /^[1-9]\d{0,18}$/.test(String(session.activityId)) ? String(session.activityId) : '';
  const topicId = /^[1-9]\d{0,18}$/.test(String(session.topicId)) ? String(session.topicId) : '';
  if (!activityId && !topicId) return null;
  const elapsed = Number(session.elapsedSeconds);
  return {
    kicker: '继续游戏',
    title: session.title || '继续游戏',
    sub: Number.isSafeInteger(elapsed) && elapsed >= 0 ? '已暂停 · 已用时 ' + formatElapsed(elapsed) : '已暂停',
    cover: session.cover || '',
    focusPath: '/pages/play/index?' + (activityId ? 'activityId=' + activityId : 'topicId=' + topicId),
  };
}

module.exports = { buildContinueExplore: buildContinueExplore, buildContinueGame: buildContinueGame };
