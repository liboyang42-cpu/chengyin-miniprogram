const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

/**
 * 商家在同一主题承接多站时,每一站都要能看到。
 *
 * 病灶(2026-08-07 修):`ProjectHomeReadServiceImpl.findMyRegistration` 取 `list.get(0)`,
 * 而 PR #585 刚放开「一个商家可承接同一路线多站」。查生产库,memberId=100096 在
 * topic 19 与 21 各有 2 条承接记录 —— 第二站在页面上**根本不存在,且零报错**。
 *
 * 三层分开断言,任何一层被删都要单独红(合起来写的话,删渲染不会红)。
 */

const ROOT = path.resolve(__dirname, '../..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const PAGE_JS = 'pages/topic/merchantinfo/merchantinfo.js'
const COMP_JS = 'pages/topic/components/project-join/index.js'
const COMP_WXML = 'pages/topic/components/project-join/index.wxml'

test('数据层:页面从 join.registrations 取全部站,不是只取 registration', () => {
  const js = read(PAGE_JS)
  assert.match(js, /d\.join\.registrations/,
    '不读 registrations 的话,后端就算下发了多站,前端仍然只显示第一站')
  assert.match(js, /myStations:\s*myStations/, 'myStations 必须真的写进 data')
})

test('数据层:只有 >1 站才给切换条,单站商家页面不多一行', () => {
  const js = read(PAGE_JS)
  assert.match(js, /all\.length\s*>\s*1\s*\?/,
    '单站也渲染切换条 = 给绝大多数商家凭空加了一条没用的 UI')
})

test('渲染层:组件真的把每一站渲染出来了', () => {
  const wxml = read(COMP_WXML)
  assert.match(wxml, /wx:for="\{\{ myStations \}\}"/, '光有数据不渲染等于没做')
  assert.match(wxml, /myStations\.length > 1/, '渲染侧也要有单站不出的条件')
  assert.match(wxml, /bindtap="onSwitchStation"/, '不能只显示不能切')
})

test('交互层:切换走既有 act 分发白名单,不新造一套事件形状', () => {
  const comp = read(COMP_JS)
  assert.match(comp, /triggerEvent\('act',\s*\{\s*act:\s*'switchStation'/,
    "组件必须用 {act, dataset} 这一套 —— 换个形状页面的 onJoinAct 就分发不到,静默失效")
  const page = read(PAGE_JS)
  assert.match(page, /switchStation:\s*1,/,
    'HANDLERS 白名单没登记的话 onJoinAct 会直接 return,点了没反应且不报错')
  assert.match(page, /switchStation\(e\)\s*\{/, '处理器签名要收事件对象')
})

test('交互层:切换后必须重新拉详情,否则切了站内容不变', () => {
  const js = read(PAGE_JS)
  const fn = js.slice(js.indexOf('switchStation(e)'))
  const body = fn.slice(0, fn.indexOf('\n  },'))
  assert.match(body, /regId:\s*next/, '切站的本质是换 regId')
  assert.match(body, /this\.loadDetail\(\)/, '换了 regId 不重新拉 = 页面还是上一站的内容')
})

test('后端:project home 下发 registrations 全量', () => {
  const java = fs.readFileSync(path.resolve(ROOT,
    '../chengyinhub-system/src/main/java/com/chengyinhub/business/service/impl/ProjectHomeReadServiceImpl.java'), 'utf8')
  assert.match(java, /join\.put\("registrations"/, '后端不下发,前端读什么都没用')
  assert.doesNotMatch(java, /private CmsRegistrationMerchant findMyRegistration\(/,
    '旧的单条版本必须已被替换掉,留着迟早有人再用回去')
})
