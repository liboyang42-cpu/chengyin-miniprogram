const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../../pages/publish/utils/publish/advanced-game-config.js');
const catalog = require('../../pages/publish/utils/publish/node-game-catalog.js');
const preview = require('../../pages/publish/utils/publish/advanced-game-preview.js');
const { pickPlayKit } = require('../../pages/play/utils/playkit-view.js');
const outcomes = require('../../pages/publish/utils/publish/node-outcome-contract.js');

test('D20 模板保存回填保留 DC、加值和优势模式，不要求六面任务', () => {
  const draft = catalog.applyToConfig(config.defaultConfig(), 'd20');
  assert.ok(draft, '模板目录必须能选到 D20');
  Object.assign(draft.diceRoll, { dc: '15', modifier: '-2', rollMode: 'advantage',
    successText: '发现暗门', failText: '绕路前往下一站' });
  assert.equal(config.validate(draft), '');
  const saved = config.normalize(draft);
  const restored = config.parse(JSON.stringify(saved)).value;
  assert.equal(catalog.detectGame(restored), 'd20');
  assert.equal(restored.diceRoll.dc, 15);
  assert.equal(restored.diceRoll.modifier, -2);
  assert.equal(restored.diceRoll.rollMode, 'advantage');
  assert.equal(restored.diceRoll.failText, '绕路前往下一站');
  assert.equal(catalog.detectGame(catalog.applyToConfig(restored, 'dice')), 'dice');
});

test('D20 预览按当前配置给固定样例，玩家只显示服务端结果，分支声明成功和失败', () => {
  const draft = catalog.applyToConfig(config.defaultConfig(), 'd20');
  Object.assign(draft.diceRoll, { dc: 15, modifier: 2, rollMode: 'disadvantage',
    successText: '成功文案', failText: '失败文案' });
  const kit = preview.buildPreviewKit(draft);
  assert.equal(kit.mode, 'd20');
  assert.equal(kit.result, null, '进入预览先展示规则，不直接展示结果');
  const sample = preview.previewD20Result(kit);
  assert.deepEqual(sample.values, [12, 7]);
  assert.equal(sample.kept, 7);
  assert.equal(sample.total, 9);
  assert.equal(sample.success, false);
  assert.equal(sample.text, '失败文案');
  const live = pickPlayKit({ playKit: { diceRoll: { enabled: true, mode: 'd20', dc: 15,
    modifier: 2, rollMode: 'normal', rolled: true, pips: [20], kept: 20, total: 22,
    success: false, action: '只认回执', awarded: true } } });
  assert.equal(live.result.success, false, '不能在客户端用骰点重判服务端结果');
  assert.equal(live.result.text, '只认回执');
  assert.deepEqual(outcomes.extract({ advancedConfigJson: JSON.stringify(draft) }).items
    .map((x) => x.code), ['D20_SUCCESS', 'D20_FAILURE']);
});

test('D20 拒绝空值、小数、越界与未知方式，六面骰仍要求六个任务', () => {
  const draft = catalog.applyToConfig(config.defaultConfig(), 'd20');
  Object.assign(draft.diceRoll, { successText: '成功', failText: '失败' });
  for (const patch of [{ dc: '' }, { dc: 1.5 }, { dc: 41 }, { modifier: '' },
    { modifier: 21 }, { modifier: -21 }, { rollMode: 'other' }, { failText: '' }]) {
    assert.ok(config.validate(Object.assign({}, draft, { diceRoll: Object.assign({}, draft.diceRoll, patch) })), JSON.stringify(patch));
  }
  assert.match(config.validate(catalog.applyToConfig(draft, 'dice')), /面不能为空/);
});

test('采用公开 D20 模板可留空已剥离的结果文案，其他校验仍生效', () => {
  const draft = catalog.applyToConfig(config.defaultConfig(), 'd20');
  Object.assign(draft.diceRoll, { successText: '', failText: '' });
  assert.equal(config.validate(draft, { adoptedFromLibrary: true }), '');
  assert.ok(config.validate(draft));
  draft.diceRoll.failText = '字'.repeat(201);
  assert.ok(config.validate(draft, { adoptedFromLibrary: true }));
});
