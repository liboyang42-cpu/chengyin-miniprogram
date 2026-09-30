// 发布者实名(RUN-52 改判后口径)—— 三个入口共用的采集与状态真源(2026-09-19)
//
// 为什么必须收口:要登记实名的是「要收钱的发布者」,而这类人有三条进场路:
//   ① pages/club/apply          主理人申请第 4 步
//   ② pages/merchant/apply      商家入驻第 4 步
//   ③ pages/publish/fabu        玩家发布前的「发布确认」弹层
// 外加 components/cy/scene-route-content 里 ①② 的场景化副本。
// 校验规则、同意文案、状态查询、提交时序若在每处各写一遍,一定会有一处漏
// ——提现三入口就是这么被审出「第三处只校验金额>0」的(见 utils/withdraw-form.js 头注)。
//
// 三条口径写在这里,页面不得各表一套:
//   · 只回显状态:接口只回答 registered 真/假,姓名与身份证号填过之后页面上不再出现其值;
//   · 用词不许说「认证」:平台没有三要素通道,号码自洽不等于确有其人,统一说「已登记」;
//   · 改绑走人工:已登记的人不再给他填字段的入口,要变更只能联系客服。
const { isValidIdCard, normalizeIdCard } = require('./form-state.js');

// 两个接口路径写成调用点字面量,不提常量:UI-GATE-0 的 U1 只认可枚举字面量,
// 提成常量就变成「运行时变量路径」,后端 Mapping 对不上就永远核不出来。
const SOURCE_CLUB_APPLY = 'club_apply';
const SOURCE_MERCHANT_APPLY = 'merchant_apply';
const SOURCE_TOPIC_PUBLISH = 'topic_publish';

// 必须写清「哪些信息、给谁、干什么用」(个保法 §29 单独同意),不能只写"我已阅读并同意"。
const CONSENT_TEXT = '同意向城瘾提供真实姓名与身份证号，仅用于发布人身份核验，不对外展示';
const ALREADY_REGISTERED_HINT = '已登记。如需变更实名信息，请联系平台客服。';

function text(value) {
  return String(value == null ? '' : value).trim();
}

/**
 * 返回第一条不满足的原因;全通过返回 { ok: true }。
 * 与后端 MemberIdentityService.register 的校验顺序一致:姓名 → 证件 → 单独同意。
 */
function checkIdentityForm(form) {
  const f = form || {};
  const name = text(f.realName);
  if (!name) return { ok: false, message: '请填写真实姓名' };
  if (name.length < 2 || name.length > 20) return { ok: false, message: '请填写真实姓名(2-20 个字)' };
  if (/[0-9]/.test(name)) return { ok: false, message: '姓名里不应包含数字' };
  if (!isValidIdCard(f.idCard)) return { ok: false, message: '身份证号格式不正确，请核对后重填' };
  if (!f.consented) return { ok: false, message: '请先同意提供真实姓名与身份证号' };
  return { ok: true, message: '' };
}

/**
 * 按钮亮不亮的轻量判定:已登记直接过;没登记则三格都要满足。
 * 规则仍只有 checkIdentityForm 一份 —— 这里只是不要那段文案,不是另写一套判断。
 */
function identitySatisfied(form) {
  const f = form || {};
  if (f.identityRegistered) return true;
  return checkIdentityForm(f).ok;
}

/** 状态查询:失败时按「未登记」处理 —— 宁可多问一次,也不要把没登记的人放过闸。 */
function loadIdentityStatus(onDone) {
  // 纯 Node 契约测试里没有 wx 运行时:getApp 缺席按「未登记」走,与 fail 分支同一语义
  if (typeof getApp !== 'function') { onDone(false); return; }
  const app = getApp();
  app.sendRequest({
    url: '/api/publisher/identity/status',
    method: 'POST',
    data: JSON.stringify({}),
    header: { 'Content-Type': 'application/json' },
    success(res) { onDone(!!(res && res.code == 200 && res.data && res.data.registered)); },
    fail() { onDone(false); },
  });
}

/**
 * 提交登记。onDone({ ok, message, network }) —— message 用接口原文,它是服务端唯一说得清
 * 「这张证件已绑在别的账号上」这类事实的地方;network 供调用方选报错条样式(重试 vs 核对)。
 */
function registerIdentity(form, onDone) {
  const app = getApp();
  const check = checkIdentityForm(form);
  if (!check.ok) { onDone({ ok: false, message: check.message, network: false }); return; }
  app.sendRequest({
    url: '/api/publisher/identity',
    method: 'POST',
    data: JSON.stringify({
      realName: text(form.realName),
      idCard: normalizeIdCard(form.idCard),
      consent: true,
      source: form.source,
    }),
    header: { 'Content-Type': 'application/json' },
    success(res) {
      onDone({
        ok: !!(res && res.code == 200),
        message: (res && res.msg) || '实名信息登记没有完成，请稍后重试',
        network: false,
      });
    },
    fail() { onDone({ ok: false, message: '网络异常，实名信息没有提交成功', network: true }); },
  });
}

module.exports = {
  SOURCE_CLUB_APPLY,
  SOURCE_MERCHANT_APPLY,
  SOURCE_TOPIC_PUBLISH,
  CONSENT_TEXT,
  ALREADY_REGISTERED_HINT,
  checkIdentityForm,
  identitySatisfied,
  loadIdentityStatus,
  registerIdentity,
};
