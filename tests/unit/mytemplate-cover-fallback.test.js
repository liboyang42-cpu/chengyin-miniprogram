const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
const MYTEMPLATE_JS = path.join(ROOT, 'subpackageMember/mytemplate/mytemplate.js')

function assertCoverFallback(source) {
  // R4-C04:封面选源 / 本地图片 fallback / 卡高 420 未获文档 §5.5 授权,源码已按 github/master
  // 原形手工恢复,故这里的期望同步回「标题首字 + DS 渐变」兜底与 item.imgUrl 主图条件。
  assert.match(source.wxml, /wx:if="\{\{item\.imgUrl && !item\.coverFailed\}\}"[\s\S]*binderror="onCoverError"/)
  assert.match(source.wxml, /class="item-pic-fallback"[^>]*aria-role="img"[\s\S]*class="item-pic-image"/)
  assert.match(source.wxml, /data-index="\{\{index\}\}" data-key="\{\{item\.id\}\}"/)
  assert.doesNotMatch(source.wxml, /wx:else[^>]*class="item-pic-fallback"/)
  assert.match(source.js, /decorateItem\(item\)[\s\S]*coverFailed: false[\s\S]*coverInitial/)
  assert.match(source.js, /onCoverError\(e\)[\s\S]*Number\.isInteger\(index\)/)
  assert.match(source.js, /currentKey[\s\S]*String\(boundKey \|\| ''\) !== currentKey/)
  assert.match(source.js, /processedData = data\.map\(item => that\.decorateItem\(item\)\)/)
  assert.doesNotMatch(source.js, /processedData = data\.map\(item => this\.decorateItem\(item\)\)/)
  // 2026-07-31 UI 改版第2批(去紫色化):品牌紫渐变换成中性灰渐变(AI 复查补充)
  assert.match(source.wxss, /\.item-pic-fallback[\s\S]*background: linear-gradient\(135deg, var\(--cy-bg-subtle\), var\(--cy-color-bg-surface-subtle\)\)/)
  assert.match(source.wxss, /\.item-pic\{[\s\S]*position: relative;/)
  assert.match(source.wxss, /\.item-pic-fallback[\s\S]*z-index:\s*0;/)
  assert.match(source.wxss, /\.item-pic-image[\s\S]*z-index: 1;/)
  assert.match(source.wxss, /\.item-pic \.btns\s*\{[\s\S]*z-index:\s*2;/, '封面上的评分/引用 chip 必须压在主图之上')
  // 未授权改动不得回潮
  assert.doesNotMatch(source.js, /resolveCoverUrl|DEFAULT_TEMPLATE_COVER|firstUsableImage/, '封面选源(§5.5 未授权)不得回潮')
  assert.match(source.wxss, /\.item-pic\{[\s\S]*height: 512rpx;/, '卡高按 master 原形 512rpx')
  // §5.5-5 明确授权保留的 token 替换:--cy-font-display 已废弃(G8),兜底字号必须是 --cy-type-page-title
  assert.match(source.wxss, /\.item-pic-fallback[\s\S]*font-size: var\(--cy-type-page-title\)/)
}

function loadMyTemplatePage() {
  const sandbox = { requests: [] }
  global.getApp = () => ({
    getRequestErrorMessage: (response, fallback) => (response && response.msg) || fallback,
    sendRequest: request => sandbox.requests.push(request),
  })
  global.Page = config => { sandbox.pageConfig = config }
  global.wx = {
    getAccountInfoSync() { return { miniProgram: { envVersion: 'release' } } },
    navigateTo() {},
    showModal() {},
    showToast() {},
  }
  delete require.cache[require.resolve(MYTEMPLATE_JS)]
  require(MYTEMPLATE_JS)
  const page = Object.assign({}, sandbox.pageConfig, {
    setData(patch) { Object.assign(this.data, patch) },
  })
  page.data = Object.assign({}, sandbox.pageConfig.data)
  return { page, sandbox }
}

test('我的模板封面失败时退到「标题首字 + DS 渐变」兜底，不留下空黑洞', () => {
  assertCoverFallback({
    wxml: read('subpackageMember/mytemplate/mytemplate.wxml'),
    js: read('subpackageMember/mytemplate/mytemplate.js'),
    wxss: read('subpackageMember/mytemplate/mytemplate.wxss'),
  })
})

// R4-C04:原「封面选源」行为测试(resolveCoverUrl / storyImg / 本地兜底)所测的机制未获
// §5.5 授权、已按 master 撤除,故改为断言恢复后的 decorateItem 语义:标题首字兜底。
test('我的模板兜底取标题首字，缺标题时退到「玩」', () => {
  const { page } = loadMyTemplatePage()
  assert.equal(page.decorateItem({ id: 1, title: '街角密码' }).coverInitial, '街')
  assert.equal(page.decorateItem({ id: 2, name: '夜行者' }).coverInitial, '夜')
  assert.equal(page.decorateItem({ id: 3 }).coverInitial, '玩', '无标题时必须仍有兜底字')
  assert.equal(page.decorateItem({ id: 4, title: '  留白  ' }).coverInitial, '留', '首字取值前先 trim')
  assert.equal(page.decorateItem({ id: 5, title: 'A线' }).coverFailed, false)
  assert.equal(page.decorateItem({ id: 6, title: 'A线' }).drop, false)
})

test('负控：移除稳定 data-key 身份闸必须判红', () => {
  const source = read('subpackageMember/mytemplate/mytemplate.wxml')
  const mutated = source.replace('data-index="{{index}}" data-key="{{item.id}}"', 'data-index="{{index}}"')
  assert.throws(() => assertCoverFallback({
    wxml: mutated,
    js: read('subpackageMember/mytemplate/mytemplate.js'),
    wxss: read('subpackageMember/mytemplate/mytemplate.wxss'),
  }))
})

// R4-C04:以下三条负控原本守的是未授权的 coverUrl 选源,已换成守「未授权改动不得回潮」。
test('负控 R4：卡高退回未授权的 420rpx 时必须判红', () => {
  const wxss = read('subpackageMember/mytemplate/mytemplate.wxss')
  const mutated = wxss.replace('height: 512rpx;', 'height: 420rpx;')
  assert.notEqual(mutated, wxss, '变异锚点失效：未找到 512rpx 卡高')
  assert.throws(() => assertCoverFallback({
    wxml: read('subpackageMember/mytemplate/mytemplate.wxml'),
    js: read('subpackageMember/mytemplate/mytemplate.js'),
    wxss: mutated,
  }), assert.AssertionError)
})

test('负控 R4：封面选源(resolveCoverUrl)回潮时必须判红', () => {
  const js = read('subpackageMember/mytemplate/mytemplate.js')
  const mutated = js.replace('decorateItem(item) {', 'resolveCoverUrl(item) { return DEFAULT_TEMPLATE_COVER; },\n  decorateItem(item) {')
  assert.notEqual(mutated, js, '变异锚点失效：未找到 decorateItem')
  assert.throws(() => assertCoverFallback({
    wxml: read('subpackageMember/mytemplate/mytemplate.wxml'),
    js: mutated,
    wxss: read('subpackageMember/mytemplate/mytemplate.wxss'),
  }), assert.AssertionError)
})

test('负控 R4：兜底字号退回已废弃的 --cy-font-display 时必须判红(§5.5-5 授权保留项)', () => {
  const wxss = read('subpackageMember/mytemplate/mytemplate.wxss')
  const mutated = wxss.replace('font-size: var(--cy-type-page-title);', 'font-size: var(--cy-font-display);')
  assert.notEqual(mutated, wxss, '变异锚点失效：未找到兜底字号')
  assert.throws(() => assertCoverFallback({
    wxml: read('subpackageMember/mytemplate/mytemplate.wxml'),
    js: read('subpackageMember/mytemplate/mytemplate.js'),
    wxss: mutated,
  }), assert.AssertionError)
})

test('负控：封面 chip 去掉 z-index 层级时必须判红', () => {
  const wxss = read('subpackageMember/mytemplate/mytemplate.wxss')
  const mutated = wxss.replace(/(\.item-pic \.btns\s*\{[\s\S]*?)\s*z-index:\s*2;/, '$1')
  assert.notEqual(mutated, wxss, '变异锚点失效：未找到 chip 层级')
  assert.throws(() => assertCoverFallback({
    wxml: read('subpackageMember/mytemplate/mytemplate.wxml'),
    js: read('subpackageMember/mytemplate/mytemplate.js'),
    wxss: mutated,
  }), assert.AssertionError)
})
