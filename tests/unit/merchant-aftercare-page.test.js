const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('../helpers/ui-sandbox-vm.js'); // node:vm + 沙箱里装真 utils/toast.js·loading.js

const root = path.resolve(__dirname, '../..');

function mountPage() {
  let definition;
  const requests = [];
  const navigations = [];
  const toasts = [];
  const imageSelections = [];
  const previews = [];
  const modals = [];
  const modalMock = { confirm: true };
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    sendRequest: request => { requests.push(request); },
    chooseImage: (callback, count, options) => { imageSelections.push({ callback, count, options }); },
  };
  const wx = {
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    navigateBack() {},
    reLaunch: options => navigations.push(options.url),
    redirectTo: options => navigations.push(options.url),
    showToast: options => toasts.push(options.title),
    setClipboardData: options => navigations.push('clipboard:' + options.data),
    previewImage: options => previews.push(options),
    // 沙箱无页面栈 ⇒ 真 utils/modal.js 回落到 wx.showModal(带 dangerKey 与登记表文案)
    showModal: (options) => {
      modals.push(options.dangerKey || options.title);
      if (options.success) options.success({ confirm: modalMock.confirm, cancel: !modalMock.confirm });
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(root, 'pages/merchant/aftercare/detail/index.js'), 'utf8'),
    {
      Page: value => { definition = value; },
      getApp: () => app,
      require: request => {
        if (request.includes('merchant-access-policy')) {
          return {
            inactiveAccess: () => ({ active: false, canReadAftercare: false, canRespondAftercare: false }),
            normalizeMerchantAccess: raw => raw,
          };
        }
        if (request.includes('merchant-theme')) {
          return { merchantPageShow() {}, merchantPageRestore() {} };
        }
        if (request === './view-model.js') {
          return require('../../pages/merchant/aftercare/detail/view-model');
        }
        throw new Error('unexpected require: ' + request);
      },
      wx,
      console,
      Date,
      Math,
      JSON,
      encodeURIComponent,
    },
  );
  const page = Object.assign({}, definition);
  page.data = JSON.parse(JSON.stringify(definition.data));
  page.setData = function setData(patch) { Object.assign(this.data, patch); };
  return { page, requests, navigations, toasts, imageSelections, previews, modals, modalMock };
}

test('售后页先校验商家权限，无读取权限时不请求详情', () => {
  const denied = mountPage();
  denied.page.onLoad({ refundId: '81' });
  assert.equal(denied.page.data.pageState, 'loading');
  assert.equal(denied.requests[0].url, '/api/merchant/access/me');
  denied.requests[0].success({
    code: 200,
    data: { active: true, canReadAftercare: false, canRespondAftercare: false },
  });
  assert.equal(denied.page.data.pageState, 'no-permission');
  assert.equal(denied.requests.length, 1, '权限关闭后不得探测退款详情');

  const allowed = mountPage();
  allowed.page.onLoad({ refundId: '81' });
  allowed.requests[0].success({
    code: 200,
    data: { active: true, canReadAftercare: true, canRespondAftercare: false },
  });
  assert.equal(allowed.requests[1].url, '/api/merchant/aftercare/detail?refundId=81');
  assert.equal(allowed.requests[1].method, 'POST');
});

test('回应能力同时服从岗位权限与服务端退款单状态', () => {
  const mounted = mountPage();
  mounted.page.onLoad({ refundId: '81' });
  mounted.requests[0].success({
    code: 200,
    data: { active: true, canReadAftercare: true, canRespondAftercare: false },
  });
  mounted.requests[1].success({
    code: 200,
    data: {
      refundId: 81,
      refundNo: 'RF-81',
      refundAmount: '128.50',
      processing: 'WAITING_PLATFORM_REVIEW',
      merchantOpinion: 'PENDING',
      canRespond: true,
      allowedDecisions: ['AGREE', 'REJECT', 'EVIDENCE'],
      responses: [],
    },
  });

  assert.equal(mounted.page.data.pageState, 'ready');
  assert.equal(mounted.page.data.detail.refunded, false);
  assert.equal(mounted.page.data.canRespond, false, '只读岗位不能因退款单可回应而放大权限');
});

test('详情接口 200 但 payload 不完整时进入 error，不能用默认值冒充 ready', () => {
  const mounted = mountPage();
  mounted.page.onLoad({ refundId: '81' });
  mounted.requests[0].success({
    code: 200,
    data: { active: true, canReadAftercare: true, canRespondAftercare: true },
  });
  mounted.requests[1].success({ code: 200, data: {} });

  assert.equal(mounted.page.data.pageState, 'error');
  assert.equal(mounted.page.data.detail, null);
  assert.equal(mounted.page.data.canRespond, false);
});

test('回应失败重试复用 requestId，编辑草稿后生成新的 requestId', () => {
  const mounted = mountPage();
  mounted.page.onLoad({ refundId: '81' });
  mounted.requests[0].success({
    code: 200,
    data: { active: true, canReadAftercare: true, canRespondAftercare: true },
  });
  mounted.requests[1].success({
    code: 200,
    data: {
      refundId: 81,
      processing: 'WAITING_PLATFORM_REVIEW',
      merchantOpinion: 'PENDING',
      canRespond: true,
      allowedDecisions: ['AGREE', 'REJECT', 'EVIDENCE'],
      responses: [],
    },
  });

  mounted.page.onDecisionTap({ currentTarget: { dataset: { decision: 'REJECT' } } });
  mounted.page.onContentInput({ detail: { value: '退款理由与订单事实不一致' } });
  mounted.page.submitResponse();
  const first = mounted.requests[2];
  const firstBody = JSON.parse(first.data);
  assert.equal(first.url, '/api/merchant/aftercare/respond?refundId=81');
  assert.match(firstBody.requestId, /^[A-Za-z0-9._:-]{1,64}$/);
  first.fail();

  mounted.page.submitResponse();
  const replayBody = JSON.parse(mounted.requests[3].data);
  assert.equal(replayBody.requestId, firstBody.requestId, '同一草稿网络重试必须是幂等重放');
  mounted.requests[3].fail();

  mounted.page.onContentInput({ detail: { value: '补充：顾客已使用权益' } });
  mounted.page.submitResponse();
  const changedBody = JSON.parse(mounted.requests[4].data);
  assert.notEqual(changedBody.requestId, firstBody.requestId, '不同草稿不能复用旧 requestId');
});

test('缺 refundId 直接回售后列表，不请求任何接口也不出查单表单', () => {
  const mounted = mountPage();
  mounted.page.onLoad({});
  assert.deepEqual(mounted.navigations, ['/pages/merchant/aftercare/index']);
  assert.equal(mounted.requests.length, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(mounted.page, 'findAftercare'), false);

  // 负控:带合法 refundId 时不能被误重定向
  const ok = mountPage();
  ok.page.onLoad({ refundId: '81' });
  assert.deepEqual(ok.navigations, []);
  assert.equal(ok.requests[0].url, '/api/merchant/access/me');
});

test('回应两步:胶囊打开面板 → 继续校验草稿 → 确认页提交;关闭面板不丢草稿，成功后收起', () => {
  const mounted = mountPage();
  mounted.page.onLoad({ refundId: '81' });
  mounted.requests[0].success({
    code: 200,
    data: { active: true, canReadAftercare: true, canRespondAftercare: true },
  });
  mounted.requests[1].success({
    code: 200,
    data: {
      refundId: 81,
      refundNo: 'RF-81',
      processing: 'WAITING_PLATFORM_REVIEW',
      merchantOpinion: 'PENDING',
      canRespond: true,
      allowedDecisions: ['AGREE', 'REJECT', 'EVIDENCE'],
      responses: [],
    },
  });

  mounted.page.onDecisionTap({ currentTarget: { dataset: { decision: 'REJECT' } } });
  assert.equal(mounted.page.data.respondOpen, true);
  assert.equal(mounted.page.data.respondStep, 0);
  assert.equal(mounted.page.data.flow.formTitle, '不同意退款申请');

  mounted.page.goRespondConfirm();
  assert.equal(mounted.page.data.respondStep, 0, '不同意未写原因不能进确认页');
  assert.match(mounted.page.data.submitError, /不同意的原因/);
  assert.equal(mounted.requests.length, 2, '继续按钮本身不得发写请求');

  mounted.page.onContentInput({ detail: { value: '顾客已到店使用权益' } });
  mounted.page.goRespondConfirm();
  assert.equal(mounted.page.data.respondStep, 1);
  assert.equal(mounted.requests.length, 2, '进入确认页仍不得提交');

  mounted.page.onRespondBack();
  assert.equal(mounted.page.data.respondStep, 0);
  mounted.page.onRespondClose();
  assert.equal(mounted.page.data.respondOpen, false);
  assert.equal(mounted.page.data.content, '顾客已到店使用权益', '误关面板不能丢已写原因');

  mounted.page.onDecisionTap({ currentTarget: { dataset: { decision: 'REJECT' } } });
  mounted.page.goRespondConfirm();
  mounted.page.submitResponse();
  assert.equal(mounted.requests[2].url, '/api/merchant/aftercare/respond?refundId=81');
  mounted.page.onRespondClose();
  assert.equal(mounted.page.data.respondOpen, true, '提交中不得关闭面板');
  mounted.requests[2].success({
    code: 200,
    data: { id: 10, refundId: 81, decision: 'REJECT', processing: 'WAITING_PLATFORM_REVIEW', merchantOpinion: 'REJECT', refunded: false },
  });
  assert.equal(mounted.page.data.respondOpen, false);
  assert.equal(mounted.page.data.respondStep, 0);
  assert.equal(mounted.page.data.content, '');
  assert.deepEqual(mounted.toasts, ['意见已提交，等待平台处理']);
});

test('换意见清空说明(不同意的原因不能带进同意),同一意见重开保留草稿;金额未知时大字不显示「金额待确认」', () => {
  const mounted = mountPage();
  mounted.page.onLoad({ refundId: '81' });
  mounted.requests[0].success({ code: 200, data: { active: true, canReadAftercare: true, canRespondAftercare: true } });
  mounted.requests[1].success({
    code: 200,
    data: {
      refundId: 81, refundAmount: null, createTime: '2026-09-17 10:05:00', sourceType: 'registration',
      processing: 'WAITING_PLATFORM_REVIEW', merchantOpinion: 'PENDING',
      canRespond: true, allowedDecisions: ['AGREE', 'REJECT', 'EVIDENCE'], responses: [],
    },
  });
  assert.equal(mounted.page.data.pageTitle, '退款售后');
  assert.equal(mounted.page.data.pageSubtitle, '报名退款', '后端没下发活动名时副标题只有类型');

  mounted.page.onDecisionTap({ currentTarget: { dataset: { decision: 'REJECT' } } });
  mounted.page.onContentInput({ detail: { value: '顾客已核销' } });
  mounted.page.onRespondClose();
  mounted.page.onDecisionTap({ currentTarget: { dataset: { decision: 'REJECT' } } });
  assert.equal(mounted.page.data.content, '顾客已核销', '同一意见重开保留草稿');
  mounted.page.onRespondClose();
  mounted.page.onDecisionTap({ currentTarget: { dataset: { decision: 'AGREE' } } });
  assert.equal(mounted.page.data.content, '', '换成同意时不得带着不同意的原因');

  const known = mountPage();
  known.page.onLoad({ refundId: '82' });
  known.requests[0].success({ code: 200, data: { active: true, canReadAftercare: true, canRespondAftercare: true } });
  known.requests[1].success({
    code: 200,
    data: { refundId: 82, refundAmount: '128', processing: 'REFUNDED', merchantOpinion: 'AGREE', canRespond: false, allowedDecisions: [], responses: [] },
  });
  assert.equal(known.page.data.pageTitle, '¥128.00');
});

test('「不同意」提交前必须经过已登记危险确认，取消不发请求；「同意」不弹确认', () => {
  const mounted = mountPage();
  mounted.page.onLoad({ refundId: '81' });
  mounted.requests[0].success({ code: 200, data: { active: true, canReadAftercare: true, canRespondAftercare: true } });
  mounted.requests[1].success({
    code: 200,
    data: { refundId: 81, processing: 'WAITING_PLATFORM_REVIEW', merchantOpinion: 'PENDING', canRespond: true, allowedDecisions: ['AGREE', 'REJECT', 'EVIDENCE'], responses: [] },
  });
  mounted.page.onDecisionTap({ currentTarget: { dataset: { decision: 'REJECT' } } });
  mounted.page.onContentInput({ detail: { value: '顾客已到店使用权益' } });
  mounted.page.goRespondConfirm();

  mounted.modalMock.confirm = false;
  mounted.page.submitResponse();
  assert.deepEqual(mounted.modals, ['merchant.aftercare.reject']);
  assert.equal(mounted.requests.length, 2, '危险确认点取消时不得发出 respond');
  assert.equal(mounted.page.data.submitting, false);

  mounted.modalMock.confirm = true;
  mounted.page.submitResponse();
  assert.equal(mounted.modals.length, 2);
  assert.equal(mounted.requests[2].url, '/api/merchant/aftercare/respond?refundId=81');
  assert.equal(JSON.parse(mounted.requests[2].data).decision, 'REJECT');
  mounted.requests[2].success({ code: 200, data: { id: 3, refundId: 81, decision: 'REJECT', processing: 'WAITING_PLATFORM_REVIEW', merchantOpinion: 'REJECT', refunded: false } });

  mounted.page.onDecisionTap({ currentTarget: { dataset: { decision: 'AGREE' } } });
  mounted.page.goRespondConfirm();
  mounted.page.submitResponse();
  assert.equal(mounted.modals.length, 2, '同意不走危险确认');
  assert.equal(JSON.parse(mounted.requests[4].data).decision, 'AGREE');
});

test('退款单号复制只复制当前详情的单号', () => {
  const mounted = mountPage();
  mounted.page.copyRefundNo();
  assert.deepEqual(mounted.navigations, [], '没有详情时不复制');
  mounted.page.data.detail = { refundNoText: 'RF-81' };
  mounted.page.copyRefundNo();
  assert.deepEqual(mounted.navigations, ['clipboard:RF-81']);
});

test('只读岗位在平台审核中看到的是岗位提示，不是「审核已结束」', () => {
  const mounted = mountPage();
  mounted.page.onLoad({ refundId: '81' });
  mounted.requests[0].success({
    code: 200,
    data: { active: true, canReadAftercare: true, canRespondAftercare: true },
  });
  mounted.requests[1].success({
    code: 200,
    data: {
      refundId: 81,
      processing: 'WAITING_PLATFORM_REVIEW',
      merchantOpinion: 'PENDING',
      canRespond: false,
      allowedDecisions: [],
      responses: [],
    },
  });
  assert.equal(mounted.page.data.canRespond, false);
  assert.match(mounted.page.data.respondBlockedText, /只有查看权限/);
});

test('回应接口 200 但结果不完整时不得提示已提交或刷新成假成功', () => {
  const mounted = mountPage();
  mounted.page.onLoad({ refundId: '81' });
  mounted.requests[0].success({
    code: 200,
    data: { active: true, canReadAftercare: true, canRespondAftercare: true },
  });
  mounted.requests[1].success({
    code: 200,
    data: {
      refundId: 81,
      processing: 'WAITING_PLATFORM_REVIEW',
      merchantOpinion: 'PENDING',
      canRespond: true,
      allowedDecisions: ['AGREE', 'REJECT', 'EVIDENCE'],
      responses: [],
    },
  });
  mounted.page.onDecisionTap({ currentTarget: { dataset: { decision: 'AGREE' } } });
  mounted.page.submitResponse();
  mounted.requests[2].success({ code: 200, data: {} });

  assert.equal(mounted.toasts.length, 0);
  assert.equal(mounted.requests.length, 3, '脏回执不得继续刷新详情并冒充写入成功');
  assert.match(mounted.page.data.submitError, /结果/);
});

test('商家同意后只提示等待平台处理，刷新后款项仍可保持未退', () => {
  const mounted = mountPage();
  mounted.page.onLoad({ refundId: '81' });
  mounted.requests[0].success({
    code: 200,
    data: { active: true, canReadAftercare: true, canRespondAftercare: true },
  });
  mounted.requests[1].success({
    code: 200,
    data: {
      refundId: 81,
      processing: 'WAITING_PLATFORM_REVIEW',
      merchantOpinion: 'PENDING',
      canRespond: true,
      allowedDecisions: ['AGREE', 'REJECT', 'EVIDENCE'],
      responses: [],
    },
  });
  mounted.page.onDecisionTap({ currentTarget: { dataset: { decision: 'AGREE' } } });
  mounted.page.submitResponse();
  mounted.requests[2].success({
    code: 200,
    data: {
      id: 9,
      refundId: 81,
      decision: 'AGREE',
      processing: 'WAITING_PLATFORM_REVIEW',
      merchantOpinion: 'AGREE',
      refunded: false,
    },
  });

  assert.deepEqual(mounted.toasts, ['意见已提交，等待平台处理']);
  assert.doesNotMatch(mounted.toasts.join(' '), /退款成功|已退款/);
  assert.equal(mounted.requests[3].url, '/api/merchant/aftercare/detail?refundId=81');
  mounted.requests[3].success({
    code: 200,
    data: {
      refundId: 81,
      processing: 'WAITING_PLATFORM_REVIEW',
      merchantOpinion: 'AGREE',
      canRespond: true,
      allowedDecisions: ['AGREE', 'REJECT', 'EVIDENCE'],
      responses: [],
    },
  });
  assert.equal(mounted.page.data.detail.refunded, false);
  assert.equal(mounted.page.data.detail.refundedText, '尚未确认退回');
});

test('财务页只显示补凭证能力，选择并上传后才允许提交 evidenceKeys', () => {
  const mounted = mountPage();
  mounted.page.onLoad({ refundId: '81' });
  mounted.requests[0].success({
    code: 200,
    data: { active: true, roleCode: 'MERCHANT_FINANCE', canReadAftercare: true, canRespondAftercare: true },
  });
  mounted.requests[1].success({
    code: 200,
    data: {
      refundId: 81,
      processing: 'WAITING_PLATFORM_REVIEW',
      merchantOpinion: 'PENDING',
      canRespond: true,
      allowedDecisions: ['EVIDENCE'],
      responses: [],
    },
  });

  assert.equal(mounted.page.data.allowedDecisionMap.AGREE, false);
  assert.equal(mounted.page.data.allowedDecisionMap.REJECT, false);
  assert.equal(mounted.page.data.allowedDecisionMap.EVIDENCE, true);
  mounted.page.onDecisionTap({ currentTarget: { dataset: { decision: 'AGREE' } } });
  assert.equal(mounted.page.data.decision, '', '财务不能通过事件伪造选择同意');
  mounted.page.onDecisionTap({ currentTarget: { dataset: { decision: 'EVIDENCE' } } });
  assert.equal(mounted.page.data.canSubmit, false, '未上传凭证时必须 fail closed');

  mounted.page.chooseEvidence();
  assert.equal(mounted.imageSelections.length, 1);
  mounted.imageSelections[0].callback([]);
  assert.match(mounted.page.data.submitError, /上传.*有效/);
  assert.equal(mounted.page.data.canSubmit, false);

  mounted.page.chooseEvidence();
  const uploadResult = {
    fileName: 'upload/merchant-aftercare-evidence/0123456789abcdef0123456789abcdef.jpg',
  };
  assert.equal(mounted.imageSelections[1].count, 1);
  assert.equal(mounted.imageSelections[1].options.bizType, 'merchant_aftercare_evidence',
    '售后凭证必须走不返回长期 URL 的专用上传契约');
  assert.equal(typeof mounted.imageSelections[1].options.mapResult, 'function');
  assert.equal(typeof mounted.imageSelections[1].options.formData, 'function');
  assert.equal(JSON.stringify(mounted.imageSelections[1].options.formData(0)), '{"refundId":"81"}',
    'W6f:凭证上传必须带当前退款单,服务端据此绑定门店+退款单');
  mounted.imageSelections[1].callback([
    mounted.imageSelections[1].options.mapResult(uploadResult, 0, '/tmp/evidence.jpg'),
  ]);
  assert.equal(mounted.page.data.canSubmit, true);
  assert.equal(mounted.page.data.evidencePreviewUrl, '/tmp/evidence.jpg');
  mounted.page.submitResponse();
  const body = JSON.parse(mounted.requests[2].data);
  assert.deepEqual(body.evidenceKeys,
    ['upload/merchant-aftercare-evidence/0123456789abcdef0123456789abcdef.jpg']);
  assert.doesNotMatch(JSON.stringify(body), /https?:|Signature|Expires|\/tmp\//,
    '服务端 URL 和本地预览路径都不得进入售后 respond payload');
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'evidenceUrl'), false);
});

test('历史凭证只按当前详情索引预览，不把 bearer URL 放进事件参数', () => {
  const mounted = mountPage();
  const signedUrl = 'https://private-oss.example/upload/evidence.jpg?Expires=300&Signature=short-lived';
  mounted.page.data.detail = {
    responses: [{ hasEvidence: true, evidenceUrl: signedUrl }],
  };

  mounted.page.previewResponseEvidence({ currentTarget: { dataset: { url: signedUrl } } });
  assert.equal(mounted.previews.length, 0, '伪造 URL 事件参数不能触发预览');

  mounted.page.previewResponseEvidence({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(mounted.previews.length, 1);
  assert.equal(mounted.previews[0].current, signedUrl);
  assert.equal(mounted.previews[0].urls.length, 1);
  assert.equal(mounted.previews[0].urls[0], signedUrl);
});
