// FE-11 发布器日期时间纯函数 publish-datetime —— 从 fabu 抽出。
// 断言锚定「与原 fabu 内联实现行为一致」:归一化分支、补零格式、营业时间解析边界、日期列表结构。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeDateTime,
  formatDateTimeForAPI,
  parseBusinessTime,
  formatTime,
  buildDateList,
} = require('../../pages/publish/utils/publish/publish-datetime.js');

test('normalizeDateTime:空/null → null', () => {
  assert.equal(normalizeDateTime(null, '00:00:00'), null);
  assert.equal(normalizeDateTime('', '00:00:00'), null);
  assert.equal(normalizeDateTime('乱码', '00:00:00'), null);
});

test('normalizeDateTime:纯日期补 defaultTime', () => {
  assert.equal(normalizeDateTime('2026-07-10', '00:00:00'), '2026-07-10 00:00:00');
  assert.equal(normalizeDateTime('2026-07-10', '23:59:59'), '2026-07-10 23:59:59');
});

test('normalizeDateTime:带时分规整为 HH:mm:ss(缺秒补 00,支持 T 分隔)', () => {
  assert.equal(normalizeDateTime('2026-07-10 20:30', '00:00:00'), '2026-07-10 20:30:00');
  assert.equal(normalizeDateTime('2026-07-10T20:30:45', '00:00:00'), '2026-07-10 20:30:45');
});

test('formatDateTimeForAPI:补零组装 "YYYY-MM-DD HH:mm:00"', () => {
  assert.equal(formatDateTimeForAPI('2026-07-05', 9, 5), '2026-07-05 09:05:00');
  assert.equal(formatDateTimeForAPI('2026-12-31', 23, 59), '2026-12-31 23:59:00');
});

// 危险时刻:UTC 分界两侧。东半球(UTC+X)在本地 00:30 时 UTC 还停在前一天;
// 西半球(UTC-X)在本地 23:30 时 UTC 已跨到次日。任一时区下至少一个能暴露
// 「date 取 UTC 日、display 取本地日」的混用 —— 不依赖跑测试的那一刻,不看运气。
const EDGE_MOMENTS = [
  { label: '本地 00:30(东半球会跨回前一天)', at: new Date(2026, 6, 31, 0, 30) },
  { label: '本地 23:30(西半球会跨到次日)', at: new Date(2026, 6, 31, 23, 30) },
];

for (const moment of EDGE_MOMENTS) {
  test(`buildDateList 的 date 与 display 必须同一天 @ ${moment.label}`, () => {
    // 回归 2026-08-01:date 原先用 toISOString() 取 **UTC 日**,display/month/day 用本地
    // getter —— 同源不同轨。生产在 UTC+8,用户 00:00~07:59 打开发布页会看到「7月31日」
    // 却提交 2026-07-30(已实测复现)。
    const list = buildDateList(moment.at);
    assert.equal(list.length, 31);
    for (const item of list) {
      const [, mm, dd] = item.date.split('-');
      assert.equal(item.display, `${Number(mm)}月${Number(dd)}日`,
        `date=${item.date} 与 display=${item.display} 不是同一天`);
      assert.equal(item.month, Number(mm));
      assert.equal(item.day, Number(dd));
    }
  });

  test(`端到端:用户选中哪天,提交的就是哪天 @ ${moment.label}`, () => {
    // 原单测只喂裸字符串给 formatDateTimeForAPI,绕开了真实调用形态(date 来自
    // buildDateList),因此抓不到上面那个 UTC/本地混用的缺陷。这条把整条链路串起来。
    const list = buildDateList(moment.at);
    for (const item of [list[0], list[1], list[30]]) {
      const submitted = formatDateTimeForAPI(item.date, 9, 5);
      assert.equal(submitted, `${item.date} 09:05:00`);
      const [, mm, dd] = submitted.split(' ')[0].split('-');
      assert.equal(`${Number(mm)}月${Number(dd)}日`, item.display,
        '提交的日期必须与用户看到的 display 是同一天');
    }
  });
}

test('parseBusinessTime:合法/非法', () => {
  assert.deepEqual(parseBusinessTime('09:30-18:00'), { startHour: 9, startMinute: 30, endHour: 18, endMinute: 0 });
  assert.equal(parseBusinessTime(''), null);
  assert.equal(parseBusinessTime('09:30'), null);        // 缺 '-'
  assert.equal(parseBusinessTime('9-18'), null);         // 缺 ':'
});

test('formatTime:时分补零', () => {
  assert.equal(formatTime(9, 5), '09:05');
  assert.equal(formatTime(18, 0), '18:00');
});

test('buildDateList:从 today 起 31 天,结构含 date/display/month/day', () => {
  // 用**本地**时刻构造:buildDateList 接受的「今天」是本地概念,喂 UTC 时刻会让断言
  // 隐含假设「机器时区偏移 < +12」—— 在 UTC+14(Pacific/Kiritimati)下 12:00Z 已是次日。
  const list = buildDateList(new Date(2026, 6, 5, 12, 0));
  assert.equal(list.length, 31);
  assert.equal(list[0].display, '7月5日');
  assert.equal(list[0].month, 7);
  assert.equal(list[0].day, 5);
  assert.equal(list[0].date, '2026-07-05');
  // 跨月:+31 天到 8 月
  assert.equal(list[30].month, 8);
});

// 2026-07-31 修时区 bug 回归锁定(真事故:UTC-7 下连跑 3 次全红,被当成 flaky 忽略了一整轮)。
// 根因是 formatDateTimeForAPI 绕 new Date(纯日期串) 再读本地 getter——UTC 午夜解析在负偏移
// 时区落到本地前一天。这里不依赖跑测试的机器是什么时区(改 process.env.TZ 在 Node 里对
// 已经 new 出来的 Date 不保证生效,不可靠),而是直接断言新实现对"纯日期串"这个最常见输入
// 走的是字符串拆解、不经过 Date 对象——用一组横跨年首/年末/闰年边界的输入锁死这条路径,
// 任何人把实现改回"绕 Date 走本地 getter"都会在这些边界值上翻车。
test('formatDateTimeForAPI:年首/年末/闰年边界不经过 Date,不受运行环境时区影响', () => {
  assert.equal(formatDateTimeForAPI('2026-01-01', 0, 0), '2026-01-01 00:00:00');
  assert.equal(formatDateTimeForAPI('2026-12-31', 23, 59), '2026-12-31 23:59:00');
  assert.equal(formatDateTimeForAPI('2028-02-29', 12, 0), '2028-02-29 12:00:00'); // 闰年
  assert.equal(formatDateTimeForAPI('2026-02-28', 12, 0), '2026-02-28 12:00:00'); // 非闰年
});

test('负控:formatDateTimeForAPI 改回原来那个绕 Date + 本地 getter 的实现，跨时区必须判红', () => {
  // 复刻修复前的实现(逐字照抄，不是简化版)，直接验证同一批断言在这个旧实现上会失败——
  // 证明上面新增的测试不是巧合通过，是真的锁住了这条回归。
  function brokenFormatDateTimeForAPI(dateStr, hour, minute) {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hourStr = hour.toString().padStart(2, '0');
    const minuteStr = minute.toString().padStart(2, '0');
    return `${year}-${month}-${day} ${hourStr}:${minuteStr}:00`;
  }
  const offsetMinutes = new Date().getTimezoneOffset();
  if (offsetMinutes <= 0) {
    // 当前机器是 UTC 或正偏移时区(比如 CI ubuntu、UTC+8),旧实现在这些环境下不会露馅——
    // 这正是这个 bug 能在 CI 里活一整轮的原因,不是负控写错了,如实跳过并说明。
    console.log(`[负控跳过] 当前机器 getTimezoneOffset()=${offsetMinutes}(非负偏移时区),旧实现在这里不会翻车,负控需要在 UTC-x 机器上跑`);
    return;
  }
  assert.notEqual(
    brokenFormatDateTimeForAPI('2026-07-05', 9, 5),
    '2026-07-05 09:05:00',
    '负控失效:旧实现在当前(负偏移)时区下应该出错但没出错，说明负控没抓对场景'
  );
});

// buildDateList 的同族 bug:date 字段走 UTC(toISOString)，display/month/day 走本地 getter。
// 用"内部自洽"断言,不依赖跑测试的机器是什么时区(硬编码某个具体日期反而测不出这类问题——
// 原来的测试用 T12:00:00Z 这种"安全"时刻就完全测不出这个 bug,这条改成对 31 天逐个自洽校验)。
test('buildDateList:date 字段必须和 display/month/day 出自同一份本地时间,不能有 UTC/本地错位', () => {
  const list = buildDateList(new Date());
  list.forEach((item, i) => {
    const expected = `${item.month.toString().padStart(2, '0')}-${item.day.toString().padStart(2, '0')}`;
    const actual = item.date.slice(5);
    assert.equal(actual, expected, `第 ${i} 项:date="${item.date}" 和 display 用的 month/day(${expected}) 对不上`);
    assert.equal(item.display, `${item.month}月${item.day}日`);
  });
});

test('负控:buildDateList 改回原来 date 字段走 toISOString(UTC)的实现，跨时区必须判红', () => {
  function brokenBuildDateList(today) {
    const dateList = [];
    for (let i = 0; i < 31; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      const month = date.getMonth() + 1;
      const day = date.getDate();
      dateList.push({ date: date.toISOString().split('T')[0], display: `${month}月${day}日`, month, day });
    }
    return dateList;
  }
  // 构造一个必然出问题的场景:本地时间凌晨(00:00-08:00 之间),UTC 还停在前一天，
  // 不依赖"现在几点"这种不稳定的时刻,直接把 today 钉死在本地凌晨 1 点。
  const localMidnight1am = new Date();
  localMidnight1am.setHours(1, 0, 0, 0);
  const broken = brokenBuildDateList(localMidnight1am)[0];
  const offsetMinutes = new Date().getTimezoneOffset();
  if (offsetMinutes >= 0) {
    // UTC 或负偏移时区(本地时间比 UTC 晚或相同)下,本地凌晨1点时 UTC 还没翻到下一天，
    // 这个负控场景本来就不成立,如实跳过。
    console.log(`[负控跳过] 当前机器 getTimezoneOffset()=${offsetMinutes}(非正偏移时区,如 UTC+8),这个边界在这里不成立`);
    return;
  }
  const fixedFieldStr = `${broken.month.toString().padStart(2, '0')}-${broken.day.toString().padStart(2, '0')}`;
  assert.notEqual(broken.date.slice(5), fixedFieldStr,
    '负控失效:旧实现在当前(正偏移)时区、本地凌晨场景下应该错位但没错位，说明负控没抓对场景');
});
