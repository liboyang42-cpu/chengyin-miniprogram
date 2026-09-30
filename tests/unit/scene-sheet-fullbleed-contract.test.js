const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

// 2026-08-10:cy-scene-sheet 的面板必须满宽。曾经 .ss__stack 上挂着
// max-width: var(--cy-comp-sheet-width)(392.975px = iPhone 14 画板宽),面板自己
// width:100% 于是跟着被夹住;.ss 是 flex 且 justify-content 取默认 flex-start ⇒
// 整叠卡靠左,屏宽 >393px 的机器右侧露出底层页(实测 412px 露 19px、430px 露 37px、
// 440px 露 47px)。390px 及以下不触发 —— 所以模拟器和 234 张历史截图全绿,只有真机报。
// 53 个注册场景共用这一条规则,一处写错=全站弹窗一起坏,所以在源码层锁死。

// 面板宽度链路 = .ss(定位容器)→ .ss__stack(叠卡容器)→ .ss__panel(面板本体)。
// 判某条规则是否落在链路上:逗号组要逐支判(`.ss__stack, .foo { }` 里两支都得看),
// 每支只看最后一个复合项,避免 `.ss--player .xx` 这类后代规则被误判。
function isOnWidthChain(selector) {
  return selector.split(',').some((branch) => {
    const last = branch.trim().split(/\s+|>/).filter(Boolean).pop() || ''
    return (
      last.includes('ss__stack') ||
      last.includes('ss__panel') ||
      /^\.ss(--[a-z0-9-]+)*$/.test(last)
    )
  })
}

// 允许的宽度写法:满宽或不表态。其余(定长 px/rpx、var(...)、fit-content…)都会把
// 面板夹窄,一律算命中。
const HARMLESS = /^(100%|none|auto|inherit|initial|unset)$/
// 横向外边距同样会把面板做窄、露出同一条缝(面板是 box-sizing:border-box,padding 不会,
// 所以只管 margin)。0 是没表态,放行。
const MARGIN_PROPS = new Set(['margin-left', 'margin-right', 'margin-inline', 'margin-inline-start', 'margin-inline-end'])
const ZERO_MARGIN = /^(0|0px|0rpx|auto)$/

function findWidthClamps(wxss) {
  const hits = []
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g
  let match
  while ((match = ruleRe.exec(wxss)) !== null) {
    const selector = match[1].replace(/\/\*[\s\S]*?\*\//g, '').trim()
    if (!selector || selector.startsWith('@') || !isOnWidthChain(selector)) continue
    for (const decl of match[2].split(';')) {
      const [rawProp, ...rest] = decl.split(':')
      const prop = rawProp.replace(/\/\*[\s\S]*?\*\//g, '').trim()
      const value = rest.join(':').trim()
      if (prop === 'width' || prop === 'max-width') {
        if (!HARMLESS.test(value)) hits.push(`${selector} { ${prop}: ${value} }`)
      } else if (MARGIN_PROPS.has(prop)) {
        if (!ZERO_MARGIN.test(value)) hits.push(`${selector} { ${prop}: ${value} }`)
      }
    }
  }
  return hits
}

test('cy-scene-sheet 面板宽度链路上不得有定长夹宽(否则宽屏真机右侧露底层页)', () => {
  const hits = findWidthClamps(read('components/cy/scene-sheet/index.wxss'))
  assert.deepEqual(
    hits,
    [],
    '.ss / .ss__stack / .ss__panel 只能满宽。--cy-comp-sheet-width 是核稿参考值,\n' +
      '不是布局约束,挂上去会让 >393px 的机器右侧漏出底层页面:\n' +
      hits.join('\n'),
  )
})

// 负控:门禁必须能判红,不然它只是个恒真断言。
test('夹宽检测器自证:能判红也能判绿', () => {
  const clamped = '.ss__stack { width: 100%; max-width: var(--cy-comp-sheet-width); }'
  assert.deepEqual(
    findWidthClamps(clamped),
    ['.ss__stack { max-width: var(--cy-comp-sheet-width) }'],
    '检测器漏掉了真实回归形态(2026-08-10 那次就是这一行)',
  )
  assert.deepEqual(findWidthClamps('.ss__stack { width: 100%; }'), [], '满宽写法不该被误报')
  assert.deepEqual(findWidthClamps('.ss--full .ss__panel { width: 380px; }'), ['.ss--full .ss__panel { width: 380px }'], '带修饰符的后代规则也要认')
  assert.deepEqual(findWidthClamps('.ss--player .ss__title { max-width: 200px; }'), [], '链路以外的子元素限宽是正常排版,不该拦')
  // 下面两条是 2026-08-10 code review 找出的漏网形态,补进负控免得门禁只认历史那一种
  assert.deepEqual(
    findWidthClamps('.ss__stack, .foo { max-width: 360px; }'),
    ['.ss__stack, .foo { max-width: 360px }'],
    '逗号组里只要有一支落在链路上就得认,不能因为最后一支不是链路就整条放过',
  )
  assert.deepEqual(
    findWidthClamps('.ss__panel { margin-right: 40px; }'),
    ['.ss__panel { margin-right: 40px }'],
    '横向外边距会露出同一条缝,和 max-width 等价',
  )
  assert.deepEqual(findWidthClamps('.ss__panel { margin-right: 0; }'), [], 'margin 为 0 是没表态,不该误报')
})
