'use strict'

// C-38:券类型只有一份真源(utils/coupon-form.js),独立新建页 / 发布流 sheet / 商家券列表都读它,
// 体验卡(couponType=3)不能在独立页显示成「优惠券」、也不能在独立新建页选不到。
// C-37:发布接口不写批次码,商家券详情不能摆一行「发布批次券码 —」。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const { COUPON_TYPE_LABELS } = require(path.join(ROOT, 'utils/coupon-form.js'))

function loadCouponPage(source) {
  const pagePath = path.join(ROOT, 'subpackageMember/coupon/coupon.js')
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx }
  const requests = []
  global.getApp = () => ({ sendRequest(options) { requests.push(options) } })
  global.wx = {}
  let definition
  global.Page = (config) => { definition = config }
  if (source) {
    // COUPON-RPT-18 负控:按变异源码建模块,不污染 require 缓存
    const Module = require('node:module')
    const m = new Module(pagePath, module)
    m.filename = pagePath
    m.paths = Module._nodeModulePaths(path.dirname(pagePath))
    m._compile(source, pagePath)
  } else {
    delete require.cache[require.resolve(pagePath)]
    require(pagePath)
  }
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch) },
  })
  const restore = () => {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete global[key]; else global[key] = previous[key]
    }
    delete require.cache[require.resolve(pagePath)]
  }
  return { page, requests, restore }
}

test('C-38 券类型真源含体验卡,下标 = 后端 couponType + 1', () => {
  assert.deepEqual(COUPON_TYPE_LABELS, ['请选择', '礼品券', '9折券', '8折券', '体验卡'])
})

test('C-38 独立新建页与发布流 sheet 的类型选项都来自同一真源', () => {
  const { Page, getApp } = global
  let definition
  global.Page = (config) => { definition = config }
  const pagePath = path.join(ROOT, 'subpackageMember/couponInfo/couponInfo.js')
  try {
    global.getApp = () => ({})
    delete require.cache[require.resolve(pagePath)]
    require(pagePath)
  } finally {
    if (Page === undefined) delete global.Page; else global.Page = Page
    if (getApp === undefined) delete global.getApp; else global.getApp = getApp
    delete require.cache[require.resolve(pagePath)]
  }
  assert.deepEqual(definition.data.array2, COUPON_TYPE_LABELS)
  assert.match(read('pages/publish/components/reward-selector/index.js'),
    /const COUPON_TYPE_LABELS = couponForm\.COUPON_TYPE_LABELS;/)
})

test('C-38 商家券列表把 couponType=3 显示为体验卡,已有三类不变', () => {
  const env = loadCouponPage()
  try {
    env.page.getList()
    env.requests[0].success({
      code: 200,
      data: [0, 1, 2, 3].map((couponType) => ({ id: couponType + 1, name: 'n' + couponType, couponType })),
    })
    assert.deepEqual(env.page.data.list.map((c) => c.couponTypeText), ['礼品券', '9折券', '8折券', '体验卡'])
  } finally {
    env.restore()
  }
})

test('C-37 批次券码为空(—)时整行不渲染', () => {
  const wxml = read('subpackageMember/coupon/coupon.wxml').replace(/<!--[\s\S]*?-->/g, '')
  assert.match(wxml,
    /<block wx:if="\{\{currentCoupon\.code !== '—'\}\}">\s*<view class="coupon-batch-label">发布批次券码<\/view>\s*<view class="coupon-batch-code">\{\{currentCoupon\.code\}\}<\/view>\s*<\/block>/)
})

test('COUPON-RPT-18 couponType=-1(存量无类型)显示为「优惠券」,不再落成表单占位「请选择」', () => {
  const env = loadCouponPage()
  try {
    env.page.getList()
    env.requests[0].success({
      code: 200,
      data: [
        { id: 1, name: '无类型老券', couponType: -1 },
        { id: 2, name: '礼品券', couponType: 0 },
      ],
    })
    assert.deepEqual(env.page.data.list.map((c) => c.couponTypeText), ['优惠券', '礼品券'])
  } finally {
    env.restore()
  }

  // 负控:退回「直接 [type+1] 取下标」时,-1 必然落回「请选择」
  const source = read('subpackageMember/coupon/coupon.js')
  const broken = source.replace(
    /    couponTypeText: Number\(item\.couponType\) < 0\n      \? '优惠券'\n      : \(COUPON_TYPE_LABELS\[Number\(item\.couponType\) \+ 1\] \|\| '优惠券'\),/,
    "    couponTypeText: COUPON_TYPE_LABELS[Number(item.couponType) + 1] || '优惠券',",
  )
  assert.notEqual(broken, source, '负控锚点失效:负类型分支未命中')
  const mutated = loadCouponPage(broken)
  try {
    mutated.page.getList()
    mutated.requests[0].success({ code: 200, data: [{ id: 1, name: '无类型老券', couponType: -1 }] })
    assert.deepEqual(mutated.page.data.list.map((c) => c.couponTypeText), ['请选择'], '负控必须复现「请选择」')
  } finally {
    mutated.restore()
  }
})

test('RUN-017 同日不同小时的券保留中国时间起止时刻', () => {
  const env = loadCouponPage()
  try {
    env.page.getList()
    env.requests[0].success({ code: 200, data: [{ id: 1, name: '当日券', startTime: '2026-09-25T01:00:00Z', endTime: '2026-09-25 18:00:00' }] })
    assert.equal(env.page.data.list[0].startDay, '2026.09.25 09:00')
    assert.equal(env.page.data.list[0].endDay, '2026.09.25 18:00')
  } finally { env.restore() }
})
