const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE_PATH = path.join(__dirname, '../../pages/merchant/decor/perks/index.js');
const WXML_PATH = path.join(__dirname, '../../pages/merchant/decor/perks/index.wxml');

function loadPage() {
  const oldGetApp = global.getApp;
  const oldPage = global.Page;
  const oldWx = global.wx;
  const requests = [];
  let definition;
  global.getApp = () => ({
    globalData: { navBarHeight: 44 },
    sendRequest(options) { requests.push(options); },
  });
  global.Page = (page) => { definition = page; };
  global.wx = { showToast() {} };
  delete require.cache[require.resolve(PAGE_PATH)];
  require(PAGE_PATH);
  return {
    definition,
    requests,
    restore() {
      if (oldGetApp === undefined) delete global.getApp; else global.getApp = oldGetApp;
      if (oldPage === undefined) delete global.Page; else global.Page = oldPage;
      if (oldWx === undefined) delete global.wx; else global.wx = oldWx;
      delete require.cache[require.resolve(PAGE_PATH)];
    },
  };
}

function contextOf(definition, form) {
  return {
    data: {
      ...definition.data,
      form: { ...definition.data.form, ...form },
    },
    setData(update, callback) {
      Object.entries(update).forEach(([key, value]) => {
        if (key.startsWith('form.')) this.data.form[key.slice(5)] = value;
        else this.data[key] = value;
      });
      if (callback) callback();
    },
  };
}

test('常备权益只有名称、正数零售价和正整数份数齐全才允许保存', () => {
  const loaded = loadPage();
  try {
    const valid = contextOf(loaded.definition, { name: '咖啡兑换券', retailValue: '88.00', quota: '20' });
    loaded.definition.refreshSaveState.call(valid);
    assert.equal(valid.data.canSave, true);

    for (const invalid of [
      { name: '咖啡兑换券', retailValue: '', quota: '20' },
      { name: '咖啡兑换券', retailValue: '0', quota: '20' },
      { name: '咖啡兑换券', retailValue: '88', quota: '0' },
      { name: '咖啡兑换券', retailValue: '88', quota: '1.5' },
      { name: '咖啡兑换券', retailValue: '88', unitCost: '-1', quota: '20' },
      { name: '咖啡兑换券', retailValue: '100000000', quota: '20' },
      { name: '咖啡兑换券', retailValue: '88.001', quota: '20' },
      { name: '咖啡兑换券', retailValue: '88', unitCost: '1.001', quota: '20' },
    ]) {
      const page = contextOf(loaded.definition, invalid);
      loaded.definition.refreshSaveState.call(page);
      assert.equal(page.data.canSave, false, JSON.stringify(invalid));
    }
  } finally {
    loaded.restore();
  }
});

test('历史缺零售价、份数或类型的模板明确标记为失效并给出下一步', () => {
  const loaded = loadPage();
  try {
    const page = contextOf(loaded.definition, {});
    loaded.definition.load.call(page);
    loaded.requests[0].success({ code: 200, data: [
      { id: 1, name: '旧礼品', perkType: 0, retailValue: null, quota: null },
      { id: 2, name: '咖啡', perkType: 1, retailValue: 88, quota: 20 },
    ] });
    assert.equal(page.data.perks[0].usable, false);
    assert.equal(page.data.perks[1].usable, true);
    const wxml = fs.readFileSync(WXML_PATH, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    assert.match(wxml, /已失效 · 请重新添加/);
    assert.doesNotMatch(wxml, /需删除重建/, '页面可见文案不能使用商家看不懂的内部术语');
  } finally {
    loaded.restore();
  }
});

test('保存请求把权益零售价和可接待份数送到后端', () => {
  const loaded = loadPage();
  try {
    const page = contextOf(loaded.definition, {
      name: '咖啡兑换券', retailValue: '88.00', unitCost: '20.50', quota: '20', validEnd: '2026-12-31',
    });
    page.data.canSave = true;
    loaded.definition.save.call(page);
    assert.equal(loaded.requests.length, 1);
    const payload = JSON.parse(loaded.requests[0].data);
    assert.equal(payload.retailValue, 88);
    assert.equal(payload.unitCost, 20.5);
    assert.equal(payload.quota, 20);
  } finally {
    loaded.restore();
  }
});

test('表单和列表明确区分玩家看到的零售价与商家成本', () => {
  const wxml = fs.readFileSync(WXML_PATH, 'utf8');
  assert.match(wxml, /权益零售价（必填）/);
  assert.match(wxml, /可接待份数（必填）/);
  assert.match(wxml, /成本价（可选，仅自己可见）/);
  assert.match(wxml, /item\.retailValue/);
});

test('负控：去掉零售价字段或把份数改回可选会判红', () => {
  const wxml = fs.readFileSync(WXML_PATH, 'utf8');
  assert.throws(() => assert.match(wxml.replace(/权益零售价（必填）/g, '单价（可选）'), /权益零售价（必填）/));
  assert.throws(() => assert.match(wxml.replace(/可接待份数（必填）/g, '库存（可选）'), /可接待份数（必填）/));
});

test('负控：失效权益退回内部术语时，可见文案契约会判红', () => {
  const wxml = fs.readFileSync(WXML_PATH, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const mutated = wxml.replace('已失效 · 请重新添加', '需删除重建');
  assert.notEqual(mutated, wxml, '负控锚点失效');
  assert.throws(() => assert.match(mutated, /已失效 · 请重新添加/), assert.AssertionError);
});
