// ADA 处方 I 契约:「输入框聚焦态 2rpx 墨色边」必须真的能通电。
//
// 为什么要这组测试(两个真实缺陷,截图复核时抓到):
//  D1 publish/activity —— .is-focused 规则写在文件靠前处,后面的
//     `.fabu.theme-topic-editor .form .li .item-cont { border-color: ... }`
//     选择器权重完全相同(都是 5 个 class)、位置更靠后 ⇒ 后者恒胜,
//     聚焦边框永远画不出来。automator 实测:is-focused 类已挂上,
//     border-top-color 在聚焦前后都是 rgb(232,232,232),截图逐像素 diff = 0。
//  D2 merchantapply1 —— .is-focused 规则在 wxss 里,但 wxml 没有任何
//     bindfocus、js 没有 onFieldFocus/focusField ⇒ 这条规则永远匹配不到元素,
//     是一条死规则。「样式写了」不等于「聚焦态存在」。
//
// 这两类都不是逻辑 bug,单测里 require 不到,只能对源文件下静态契约。
//
// ⚠️ 契约必须咬住「真实通路」,不能只咬住「文本出现过」。上一版有两个假阳性,
// 已在临时副本上复现过:
//   · D1 只比「最后一条 .is-focused 规则」和「最后一条非聚焦规则」的先后,于是
//     删掉真正的 theme-topic-editor 聚焦规则、再在文件尾追加一条压根匹配不到
//     本页元素的 `.some-other-widget .item-cont.is-focused{...}`,测试照绿。
//     ⇒ 现在改为按 wxml 实证的元素 class 全集做一次层叠裁决:只有真能匹配到
//     该元素的规则才参与,胜者(权重优先、同权重后者胜)必须是聚焦规则。
//   · D2 只 grep 文件里有没有 `onFieldFocus` / `focusField` 字样,于是把
//     handler 体内的 setData 写入整条删掉(data 里仍留 `focusField: ''`),测试照绿。
//     ⇒ 现在改为逐个 input 追「bindfocus/bindblur → handler 函数体 → setData
//     里 focusField 的取值确实来自 event dataset」,并要求 wxml 里渲染的
//     focusField key 集合与 input 上声明的 key 集合完全相等。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '../../', p), 'utf8');

// 去掉注释后按 `选择器 { 声明 }` 粗切规则,返回 [{ selector, body, index }]
function parseRules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(clean)) !== null) {
    rules.push({ selector: m[1].trim(), body: m[2], index: m.index });
  }
  return rules;
}

const CLASS_RE = /\.[A-Za-z0-9_-]+/g;
const DEAD_VALUES = new Set(['', 'none', 'transparent', 'initial', 'inherit', 'unset', 'revert']);

// 取声明值(同一条规则里后写的赢)
function declValue(body, prop) {
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'g');
  let m;
  let last = null;
  while ((m = re.exec(body)) !== null) last = m[1].trim();
  return last;
}

// 「这条选择器会不会命中那个聚焦中的元素」——用 wxml 实证出来的祖先 class 全集判。
// 只支持纯 class + 后代空格的选择器;出现标签名/伪类/子代号等本模型解释不了的
// 写法一律判为「不参与」,宁可漏也不要假装裁决过。
function matchesElement(selector, elementClasses) {
  const classes = selector.match(CLASS_RE) || [];
  const residue = selector.replace(CLASS_RE, '').trim();
  if (residue !== '') return null;
  if (classes.length === 0) return null;
  if (!classes.every((c) => elementClasses.has(c.slice(1)))) return null;
  return classes.length; // 权重 = class 个数
}

// 收集所有「能命中该元素」且真的设了 border 的规则,按层叠顺序裁决
function borderCandidates(css, elementClasses) {
  const out = [];
  for (const rule of parseRules(css)) {
    const shorthand = declValue(rule.body, 'border');
    const color = declValue(rule.body, 'border-color');
    if (shorthand === null && color === null) continue;
    for (const sel of rule.selector.split(',')) {
      const trimmed = sel.trim();
      const spec = matchesElement(trimmed, elementClasses);
      if (spec === null) continue;
      out.push({
        selector: trimmed,
        spec,
        index: rule.index,
        isFocus: /\.is-focused\b/.test(trimmed),
        shorthand,
        color,
      });
    }
  }
  return out;
}

// 层叠胜者:权重高者胜,同权重后写者胜
function cascadeWinner(candidates) {
  return candidates.reduce((best, cur) => {
    if (best === null) return cur;
    if (cur.spec > best.spec) return cur;
    if (cur.spec === best.spec && cur.index > best.index) return cur;
    return best;
  }, null);
}

function colorOf(entry) {
  if (entry.color !== null) return entry.color;
  // `border: 2rpx solid X` —— 颜色取最后一段
  const parts = entry.shorthand.split(/\s+/);
  return parts[parts.length - 1];
}

test('D1 publish/activity:聚焦态边框必须是层叠里的胜者,而不是被后面同权重规则压回去', () => {
  const css = read('pages/publish/activity/index.wxss');
  const wxml = read('pages/publish/activity/index.wxml');

  // 元素模型取自 wxml 实证:根节点 class + 表单容器链。根 class 从文件里读,
  // 避免把 theme-topic-editor 这种主题 class 写死在测试里跟页面脱节。
  const rootMatch = /<view\s+class="([^"]+)"/.exec(wxml);
  assert.ok(rootMatch, 'publish/activity 根节点应带 class');
  const rootClasses = rootMatch[1].trim().split(/\s+/);
  assert.ok(
    rootClasses.includes('theme-topic-editor'),
    'publish/activity 根节点应挂 theme-topic-editor(D1 的覆盖块就挂在这个主题下)',
  );

  const elementClasses = new Set([
    ...rootClasses,
    'form', 'li', 'li2', 'item-cont', 'item-cont2', 'is-focused',
  ]);

  const candidates = borderCandidates(css, elementClasses).filter((c) => /\.item-cont2?\b/.test(c.selector));
  const focus = candidates.filter((c) => c.isFocus);
  const plain = candidates.filter((c) => !c.isFocus);

  assert.ok(
    focus.length > 0,
    '缺少能命中本页聚焦元素的 .item-cont.is-focused 边框规则'
    + `(命中该元素的边框规则:${candidates.map((c) => c.selector).join(' | ') || '无'})`,
  );
  assert.ok(plain.length > 0, 'publish/activity 应有非聚焦态的 .item-cont 边框基线规则');

  const winner = cascadeWinner(candidates);
  assert.ok(
    winner.isFocus,
    `聚焦态边框被压掉了:层叠胜者是「${winner.selector}」(权重 ${winner.spec} @${winner.index})。`
    + '同权重时后写者胜 ⇒ 把聚焦规则移到覆盖块之后,或提高其权重。',
  );

  const winnerColor = colorOf(winner);
  assert.ok(
    !DEAD_VALUES.has(winnerColor) && /var\(--|#|rgb/.test(winnerColor),
    `聚焦态边框颜色「${winnerColor}」不是有效的可见色值(应为设计 token / 具体色值)`,
  );

  const plainWinner = cascadeWinner(plain);
  assert.notEqual(
    winnerColor,
    colorOf(plainWinner),
    `聚焦态边框颜色和非聚焦基线「${plainWinner.selector}」完全相同 ⇒ 聚焦前后没有任何视觉差,等于没做`,
  );

  // 「2rpx 墨色边」的 2rpx 那一半:凡是给这个元素定边宽的 border 简写都必须是 2rpx。
  // 逐条查而不是只查层叠胜者 —— item-cont / item-cont2 各写一条,只查最后一条会漏。
  const widthEntries = candidates.filter((c) => c.shorthand !== null);
  assert.ok(widthEntries.length > 0, '应有 border 简写规则给 .item-cont 定边宽');
  for (const entry of widthEntries) {
    assert.match(
      entry.shorthand,
      /(^|\s)2rpx(\s|$)/,
      `「${entry.selector}」的边框宽度不是 2rpx(现为「${entry.shorthand}」),处方 I 要求 2rpx 墨色边`,
    );
  }
});

// —— D2:wxss 的 .is-focused 规则必须有真实通路把这个类挂上去 ——
// 逐个 input/textarea 追:bindfocus/bindblur → js handler 函数体 → setData 里
// focusField 的取值确实来自 event dataset;并要求 wxml 渲染用的 key 集合
// 与 input 上声明的 key 集合完全相等(任一侧多出来都说明有半截通路)。

// 取出对象字面量里某个方法的函数体,兼容 `name(e) {}` / `name: function (e) {}` / `name: (e) => {}`
function methodBody(js, name) {
  const re = new RegExp(
    `(?:^|[\\s,;{])${name}\\s*(?::\\s*(?:async\\s+)?(?:function\\s*)?)?\\s*\\([^)]*\\)\\s*(?:=>\\s*)?\\{`,
    'm',
  );
  const m = re.exec(js);
  if (!m) return null;
  let i = m.index + m[0].length - 1; // 指向开花括号
  let depth = 0;
  let quote = null;
  for (; i < js.length; i += 1) {
    const ch = js[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return js.slice(m.index + m[0].length, i);
    }
  }
  return null;
}

// 取 handler 体内所有 setData(...) 的实参文本
function setDataArgs(body) {
  const out = [];
  const re = /setData\s*\(/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    let depth = 0;
    let quote = null;
    for (let i = m.index + m[0].length - 1; i < body.length; i += 1) {
      const ch = body[i];
      if (quote) {
        if (ch === '\\') i += 1;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) { out.push(body.slice(m.index + m[0].length, i)); break; }
      }
    }
  }
  return out;
}

function focusFieldValue(args) {
  for (const arg of args) {
    const m = /focusField\s*:\s*([^,}]+)/.exec(arg);
    if (m) return m[1].trim();
  }
  return null;
}

// key 里可能带插值(data-focuskey="ticketName{{ticketIndex}}"),取静态前缀
const staticKey = (k) => k.replace(/\{\{[^}]*\}\}/g, '').trim();

const FOCUS_PAGES = [
  { name: 'publish/activity', wxss: 'pages/publish/activity/index.wxss', wxml: 'pages/publish/activity/index.wxml', js: 'pages/publish/activity/index.js' },
];

for (const page of FOCUS_PAGES) {
  test(`D2 ${page.name}:每个聚焦输入框都要有 wxml 绑定 → handler → setData focusField 的完整通路`, () => {
    const css = read(page.wxss);
    const wxml = read(page.wxml);
    const js = read(page.js);

    // 1) wxss 里的 .is-focused 规则必须真的产生可见轮廓,不是空壳
    const focusRules = parseRules(css).filter((r) => /\.is-focused\b/.test(r.selector));
    assert.ok(focusRules.length > 0, `${page.name} 应有 .is-focused 样式`);
    const focusVisual = focusRules
      .map((r) => declValue(r.body, 'border-color') || declValue(r.body, 'border') || declValue(r.body, 'box-shadow'))
      .filter((v) => v !== null && !DEAD_VALUES.has(v));
    assert.ok(
      focusVisual.length > 0,
      `${page.name} 的 .is-focused 规则没有有效的 border/box-shadow 声明 ⇒ 聚焦态没有视觉产出`,
    );

    // 2) wxml 里渲染 is-focused 的 key(class 绑定侧)
    const renderedKeys = new Set();
    const renderRe = /focusField\s*===\s*['"]([^'"]+)['"]/g;
    let rm;
    while ((rm = renderRe.exec(wxml)) !== null) renderedKeys.add(rm[1]);
    assert.ok(renderedKeys.size > 0, `${page.name} 的 wxml 从不按 focusField 挂 is-focused ⇒ 死规则`);
    assert.match(
      wxml,
      /'is-focused'|"is-focused"/,
      `${page.name} 的 wxml 从不挂 is-focused 类`,
    );

    // 3) 逐个绑了 bindfocus 的 input/textarea:必须同时绑 blur,且带 key
    const declaredKeys = new Set();
    const focusHandlers = new Set();
    const blurHandlers = new Set();
    const tagRe = /<(input|textarea)\b[^>]*>/g;
    let tm;
    let bound = 0;
    while ((tm = tagRe.exec(wxml)) !== null) {
      const tag = tm[0];
      const fh = /bind:?focus\s*=\s*"([^"]+)"/.exec(tag);
      const bh = /bind:?blur\s*=\s*"([^"]+)"/.exec(tag);
      if (!fh) continue;
      bound += 1;
      const brief = tag.replace(/\s+/g, ' ').slice(0, 90);
      assert.ok(bh, `${page.name} 的输入框绑了 focus 却没绑 blur ⇒ 聚焦态退不掉:${brief}`);
      const key = /data-focuskey\s*=\s*"([^"]+)"/.exec(tag) || /data-field\s*=\s*"([^"]+)"/.exec(tag);
      assert.ok(key, `${page.name} 的输入框绑了 focus 但没有 data-focuskey/data-field ⇒ handler 拿不到 key:${brief}`);
      declaredKeys.add(staticKey(key[1]));
      focusHandlers.add(fh[1]);
      blurHandlers.add(bh[1]);
    }
    assert.ok(bound > 0, `${page.name} 没有任何 input/textarea 绑 bindfocus ⇒ focusField 永远不会被置起`);

    // 4) 渲染侧 key 集合 ⇔ 输入框声明 key 集合,必须完全相等
    const rendered = [...renderedKeys].map(staticKey).sort();
    const declared = [...declaredKeys].sort();
    assert.deepEqual(
      declared,
      rendered,
      `${page.name} 的 focusField key 两侧对不上:input 声明 [${declared}] vs wxml 渲染 [${rendered}]。`
      + '多出来的一侧就是断掉的半截通路(样式挂不上,或写了个没人渲染的 key)。',
    );

    // 5) handler 函数体:focus 必须从 event dataset 写 focusField,blur 必须清空
    for (const name of focusHandlers) {
      const body = methodBody(js, name);
      assert.ok(body, `${page.name} 的 js 里找不到 focus handler ${name}`);
      const value = focusFieldValue(setDataArgs(body));
      assert.ok(
        value,
        `${page.name} 的 ${name} 体内没有 setData({ focusField: ... }) ⇒ 类永远挂不上(样式再对也白搭)`,
      );
      const dsVars = [...body.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*[^;]*dataset/g)].map((m) => m[1]);
      const fromDataset = /dataset/.test(value) || dsVars.some((v) => new RegExp(`\\b${v}\\b`).test(value));
      assert.ok(
        fromDataset,
        `${page.name} 的 ${name} 写的 focusField 取值「${value}」不来自 event dataset ⇒ 不是真实聚焦字段`,
      );
    }
    for (const name of blurHandlers) {
      const body = methodBody(js, name);
      assert.ok(body, `${page.name} 的 js 里找不到 blur handler ${name}`);
      const value = focusFieldValue(setDataArgs(body));
      assert.ok(
        value && /^(''|""|``)$/.test(value),
        `${page.name} 的 ${name} 必须 setData({ focusField: '' }) 清空聚焦态,现为「${value}」`,
      );
    }
  });
}
