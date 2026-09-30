// 商家「店铺装修」载入态布局契约(pages/merchant/decor)
//
// 背景:这一页原来正文只有一条出口 <scroll-view wx:if="{{loaded && m}}">,加载中 / 断网 /
// 接口报错 / 无店铺四种情况全渲染成「只有顶栏的白屏」。摊成 loadState 四态后,截图复审又
// 实锤两条呈现 bug,本文件就是钉住那两条修复不回潮:
//
//   ① loading 的骨架必须**顶部对齐**,不能吃 .dc-state 通用的 60vh 垂直居中。
//      居中会把骨架推到离顶栏 ~162px(实测 @1.632x),而正文 .dc-scroll 紧贴顶栏
//      ⇒ 加载完成那一瞬内容整体上跳。骨架的作用是占住正文的位,不是当居中插画。
//   ② 骨架必须落在**卡面**上。日间 --cy-color-skeleton-highlight 是按 --cy-color-bg-surface
//      校准的(相对卡面差 21 级可见),相对 --cy-color-bg-page(商家页灰底)只差 3 级
//      ⇒ shimmer 走到高光相位时骨架整块消失,加载中看起来仍像白页。
//      修法是把骨架套回卡面(--cy-color-bg-surface),不改共享 token、不改 cy-skeleton 组件。
//
// ★本文件自带负控:每条断言都会再跑一遍「变异副本」(纯内存改字符串,不写盘),
//   变异后该断言**必须抛错**。没有这一层,静态断言很容易退化成恒真的橡皮图章。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const XCX = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(XCX, rel), 'utf8');

const SRC = {
  wxml: read('pages/merchant/decor/index.wxml'),
  wxss: read('pages/merchant/decor/index.wxss') + read('pages/merchant/decor/design.wxss'),
  js: read('pages/merchant/decor/index.js'),
  // 组件与 token 只读、只用来复核前提,本轮改动不碰它们
  skeletonWxss: read('components/cy/skeleton/index.wxss'),
  merchantLight: read('style/merchant-light.wxss'),
};

// wxml 注释里为了解释「为什么这么做」会提到被禁的写法,断言只看可渲染部分
const renderable = (wxml) => wxml.replace(/<!--[\s\S]*?-->/g, '');
// 取某选择器的第一处规则体
function ruleBody(wxss, selector) {
  const i = wxss.indexOf(selector + ' {');
  if (i < 0) return null;
  return wxss.slice(i, wxss.indexOf('}', i) + 1);
}
// 取某个 loadState 分支的开标签
function branchTag(wxml, state, kind) {
  const re = new RegExp(`<view class="([^"]*)"[^>]*wx:${kind}="\\{\\{loadState === '${state}'\\}\\}"`);
  return renderable(wxml).match(re);
}

const LOADING_CLASS = 'dc-state--skeleton';
const CARD_CLASS = 'dc-skel-card';

// ── 断言集合:每条都是 (src) => void,违约即 throw ──────────────────────────
const CHECKS = {
  loadingHasOwnClass(src) {
    const m = branchTag(src.wxml, 'loading', 'if');
    assert.ok(m, "找不到 wx:if=\"{{loadState === 'loading'}}\" 分支");
    assert.ok(new RegExp(`\\b${LOADING_CLASS}\\b`).test(m[1]),
      `loading 分支没挂 .${LOADING_CLASS},骨架会跟 error/empty 一样被垂直居中 → 加载完成跳版。实际 class="${m[1]}"`);
  },

  loadingClassOverridesCenter(src) {
    const body = ruleBody(src.wxss, '.' + LOADING_CLASS);
    assert.ok(body, `.${LOADING_CLASS} 规则不存在`);
    assert.match(body, /justify-content:\s*flex-start/,
      `.${LOADING_CLASS} 没把通用的 justify-content:center 覆盖成 flex-start:\n${body}`);
    assert.match(body, /min-height:\s*0\b/,
      `.${LOADING_CLASS} 没把通用的 min-height:60vh 归 0,60vh 会继续把骨架往下推:\n${body}`);
  },

  genericStateStillCentered(src) {
    // 2026-07-31 跨批次根因修复(批1 PR#486,commit 3b5b96427):"居中"改为在
    // 「标题下方到屏幕底部」的剩余空间里居中,不再是页面自己拍脑袋写 min-height:60vh。
    // .dc-state 现在只负责用 flex:1 吃满 .dc-page(flex 列)让出的剩余高度,
    // 真正的居中交给 cy-error/cy-empty 自己的 fill 变体(读 .dc-page 给出的确定高度)。
    const body = ruleBody(src.wxss, '.dc-state');
    assert.ok(body, '.dc-state 规则不存在');
    assert.match(body, /flex:\s*1\b/, '.dc-state 没有 flex:1,吃不到 .dc-page 让出的剩余高度');
    const pageBody = ruleBody(src.wxss, '.dc-page');
    assert.match(pageBody, /display:\s*flex/, '.dc-page 不是 flex 容器,.dc-state 的 flex:1 不会生效');
    for (const state of ['error', 'empty']) {
      const m = branchTag(src.wxml, state, 'elif');
      assert.ok(m, `找不到 ${state} 分支`);
      assert.ok(!new RegExp(`\\b${LOADING_CLASS}\\b`).test(m[1]),
        `${state} 分支被挂上了 loading 专用变体:class="${m[1]}"`);
    }
    const flat = renderable(src.wxml).replace(/\s+/g, ' ');
    assert.match(flat, /<cy-error\b[^>]*\bfill\b/, 'error 分支的 cy-error 没有传 fill,不会在剩余空间里居中');
    assert.match(flat, /<cy-empty\b[^>]*\bfill\b/, 'empty 分支的 cy-empty 没有传 fill,不会在剩余空间里居中');
  },

  skeletonWrappedInSurface(src) {
    const flat = renderable(src.wxml).replace(/\s+/g, ' ');
    assert.match(flat, new RegExp(`<view class="${CARD_CLASS}"> ?<cy-skeleton`),
      `cy-skeleton 没有被 .${CARD_CLASS} 包住 —— 骨架落回页面灰底,高光相位会消失`);
  },

  skeletonHeroMatchesCover(src) {
    const flat = renderable(src.wxml).replace(/\s+/g, ' ');
    assert.match(flat, /<cy-skeleton type="detail" style="--cy-map-h:\s*403.8rpx;" \/>/,
      '装修骨架没有把 detail hero 收到与正文封面相同的 403.8rpx,加载完成会发生几何跳动');
    const cover = ruleBody(src.wxss, '.dc-cover');
    assert.ok(cover, '.dc-cover 规则不存在');
    assert.match(cover, /height:\s*403.8rpx/, `正文封面高度已变化,需同步骨架 hero:\n${cover}`);
    const hero = ruleBody(src.skeletonWxss, '.sk-hero');
    assert.ok(hero && /height:\s*var\(--cy-map-h\)/.test(hero),
      'cy-skeleton detail hero 不再由 --cy-map-h 控制,请重新核对页面专用高度覆盖');
  },

  surfaceUsesTokenAndNoRawColor(src) {
    const body = ruleBody(src.wxss, '.' + CARD_CLASS);
    assert.ok(body, `.${CARD_CLASS} 规则不存在`);
    assert.match(body, /background:\s*var\(--cy-color-bg-surface\)/,
      `.${CARD_CLASS} 的承托底色没走现有 token --cy-color-bg-surface:\n${body}`);
    assert.ok(!/#[0-9A-Fa-f]{3,8}\b/.test(body), `.${CARD_CLASS} 里出现裸 hex 色值:\n${body}`);
    assert.ok(!/\brgba?\(/.test(body), `.${CARD_CLASS} 里出现裸 rgb/rgba 色值:\n${body}`);
  },

  surfaceClipsHero(src) {
    // 前提:cy-skeleton 的 .sk-hero 是 border-radius:0 的满宽块,不裁会从卡片圆角戳出方角
    const hero = ruleBody(src.skeletonWxss, '.sk-hero');
    assert.ok(hero && /border-radius:\s*0/.test(hero),
      '前提变了:cy-skeleton 的 .sk-hero 不再是 border-radius:0,overflow:hidden 可能不再必要,请复核本条');
    const body = ruleBody(src.wxss, '.' + CARD_CLASS);
    assert.match(body, /overflow:\s*hidden/, `.${CARD_CLASS} 少了 overflow:hidden,骨架 hero 的方角会戳出卡片圆角`);
  },

  pageLayerDoesNotForkSkeletonTokens(src) {
    // 页面层重定义 --cy-color-skeleton-* 会让本页骨架与全站其它骨架分叉,
    // 那是 DS 层该解决的事,不是一个页面偷偷改值
    assert.ok(!/--cy-color-skeleton-(base|highlight)\s*:/.test(src.wxss),
      'decor 页面层重定义了 --cy-color-skeleton-*,会让本页骨架与全站其它页分叉');
  },

  navBarHeightUsesTitleBandOnly(src) {
    assert.match(src.js, /navBarHeight:\s*app\.globalData\.navBarHeight\s*\|\|\s*44/,
      'decor 的 navBarHeight 必须只表示标题栏高度(44px),复用 app 全局值；状态栏由 statusBarHeight 单独相加');
    assert.ok(!/navBarHeight:\s*\(sys\.statusBarHeight\s*\|\|\s*20\)\s*\+\s*44/.test(src.js),
      'decor 又把 statusBarHeight 混进 navBarHeight，WXML 再相加时会把状态栏算两次');
    const wxml = renderable(src.wxml);
    // 导航统一(2026-07-29)后布局从「每块各自 margin-top 偏移」改成「flex 列 + 一块让位」:
    // 顶部让位只有一处,四个 loadState 分支此后共用同一起点。这里锁的仍是同一条语义
    // ——状态切换不许跳版——只是判据从「每块都写对同一个偏移」变成「谁都不许自带偏移」。
    assert.match(ruleBody(src.wxss, '.dc-page'), /flex-direction:\s*column/,
      '.dc-page 不再是 flex 列,让位块与状态块就不会依次排布,偏移语义失效');
    // 2026-08-20 标题统一:标题移入 cy-nav-bar(title="店铺装修"),tag 允许带属性
    assert.match(wxml,
      /<cy-nav-bar\b[^>]*\/>\s*<view style="height:\s*\{\{statusBarHeight \+ navBarHeight\}\}px;[^"]*"><\/view>/,
      '导航之后必须紧跟唯一一块 statusBarHeight + navBarHeight 的让位,否则正文会压在固定导航下');
    const offsets = wxml.match(/\{\{statusBarHeight \+ navBarHeight\}\}/g) || [];
    assert.equal(offsets.length, 1,
      `顶部让位必须只有一处(现 ${offsets.length} 处):多写一处就是重复让位/状态间跳版`);
    for (const state of ['loading', 'error', 'empty']) {
      const m = branchTag(src.wxml, state, state === 'loading' ? 'if' : 'elif');
      assert.ok(m, `找不到 ${state} 分支`);
      assert.ok(!/(margin|padding)-top:/.test(m[0]),
        `${state} 状态块自带了顶部偏移,与共用让位叠加 ⇒ 状态切换重新跳版:${m[0]}`);
    }
    const ok = wxml.match(/<scroll-view[^>]*wx:elif="\{\{loadState === 'ok' && m\}\}"[^>]*>/);
    assert.ok(ok, "找不到 wx:elif=\"{{loadState === 'ok' && m}}\" 正文滚动区");
    assert.ok(!/(margin|padding)-top:|height:\s*calc/.test(ok[0]),
      `正文滚动区自带顶部偏移或写死高度,会与共用让位叠加 ⇒ 与三种状态块不同起点:${ok[0]}`);
    assert.match(ruleBody(src.wxss, '.dc-scroll'), /flex:\s*1/,
      '正文滚动区必须靠 flex:1 吃掉让位之后的剩余高度,不能自己算 100vh 减法');
  },
};

// ── 变异副本:每个变异必须让指定断言判红 ────────────────────────────────────
const replaceOnce = (s, from, to) => {
  assert.ok(s.includes(from), `变异锚点失效(源码已改动?):${JSON.stringify(from.slice(0, 70))}`);
  return s.replace(from, to);
};
// 只在指定选择器的规则体内变异。
// ⚠️ 这个 helper 不是多余的:`background: var(--cy-color-bg-surface)` 在本文件里出现多次
// (.dc-meter / .dc-sec 都用它),全局 replace 会打到别的规则上,变异对目标断言变成空操作
// ⇒ 负控自己"没红"却误报成"断言是橡皮图章"。首版就踩了这个坑,由负控当场抓出。
const mutateInRule = (wxss, selector, from, to) => {
  const head = wxss.indexOf(selector + ' {');
  assert.ok(head >= 0, `变异锚点失效:找不到 ${selector}`);
  const tail = wxss.indexOf('}', head) + 1;
  const body = wxss.slice(head, tail);
  assert.ok(body.includes(from), `变异锚点失效:${selector} 里没有 ${JSON.stringify(from)}`);
  return wxss.slice(0, head) + body.replace(from, to) + wxss.slice(tail);
};

const MUTANTS = [
  {
    targets: 'loadingHasOwnClass',
    why: 'loading 分支撤回专用 class,退化成与 error/empty 同样居中',
    apply: (s) => ({ ...s, wxml: replaceOnce(s.wxml, `class="dc-state ${LOADING_CLASS}"`, 'class="dc-state"') }),
  },
  {
    targets: 'loadingClassOverridesCenter',
    why: '变体的 justify-content 改回 center(跳版复发)',
    apply: (s) => ({ ...s, wxss: mutateInRule(s.wxss, '.' + LOADING_CLASS, 'justify-content: flex-start;', 'justify-content: center;') }),
  },
  {
    targets: 'loadingClassOverridesCenter',
    why: '变体的 min-height 改回 60vh(60vh 继续把骨架往下推)',
    apply: (s) => ({ ...s, wxss: mutateInRule(s.wxss, '.' + LOADING_CLASS, 'min-height: 0;', 'min-height: 60vh;') }),
  },
  {
    targets: 'genericStateStillCentered',
    why: '通用 .dc-state 的 flex:1 被拆掉(吃不到剩余高度,error/empty 会跟着变形)',
    apply: (s) => ({ ...s, wxss: mutateInRule(s.wxss, '.dc-state', 'flex: 1;', 'flex: initial;') }),
  },
  {
    targets: 'genericStateStillCentered',
    why: 'error 分支的 cy-error 漏传 fill,不在剩余空间居中',
    apply: (s) => {
      const before = s.wxml;
      const after = before.replace(/(<cy-error\b[^>]*)\bfill\b\s*/, '$1');
      assert.notEqual(after, before, '变异锚点失效:找不到 <cy-error ... fill ...>');
      return { ...s, wxml: after };
    },
  },
  {
    targets: 'genericStateStillCentered',
    why: 'loading 专用变体被误挂到 empty 分支上',
    apply: (s) => ({
      ...s,
      wxml: replaceOnce(s.wxml, `<view class="dc-state" wx:elif="{{loadState === 'empty'}}"`,
        `<view class="dc-state ${LOADING_CLASS}" wx:elif="{{loadState === 'empty'}}"`),
    }),
  },
  {
    targets: 'skeletonWrappedInSurface',
    why: '拆掉卡面承托,骨架直接落回页面灰底',
    apply: (s) => ({
      ...s,
      wxml: replaceOnce(s.wxml, `<view class="${CARD_CLASS}"><cy-skeleton type="detail" style="--cy-map-h: 403.8rpx;" /></view>`,
        '<cy-skeleton type="detail" />'),
    }),
  },
  {
    targets: 'skeletonHeroMatchesCover',
    why: '移除页面专用 hero 高度,detail 骨架退回 520rpx 造成加载完成跳动',
    apply: (s) => ({ ...s, wxml: replaceOnce(s.wxml, ' style="--cy-map-h: 403.8rpx;"', '') }),
  },
  {
    targets: 'surfaceUsesTokenAndNoRawColor',
    why: '承托底色改成裸 hex 白(绕开 DS token)',
    apply: (s) => ({ ...s, wxss: mutateInRule(s.wxss, '.' + CARD_CLASS, 'background: var(--cy-color-bg-surface);', 'background: #FFFFFF;') }),
  },
  {
    targets: 'surfaceUsesTokenAndNoRawColor',
    why: '承托底色改成裸 rgba(绕开 DS token)',
    apply: (s) => ({ ...s, wxss: mutateInRule(s.wxss, '.' + CARD_CLASS, 'background: var(--cy-color-bg-surface);', 'background: rgba(255,255,255,1);') }),
  },
  {
    targets: 'surfaceClipsHero',
    why: '去掉 overflow:hidden(骨架 hero 方角戳出卡片圆角)',
    apply: (s) => ({ ...s, wxss: mutateInRule(s.wxss, '.' + CARD_CLASS, 'overflow: hidden;', '') }),
  },
  {
    targets: 'pageLayerDoesNotForkSkeletonTokens',
    why: '在页面层偷偷重定义 skeleton 变量(与全站骨架分叉)',
    apply: (s) => ({ ...s, wxss: s.wxss + '\n.dc-state--skeleton { --cy-color-skeleton-highlight: #E0E4EA; }\n' }),
  },
  {
    targets: 'navBarHeightUsesTitleBandOnly',
    why: '把 statusBarHeight 混回 navBarHeight，WXML 会再次重复计算状态栏高度',
    apply: (s) => ({ ...s, js: replaceOnce(s.js,
      'navBarHeight: app.globalData.navBarHeight || 44',
      'navBarHeight: (sys.statusBarHeight || 20) + 44') }),
  },
  {
    targets: 'navBarHeightUsesTitleBandOnly',
    why: '只让 loading 状态块自带一套顶部偏移，与共用让位叠加后状态切换会重新跳版',
    apply: (s) => ({ ...s, wxml: replaceOnce(s.wxml,
      `<view class="dc-state ${LOADING_CLASS}" wx:if="{{loadState === 'loading'}}">`,
      `<view class="dc-state ${LOADING_CLASS}" style="margin-top: 44px;" wx:if="{{loadState === 'loading'}}">`) }),
  },
  {
    targets: 'navBarHeightUsesTitleBandOnly',
    why: '删掉共用让位块，正文与四态一起压回固定导航底下',
    apply: (s) => ({ ...s, wxml: replaceOnce(s.wxml,
      '<view style="height: {{statusBarHeight + navBarHeight}}px; flex-shrink: 0;"></view>\n', '') }),
  },
  {
    targets: 'navBarHeightUsesTitleBandOnly',
    why: '正文滚动区自己再算一次 100vh 减法，与共用让位叠加成双份留白',
    apply: (s) => ({ ...s, wxml: replaceOnce(s.wxml,
      `<scroll-view scroll-y class="dc-scroll" enhanced show-scrollbar="{{false}}" wx:elif="{{loadState === 'ok' && m}}">`,
      `<scroll-view scroll-y class="dc-scroll" style="height: calc(100vh - {{statusBarHeight + navBarHeight}}px);" enhanced show-scrollbar="{{false}}" wx:elif="{{loadState === 'ok' && m}}">`) }),
  },
  {
    targets: 'navBarHeightUsesTitleBandOnly',
    why: '.dc-page 不再是 flex 列，让位块与状态块不再依次排布',
    apply: (s) => ({ ...s, wxss: mutateInRule(s.wxss, '.dc-page', 'flex-direction: column;', 'flex-direction: row;') }),
  },
];

// ── 绿:真实源码必须全过 ────────────────────────────────────────────────────
for (const [id, fn] of Object.entries(CHECKS)) {
  test(`绿 · ${id}:真实源码通过`, () => { fn(SRC); });
}

// ── 红:每个变异副本必须让对应断言抛错(证明断言不是恒真) ──────────────────
MUTANTS.forEach((m, i) => {
  test(`红 · 负控${i + 1} ${m.why} ⇒ ${m.targets} 必须判红`, () => {
    const mutated = m.apply(SRC);
    assert.throws(() => CHECKS[m.targets](mutated), assert.AssertionError,
      `变异后 ${m.targets} 仍然通过 —— 这条断言是恒真的橡皮图章`);
    // 变异只在内存里,不能污染真实源码
    CHECKS[m.targets](SRC);
  });
});

// ── 前提复核:哪天 DS 层把浅端 highlight 调深了,本页的卡面承托就可以撤 ──────
test('前提复核:卡面承托相对页面底仍有正收益(前提已于 2026-08-10 翻转,详见内注)', () => {
  const pick = (name) => {
    const m = SRC.merchantLight.match(new RegExp('--' + name + ':\\s*(#[0-9A-Fa-f]{6})'));
    assert.ok(m, `merchant-light.wxss 里找不到 --${name}`);
    const h = m[1].slice(1);
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  };
  const dist = (a, b) => a.reduce((n, v, i) => n + Math.abs(v - b[i]), 0);
  const hl = pick('cy-color-skeleton-highlight');
  const onPage = dist(hl, pick('cy-color-bg-page'));
  const onCard = dist(hl, pick('cy-color-bg-surface'));
  // 2026-08-10 前提翻转:页面底由 #F9F9F9 改到 #F3F4F4(深 6 级)后,高光相对页面底
  // 从 5 级拉到 13 级 —— 「在灰底上几乎看不见」这个原始前提**已经不成立**,承托的
  // 收益也从 4.2x 掉到 1.6x。没有当场撤掉承托,是因为 .dc-skel-card 的 overflow:hidden
  // 另有用处(裁 cy-skeleton .sk-hero 的方角),整块删会带回方角;且撤除是视觉改动,
  // 应当配一次真机/模拟器复核再做 —— 记在这里,别让它烂成无人认领的冗余。
  // 哨兵降级但没关掉:只要承托还有正收益(onCard > onPage)就放行;哪天它变成负收益,
  // 说明卡面反而更糟,那时必须撤。
  assert.ok(onCard > onPage,
    `卡面承托已是负收益:高光相对卡面 ${onCard} 级 ≤ 相对页面底 ${onPage} 级,` +
    '必须撤掉 .dc-skel-card 的 background(overflow:hidden 保留)');
});
