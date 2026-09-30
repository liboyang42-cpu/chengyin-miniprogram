'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const { createRequire } = require('node:module')
const path = require('node:path')
const test = require('node:test')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js·loading.js

const ROOT = path.resolve(__dirname, '../..')

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

function setByPath(target, dotted, value) {
  const parts = dotted.replace(/\[(\d+)\]/g, '.$1').split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

function loadPage(relativePath) {
  const requests = []
  const requestTasks = []
  const toasts = []
  let pullStops = 0
  let definition
  const absolutePath = path.join(ROOT, relativePath)
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getAvatar: () => '',
    getNickname: () => '',
    getPageSize: () => 10,
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    getTotalPage: (total, size) => Math.ceil(Number(total || 0) / size),
    getUserID: () => 7,
    sendRequest(options) {
      requests.push(options)
      const task = { aborted: false, abort() { this.aborted = true } }
      requestTasks.push(task)
      return task
    },
    tips(message) { toasts.push(message) },
  }
  const wxApi = {
    getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 20 }),
    getMenuButtonBoundingClientRect: () => ({ bottom: 64 }),
    hideTabBar() {},
    navigateBack() {},
    navigateTo() {},
    pageScrollTo() {},
    reLaunch() {},
    showToast(options) { toasts.push(options && options.title) },
    stopPullDownRefresh() { pullStops += 1 },
  }
  vm.runInNewContext(read(relativePath), {
    console,
    getApp: () => app,
    Page: (config) => { definition = config },
    require: createRequire(absolutePath),
    setTimeout() {},
    clearTimeout() {},
    wx: wxApi,
  }, { filename: absolutePath })

  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, done) {
      Object.entries(patch).forEach(([key, value]) => setByPath(this.data, key, value))
      if (done) done.call(this)
    },
  })
  return {
    page,
    requests,
    requestTasks,
    toasts,
    get pullStops() { return pullStops },
  }
}

test('广场刷新失败保留旧帖并在 complete 后收起系统刷新动画', () => {
  const h = loadPage('pages/square/list/index.js')
  const previous = [{ id: 7, contents: '已有帖文' }]
  Object.assign(h.page.data, { list: previous, listLoading: false, hasMore: true, page_no: 2 })

  h.page.refreshList()

  assert.deepEqual(h.page.data.list, previous)
  assert.equal(h.page.data.isRefreshing, true)
  assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0].data.pageNum, 1)

  h.requests[0].success({ code: 500, msg: '刷新暂时失败' })
  assert.deepEqual(h.page.data.list, previous)
  assert.equal(h.pullStops, 0)

  h.requests[0].complete()
  assert.equal(h.page.data.isRefreshing, false)
  assert.equal(h.pullStops, 1)
})

test('广场加载更多单飞，失败保留分页资格并提供原位重试', () => {
  const h = loadPage('pages/square/list/index.js')
  Object.assign(h.page.data, {
    list: [{ id: 1 }],
    listLoading: false,
    page_no: 1,
    hasMore: true,
  })

  h.page.onReachBottom()
  h.page.onReachBottom()

  assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0].data.pageNum, 2)
  assert.equal(h.page.data.isLoadingMore, true)

  h.requests[0].fail({ errMsg: 'request:fail timeout' })
  h.requests[0].complete()
  assert.equal(h.page.data.page_no, 1)
  assert.equal(h.page.data.hasMore, true)
  assert.match(h.page.data.loadMoreError, /网络/)

  h.page.retryLoadMore()
  assert.equal(h.requests.length, 2)
  assert.equal(h.requests[1].data.pageNum, 2)
})

test('广场发布有可见忙碌态，失败保留草稿并能重试', () => {
  const h = loadPage('pages/square/list/index.js')
  Object.assign(h.page.data, { valCont: '保留这份草稿', picList: ['/a.png'] })

  h.page.submitFormData()
  h.page.submitFormData()
  assert.equal(h.requests.length, 1)
  assert.equal(h.page.data.submitting, true)
  assert.equal(h.requests[0].hideLoading, true)
  assert.equal(h.requests[0].silentError, true)

  h.requests[0].success({ code: 500, msg: '内容暂时无法发布' })
  h.requests[0].complete()
  assert.equal(h.page.data.submitting, false)
  assert.equal(h.page.data.submitError, '内容暂时无法发布')
  assert.equal(h.page.data.valCont, '保留这份草稿')
  assert.deepEqual(h.page.data.picList, ['/a.png'])

  h.page.retrySubmit()
  assert.equal(h.requests.length, 2)
  assert.equal(h.page.data.submitError, '')
})

test('广场发布成功关闭编辑层，并在刷新回读前保留原列表', () => {
  const h = loadPage('pages/square/list/index.js')
  const previous = [{ id: 1, contents: '已有帖文' }]
  Object.assign(h.page.data, {
    valCont: '新帖文',
    canSubmit: true,
    list: previous,
    listLoading: false,
    popOrig: true,
    popShow: true,
  })

  h.page.submitFormData()
  h.requests[0].success({ code: '200' })

  assert.equal(h.page.data.popOrig, false)
  assert.equal(h.page.data.popShow, false)
  assert.equal(h.page.data.valCont, '')
  assert.deepEqual(h.page.data.list, previous)
  assert.equal(h.requests.length, 2)
  assert.equal(h.requests[1].data.pageNum, 1)
})

test('帖子与评论的点赞、关注微操作单飞，失败不会提前改写界面状态', () => {
  const list = loadPage('pages/square/list/index.js')
  Object.assign(list.page.data, {
    list: [{ id: 3, memberId: 8, isLiked: 0, likeCount: 4, isFollowTheUser: 0 }],
  })
  const event = { currentTarget: { dataset: { index: 0, type: 1 } } }

  list.page.lickClick(event)
  list.page.lickClick(event)
  assert.equal(list.requests.length, 1)
  assert.equal(list.page.data.list[0].isLiked, 0)
  list.requests[0].fail({ errMsg: 'request:fail timeout' })
  list.requests[0].complete()
  assert.equal(list.page.data.list[0].isLiked, 0)

  list.page.followClick(event)
  list.page.followClick(event)
  assert.equal(list.requests.length, 2)
  assert.equal(list.page.data.list[0].isFollowTheUser, 0)

  const detail = loadPage('pages/square/detail/index.js')
  Object.assign(detail.page.data, {
    id: 3,
    info: { id: 3, memberId: 8, isLiked: 0, likeCount: 4, isFollowTheUser: 0 },
  })
  detail.page.lickClick(event)
  detail.page.lickClick(event)
  assert.equal(detail.requests.length, 1)
  detail.page.followClick(event)
  detail.page.followClick(event)
  assert.equal(detail.requests.length, 2)

  const comments = loadPage('pages/square/detail/index.js')
  Object.assign(comments.page.data, {
    id: 3,
    list: [{ id: 11, memberId: 8, isLiked: 0, likeCount: 2, isFollowTheUser: 0 }],
  })
  comments.page.commentLikeClick(event)
  comments.page.commentLikeClick(event)
  assert.equal(comments.requests.length, 1)
  comments.requests[0].complete()
  comments.page.commentFollowClick(event)
  comments.page.commentFollowClick(event)
  assert.equal(comments.requests.length, 2)
})

test('动态评论首载、空态和分页失败都有独立且可恢复的状态', () => {
  const h = loadPage('pages/square/detail/index.js')
  h.page.data.id = 9

  h.page.getList()
  assert.equal(h.page.data.commentsState, 'loading')
  h.requests[0].success({ code: '200', data: { rows: [], total: 0 } })
  h.requests[0].complete()
  assert.equal(h.page.data.commentsState, 'ready')
  assert.equal(h.page.data.nodata, true)

  Object.assign(h.page.data, {
    list: [{ id: 11, contents: '已有评论' }],
    page_no: 1,
    hasMore: true,
    nodata: false,
  })
  h.page.onReachBottom()
  h.page.onReachBottom()
  assert.equal(h.requests.length, 2)
  assert.equal(h.requests[1].data.pageNum, 2)
  h.requests[1].fail({ errMsg: 'request:fail timeout' })
  h.requests[1].complete()
  assert.equal(h.page.data.page_no, 1)
  assert.equal(h.page.data.hasMore, true)
  assert.match(h.page.data.commentLoadMoreError, /网络/)

  h.page.retryCommentLoadMore()
  assert.equal(h.requests.length, 3)
  assert.equal(h.requests[2].data.pageNum, 2)
})

test('动态详情缺参零请求，详情请求单飞且旧响应不能覆盖重试结果', () => {
  const missing = loadPage('pages/square/detail/index.js')
  missing.page.onLoad({})
  assert.equal(missing.page.data.detailState, 'missing-param')
  assert.equal(missing.requests.length, 0)

  const h = loadPage('pages/square/detail/index.js')
  h.page.data.id = 9
  h.page.getData()
  h.page.getData()
  assert.equal(h.requests.length, 1)

  const first = h.requests[0]
  first.fail({ errMsg: 'request:fail timeout' })
  first.complete()
  h.page.onRetryDetail()
  assert.equal(h.requests.length, 2)
  assert.equal(h.page.data.detailState, 'loading')

  first.success({ code: '200', data: { id: 9, contents: '迟到的旧详情' } })
  assert.notEqual(h.page.data.info.contents, '迟到的旧详情')
  h.requests[1].success({ code: '200', data: { id: 9, contents: '最新详情' } })
  assert.equal(h.page.data.info.contents, '最新详情')
  assert.equal(h.page.data.detailState, 'ready')
})

test('评论和回复提交单飞，失败保留输入并展示持久恢复入口', () => {
  const h = loadPage('pages/square/detail/index.js')
  Object.assign(h.page.data, { id: 9, commentContent: '这条评论要保留' })

  h.page.addComment()
  h.page.addComment()
  assert.equal(h.requests.length, 1)
  assert.equal(h.page.data.commentSubmitting, true)
  h.requests[0].fail({ errMsg: 'request:fail timeout' })
  h.requests[0].complete()
  assert.equal(h.page.data.commentSubmitting, false)
  assert.equal(h.page.data.commentContent, '这条评论要保留')
  assert.match(h.page.data.commentSubmitError, /网络/)

  h.page.retryCommentSubmit()
  assert.equal(h.requests.length, 2)

  Object.assign(h.page.data, { replyContent: '这条回复要保留', replyId: 12 })
  h.page.addReplyComment()
  h.page.addReplyComment()
  assert.equal(h.requests.length, 3)
  assert.equal(h.page.data.replySubmitting, true)
  h.requests[2].success({ code: 500, msg: '回复暂时失败' })
  h.requests[2].complete()
  assert.equal(h.page.data.replyContent, '这条回复要保留')
  assert.equal(h.page.data.replySubmitError, '回复暂时失败')
})

test('两个广场页面把恢复状态和按钮忙碌语义呈现在界面上', () => {
  const listWxml = read('pages/square/list/index.wxml')
  const listJson = JSON.parse(read('pages/square/list/index.json'))
  const detailWxml = read('pages/square/detail/index.wxml')
  const detailJson = JSON.parse(read('pages/square/detail/index.json'))

  assert.equal(listJson.usingComponents['cy-inline-error'], '/components/cy/inline-error/index')
  assert.equal(listJson.usingComponents['cy-btn'], '/components/cy/btn/index')
  assert.equal(listJson.usingComponents['cy-post-card'], '/components/cy/post-card/index')
  assert.doesNotMatch(listWxml, /<cy-inline-error[^>]*staleError/s)
  assert.match(listWxml, /<cy-inline-error[^>]*wx:if="\{\{loadMoreError\}\}"[^>]*bind:action="retryLoadMore"/s)
  assert.match(listWxml, /<cy-inline-error[^>]*wx:if="\{\{submitError\}\}"[^>]*bind:action="retrySubmit"/s)
  // 2026-09-18 UI-15:行内发布区按用户要求去掉「发布」文字与扩大 icon,发布钮改 88rpx 图标钮。
  // 忙碌/禁用语义不能因此丢:submitFormData 仍是唯一提交点,loading 走 spinner,
  // 不可提交态由 compose-submit--off + aria-disabled 表达。
  assert.match(listWxml, /class="compose-submit \{\{canSubmit && !submitting \? '' : 'compose-submit--off'\}\}"[^>]*bindtap="submitFormData"/s)
  assert.match(listWxml, /aria-label="\{\{submitting \? '正在发布帖文' : '发布帖文'\}\}"/)
  assert.match(listWxml, /aria-disabled="\{\{!canSubmit \|\| submitting\}\}"/)

  assert.equal(detailJson.usingComponents['cy-inline-error'], '/components/cy/inline-error/index')
  assert.match(detailWxml, /<cy-skeleton[^>]*wx:if="\{\{commentsState === 'loading' && !list\.length\}\}"/s)
  assert.match(detailWxml, /<cy-empty[^>]*wx:if="\{\{commentsState === 'ready' && nodata\}\}"/s)
  assert.match(detailWxml, /<cy-inline-error[^>]*wx:if="\{\{commentLoadMoreError\}\}"[^>]*bind:action="retryCommentLoadMore"/s)
  // 2026-09-02 Figma 379:2571:评论条按稿只剩 头像 + 输入框,发送圆钮删除。
  // 忙碌语义因此不再有可挂的按钮 —— 契约改为守住「提交路径没消失」:
  // 键盘发送键(confirm-type="send" + bindconfirm="addComment")是现在唯一的提交入口,
  // 且失败后仍有 comment-submit-feedback 里的原位重试。少任何一条都判红。
  assert.doesNotMatch(detailWxml, /class="comment-submit"/, '发送圆钮已按稿删除,不许回流')
  // 2026-09-02:删掉发送键后 commentSubmitting / canComment 会变成孤儿状态(setData 了但没人消费),
  // 用户按完软键盘发送屏幕上毫无反馈。反馈改挂到输入框自己身上,这三条钉住它不再丢。
  assert.match(detailWxml, /class="david_npl_right[^"]*\{\{commentSubmitting \? 'is-sending'/,
    '发送中必须有可见反馈:输入框要消费 commentSubmitting')
  assert.match(detailWxml, /class="david_npl_right[^"]*\{\{canComment \? '' : 'is-idle'\}\}/,
    '空输入的禁用视觉必须有人消费 canComment,否则等于没有禁用态')
  assert.match(detailWxml, /class="comment-sending"[\s\S]*?aria-live="polite"[\s\S]*?aria-label="正在发送评论"/,
    '提交态必须能被读屏念出来(原来挂在已删按钮的 accessibility-label 上)')
  assert.match(detailWxml, /<input[^>]*bindconfirm="addComment"[^>]*confirm-type="send"/s,
    '删掉发送键后,评论提交只剩键盘发送键这一条路,它必须还在')
  assert.match(detailWxml, /<cy-inline-error[^>]*action="重试"[^>]*bind:action="retryCommentSubmit"/s,
    '提交失败仍要有原位重试入口')
  assert.match(detailWxml, /<cy-inline-error[^>]*wx:if="\{\{replySubmitError\}\}"[^>]*bind:action="retryReplySubmit"/s)
})

test('发布附件、帖子操作和评论操作均保留至少 88rpx 触达区', () => {
  const listWxss = read('pages/square/list/index.wxss')
  const postCardWxss = read('components/cy/post-card/index.wxss')
  const detailWxss = read('pages/square/detail/index.wxss')

  assert.match(listWxss, /\.compose-body \.btns button\s*\{[^}]*min-width:\s*88rpx[^}]*min-height:\s*88rpx/s)
  assert.match(postCardWxss, /\.post-card__action\s*\{[^}]*min-width:\s*88rpx[^}]*min-height:\s*88rpx/s)
  assert.match(postCardWxss, /\.post-card__share\s*\{[^}]*min-width:\s*88rpx[^}]*min-height:\s*88rpx/s)
  assert.match(detailWxss, /\.item-link button\s*\{[^}]*min-height:\s*88rpx/s)
  assert.match(detailWxss, /\.actions \.act\s*\{[^}]*min-height:\s*88rpx/s)
  assert.match(detailWxss, /\.actions \.act-share\s*\{[^}]*min-width:\s*88rpx[^}]*min-height:\s*88rpx/s)
  assert.match(detailWxss, /\.david_npl\s*\{[^}]*bottom:\s*env\(safe-area-inset-bottom\)[^}]*display:\s*flex/s)
})

test('广场评论与举报入口有准确可读名称，举报不再错用默认头像', () => {
  const listWxml = read('pages/square/list/index.wxml')
  const postCardWxml = read('components/cy/post-card/index.wxml')
  const postActionsWxml = read('pages/square/components/cy/post-actions/index.wxml')
  assert.match(listWxml, /<textarea[^>]*aria-label="帖文内容"/s)
  assert.match(postCardWxml, /catchtap="emitComment"[^>]*aria-role="button"[^>]*aria-label="查看评论，当前 \{\{post\.commentCount \|\| 0\}\}"/s)
  // 2026-09-16(H050/H051 收口):举报行从列表页自绘弹层退役,搬进三合一 cy-post-actions
  // (编辑/删除/举报)。守的判据不变:举报必须有可读名称,且不许顶一张默认头像冒充。
  assert.match(listWxml, /<cy-post-actions id="post-actions"[\s\S]{0,200}?bind:select="onPostAction"/s)
  assert.match(postActionsWxml, /aria-label="举报这条帖文"/s)
  assert.doesNotMatch(listWxml, /report-icon|bmClose/, '旧自绘举报弹层必须整体退役,不许留半截')
  assert.doesNotMatch(listWxml, /bindtap="reportSquare"[\s\S]*?src="\/images\/d_profile\.png"/)
})

test('负控：移除原位错误或单飞状态时契约会判红', () => {
  const source = read('pages/square/list/index.wxml')
  const mutated = source.replace(/<cy-inline-error[^>]*wx:if="\{\{loadMoreError\}\}"[^>]*\/>/, '')
  assert.notEqual(mutated, source, '负控锚点失效：加载更多错误组件不存在')
  assert.throws(() => assert.match(mutated, /wx:if="\{\{loadMoreError\}\}"/), assert.AssertionError)

  const detailSource = read('pages/square/detail/index.js')
  const dataSource = detailSource.slice(detailSource.indexOf('data:'), detailSource.indexOf('onImageLoad:'))
  const withoutBusy = dataSource.replace(/\n\s*commentSubmitting:\s*false,/, '')
  assert.notEqual(withoutBusy, dataSource, '负控锚点失效：评论忙碌状态不存在')
  assert.throws(() => assert.match(withoutBusy, /commentSubmitting:\s*false/), assert.AssertionError)
})
