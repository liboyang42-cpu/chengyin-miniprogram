'use strict'

// P2-A 主题内弹窗五件套(cy-club-topic-*)的结构契约。锚点钉结构(标签名/属性名/绑定表达式),
// 不钉字面量(注释文案改一下就会把钉字面量的断言自己撞红,已在别处踩过两次)。

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** 注释里提到"不许出现 sendRequest"这类解释性文字不算数,只看真代码。 */
function stripJsComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

const COMPONENTS = [
  'club-topic-merchants',
  'club-topic-settings',
  'club-topic-groupcode',
  'club-topic-onboarding',
  'club-topic-end-confirm',
]

// ===================================================================
// J7 商家:合作确认后才展示联系人手机号 —— 判据必须是数据存不存在(station.contact),
// 不能是业务状态(station.status)。前端不是安全边界,但也不能自己在两边都留口子。
// ===================================================================

function assertPhoneGatedByContactPresence(wxml) {
  assert.match(
    wxml,
    /wx:if="\{\{station\.contact\}\}"/,
    '联系人行必须只由 station.contact 有没有值来决定要不要渲染',
  )
  assert.doesNotMatch(
    wxml,
    /wx:if="\{\{station\.status\s*===/,
    '联系人行不能改用 station.status 当判据 —— 状态字段可能和 contact 是否下发不同步,' +
      '真正的安全边界在后端"根本不下发"，前端只能照抄数据存在与否',
  )
}

test('J7 联系人手机号只在 station.contact 存在时渲染', () => {
  const wxml = read('components/cy/club-topic-merchants/index.wxml')
  assertPhoneGatedByContactPresence(wxml)
  // 拨打动作的号码来源必须是 contact.phone,不能是别的("拼出掩码" 之类的招数)
  assert.match(wxml, /data-phone="\{\{station\.contact\.phone\}\}"/)
  const js = read('components/cy/club-topic-merchants/index.js')
  assert.match(js, /makePhoneCall/)
})

test('负控:联系人行改用 station.status 判据必须被判红', () => {
  const wxml = read('components/cy/club-topic-merchants/index.wxml')
  const mutated = wxml.replace(
    'wx:if="{{station.contact}}"',
    'wx:if="{{station.status === \'accepted\'}}"',
  )
  assert.notEqual(mutated, wxml, '负控锚点失效 —— wx:if="{{station.contact}}" 没找到,说明模板结构变了')
  assert.throws(() => assertPhoneGatedByContactPresence(mutated), assert.AssertionError)
})

test('J7 号码脱敏展示与真实号码分离(phoneMasked 用于展示,phone 只喂拨打)', () => {
  const wxml = read('components/cy/club-topic-merchants/index.wxml')
  assert.match(wxml, /station\.contact\.phoneMasked/, '联系人行文案必须走脱敏字段')
})

// ===================================================================
// J4 主题设置:开关不写「已开/已关」文字,只用 cy-switch 的视觉状态表达。
// ===================================================================

test('J4 三个开关都是 cy-switch,且不写「已开/已关」文字', () => {
  const wxml = read('components/cy/club-topic-settings/index.wxml')
  assert.doesNotMatch(wxml, /已开|已关/, 'DS-9 铁律:开关不许配文字状态,视觉本身就是状态')
  assert.match(wxml, /<cy-switch checked="\{\{openForMerchant\}\}"[^>]*bindchange="onOpenForMerchantChange"/)
  assert.match(wxml, /<cy-switch checked="\{\{pinned\}\}"[^>]*bindchange="onPinnedChange"/)
  assert.match(wxml, /<cy-switch checked="\{\{membersOnly\}\}"[^>]*bindchange="onMembersOnlyChange"/)

  const js = read('components/cy/club-topic-settings/index.js')
  assert.match(js, /onOpenForMerchantChange\(e\)\s*\{\s*this\.toggleField\('openForMerchant'/)
  assert.match(js, /onPinnedChange\(e\)\s*\{\s*this\.toggleField\('pinned'/)
  assert.match(js, /onMembersOnlyChange\(e\)\s*\{\s*this\.toggleField\('membersOnly'/)
  assert.match(js, /triggerEvent\('togglefield'/, '开关切换只抛事件给宿主,组件本身不发保存请求')
})

test('负控:塞回「已开」字样必须被判红', () => {
  const wxml = read('components/cy/club-topic-settings/index.wxml')
  const mutated = wxml.replace('<text class="cts__title">开放商家承接</text>', '<text class="cts__title">开放商家承接(已开)</text>')
  assert.notEqual(mutated, wxml)
  assert.doesNotMatch(wxml, /已开|已关/)
  assert.match(mutated, /已开|已关/)
})

test('J4 只改承接开关与展示偏好:主题内容改动跳转交给宿主,不在本组件内直接保存主题字段', () => {
  const js = read('components/cy/club-topic-settings/index.js')
  assert.match(js, /triggerEvent\('editcontent'/, '编辑主题内容必须只是抛事件,交给宿主导航到编辑主题页')
  assert.doesNotMatch(js, /clubType|activityPrefs|description:/, '不得在本组件里读写主题内容字段(名称/类型/简介等)')
})

// ===================================================================
// J6 出示团码:必须复用 cy-scene-qr-group-code,不能重写选场次/出码/倒计时逻辑。
// ===================================================================

test('J6 复用 cy-scene-qr-group-code,不重新实现团码逻辑', () => {
  const json = JSON.parse(read('components/cy/club-topic-groupcode/index.json'))
  assert.equal(json.usingComponents['cy-scene-qr-group-code'], '/components/cy/scene-qr-group-code/index')
  assert.equal(json.usingComponents['cy-scene-sheet'], '/components/cy/scene-sheet/index')

  const wxml = read('components/cy/club-topic-groupcode/index.wxml')
  assert.match(wxml, /<cy-scene-qr-group-code[^>]*activity-id="\{\{activityId\}\}"[^>]*topic-id="\{\{topicId\}\}"/)

  const js = read('components/cy/club-topic-groupcode/index.js')
  assert.doesNotMatch(js, /sendRequest|wx\.request/, '本组件不应该自己发网络请求 —— 出码逻辑全部委托给 cy-scene-qr-group-code')
})

// ===================================================================
// J5 结束主题:T2 —— 没有顶栏、没有 ✕,只能点按钮。
// ===================================================================

test('J5 是纯 T2:不引入 cy-scene-sheet(没有顶栏/抓手/✕),只用 cy-modal', () => {
  const json = JSON.parse(read('pages/club/components/cy/club-topic-end-confirm/index.json'))
  assert.equal(json.usingComponents['cy-scene-sheet'], undefined)
  assert.equal(json.usingComponents['cy-modal'], '/components/cy/modal/index')

  const wxml = read('pages/club/components/cy/club-topic-end-confirm/index.wxml')
  assert.doesNotMatch(wxml, /cy-scene-sheet|class="[^"]*close[^"]*"|✕/)
  assert.match(wxml, /<cy-modal[\s\S]*danger="\{\{true\}\}"/)
  assert.match(wxml, /confirm-text="结束并退款"/)
  assert.match(wxml, /cancel-text="再想想"/)
})

// ===================================================================
// J3-A/J3-B:一个组件两种 variant,靠 mode 属性切,不是两个组件。
// ===================================================================

test('J3 onboarding 是单组件 mode 二态(node/chapter),都挂在同一个 T1 半屏上', () => {
  const js = read('components/cy/club-topic-onboarding/index.js')
  assert.match(js, /mode:\s*\{\s*type:\s*String,\s*value:\s*'node'\s*\}/)

  const wxml = read('components/cy/club-topic-onboarding/index.wxml')
  assert.match(wxml, /mode === 'node'/)
  assert.match(wxml, /mode === 'chapter'/)
  assert.match(wxml, /<cy-scene-sheet[^>]*variant="half"[^>]*title="承接商家"/)
})

// J3-A 站点序号跨章节连排(稿 155:118 第二章是 4/5/6,不是重新从 1 数):
// 序号必须优先用后端下发的 node.seq,wx:for 的段内下标只能兜底。
test('J3-A 节点序号优先取 node.seq,不能只用段内下标', () => {
  const wxml = read('components/cy/club-topic-onboarding/index.wxml')
  assert.match(
    wxml,
    /class="cto__node-seq">\{\{node\.seq \|\| ni \+ 1\}\}</,
    '序号圈必须是 node.seq 优先、段内下标兜底 —— 只用 ni + 1 会让第二章从 1 重新数',
  )
})

test('负控:序号退回纯段内下标必须被判红', () => {
  const wxml = read('components/cy/club-topic-onboarding/index.wxml')
  const mutated = wxml.replace('{{node.seq || ni + 1}}', '{{ni + 1}}')
  assert.notEqual(mutated, wxml, '负控没改到东西,断言锚点已经失配')
  assert.doesNotMatch(mutated, /class="cto__node-seq">\{\{node\.seq \|\| ni \+ 1\}\}</)
})

// ===================================================================
// J7/J4/J3 全是纯展示组件:数据由宿主传入,不能自己发指向不存在 endpoint 的请求 ——
// 后端 TODO 的三个组件真写死 app.sendRequest 会被 UI-GATE-0(U1 静态路径无 Mapping)判红。
// ===================================================================

const NO_BACKEND_YET = ['club-topic-merchants', 'club-topic-settings', 'club-topic-onboarding']

function assertNoLiveNetworkCall(js) {
  const code = stripJsComments(js)
  assert.doesNotMatch(code, /url\s*:\s*['"]\/api\//, '后端接口还没有,不能写死一个打不通的 endpoint')
  assert.doesNotMatch(code, /sendRequest|wx\.request/, '组件不发请求,数据由宿主通过属性传入')
}

test('J7/J4/J3 三个待接线组件不发网络请求(后端 TODO,数据全部走属性)', () => {
  for (const name of NO_BACKEND_YET) {
    assertNoLiveNetworkCall(read(`components/cy/${name}/index.js`))
  }
})

test('负控:往待接线组件里加回 app.sendRequest 必须被判红', () => {
  const js = read('components/cy/club-topic-settings/index.js')
  const mutated = `${js}\n    app.sendRequest({ url: '/api/topic/club-settings' });\n`
  assert.notEqual(mutated, js)
  assert.throws(() => assertNoLiveNetworkCall(mutated), assert.AssertionError)
})

// ===================================================================
// 全组共通:组件都存在、都能被读到、都以 cy-club-topic- 命名(任务分配的硬约束)。
// ===================================================================

test('五个组件目录都存在且四件套齐全', () => {
  const BASE_OF = { 'club-topic-end-confirm': 'pages/club/components/cy' }
  for (const name of COMPONENTS) {
    const base = BASE_OF[name] || 'components/cy'
    for (const ext of ['js', 'json', 'wxml', 'wxss']) {
      const p = path.join(ROOT, base, name, `index.${ext}`)
      assert.ok(fs.existsSync(p), `缺少 ${name}/index.${ext}`)
    }
    const json = JSON.parse(read(`${base}/${name}/index.json`))
    assert.equal(json.component, true)
  }
})
