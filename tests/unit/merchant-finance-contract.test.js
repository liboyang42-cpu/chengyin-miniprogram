const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const ledgerJs = () => read('pages/merchant/ledger/index.js');
const ledgerWxml = () => read('pages/merchant/ledger/index.wxml');

function assertSettlementSurface(js, wxml) {
  assert.match(js, /\/api\/merchant\/finance\/overview/, '结算必须只读资金域 overview');
  assert.match(js, /\/api\/merchant\/finance\/settlement-entries/, '收入明细必须读已成立账务');
  assert.match(js, /\/api\/merchant\/finance\/public-transfer-batches/, '对公批次必须走资金域接口');
  assert.doesNotMatch(js, /\/api\/merchant\/orders(?:['"]|\/)/, '资金页错误时不得偷偷请求 legacy 订单');
  assert.match(wxml, /本月个人账户\{\{overview\.netLabel\}\}/, '个人账户与对公必须是两条独立口径');
  assert.match(wxml, /待对公结算/, '第二条去向必须单独可见');
  assert.doesNotMatch(wxml, /提现|可提现余额|合计/, '结算页不得重新变成资产中心或两去向合计');
}

test('两去向不加总且结算页无提现：变异为合计或 legacy 请求必红', () => {
  const js = ledgerJs(); const wxml = ledgerWxml();
  assertSettlementSurface(js, wxml);
  assert.throws(() => assertSettlementSurface(js.replace('/api/merchant/finance/overview', '/api/merchant/orders'), wxml), /结算必须只读资金域 overview/);
  assert.throws(() => assertSettlementSurface(js, wxml.replace('待对公结算', '合计')), /第二条去向/);
});

function assertRedemptionContract(js, wxml) {
  assert.match(js, /\/finance\/redemptions/, '核销记录必须读新的 redemption 合同');
  // 2026-08-11 重排:右列统一成金额位(零现金由 amountDisplay 给破折号),
  // 「现金是否成立」的分支下沉到 redemptionRow 的 amountText/amountTone,不再靠 wxml wx:if。
  assert.match(wxml, /class="fin-row__v fin-row__v--\{\{item\.amountTone\}\}"/, '金额列必须按现金成立与否区分色调');
  assert.match(js, /item\.amountText = row\.settlementAmount == null \|\| Number\(row\.settlementAmount\) === 0 \? null :/,
    '现金成立分支必须保留:null 与 0 都不算成立');
  assert.match(wxml, /label="\{\{item\.stateText\}\}"/, '未结算或零现金履约必须消费服务端展示态(chip 承载)');
  assert.doesNotMatch(wxml, /wx:else>待主题结算<\/text>/, '零现金不得被写死成待主题结算');
  assert.match(js, /item\.noCashReason/, '零现金必须消费服务端给出的具体原因');
  assert.doesNotMatch(js, /权益已履约|本次合作不产生现金分润/, '前端不得硬编码三种零现金原因');
}

test('待结算不是伪收入且三类零现金不吞并：删现金成立分支即红', () => {
  const js = ledgerJs(); const wxml = ledgerWxml();
  assertRedemptionContract(js, wxml);
  // 变异锚点跟着结构走:现金成立与否现在由 redemptionRow 的 amountText 决定,
  // 把「0 也算成立」注回去(等价于旧的 wx:if="{{true}}")必须红。
  const brokenJs = js.replace(
    'item.amountText = row.settlementAmount == null || Number(row.settlementAmount) === 0 ? null :',
    'item.amountText = row.settlementAmount == null ? null :');
  assert.notEqual(brokenJs, js, '负控锚点失效');
  assert.throws(() => assertRedemptionContract(brokenJs, wxml), /现金成立分支/);
});

function assertFinanceFailureBoundary(js, wxml) {
  assert.match(js, /isFinancePagePayload\(res\)/, '200 空 payload 必须走严格合同校验');
  assert.match(js, /fail: \(error\) => done\(error \|\| null\)/,
    '网络与 HTTP 权限失败必须保留错误对象并进入错误路径');
  assert.match(wxml, /<cy-error/, '错误必须在页面明确渲染');
  assert.doesNotMatch(js, /loadLegacyOrders/, '不允许 legacy 静默回落');
}

test('500 与 200 空 payload 都只显示 cy-error：恢复回落分支即红', () => {
  const js = ledgerJs();
  const wxml = ledgerWxml();
  assertFinanceFailureBoundary(js, wxml);
  assert.throws(() => assertFinanceFailureBoundary(`${js}\nfunction loadLegacyOrders() {}`, wxml), /legacy/);
});

test('深链资金场景已移除：任一旧 scene 复活即红', () => {
  const sources = [
    read('components/cy/scene-deep-link/index.js'), read('components/cy/scene-route-content/index.js'), read('utils/scene-registry.js'),
  ].join('\n');
  const assertNoMerchantFinanceScenes = (input) => assert.doesNotMatch(input, /merchant-ledger|merchant-withdraw|merchant-withdraw-records/);
  assertNoMerchantFinanceScenes(sources);
  assert.throws(() => assertNoMerchantFinanceScenes(`${sources}\nmerchant-withdraw`), /merchant-withdraw/);
});

test('后端金额、身份与 owner 合同只由服务端把关', () => {
  const controller = read('../chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiMerchantController.java');
  const service = read('../chengyinhub-system/src/main/java/com/chengyinhub/business/service/impl/MerchantFinanceQueryService.java');
  const payableMapper = read('../chengyinhub-system/src/main/resources/mapper/business/MerchantPayableMapper.xml');
  assert.match(controller, /getAppUserId\(\)/, '资金接口必须从登录态拿 memberId');
  assert.doesNotMatch(controller.match(/\/finance\/[\s\S]*?(?=\n\s*@Operation|\n\})/)?.[0] || '', /merchantMemberId/, '资金接口不得接收客户端 merchantMemberId');
  assert.match(service, /RoundingMode\.HALF_UP/, '金额必须在后端四舍五入为两位');
  assert.match(service, /setScale\(2/, '金额字符串必须固定两位');
  assert.match(payableMapper, /where merchant_member_id = #\{merchantMemberId\}/, '应付 SQL 必须带 owner 条件');
});
