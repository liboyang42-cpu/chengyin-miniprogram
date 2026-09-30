const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const stripComments = (source) => source.replace(/<!--[^]*?-->/g, '').replace(/\/\*[^]*?\*\//g, '')

function extractViewByClass(source, className) {
  const classIndex = source.indexOf(`class="${className}`)
  assert.notEqual(classIndex, -1, `缺少 ${className}`)
  const start = source.lastIndexOf('<view', classIndex)
  const tags = /<\/?view\b[^>]*>/g
  tags.lastIndex = start
  let depth = 0
  let match
  while ((match = tags.exec(source))) {
    if (match[0].startsWith('</')) depth -= 1
    else if (!match[0].endsWith('/>')) depth += 1
    if (depth === 0) return source.slice(start, tags.lastIndex)
  }
  assert.fail(`${className} 没有闭合`)
}

function assertHomeChrome(source) {
  const wxml = stripComments(source)
  const actions = wxml.slice(wxml.indexOf('class="v3-hero-actions'), wxml.indexOf('class="v3-hero-greet-row'))
  assert.match(actions, /class="v3-avatar"/)
  assert.doesNotMatch(actions, /goSearch|goNotifications|name="search"|name="bell"/)
  assert.doesNotMatch(wxml, /v3-city-events|v3-ce-/)
  const greeting = extractViewByClass(wxml, 'v3-hero-greet-row')
  assert.match(greeting, /class="v3-hero-mem\b/, '玩家徽标必须在招呼语同一父节点内')
  assert.ok(greeting.indexOf('v3-hero-hi') < greeting.indexOf('v3-hero-mem'), '玩家徽标必须紧跟招呼语同排')
}

function assertFavoriteCardsOnly(source) {
  const wxml = stripComments(source)
  assert.doesNotMatch(wxml, /class="load-more"|上拉加载更多|没有更多了/)
  assert.doesNotMatch(wxml, /class="(?:item-tit|star|price|tags)"/)
  // 2026-09-25 CU-M-141 改判:这一行原本禁的是 `>{{item.name}}<`,跟着当年的旧正文行
  // (名称/星级/价格/加载文案)一起砍掉了。走查实测多条收藏封面相近,砍到只剩封面之后
  // 点开前根本分不出是哪条主题,所以名称回到卡面 —— 但走的是封面文案层(见下),
  // 图片下方那套旧文字行仍然禁:类名 item-tit/star/price/tags 由上一条继续判红。
  assert.match(wxml, /class="favorite-card"[\s\S]*?class="favorite-card__cover"/)
  assert.match(wxml, /class="favorite-card__title"[^>]*>\s*\{\{\s*item\.name\s*\}\}\s*</, '收藏卡必须把主题名称带上卡面')
  assert.match(wxml, /class="favorite-card__scrim"[\s\S]*?class="favorite-card__body"/, '封面文案要有压在照片上的可读性遮罩')
  assert.match(wxml, /class="favorite-card__type"[^>]*\{\{\s*item\.categoryText\s*\}\}/, '收藏卡要显示基本类型')
}

test('A01：首页只留头像，玩家徽标与招呼语同排，城市事件链路删除', () => {
  assertHomeChrome(read('pages/index/index.wxml'))
  // 2026-09-19 用户改判摘除首页搜索入口(09-17 拍板 #15 未给看过截图,按误加处理),
  // goSearch 例外随之收回;A01 冻结的「hero 操作区只留头像」自本条起无例外。
  // 当年一并停掉的通知与城市事件链路(goNotifications/fetchCityEvent/goCityEvents)继续禁。
  assert.doesNotMatch(read('pages/index/index.js'), /goNotifications\(|fetchCityEvent|goCityEvents|\/api\/official\/events/)
  assert.doesNotMatch(read('pages/index/index.wxss'), /\.v3-city-events|\.v3-ce-/)
})

test('A01 negative control：把旧城市事件卡注入首页必须判红', () => {
  const source = read('pages/index/index.wxml')
  const mutated = source.replace('<!-- 继续探索', '<view class="v3-city-events">城市事件</view>\n      <!-- 继续探索')
  assert.notEqual(mutated, source)
  assert.throws(() => assertHomeChrome(mutated), /v3-city-events/)
})

test('A01 negative control：把玩家徽标移出招呼语父节点必须判红', () => {
  const source = read('pages/index/index.wxml')
  const greeting = extractViewByClass(source, 'v3-hero-greet-row')
  const member = extractViewByClass(greeting, 'v3-hero-mem')
  const mutated = source.replace(greeting, `${greeting.replace(member, '')}\n${member}`)
  assert.notEqual(mutated, source)
  assert.throws(() => assertHomeChrome(mutated), /同一父节点/)
})

test('A01：首页头像入口使用全局 44px 最小触达区 token', () => {
  const wxss = stripComments(read('pages/index/index.wxss'))
  const rule = wxss.match(/\.v3-avatar\s*\{([^}]*)\}/)
  assert.ok(rule, '缺少 .v3-avatar 样式')
  assert.match(rule[1], /width:\s*var\(--cy-btn-h\)\s*;/)
  assert.match(rule[1], /height:\s*var\(--cy-btn-h\)\s*;/)
  const greeting = wxss.match(/\.v3-hero-greet-row\s*\{([^}]*)\}/)
  assert.ok(greeting, '缺少 .v3-hero-greet-row 样式')
  assert.match(greeting[1], /pointer-events:\s*none\s*;/,
    '纯文案招呼层不得以整行透明盒遮住右侧头像点击中心')
})

test('A05/A06：广场顶部为横向 banner，发布器展示本人头像与昵称', () => {
  const wxml = stripComments(read('pages/square/list/index.wxml'))
  const feedCard = stripComments(read('components/cy/feed-play-card/index.wxml'))
  const completionCard = stripComments(read('components/cy/completion-share-card/index.wxml'))
  const js = read('pages/square/list/index.js')
  // 2026-09-11:两块正文收进 cy-post-card(页面不判 variant),所以这三条从列表页改看组件。
  const postCard = stripComments(read('components/cy/post-card/index.wxml'))
  assert.doesNotMatch(wxml, /class="(?:summary|sum-card)"/)
  assert.doesNotMatch(js, /creativesquare\/summary|getSummary/)
  assert.match(wxml, /<scroll-view[^>]*class="sq-upcoming-track"[^>]*scroll-x[\s\S]*?wx:for="\{\{upcomingCards\}\}"/)
  assert.match(wxml, /class="up-avatar-stack"[\s\S]*?wx:for="\{\{item\.avatars\}\}"[\s\S]*?item\.avatarOverflow/)
  // 2026-09-02 帖文 B1:compose-head 拆成 compose-row(头像列) + compose-col(内容列),
  // 昵称/正文/工具栏共用同一条左边线。断言跟着结构走,顺带把「内容列真的包住正文」也钉住。
  // 2026-09-02 B2(Figma 379:2437):内容列首行由固定文案「发布帖文」改为本人昵称,
  // 断言随之从字面量改成昵称绑定 + 兜底「城瘾玩家」。
  assert.match(wxml, /class="compose-row"[\s\S]*?avatar \|\| '\/images\/d_profile\.png'[\s\S]*?class="compose-col"[\s\S]*?>\{\{nickname \|\| '城瘾玩家'\}\}</)
  assert.match(wxml, /class="compose-col"[\s\S]*?class="compose-input/,
    '正文必须落在内容列里,否则又会通栏、与头像右边缘不齐')
  assert.match(postCard, /<cy-feed-play-card\b[^>]*bind:detail="emitPlayDetail"[^>]*bind:play="emitPlay"/,
    '发布帖文模板须接入列表/详情共用的可玩卡组件')
  assert.match(wxml, /bind:playdetail="goPlayTopicDetail"[\s\S]{0,80}bind:play="goPlay"/,
    '列表页要把可玩卡的动作从帖文卡上接回来')
  assert.match(postCard, /<cy-completion-share-card\b[^>]*wx:if="\{\{post\.isCompletionShare\}\}"/,
    '完赛分享须使用单张图片成绩卡，不能复用模板/路线沉浸卡')
  // 2026-09-02 Figma 297:1827 Roam variant:标题与成绩不再叠在封面图上,改为正文栏内的竖排段落
  // (TitleRow → Stats → 轨迹图)。断言随结构走,钉的仍是「标题在成绩之前」这条顺序。
  assert.match(completionCard, /class="completion-share-card__title-row"[\s\S]*class="completion-share-card__score"/,
    '完赛标题与成绩必须按 297:1827 在正文栏内竖排')
  assert.doesNotMatch(completionCard, /completion-share-card__body|completion-share-card__metrics/,
    '完赛分享不得保留下方独立统计面板')
  assert.match(postCard, /<cy-feed-play-card\b[^>]*wx:if="\{\{\s*post\.hasPlayCover\s*&&\s*!post\.isCompletionShare\s*\}\}"/,
    '模板/路线分享继续使用既有沉浸卡，且须排除完赛分享')
  assert.match(feedCard, /class="feed-play-card"[\s\S]*?class="feed-play-card__cover"[\s\S]*?class="feed-play-card__actions"/,
    '发布帖文模板须保留参考图的大图、叠字与双动作结构')
})

test('A10：详情无“动态”页标题，作者名可见，点赞和分享图标前后一致', () => {
  const detail = stripComments(read('pages/square/detail/index.wxml'))
  const listCard = stripComments(read('components/cy/post-card/index.wxml'))
  assert.doesNotMatch(detail, /<cy-page-title\b/)
  assert.match(detail, /class="detail-nav-spacer"/)
  assert.match(detail, /class="ph-name ph-name--handle ep1"[^>]*>@\{\{ info\.memberNickname \}\}/)
  // 2026-09-02 Figma 379:2571:点赞按稿改成「已赞实心红心 / 未赞描边」,name 由 isLiked 三元决定,
  // 断言从写死的 name="heart" 换成这条绑定 —— 两个态的图标名都要出现,少一个就红。
  assert.match(detail, /class="act act--like[^>]*[\s\S]*?name="\{\{info\.isLiked==1 \? 'heart-filled' : 'heart'\}\}"[\s\S]*?\{\{info\.likeCount \|\| 0\}\}/)
  assert.match(detail, /class="act act--comment[^>]*[\s\S]*?\{\{info\.commentCount \|\| 0\}\}/)
  assert.match(detail, /class="comment-like[^>]*[\s\S]*?name="heart"[\s\S]*?\{\{item\.likeCount \|\| 0\}\}/)
  assert.doesNotMatch(detail, /\{\{item\.likeCount\}\}\s*赞/)
  // 2026-09-21 用户拍板:帖文分享统一改成产品既有弯箭头位图，不使用方框上箭头。
  assert.match(detail, /class="act-share act-share--end"[^>]*[\s\S]*?src="\/images\/icon_share\.png"/)
  assert.match(listCard, /class="post-card__share"[^>]*[\s\S]*?src="\/images\/icon_share\.png"/)
  assert.doesNotMatch(listCard, /post-card__share-icon"[^>]*name="arrow-right"/,
    '分享不许再借用 arrow-right —— share 这枚 iOS 分享件仓里早就有')
})

test('A14/A15 + UI-19：俱乐部主 tab 贴导航等分，有页标题，一张完整俱乐部列表(不分我的/附近)，卡片为横向单列', () => {
  const wxml = stripComments(read('pages/talent/list/index.wxml'))
  const js = read('pages/talent/list/index.js')
  const wxss = read('pages/talent/list/index.wxss')
  // 2026-09-18 UI-19 用户:一级 tab 页要有页标题 ⇒ 导航栏居中「俱乐部」(原 A14 禁 nav-title 的口径作废)
  assert.doesNotMatch(wxml, /nav-search|class="club-tabs"/)
  assert.match(wxml, /<text class="nav-title">俱乐部<\/text>/)
  assert.match(wxml, /<cy-tabs class="top-tabs" variant="fill" wide="\{\{true\}\}"/)
  assert.doesNotMatch(js, /activeClubTab|clubTabs|onClubTabChange|onSearchTap/)
  assert.doesNotMatch(wxml, /进行中挑战|club-events/)
  assert.doesNotMatch(js, /clubEvents|d\.events/)
  assert.match(wxml, />创建你自己的俱乐部</)
  // 2026-09-18 UI-19 用户:「这里就是完整的俱乐部」—— 不再分「我的 / 附近」两段,一张列表按
  // 我创建的 → 我加入的 → 同城其他 的顺序排
  assert.doesNotMatch(wxml, /club-rec-tit|>附近</)
  const owned = wxml.indexOf('wx:for="{{myClubs}}"')
  const joined = wxml.indexOf('wx:for="{{joinedClubs}}"')
  const nearby = wxml.indexOf('wx:for="{{nearbyClubs}}"')
  assert.ok(owned >= 0 && joined > owned && nearby > joined, '列表顺序:我创建的 → 我加入的 → 同城其他')
  // 2026-08-20 卡片重设计:三份内联拷贝收敛为 cy-club-card,单列不变;
  // club-card 类名必须留在组件实例上(截图矩阵选择器 .club-grid, .club-card 依赖它)
  assert.match(wxml, /<cy-club-card class="club-card"/)
  assert.doesNotMatch(wxml, /class="club-card-logo"|class="club-card-body"/, '内联拷贝不许回流,卡体只在 cy-club-card 一处')
  assert.match(wxss, /\.club-grid\s*\{[^}]*flex-direction:\s*column/)
  assert.match(js, /headerH = this\.data\.statusBarHeight \+ this\.data\.navBarHeight;/)
})

test('A26：搜索结果页顶部只画搜索框与输入关键词', () => {
  const wxml = stripComments(read('pages/search2/result/index.wxml'))
  const json = JSON.parse(read('pages/search2/result/index.json'))
  const searchWxml = read('components/cy/search/index.wxml')
  const searchWxss = read('components/cy/search/index.wxss')
  const tokens = read('style/tokens.wxss')
  assert.doesNotMatch(wxml, /<cy-page-title\b|class="result-head"|>搜索结果</)
  assert.match(wxml, /<cy-search[^>]*value="\{\{keyword\}\}"[^>]*bind:input="onKeywordInput"[^>]*bind:confirm="onSearchConfirm"/)
  assert.equal(json.usingComponents['cy-search'], '/components/cy/search/index')
  assert.equal(json.usingComponents['cy-page-title'], undefined)
  assert.match(searchWxml, /\{\{value \? 'search--filled' : ''\}\}/)
  assert.match(searchWxss, /\.search--filled\s*\{[^}]*var\(--cy-comp-search-filled-bg\)/)
  /* 2026-09-03 裁决:输入框「未填=亮、填后=暗」,搜索框跟着翻(全站输入框一个口径)。
   * 原来锁的 idle=#1C1C1E / filled=#3B3B3D 是反的 —— 空着的框比填了字的框还暗,
   * 空态反而看不见。搜索框就是输入框,不给它开第二套语义。
   * ⚠️ 这四条 match 的粒度是「整份 tokens.wxss 里存在这个值」,**不锁哪一层**——
   * page{} 与深色镜像各有一处,只翻其中一处它照样绿(负控实测)。别把它当层级断言用。 */
  assert.match(tokens, /--cy-color-input-idle-bg:\s*#3B3B3D/)
  assert.match(tokens, /--cy-color-input-filled-bg:\s*#1C1C1E/)
  assert.match(tokens, /--cy-color-input-filled-fg:\s*#F2F2F4/)
  assert.match(tokens, /--cy-color-input-placeholder:\s*#A3A3A5/)
})

test('A32/A59：玩家头像为完整紫环，操作区只留大票夹，关于区可直接编辑', () => {
  const wxml = stripComments(read('components/cy/profile/index.wxml'))
  const wxss = read('components/cy/profile/index.wxss')
  const tokens = read('style/tokens.wxss')
  const settings = stripComments(read('pages/shezhi/shezhi.wxml'))
  assert.match(tokens, /--cy-comp-profile-avatar-ring:\s*var\(--cy-ref-violet-500\)/)
  assert.match(wxml, /pc-player[^"}]*[\s\S]*?\{\{isSelf \? 'pc-self' : 'pc-public'\}\}/)
  assert.match(wxss, /\.pc-player\.pc-self \.pc-avatar-ring\s*\{[^}]*var\(--cy-comp-profile-avatar-ring\)/)
  assert.match(wxss, /\.pc-avatar\s*\{[^}]*box-sizing:\s*border-box;[^}]*display:\s*block/)
  assert.match(wxml, /class="pc-primary pc-ticket"[^>]*wx:if="\{\{isSelf && !isMerchantView\}\}"/)
  // 2026-09-18 UI-12:公开视角也要「···」更多,条件从 isSelf && isMerchantView 放宽为本人商家/公开两态。
  assert.match(wxml, /class="pc-more"[^>]*wx:if="\{\{!isSelf \|\| isMerchantView\}\}"/)
  assert.doesNotMatch(wxml, /class="pc-xbox-bar"/)
  // 2026-09-23 CU-M-28:这块显示的是会员本人 introduction,编辑进个人资料(goEditIntro),商家视角也不再跳品牌中心
  assert.match(wxml, /class="pc-about-edit"[^>]*wx:if="\{\{isSelf\}\}"[^>]*bindtap="goEditIntro"/)
  assert.match(wxss, /\.pc-about-edit\s*\{[^}]*min-height:\s*var\(--cy-btn-h\)/)
  assert.doesNotMatch(settings, /class="sz-card"|bindtap="goEdit"/)
})

test('A45：我的收藏保留主题长方卡，并新增帖文/主题双域与认可的标题间距基准', () => {
  const wxml = read('pages/mylike/mylike.wxml')
  const wxss = read('pages/mylike/mylike.wxss')
  assertFavoriteCardsOnly(wxml)
  assert.match(wxml, /<cy-tabs\b[^>]*tabs="\{\{favoriteTabs\}\}"/)
  assert.match(wxml, /<cy-post-card\b[^>]*show-favorite/)
  assert.match(wxss, /\.favorite-card\s*\{[^}]*aspect-ratio:\s*16 \/ 9/)
  assert.match(wxss, /\.favorite-card__actions button\s*\{[^}]*width:\s*var\(--cy-btn-h\);[^}]*height:\s*var\(--cy-btn-h\)/)
  assert.match(wxml, /class="favorite-card__action-visual"/)
  assert.match(wxml, /style="height: \{\{statusBarHeight \+ navBarHeight\}\}px;"[\s\S]*?<cy-page-title[^>]*safe-top="\{\{false\}\}"/)
  assert.match(read('pages/address/address.wxml'), /style="height: \{\{statusBarHeight \+ navBarHeight\}\}px;"[\s\S]*?<cy-page-title[^>]*safe-top="\{\{false\}\}"/)
})

test('A45 negative control：把旧名称、星级、价格和加载文案塞回收藏页必须判红', () => {
  const source = read('pages/mylike/mylike.wxml')
  const old = '<view class="item-tit">{{item.name}}</view><view class="star">5.0</view><view class="price">¥9</view><view class="load-more">上拉加载更多</view>'
  const mutated = source.replace('</view>\n</view>\n', `${old}\n  </view>\n</view>\n`)
  assert.notEqual(mutated, source)
  assert.throws(() => assertFavoriteCardsOnly(mutated))
})

test('A52/A53：资料页无标题，五个页内 sheet 为半透明深面板，取消/完成使用次级/主动作语义', () => {
  const wxml = stripComments(read('pages/gerenziliao/gerenziliao.wxml'))
  const wxss = read('pages/gerenziliao/gerenziliao.wxss')
  const json = JSON.parse(read('pages/gerenziliao/gerenziliao.json'))
  assert.doesNotMatch(wxml, /<cy-page-title\b/)
  assert.match(wxml, /class="profile-nav-spacer"/)
  assert.equal((wxml.match(/<cy-sheet class="profile-edit-sheet"/g) || []).length, 4)
  assert.match(wxml, /<cy-category-sheet class="profile-edit-sheet"/)
  assert.match(wxss, /\.profile-edit-sheet\s*\{[^}]*--cy-comp-sheet-bg:\s*var\(--cy-color-bg-glass\)/)
  assert.match(wxss, /\.pop-model \.pop-top button\s*\{[^}]*color:\s*var\(--cy-color-action-secondary-fg-on-dark\)/)
  assert.match(wxss, /button\.david_aok\s*\{[^}]*color:\s*var\(--cy-color-action-primary-fg-on-dark\)/)
  assert.doesNotMatch(wxss, /\.pop-model \.pop-top button\s*\{[^}]*color:\s*#[Ee][Dd]0006/)
  assert.equal(json.usingComponents['cy-page-title'], undefined)
  assert.match(read('components/cy/sheet/index.wxss'), /\.sh__mask\s*\{[^}]*background:\s*var\(--cy-color-overlay\)/)
})

test('A60：参与人信息有真实报名 caller 与后端数据源，故保留并只统一标题间距', () => {
  const caller = read('pages/activity/baoming/baoming.js')
  const pageJs = read('pages/address/address.js')
  const pageWxml = stripComments(read('pages/address/address.wxml'))
  assert.match(caller, /url:\s*'\/pages\/address\/address\?mode=participant'/)
  assert.match(caller, /eventChannel\.on\('addressSelected'/)
  assert.match(pageJs, /url:\s*'\/api\/user\/address\/list'/)
  assert.match(pageWxml, /<cy-page-title title="参与人信息" safe-top="\{\{false\}\}"/)
})
