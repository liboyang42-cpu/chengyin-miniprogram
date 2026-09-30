// datetime.js 的负控测试。
//
// ★核心要求:这些断言必须在【运行环境时区 ≠ UTC+8】时仍然成立。
//   如果把 datetime.js 换回 `new Date(str.replace(/-/g,'/'))` 的旧写法,下面的用例必须变红——
//   测试跑绿本身不算数,能区分"修好了"和"没修"才算数。
//   本文件通过 process.env.TZ 在进程启动前设定时区(node 的 Date 读它)。

process.env.TZ = 'UTC';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toTimestamp, chinaDateKey, isSameChinaDay, chinaDayStart, chinaDayEnd } = require('../../utils/datetime');

test('运行环境为 UTC 时,无时区字符串仍按中国时间解析', () => {
  // "2026-07-26 10:00:00" 语义是中国时间 10:00 = UTC 02:00 = epoch
  const expected = Date.UTC(2026, 6, 26, 2, 0, 0);
  assert.equal(toTimestamp('2026-07-26 10:00:00'), expected);
  // 旧写法在 TZ=UTC 下会得到 Date.UTC(...,10,0,0),比正确值晚 8 小时 —— 这条就是负控
  assert.notEqual(toTimestamp('2026-07-26 10:00:00'), Date.UTC(2026, 6, 26, 10, 0, 0));
  assert.equal(toTimestamp('2026-07-26'), Date.UTC(2026, 6, 25, 16, 0, 0), '纯日期也必须锚定中国零点');
});

test('已带时区标记的字符串不被重复锚定', () => {
  assert.equal(toTimestamp('2026-07-26T10:00:00Z'), Date.UTC(2026, 6, 26, 10, 0, 0));
  assert.equal(toTimestamp('2026-07-26T10:00:00+08:00'), Date.UTC(2026, 6, 26, 2, 0, 0));
  assert.equal(toTimestamp('2026-07-26T10:00:00-05:00'), Date.UTC(2026, 6, 26, 15, 0, 0));
});

test('数字 10 位秒 ×1000、13 位毫秒透传、Date 原样, 0/非法失败关闭', () => {
  assert.equal(toTimestamp(1234567890), 1234567890000, '10 位秒必须 ×1000');
  assert.equal(toTimestamp(1234567890000), 1234567890000, '13 位毫秒原样');
  assert.equal(toTimestamp(new Date(1234567890)), 1234567890, 'Date 是绝对毫秒, 原样');
  assert.ok(Number.isNaN(toTimestamp(0)), '0 失败关闭');
  assert.ok(Number.isNaN(toTimestamp('0')), "'0' 失败关闭");
  assert.ok(Number.isNaN(toTimestamp('2026-02-30')), '非法日历失败关闭');
  assert.ok(Number.isNaN(toTimestamp('')));
  assert.ok(Number.isNaN(toTimestamp(null)));
});

test('★边界:中国是今天、UTC 还是昨天时,chinaDateKey 必须返回中国日历日', () => {
  // 中国 2026-07-26 02:00 == UTC 2026-07-25 18:00
  const ts = toTimestamp('2026-07-26 02:00:00');
  assert.equal(new Date(ts).getUTCDate(), 25, '前提校验:这一刻在 UTC 确实是 25 号');
  // ★整个任务的核心断言:即使进程时区是 UTC,也必须报中国的 26 号
  assert.equal(chinaDateKey(ts), '2026-07-26');
  assert.equal(chinaDateKey('2026-07-26 02:00:00'), '2026-07-26');
});

test('★边界:中国还是昨天、UTC 已是今天时,同样不能错', () => {
  // 中国 2026-07-25 23:00 == UTC 2026-07-25 15:00(同日);取跨界点 中国 07-26 00:30
  assert.equal(chinaDateKey('2026-07-25 23:59:59'), '2026-07-25');
  assert.equal(chinaDateKey('2026-07-26 00:00:00'), '2026-07-26');
});

test('isSameChinaDay 按中国自然日判定,跨 UTC 日界不误判', () => {
  // 这两个时刻在 UTC 分属 25/26 两天,但在中国同属 26 日
  assert.ok(isSameChinaDay('2026-07-26 02:00:00', '2026-07-26 20:00:00'));
  // 这两个在 UTC 同属 26 日,但在中国分属 26/27 两天
  assert.ok(!isSameChinaDay('2026-07-26 23:00:00', '2026-07-27 01:00:00'));
});

test('chinaDayStart 返回中国自然日零点,不是本地零点', () => {
  const start = chinaDayStart('2026-07-26 15:30:00');
  assert.equal(start, Date.UTC(2026, 6, 25, 16, 0, 0)); // 中国 07-26 00:00 == UTC 07-25 16:00
  assert.equal(chinaDateKey(start), '2026-07-26');
});

test('chinaDayEnd 返回中国自然日 24 点前最后一毫秒,UTC 环境不漂移', () => {
  const end = chinaDayEnd('2026-07-26 15:30:00');
  assert.equal(end, Date.UTC(2026, 6, 26, 15, 59, 59, 999));
  assert.equal(chinaDateKey(end), '2026-07-26');
  assert.equal(end + 1, chinaDayStart('2026-07-27 00:00:00'));

  const brokenEnd = value => {
    const date = new Date(value);
    date.setHours(23, 59, 59, 999);
    return date.getTime();
  };
  assert.notEqual(brokenEnd('2026-07-26 15:30:00'), end);
});
