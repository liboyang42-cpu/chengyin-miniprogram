// 采用公共库模板时「被剥掉的秘密字段」的读写契约(2026-08-27)。
//
// 服务端 AdvancedGamePublicProjection 对非 owner 剥掉 blindTaste.answerKey 与
// dailySign.poems(答案与签文池不下发,防作弊/防剧透)。于是商家从货架采用
// 「闭眼味觉师」「今日城市签」时,本地拿到的配置这两个字段必然是空的。
// 这份契约钉三件事:
//   1) parse 不许拿默认值 'A' 顶上被剥掉的 answerKey —— 那会把别人的题
//      静默改成「答案永远是 A」并原样发布,零报错;
//   2) 采用场景(adoptedFromLibrary)下,空 answerKey / 空 poems 放行,
//      发布后由服务端 TemplatePublishServiceImpl#backfillAdoptedSecrets 从源模板补回;
//   3) 这个口子只对「空值」开:答案填错(不在选项里)照样拦,非采用场景照样拦。
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../../pages/publish/utils/publish/advanced-game-config.js');

// 与 AdvancedGamePublicProjection.copyBlindTaste / copyDailySign 的输出同形:
// options 保留 key+label,answerKey 整个键不存在;dailySign 只剩 signer/sealText。
const STRIPPED = JSON.stringify({
  schemaVersion: 1,
  blindTaste: {
    enabled: true, title: '闭上眼 先尝再猜', xp: 15,
    options: [{ key: 'A', label: '桂花乌龙' }, { key: 'B', label: '茉莉雪芽' }],
  },
  dailySign: { enabled: true, signer: '猫向导', sealText: '城瘾' },
});

test('parse 不许给被剥掉的 answerKey 填默认值 A —— 那是别人的题,答案未必是 A', () => {
  const read = config.parse(STRIPPED);
  assert.equal(read.error, '');
  assert.equal(read.value.blindTaste.answerKey, '',
    '被剥掉的 answerKey 必须留空等服务端补回,不能静默变成 A');
  assert.deepEqual(read.value.dailySign.poems, [], '被剥掉的签文池读出来必须是空数组');
});

test('负控:自己从零配盲品时 answerKey 仍默认 A,创建流程不受采用逻辑波及', () => {
  assert.equal(config.defaultConfig().blindTaste.answerKey, 'A');
  // 显式写了 answerKey 的配置(owner 编辑回填)原样保留
  const owned = config.parse(JSON.stringify({
    schemaVersion: 1,
    blindTaste: { enabled: true, title: 't', options: [{ key: 'A', label: 'a' }, { key: 'B', label: 'b' }], answerKey: 'B' },
  }));
  assert.equal(owned.value.blindTaste.answerKey, 'B');
});

test('采用场景:空 answerKey / 空签文池放行(服务端发布时补回),不采用则照旧拦死', () => {
  const model = config.parse(STRIPPED).value;

  // 非采用场景(白手起家/owner 编辑):两条必填照旧红
  assert.match(config.validate(model), /盲品正确答案/);

  // 采用场景:两个被剥掉的空值都放行
  assert.equal(config.validate(model, { adoptedFromLibrary: true }), '');
  const written = config.serialize(model, { adoptedFromLibrary: true });
  const out = JSON.parse(written);
  assert.equal(out.blindTaste.answerKey, '', '序列化必须保留空 answerKey 让服务端识别并补回');
  assert.deepEqual(out.dailySign.poems, [], '序列化必须保留空签文池让服务端识别并补回');
});

test('采用场景的口子只对空值开:答案填错、签文超限照样拦', () => {
  const wrongKey = config.parse(STRIPPED).value;
  wrongKey.blindTaste.answerKey = 'Z';   // 不在选项里
  assert.match(config.validate(wrongKey, { adoptedFromLibrary: true }), /盲品正确答案/,
    'adoptedFromLibrary 不是校验豁免牌:填了但填错必须报');

  const tooMany = config.parse(STRIPPED).value;
  tooMany.dailySign.poems = Array.from({ length: 61 }, () => ['一行']);
  assert.match(config.validate(tooMany, { adoptedFromLibrary: true }), /1 至 60 条/);
});
