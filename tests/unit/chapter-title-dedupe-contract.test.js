'use strict'

// CU-C-87 契约:章节标题 = 位置序号 + 用户填的名字,名字自带编号时不再叠一层。
//
// 走查实证:「更多 → 编辑主题内容」看到「第1章 第1章 隔离书店站」。序号是位置派生的
// (改顺序跟着变,权威),名字是可选补充;名字本身写成「第1章 隔离书店站」时旧实现又加一次。
//
// 判据有两份实现(章节卡走 WXS、发布确认预览走 JS,WXS 不能 require 普通 JS 模块),
// 本契约把两份逐例钉在一起 —— 只改一份会让同一章在卡片和确认页显示成两个标题。

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function loadWxs(relativePath) {
  const sandbox = { module: { exports: {} } }
  vm.runInNewContext(read(relativePath), sandbox)
  return sandbox.module.exports
}

const wxsLabel = loadWxs('utils/wxs/chapter-title.wxs').label

/* ── 生产 JS 侧(发布确认预览用同一份判据) ──────────────────────────────── */

let fabuConfig
function loadFabu() {
  fabuConfig = null
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44, userInfo: {} },
    getUserID: () => 1,
    getPageSize: () => 10,
    getTotalPage: (total, size) => Math.ceil(total / size),
    sendRequest() {},
    tips() {},
    setUserRole() {},
  })
  global.Page = (config) => { fabuConfig = config }
  global.wx = {
    showLoading() {}, hideLoading() {}, showToast() {}, showModal() {},
    navigateTo() {}, navigateBack() {}, switchTab() {}, redirectTo() {},
    stopPullDownRefresh() {}, setNavigationBarTitle() {},
    getStorageSync: () => '', setStorageSync() {}, removeStorageSync() {},
    getSystemInfoSync: () => ({ statusBarHeight: 20, windowWidth: 375, windowHeight: 667, screenHeight: 667, pixelRatio: 2 }),
    getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 375, windowHeight: 667, screenHeight: 667, pixelRatio: 2 }),
    getMenuButtonBoundingClientRect: () => ({ top: 24, right: 363, width: 87, height: 32 }),
    createSelectorQuery: () => ({
      in: () => ({ select: () => ({ fields: () => ({ exec() {} }), boundingClientRect: () => ({ exec() {} }) }) }),
      select: () => ({ boundingClientRect: () => ({ exec() {} }) }),
      exec() {},
    }),
  }
  const absolute = path.resolve(ROOT, 'pages/publish/fabu/index.js')
  delete require.cache[require.resolve(absolute)]
  require(absolute)
  const page = Object.assign({}, fabuConfig)
  page.data = JSON.parse(JSON.stringify(fabuConfig.data))
  page.setData = (patch) => Object.keys(patch).forEach((key) => { page.data[key] = patch[key] })
  return page
}

function previewChapterNames(chapterNames) {
  const page = loadFabu()
  page.data.formData = Object.assign({}, page.data.formData, {
    name: '隔离书店站',
    chapters: chapterNames.map((name, index) => ({ _localId: 'c' + index, name, nodes: [] })),
  })
  return page._buildPublishPreview().chapters.map((chapter) => chapter.name)
}

/* ── 用例 ────────────────────────────────────────────────────────────────── */

const CASES = [
  // [章节序号, 库里的名字, 期望]
  [0, '隔离书店站', '第1章 隔离书店站'],
  [0, '第1章 隔离书店站', '第1章 隔离书店站'],   // 走查实证:不能再叠一层
  [0, '第 1 章 隔离书店站', '第 1 章 隔离书店站'],
  [0, '第一二三章 隔离书店站', '第一二三章 隔离书店站'],
  [0, '第一二三四章 隔离书店站', '第1章 第一二三四章 隔离书店站'], // 超出 1~3 字,不算编号
  [1, '第1章', '第1章'],                       // 服务端默认名「第N章」原样保留(旧口径也如此)
  [1, '第2章', '第2章'],                       // 名字里的编号与位置不一致时,尊重用户写的名字
  [2, '', '第3章'],
  [2, null, '第3章'],
  [2, undefined, '第3章'],
  [2, '第章', '第3章 第章'],                   // 「第」后一个字符都没有,不算编号
  [3, '第二章 夜行', '第二章 夜行'],
  [4, '第4章·尾声', '第4章·尾声'],
]

test('章节标题:名字自带编号时不重复加序号,两份实现逐例一致', () => {
  const fromJs = previewChapterNames(CASES.map(([, name]) => name))
  CASES.forEach(([index, name, expected], i) => {
    assert.equal(wxsLabel(index, name), expected, `WXS 侧:第${index + 1}章 name=${JSON.stringify(name)}`)
    // 确认预览按数组位置派生序号,所以 JS 侧与 WXS 在**同一位置**上的结果必须逐字相同
    assert.equal(fromJs[i], wxsLabel(i, name),
      `两份实现漂移(位置 ${i + 1},name=${JSON.stringify(name)}):卡片与确认页会显示成两个标题`)
  })
})

test('章节卡与发布确认预览都走这一份判据,不再各拼一次前缀', () => {
  const wxml = read('pages/publish/fabu/index.wxml')
  assert.match(wxml, /<wxs src="\.\.\/\.\.\/\.\.\/utils\/wxs\/chapter-title\.wxs" module="chapterTitle" \/>/,
    '章节卡必须从 WXS 取标题')
  assert.match(wxml, /\{\{chapterTitle\.label\(chapterIndex, chapter\.name\)\}\}/)
  assert.doesNotMatch(wxml, /chapter\.name !== \('第' \+ \(chapterIndex \+ 1\) \+ '章'\)/,
    '旧的全等判据只覆盖「名字恰等于默认名」一种,名字带说明时照样重复')

  const js = read('pages/publish/fabu/index.js')
  assert.doesNotMatch(js, /name: `第\$\{index \+ 1\}章 \$\{\(chapter && chapter\.name\) \|\| ''\}`/,
    '确认预览原来无条件加前缀,是同一个病的第二处')
})

test('负控:标题退回无条件加前缀,契约必须判红', () => {
  const page = loadFabu()
  page.data.formData = Object.assign({}, page.data.formData, {
    name: '隔离书店站',
    chapters: [{ _localId: 'c0', name: '第1章 隔离书店站', nodes: [] }],
  })
  page._buildPublishPreview = function () {
    const fd = this.data.formData
    return { chapters: (fd.chapters || []).map((chapter, index) => ({ name: `第${index + 1}章 ${(chapter && chapter.name) || ''}` })) }
  }
  assert.equal(page._buildPublishPreview().chapters[0].name, '第1章 第1章 隔离书店站')
  assert.notEqual(page._buildPublishPreview().chapters[0].name, '第1章 隔离书店站',
    '旧实现必须复现出重复序号,证明这条断言不是在给橡皮图章盖章')
})
