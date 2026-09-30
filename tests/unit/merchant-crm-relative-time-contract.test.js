/**
 * R9-10 回归: CRM 客户列表 relativeTime 必须按绝对时刻算, 不因 ISO 记法/设备时区改变。
 *
 * 后端 MerchantCrmCustomerRowVO.lastTime 是 java.util.Date(无 @JsonFormat) → ISO 带偏移。
 * 旧实现 `new Date(String(value).replace(/-/g,'/'))`: 负偏移 → Invalid → '', 正偏移按设备本地解析。
 * 同一时刻用 裸串/Z/+08:00/-07:00 四种记法表达, 相对时间必须一致且非空。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexSource = fs.readFileSync(
  path.resolve(__dirname, '../../pages/merchant/customer/index.js'),
  'utf8'
);

function loadRelativeTime() {
  const match = indexSource.match(/function relativeTime\(value\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'relativeTime 函数存在');
  const { toTimestamp } = require('../../utils/datetime.js');
  return new Function('toTimestamp', match[0] + '\nreturn relativeTime;')(toTimestamp);
}

test('R9-10 CRM relativeTime: 同一时刻的四种 ISO 记法结果一致且非空', () => {
  const relativeTime = loadRelativeTime();
  // 同一绝对时刻 2026-09-10T18:27:00Z 的四种表达
  const notations = [
    '2026-09-11 02:27:00',
    '2026-09-10T18:27:00.000Z',
    '2026-09-11T02:27:00.000+08:00',
    '2026-09-10T11:27:00.000-07:00'
  ];
  const results = notations.map(value => relativeTime(value));
  for (let i = 0; i < notations.length; i++) {
    assert.notEqual(results[i], '', `${notations[i]} 不得解析失败成空串`);
  }
  assert.equal(new Set(results).size, 1, `四种记法结果应一致: ${JSON.stringify(results)}`);
});

test('R9-10 CRM relativeTime: 无效值仍回退空串', () => {
  const relativeTime = loadRelativeTime();
  assert.equal(relativeTime('not-a-date'), '');
  assert.equal(relativeTime(''), '');
  assert.equal(relativeTime(null), '');
});
