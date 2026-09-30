const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildValidationBag } = require('../../pages/publish/utils/publish/publish-validation-bag.js');

// 这 100 行决定「一条路线能不能发出去」，此前零测试覆盖（埋在页面方法里、依赖 this.data）。
// 下面逐条钉住的都是「漏判就把脏数据放进生产」的规则。

const OK_TICKET = { name: '标准票', price: 10, startTime: '2026-09-01', endTime: '2026-09-02' };
const OK_NODE = { latitude: 31.2, longitude: 121.4 };

function base(over) {
  return Object.assign({
    formData: {
      name: '路线', description: '描述', startDate: '2026-09-01', endDate: '2026-09-02',
      imgUrl: '/a.png', productType: 1, tickets: [OK_TICKET],
      // description 是 pro-editor-policy.hasRealStory 认的「章节剧情」；
      // productType=1(城市定向)时它是必填，缺了会被登记成 chapterStory0。
      chapters: [{ description: '本章剧情', nodes: [OK_NODE] }],
    },
    selectedCategoryIds: [1],
    startDateTime: '2026-09-01 10:00',
    endDateTime: '2026-09-02 10:00',
  }, over || {});
}

const keys = (bag) => Object.keys(bag.errors || {});
function fieldsOf(state) { return keys(buildValidationBag(state)); }

test('齐全的表单不报错', () => {
  assert.deepEqual(fieldsOf(base()), []);
});

test('六项基础必填逐个缺失都要报', () => {
  const cases = {
    name: (f) => { f.name = ''; },
    description: (f) => { f.description = ''; },
    imgUrl: (f) => { f.imgUrl = ''; },
    startDate: (f) => { f.startDate = ''; },
    endDate: (f) => { f.endDate = ''; },
  };
  for (const [field, mutate] of Object.entries(cases)) {
    const s = base(); mutate(s.formData);
    assert.ok(fieldsOf(s).includes(field), field + ' 缺失时必须报');
  }
  const noCat = base(); noCat.selectedCategoryIds = [];
  assert.ok(fieldsOf(noCat).includes('categoryIds'));
});

// CU-C-159:同一批缺项在「发布确认」层与字段内联回显里显示,而编辑器与同页
// 「自动检查已通过」清单(_buildPublishPassed)都称主题。缺项再叫「路线 ×」,
// 用户会以为要另找一条路线来填。逐条钉住名字,别让它悄悄改回去。
test('CU-C-159 主题级缺项称主题,不称路线', () => {
  const s = base();
  s.formData.name = ''; s.formData.description = ''; s.formData.imgUrl = '';
  s.selectedCategoryIds = [];
  const errors = buildValidationBag(s).errors;
  const expected = {
    name: '请填写主题名称',
    description: '请填写主题简介',
    imgUrl: '请上传主题封面',
    categoryIds: '请选择至少一个主题类别',
  };
  for (const [field, message] of Object.entries(expected)) {
    assert.equal(errors[field], message, `${field} 的缺项文案`);
    assert.ok(!errors[field].includes('路线'), `${field} 不能再称路线`);
  }
});

test('时间选择器停在占位文案时不算已选', () => {
  // ★ 这条容易漏：formData.startDate 有值，但 picker 还显示「开始时间」
  const s = base(); s.startDateTime = '开始时间';
  assert.ok(fieldsOf(s).includes('startDate'));
});

test('票价：空、负数分别报不同文案；0 是合法的免费票', () => {
  const empty = base(); empty.formData.tickets = [Object.assign({}, OK_TICKET, { price: '' })];
  assert.ok(fieldsOf(empty).includes('ticketPrice0'));

  const neg = base(); neg.formData.tickets = [Object.assign({}, OK_TICKET, { price: -1 })];
  const bag = buildValidationBag(neg);
  assert.ok(keys(bag).includes('ticketPrice0'));
  assert.match(JSON.stringify(bag.errors), /不能为负数/);

  const free = base(); free.formData.tickets = [Object.assign({}, OK_TICKET, { price: 0 })];
  assert.deepEqual(fieldsOf(free), [], '0 元票必须放行');
});

test('城市定向票(mode=1)要集合地点，普通票要起止日期', () => {
  const cityNoMeeting = base();
  cityNoMeeting.formData.tickets = [{ name: 'A', price: 1, mode: 1 }];
  assert.ok(fieldsOf(cityNoMeeting).includes('ticketMeeting0'));

  const plainNoDates = base();
  plainNoDates.formData.tickets = [{ name: 'A', price: 1 }];
  const f = fieldsOf(plainNoDates);
  assert.ok(f.includes('ticketStart0') && f.includes('ticketEnd0'));
});

test('多张票的错误按票序号分别登记，不互相覆盖', () => {
  const s = base();
  s.formData.tickets = [Object.assign({}, OK_TICKET, { price: -1 }), Object.assign({}, OK_TICKET, { name: '' })];
  const f = fieldsOf(s);
  assert.ok(f.includes('ticketPrice0'), '第 1 张票的价格错');
  assert.ok(f.includes('ticketName1'), '第 2 张票的名称错');
});

test('没有章节、章节没节点、节点没选地点，三种都要报', () => {
  const noChapter = base(); noChapter.formData.chapters = [];
  assert.ok(fieldsOf(noChapter).includes('chapters'));

  const emptyChapter = base(); emptyChapter.formData.chapters = [{ description: '本章剧情', nodes: [] }];
  assert.ok(fieldsOf(emptyChapter).includes('chapter0'));

  // ★ 这条是被专门补上的：原先只有「下一步」查坐标且只要求全局 ≥1 个，
  // 发布校验压根不查，于是能带着一堆没定位的节点发出去。
  const noCoords = base();
  noCoords.formData.chapters = [{ description: '本章剧情', nodes: [OK_NODE, { latitude: 0, longitude: 0 }] }];
  assert.ok(fieldsOf(noCoords).includes('chapter0'));
});

test('自由探索(productType=2)要招商截止日期，且不走通关节点数校验', () => {
  const s = base();
  s.formData.productType = 2;
  assert.ok(fieldsOf(s).includes('recruitDeadline'));

  s.formData.recruitDeadline = '2026-08-30';
  s.completionRuleMode = 'AT_LEAST';
  s.completionRequiredCount = 999;   // 越界，但自由探索模式不该走这条分支
  assert.equal(fieldsOf(s).includes('completionRule'), false);
});

test('AT_LEAST 通关节点数必须落在 1..节点总数', () => {
  const mk = (n) => { const s = base(); s.completionRuleMode = 'AT_LEAST'; s.completionRequiredCount = n; return s; };
  assert.ok(fieldsOf(mk(0)).includes('completionRule'), '0 越界');
  assert.ok(fieldsOf(mk(2)).includes('completionRule'), '超过节点总数(1)越界');
  assert.ok(fieldsOf(mk(1.5)).includes('completionRule'), '非整数不合法');
  assert.deepEqual(fieldsOf(mk(1)), [], '正好等于节点总数是合法的');
});

test('招商章节：品类、合作方式、权益价值、商家名额各自把关', () => {
  function recruit(over) {
    const s = base();
    s.formData.productType = 2;
    s.formData.recruitDeadline = '2026-08-30';
    s.formData.chapters = [Object.assign({
      description: '本章剧情', nodes: [OK_NODE],
      recruitEnabled: 1, categoryId: 3, termsMode: 'PERK', maxMerchant: 5,
    }, over || {})];
    return fieldsOf(s);
  }
  assert.deepEqual(recruit(), [], '配齐了不报');
  assert.ok(recruit({ categoryId: 0 }).includes('chapterRecruitCategory0'));
  assert.ok(recruit({ termsMode: 'OTHER' }).includes('chapterRecruitTerms0'));
  assert.ok(recruit({ perkMinValue: 0 }).includes('chapterRecruitPerkMin0'), '权益价值须 > 0');
  assert.ok(recruit({ maxMerchant: 128 }).includes('chapterRecruitMax0'), '名额上限 127');
  assert.ok(recruit({ maxMerchant: -1 }).includes('chapterRecruitMax0'));
  assert.deepEqual(recruit({ maxMerchant: 0 }), [], '0 个名额是合法的');
  assert.deepEqual(recruit({ perkMinValue: '' }), [], '权益价值留空 = 不限，合法');
  assert.deepEqual(recruit({ recruitEnabled: 0, categoryId: 0, termsMode: null, maxMerchant: null }), [],
    '没开招商的章节不走这组校验');
});

test('★ 分支图模拟是惰性的：图校验没过时不许跑 1000 轮模拟', () => {
  let simCalls = 0;
  const s = base();
  s.formData.routeMode = 'BRANCH_GRAPH';
  s.routeGraph = { nodes: [], edges: [] };   // 空图，validate 必不通过
  s.routeNodes = [];
  s.savedTicketOptions = [];
  s.routeSimulationReport = () => { simCalls += 1; return { releaseReady: true }; };

  const f = fieldsOf(s);
  assert.ok(f.includes('routeGraph'), '空的分支图必须报错');
  assert.equal(simCalls, 0, '图都没过就跑模拟 = 每次输入白跑 1000 轮');
});

test('非分支图模式完全不碰路线图入参', () => {
  let touched = false;
  const s = base();
  s.routeSimulationReport = () => { touched = true; return {}; };
  assert.deepEqual(fieldsOf(s), []);
  assert.equal(touched, false);
});

test('★负控：模块不碰 this / wx / setData', () => {
  const raw = require('node:fs').readFileSync(
    require('node:path').resolve(__dirname, '../../pages/publish/utils/publish/publish-validation-bag.js'), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.doesNotMatch(src, /\bthis\./);
  assert.doesNotMatch(src, /\bthat\./);
  assert.doesNotMatch(src, /\bwx\./);
  assert.doesNotMatch(src, /setData/);
});
