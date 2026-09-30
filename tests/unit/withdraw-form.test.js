// 提现表单单一真源契约(2026-08-25)
//
// 背景:/api/withdrawal/create 有三个前端写入口,原先第三个(scene-route-content 的
// member-withdraw 场景)只校验「金额 > 0」,空姓名/空卡号/非法手机号/**超过余额**都能提交。
// 本测试锁住规则本体;三个入口都必须调用它,由 funds-entry-withdrawal 契约测试保证。
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  checkWithdrawForm,
  canSubmitWithdraw,
  ensureWithdrawRequestIdentity,
  CONSENT_DOC_TYPE,
  CONSENT_TEXT,
} = require('../../utils/withdraw-form.js');

const VALID = {
  amount: '10.00',
  balance: 100,
  realname: '测试用户',
  bankName: '测试银行',
  bankAccount: '6222020000000000',
  mobilephone: '13800138000',
  consented: true,
};
const withPatch = (patch) => Object.assign({}, VALID, patch);

test('完整合法表单通过', () => {
  assert.equal(checkWithdrawForm(VALID).ok, true);
  assert.equal(canSubmitWithdraw(VALID), true);
});

const REJECTS = [
  ['金额为 0', { amount: '0' }],
  ['金额为空', { amount: '' }],
  ['金额非数字', { amount: 'abc' }],
  ['★金额超过余额', { amount: '100.01' }],
  ['★余额未知时不放行', { balance: undefined }],
  ['余额加载失败', { balanceReady: false }],
  ['姓名只有空格', { realname: '  ' }],
  ['银行名称为空', { bankName: '' }],
  ['银行账号为空', { bankAccount: '  ' }],
  ['手机号为空', { mobilephone: '' }],
  ['手机号格式非法', { mobilephone: '123456' }],
  ['★未勾选单独同意', { consented: false }],
];

REJECTS.forEach(([name, patch]) => {
  test(`必须拦下:${name}`, () => {
    const result = checkWithdrawForm(withPatch(patch));
    assert.equal(result.ok, false, name + ' 应当被拦下');
    assert.ok(result.message, '被拦下时必须给出可展示的原因,不能静默返回 false');
    assert.equal(canSubmitWithdraw(withPatch(patch)), false, '按钮态必须与校验同源');
  });
});

test('单独同意的文案必须说清「哪些信息、给谁、干什么用」', () => {
  assert.equal(CONSENT_DOC_TYPE, 'bank_account_collection');
  assert.match(CONSENT_TEXT, /银行账号/, '同意文案必须点名银行账号这类敏感个人信息');
  assert.match(CONSENT_TEXT, /提现/, '同意文案必须写明用途');
  assert.doesNotMatch(CONSENT_TEXT, /^我已阅读并同意$/, '不得退化成通用打包条款');
});

test('同一提现意图重试复用 requestId，字段变化后生成新键', () => {
  const first = ensureWithdrawRequestIdentity(null, VALID, 1_700_000_000_000, 0.25);
  const retry = ensureWithdrawRequestIdentity(first, Object.assign({}, VALID), 1_700_000_000_100, 0.5);
  const changed = ensureWithdrawRequestIdentity(first, withPatch({ amount: '20.00' }), 1_700_000_000_200, 0.75);

  assert.match(first.requestId, /^wd-[0-9a-z]+-[0-9a-z]+$/);
  assert.ok(first.requestId.length <= 64);
  assert.equal(retry.requestId, first.requestId, '网络失败后的同参数重试必须复用业务键');
  assert.notEqual(changed.requestId, first.requestId, '金额或收款信息变化后必须视为新意图');
});

test('negative control:去掉余额上限这条,超额用例必须由绿转红', () => {
  // 直接在规则副本上抹掉该分支,证明上面那条断言不是恒真的。
  const stripped = (form) => {
    const f = Object.assign({}, form);
    f.balance = Number.MAX_SAFE_INTEGER; // 等价于「不设上限」(须是有限值,否则会被余额未知那条先拦掉)
    return checkWithdrawForm(f);
  };
  assert.equal(checkWithdrawForm(withPatch({ amount: '100.01' })).ok, false);
  assert.equal(stripped(withPatch({ amount: '100.01' })).ok, true, '负控没生效说明该用例本来就不靠余额上限判红');
});
