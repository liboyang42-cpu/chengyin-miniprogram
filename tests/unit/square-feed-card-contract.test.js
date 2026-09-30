const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
const renderable = (source) => source.replace(/<!--[\s\S]*?-->/g, '')

function sources() {
  return {
    componentWxml: read('components/cy/feed-play-card/index.wxml'),
    componentWxss: read('components/cy/feed-play-card/index.wxss'),
    completionWxml: read('components/cy/completion-share-card/index.wxml'),
    completionWxss: read('components/cy/completion-share-card/index.wxss'),
    listWxml: renderable(read('pages/square/list/index.wxml')),
    listWxss: read('pages/square/list/index.wxss'),
    listJson: JSON.parse(read('pages/square/list/index.json')),
    postCardWxml: renderable(read('components/cy/post-card/index.wxml')),
    postCardJson: JSON.parse(read('components/cy/post-card/index.json')),
    postCardWxss: read('components/cy/post-card/index.wxss'),
    detailWxml: renderable(read('pages/square/detail/index.wxml')),
    detailWxss: read('pages/square/detail/index.wxss'),
    detailJson: JSON.parse(read('pages/square/detail/index.json')),
    remixJs: read('pages/square/utils/topic-template-remix.js'),
    roamJs: read('pages/roam/index.js'),
  }
}

function assertImmersiveCardContract(files) {
  assert.match(files.componentWxml, /class="feed-play-card"[^>]*catchtap="onDetail"/)
  assert.match(files.componentWxml, /class="feed-play-card__cover"[^>]*mode="aspectFill"/)
  assert.match(files.componentWxml, /class="feed-play-card__scrim"/)
  assert.match(
    files.componentWxml,
    /class="feed-play-card__title(?: ep1)?"[^>]*>\{\{title\}\}[\s\S]*class="feed-play-card__subtitle(?: ep1)?"[^>]*>\{\{subtitle\}\}[\s\S]*class="feed-play-card__actions"/
  )
  // 2026-09-02 Figma 297:1827 Template variant:双钮文案由用户拍板改成「看看模板」/「试玩」。
  // 两颗 ghost 分支的可见文案同为「看看模板」,分支差异只剩 handler 与 aria-label
  // ⇒ 断言把「文案」和「接到哪个行为」分开钉,守的还是同一条:remix/detail/play 一个都不许丢。
  assert.match(files.componentWxml, /class="feed-play-card__btn feed-play-card__btn--ghost"[^>]*wx:if="\{\{remixable\}\}"[^>]*catchtap="onRemix"[^>]*>看看模板<\/view>/)
  assert.match(files.componentWxml, /class="feed-play-card__btn feed-play-card__btn--ghost"[^>]*wx:else[^>]*catchtap="onDetail"[^>]*>看看模板<\/view>/)
  assert.match(files.componentWxml, /class="feed-play-card__btn feed-play-card__btn--solid"[^>]*catchtap="onPlay"[^>]*>试玩<\/view>/)
  // 稿上「可直接开局的模板」角标只在真模板上出现,普通路线分享不得冒充模板。
  assert.match(files.componentWxml, /class="feed-play-card__badge"[^>]*wx:if="\{\{remixable\}\}"[^>]*>可直接开局的模板<\/view>/)

  // 2026-09-02 改口径:稿是「封面 248pt,文案与按钮叠在封面内、封面下方无内容」,
  // 原 820rpx 全幅竖版分享图作废;文案区随之由居中改为距左 14pt 的左对齐。
  assert.match(files.componentWxss, /\.feed-play-card\s*\{[^}]*width:\s*100%[^}]*height:\s*496rpx[^}]*border-radius:\s*var\(--cy-radius-lg\)/s)
  assert.match(files.componentWxss, /\.feed-play-card__body\s*\{[^}]*left:\s*var\(--cy-space-3-5\)[^}]*text-align:\s*left/s)
  assert.match(files.componentWxss, /\.feed-play-card__title\s*\{[^}]*font-size:\s*var\(--cy-type-home-feed-title\)/s,
    '封面标题必须是稿上的 22pt(44rpx)')
  // padding 按稿给上下 12pt,min-height 仍须在场:它是 a11y 触达下限,不许为了对稿被删掉。
  assert.match(files.componentWxss, /\.feed-play-card__btn\s*\{[^}]*padding:\s*var\(--cy-space-3\)\s+0[^}]*min-height:\s*var\(--cy-btn-h\)/s)
  // 双钮配色由自造的玻璃白/白底黑字改为稿上的 token 对;硬编码色只准留在压照片的黑纱上。
  assert.match(files.componentWxss, /\.feed-play-card__btn--ghost\s*\{[^}]*color:\s*var\(--cy-color-text-primary\)[^}]*background:\s*var\(--cy-color-play-accent-soft\)/s)
  assert.match(files.componentWxss, /\.feed-play-card__btn--solid\s*\{[^}]*background:\s*var\(--cy-color-action-primary-bg\)[^}]*color:\s*var\(--cy-color-text-inverse\)/s)

  // ★ 2026-09-11:两块正文收进 cy-post-card,页面不再自己塞 slot。
  //    以前只有广场列表塞,于是俱乐部页与达人页的同一张帖子少了一半 —— 更糟的是
  //    isCompletionShare 还会把图廊关掉,整条帖子只剩文字。
  for (const [page, wxml, json] of [
    ['帖文卡', files.postCardWxml, files.postCardJson],
    ['详情页', files.detailWxml, files.detailJson],
  ]) {
    assert.equal(json.usingComponents['cy-feed-play-card'], '/components/cy/feed-play-card/index', `${page}必须注册共享可玩卡`)
    assert.match(wxml, /<cy-feed-play-card\b[^>]*remixable="\{\{\s*(?:post|info)\.isTopicTemplate\s*\}\}"[^>]*bind:detail="(?:emitPlayDetail|goSportTopic)"[^>]*bind:remix="(?:emitRemix|goRemixTemplate)"[^>]*bind:play="(?:emitPlay|goPlay)"/s, `${page}双按钮必须接到真实导航行为`)
  }
  assert.match(files.postCardWxml, /<cy-feed-play-card\b[^>]*wx:if="\{\{\s*post\.hasPlayCover\s*&&\s*!post\.isCompletionShare\s*\}\}"/s,
    '沉浸卡只承载模板/路线分享，必须排除完赛分享')
  assert.equal(files.postCardJson.usingComponents['cy-completion-share-card'], '/components/cy/completion-share-card/index')
  assert.equal(files.detailJson.usingComponents['cy-completion-share-card'], '/components/cy/completion-share-card/index')
  assert.match(files.postCardWxml, /<cy-completion-share-card\b[^>]*wx:if="\{\{post\.isCompletionShare\}\}"[^>]*roam-result="\{\{post\.isRoamResultShare\}\}"/s,
    '完赛分享必须走独立图片成绩卡')
  assert.doesNotMatch(files.listWxml, /<cy-(?:completion-share|feed-play)-card\b/,
    '★ 列表页不许再自己判 variant —— 那正是俱乐部页/达人页漏渲染的原因')
  assert.match(files.listWxml, /bind:playdetail="goPlayTopicDetail"[\s\S]{0,80}bind:remix="goRemixTemplate"[\s\S]{0,40}bind:play="goPlay"/,
    '列表页要把三个动作从帖文卡上接回来,否则成绩卡/模板卡点了没反应')
  assert.match(files.detailWxml, /<cy-completion-share-card\b[^>]*wx:if="\{\{info\.isCompletionShare\}\}"[^>]*roam-result="\{\{info\.isRoamResultShare\}\}"/s,
    '详情完赛分享必须与列表共用图片成绩卡')
  // 2026-09-02 Figma 297:1827 Roam variant:成绩不再叠在图片内部,改为 TitleRow → Stats → 轨迹图 竖排。
  assert.match(files.completionWxml, /class="completion-share-card__title-row"[\s\S]*class="completion-share-card__score"[\s\S]*class="completion-share-card__cover"/,
    'Roam 成绩卡必须按稿排:TitleRow → Stats → 轨迹图')
  assert.doesNotMatch(files.completionWxml, /completion-share-card__body|completion-share-card__metrics|completion-share-card__overlay/,
    '完赛分享不得再把统计面板接在图片下方,也不再有压在封面上的 overlay')
  assert.match(files.completionWxss, /\.completion-share-card\s*\{[^}]*flex-direction:\s*column[^}]*gap:\s*var\(--cy-space-3\)/s,
    '成绩卡不再是绝对定位的全幅封面,而是稿上的竖排内容段')
  // 2026-09-02 Figma 297:1827 改口径:图廊不再按「正文栏宽」算单张铺满,改成固定 300pt×230pt
  // 的横滑卡(比正文栏 289pt 略宽 ⇒ 右侧被切一刀,那一刀就是「还有下一张、可以滑」的提示)。
  // 原断言钉的是旧的 calc 表达式,与新口径互斥,故整条换成新几何。
  assert.match(files.postCardWxss, /\.post-card__media-map,\s*\.post-card__media-pic\s*\{[^}]*width:\s*600rpx[^}]*height:\s*460rpx[^}]*border-radius:\s*var\(--cy-radius-lg\)/s,
    '横滑图廊每张必须是稿上的 300pt × 230pt、16pt 圆角')
  assert.match(files.postCardWxss, /\.post-card__media-row\s*\{[^}]*gap:\s*var\(--cy-space-2-5\)/s,
    '图与图的间距必须是稿上的 10pt')
  assert.match(files.detailWxml, /<cy-feed-play-card\b[^>]*wx:if="\{\{\s*info\.hasPlayCover\s*&&\s*!info\.isCompletionShare\s*\}\}"/s,
    '详情页模板沉浸卡必须排除完赛分享')

  assert.match(files.postCardWxml, /class="post-card__nick">\{\{post\.memberNickname \|\| '城瘾玩家'\}\}<\/text>/)
  assert.match(files.detailWxml, />@\{\{\s*info\.memberNickname\s*\}\}<\/view>/)
  assert.match(files.postCardWxml, /class="post-card__more"[^>]*catchtap="emitMore"/)
  // 2026-09-16(A-09 收口):溢出入口对所有人都渲染 —— 非本人纯文本帖此前在详情页没有
  // 任何入口,想举报只能回列表找。组件 owner=false 时只渲染举报行,不会露出编辑/删除。
  assert.match(files.detailWxml, /class="ph-more"[^>]*catchtap="openPostActions"/)
  assert.doesNotMatch(files.detailWxml, /class="ph-more"[^>]*wx:if/, '溢出入口不许再按关联/归属设条件(A-09)')
  // 操作弹层从「只有举报的自绘 cy-sheet」换成三合一 cy-post-actions(danger 确认闸在组件内);
  // 意图不变:详情有操作弹层、入口由 openPostActions 开、能关。
  assert.match(files.detailWxml, /<cy-post-actions id="post-actions"[\s\S]{0,200}?show="\{\{postActionShow\}\}"[\s\S]{0,200}?bind:close="closePostActions"/)

  // 2026-09-02 Figma 297:1827:正文外面多包了一层 .post-card__body(装「正文 + 展开」两行),
  // wx:if 跟着上移到包层 —— 守的还是同一条:没正文就不渲染这一块。
  assert.match(files.postCardWxml, /class="post-card__body"[^>]*wx:if="\{\{post\.contents\}\}"/)
  assert.match(files.postCardWxml, /class="post-card__body"[\s\S]*class="post-card__text"/)
  assert.match(files.detailWxml, /class="post-text"[^>]*wx:if="\{\{\s*info\.contents\s*\}\}"/)
  // 2026-09-02 Figma 297:1827:scroll-view 外面多包了一层 .post-card__gallery(给页码 pill
  // 一个 position:relative 的锚),wx:if 跟着上移;守的还是同一条:有图就得渲染出来。
  assert.match(files.postCardWxml, /class="post-card__gallery"[^>]*post\.picList/, '关联卡原有实景图仍须可见')
  assert.match(files.postCardWxml, /class="post-card__media-pic"[^>]*catchtap="emitPreview"/, '图仍须可点开大图')
  assert.match(files.detailWxml, /class="media"[^>]*picList\.length/, '详情页原有实景图仍须可见')

  // 已赞实心 + 未赞描边两枚 cy-icon,后接点赞计数(原先是单张位图 heart-filled.svg)。
  assert.match(files.postCardWxml, /class="post-card__heart[^>]*name="heart-filled"[\s\S]*?class="post-card__heart[^>]*name="heart"[\s\S]*?\{\{post\.likeCount/)
  assert.match(files.postCardWxml, /name="comment"[^>]*>[\s\S]*?\{\{post\.commentCount/)
  // 2026-09-02 Figma 379:2571:详情页点赞图标按赞态切实心/描边,name 变成绑定表达式。
  assert.match(files.detailWxml, /name="\{\{info\.isLiked==1 \? 'heart-filled' : 'heart'\}\}"[^>]*>[\s\S]*?\{\{\s*info\.likeCount/)
  assert.match(files.detailWxml, /class="act act--comment[^>]*catchtap="focusCommentInput"[\s\S]*?name="comment"[\s\S]*?\{\{\s*info\.commentCount/)
  assert.match(files.postCardWxml, /class="post-card__share"[^>]*open-type="share"/)
  assert.match(files.detailWxml, /class="act-share act-share--end"[^>]*open-type="share"/)
  assert.doesNotMatch(files.listWxml + files.detailWxml, /class="act-report"/, '动作行只保留点赞、评论与分享')
  assert.doesNotMatch(files.listWxml + files.detailWxml, />\s*赞\s*</, '动作行不得出现“赞”字')

  assert.doesNotMatch(files.listWxss, /\.play-card\b|\.pc-(?:cover|body|title|sub|actions|btn)\b/, '列表页不得留一份平行卡样式')
  assert.doesNotMatch(files.detailWxss, /\.play-actions\b|\.pa-btn\b/, '详情页不得留一份平行卡样式')
}

function loadComponent() {
  let definition
  const modulePath = path.join(ROOT, 'components/cy/feed-play-card/index.js')
  global.Component = (config) => { definition = config }
  delete require.cache[require.resolve(modulePath)]
  require(modulePath)
  delete global.Component
  return definition
}

test('共享可玩卡按参考图呈现竖向全出血封面、居中文案和双胶囊，并由列表详情共用', () => {
  assertImmersiveCardContract(sources())
})

test('共享可玩卡公开详情、改编模板和开始漫游三个独立行为事件', () => {
  const component = loadComponent()
  const events = []
  const context = {
    data: { postIndex: 4 },
    triggerEvent: (name, detail) => events.push({ name, detail }),
  }
  component.methods.onDetail.call(context)
  component.methods.onRemix.call(context)
  component.methods.onPlay.call(context)
  assert.deepEqual(events, [
    { name: 'detail', detail: { index: 4 } },
    { name: 'remix', detail: { index: 4 } },
    { name: 'play', detail: { index: 4 } },
  ])
})

test('可玩卡副标题与完赛分享图片按真实字段生成', () => {
  const { buildFeedPlaySubtitle, resolveFeedPlayCover, hasFeedPlayCover, resolveCompletionShareImage, isCompletedShare, isRoamResultShare } = require('../../utils/feed-play-card')
  assert.equal(buildFeedPlaySubtitle({ completed: true, nodeTotal: 8 }), '已通关 · 共 8 个节点')
  assert.equal(buildFeedPlaySubtitle({ completed: false, nodeDoneCount: 3, nodeTotal: 8 }), '进行中 · 已完成 3/8')
  assert.equal(buildFeedPlaySubtitle({ completed: true }), '已通关')
  assert.equal(buildFeedPlaySubtitle({ completed: false }), '进行中')
  assert.equal(hasFeedPlayCover({ sportName: '夜游', sportCover: 'cover.jpg' }), true)
  assert.equal(hasFeedPlayCover({ sportName: '夜游', sportCover: '   ' }), false)
  assert.equal(hasFeedPlayCover({ contents: '纯文本帖' }), false)
  assert.equal(resolveFeedPlayCover({ routePreviewImg: '   ', sportCover: 'fallback.jpg' }), 'fallback.jpg')
  assert.equal(resolveCompletionShareImage({ routePreviewImg: 'route.jpg', picList: ['photo.jpg'] }), 'photo.jpg')
  assert.equal(resolveCompletionShareImage({ pics: ';photo.jpg;' }), 'photo.jpg')
  assert.equal(resolveCompletionShareImage({}), '')
  assert.equal(isRoamResultShare({ dataType: 3 }), true)
  assert.equal(isCompletedShare({ dataType: 3 }), true)
  assert.equal(isCompletedShare({ dataType: 0, pics: 'ordinary.jpg' }), false)
})

test('模板改编按钮调用真实 /use 接口并进入复制出的草稿', () => {
  const listJs = read('pages/square/list/index.js')
  const detailJs = read('pages/square/detail/index.js')
  for (const source of [listJs, detailJs]) {
    assert.match(source, /goRemixTemplate[\s\S]*remixTopicTemplate\(app,\s*(?:item|info)\.sportTopicId\)/)
  }
  assert.match(sources().remixJs, /url:\s*'\/api\/template\/topic-template\/use'/)
  assert.match(sources().remixJs, /wx\.navigateTo\(\{\s*url:\s*'\/pages\/publish\/fabu\/index\?id='\s*\+\s*copiedTopicId/)
})

test('自由漫游成绩使用独立 dataType=3 和真实单图，不与普通图片帖混淆', () => {
  const files = sources()
  // 发帖必须带真实漫游会话 id:实时分享取本次 _roamSid,历史分享取选中记录的 sessionId
  // (R9-44)。两者都不允许用 0/空串冒充。
  assert.match(files.roamJs, /const sessionId = this\._activeShareSessionId\(\)/)
  assert.match(files.roamJs, /if \(!sessionId\) return Promise\.resolve\(fail\(/)
  assert.match(files.roamJs, /_activeShareSessionId\(\)\s*\{[\s\S]*?exactSessionId\(this\._roamSid\)/)
  assert.match(files.roamJs, /data_id:\s*String\(sessionId\)/)
  assert.match(files.roamJs, /data_type:\s*'3'/)
  assert.match(files.completionWxml, /mode="\{\{roamResult \? 'aspectFit' : 'aspectFill'\}\}"/)
  // 稿上 Stats 三栏是 距离/探店/用时;「路线节点」只有活动完赛帖(dataType=1)有数据,
  // 自由漫游帖后端不回 nodeTotal ⇒ 这一栏仍必须被 !roamResult 挡住,否则漫游卡会出现「路线节点 0」。
  assert.match(files.completionWxml, /class="completion-share-card__metric"[^>]*wx:if="\{\{!roamResult && nodeTotal > 0\}\}"/)
})

// 2026-09-03:completion-share-card 声明了 17 个属性,页面只传了 10 个 ——
// Stats / Kudos / CommentPreview 首行三块永远是空的,而 4926 个测试 + 5 道门禁
// + 两个对稿核查 agent 没有任何一个发现。**只有截图看出来。**
// 这条把「组件声明的属性,页面必须都传」变成可自动检测的不变式。
test('completion-share-card 的每个属性,两个消费页都必须真的传(防声明了却没接线)', () => {
  const js = read('components/cy/completion-share-card/index.js')
  const props = [...js.matchAll(/^\s+([a-zA-Z]+): \{ type/gm)].map((m) => m[1])
  assert.ok(props.length >= 15, `属性抽取失败(只抽到 ${props.length} 个),断言会变恒真`)
  const kebab = (s) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
  // ⚠️ 必须卡属性名的左边界:裸 includes('time="') 会被 hover-stay-time="80" 喂饱,
  //    于是「没传 time」被判成「传了」—— 恰好是这条门禁要抓的那类假绿。
  const passes = (wxml, prop) => new RegExp('(^|\\s)' + kebab(prop) + '="').test(wxml)
  // 按页面语义合理缺席的,必须在这里显式登记并写明理由 —— 不许默默放过。
  const EXEMPT = {
    'pages/square/detail/index.wxml': {
      postIndex: '详情页只有一条帖文,没有列表索引;它只用于回传 detail 事件的 index',
    },
    'components/cy/post-card/index.wxml': {
      time: '稿上 Roam 正文没有时间 —— 时间归帖文卡头部;详情页没有那个头部,所以只有它传',
    },
  }
  // 消费方从「广场列表页」换成了帖文卡组件(两块正文 2026-09-11 收进组件,页面不判 variant)。
  for (const page of ['components/cy/post-card/index.wxml', 'pages/square/detail/index.wxml']) {
    const wxml = read(page)
    const exempt = EXEMPT[page] || {}
    const missing = props.filter((p) => !passes(wxml, p) && !exempt[p])
    assert.deepEqual(missing, [], `${page} 漏传:${missing.join(', ')}`)
    // 豁免也是棘轮:登记了却其实传了的,说明理由过期,必须删掉
    const stale = Object.keys(exempt).filter((p) => passes(wxml, p))
    assert.deepEqual(stale, [], `${page} 的豁免登记已过期(实际传了):${stale.join(', ')}`)
  }
})
