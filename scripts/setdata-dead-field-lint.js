#!/usr/bin/env node
'use strict';

/**
 * U4 死数据字段门禁:js 里 setData 出去的顶层字段,wxml 零引用 ⇒ 白算白传,屏幕上根本没有。
 *
 * 案底(探店日开工计划 2026-08-14 第一节):pages/roam 的「结算导流推荐位」reco 字段
 * (index.js:3229 `this.setData({ reco: {...} })`)js 链路完整,wxml 零消费——整块 UI 被摘掉了,
 * 数据还在照常拉、照常算。同页的 goal 字段更刁:它**不是完全没出现**,而是只经 js 拼进
 * roamMapA11y、最后落到 `<free-map accessibility-label="{{roamMapA11y}}">`。
 *
 * ★ 所以本门禁最重要的一条判据是:「wxml 里出现过」≠「屏幕上看得见」。
 *   只落在 aria-* / accessibility-* / alt / title 这类只喂读屏器的属性,或只落在
 *   data-* / id 这类只喂事件与框架的属性,或只当 prop 传给一个**自己压根不消费它**的
 *   自定义组件 —— 这三种一律不算"已消费",单独成类报出来,不许直接判过。
 *
 * 分类:
 *   A1 完全死       wxml 零引用,js 也不从 this.data 读它 —— 纯粹白 setData
 *   A2 只当内部状态  wxml 零引用,但 js 自己读 this.data.X —— 不上屏,应该放实例属性而不是 setData
 *                   (goal 就是这类:被 js 拼成读屏文案,从没直接上屏)
 *   B1 只进无障碍属性 全部引用落在 aria- / accessibility- / alt / title —— 读屏器听得到,眼睛看不见
 *   B2 只进非渲染属性 全部引用落在 data- / id / wx:key —— 只喂事件和框架,不渲染成内容
 *   C  传给不消费它的组件 全部引用是自定义组件的 prop,而该组件自己的 wxml/js 从不读这个 prop
 *
 * 已知天花板(ponytail:够用就停):
 *   - wx:for 局部变量(item/index 或 wx:for-item 指定名)会和同名字段撞;撞上的字段单列
 *     一档"疑似被循环变量遮蔽",不判违规——宁可漏报也不拿假问题挡 PR。
 *   - C 类只看组件**自己**的 wxml/js,不追它再往下传给孙组件;追下去要建全量 prop 传递图,
 *     现在没这个需求。
 *   - setData(变量) / 展开运算符 / 计算属性名 静态判不了,逐条进 unscannable 列表,不静默。
 *
 * 用法:node scripts/setdata-dead-field-lint.js               全仓扫描
 *       node scripts/setdata-dead-field-lint.js --selftest     自证
 *       node scripts/setdata-dead-field-lint.js --list         打印全部存量明细
 *       node scripts/setdata-dead-field-lint.js --update-baseline
 */
const fs = require('fs');
const path = require('path');
const S = require('./lib/xcx-scan.js');

const BASELINE = path.join(__dirname, 'baselines', 'u4-dead-setdata-field.json');

const CLASS_LABEL = {
  A1: '完全死:wxml 零引用,js 也不读 this.data',
  A2: '只当内部状态:wxml 零引用,js 自己读 this.data(不该走 setData)',
  B1: '只进无障碍属性:读屏器听得到,眼睛看不见',
  B2: '只进 data-*/id 等非渲染属性:只喂事件和框架,不渲染成内容',
  C: '只当 prop 传给自定义组件,而该组件自己从不消费这个 prop',
};

// js 有没有真去读 this.data.X(含 const { X } = this.data 解构)
function jsReadsDataField(masked, name) {
  if (new RegExp(`\\.\\s*data\\s*\\.\\s*${name}(?![\\w$])`).test(masked)) return true;
  const re = /\{([^{}]*)\}\s*=\s*(?:this\s*\.\s*)?data(?![\w$])/g;
  let m;
  while ((m = re.exec(masked))) {
    if (m[1].split(',').some((s) => s.trim().split(':')[0].trim() === name)) return true;
  }
  return false;
}

function classifyRefs(refs, usingByFile) {
  // 只要有一处是"真上屏"的引用,就算已消费。
  const nonRendering = [];
  for (const r of refs) {
    if (r.attr === null) return null;                       // 文本节点 = 直接上屏
    // wx:if / wx:elif / wx:for / hidden / class / style / model:xxx 决定了「渲不渲染、长什么样」,
    // 是货真价实的消费。★ 这里踩过一次:早先把 <cy-empty wx:elif="{{!loaded}}"> 的 wx:elif
    // 当成自定义组件的 prop 去问「组件消费了吗」,答案当然是没有,于是 99 个字段被误报成 C 类。
    if (/^wx:/.test(r.attr) || /^model:/.test(r.attr) || r.attr === 'hidden' || r.attr === 'class' || r.attr === 'style') return null;
    if (S.isNonRenderingAttr(r.attr)) { nonRendering.push(r); continue; }
    const using = usingByFile.get(r.file);
    const base = using && using.get(r.tag);
    if (!base) return null;                                  // 原生标签(或未登记的标签)的渲染属性 = 上屏
    if (S.componentConsumesProp(base, r.attr)) return null;   // 自定义组件确实消费了这个 prop
    nonRendering.push(Object.assign({ cclass: 'C' }, r));
  }
  if (nonRendering.some((r) => r.cclass === 'C')) return 'C';
  if (nonRendering.every((r) => S.isA11yAttr(r.attr))) return 'B1';
  return 'B2';
}

function lintRepo() {
  const { map } = S.buildJsToWxmlMap();
  const violations = [];
  const unscannable = [];
  const shadowed = [];
  let fieldCount = 0;

  [...map.entries()].forEach(([jsFile, owned]) => {
    const src = fs.readFileSync(jsFile, 'utf8');
    const masked = S.maskNonCode(src);
    const { fields, unscannable: bad } = S.extractSetDataFields(src);
    bad.forEach((b) => unscannable.push({ file: jsFile, line: b.line, reason: b.reason }));
    if (!fields.length) return;

    const refIndex = new Map();
    const scopeNames = new Set();
    const usingByFile = new Map();
    owned.forEach((w) => {
      const { refs, scopeNames: sn } = S.extractWxmlRefs(fs.readFileSync(w, 'utf8'));
      sn.forEach((n) => scopeNames.add(n));
      usingByFile.set(w, S.loadUsingComponents(w));
      refs.forEach((r) => {
        if (!refIndex.has(r.name)) refIndex.set(r.name, []);
        refIndex.get(r.name).push(Object.assign({ file: w }, r));
      });
    });

    const firstLine = new Map();
    fields.forEach((f) => { if (!firstLine.has(f.name)) firstLine.set(f.name, f.line); });

    [...firstLine.entries()].forEach(([name, line]) => {
      fieldCount += 1;
      const refs = refIndex.get(name) || [];
      if (!refs.length) {
        violations.push({ file: jsFile, line, name, cclass: jsReadsDataField(masked, name) ? 'A2' : 'A1', where: [] });
        return;
      }
      if (scopeNames.has(name)) {
        shadowed.push({ file: jsFile, line, name });
        return;
      }
      const cclass = classifyRefs(refs, usingByFile);
      if (!cclass) return;                                   // 真上屏了
      violations.push({
        file: jsFile,
        line,
        name,
        cclass,
        where: refs.slice(0, 3).map((r) => `${S.rel(r.file)}:${r.line} <${r.tag} ${r.attr}>`),
      });
    });
  });

  return { violations, unscannable, shadowed, fieldCount, jsFileCount: map.size };
}

const keyOf = (v) => `${S.rel(v.file)}::${v.name}::${v.cclass}`;

// ---------- 自证 ----------
function runSelfTest() {
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'u4-selftest-'));
  fs.mkdirSync(path.join(dir, 'cmp'), { recursive: true });
  // 一个"接了 prop 但自己从不消费"的组件,用来验 C 类
  fs.writeFileSync(path.join(dir, 'cmp', 'silent.js'), 'Component({ properties: { deadProp: String, livePropX: String } })\n');
  fs.writeFileSync(path.join(dir, 'cmp', 'silent.wxml'), '<view>{{livePropX}}</view>\n');
  // ★ behaviors 消费:prop 在组件自己的 js 里只剩一次声明,真正的 observer 在 behavior 里
  //   (cy-sheet / cy-modal 的退场动画就是这个形状)。不跟进去看就会误判成 C 类。
  fs.mkdirSync(path.join(dir, 'behaviors'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'behaviors', 'live.js'),
    'module.exports = Behavior({ observers: { viaBehavior(v) { this.setData({ _r: v }) } } })\n');
  fs.writeFileSync(path.join(dir, 'behaviors', 'inert.js'),
    'module.exports = Behavior({ lifetimes: { detached() {} } })\n');
  fs.writeFileSync(path.join(dir, 'cmp', 'viab.js'),
    "const b = require('../behaviors/live.js');\nComponent({ behaviors: [b], properties: { viaBehavior: Boolean } })\n");
  fs.writeFileSync(path.join(dir, 'cmp', 'viab.wxml'), '<view></view>\n');
  fs.writeFileSync(path.join(dir, 'cmp', 'inertb.js'),
    "const b = require('../behaviors/inert.js');\nComponent({ behaviors: [b], properties: { viaBehavior: Boolean } })\n");
  fs.writeFileSync(path.join(dir, 'cmp', 'inertb.wxml'), '<view></view>\n');
  fs.writeFileSync(path.join(dir, 'cmp', 'unmountedb.js'),
    "const b = require('../behaviors/live.js');\nComponent({ behaviors: [], properties: { viaBehavior: Boolean } })\n");
  fs.writeFileSync(path.join(dir, 'cmp', 'unmountedb.wxml'), '<view></view>\n');
  fs.writeFileSync(path.join(dir, 'cmp', 'commenttrapb.js'),
    "const b = require('../behaviors/live.js');\n// behaviors: [b]\nComponent({ behaviors: [], properties: { viaBehavior: Boolean } })\n");
  fs.writeFileSync(path.join(dir, 'cmp', 'commenttrapb.wxml'), '<view></view>\n');
  // ★ xr-frame 渲染器组件:width/height 由渲染器读,组件代码里不出现(官方入门写法)
  fs.writeFileSync(path.join(dir, 'cmp', 'xrc.js'), 'Component({ properties: { mode: String } })\n');
  fs.writeFileSync(path.join(dir, 'cmp', 'xrc.json'), JSON.stringify({ component: true, renderer: 'xr-frame' }));
  fs.writeFileSync(path.join(dir, 'cmp', 'xrc.wxml'), '<xr-scene></xr-scene>\n');
  // 负控:普通组件同名 width 不得沾光
  fs.writeFileSync(path.join(dir, 'cmp', 'plainw.js'), 'Component({ properties: {} })\n');
  fs.writeFileSync(path.join(dir, 'cmp', 'plainw.wxml'), '<view></view>\n');

  const jsSrc = [
    'Page({',
    '  data: {},',
    '  onLoad() {',
    "    this.setData({ shownInText: 1, reco: { list: [] }, goal: 2, roamMapA11y: 'x' });",
    "    this.setData({ 'nested.deep': 1, listData: [], onlyDataAttr: 3 });",
    '    const patch = {}; this.setData(patch);',
    '    this.setData({ ...patch });',
    // ★负控:跨对象 setData(接收者不是 this)必须进 unscannable,不能被算成本文件的死字段
    '    this._prev.setData({ crossPageField: 1 });',
    '    this.setData({ deadProp: 7, livePropX: 8 });',
    '    this.setData({ viaBehaviorLive: 9, viaBehaviorDead: 10, viaBehaviorUnmounted: 11, viaBehaviorCommentTrap: 12 });',
    '    this.setData({ xrW: 1, plainW: 2, xrFoo: 3 });',
    '  },',
    '  useGoal() { return this.data.goal; },',
    '})',
    '',
  ].join('\n');
  const jsFile = path.join(dir, 'index.js');
  fs.writeFileSync(jsFile, jsSrc);

  const wxml = [
    '<view>{{shownInText}}</view>',
    '<free-map accessibility-label="{{roamMapA11y}}" />',
    '<view data-x="{{onlyDataAttr}}" bindtap="onTap"></view>',
    '<view class="detail-cta-bar">{{nested.deep}}</view>',
    '<view wx:for="{{listData}}" wx:key="id">{{item.name}}</view>',
    '<silent-cmp dead-prop="{{deadProp}}" live-prop-x="{{livePropX}}" />',
    '<viab-cmp via-behavior="{{viaBehaviorLive}}" />',
    '<inertb-cmp via-behavior="{{viaBehaviorDead}}" />',
    '<unmountedb-cmp via-behavior="{{viaBehaviorUnmounted}}" />',
    '<commenttrapb-cmp via-behavior="{{viaBehaviorCommentTrap}}" />',
    '<xrc-cmp width="{{xrW}}" foo="{{xrFoo}}" />',
    '<plainw-cmp width="{{plainW}}" />',
    '<!-- <view>{{reco.list}}</view> -->',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'index.wxml'), wxml);
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ usingComponents: {
    'silent-cmp': './cmp/silent', 'viab-cmp': './cmp/viab', 'inertb-cmp': './cmp/inertb',
    'unmountedb-cmp': './cmp/unmountedb', 'commenttrapb-cmp': './cmp/commenttrapb',
    'xrc-cmp': './cmp/xrc', 'plainw-cmp': './cmp/plainw'
  } }));

  const { fields, unscannable } = S.extractSetDataFields(jsSrc);
  const names = fields.map((f) => f.name);
  const { refs, scopeNames } = S.extractWxmlRefs(wxml);
  const using = S.loadUsingComponents(path.join(dir, 'index.wxml'));
  const refIndex = new Map();
  refs.forEach((r) => {
    if (!refIndex.has(r.name)) refIndex.set(r.name, []);
    refIndex.get(r.name).push(Object.assign({ file: path.join(dir, 'index.wxml') }, r));
  });
  const usingByFile = new Map([[path.join(dir, 'index.wxml'), using]]);
  const masked = S.maskNonCode(jsSrc);
  const verdict = (n) => {
    const rs = refIndex.get(n) || [];
    if (!rs.length) return jsReadsDataField(masked, n) ? 'A2' : 'A1';
    return classifyRefs(rs, usingByFile) || 'PASS';
  };

  // ★ \b 陷阱:wxml 里有 class="detail-cta-bar",字段名 detail 绝不能因此被算成"已消费"。
  const detailVerdict = (refIndex.get('detail') || []).length;
  // ★ \b 陷阱 2:{{nested.deep}} 只该产出 nested,不该产出 deep(成员名)
  const memberTrapOk = refs.some((r) => r.name === 'nested') && !refs.some((r) => r.name === 'deep');

  const checks = {
    'setData 键抽取:普通/简写/点路径/字符串键': names.includes('shownInText') && names.includes('goal') && names.includes('nested') && names.includes('listData'),
    'setData(变量) 与展开进 unscannable 不静默': unscannable.length === 3,
    '跨对象 setData 不算本文件的死字段(误报负控)': !names.includes('crossPageField')
      && unscannable.some((u) => /接收者不是本页/.test(u.reason)),
    '绿:文本节点引用 = 已消费': verdict('shownInText') === 'PASS',
    '红 A1:reco 只出现在注释里 ⇒ 完全死': verdict('reco') === 'A1',
    '红 A2:goal 零 wxml 引用但 js 读 this.data.goal': verdict('goal') === 'A2',
    '红 B1:roamMapA11y 只进 accessibility-label': verdict('roamMapA11y') === 'B1',
    '红 B2:onlyDataAttr 只进 data-x': verdict('onlyDataAttr') === 'B2',
    '红 C:deadProp 传给了不消费它的组件': verdict('deadProp') === 'C',
    '绿 C 反面:livePropX 组件真消费 ⇒ 放行': verdict('livePropX') === 'PASS',
    '绿:prop 只在 behaviors 里被消费也算消费(cy-sheet/cy-modal 退场动画的形状)': verdict('viaBehaviorLive') === 'PASS',
    '红 C 负控:挂了 behavior 但它也不碰这个 prop ⇒ 仍判 C(证明不是无脑放行)': verdict('viaBehaviorDead') === 'C',
    '红 C 负控:只 require 但未挂载 behavior ⇒ 仍判 C': verdict('viaBehaviorUnmounted') === 'C',
    '红 C 负控:注释里的 behaviors 不得覆盖真实空数组': verdict('viaBehaviorCommentTrap') === 'C',
    '绿:xr-frame 渲染器组件的 width 由渲染器读 ⇒ 放行': verdict('xrW') === 'PASS',
    '红 C 负控:普通组件同名 width 不沾光': verdict('plainW') === 'C',
    '红 C 负控:xr-frame 组件的别的属性不豁免': verdict('xrFoo') === 'C',
    'wx:for 引入的 item/index 被记为局部作用域名': scopeNames.has('item') && scopeNames.has('index'),
    '\\b 陷阱:class="detail-cta-bar" 不产生 detail 引用': detailVerdict === 0,
    '\\b 陷阱:{{nested.deep}} 不把成员名 deep 当字段': memberTrapOk,
    '棘轮:新增判红 / 存量放行 / 基线缺失不豁免': S.selfTestRatchet(),
  };
  fs.rmSync(dir, { recursive: true, force: true });

  const failed = Object.keys(checks).filter((k) => !checks[k]);
  if (failed.length) {
    console.error('U4 死数据字段门禁:自证失败 ->', failed.join(' / '));
    console.error(JSON.stringify({ names, unscannable, refs, verdicts: names.map((n) => [n, verdict(n)]) }, null, 2));
    process.exit(1);
  }
  console.log(`U4 死数据字段门禁:自证通过(${Object.keys(checks).length} 项,五类判据各有红绿负控 + 两条 \\b 陷阱)`);
}

if (require.main === module) {
  if (process.argv.includes('--selftest')) {
    runSelfTest();
  } else {
    const { violations, unscannable, shadowed, fieldCount, jsFileCount } = lintRepo();
    if (process.argv.includes('--update-baseline')) {
      S.writeBaseline(BASELINE, violations.map(keyOf), 'U4 死数据字段存量。只能变小不能变大;修完一条就重跑 --update-baseline。');
      console.log(`U4:已写入基线 ${violations.length} 条 -> ${S.rel(BASELINE)}`);
      process.exit(0);
    }
    const baseline = S.loadBaseline(BASELINE);
    const byClass = {};
    violations.forEach((v) => { byClass[v.cclass] = (byClass[v.cclass] || 0) + 1; });
    console.log(`U4 死数据字段:扫描 ${jsFileCount} 个页面/组件 js,核对 ${fieldCount} 个 setData 顶层字段,存量基线 ${baseline.size} 条`);
    Object.keys(CLASS_LABEL).forEach((c) => { if (byClass[c]) console.log(`  ${c} ${byClass[c]} 个 —— ${CLASS_LABEL[c]}`); });
    if (unscannable.length) console.log(`静态判不了 ${unscannable.length} 处 setData(变量/展开/计算属性名),不静默,跑 --list 看明细`);
    if (shadowed.length) console.log(`疑似被 wx:for 局部变量遮蔽 ${shadowed.length} 个,不判违规(宁可漏报),跑 --list 看明细`);
    if (process.argv.includes('--list')) {
      violations.forEach((v) => console.log(`  [${v.cclass}] ${S.rel(v.file)}:${v.line} ${v.name}${v.where.length ? '  ← ' + v.where.join(' | ') : ''}`));
      shadowed.forEach((v) => console.log(`  [shadowed] ${S.rel(v.file)}:${v.line} ${v.name}`));
      unscannable.forEach((v) => console.log(`  [unscannable] ${S.rel(v.file)}:${v.line} ${v.reason}`));
    }
    const fresh = violations.filter((v) => !baseline.has(keyOf(v)));
    const stillThere = new Set(violations.map(keyOf));
    const stale = [...baseline].filter((k) => !stillThere.has(k));
    if (stale.length) console.log(`提示:基线里 ${stale.length} 条已经不存在了(修好了),跑 --update-baseline 收窄基线`);
    if (fresh.length) {
      fresh.forEach((v) => console.error(`${S.rel(v.file)}:${v.line} setData 字段 ${v.name} [${v.cclass}] ${CLASS_LABEL[v.cclass]}${v.where.length ? '  ← ' + v.where.join(' | ') : ''}`));
      console.error(`U4 门禁不通过:新增 ${fresh.length} 个死数据字段`);
      process.exit(1);
    }
    console.log(`U4 死数据字段门禁:通过(存量 ${violations.length} 条已在基线内,未新增)`);
  }
}

module.exports = { lintRepo, keyOf, CLASS_LABEL };
