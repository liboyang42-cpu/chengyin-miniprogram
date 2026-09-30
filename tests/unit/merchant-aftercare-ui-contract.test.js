const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('售后页显式覆盖访问与加载状态，ready 态展示三轨真实状态', () => {
  const wxml = read('pages/merchant/aftercare/detail/index.wxml');
  ['loading', 'error', 'ready', 'no-permission'].forEach((state) => {
    assert.match(wxml, new RegExp(`pageState === '${state}'`), `缺少 ${state} 状态`);
  });
  ['平台处理', '商家意见', '款项结果'].forEach((label) => assert.match(wxml, new RegExp(label)));
  assert.match(wxml, /\{\{detail\.processingText\}\}/);
  assert.match(wxml, /\{\{detail\.merchantOpinionText\}\}/);
  assert.match(wxml, /\{\{detail\.refundedText\}\}/);
  assert.match(wxml, /退款政策快照/);
  assert.match(wxml, /\{\{detail\.refundPolicyText\}\}/);
  assert.match(wxml, /\{\{detail\.refundDeadlineText\}\}/);
  assert.doesNotMatch(wxml, /退款成功/, '页面不得用笼统成功文案覆盖真实款项状态');
});

test('回应表单按服务端 decision 白名单展示，并用真实图片上传替代手贴 URL', () => {
  const wxml = read('pages/merchant/aftercare/detail/index.wxml');
  const js = read('pages/merchant/aftercare/detail/index.js');
  ['AGREE', 'REJECT', 'EVIDENCE'].forEach((decision) => {
    assert.match(wxml, new RegExp(`data-decision="${decision}"`));
    assert.match(wxml, new RegExp(`wx:if="\\{\\{allowedDecisionMap\\.${decision}\\}\\}"`));
  });
  assert.match(wxml, /bindtap="chooseEvidence"/, '必须有可点击的上传入口');
  assert.match(wxml, /bindtap="previewEvidence"/, '上传成功后必须能预览');
  assert.match(wxml, /catchtap="removeEvidence"/, '上传错误时必须能移除重选');
  assert.match(js, /app\.chooseImage\(/, '必须复用仓内真实选择并上传能力');
  assert.match(js, /bizType:\s*'merchant_aftercare_evidence'/,
    '售后凭证必须走不返回长期 URL 的专用上传合同');
  assert.doesNotMatch(wxml, /bindinput="onEvidenceInput"|凭证 URL/, '不得继续要求商家手贴 URL');
  assert.match(wxml, /catchtap="previewResponseEvidence"/, '历史凭证只能走当前详情短时预览');
  assert.match(wxml, /wx:elif="\{\{item\.evidenceUnavailable\}\}"[\s\S]*?暂不可查看/,
    '凭证核验失败必须显示暂不可查看占位,不能悄悄消失');
  assert.match(js, /formData:\s*\(\)\s*=>\s*\(\{\s*refundId:/, '凭证上传必须带退款单号');
  assert.match(read('app.js'), /formData:\s*options\.formData/,
    'app.chooseImage 必须把调用方 formData 透传给上传池,否则 refundId 到不了服务端');
  assert.doesNotMatch(wxml, /copyEvidenceUrl|复制凭证地址|\{\{item\.evidenceUrl\}\}/,
    '不得把 bearer URL 展示或复制给用户');
  assert.match(wxml, /disabled="\{\{!canSubmit\}\}"[^>]*bindtap="submitResponse"/);
  assert.match(wxml, /wx:if="\{\{canRespond\}\}"/);
});

test('详情照 Revolut 313:大金额头 + 操作胶囊 + 键值卡 + 处理记录时间线 + 联系平台客服', () => {
  const wxml = read('pages/merchant/aftercare/detail/index.wxml');
  const json = JSON.parse(read('pages/merchant/aftercare/detail/index.json'));
  assert.match(wxml, /<cy-page-title title="\{\{pageTitle\}\}"/, '顶部大字由 pageTitle 持有');
  assert.match(wxml, /<view class="ac-kv" wx:if="\{\{!detail\.hasRefundAmount\}\}">[\s\S]*?ac-kv-v--mute/, '金额未知在状态卡弱色显示');
  const actions = wxml.match(/<view class="ac-actions" wx:if="\{\{canRespond\}\}">[\s\S]*?\n        <\/view>/);
  assert.ok(actions, '操作胶囊只在可回应时出现');
  ['同意', '不同意', '补充凭证'].forEach(label => assert.match(actions[0], new RegExp(`<text>${label}</text>`)));
  assert.match(wxml, /<text class="ac-readonly-sub" wx:else>\{\{respondBlockedText\}\}<\/text>/);
  assert.match(wxml, /bindtap="copyRefundNo"/, '退款单号可复制');
  assert.match(wxml, /<cy-timeline nodes="\{\{detail\.timelineNodes\}\}" \/>/, '处理记录走共享时间线');
  assert.doesNotMatch(wxml, /ac-status-index|>0[123]</, '不再使用 01/02/03 步骤卡');
  assert.match(wxml, /<cy-cell title="联系平台客服"[^>]*open-type="contact"/);
  const bare = wxml.replace(/<!--[\s\S]*?-->/g, '');
  assert.match(bare, /<view class="fin-group ac-group" wx:if="\{\{detail\.customerNicknameText\}\}">\s*<view class="ac-group-title">客户<\/view>/,
    '客户组只在后端下发昵称时渲染');
  assert.doesNotMatch(bare, /手机号|detail\.phone|detail\.customerPhone|openid/i, '客户组只放昵称,不得出现 PII');
  assert.match(bare, /<text class="ac-kv-k">已转平台客服<\/text>\s*<text class="ac-kv-v">\{\{detail\.platformTakeoverText\}\}<\/text>/);
  ['cy-sheet', 'cy-timeline', 'cy-cell'].forEach(name => assert.ok(json.usingComponents[name], name));
});

test('回应走 full 面板两步:填写 → 确认后果 → 提交;确认文案不承诺退款时效', () => {
  const wxml = read('pages/merchant/aftercare/detail/index.wxml');
  const vm = require('../../pages/merchant/aftercare/detail/view-model');
  assert.match(wxml, /<cy-sheet show="\{\{respondOpen\}\}" variant="full" footer/);
  assert.match(wxml, /can-back="\{\{respondStep === 1\}\}"[^>]*bind:back="onRespondBack" bind:close="onRespondClose"/);
  assert.match(wxml, /disabled="\{\{!canSubmit\}\}" bindtap="goRespondConfirm">继续</);
  assert.match(wxml, /<text class="ac-confirm-text">\{\{flow\.consequence\}\}<\/text>/);
  ['AGREE', 'REJECT', 'EVIDENCE'].forEach((decision) => {
    const flow = vm.RESPONSE_FLOW[decision];
    assert.match(flow.consequence, /提交后由平台审核/, decision);
    assert.doesNotMatch(flow.consequence + flow.submitText, /\d+\s*(个)?(工作)?[日天小时]|到账|退款成功/, `${decision} 不得编造时效或成功`);
  });
});
