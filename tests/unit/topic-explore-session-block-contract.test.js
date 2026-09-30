const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

function assertSessionBlockContract(js, wxml) {
  // 探店日详情页必须渲染真场次卡(时间/集合点/余席/价/限购),不再只有「阵容」花名册
  assert.match(wxml, /wx:if="\{\{isExplore\}\}"[\s\S]{0,200}场次/)
  for (const bind of ['item.sessionTimeText', 'item.meetingPoint', 'item.remaining', '每人限购 1 张']) {
    assert.ok(wxml.includes(bind), '场次卡缺绑定:' + bind)
  }
  // 2026-09-06:原来这一行断言的是「非探店日那支里有『阵容』」—— 那块是 omsTicketList 里
  // 买了票的玩家花名册,2026-09-04 判定表判定它本身就是错的(阵容=参与品牌),已删。
  // 这里改成断言它**没有回来**:非探店日那支里不许再出现按票列玩家的花名册。
  assert.doesNotMatch(wxml, /cmsRegistrationList/,
    '按票种展开列报名玩家的花名册已废止,不许恢复')
  // 取而代之的「阵容/商家」是参与品牌,和 isExplore 无关,两种主题都出
  assert.match(wxml, /阵容\/商家[\s\S]{0,400}info\.lineup/)
  assert.match(js, /isExplore: Number\(res\.data\.productType\) === 2/)
  assert.match(js, /sessionTimeText/)
  assert.match(js, /list\[i\]\['remaining'\]/)
}

test('探店日详情页场次块契约(时间槽/集合点/余席/限购提示)', () => {
  assertSessionBlockContract(
    read('pages/topic/index/index.js'),
    read('pages/topic/index/index.wxml'))
})

test('mutation 负控:把场次卡退回花名册时契约变红', () => {
  const wxml = read('pages/topic/index/index.wxml')
    .replace('wx:if="{{isExplore}}"', 'wx:if="{{false}}"')
    .replace('item.sessionTimeText', 'item.name')
  assert.throws(() => assertSessionBlockContract(
    read('pages/topic/index/index.js'), wxml), assert.AssertionError)
})

function loadTopicPage() {
  let pageConfig = null
  const navigations = []
  const toasts = []
  const previous = { getApp: global.getApp, Page: global.Page }
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserType: () => 1,
    tips: () => {},
    sendRequest: () => {},
  })
  global.Page = (config) => { pageConfig = config }
  global.wx = {
    showLoading: () => {}, hideLoading: () => {},
    showToast: (options) => { toasts.push(options && options.title) },
    navigateTo: (options) => { navigations.push(options.url) },
    showActionSheet: () => {},
    getStorageSync: () => '', setStorageSync: () => {},
    createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec: () => {} }) }) }),
  }
  const pagePath = path.join(ROOT, 'pages/topic/index/index.js')
  delete require.cache[require.resolve(pagePath)]
  try {
    require(pagePath)
  } finally {
    global.getApp = previous.getApp
    global.Page = previous.Page
  }
  const vm = Object.assign({}, pageConfig)
  vm.data = JSON.parse(JSON.stringify(pageConfig.data))
  /* 真 setData 认 'a.b' 这种路径写法。桩只做 Object.assign 的话会静默塞一个
     **字面量键名** 'sessionPicker.show',页面读 data.sessionPicker.show 永远读不到 ——
     断言却是绿的。这是桩的假绿,不是代码的问题。 */
  vm.setData = function (patch) {
    Object.keys(patch).forEach((key) => {
      if (key.indexOf('.') < 0) { this.data[key] = patch[key]; return }
      const parts = key.split('.')
      let cur = this.data
      for (let i = 0; i < parts.length - 1; i += 1) {
        if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {}
        cur = cur[parts[i]]
      }
      cur[parts[parts.length - 1]] = patch[key]
    })
  }
  return { vm, navigations, toasts }
}

/* 2026-09-06 用户拍板「主题报名没有废弃,是代码写错了」:点场次不再跳去活动详情页
   重选一遍票,而是就地开弹层选场次 + 票种,选完直接进结算(稿 11 240:401 / 11a 240:446)。

   这条契约原来保护的是「不把票种 id 当成场次 id」—— 那个混淆来自旧实现里靠
   name/startTime 字符串去猜「这张票属于哪个场次」的映射。新实现里弹层按场次拉它自己的票,
   那套猜测整段删掉了,混淆的可能性从根上没有。判据因此换成两条更强的:
     ① 点下去必须开弹层,不许再跳走;
     ② 源码里不许再出现那套字符串配对(回潮就判红)。 */
test('场次卡点下去就地开选场次弹层，不再跳走、也不再靠字符串猜场次', () => {
  const wxml = read('pages/topic/index/index.wxml')
  assert.match(wxml, /bindtap="bmClick"[^>]*data-id="\{\{item\.id\}\}"|data-id="\{\{item\.id\}\}"[^>]*bindtap="bmClick"/)
  assert.match(wxml, /<cy-session-picker[\s\S]*bind:confirm="onSessionPicked"/, '弹层没有挂上来')

  const { vm, navigations, toasts } = loadTopicPage()
  vm.data.info = {
    omsTicketList: [{ id: 9001, name: '上午场', startTime: '2026-09-05 10:00:00' }],
    activityList: [{ id: 71, name: '上午场', startDate: '2026-09-05 10:00:00' }],
  }
  vm.bmClick({ currentTarget: { dataset: { id: 9001 } } })
  assert.deepEqual(toasts, [])
  assert.equal(navigations.length, 0, '点场次不该再跳走')
  assert.equal(vm.data.sessionPicker.show, true)

  // 选完场次 + 票种才去结算,参数形状与活动详情页那条入口一致
  vm.onSessionPicked({ detail: { activityId: 71, ticketId: 9001 } })
  assert.equal(vm.data.sessionPicker.show, false)
  assert.deepEqual(navigations, ['/pages/activity/baoming/baoming?activityId=71&ticketId=9001'])

  // 一个场次都没有时仍要说清楚,不能默默开一个空弹层
  const empty = loadTopicPage()
  empty.vm.data.info = { activityList: [] }
  empty.vm.bmClick({ currentTarget: { dataset: {} } })
  assert.equal(empty.vm.data.sessionPicker.show, false)
  assert.match(String(empty.toasts[0] && (empty.toasts[0].title || empty.toasts[0])), /暂无可参加的场次/)

  // ★负控:靠 name/startTime 猜配对的那套回潮 → 判红
  // 剥注释再判:那段改动说明里就写着 play-activity-detail(它在说「原来跳这儿」),
  // 拿解释规则的话去判违规,跟 ds-hardcode 当年把注释里的 #486 当色值是同一个坑。
  const source = read('pages/topic/index/index.js')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  assert.doesNotMatch(source, /matchActivity/, '字符串配对不该回来')
  assert.doesNotMatch(source, /openScene\(['"]play-activity-detail/, '主题页不再打开活动详情')
})
