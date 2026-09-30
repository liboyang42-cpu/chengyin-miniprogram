const assert = require('node:assert/strict');
const test = require('node:test');

const COMPONENT_PATH = require.resolve('../../components/cy/stat-card/index.js');

function loadDefinition() {
  const prev = global.Component;
  let def;
  global.Component = (options) => { def = options; };
  delete require.cache[COMPONENT_PATH];
  require(COMPONENT_PATH);
  global.Component = prev;
  return def;
}

// 建一个最小实例:跑一次 observer,拿到它算出来的 _cards / _colStyle
function build(items, columns) {
  const def = loadDefinition();
  const instance = {
    data: JSON.parse(JSON.stringify(def.data)),
    setData(update) { Object.assign(this.data, update); },
  };
  const observer = def.observers['items, columns'];
  observer.call(instance, items, columns === undefined ? def.properties.columns.value : columns);
  return instance.data;
}

// ── 这条是整个组件最该被钉住的:0 是合法指标值,不是「没有数据」 ──
// 「今日 0 单」是要显示出来的事实。而 0 是 falsy,任何写成 value || '—' 的实现
// 都会把真实的 0 显示成占位符 —— 商家会以为是接口挂了。
test('value=0 必须显示成 0,不能被当成缺数据换成占位符', () => {
  const d = build([{ label: '今日订单', value: 0 }]);
  assert.equal(d._cards[0].value, '0');
  assert.equal(d._cards[0].missing, false);
});

test('value="0" 字符串零同样显示成 0', () => {
  const d = build([{ label: '今日订单', value: '0' }]);
  assert.equal(d._cards[0].value, '0');
  assert.equal(d._cards[0].missing, false);
});

// 真负控:直接改源码里的缺数据判定,确认上面那两条断言真的会红。
// (上一版这里只是本地写了个 lenient() 自证自话,源码怎么改都不影响它 —— 那种负控是假的。)
test('负控:把缺数据判定换成真值判断,0 的那两条断言必须判红', () => {
  const fs = require('node:fs'), path = require('node:path');
  const src = fs.readFileSync(path.resolve(__dirname, '../../components/cy/stat-card/index.js'), 'utf8');
  const mutated = src.replace(
    /const missing = raw === null[\s\S]*?\.trim\(\) === ''\);/,
    'const missing = !raw;'          // ← 常见的偷懒写法,0 会被误判成缺数据
  );
  assert.notEqual(mutated, src, '变异未生效,负控本身是假的');

  // 用变异后的源码跑一遍 observer
  const prev = global.Component; let def;
  global.Component = (o) => { def = o; };
  new Function('Component', 'module', mutated)(global.Component, { exports: {} });
  global.Component = prev;
  const inst = { data: JSON.parse(JSON.stringify(def.data)), setData(u){ Object.assign(this.data,u); } };
  def.observers['items, columns'].call(inst, [{ label: 'x', value: 0 }], 2);

  assert.equal(inst.data._cards[0].value, '—', '变异版确实把 0 弄成了占位符');
  assert.throws(() => assert.equal(inst.data._cards[0].value, '0'), '所以正向断言在变异版下会红');
});

test('真正没给值(null/undefined/空串)才算缺数据,显示 — 并标 missing', () => {
  [null, undefined, '', '   '].forEach((bad) => {
    const d = build([{ label: 'x', value: bad }]);
    assert.equal(d._cards[0].value, '—', `${JSON.stringify(bad)} 应判为缺数据`);
    assert.equal(d._cards[0].missing, true);
  });
});

test('数字与字符串都收,统一转成字符串给模板', () => {
  const d = build([{ label: 'a', value: 1234 }, { label: 'b', value: '¥1,234' }]);
  assert.equal(d._cards[0].value, '1234');
  assert.equal(d._cards[1].value, '¥1,234');
});

test('trend 不传就是空串(模板据此整块不渲染),不占位', () => {
  const d = build([{ label: 'a', value: 1 }, { label: 'b', value: 2, trend: '72% Used' }]);
  assert.equal(d._cards[0].trend, '');
  assert.equal(d._cards[1].trend, '72% Used');
});

test('tone 只认 danger/success,其余一律归 normal(挡住调用方拼错颜色名)', () => {
  assert.equal(build([{ label: 'a', value: 1, tone: 'danger' }])._cards[0].tone, 'danger');
  assert.equal(build([{ label: 'a', value: 1, tone: 'success' }])._cards[0].tone, 'success');
  ['', null, undefined, 'warning', 'DANGER', 'red', 123].forEach((bad) => {
    assert.equal(build([{ label: 'a', value: 1, tone: bad }])._cards[0].tone, 'normal',
      `tone=${JSON.stringify(bad)} 应回落 normal`);
  });
});

test('columns 决定网格列数,内联样式里给 repeat(n)', () => {
  assert.match(build([], 2)._colStyle, /repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(build([], 3)._colStyle, /repeat\(3,minmax\(0,1fr\)\)/);
});

test('columns 非法值回落到至少 1 列,不产出 repeat(0) 这种废样式', () => {
  [0, -5, NaN, null, undefined, 'abc'].forEach((bad) => {
    const s = build([], bad)._colStyle;
    assert.match(s, /repeat\([1-9]\d*,/, `columns=${JSON.stringify(bad)} 不该算出非正列数,得到 ${s}`);
  });
});

test('span 默认 1;传 2 可通栏;超过总列数按总列数封顶(不撑坏网格)', () => {
  const d = build([
    { label: 'a', value: 1 },
    { label: 'b', value: 2, span: 2 },
    { label: 'c', value: 3, span: 9 },   // 超了
  ], 2);
  assert.equal(d._cards[0].span, 1);
  assert.equal(d._cards[1].span, 2);
  assert.equal(d._cards[2].span, 2, 'span 应被总列数 2 封顶');
});

test('items 不是数组时不炸,产出空列表', () => {
  [null, undefined, 'abc', 123, {}].forEach((bad) => {
    assert.deepEqual(build(bad)._cards, [], `items=${JSON.stringify(bad)} 应得空列表`);
  });
});

test('每项缺 label 也不炸,label 归空串', () => {
  const d = build([{ value: 5 }, null]);
  assert.equal(d._cards[0].label, '');
  assert.equal(d._cards[1].label, '');
  assert.equal(d._cards[1].value, '—');
});

// ── 字号降档:实拍发现 2 列卡放不下「¥12,480.50」,只靠 ellipsis 会把金额截成「¥12,48…」。
// 指标卡要进的正是合作结算页,截断金额是不能接受的,所以长值降档。
test('长数值自动降字号,避免金额被截断', () => {
  assert.equal(build([{ label: 'a', value: 1286 }])._cards[0].sizeStep, 'lg', '短值用最大档');
  assert.equal(build([{ label: 'a', value: '¥8,900' }])._cards[0].sizeStep, 'lg');
  assert.equal(build([{ label: 'a', value: '¥12,480' }])._cards[0].sizeStep, 'md', '7 位进中档');
  assert.equal(build([{ label: 'a', value: '¥12,480.50' }])._cards[0].sizeStep, 'sm', '10 位必须进小档 —— 实拍证明 md 仍会被截');
  assert.equal(build([{ label: 'a', value: '999,999,999.99' }])._cards[0].sizeStep, 'sm');
});

// 阶梯必须严格递减。第一版把 sm 映射到 --cy-type-page-title(58rpx),
// 它比 md 的 --cy-type-display(56rpx)还大 —— 阶梯反着走,长值反而更放不下,
// 而且单测当时是绿的(只断言了档位名,没断言字号真的在变小)。这条补上那个缺口。
test('三档字号严格递减(lg > md > sm),不能出现越降越大', () => {
  const fs = require('node:fs'), path = require('node:path');
  const wxss = fs.readFileSync(path.resolve(__dirname, '../../components/cy/stat-card/index.wxss'), 'utf8');
  const tokens = fs.readFileSync(path.resolve(__dirname, '../../style/tokens.wxss'), 'utf8');
  const px = (step) => {
    const rule = wxss.match(new RegExp('\\.sc__value--' + step + '\\s*\\{[^}]*\\}'));
    assert.ok(rule, step + ' 档必须有字号规则');
    const tok = rule[0].match(/var\((--cy-type-[\w-]+)\)/);
    assert.ok(tok, step + ' 档必须走 type token');
    // Dynamic Type:字阶已包成 calc(NNrpx * var(--cy-type-scale)),这里取 scale=1 的基准值
    const decl = tokens.match(new RegExp(tok[1] + ':\\s*(?:calc\\()?(\\d+)rpx'));
    assert.ok(decl, tok[1] + ' 必须在 tokens.wxss 里有定义');
    return Number(decl[1]);
  };
  const lg = px('lg'), md = px('md'), sm = px('sm');
  assert.ok(lg > md, `lg(${lg}) 必须大于 md(${md})`);
  assert.ok(md > sm, `md(${md}) 必须大于 sm(${sm}) —— 第一版这里是 56 < 58,阶梯反了`);
});

test('缺数据的「—」按短值处理,不会因为降档逻辑变成怪尺寸', () => {
  assert.equal(build([{ label: 'a', value: null }])._cards[0].sizeStep, 'lg');
});

// ── 跨列改成内联样式后的覆盖 ──
// 旧实现用 .sc__card--spanN 类,而 wxss 里只写了 span2:
// columns=3 + span=3 会匹配不到任何类、静默塌回 1 列(不报错,最难查的那种)。
test('span>1 产出内联 grid-column,任意列数都成立(不再依赖逐个写死的类)', () => {
  const d = build([
    { label: 'a', value: 1 },
    { label: 'b', value: 2, span: 2 },
    { label: 'c', value: 3, span: 3 },
  ], 3);
  assert.equal(d._cards[0].spanStyle, '', 'span=1 不需要内联');
  assert.match(d._cards[1].spanStyle, /grid-column:\s*span 2/);
  assert.match(d._cards[2].spanStyle, /grid-column:\s*span 3/, 'span=3 也要有,旧实现这里是空的');
});

test('负控:wxss 里不该再留死的 .sc__card--spanN 类(改内联后它已无渲染方)', () => {
  const fs = require('node:fs'), path = require('node:path');
  const wxss = fs.readFileSync(path.resolve(__dirname, '../../components/cy/stat-card/index.wxss'), 'utf8');
  const wxml = fs.readFileSync(path.resolve(__dirname, '../../components/cy/stat-card/index.wxml'), 'utf8');
  assert.doesNotMatch(wxss, /\.sc__card--span\d/, 'wxss 仍有 spanN 类 = 改内联后没清干净');
  assert.doesNotMatch(wxml, /sc__card--span/, 'wxml 不该再拼 spanN 类名');
  assert.match(wxml, /style="\{\{item\.spanStyle\}\}"/, '跨列必须走内联');
});

// key 混用两种来源会撞:item0 传 key:1、item1 回落成下标 1,wx:key 相同 ⇒ WeChat 复用错节点。
test('key 给调用方 key 与回落下标分命名空间,不会互撞', () => {
  const d = build([{ label: 'a', value: 1, key: 1 }, { label: 'b', value: 2 }]);
  assert.notEqual(d._cards[0].key, d._cards[1].key, '两者必须不同');
  assert.equal(d._cards[0].key, 'k1');
  assert.equal(d._cards[1].key, 'i1');
});
