// 自由探索四玩法(估数 / 猜图 / 找东西 / 竞猜)在「节点配置页」的读写契约。
//
// 后端这四段在 d956f8ac1 那批就落了,但小程序侧一行都没有 —— 意味着商家
// **配不出来**:段名不在 SECTIONS 里,parse 走 extraKeys 原样透传,页面看不见也编辑不了。
// v5.1 那次的教训是同一个形状:名单少一段,那一段就在页面上静默消失。
//
// 下面钉三件事:
//   ① 四段读得出来、存得回去,一个字段都不掉;
//   ② 采用公共库模板时被服务端剥掉的秘密字段(答案 / 价格 / 坐标)不会被本地校验拦死;
//   ③ 每条规则都有负控 —— 构造该报错的配置,确认它真的报错。
//      只断言"合法配置通过"是假绿:校验器整个删掉也一样通过。
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../../pages/publish/utils/publish/advanced-game-config.js');

const FILLED = {
  estimate: {
    enabled: true, title: '这罐咖啡豆有多少颗', unit: '颗', reveal: '一共 480 颗,老板数了两遍。',
    min: 0, max: 999, answer: 480, tolerance: 50, xp: 100
  },
  /* 猜图:2026-09-10 改模型 —— 从「两两比价格」换成「几张图挑正确的那张」。
     用户拍板:猜图不是比价格。 */
  pricePair: {
    enabled: true, title: '哪一张是这家店的招牌', xp: 30, maxTries: 2,
    items: [
      { id: 'pic_1', name: '冰美式', imageUrl: '/static/a.png', correct: false },
      { id: 'pic_2', name: '燕麦拿铁', correct: true },
      { id: 'pic_3', name: '单一产地手冲', imageUrl: 'https://cdn.example.com/c.png', correct: false }
    ]
  },
  hiddenObject: {
    enabled: true, title: '找出藏在店里的三只猫', hint: '窗台、书架、收银台后面', imageUrl: '/static/shop.png', xp: 80,
    hotspots: [
      /* r 写系统值:2026-09-11 起半径不由商家填,normalize 一律盖成 0.08。
         这里写别的值会被盖掉,那不是「字段掉了」,是这条规则本身。 */
      { id: 'c1', label: '窗台上的橘猫', x: 0.2, y: 0.24, r: 0.08 },
      { id: 'c2', label: '书架旁的狸花', x: 0.72, y: 0.44, r: 0.08 },
      { id: 'c3', label: '收银台后的黑猫', x: 0.44, y: 0.79, r: 0.08 }
    ]
  },
  predict: {
    enabled: true, question: '猜猜今天哪款卖得最多', hint: '明早由商家给出答案', closeAtHour: 20, xp: 30,
    options: [{ key: 'a', label: '冰美式' }, { key: 'b', label: '燕麦拿铁' }, { key: 'c', label: '单一产地手冲' }]
  }
};

function filled(only) {
  const model = config.defaultConfig();
  (only ? [only] : Object.keys(FILLED)).forEach((key) => {
    model[key] = JSON.parse(JSON.stringify(FILLED[key]));
  });
  return model;
}

test('四段都在 SECTIONS 名单里 —— 少一段那段就在页面上静默消失', () => {
  ['estimate', 'pricePair', 'hiddenObject', 'predict'].forEach((key) => {
    assert.ok(config.SECTIONS.indexOf(key) >= 0, `${key} 不在 SECTIONS 里`);
    assert.ok(config.defaultConfig()[key], `${key} 没有默认值 —— parse 会在 Object.assign(undefined) 上抛`);
  });
});

test('四段读得出来、存得回去,一个字段都不掉', () => {
  const serialized = config.serialize(filled());
  const parsed = config.parse(serialized);
  assert.equal(parsed.error, '');
  Object.keys(FILLED).forEach((section) => {
    const back = parsed.value[section];
    assert.equal(back.enabled, true, `${section} 的 enabled 掉了`);
    Object.keys(FILLED[section]).forEach((field) => {
      assert.deepEqual(back[field], FILLED[section][field], `${section}.${field} 对不上`);
    });
  });
});

test('只启用这四段中的一段,serialize 也不能返回空串', () => {
  // v5.1 的病灶复现:enabledSections 数出 0 段 → 存空串 → 节点退化成纯到达打卡
  Object.keys(FILLED).forEach((section) => {
    const out = config.serialize(filled(section));
    assert.notEqual(out, '', `只配了 ${section} 却存成了空串`);
    assert.ok(JSON.parse(out)[section].enabled, `${section} 没被序列化出去`);
  });
});

test('猜图的正确答案是布尔,存回去只留一张为真', () => {
  const model = filled('pricePair');
  const out = JSON.parse(config.serialize(model));
  assert.equal(out.pricePair.items[1].correct, true);
  assert.equal(out.pricePair.items[0].correct, false);
  assert.equal(out.pricePair.items.filter((it) => it.correct).length, 1);
});

test('空的图片地址不能存成空串 —— 服务端会判成「格式不对」而不是「没填」', () => {
  const model = filled('pricePair');
  model.pricePair.items[0].imageUrl = '   ';
  const out = JSON.parse(config.serialize(model));
  assert.ok(!('imageUrl' in out.pricePair.items[0]), 'imageUrl 应该被删键而不是留空串');
});

test('采用公共库模板:被服务端剥掉的答案/价格/坐标不能被本地校验拦死', () => {
  // AdvancedGamePublicProjection 剥掉 estimate.answer+tolerance、pricePair items[].price、
  // hotspot 的 x/y/r。发布时 TemplatePublishServiceImpl#backfillAdoptedSecrets 从源模板补回。
  const model = filled();
  delete model.estimate.answer;
  delete model.estimate.tolerance;
  // 采用场景:correct 被服务端剥掉了,本地不能因此判红
  model.pricePair.items.forEach((item) => { delete item.correct; });
  model.hiddenObject.hotspots.forEach((spot) => { delete spot.x; delete spot.y; delete spot.r; });
  assert.equal(config.validate(model, { adoptedFromLibrary: true }), '');
  // 负控:同样的配置在**自己新建**的场景必须报错,不然秘密字段永远填不填都行
  assert.notEqual(config.validate(model), '', '非采用场景也放行了 = 这道校验形同虚设');
});

// —— 负控:每条规则构造一个该报错的配置,确认它真的报错 ——
const NEGATIVE = [
  ['估数题干为空', 'estimate', m => { m.estimate.title = ''; }, '估数题干不能为空'],
  ['估数量程反了', 'estimate', m => { m.estimate.min = 999; m.estimate.max = 0; }, '估数量程的下限必须小于上限'],
  ['估数答案在量程外', 'estimate', m => { m.estimate.answer = 2000; }, '估数答案必须落在量程之内'],
  ['估数容差过半', 'estimate', m => { m.estimate.tolerance = 600; }, '估数容差不能超过量程的一半'],
  ['估数容差为 0', 'estimate', m => { m.estimate.tolerance = 0; }, '估数容差必须大于 0'],
  ['猜图不足 3 张', 'pricePair', m => { m.pricePair.items.pop(); }, '猜图的图片须为 3 至 8 张'],
  ['猜图 id 重复', 'pricePair', m => { m.pricePair.items[1].id = 'pic_1'; }, '猜图图片 id 不能重复'],
  ['猜图没有正确答案', 'pricePair', m => { m.pricePair.items[1].correct = false; }, '猜图必须指定且只指定一张正确答案'],
  ['猜图两张都对', 'pricePair', m => { m.pricePair.items[0].correct = true; }, '猜图必须指定且只指定一张正确答案'],
  ['猜图说明为空', 'pricePair', m => { m.pricePair.items[0].name = ''; }, '猜图图片说明不能为空'],
  ['猜图图地址不是 https', 'pricePair', m => { m.pricePair.items[0].imageUrl = 'http://x.com/a.png'; }, '猜图图片地址必须是 https 链接或站内路径'],
  ['找东西没有图', 'hiddenObject', m => { m.hiddenObject.imageUrl = ''; }, '找东西必须有一张图'],
  ['找东西目标不足 3 个', 'hiddenObject', m => { m.hiddenObject.hotspots.pop(); }, '找东西要标 3 至 5 个目标'],
  ['找东西坐标越界', 'hiddenObject', m => { m.hiddenObject.hotspots[0].x = 1.4; }, '找东西目标的坐标须为 0 到 1 之间的比例值'],
  ['找东西两个目标叠在一起', 'hiddenObject', m => {
    m.hiddenObject.hotspots[1].x = m.hiddenObject.hotspots[0].x;
    m.hiddenObject.hotspots[1].y = m.hiddenObject.hotspots[0].y;
  }, '找东西的两个目标挨得太近,请把它们分开一些'],
  ['竞猜问题为空', 'predict', m => { m.predict.question = ''; }, '竞猜问题不能为空'],
  ['竞猜只有一个选项', 'predict', m => { m.predict.options = [{ key: 'a', label: '只有一个' }]; }, '竞猜选项须为 2 至 4 个'],
  ['竞猜选项 key 重复', 'predict', m => { m.predict.options[1].key = 'a'; }, '竞猜选项 key 不能重复'],
  ['竞猜截止小时越界', 'predict', m => { m.predict.closeAtHour = 24; }, '竞猜截止时间须为 0 到 23 点之间的整点'],
  ['竞猜选项文案为空', 'predict', m => { m.predict.options[0].label = ''; }, '竞猜选项文案不能为空']
];

NEGATIVE.forEach(([name, section, mutate, expected]) => {
  test(`负控:${name} 必须报错`, () => {
    const ok = filled(section);
    assert.equal(config.validate(ok), '', `${section} 的合法配置本身就报错了,这条负控不成立`);
    const bad = filled(section);
    mutate(bad);
    // 断言错在**哪一条**,不只是"报了个错" —— 只断言非空,任何别的原因报错都会误绿
    assert.equal(config.validate(bad), expected);
  });
});

test('未启用的段不参与校验 —— 填了一半的草稿不能因此存不下去', () => {
  const model = config.defaultConfig();
  model.estimate.title = '';        // 空题干,但整段没启用
  model.hiddenObject.imageUrl = '';
  assert.equal(config.validate(model), '');
});

// —— 宾果九宫格(主题级 complete_rule_json)——
//
// 九格的点亮条件是服务端内置的、跨节点的,商家零输入;这份配置里只有「名称 + 奖励」。
// 之前做过一版把每格绑到一个 nodeId,那让配置只能在那一个主题里用 —— 已经拆掉。
// 下面钉三件事:与 nodeCompletion 共存不互相踩、往返不掉字段、空值删键而不是留空串。
const BINGO_FULL = () => config.BINGO_DEFAULT_LABELS.map((label, i) => ({
  label, couponId: i === 0 ? 77 : 0, feedbackText: i === 1 ? '再来一杯' : ''
}));

test('九宫格与 nodeCompletion 共存,互相不踩', () => {
  const base = config.mergeTopicCompletion('', 'AT_LEAST', 3);
  const merged = config.mergeTopicBingo(base, { enabled: true, cells: BINGO_FULL() });
  const root = JSON.parse(merged);
  assert.equal(root.nodeCompletion.mode, 'AT_LEAST');
  assert.equal(root.nodeCompletion.requiredCount, 3);
  assert.equal(root.bingo.cells.length, 9);
  // 反过来再合一次通关规则,九宫格也不能被冲掉
  const again = JSON.parse(config.mergeTopicCompletion(merged, 'ALL', 1));
  assert.ok(again.bingo, '合并通关规则把九宫格冲掉了');
});

test('九格往返不掉字段', () => {
  const raw = config.mergeTopicBingo('', { enabled: true, cells: BINGO_FULL() });
  const back = config.parseTopicBingo(raw);
  assert.equal(back.enabled, true);
  assert.equal(back.cells.length, 9);
  assert.equal(back.cells[0].couponId, 77);
  assert.equal(back.cells[1].feedbackText, '再来一杯');
  assert.equal(back.cells[8].label, config.BINGO_DEFAULT_LABELS[8]);
});

test('没配的券和文案要删键,不能留 0 和空串', () => {
  const root = JSON.parse(config.mergeTopicBingo('', { enabled: true, cells: BINGO_FULL() }));
  assert.deepEqual(Object.keys(root.bingo.cells[2]), ['label'], '空奖励应该只剩 label');
});

test('关掉九宫格要删键,不是留 enabled:false', () => {
  const on = config.mergeTopicBingo('', { enabled: true, cells: BINGO_FULL() });
  const off = JSON.parse(config.mergeTopicBingo(on, { enabled: false }));
  assert.ok(!('bingo' in off), '关掉后还留着 bingo 键,会让人以为还配着');
});

test('S 形序覆盖九格且不重不漏 —— 存错序等于九格的奖全对错格子', () => {
  assert.equal(config.BINGO_S_ORDER.length, 9);
  assert.deepEqual([...config.BINGO_S_ORDER].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(config.BINGO_S_ORDER, [0, 1, 2, 5, 4, 3, 6, 7, 8]);
});

const BINGO_NEGATIVE = [
  ['九格一个奖都没配', cells => cells.forEach((c) => { c.couponId = 0; c.feedbackText = ''; }),
    '至少给一格配上奖励，否则开着九宫格和不开没区别'],
  ['格子名称超长', cells => { cells[0].label = '一'.repeat(25); }, '宾果格子名称不能超过 24 字'],
  ['奖励文案超长', cells => { cells[0].feedbackText = '一'.repeat(121); }, '宾果格子奖励文案不能超过 120 字']
];
BINGO_NEGATIVE.forEach(([name, mutate, expected]) => {
  test(`负控:九宫格 ${name} 必须报错`, () => {
    assert.equal(config.validateTopicBingo({ enabled: true, cells: BINGO_FULL() }), '',
      '合法的九格本身就报错了,这条负控不成立');
    const cells = BINGO_FULL();
    mutate(cells);
    assert.equal(config.validateTopicBingo({ enabled: true, cells }), expected);
  });
});

test('九宫格没开就不校验 —— 关着的时候不该拦住发布', () => {
  assert.equal(config.validateTopicBingo({ enabled: false, cells: [] }), '');
});

/* 2026-09-11 改口径:半径不再由商家填(原型「不填坐标、不填判定半径」),
   所以「半径过小要报错」这条负控在客户端已经构造不出来 —— normalize 会把任何值
   覆盖成系统值。判据改成「覆盖」本身,坏掉(放商家的值过去)照样红。
   服务端那道 0.03–0.15 的闸仍在,由 AdvancedGameConfigValidatorTest 盯着。 */
test('★找东西的判定半径由系统定,商家填什么都盖掉', () => {
  const m = config.defaultConfig()
  m.hiddenObject.enabled = true
  m.hiddenObject.title = '找猫'
  m.hiddenObject.imageUrl = 'https://x.com/a.png'
  m.hiddenObject.hotspots = [
    { id: 'a', label: '橘猫', x: 0.2, y: 0.2, r: 0.001 },
    { id: 'b', label: '白猫', x: 0.7, y: 0.7, r: 9 },
    { id: 'c', label: '黑猫', x: 0.4, y: 0.95 },
  ]
  const back = config.parse(config.serialize(m)).value
  const radii = back.hiddenObject.hotspots.map(spot => spot.r)
  assert.deepEqual(radii, [0.08, 0.08, 0.08], '商家给的半径必须被系统值盖掉')
})
