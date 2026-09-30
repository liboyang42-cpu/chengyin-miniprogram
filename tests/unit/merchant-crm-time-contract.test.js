/**
 * R9-10 回归: 商家 CRM 客户详情的时间展示在中国/UTC/洛杉矶设备一致。
 *
 * 后端 MerchantCrmTimelineItemVO.occurredAt / MerchantCrmCustomerSummary.lastInteractionTime
 * 是 java.util.Date, 无 @JsonFormat → ISO 带偏移。旧 view-model 用
 * `replace(/-/g,'/')` 解析: 负偏移 → 空串/"尚无互动记录", +08:00 → 按设备本地时区漂移。
 * 这里用子进程三档时区驱动真实 shapeCustomerDetail/buildIdentityLine。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../pages/merchant/customer/detail/view-model.js');

function runUnder(TZ) {
  const script = `
    const { shapeCustomerDetail } = require(${JSON.stringify(modulePath)});
    const mk = (occurredAt, last) => ({
      summary: { customerMemberId: 9004, displayName: '客户', avatar: '', arrivedCount: 1, pendingCount: 0, refundedCount: 0, paidAmount: 10, lastInteractionTime: last },
      systemTags: [], merchantTags: [],
      timeline: [{ key: 'registration-88', type: 'ARRIVED', title: '到店', description: '', occurredAt }]
    });
    const plus = shapeCustomerDetail(mk('2026-09-13T02:27:00.000+08:00', '2026-09-13T02:27:00.000+08:00'), 9004);
    const minus = shapeCustomerDetail(mk('2026-09-13T02:27:00.000-07:00', '2026-09-13T02:27:00.000-07:00'), 9004);
    process.stdout.write(JSON.stringify({
      plusOccurred: plus.timeline[0].occurredAtText,
      plusLast: plus.summary.lastInteractionTimeText,
      plusIdentity: plus.identityLine,
      plusDay: plus.participation[0] && plus.participation[0].day,
      minusOccurred: minus.timeline[0].occurredAtText,
      minusIdentity: minus.identityLine,
      minusDay: minus.participation[0] && minus.participation[0].day
    }));
  `;
  return JSON.parse(execFileSync(process.execPath, ['-e', script], {
    env: Object.assign({}, process.env, { TZ }),
    encoding: 'utf8'
  }));
}

test('R9-10 CRM 客户详情三档时区: ISO 偏移按中国墙钟, 负偏移不退化成无记录', () => {
  for (const TZ of ['America/Los_Angeles', 'Asia/Shanghai', 'UTC']) {
    const r = runUnder(TZ);
    assert.equal(r.plusOccurred, '2026-09-13 02:27', `${TZ}: +08:00 发生时间`);
    assert.equal(r.plusLast, '2026-09-13 02:27', `${TZ}: +08:00 最近互动`);
    assert.equal(r.plusIdentity, '最近互动 9月13日', `${TZ}: +08:00 身份行`);
    assert.equal(r.plusDay, '13', `${TZ}: +08:00 参与日`);
    assert.equal(r.minusOccurred, '2026-09-13 17:27', `${TZ}: -07:00 发生时间应为中国 17:27`);
    assert.equal(r.minusIdentity, '最近互动 9月13日', `${TZ}: -07:00 不得退化成尚无互动记录`);
    assert.equal(r.minusDay, '13', `${TZ}: -07:00 参与日`);
  }
});
