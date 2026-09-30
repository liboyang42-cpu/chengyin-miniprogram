// 提现表单的校验与单独同意 —— 三个写入口的单一真源(2026-08-25)
//
// 为什么必须收口:/api/withdrawal/create 全仓有【三个】前端写入口
//   ① subpackageMember/tixian/tixian.js          独立提现页
//   ② subpackageA/pages/assetcenter/earnings     我的资产内的提现 sheet
//   ③ components/cy/scene-route-content          member-withdraw 场景表单
//      (由 cy-profile「我的」页、cy-scene-deep-link、pages/shezhi/shezhi 三处的
//       submitSceneForm 触发)
// ①② 校验六条,③ 只校验「金额 > 0」—— 空姓名 / 空卡号 / 非法手机号 / **金额超过余额**
// 都能提交上去。已有的 funds-entry-withdrawal 契约测试只覆盖 ①②,③ 因此静默漂移。
// 校验放在各调用方各写一遍,就一定会有第三处漏掉;所以规则只留这一份。
//
// 单独同意:银行账号是个人信息保护法第 28 条明列的【敏感个人信息】,第 29 条要求取得
// 单独同意 —— 不得默认勾选、不得与通用条款打包、不得靠「点提交即视为同意」推定。
// 参照 pages/activity/baoming 对第 23 条的既有做法(独立可勾控件 + 落库存证后才放行)。
const { isValidMobile, deriveCanSubmit } = require('./form-state.js');

const CONSENT_DOC_TYPE = 'bank_account_collection';
const CONSENT_SCENE = 'withdrawal';
// 必须写清「哪些信息、给谁、干什么用」,不能只写"我已阅读并同意"。
const CONSENT_TEXT = '同意向城瘾提供持卡人姓名、银行账号与预留手机号，仅用于本次提现打款';

function text(value) {
  return String(value == null ? '' : value).trim();
}

/**
 * 六条字段校验 + 单独同意闸。返回第一条不满足的原因(与原页面逐条 toast 的顺序一致)。
 * @param {object} form { amount, balance, realname, bankName, bankAccount, mobilephone,
 *                        consented, balanceReady }
 * @returns {{ok: boolean, message: string}}
 */
function checkWithdrawForm(form) {
  const f = form || {};
  // balanceReady 缺省视为已就绪:③ 号入口拿不到独立的加载态,不能因此恒判不通过。
  if (f.balanceReady === false) return { ok: false, message: '余额没取到，请先重试' };
  const amount = Number(f.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, message: '请输入有效提现金额' };
  const balance = Number(f.balance);
  // 余额未知(NaN)时不放行:显示了「可用余额」却不拦超额,是本次审出的第三入口原缺陷。
  if (!Number.isFinite(balance)) return { ok: false, message: '余额没取到，请先重试' };
  if (amount > balance) return { ok: false, message: '提现金额不能超过可提现余额' };
  if (!text(f.realname)) return { ok: false, message: '请输入持卡人姓名' };
  if (!text(f.bankName)) return { ok: false, message: '请输入银行名称' };
  if (!text(f.bankAccount)) return { ok: false, message: '请输入银行账号' };
  if (!text(f.mobilephone)) return { ok: false, message: '请输入手机号码' };
  if (!isValidMobile(text(f.mobilephone))) return { ok: false, message: '请输入正确的手机号码' };
  if (!f.consented) return { ok: false, message: '请先同意提供银行卡信息' };
  return { ok: true, message: '' };
}

/** 按钮可用态。与 checkWithdrawForm 同源,避免「按钮亮着但提交被拦」。 */
function canSubmitWithdraw(form) {
  return deriveCanSubmit([checkWithdrawForm(form).ok]);
}

function withdrawFingerprint(form) {
  const f = form || {};
  const amount = Number(f.withdrawalAmount !== undefined ? f.withdrawalAmount : f.amount);
  return JSON.stringify([
    text(f.realname),
    text(f.bankName),
    text(f.bankAccount),
    text(f.mobilephone),
    Number.isFinite(amount) ? amount.toFixed(2) : '',
  ]);
}

/** 同一参数的失败重试复用业务键；参数变化代表新的提现意图。 */
function ensureWithdrawRequestIdentity(previous, form, now = Date.now(), random = Math.random()) {
  const fingerprint = withdrawFingerprint(form);
  if (previous && previous.fingerprint === fingerprint && previous.requestId) return previous;
  const stamp = Math.max(0, Math.floor(Number(now) || 0)).toString(36);
  const entropy = Math.floor(Math.max(0, Math.min(0.999999999, Number(random) || 0)) * 0xFFFFFFFF)
    .toString(36);
  return { fingerprint, requestId: `wd-${stamp}-${entropy}` };
}

module.exports = {
  CONSENT_DOC_TYPE,
  CONSENT_SCENE,
  CONSENT_TEXT,
  checkWithdrawForm,
  canSubmitWithdraw,
  ensureWithdrawRequestIdentity,
};
