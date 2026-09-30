/* cy-sheet / cy-modal 退场动画契约(2026-08-21)
 *
 * 机制:show 置 false 时组件不再直接卸载,而是先挂 --closing 类播退场动画,
 * behaviors/exit-motion.js 的定时器到点才把内部 _render 置 false 真正卸载。
 *
 * 锁四件事:
 *   ① wx:if 走内部 _render 而不是外部 show(直连 show = 瞬间消失,退场没机会播);
 *   ② closing 类接了退场 keyframes 且 forwards 停在末帧;
 *   ③ 退场时长 < 进场时长 —— DS 文档3 §B.1「上限 ~300ms;进场慢、退场快(exit 比 enter 快 ~20%)」;
 *   ④ 传给 exitMotion() 的毫秒数 == wxss 里那条退场 token 的值(WXSS 变量 JS 读不到,
 *      两处各留一份;漂移会让「动画没播完就卸载」或「播完还多等一拍」)。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

const DS_EXIT_CAP_MS = 300   // DS 文档3 §B.1 的模态/抽屉上限

function tokenMs(tokens, name) {
  const m = tokens.match(new RegExp('--cy-motion-' + name + ':\\s*(\\d+)ms'))
  assert.ok(m, `tokens.wxss 里找不到 --cy-motion-${name}`)
  return Number(m[1])
}

/** 从一条 animation 声明里取出它读的 --cy-motion-* 档名 */
function motionTokenOf(rule, what) {
  const m = rule.match(/var\(--cy-motion-([a-z-]+)\)/)
  assert.ok(m, `${what} 的时长必须读 --cy-motion-* token,不许写死数值`)
  return m[1]
}

function assertExitMotion({ wxml, js, wxss, behavior, tokens, closingClass, enterKeyframe, exitKeyframes }) {
  /* 2026-09-01:先剥注释再扫规则。下面那条 `\.closingClass[^{]*\{[^}]*\}` 遇到注释里
     出现的类名会从注释一路吞到**下一条规则**的花括号里,把不相干的规则当成退场规则判红
     (实测:cy-sheet 里一句解释「压过 .sh--closing / .sh--morph」的注释,让 sh--dragging
     那条 animation:none 被当成缺 forwards 的退场动画)。假阳性和假阴性都由此而来 ——
     注释里同样能写出 `forwards` 骗过它。 */
  wxss = wxss.replace(/\/\*[\s\S]*?\*\//g, '')
  // ① 根节点由内部 _render 控制
  assert.match(wxml, /wx:if="\{\{_render\}\}"/, '根节点必须由内部 _render 控制卸载')
  assert.doesNotMatch(wxml, /wx:if="\{\{show\}\}"/, '根节点不能再直接用外部 show 卸载(会瞬间消失)')
  assert.ok(wxml.includes(`_closing ? '${closingClass}'`), `根节点必须绑定 ${closingClass}`)

  // ② closing 类接退场动画,forwards 停在末帧(否则卸载前会闪回)
  for (const kf of exitKeyframes) {
    assert.match(wxss, new RegExp('@keyframes ' + kf + '\\b'), `缺 @keyframes ${kf}`)
  }
  const closingRules = (wxss.match(new RegExp('\\.' + closingClass + '[^{]*\\{[^}]*\\}', 'g')) || [])
    .filter((rule) => /animation:/.test(rule))
  assert.ok(closingRules.length >= 2, `${closingClass} 必须同时驱动面板和遮罩退场`)
  const exitTokens = new Set()
  for (const r of closingRules) {
    assert.match(r, /forwards/, `${closingClass} 的退场动画必须 forwards 停在末帧`)
    exitTokens.add(motionTokenOf(r, '退场'))
  }
  assert.equal(exitTokens.size, 1, '面板与遮罩的退场时长必须同档,否则遮罩先没了面板还在')
  const exitToken = [...exitTokens][0]
  const exitMs = tokenMs(tokens, exitToken)

  // ③ 退场必须比进场快,且不超 DS 上限
  const enterRule = wxss.match(new RegExp('animation:\\s*' + enterKeyframe + '[^;]*;'))
  assert.ok(enterRule, `找不到进场动画 ${enterKeyframe} 的声明`)
  const enterMs = tokenMs(tokens, motionTokenOf(enterRule[0], '进场'))
  assert.ok(
    exitMs < enterMs,
    `DS 文档3 §B.1「进场慢、退场快」:退场 ${exitMs}ms 必须快于进场 ${enterMs}ms`,
  )
  assert.ok(exitMs <= DS_EXIT_CAP_MS, `DS 文档3 §B.1 上限 ~300ms:退场 ${exitMs}ms 超了`)

  // ④ 组件传给 exitMotion 的毫秒数 == 退场 token 值
  const wired = js.match(/exitMotion\((\d+)\)/)
  assert.ok(wired, '组件必须挂 exitMotion(<ms>) behavior')
  assert.equal(
    Number(wired[1]), exitMs,
    `exitMotion(${wired[1]}) 与 --cy-motion-${exitToken}(${exitMs}ms)漂移了,两处必须同步`,
  )
  assert.match(js, /behaviors:\s*\[[^\]]*reducedMotionBehavior/, '必须同时挂 reduced-motion,否则 behavior 读不到 reducedMotion')
  assert.match(wxss, new RegExp('\\.' + closingClass + '\\s*\\{[^}]*pointer-events:\\s*none'), '退场开始后必须冻结点击')
  assert.match(js, /if\s*\(this\.data\._closing\)\s*return/, '事件处理器必须在退场期间拒绝重复触发')

  // behavior 本体:减动效立即卸载、重开/销毁清定时器
  assert.match(behavior, /reducedMotion[\s\S]{0,120}_render:\s*false/, 'reducedMotion 时必须立即卸载,不能空等动画时长')
  assert.match(behavior, /clearTimeout\(this\._exitTimer\)/, '重新打开/销毁时必须清退场定时器')
  assert.match(behavior, /detached\(\)[\s\S]{0,120}clearTimeout/, '组件销毁必须清定时器')
}

function sheetArgs(overrides) {
  return Object.assign({
    wxml: read('components/cy/sheet/index.wxml'),
    js: read('components/cy/sheet/index.js'),
    wxss: read('components/cy/sheet/index.wxss'),
    behavior: read('behaviors/exit-motion.js'),
    tokens: read('style/tokens.wxss'),
    closingClass: 'sh--closing',
    enterKeyframe: 'sh-up',
    exitKeyframes: ['sh-down', 'sh-fade-out'],
  }, overrides)
}

// 2026-08-25 cy-date-sheet 并入本契约:它此前既没有遮罩也没有进出场动画
// (display:none → block 瞬间闪现,上半屏还能点穿),全仓 11 处时间选择器都受影响。
function dateSheetArgs(overrides) {
  return Object.assign({
    wxml: read('components/cy/date-sheet/index.wxml'),
    js: read('components/cy/date-sheet/index.js'),
    wxss: read('components/cy/date-sheet/index.wxss'),
    behavior: read('behaviors/exit-motion.js'),
    tokens: read('style/tokens.wxss'),
    closingClass: 'ds--closing',
    enterKeyframe: 'ds-up',
    exitKeyframes: ['ds-down', 'ds-fade-out'],
  }, overrides)
}

function modalArgs(overrides) {
  return Object.assign({
    wxml: read('components/cy/modal/index.wxml'),
    js: read('components/cy/modal/index.js'),
    wxss: read('components/cy/modal/index.wxss'),
    behavior: read('behaviors/exit-motion.js'),
    tokens: read('style/tokens.wxss'),
    closingClass: 'mo--closing',
    enterKeyframe: 'mo-pop',
    exitKeyframes: ['mo-pop-out', 'mo-fade-out'],
  }, overrides)
}

test('cy-sheet:关闭先播 sh-down 再卸载,且退场快于进场', () => {
  assertExitMotion(sheetArgs())
})

test('cy-modal:关闭先播 mo-pop-out 再卸载,且退场快于进场', () => {
  assertExitMotion(modalArgs())
})

test('cy-date-sheet:关闭先播 ds-down 再卸载,且退场快于进场', () => {
  assertExitMotion(dateSheetArgs())
})

function assertDateSheetMask({ wxml, js, wxss }) {
  // 没有遮罩时,面板只贴在屏幕底部,上半屏可以直接点到背后的表单/导航。
  assert.match(wxml, /class="ds__mask"[^>]*bindtap="onMask"/, '时间选择面板必须有可点的遮罩层')
  assert.match(wxss, /\.ds__mask\s*\{[^}]*position:\s*absolute[^}]*\}/, '遮罩必须铺满定位层')
  assert.match(wxss, /\.ds\s*\{[^}]*inset:\s*0/, '根节点必须是全屏定位层,否则遮不住上半屏')
  // 半截的滚轮值不该被当成用户的选择落下去。
  assert.match(js, /onMask\(\)[\s\S]{0,220}triggerEvent\('cancel'\)/, '点遮罩必须触发 cancel,不能触发 confirm')
  assert.match(wxml, /catchtap="noop"/, '面板本身必须吃掉点击,不能冒泡到遮罩把自己关掉')
}

function dateSheetMaskArgs(overrides) {
  return Object.assign({
    wxml: read('components/cy/date-sheet/index.wxml'),
    js: read('components/cy/date-sheet/index.js'),
    wxss: read('components/cy/date-sheet/index.wxss'),
  }, overrides)
}

test('cy-date-sheet:必须有遮罩,且点遮罩走取消而不是确认', () => {
  assertDateSheetMask(dateSheetMaskArgs())
})

test('负控:把 cy-date-sheet 的遮罩摘掉必须判红', () => {
  const wxml = read('components/cy/date-sheet/index.wxml').replace(/<view class="ds__mask"[\s\S]*?><\/view>/, '')
  assert.doesNotMatch(wxml, /ds__mask/, '负控锚点失效:date-sheet 里没有遮罩节点')
  assert.throws(() => assertDateSheetMask(dateSheetMaskArgs({ wxml })), assert.AssertionError)
})

test('负控:点遮罩改成 confirm 必须判红', () => {
  const js = read('components/cy/date-sheet/index.js')
    .replace(/(onMask\(\)[\s\S]{0,220}?)triggerEvent\('cancel'\)/, "$1triggerEvent('confirm')")
  assert.throws(() => assertDateSheetMask(dateSheetMaskArgs({ js })), assert.AssertionError)
})


test('负控:把根节点改回 wx:if="{{show}}" 必须判红', () => {
  const wxml = read('components/cy/sheet/index.wxml').replace('wx:if="{{_render}}"', 'wx:if="{{show}}"')
  assert.throws(() => assertExitMotion(sheetArgs({ wxml })))
})

test('负控:exitMotion 的毫秒数与 token 漂移必须判红', () => {
  const js = read('components/cy/modal/index.js').replace(/exitMotion\(\d+\)/, 'exitMotion(300)')
  assert.throws(() => assertExitMotion(modalArgs({ js })))
})

test('负控:退场时长退回与进场同档(违反「退场快」)必须判红', () => {
  // 把退场档原样换成**进场那一档** —— 正是本轮修掉的那个缺陷。
  // ⚠️ 锚点钉结构不钉字面量:2026-09-02 退场档从 --cy-motion-standard 改成
  //    --cy-motion-sheet-out(稿 41:117 的 250ms),原来写死 standard 的 replace 会静默失配,
  //    变异没发生、断言却照样抛(抛在别的分支上),负控就变成了自欺。
  //    现在先从进场声明里读出进场档名,再把退场档整体替换成它,并断言变异真的发生了。
  const rawWxss = read('components/cy/sheet/index.wxss')
  const enterToken = rawWxss.match(/animation:\s*sh-up\s+var\(--cy-motion-([a-z-]+)\)/)
  assert.ok(enterToken, '负控锚点失效:找不到 sh-up 的进场时长声明')
  const wxss = rawWxss.replace(
    /(\.sh--closing[^{]*\{[^}]*)var\(--cy-motion-[a-z-]+\)/g,
    `$1var(--cy-motion-${enterToken[1]})`,
  )
  assert.notEqual(wxss, rawWxss, '负控锚点失效:退场规则没有被改写')
  const enterMs = tokenMs(read('style/tokens.wxss'), enterToken[1])
  const js = read('components/cy/sheet/index.js').replace(/exitMotion\(\d+\)/, `exitMotion(${enterMs})`)
  assert.throws(() => assertExitMotion(sheetArgs({ wxss, js })), /退场快|超了/)
})

test('负控:摘掉 reduced-motion behavior 必须判红(behavior 会读不到 reducedMotion)', () => {
  const js = read('components/cy/modal/index.js').replace('reducedMotionBehavior, exitMotion', 'exitMotion')
  assert.throws(() => assertExitMotion(modalArgs({ js })))
})
