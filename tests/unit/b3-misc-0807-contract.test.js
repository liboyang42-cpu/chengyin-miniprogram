const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
const renderable = (source) => source.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

// 2026-09-11:两块正文从「广场列表页往 slot 里塞」改成「帖文卡组件自己按 post 字段出」,
// 于是这里的 wxml 从列表页换成 cy-post-card —— 换掉的是【谁来画】,不是画什么。
function assertCompletionShareContract(listJs, cardHostWxml, completionWxml) {
  const wxml = renderable(cardHostWxml)
  const card = renderable(completionWxml)
  assert.match(listJs, /isCompletionShare\s*=\s*isCompletedShare\(newlist\[i\]\)/)
  assert.match(wxml, /<cy-completion-share-card\b[^>]*wx:if="\{\{post\.isCompletionShare\}\}"/)
  assert.match(card, /class="completion-share-card__cover"[^>]*src="\{\{cover\}\}"[^>]*mode="\{\{roamResult \? 'aspectFit' : 'aspectFill'\}\}"/)
  // 2026-09-02 Figma 297:1827 Roam variant:成绩卡不再是「820rpx 全幅封面 + overlay 叠字」。
  // 外壳(Header/Actions)归 cy-post-card,本组件只出 TitleRow / Stats / 轨迹图 / Kudos / CommentPreview。
  // 断言随结构走:eyebrow「漫游成绩」与 overlay 稿上没有,故由存在断言翻成不存在断言。
  assert.match(card, /class="completion-share-card__title-row"[\s\S]*name="walk"[\s\S]*class="completion-share-card__title"/)
  assert.match(card, /class="completion-share-card__title"[^>]*>\{\{title \|\| '本次漫游'\}\}</)
  assert.match(card, /class="completion-share-card__medals"[^>]*wx:if="\{\{medalGold > 0 \|\| medalSilver > 0 \|\| medalBronze > 0\}\}"/)
  assert.match(card, /class="completion-share-card__metric-value"[^>]*>\{\{nodeTotal\}\}</)
  assert.doesNotMatch(card, /completion-share-card__body|completion-share-card__metrics/)
  assert.doesNotMatch(card, /completion-share-card__overlay|completion-share-card__eyebrow|completion-share-card__stamp/)
  assert.match(wxml, /<cy-feed-play-card\b[^>]*wx:if="\{\{\s*post\.hasPlayCover\s*&&\s*!post\.isCompletionShare\s*\}\}"/s)
}

function assertChallengeRemoved(talentJs, talentWxml, talentWxss) {
  assert.doesNotMatch(renderable(talentWxml), /进行中挑战|club-events/)
  assert.doesNotMatch(talentJs, /clubEvents|d\.events/)
  assert.doesNotMatch(talentWxss, /\.club-events/)
}

function assertImListStillLive(appJson, talentJs, ledgerJs, imListJs) {
  const appConfig = JSON.parse(appJson)
  const imPackage = appConfig.subPackages.find((item) => item.root === 'subpackageB')
  assert.ok(imPackage && imPackage.pages.includes('pages/im/list/index'), 'IM 会话列表仍须注册为可访问页面')
  assert.match(talentJs, /onMsgTap\(\)\s*\{\s*wx\.navigateTo\(\{\s*url:\s*'\/subpackageB\/pages\/im\/list\/index'/)
  assert.match(ledgerJs, /goInbox\(\)\s*\{\s*wx\.navigateTo\(\{\s*url:\s*'\/subpackageB\/pages\/im\/list\/index'/)
  assert.match(imListJs, /url:\s*'\/api\/im\/conversations'/)
  assert.match(imListJs, /\/subpackageB\/pages\/im\/chat\/index\?conversationId=/)
}

test('A05: 完赛分享使用单张图片成绩卡，模板/路线分享继续使用既有沉浸卡', () => {
  const listJs = read('pages/square/list/index.js')
  const listWxml = read('components/cy/post-card/index.wxml')
  const completionWxml = read('components/cy/completion-share-card/index.wxml')
  const completionWxss = read('components/cy/completion-share-card/index.wxss')
  const helper = require('../../utils/feed-play-card')

  assertCompletionShareContract(listJs, listWxml, completionWxml)
  // 稿上轨迹图 188pt 高、20pt 圆角;整卡不再有 820rpx 这个全幅封面高度。
  assert.match(completionWxss, /\.completion-share-card__cover\s*\{[^}]*height:\s*376rpx[^}]*border-radius:\s*var\(--cy-radius-xl\)/s)
  assert.doesNotMatch(completionWxss, /height:\s*820rpx/)
  // MedalPill 的重点:金/银/铜各绑各的 token。三档同色 = 这个 pill 等于没做,所以逐档钉死。
  assert.match(completionWxss, /\.completion-share-card__medal--gold\s*\{[^}]*color:\s*var\(--cy-color-medal-gold\)/s)
  assert.match(completionWxss, /\.completion-share-card__medal--silver\s*\{[^}]*color:\s*var\(--cy-color-medal-silver\)/s)
  assert.match(completionWxss, /\.completion-share-card__medal--bronze\s*\{[^}]*color:\s*var\(--cy-color-medal-bronze\)/s)
  assert.equal(helper.isCompletedShare({ dataType: 1, completed: true, sportName: '夜游' }), true)
  assert.equal(helper.isCompletedShare({ dataType: 3 }), true)
  assert.equal(helper.isCompletedShare({ dataType: 2, completed: true, sportName: '夜游' }), false)
  assert.equal(helper.isCompletedShare({ dataType: 1, completed: false, sportName: '夜游' }), false)
})

test('A05 negative control: 让完赛帖重新落入沉浸卡必须判红', () => {
  const js = read('pages/square/list/index.js')
  const source = read('components/cy/post-card/index.wxml')
  const card = read('components/cy/completion-share-card/index.wxml')
  const mutated = source.replace(
    'wx:if="{{post.hasPlayCover && !post.isCompletionShare}}"',
    'wx:if="{{post.hasPlayCover}}"',
  )
  assert.notEqual(mutated, source)
  assert.throws(() => assertCompletionShareContract(js, mutated, card), assert.AssertionError)
})

test('A14: 俱乐部页删除进行中挑战区块及其前端数据消费', () => {
  assertChallengeRemoved(
    read('pages/talent/list/index.js'),
    read('pages/talent/list/index.wxml'),
    read('pages/talent/list/index.wxss'),
  )
})

test('A14 negative control: 恢复挑战标题或 events 消费必须判红', () => {
  const js = read('pages/talent/list/index.js')
  const wxml = read('pages/talent/list/index.wxml')
  const wxss = read('pages/talent/list/index.wxss')
  assert.throws(
    () => assertChallengeRemoved(`${js}\nconst clubEvents = d.events`, `${wxml}\n<view>进行中挑战</view>`, wxss),
    assert.AssertionError,
  )
})

test('A39: 页面统一叫票夹，路线票与场次票保留真实语义但共用同一票卡比例', () => {
  const js = read('subpackageMember/signup/index.js')
  const wxml = renderable(read('subpackageMember/signup/index.wxml'))
  const wxss = read('subpackageMember/signup/index.wxss')
  const json = JSON.parse(read('subpackageMember/signup/index.json'))

  assert.equal(json.navigationBarTitleText, '票夹')
  // 2026-09-18 UI-17:用户要求票夹页去掉顶部黑条与大标题,顶上只留返回钮,cy-page-title 摘除。
  assert.doesNotMatch(wxml, /<cy-page-title/)
  assert.doesNotMatch(wxml, /我的票[券劵]/)
  /* 2026-09-09 用户裁决:票夹不再分「路线 / 场次」两个 tab,全部放一起。
     ★ 原断言钉的是「两类票保留真实语义」—— 这一点没变,只是不再用 tab 表达:
       两个接口(owner_type 1 / 2)照旧各拉各的,合并只在渲染层做,
       每张票带 kind,点开还是按类型分流(下面 topicId/activityId 两条断言就是这个)。 */
  assert.doesNotMatch(js, /ticketTabs/, '票夹已不分 tab,残留 ticketTabs 说明合并没做干净')
  assert.match(js, /kind: 'topic'/)
  assert.match(js, /kind: 'activity'/)
  assert.match(js, /owner_type:\s*1/)
  assert.match(js, /owner_type:\s*2/)
  assert.match(js, /_openTicket\(/)
  assert.match(js, /'topicId=' \+ ownerId/)
  assert.match(js, /'activityId=' \+ ownerId/)
  assert.match(js, /\/subpackagePrefab\/index\?'/)
  assert.match(js, /\/pages\/play\/index\?'/)
  assert.match(js, /page \+ query \+ '&registrationId=' \+ item\.id/)
  // 合并后只剩一个 swiper(原来两个 tab 各一个)
  assert.equal((wxml.match(/class="swiper-item-content \{\{/g) || []).length, 1)
  assert.doesNotMatch(wxml, /sic-portrait|slides-topic/)
  assert.doesNotMatch(wxss, /\.swiper-item-content\.sic-portrait|\.slides-topic/)
})

test('A52/A53: 未填写资料行回到同一高度，五个页内面板统一半透明底', () => {
  const wxml = renderable(read('pages/gerenziliao/gerenziliao.wxml'))
  const wxss = read('pages/gerenziliao/gerenziliao.wxss')

  assert.doesNotMatch(wxml, /\/images\/d_jftu2\.png/)
  assert.ok((wxml.match(/>未填写<\/view>/g) || []).length >= 3, '媒体/列表空态必须使用与普通行同高的“未填写”文本')
  assert.match(wxml, /class="shzlbox_li_left_ntu"\s+wx:if="\{\{casePicsList\.length > 0\}\}"/)
  assert.match(wxml, /class="shzlbox_li_left_ntu"\s+wx:if="\{\{userInfo\.wechat\}\}"/)
  assert.match(wxss, /\.shzlbox_li\s*\{[^}]*min-height:\s*var\(--cy-btn-h\)/s)
  assert.match(wxss, /\.shzlbox_li_left_ntu\s*\{[^}]*margin-top:\s*0/s)
  assert.equal((wxml.match(/class="profile-edit-sheet"/g) || []).length, 5)
  assert.match(wxss, /\.profile-edit-sheet\s*\{\s*--cy-comp-sheet-bg:\s*var\(--cy-color-bg-glass\);\s*\}/)
})

test('B26: 报名声明只保留一句单独同意与一个勾选控件', () => {
  const js = read('pages/activity/baoming/baoming.js')
  const wxml = renderable(read('pages/activity/baoming/baoming.wxml'))
  const wxss = read('pages/activity/baoming/baoming.wxss')
  const json = JSON.parse(read('pages/activity/baoming/baoming.json'))

  assert.doesNotMatch(wxml, /pay-rule|bmbottom_terms|报名与退款说明/)
  assert.match(wxml, /bindtap="toggleHostShare"/)
  assert.match(wxml, /同意将姓名、手机号提供给主办方，用于报名核验/)
  assert.equal((wxml.match(/class="bmbottom_box_txt"/g) || []).length, 1)
  assert.match(wxml, /disabled="\{\{!canPay\}\}"/)
  assert.match(js, /refreshPaymentState\s*\(\)[\s\S]*data\.hostShareChecked/)
  assert.doesNotMatch(js, /showAgreementSheet|showPrivacySheet|openAgreementSheet|openPrivacySheet|!that\.data\.agreementChecked/)
  assert.equal(json.usingComponents['cy-agreement-sheet'], undefined)
  assert.equal(json.usingComponents['cy-privacy-sheet'], undefined)
  assert.doesNotMatch(wxss, /\.pay-rule|\.bmbottom_terms/)
})

test('D34: IM 列表仍有玩家与商家活入口，并承担会话聚合到聊天页的独立职责', () => {
  assertImListStillLive(
    read('app.json'),
    read('pages/talent/list/index.js'),
    read('pages/merchant/ledger/index.js'),
    read('subpackageB/pages/im/list/index.js'),
  )
})

test('D34 negative control: 从分包移除会话列表必须判红', () => {
  const source = read('app.json')
  const mutated = source.replace('"pages/im/list/index",', '')
  assert.notEqual(mutated, source)
  assert.throws(
    () => assertImListStillLive(
      mutated,
      read('pages/talent/list/index.js'),
      read('pages/merchant/ledger/index.js'),
      read('subpackageB/pages/im/list/index.js'),
    ),
    assert.AssertionError,
  )
})
