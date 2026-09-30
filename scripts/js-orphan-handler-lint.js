#!/usr/bin/env node
'use strict';

/**
 * U3 孤儿 handler 门禁:js 里定义了长得像事件回调的方法(on… / go… / tap… / handle… 前缀),
 * 但 wxml 里零绑定、js 内部也没人调 ⇒ 死代码,或者更坏——「本该有个按钮,结果按钮没上屏」。
 *
 * 案底(探店日开工计划 2026-08-14 第一节):pages/roam/index.js:3233 的 retryReco() 是个
 * **没有任何绑定元素**的 handler。它跟 U4 的 reco 死数据是同一个事故的两半:整块「结算导流
 * 推荐位」的 js 链路完整地留着,wxml 那半被摘掉了,于是"重试"按钮根本不存在,而代码看起来
 * 一切正常。人肉 review 扫不出来:单看 js 完全合理,单看 wxml 也完全合理。
 *
 * 判据:
 *   handler 形状 = /^(on|go|tap|handle)([A-Z0-9_]|$)/
 *     ★ 前缀后面必须跟大写/数字/下划线或到头,否则 goods()、handleness() 这种普通方法会被误伤。
 *   排除生命周期(见 LIFECYCLE):框架自己调,wxml 当然不会绑,报它就是纯误报。
 *   排除 js 内部被调用的:同文件里出现第二次(this.onFoo() / success: this.onFoo / 数组里注册)。
 *   排除跨文件被 .name( 调用的(父组件 selectComponent('#x').onFoo()),单独计数不静默。
 *
 * 已知天花板(ponytail:够用就停,不够再补):
 *   - behaviors/*.js 里定义的方法不在扫描集内(它们没有自己的 wxml,消费方是引用它的页面,
 *     静态归属不了)。要覆盖得先建 behavior -> 消费者 的反向索引,现在没这个需求。
 *   - 跨文件 .name( 判据按方法名全局匹配,同名方法会互相"救"对方 ⇒ 漏报而非误报。
 *
 * 用法:node scripts/js-orphan-handler-lint.js              全仓扫描
 *       node scripts/js-orphan-handler-lint.js --selftest    自证
 *       node scripts/js-orphan-handler-lint.js --update-baseline  重刷存量基线
 */
const fs = require('fs');
const path = require('path');
const S = require('./lib/xcx-scan.js');

const BASELINE = path.join(__dirname, 'baselines', 'u3-orphan-handler.json');

// 框架调用的钩子,不是 wxml 绑的,报它就是误报。
// 依据:微信开放文档「页面生命周期 / 页面事件处理函数」「App 生命周期」章节的全部 on* 回调,
// 加上 tabBar 页专有的 onTabItemTap 与状态恢复的 onSaveExitState。
// Component 的 created/attached/ready/moved/detached/error 与 lifetimes/pageLifetimes 是嵌套块,
// 本来就不会被 ownHandlerEntries 当成顶层 methods 抓出来,不需要列。
const LIFECYCLE = new Set([
  // Page
  'onLoad', 'onShow', 'onReady', 'onHide', 'onUnload',
  'onPullDownRefresh', 'onReachBottom', 'onPageScroll', 'onResize',
  'onShareAppMessage', 'onShareTimeline', 'onAddToFavorites',
  'onTabItemTap', 'onSaveExitState',
  // App
  'onLaunch', 'onError', 'onPageNotFound', 'onUnhandledRejection', 'onThemeChange',
]);

const HANDLER_SHAPE = /^(on|go|tap|handle)([A-Z0-9_]|$)/;

function isHandlerShaped(name) {
  return HANDLER_SHAPE.test(name);
}

// ★ 不用 /\bNAME\b/:\b 把连字符当边界,onTap 会被 on-tap-btn 命中而假绿。
//   这里用 (?<![\w$]) / (?![\w$]) 明确排除相邻的标识符字符,连字符照样是边界但名字必须全等。
function identifierOccurrences(masked, name) {
  const re = new RegExp(`(?<![\\w$])${name}(?![\\w$])`, 'g');
  return (masked.match(re) || []).length;
}

function buildCrossFileCallNames(jsFiles) {
  const called = new Map(); // 方法名 -> Set(出现该 .name( 的文件)
  jsFiles.forEach((f) => {
    const masked = S.maskNonCode(fs.readFileSync(f, 'utf8'));
    const re = /\.\s*([A-Za-z_$][\w$]*)\s*\(/g;
    let m;
    while ((m = re.exec(masked))) {
      if (!called.has(m[1])) called.set(m[1], new Set());
      called.get(m[1]).add(f);
    }
  });
  return called;
}

function lintRepo() {
  const { map } = S.buildJsToWxmlMap();
  const jsFiles = [...map.keys()];
  const crossFileCalls = buildCrossFileCallNames(jsFiles);

  const violations = [];
  const sparedByCrossFile = [];
  let inspected = 0;

  jsFiles.forEach((jsFile) => {
    const src = fs.readFileSync(jsFile, 'utf8');
    // ⚠️ 数「js 内部自己调」必须把 spread 目标的正文一起算进来。
    //    extractOwnHandlerEntries 已经会跟进 `...DIRECTOR_METHODS` 拿到定义,
    //    但定义在目标文件、调用在宿主文件 —— 只数宿主就永远只有 1 次,
    //    于是 onPrepareSession / onFinishSession 这种「宿主里被 onPrimary 调用」的方法
    //    会被恒判成孤儿。2026-09-04 导演台收编时实测到:三个同形方法里,
    //    只有恰好也绑了 wxml 的那个逃过,另外两个全被误报。
    const masked = [src]
      // ⚠️ 必须去重:同一个模块常被 spread 两次(`...DIRECTOR_DATA` / `...DIRECTOR_METHODS`
      //    来自同一个 require),正文拼两遍会让目标里**每个**定义都「出现 2 次」,
      //    于是整份 spread 目标里的真孤儿全部静默放行 —— 比不修更糟。
      .concat([...new Set(S.resolveSpreadRequireTargets(src))].map((rel) => {
        const p = path.resolve(path.dirname(jsFile), rel);
        try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; }
      }))
      .map(S.maskNonCode)
      .join('\n');
    const owned = map.get(jsFile);
    const boundNames = new Set();
    let wxmlRaw = '';
    owned.forEach((w) => {
      const wsrc = fs.readFileSync(w, 'utf8');
      wxmlRaw += S.maskWxmlComments(wsrc);
      S.findEventBindings(wsrc).forEach((b) => {
        const cls = S.classifyBinding(b.value);
        if (cls.kind === 'identifier') boundNames.add(cls.name);
      });
    });

    S.extractOwnHandlerEntries(jsFile).forEach(({ name, line }) => {
      if (!isHandlerShaped(name) || LIFECYCLE.has(name)) return;
      inspected += 1;
      if (boundNames.has(name)) return;
      // 动态绑定 bindtap="{{cond ? '' : 'touchStart'}}" 里方法名是字符串字面量,也算被绑上了
      if (wxmlRaw.includes(`'${name}'`) || wxmlRaw.includes(`"${name}"`)) return;
      if (identifierOccurrences(masked, name) > 1) return;   // js 内部自己调
      const callers = crossFileCalls.get(name);
      const foreign = callers ? [...callers].filter((f) => f !== jsFile) : [];
      if (foreign.length) {
        sparedByCrossFile.push({ file: jsFile, line, name, foreign: foreign.map(S.rel) });
        return;
      }
      violations.push({ file: jsFile, line, name });
    });
  });

  return { violations, sparedByCrossFile, inspected, jsFileCount: jsFiles.length };
}

const keyOf = (v) => `${S.rel(v.file)}::${v.name}`;

// ---------- 自证 ----------
function runSelfTest() {
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'u3-selftest-'));
  const write = (name, body) => { const p = path.join(dir, name); fs.writeFileSync(p, body); return p; };

  const jsPath = write('index.js', [
    'Page({',
    '  data: {},',
    '  onLoad() { this.handleInit(); },',       // 生命周期,不能报
    '  onShow() {},',                           // 生命周期,不能报
    '  onPullDownRefresh() {},',                // 生命周期,不能报
    '  handleInit() {},',                       // 被 onLoad 调用,不能报
    '  onBoundTap() {},',                       // wxml 绑了,不能报
    '  retryReco() {},',                        // 不是 handler 形状(re 开头),不在判据内
    '  onGhostTap() {},',                       // ★ 该报:零绑定零调用
    '  goods() {},',                            // ★ go 前缀但后面是小写 -> 不是 handler,不能报
    '  handleness() {},',                       // ★ handle 前缀但后面小写 -> 不能报
    '  onTapExtra() {},',                       // ★ 该报:wxml 绑的是 onTap 不是 onTapExtra
    '})',
    '',
  ].join('\n'));
  write('index.wxml', '<view bindtap="onBoundTap"></view>\n<view class="on-tap-btn" bindtap="onTap"></view>\n');

  const src = fs.readFileSync(jsPath, 'utf8');
  const masked = S.maskNonCode(src);
  const bound = new Set(S.findEventBindings(fs.readFileSync(path.join(dir, 'index.wxml'), 'utf8'))
    .map((b) => S.classifyBinding(b.value)).filter((c) => c.kind === 'identifier').map((c) => c.name));
  const reported = S.extractOwnHandlerEntries(jsPath)
    .filter(({ name }) => isHandlerShaped(name) && !LIFECYCLE.has(name))
    .filter(({ name }) => !bound.has(name))
    .filter(({ name }) => identifierOccurrences(masked, name) <= 1)
    .map((e) => e.name);

  // ★ \b 陷阱负控 1:wxml 里有 class="on-tap-btn",绝不能让 onTap 看起来"被绑了"。
  //   若用 /\bonTap\b/ 去 wxml 全文搜,on-tap-btn 不含 onTap 所以不中,但 onTapExtra 会——
  //   下面这条直接盯 onTapExtra:wxml 绑的是 onTap,onTapExtra 必须仍然被报。
  const hyphenTrapOk = reported.includes('onTapExtra') && !bound.has('onTapExtra');
  // ★ \b 陷阱负控 2:identifierOccurrences 必须全等匹配,不能被更长的同前缀名喂饱
  const occOk = identifierOccurrences('a.onTapExtra(); onTapExtraMore;', 'onTap') === 0
    && identifierOccurrences('onTap; on-tap; onTapExtra;', 'onTap') === 1;

  fs.rmSync(dir, { recursive: true, force: true });

  const checks = {
    '红:零绑定零调用的 onGhostTap 被报出': reported.includes('onGhostTap'),
    '绿:生命周期 onLoad/onShow/onPullDownRefresh 不报': !reported.some((n) => LIFECYCLE.has(n)),
    '绿:被 js 内部调用的 handleInit 不报': !reported.includes('handleInit'),
    '绿:wxml 已绑定的 onBoundTap 不报': !reported.includes('onBoundTap'),
    '绿:goods/handleness 前缀后小写不算 handler': !isHandlerShaped('goods') && !isHandlerShaped('handleness'),
    '绿:retryReco 不在 on/go/tap/handle 判据内': !isHandlerShaped('retryReco'),
    '红:handler 形状判定认得 go/tap/handle 真前缀': isHandlerShaped('goBack') && isHandlerShaped('tapItem') && isHandlerShaped('handleSubmit') && isHandlerShaped('onX'),
    '\\b 陷阱:onTapExtra 不被 onTap 的绑定顶替': hyphenTrapOk,
    '\\b 陷阱:identifierOccurrences 全等匹配': occOk,
    '棘轮:新增判红 / 存量放行 / 基线缺失不豁免': S.selfTestRatchet(),
  };
  const failed = Object.keys(checks).filter((k) => !checks[k]);
  if (failed.length) {
    console.error('U3 孤儿 handler 门禁:自证失败 ->', failed.join(' / '));
    console.error(JSON.stringify({ reported, bound: [...bound] }, null, 2));
    process.exit(1);
  }
  console.log(`U3 孤儿 handler 门禁:自证通过(${Object.keys(checks).length} 项,含能判红能判绿、生命周期排除、两条 \\b 陷阱负控)`);
}

if (require.main === module) {
  if (process.argv.includes('--selftest')) {
    runSelfTest();
  } else {
    const { violations, sparedByCrossFile, inspected, jsFileCount } = lintRepo();
    if (process.argv.includes('--update-baseline')) {
      S.writeBaseline(BASELINE, violations.map(keyOf), 'U3 孤儿 handler 存量。只能变小不能变大;修完一条就重跑 --update-baseline。');
      console.log(`U3:已写入基线 ${violations.length} 条 -> ${S.rel(BASELINE)}`);
      process.exit(0);
    }
    const baseline = S.loadBaseline(BASELINE);
    console.log(`U3 孤儿 handler:扫描 ${jsFileCount} 个页面/组件 js,核对 ${inspected} 个 handler 形状方法,存量基线 ${baseline.size} 条`);
    if (sparedByCrossFile.length) {
      console.log(`豁免 ${sparedByCrossFile.length} 个(其他 js 里存在 .方法名( 调用,可能是父组件 selectComponent 直调,逐条列出不静默):`);
      sparedByCrossFile.forEach((s) => console.log(`  ${S.rel(s.file)}:${s.line} ${s.name} <- ${s.foreign.slice(0, 3).join(', ')}${s.foreign.length > 3 ? ' 等' : ''}`));
    }
    const fresh = violations.filter((v) => !baseline.has(keyOf(v)));
    const stillThere = new Set(violations.map(keyOf));
    const stale = [...baseline].filter((k) => !stillThere.has(k));
    if (process.argv.includes('--list')) violations.forEach((v) => console.log(`  ${S.rel(v.file)}:${v.line} ${v.name}`));
    if (stale.length) console.log(`提示:基线里 ${stale.length} 条已经不存在了(修好了),跑 --update-baseline 收窄基线`);
    if (fresh.length) {
      fresh.forEach((v) => console.error(`${S.rel(v.file)}:${v.line} ${v.name}() 是 handler 形状,但 wxml 零绑定、js 内外零调用(按钮不存在 / 死代码)`));
      console.error(`U3 门禁不通过:新增 ${fresh.length} 个孤儿 handler`);
      process.exit(1);
    }
    console.log(`U3 孤儿 handler 门禁:通过(存量 ${violations.length} 条已在基线内,未新增)`);
  }
}

module.exports = { lintRepo, keyOf, isHandlerShaped, LIFECYCLE };
