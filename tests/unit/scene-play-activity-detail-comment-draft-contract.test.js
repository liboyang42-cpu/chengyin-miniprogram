/* CU-C-105(2026-09-24 走查第二轮 C24):评价提交失败后关闭表单,草稿无提醒即丢。
 * 失败文案自称「评分和文案已保留,请重试」(fail / successStatusAbnormal 两个分支),关闭动作却
 * 无条件清空 answer/plnr/uploadImages —— 同一组件里两处自相矛盾。这里把「提示与行为一致」钉成合同:
 * 关闭 = 只收起表单、保留草稿;只有提交成功才清空。
 *
 * CU-C-104:后端 CommentPublicationService 允许任何人评(只有首评积分要求已支付/已核销报名),
 * 页面却在填完表、按了发布之后才可能撞上积分口径。裁决是保持人人可评,但填表前写明
 * 「未参与本次活动的评价不计首评积分」,入口不得加资格禁用。
 */
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

const ROOT = path.join(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const WXML = 'components/cy/scene-play-activity-detail/index.wxml'
const DRAFT_TEXT = '写好的评价'
const DRAFT_IMAGES = ['https://cdn.example.com/a.png']

function mount() {
  const requests = []
  global.getApp = () => ({ sendRequest: (o) => requests.push(o) })
  global.wx = { showToast: () => true, nextTick: (fn) => fn() }

  // 拦掉 utils/modal.js、utils/toast.js 的真模块(它们依赖 wx 环境),评价流程只用到 toast.success
  const modalPath = require.resolve(path.join(ROOT, 'utils/modal.js'))
  const toastPath = require.resolve(path.join(ROOT, 'utils/toast.js'))
  delete require.cache[modalPath]
  delete require.cache[toastPath]
  require.cache[modalPath] = { id: modalPath, filename: modalPath, loaded: true, exports: { show: () => true } }
  require.cache[toastPath] = {
    id: toastPath, filename: toastPath, loaded: true,
    exports: { success: () => true, error: () => true, show: () => true, hide: () => true },
  }

  let def = null
  global.Component = (c) => { def = c }
  const abs = require.resolve(path.join(ROOT, 'components/cy/scene-play-activity-detail/index.js'))
  delete require.cache[abs]
  require(abs)
  delete global.Component
  delete require.cache[modalPath]
  delete require.cache[toastPath]

  const data = Object.assign({}, def.data)
  for (const [k, spec] of Object.entries(def.properties || {})) data[k] = spec.value
  Object.assign(data, { activityId: 42 })
  const inst = Object.assign({ data }, def.methods, {
    setData(patch, cb) { Object.assign(this.data, patch); if (typeof cb === 'function') cb() },
    triggerEvent() {},
    reload() {},
  })
  return { inst, requests }
}

/** 打开表单并填好一份草稿(星级 + 文案 + 图片),发布按钮应处于可用态。 */
function filledForm() {
  const m = mount()
  m.inst.openComment()
  m.inst.changeRating({ currentTarget: { dataset: { index: 2 } } })
  m.inst.onCommentInput({ detail: { value: DRAFT_TEXT } })
  m.inst.setData({ uploadImages: DRAFT_IMAGES.slice() })
  assert.equal(m.inst.data.canSubmitComment, true, '前提失效:草稿填满了发布按钮却没启用')
  return m
}

function assertDraftKept(inst, where) {
  assert.equal(inst.data.answer, 2, where + ':关闭不能清空星级评分,失败提示承诺「评分和文案已保留」')
  assert.equal(inst.data.plnr, DRAFT_TEXT, where + ':关闭不能清空已写文案')
  assert.deepEqual(inst.data.uploadImages, DRAFT_IMAGES, where + ':关闭不能清空已选图片')
  assert.equal(inst.data.canSubmitComment, true, where + ':草稿还在,重开应能直接重试')
}

test('CU-C-105 ① 审核/业务失败后关闭表单:草稿保留,重新打开还在', () => {
  const m = filledForm()
  m.inst.submitComment()
  assert.equal(m.requests.length, 1, '应发出 /api/comment/add')
  assert.equal(m.requests[0].url, '/api/comment/add')

  // 走查现场:隔离环境返回「内容审核暂时不可用」,没有到达资格判断
  m.requests[0].success({ code: 500, msg: '内容审核暂时不可用，请联系平台' })
  assert.match(String(m.inst.data.commentError), /内容审核暂时不可用/, '失败应有页内错误')
  assert.equal(m.inst.data.commentSubmitting, false)

  m.inst.closeComment()
  assert.equal(m.inst.data.voteShow, false, '关闭应收起表单')
  assertDraftKept(m.inst, '业务失败')

  m.inst.openComment()
  assert.equal(m.inst.data.voteShow, true, '重新打开应看到表单')
  assert.equal(m.inst.data.plnr, DRAFT_TEXT, '重新打开应看到上次内容')
})

test('CU-C-105 ② 网络失败(fail 分支)关闭表单同样保留草稿', () => {
  const m = filledForm()
  m.inst.submitComment()
  m.requests[0].fail()
  assert.match(String(m.inst.data.commentError), /已保留/, '网络失败应提示文案已保留')

  m.inst.closeComment()
  assertDraftKept(m.inst, '网络失败')
})

test('CU-C-105 ③ 提交成功后草稿清空、表单收起', () => {
  const m = filledForm()
  m.inst.submitComment()
  m.requests[0].success({ code: 200 })

  assert.equal(m.inst.data.voteShow, false, '提交成功应收起表单')
  assert.equal(m.inst.data.answer, -1, '提交成功后应清空星级')
  assert.equal(m.inst.data.plnr, '', '提交成功后应清空文案')
  assert.deepEqual(m.inst.data.uploadImages, [], '提交成功后应清空图片')
  assert.equal(m.inst.data.canSubmitComment, false, '提交成功后发布按钮应回到不可用态')
})

test('CU-C-105 ④ 提交中不允许关闭(原守卫不能被顺手改掉)', () => {
  const m = filledForm()
  m.inst.submitComment()
  assert.equal(m.inst.data.commentSubmitting, true, '前提失效:提交中没有置 submitting')
  m.inst.closeComment()
  assert.equal(m.inst.data.voteShow, true, '提交还没回来,关闭不能把表单收掉')
})

test('CU-C-104 填表前说明资格口径:提示在评分控件之前', () => {
  const wxml = read(WXML)
  const formStart = wxml.indexOf('wx:if="{{voteShow}}" class="activity-form"')
  assert.ok(formStart > -1, '锚点失配:评价表单不在了')

  const hintAt = wxml.indexOf('未参与本次活动的评价不计首评积分', formStart)
  assert.ok(hintAt > -1, '表单里必须写明「未参与本次活动的评价不计首评积分」,否则零报名用户白写一遍才知道资格')

  const ratingAt = wxml.indexOf('class="activity-rating"', formStart)
  assert.ok(ratingAt > -1, '锚点失配:评分控件不在了')
  assert.ok(hintAt < ratingAt, '提示必须排在评分/文案输入之前,否则仍是「资格提示滞后」')
})

test('CU-C-104 「写评价」入口保持人人可评:不加资格禁用/隐藏', () => {
  const wxml = read(WXML)
  const entryAt = wxml.indexOf('bindtap="openComment"')
  assert.ok(entryAt > -1, '锚点失配:「写评价」入口不在了')
  const entryTag = wxml.slice(wxml.lastIndexOf('<', entryAt), wxml.indexOf('>', entryAt))
  assert.doesNotMatch(entryTag, /disabled|wx:if|hidden/, '入口不能按报名/核销资格禁用或隐藏,裁决是保持人人可评')
})
