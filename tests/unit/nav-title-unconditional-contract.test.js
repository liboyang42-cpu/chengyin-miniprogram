const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

/**
 * 2026-08-04 标题体系拍板配套门禁。
 *
 * 姊妹门禁 title-system-owner-contract.test.js 盘的是「文件里有没有 cy-nav-bar / cy-page-title」，
 * 它抓不到这一类：标签写了，但被包在只覆盖部分状态的 wx:if 里 —— 加载/空/错这三态一进去，
 * 标题和返回出口就整段消失。终审 §3 P1-4 记的多条「标题或返回出口失效」正是这个形状，
 * 而静态存在性检查对它恒绿。
 *
 * 这条门禁扫「祖先链里有条件的 nav/title」，白名单只收互斥分支各自完整的合法形态。
 */

// 合法形态白名单：每条都要写清为什么这个条件分支不会让标题/返回消失
const ALLOWED = [
  /* 试玩玩法屏时整条导航让位:玩法壳(cy-play-stage)自己在同一位置画「退出」,
     两个返回出口会叠在一起,而且那条白底会把深色的玩法屏框成一张卡。
     ⚠️ 这一支不是「某个状态没有返回出口」—— 条件为真的那一态由玩法壳提供出口,
     其余所有态(编辑、加载、错误、预览的到达/完成步)都走无条件的 cy-nav-bar。 */
  `pages/publish/temp/index | cy-nav-bar | 自带 wx:if="{{ !(previewVisible && pvKit && pvStepKey === 'challenge') }}"`,
  // 同一路由承载两种页面形态：selecting 是场次选择页（有标题），wx:else 是二维码凭证组件
  // （cy-qr-voucher 自带视觉主体，不套 page-title）。返回钮在条件外无条件渲染（见
  // secondary-nav-consistency.test.js 的 assertBackOutsideCondition），出口不会丢。
  'pages/club/group-code/index | cy-page-title | <view wx:if="{{state === \'selecting\' || state === \'empty\'}}">',
  // invalid 与 selecting/empty 是同一团码页的互斥终态；invalid 分支有自己的标题，
  // ready/error 则由 cy-qr-voucher 呈现凭证标题。全态共用的返回钮仍在条件容器外。
  'pages/club/group-code/index | cy-page-title | <view wx:elif="{{state === \'invalid\'}}">',
  // E-12(2026-09-16)：无权限是新增的互斥终态（原来落通用 error 态给重试），该分支自带
  // 「团核销码」标题与「进入俱乐部管理」出口；返回钮同样在条件容器外，不存在裸奔态。
  'pages/club/group-code/index | cy-page-title | <view wx:elif="{{state === \'no-permission\'}}">',
  // 正常用户数据交给 cy-profile（组件内自带完整导航与标题）；仅缺失 userId 时走
  // wx:else 的可恢复错误页，并在该分支显式补齐返回出口与“个人主页”标题。
  'pages/userinfo/userinfo | cy-nav-bar | <view wx:else>',
  'pages/userinfo/userinfo | cy-page-title | <view wx:else>',
  // 三分支互斥：host / join 两态的导航 2026-08-05 随视图一起搬进 project-host、
  // project-join 组件（两个组件里都是无条件的 cy-nav-bar），页面上只剩浏览态这一支。
  // 任何一态都有导航，不存在裸奔态。
  'pages/topic/merchantinfo/merchantinfo | cy-nav-bar | <view wx:if="{{ fromMerchantJoin }}">',
  // 2026-09-16 缺参态:id 与 topicId 都没有时(截图冒烟:原先渲染「未命名路线」空壳),
  // 该分支自带 cy-nav-bar + cy-page-title 与「返回上一页」出口;其余三态(承接/主办/浏览)
  // 的导航各自在 project-join / project-host 组件内或浏览视图里无渲染,四态都不丢标题与返回。
  'pages/topic/merchantinfo/merchantinfo | cy-nav-bar | <block wx:if="{{ missingParam }}">',
  // 标签自带条件的 if/else 对偶：错误态用标准 cy-nav-bar（深底箭头可见），
  // 正常态走 wx:else 的 hero 顶栏自绘导航。两态都有返回出口。
  'pages/topic/index/index | cy-nav-bar | 自带 wx:if="{{loadError}}"',
  // 客户详情的 L1 大标题就是这位客户的名字 —— 数据没回来时它不存在,写死一个占位标题
  // 反而是假信息(Figma K2-D 无权限 / K2-E 加载失败两态里也只有导航,没有大标题)。
  // 返回出口 cy-nav-bar 在条件之外无条件渲染,四态都退得出去。
  'pages/club/customer-detail/index | cy-page-title | <block wx:elif="{{state === \'ready\'}}">',
  // intro(四步之前的开场屏)与 form 是互斥两态，各自都有标题：开场屏用自己的 .intro__title
  // 大标题（同一档字号），form 才用 cy-page-title 渲染每步问句。cy-nav-bar 在条件之外
  // 无条件渲染，两态的返回出口都不丢。2026-09-06 加开场屏时新增。
  'pages/club/apply/index | cy-page-title | <view wx:if="{{mode !== \'intro\'}}">',
  // 2026-09-18 「凭证弹层只留✕」用户裁决:以下四页的全屏 cy-qr-voucher 显示时整条
  // cy-nav-bar 退场 —— 返回钮浮在弹层遮罩上就是与✕并存的双出口。弹层态出口=✕(绑同一
  // onClose,深链安全逻辑不变);其余所有态(缺参/结果/正常页身)导航照常无条件渲染。
  `subpackageRoam/citynode-code/index | cy-nav-bar | 自带 wx:if="{{state === 'missing'}}"`,
  `subpackageMember/coupon-qr/index | cy-nav-bar | 自带 wx:if="{{!(entryState === 'ready' && useStatus == 0)}}"`,
  `pages/club/detail/index | cy-nav-bar | 自带 wx:if="{{!(groupCodeVisible && groupCodeState !== 'selecting')}}"`,
  `pages/merchant/game-node/index | cy-nav-bar | 自带 wx:if="{{!checkinVisible}}"`,
]

const TAGS = ['cy-nav-bar', 'cy-page-title']

const CONDITION_ATTR = /wx:(?:if|elif|else)(?:="[^"]*")?/

/**
 * 极简 wxml 标签栈解析：返回每个 tagName 出现处的条件来源。
 * 两轴都要扫，缺一即假绿：
 *   ① 祖先链上带 wx:if/elif/else 的元素；
 *   ② 标签自己带 wx:if/elif/else。
 */
function conditionalSources(source, tagName) {
  const found = []
  const stack = []
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g
  let m
  while ((m = re.exec(source))) {
    const [, close, name, attrs, selfClosing] = m
    if (close) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === name) { stack.length = i; break }
      }
      continue
    }
    if (name === tagName) {
      const own = attrs.match(CONDITION_ATTR)
      if (own) found.push(`自带 ${own[0]}`)
      const conds = stack.filter((s) => s.cond)
      if (conds.length) found.push(conds.map((c) => `<${c.name} ${c.cond}>`).join(' > '))
      continue
    }
    if (selfClosing) continue
    const cond = attrs.match(CONDITION_ATTR)
    stack.push({ name, cond: cond ? cond[0] : null })
  }
  return found
}

function scanRoute(route, source) {
  return TAGS.flatMap((tag) =>
    conditionalSources(source, tag).map((chain) => `${route} | ${tag} | ${chain}`))
}

function allRoutes() {
  const app = JSON.parse(read('app.json'))
  return app.pages.concat(app.subPackages.flatMap((pkg) => pkg.pages.map((page) => `${pkg.root}/${page}`)))
}

test('导航与页标题不得被裹进只覆盖部分状态的条件分支', () => {
  const routes = allRoutes()
  assert.ok(routes.length >= 100, `路由盘点疑似漏读,只拿到 ${routes.length} 条`)

  const actual = routes.flatMap((route) => scanRoute(route, read(`${route}.wxml`))).sort()
  assert.deepEqual(
    actual,
    ALLOWED.slice().sort(),
    '出现了新的条件化 nav/title。若确属互斥分支各自完整,补进 ALLOWED 并写明理由;'
      + '否则把 cy-nav-bar / cy-page-title 提到条件之外——否则加载/空/错态会整段丢标题和返回出口。',
  )
})

test('负控:把 cy-nav-bar 挪进错误分支时必须判红', () => {
  const source = read('pages/mylike/mylike.wxml')
  assert.equal(scanRoute('probe', source).length, 0, '基线页本应无条件渲染 nav/title,变异锚点失效')

  const mutated = source.replace(
    '<cy-nav-bar />',
    '<view wx:if="{{!errorMsg}}"><cy-nav-bar /></view>',
  )
  assert.notEqual(mutated, source, '变异锚点失效')
  const hits = scanRoute('probe', mutated)
  assert.equal(hits.length, 1, '扫描器必须抓到被条件包住的 cy-nav-bar')
  assert.match(hits[0], /cy-nav-bar \| <view wx:if/)
})

test('负控:把 wx:if 直接写在 cy-page-title 标签上时必须判红', () => {
  // 这一轴单独负控:只扫祖先链会漏掉标签自带条件,而那同样让标题在部分状态整段消失。
  const source = read('pages/mylike/mylike.wxml')
  // ⚠️ 锚点别写死整行:原来锚 '<cy-page-title class="c1-page-title" title="我的收藏" />'，
  // 2026-08-06 给它加了 safe-top="{{false}}" 就匹配不上 —— 变异没生效、负控静默变绿，
  // 而第 116 行那句 '变异锚点失效' 正是为这种情况留的。改成只锚标签开头，不管属性怎么排。
  const mutated = source.replace(/<cy-page-title\b/, '<cy-page-title wx:if="{{!errorMsg}}"')
  assert.notEqual(mutated, source, '变异锚点失效')
  const hits = scanRoute('probe', mutated)
  assert.equal(hits.length, 1, '扫描器必须抓到标签自带的 wx:if')
  assert.match(hits[0], /cy-page-title \| 自带 wx:if/)
})

test('负控:标签自闭合与属性里的尖括号不得让扫描器漏判', () => {
  const tricky = '<view wx:if="{{a>b}}"><image src="x" /><cy-page-title title="标题" /></view>'
  const hits = scanRoute('probe', tricky)
  assert.equal(hits.length, 1, '自闭合的 <image /> 不应污染标签栈,条件祖先仍须被识别')
})
