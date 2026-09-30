const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8')

function assertFinalReviewContract(source = read) {
  const merchantInfoWxml = source('pages/topic/merchantinfo/merchantinfo.wxml')
  const merchantInfoWxss = source('pages/topic/merchantinfo/merchantinfo.wxss')
  const merchantInfoJs = source('pages/topic/merchantinfo/merchantinfo.js')
  assert.match(merchantInfoWxml, /<cy-error[^>]*class="browse-error"[^>]*fill/)
  assert.match(merchantInfoWxss, /\.topic\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s)
  assert.match(merchantInfoWxss, /\.browse-error\s*\{[^}]*display:\s*flex\s*!important;[^}]*flex:\s*1\s*!important;[^}]*min-height:\s*0\s*!important;/s)
  const showErrorStart = merchantInfoJs.indexOf('showBrowseError(reason)')
  // 2026-09-22 M-12:loadBrowseData 加了降级参数,锚点改成 'loadBrowseData(' —— 仍只截 showBrowseError 方法体,
  //   否则会一路截到 retry 里的另一处 pageScrollTo,负控被旁路。
  const showErrorBlock = merchantInfoJs.slice(showErrorStart, merchantInfoJs.indexOf('loadBrowseData(', showErrorStart))
  assert.match(showErrorBlock, /pageScrollTo\(\{ scrollTop: 0, duration: 0 \}\)/)
  assert.equal((merchantInfoJs.match(/that\.showBrowseError\(/g) || []).length, 2)

  const clubJs = source('pages/club/apply/index.js')
  const clubWxml = source('pages/club/apply/index.wxml')
  assert.match(clubJs, /doneState:\s*'idle'/)
  assert.equal((clubJs.match(/mode:\s*'done',\s*doneState:\s*'ready'/g) || []).length, 2)
  assert.match(clubWxml, /mode==='done'\s*&&\s*doneState==='ready'/)
  assert.match(clubWxml, /mode==='done'\s*&&\s*doneState!=='ready'/)
  assert.match(clubWxml, /<cy-error[^>]*title="主理人状态未确认"[^>]*bind:retry="retryLeaderStatus"/)

  const inviteJs = source('pages/coop/invite/index.js')
  const inviteWxml = source('pages/coop/invite/index.wxml')
  const inviteJson = JSON.parse(source('pages/coop/invite/index.json'))
  assert.doesNotMatch(inviteJs, /refreshTerms|termsPreview|termsTitle|termsBullets/)
  assert.match(inviteWxml, /class="terms-options"/)
  assert.doesNotMatch(inviteJs + inviteWxml, /activeType\s*===\s*2|inviteTypeTabs|邀商家做节点|承接节点/)
  assert.doesNotMatch(inviteWxml, /<cy-coop-terms-summary\b/)
  // 2026-08-20:页面早已不渲染它,组件本体随「无使用的组件」体检项一并删除,
  // 声明也不能留 —— 留着就是微信代码质量里那条未通过。
  assert.equal(inviteJson.usingComponents['cy-coop-terms-summary'], undefined)

  // 2026-08-11:旧「承接商家」页收成兼容壳,标签/可容纳的对象型兜底随商家资料一起
  // 搬进 components/cy/profile 的「关于」(阶段C)。这里只保住「旧壳不再渲染任何资料」,
  // 格式化本身由统一主页那边的契约接管。
  const profileShell = source('pages/merchant/profile/index.wxml')
  assert.doesNotMatch(profileShell, /<wxs\b/, '兼容壳不该还留着渲染用的 wxs 格式化模块')
  assert.doesNotMatch(profileShell, /\{\{m\./, '兼容壳不得再绑定任何商家资料字段')

  // 2026-08-26:营销页「我的内容」改成 3-up 数字磁贴,cy-card + cy-empty 那套壳已下线。
  // 这两条断言钉的是 markup 长相、不保护任何行为(数量为零时仍然直达创建页,
  // 由 merchant-marketing-state-contract 的「未知内容数量不会被当作零内容送去创建页」守),
  // 每次重设计都要重写一遍却从没抓到过缺陷 —— 删掉,不迁移。

  // 2026-08-09:合作页删掉「我的合作」,只剩商家 / 俱乐部两个发现 tab,分区数 3 → 2。
  const relation = source('pages/merchant/relation/index.wxml')
  assert.equal((relation.match(/<cy-empty wx:elif="\{\{!(?:merchant|club)Error\}\}" kind="empty"/g) || []).length, 2)
  assert.equal((relation.match(/class="rel-item"[^>]*wx:if="\{\{item\.displayName\}\}"/g) || []).length, 2)
  assert.equal((relation.match(/wx:if="\{\{relation\.valid\([^)]+\)\.length\}\}"/g) || []).length, 2)
  assert.doesNotMatch(relation, /relation\.valid\(relations\)/)

  const citynodeWxss = source('pages/merchant/citynode/index.wxss')
  assert.match(citynodeWxss, /\.cn-retry\s*\{[^}]*--cy-btn-solid-bg:\s*var\(--cy-color-action-primary-bg\)/s)

  const signupSheet = source('pages/topic/merchantapply/index.wxml')
  const signupJson = JSON.parse(source('pages/topic/merchantapply/index.json'))
  assert.match(signupSheet, /<cy-sheet[^>]*show="\{\{timePicker\.show\}\}"[^>]*title="可配合时间"[^>]*data-action="close"/)
  assert.doesNotMatch(signupSheet, /<cy-btn[^>]*data-action="close">取消<\/cy-btn>/)
  assert.match(signupSheet, /class="time-picker-confirm"[^>]*data-action="confirm">完成<\/cy-btn>/)
  assert.equal(signupJson.usingComponents['cy-icon'], '/components/cy/icon/index')
  assert.match(signupSheet, /class="ma-pgrid-del__glyph"[^>]*>[\s\S]{0,120}<cy-icon name="close-sm"/)
  assert.match(signupSheet, /class="ma-pgrid-plus"[^>]*>[\s\S]{0,120}<cy-icon name="plus"/)
  // 2026-09-06:成功标改成稿 365:957 的**锯齿绿章**(组件「成功对勾 / Success check」)。
  // 它是双色图形(章身 #22B573 + 白勾),cy-icon 是 mask + currentColor 的单色体系,套不进去,
  // 所以走矢量原路径做 background-image。这条断言原来钉的是「必须是 cy-icon check」——
  // 那是在防「用字体符号 ✓ 冒充图标」,不是在要求必须用 cy-icon。改成钉真正的意图:
  // 那枚章必须是矢量图形,且路径来自稿(带绿章色),不是打字打出来的对勾。
  assert.match(signupSheet, /class="ma-succ-icon"[^>]*>\s*<\/view>/,
    '成功标是纯装饰容器,图形由 wxss 的矢量 background 提供')
  const applyWxss = source('pages/topic/merchantapply/index.wxss')
  assert.match(applyWxss, /\.ma-succ-icon[\s\S]{0,400}background-image:\s*url\("data:image\/svg\+xml,/,
    '成功章必须是矢量图形,不是字体符号也不是纯圆 + 勾')
  assert.match(applyWxss, /%2322B573/, '章身必须是稿 365:957 的绿(#22B573),色值属图形本身')
  assert.doesNotMatch(signupSheet, />\s*[×＋✓]\s*</, '交互与成功态不得用字体符号冒充图标')

  const coopListJs = source('pages/coop/list/index.js')
  const coopListWxml = source('pages/coop/list/index.wxml')
  // 2026-09-08 整形搬进 utils/coop-invite-view.js;断言跟着真源走。
  // 同时钉住 coop/list 仍在消费它 —— 否则「整形还在、但列表已经不用了」也能蒙混过关。
  const inviteView = source('utils/coop-invite-view.js')
  assert.match(inviteView, /decisionReady:/)
  assert.match(inviteView, /topicText:/)
  assert.match(coopListJs, /require\([^)]*coop-invite-view/)
  assert.match(coopListWxml, /title="邀请信息不完整"/)
  // coop/list 保留 /api/coop/handle 是**对的** —— 后端规则「取消须发起方本人」,
  // 而 coop-center 是商家页,俱乐部进不去。这里只该没有**受邀方**的动作。
  // 角色归属由 coop-handle-role-separation 那条契约按 status 值判定,不在这里重判。
  assert.doesNotMatch(coopListJs, /merchantapply1/)
  assert.doesNotMatch(coopListJs, /goReceivedTab/)
  assert.doesNotMatch(coopListWxml, /acceptWithTerms|goConfigNode|goReceivedTab|catchtap="handle"/)
}

test('终验修复：错误态、空态、派生条款与页面动作遵守新契约', () => {
  assertFinalReviewContract()
})

test('负控：恢复裁切错误态或旧邀约处理入口时契约会判红', () => {
  const overrides = {
    'pages/topic/merchantinfo/merchantinfo.wxss': read('pages/topic/merchantinfo/merchantinfo.wxss').replace('flex: 1 !important;', 'min-height: 100vh;'),
    'pages/coop/list/index.wxml': read('pages/coop/list/index.wxml') + '<view catchtap="handle">同意合作</view>',
  }
  const source = file => overrides[file] === undefined ? read(file) : overrides[file]
  assert.throws(() => assertFinalReviewContract(source), assert.AssertionError)
})

test('负控：错误态不再复位页面滚动位置时契约会判红', () => {
  const file = 'pages/topic/merchantinfo/merchantinfo.js'
  const broken = read(file).replace('wx.pageScrollTo({ scrollTop: 0, duration: 0 });', 'void 0;')
  assert.notEqual(broken, read(file), '负控锚点失效：错误态滚动复位不存在')
  assert.throws(() => assertFinalReviewContract(pathname => pathname === file ? broken : read(pathname)), assert.AssertionError)
})
