// v5.1 七段新玩法在「节点配置页」的读写契约(2026-08-27)。
//
// 起因是一个静默丢数据的线上缺陷:advanced-game-config 只认 timer/random/branch/
// leaderboard/multiplayer 五段,parse() 从 defaultConfig() 起底后只 copy 这五个 key,
// serialize() 又只输出模型本身 —— 于是商家从货架采用「闭眼味觉师」,进配置页
// **随便存一次**,blindTaste 整段就没了;更糟的是当模板只有这一段时,
// enabledSections 数出 0 段,serialize 返回空串,advancedConfigJson 被清成空,
// 节点当场退化成纯到达打卡。
//
// 下面的用例就钉这两件事:七段读得出来、存得回去,一个字段都不许掉。
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../../pages/publish/utils/publish/advanced-game-config.js');

// 与 migration_seed_merchant_game_v51_20260827.sql 落库的七款商家游戏同形。
// ⚠️ 改这里之前先确认服务端 AdvancedGameConfigValidator 也接受新形状。
const SEEDED = {
  blindTaste: {
    enabled: true, title: '闭上眼 先尝再猜', steps: '① 领小样 ② 闭眼尝 ③ 睁眼作答',
    hint: '别偷看 舌头比眼睛诚实', xp: 15,
    options: [{ key: 'A', label: '桂花乌龙' }, { key: 'B', label: '茉莉雪芽' },
      { key: 'C', label: '蜜桃红茶' }, { key: 'D', label: '陈皮白茶' }],
    answerKey: 'B',
  },
  silentOrder: { enabled: true, title: '不说一个字 让店员猜中你要什么', rule: '开口即失败。', limitSeconds: 600 },
  diyName: { enabled: true, title: '拍好了 给它起个名字', maxLength: 16, suggestions: ['熬夜特调', '便利店之光'] },
  musicCorner: { enabled: true, title: '坐下来 这一站只用耳朵', trackName: '店主的歌单', durationSeconds: 206 },
  timeWindow: { enabled: true, eyebrow: '午夜电台 · 时段限定', title: '还没到开播时间', openFrom: '23:00', openTo: '01:00' },
  steps: { enabled: true, eyebrow: '低碳行动 · 今日步数', goal: 6000, xp: 20 },
  dailySign: {
    enabled: true, signer: '猫向导', sealText: '城瘾',
    poems: [['这座城市今晚会把', '一条没走过的巷子', '悄悄留给你'], ['今天适合走慢一点', '该遇见的东西']],
  },
};

for (const [section, payload] of Object.entries(SEEDED)) {
  test(`${section}:货架模板读进配置页再存回去，一个字段都不掉`, () => {
    const raw = JSON.stringify({ schemaVersion: 1, [section]: payload });

    const read = config.parse(raw);
    assert.equal(read.error, '', '既有模板必须能无错读出');
    // 读出来的是**编辑模型**:会比落库的多几个空默认值(输入框要有可绑定的初值,
    // 例如 musicCorner.audioUrl='')。所以这里只钉「原有字段一个不少、一个没改」,
    // 多出来的空默认值由 serialize 负责删键(见下面的清洗用例)。
    for (const [field, value] of Object.entries(payload)) {
      assert.deepEqual(read.value[section][field], value, `${section}.${field} 读进来就被改形了`);
    }

    const written = config.serialize(read.value);
    assert.notEqual(written, '', '只配了这一段也是配了 —— 不能被当成空配置清空');
    assert.deepEqual(JSON.parse(written)[section], payload, `${section} 存回去掉字段了`);
  });
}

test('七段各自的 enabled 都能被 enabledSections 数到', () => {
  for (const section of Object.keys(SEEDED)) {
    const model = config.defaultConfig();
    model[section].enabled = true;
    assert.ok(config.enabledSections(model).includes(section),
      `${section} 没被数进已启用段 —— serialize 会把它当成空配置`);
  }
});

test('本模块不认识的将来玩法段也原样透传，不被吞掉', () => {
  // 服务端先上一个新机制、小程序还没跟上时,商家在配置页存一次不该把它删掉。
  const raw = '{"schemaVersion":1,"woodFish":{"enabled":true,"taps":108},"blindTaste":{"enabled":false}}';
  const read = config.parse(raw);
  const written = config.serialize(read.value);
  assert.deepEqual(JSON.parse(written).woodFish, { enabled: true, taps: 108 });
});

test('负控:退回只认五段的旧实现必须判红', () => {
  // 旧实现等价于「parse 只 copy CORE_SECTIONS」。这里直接模拟那个行为,
  // 确认上面的用例真的能抓住它,而不是恒绿。
  const raw = JSON.stringify({ schemaVersion: 1, blindTaste: SEEDED.blindTaste });
  const source = JSON.parse(raw);
  const legacy = config.defaultConfig();
  config.CORE_SECTIONS.forEach((key) => {
    if (source[key]) legacy[key] = Object.assign(legacy[key], source[key]);
  });
  assert.notDeepEqual(legacy.blindTaste, SEEDED.blindTaste, '负控失效：旧实现居然也保住了 blindTaste');
  assert.equal(config.serialize(legacy), '', '负控失效：旧实现居然没有把整段清空');
});

test('校验文案与服务端对齐，错误在本页就说清楚而不是等后端 500', () => {
  const cases = [
    ['blindTaste', { enabled: true, title: '', options: [{ key: 'A', label: 'x' }, { key: 'B', label: 'y' }], answerKey: 'A', xp: 0 }, /盲品标题/],
    ['blindTaste', { enabled: true, title: 't', options: [{ key: 'A', label: 'x' }, { key: 'B', label: 'y' }], answerKey: 'Z', xp: 0 }, /正确答案/],
    ['blindTaste', { enabled: true, title: 't', options: [{ key: 'A', label: 'x' }], answerKey: 'A', xp: 0 }, /2 至 6 项/],
    ['timeWindow', { enabled: true, openFrom: '25:00', openTo: '01:00' }, /24 小时制/],
    ['timeWindow', { enabled: true, openFrom: '23:00', openTo: '23:00' }, /起止不能相同/],
    ['silentOrder', { enabled: true, title: 't', limitSeconds: 30 }, /60 秒至 1 小时/],
    ['diyName', { enabled: true, title: 't', maxLength: 100 }, /2 至 40 字/],
    ['musicCorner', { enabled: true, title: 't', audioUrl: 'http://x.com/a.mp3', durationSeconds: 0 }, /https/],
    ['steps', { enabled: true, goal: 5 }, /100 至 100000/],
    ['dailySign', { enabled: true, poems: [] }, /1 至 60 条/],
    ['dailySign', { enabled: true, poems: [['a', 'b', 'c', 'd', 'e']] }, /1 至 4 行/],
  ];
  for (const [section, payload, pattern] of cases) {
    const model = config.defaultConfig();
    model[section] = payload;
    assert.match(config.validate(model), pattern, `${section} 的这条约束没有在本页拦住`);
  }
});

test('存盘前清洗:服务端把「空串」判错而不是当没填，所以空值必须删键', () => {
  const model = config.defaultConfig();
  // 音乐角留空的曲目地址:服务端 optionalMediaUrl 见到空串会抛「必须是 https 链接」
  model.musicCorner = { enabled: true, title: '只用耳朵', trackName: '', audioUrl: '', durationSeconds: 0 };
  // 备选名里留空行:服务端要求每个备选都非空
  model.diyName = { enabled: true, title: '起个名字', maxLength: 16, suggestions: ['熬夜特调', '  ', ''] };
  // 签文里留空行
  model.dailySign = { enabled: true, signer: '', sealText: '', poems: [['第一行', '', '  '], []] };

  const out = JSON.parse(config.serialize(model));
  assert.ok(!('audioUrl' in out.musicCorner), '空的曲目地址必须删键，不能留空串');
  assert.ok(!('trackName' in out.musicCorner), '空的曲目名必须删键');
  assert.deepEqual(out.diyName.suggestions, ['熬夜特调'], '空备选必须被清掉');
  assert.deepEqual(out.dailySign.poems, [['第一行']], '空行与空签文必须被清掉');
  assert.ok(!('signer' in out.dailySign), '空落款必须删键');
});

test('未启用的段保留用户填了一半的内容，不被清洗顺手抹掉', () => {
  const model = config.defaultConfig();
  model.blindTaste.enabled = false;
  model.blindTaste.title = '还没想好的标题';
  model.timer.enabled = true;
  const out = JSON.parse(config.serialize(model));
  assert.equal(out.blindTaste.title, '还没想好的标题');
});
