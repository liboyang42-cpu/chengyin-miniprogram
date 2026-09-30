// 商家结算台账视觉与交互冒烟：可传 WS_ENDPOINT 复用已确认的本项目端口，或用 DEVTOOLS_CLI 覆盖 harness 默认 CLI。
const path = require('path');
const fs = require('fs');
const { closeMiniProgram, openMiniProgram } = require('./harness');

const PROJECT_PATH = path.resolve(__dirname, '..', '..');

async function main() {
  const session = await openMiniProgram({ projectPath: PROJECT_PATH });
  const mp = session.mp;
  try {
    const page = await mp.reLaunch('/pages/merchant/ledger/index?view=settlement');
    await page.waitFor(1000);
    if (page.path.replace(/^\//, '') !== 'pages/merchant/ledger/index') {
      throw new Error('未进入商家台账页:' + page.path);
    }
    await page.setData({
      view: 'settlement', loading: false, error: false,
      overview: { netLabel: '净入账', personalNetDisplay: '¥123.00', publicPendingDisplay: '¥18.00', personalGrossDisplay: '¥126.00', personalAdjustmentDisplay: '¥-3.00', hasAdjustmentPending: false },
      entries: [{ entryKey: 'payable:21', sourceText: '核销计酬', amountDisplay: '+¥18.00', timeText: '07-10', stateText: '待结算' }],
      batches: [{ batchId: '21', periodYm: '2026-07', amountDisplay: '¥126.00', stateText: '平台已打款 · 未开票', tone: 'settled' }]
    });
    await page.waitFor(300);
    const data = await page.data();
    if (data.view !== 'settlement' || data.batches.length !== 1 || data.overview.personalNetDisplay !== '¥123.00') {
      throw new Error('结算台账数据未正确渲染');
    }
    const outputDir = '/tmp/chengyin-shots';
    fs.mkdirSync(outputDir, { recursive: true });
    const screenshot = path.join(outputDir, 'merchant-ledger-settlement.png');
    await mp.screenshot({ path: screenshot });
    console.log('[merchant-ledger-settlement] PASS:结算视图、两条去向和批次已渲染,screenshot=' + screenshot);
  } finally {
    await closeMiniProgram(session);
  }
}

main().catch((error) => {
  console.error('[merchant-ledger-settlement] FAIL:', error && error.message ? error.message : error);
  process.exit(1);
});
