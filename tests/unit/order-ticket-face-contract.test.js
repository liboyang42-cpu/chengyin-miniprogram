const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

function assertOrderDetailContract(js, wxml) {
  // 探店日订单必须有自己的字面与集合信息,不得再被标成「经典定向场次」
  assert.match(js, /'探店日'/)
  assert.match(js, /'进入游玩'/)
  assert.match(js, /info\.sessionTimeText/)
  assert.match(js, /info\.meetingPointText/)
  assert.match(js, /openMeetingPoint\(\)/)
  /* F12:订单页不得跳 is_join=1 的主题详情(那个参数会把那一页的底部 CTA 整条藏掉)。
     2026-09-11 按稿 578:2298 删掉快捷入口卡之后,唯一那处 is_join=1 的跳转(goActivity)
     跟着没了 —— 这条契约从「goRoute 别那么跳」升级成**整个组件里一处都不许有**。 */
  assert.doesNotMatch(js, /_leave\('\/pages\/topic\/index\/index\?is_join/)
  // 订单页通往票夹只留一个出口,别再长回两份逐字相同的实现
  assert.doesNotMatch(js, /goRoute\(\)/)
  assert.doesNotMatch(js, /goPlay\(\)/)
  assert.match(js, /goSignInfo\(\) \{/)
  /* 2026-09-11 按稿 578:2298 重排之后,场次时间与日期时间合成了一个 whenText ——
     同一个事实原来在头图、「日期」「时间」「场次」四处各拼一遍。
     这条契约要证的性质没变:探店日的场次时间槽必须真的上到界面,而且来源仍是 sessionTimeText。 */
  assert.match(js, /info\.sessionTimeText \|\| \[eventDate, eventTime\]/)
  assert.match(wxml, /\{\{whenText\}\}/)
  assert.match(wxml, /bindtap="openMeetingPoint"/)
  assert.match(wxml, /meetingPointDisplayText/)
  // 稿 578:2329:集合点那一行的值是蓝色的「外滩源 · 查看」
  assert.match(wxml, /orow-v--link'\}\}">\{\{info\.meetingPointDisplayText\}\}/)
  assert.match(js, /坐标待补充/)
}

function assertWalletContract(wxml, wxss, json) {
  /* 2026-09-18 UI-17 返修(用户二次验收):票夹卡就是一张完整票图,票名/时间/状态/入口
     不再叠在卡面。原「必须能回答这是哪场、几点」的可见文字兑现方式随之取消,
     但语义不丢:票名与状态(待使用/已核验/已取消/待支付)仍在 aria-label 里,读屏可达;
     点击分区仍由 cta 文案分流(见下)。
     ⚠️ wTitle 在缺 cmsTopic/cmsActivity 时给的是「路线信息待同步 / 活动信息待同步」,
        不是空串 —— 2026-08-19 A39 实拍拍到过整片空黑,那会被读成「坏了」。 */
  assert.match(wxml, /class="tk-face"/)
  assert.match(wxml, /\{\{ item\.wImg \}\}/)
  assert.doesNotMatch(wxml, /tk-meta|tk-stub|tk-perf/, '票名/时间/状态/入口文字不得回到票面')
  assert.match(wxml, /aria-label="\{\{tk\.cta\(item\) \|\| tk\.label\(item\)\}\}，\{\{item\.wTitle\}\}"/,
    '票名与状态必须以 aria-label 保留(读屏等价物),不能连同可见文字一起消失')
  assert.match(wxml, /<cy-nav-bar overlay pill pillDark tint="light"\s*\/>/,
    '全屏主题图上只保留悬浮返回按钮,不得重新长出实底导航条')
  assert.match(wxss, /\.signup \.ztbg\s*\{[^}]*pointer-events:\s*none/s)
  assert.match(wxss, /\.davidwu\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*1/s,
    '加载/失败/空态必须浮在主题背景之上')
  assert.match(wxss, /\.signup \.ticket-name\s*\{[^}]*width:\s*520rpx/s)
  assert.match(wxss, /\.signup \.slides swiper\s*\{[^}]*height:\s*1064rpx/s)
  assert.match(wxss, /\.swiper-item-content\s*\{[^}]*height:\s*924rpx/s)
  assert.match(wxss, /\.team-entry\s*\{[^}]*position:\s*absolute;[^}]*bottom:\s*env\(safe-area-inset-bottom\)/s,
    '队伍入口不得参与票卡居中列的 flex 分配')
  const shortScreen = wxss.slice(wxss.indexOf('@media (max-height: 700px)'))
  assert.match(shortScreen, /\.signup\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*100vh;[^}]*overflow-y:\s*auto/s)
  assert.match(shortScreen, /\.team-entry\s*\{[^}]*position:\s*static/s,
    '短屏容不下固定票卡和队伍入口时必须允许纵向滚动')
  /* 2026-09-10 用户定的方向:票夹点进去就是开始玩,票夹去不了订单 ——
     订单有订单的页面,而且只有订单页能来票夹,反过来不行。
     所以 cta 不再出现「查看详情」(它以前指的就是订单页),没有下一步的档整颗不渲染。
     待支付是唯一例外:那还不是一张票,是一笔没付完的单,文案写「去支付」。 */
  assert.doesNotMatch(wxml, /(?:进入游玩|出示入场码)\s*›/)
  const cta = wxml.slice(wxml.indexOf('function cta('), wxml.indexOf('module.exports'))
  assert.doesNotMatch(cta, /return '查看详情'/, '票夹不能再给一条通往订单页的入口')
  assert.match(cta, /if \(s === 'ready'\) return '进入游玩'/)
  assert.match(cta, /if \(s === 'pending'\) return '去支付'/, '没付完的单要能去付,文案照实写')
  assert.equal(json.usingComponents?.['cy-icon'], '/components/cy/icon/index')
}

test('订单票券页:探店日字面/场次/集合点/主行动契约', () => {
  assertOrderDetailContract(
    read('components/cy/scene-member-order-detail/index.js'),
    read('components/cy/scene-member-order-detail/index.wxml'))
})

test('票夹卡:一张完整票图,票名/状态只走 aria-label,CTA 文案照实写', () => {
  assertWalletContract(
    read('subpackageMember/signup/index.wxml'),
    read('subpackageMember/signup/index.wxss'),
    JSON.parse(read('subpackageMember/signup/index.json')))
})

/* 负控:把那条 is_join=1 的跳转塞回任何一个方法里,契约都必须变红。
   2026-09-11 起注入点不再是 goRoute(它已随快捷入口卡一起删掉)—— 改成往
   goSignInfo 里塞,证的是「整个组件一处都不许有」而不是「某个方法不许有」。 */
test('mutation 负控:订单页任何一处跳回 is_join 都要变红', () => {
  const js = read('components/cy/scene-member-order-detail/index.js')
    .replace(/goSignInfo\(\) \{[\s\S]*?\},/, "goSignInfo() {\n      this._leave('/pages/topic/index/index?is_join=1&id=1');\n    },")
  assert.throws(() => assertOrderDetailContract(
    js, read('components/cy/scene-member-order-detail/index.wxml')), assert.AssertionError)
})

/* 负控:快捷入口卡长回来(两行文案来自后端、点了去票夹)也要变红 —— 它是这一轮按稿删的。 */
test('mutation 负控:快捷入口卡长回来要变红', () => {
  const js = read('components/cy/scene-member-order-detail/index.js')
    .replace(/goSignInfo\(\) \{/, "goRoute() { this.goSignInfo(); },\n\n    goSignInfo() {")
  assert.throws(() => assertOrderDetailContract(
    js, read('components/cy/scene-member-order-detail/index.wxml')), assert.AssertionError)
})
