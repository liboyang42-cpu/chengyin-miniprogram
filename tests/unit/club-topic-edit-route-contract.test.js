/* 5-04「编辑主题」:导演台/活动详情进 fabu 必须带编辑页真正认的参数。
 *
 * 病:goEditTopic 拼的是 `/pages/publish/fabu/index?topicId=`,而 fabu 只读 `options.id`
 *     (pages/publish/fabu/index.js onLoad)—— 于是「更多 → 编辑主题内容」和底部
 *     「修改并重新提交」都打开空白的新建表单,保存会多出一条新主题、原主题没改。
 * 治:宿主页改发 `?id=`(全仓其余入口都是 `?id=`)。
 * 负控:把 URL 改回 topicId/其他参数名,本文件必红。
 */
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const PAGE_JS = read('pages/club/topic-detail/index.js')
const FABU_JS = read('pages/publish/fabu/index.js')

// 抠出同名页面方法(括号配平,单行/多行写法都能取),绑到给定 this 上跑。
function pageMethod(name) {
  const marker = '\n  ' + name + '() {'
  const start = PAGE_JS.indexOf(marker)
  assert.ok(start >= 0, 'index.js 缺 ' + name)
  let depth = 0
  for (let i = start + marker.length - 1; i < PAGE_JS.length; i++) {
    if (PAGE_JS[i] === '{') depth += 1
    else if (PAGE_JS[i] === '}') {
      depth -= 1
      if (depth === 0) return new Function('return function () {' + PAGE_JS.slice(start + marker.length, i) + '\n}')()
    }
  }
  throw new Error(name + ' 括号不闭合')
}

test('编辑主题:goEditTopic 发的参数必须是 fabu 认的 id,不是 topicId', () => {
  // fabu 的入口参数真源就在这里 —— 改坏 goEditTopic 会跟它对不上
  assert.match(FABU_JS, /const editingTopicId = options\.id \? String\(options\.id\) : ''/,
    'fabu 编辑入口读的是 options.id;参数名变了这条合同也要跟着改')

  const navigations = []
  global.wx = { navigateTo: (o) => navigations.push(o && o.url) }
  const ctx = { _topicId: 88 }
  pageMethod('goEditTopic').call(ctx)

  assert.equal(navigations.length, 1)
  assert.match(navigations[0], /^\/pages\/publish\/fabu\/index\?id=88(?:&|$)/,
    '必须带 ?id=88 —— 带 topicId 打开的是空白新表单,保存会多建一条主题')
  assert.doesNotMatch(navigations[0], /topicId=/)
})
