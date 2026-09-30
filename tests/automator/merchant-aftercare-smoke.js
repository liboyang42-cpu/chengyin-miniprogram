/**
 * 商家售后详情页的受控模拟器证据。
 *
 * 这里只验证页面可编译、三段状态/操作胶囊能渲染,点「同意」能打开回应面板。
 * fixture 通过 setData 注入，不能替代真实后端联调；状态投影和 pending→refunded
 * 负控由 tests/unit/merchant-aftercare-*.test.js 负责。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUT_DIR = process.env.MERCHANT_AFTERCARE_UI_OUT
  || path.join(os.tmpdir(), 'chengyin-merchant-aftercare-ui');
process.env.UI_AUDIT_OUT = process.env.UI_AUDIT_OUT || OUT_DIR;
process.env.WX_AUTO_PORT = process.env.WX_AUTO_PORT || '9687';

const { launchFixed } = require('../../scripts/_infra');

const DETAIL = {
  refundId: 81,
  refundNo: 'RF202608230081',
  refundNoText: 'RF202608230081',
  sourceText: '报名退款',
  refundAmountText: '¥128.00',
  hasRefundAmount: true,
  reason: '行程临时调整，申请取消报名',
  createTimeText: '2026-08-23 18:20',
  processingText: '平台审核中',
  processingHint: '平台尚未完成退款审核',
  processingVariant: 'warning',
  merchantOpinionText: '商家已同意申请',
  merchantOpinionHint: '这是商家意见，不代表款项已退',
  merchantOpinionVariant: 'success',
  refunded: false,
  refundedText: '尚未确认退回',
  refundedHint: '不要根据商家意见推断退款结果',
  refundedVariant: 'neutral',
  canRespond: true,
  allowedDecisions: ['AGREE', 'REJECT', 'EVIDENCE'],
  timelineNodes: [
    { title: '玩家提交退款申请', time: '2026-08-23 18:20', status: 'done' },
    { title: '补充凭证', time: '2026-08-23 18:45', desc: '店长', status: 'done' },
    { title: '平台审核中', desc: '平台尚未完成退款审核', status: 'doing' },
    { title: '款项结果', desc: '尚未确认退回', status: 'todo' },
  ],
  responses: [{
    id: 19,
    decisionText: '补充凭证',
    decisionVariant: 'neutral',
    actorText: '店长',
    createTimeText: '2026-08-23 18:45',
    contentText: '已核对报名记录，补充现场沟通凭证。',
    evidenceUrl: '/profile/merchant/aftercare/81-chat.png',
    hasEvidence: true,
  }],
};

async function capture(mp, fileName) {
  const file = path.join(OUT_DIR, fileName);
  await mp.screenshot({ path: file });
  if (!fs.existsSync(file) || fs.statSync(file).size < 1000) {
    throw new Error(`截图文件无效: ${file}`);
  }
  return file;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const mp = await launchFixed();
  const consoleErrors = [];
  mp.on('console', (message) => {
    if (message.type === 'error') {
      consoleErrors.push(String(message.args && message.args[0] || '').slice(0, 240));
    }
  });

  try {
    const page = await mp.reLaunch('/pages/merchant/aftercare/detail/index?refundId=81');
    await page.waitFor(1000);
    if (page.path.replace(/^\//, '') !== 'pages/merchant/aftercare/detail/index') {
      throw new Error(`未进入商家售后页: ${page.path}`);
    }

    await page.setData({
      pageState: 'ready',
      errorMessage: '',
      detail: DETAIL,
      canRespond: true,
      allowedDecisionMap: { AGREE: true, REJECT: true, EVIDENCE: true },
      respondBlockedText: '',
      decision: '',
      content: '',
      evidenceKeys: [],
      canSubmit: false,
      submitting: false,
      submitError: '',
      respondOpen: false,
      respondStep: 0,
    });
    await page.waitFor(500);

    const statusRows = await page.$$('.ac-status-row');
    const decisions = await page.$$('.ac-decision');
    if (statusRows.length !== 3) throw new Error(`三段状态仅渲染 ${statusRows.length} 段`);
    if (decisions.length !== 3) throw new Error(`操作胶囊仅渲染 ${decisions.length} 项`);

    const statusShot = await capture(mp, 'merchant-aftercare-status.png');
    await decisions[0].tap();
    await page.waitFor(200);
    const selected = await page.data('decision');
    if (selected !== 'AGREE') throw new Error(`点击同意后 decision=${selected}`);
    if (await page.data('respondOpen') !== true) throw new Error('点击同意后回应面板未打开');
    await page.waitFor(400);
    const formShot = await capture(mp, 'merchant-aftercare-response.png');

    const result = {
      evidenceType: 'controlled-simulator-rendering-not-backend-e2e',
      route: page.path,
      statusRows: statusRows.length,
      decisions: decisions.length,
      selected,
      consoleErrors,
      screenshots: [statusShot, formShot],
    };
    fs.writeFileSync(path.join(OUT_DIR, 'merchant-aftercare-evidence.json'), JSON.stringify(result, null, 2));
    if (consoleErrors.length) throw new Error(`控制台出现 ${consoleErrors.length} 条 error`);
    console.log(`[merchant-aftercare-ui] PASS statusRows=3 decisions=3 selected=${selected}`);
    console.log(`[merchant-aftercare-ui] screenshots=${statusShot},${formShot}`);
  } finally {
    if (mp && typeof mp.disconnect === 'function') {
      await Promise.resolve(mp.disconnect()).catch(() => {});
    }
  }
})().catch((error) => {
  console.error('[merchant-aftercare-ui] FAIL', error && error.message ? error.message : error);
  process.exit(1);
});
