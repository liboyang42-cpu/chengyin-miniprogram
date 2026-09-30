'use strict'

// 票务页「档期 / 商家招商」两块的结构与文案(2026-09-05 用户拍板)。
//
// 这三条各自防一个具体的回归,不是走过场:
//  ① 区块标题不许再随身份变。旧写法 `merchantPoolEditable ? '档期与商家池' : '档期'`
//     让标题去回答「你是谁」,而且主理人把开关关成自办后标题照旧承诺「商家池」。
//  ② 开关文案不许再按入口切。旧写法 `lockClub ? '愿意商家参与' : '开放给商家市场'`,
//     而 lockClub 判的是【进页时带没带 clubId】—— 同一个主理人两个入口两个说法。
//  ③ 招商截止日期必须留在档期块、且不挂在商家开关下面。它对自由探索是**无条件必填**
//     (后端拿它置 lifecycle=1 招募,见 utils/publish/pro-editor-policy.js:11);
//     挪进商家块或加上 openMerchantPool 条件,都会暗示「关了就不用填」,
//     而真实后果是发布时被后端硬拒。

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const WXML_PATH = path.join(ROOT, 'pages/publish/fabu/step3.wxml')

// 取 <view class="pd-section-title" ...>文本</view> 的列表,按出现顺序
function sectionTitles(wxml) {
  return [...wxml.matchAll(/<view class="pd-section-title"[^>]*>([^<]*)<\/view>/g)].map((m) => m[1].trim())
}

function assertContract(overrides = {}) {
  const raw = overrides.wxml === undefined ? fs.readFileSync(WXML_PATH, 'utf8') : overrides.wxml
  // ⚠️ 必须先去注释再断言:本页的注释里【逐字引用了被废弃的旧文案】(那是它们该待的地方 ——
  //    注释要说清楚改的是什么)。不去注释,"旧文案不许再出现"这条会永远红在自己的说明上。
  const wxml = raw.replace(/<!--[\s\S]*?-->/g, '')
  const titles = sectionTitles(wxml)

  // ① 标题是固定字面量,不含任何插值
  for (const t of titles) {
    assert.doesNotMatch(t, /\{\{/, `区块标题不许随数据变:「${t}」`)
  }
  assert.ok(titles.includes('档期'), '缺少「档期」区块')
  assert.ok(titles.includes('商家招商'), '缺少「商家招商」区块')

  // ② 开关标题是固定字面量,且旧的两个按入口切的名字都不许再出现
  assert.match(wxml, /<text class="node-card__title">开放给商家承接<\/text>/, '商家开关标题必须是固定文案')
  for (const stale of ['愿意商家参与', '开放给商家市场']) {
    assert.doesNotMatch(wxml, new RegExp(stale), `按入口切的旧文案还在:${stale}`)
  }

  // ③ 招商截止日期只由 productType 决定,不许挂 openMerchantPool
  const deadlineAt = wxml.indexOf('招商截止日期')
  assert.ok(deadlineAt > 0, '缺少招商截止日期')
  const recruitSectionAt = wxml.indexOf('>商家招商<')
  assert.ok(deadlineAt < recruitSectionAt, '招商截止日期必须留在档期块,不能挪到商家招商块之后')
  const block = wxml.slice(Math.max(0, deadlineAt - 1200), deadlineAt)
  assert.doesNotMatch(block, /openMerchantPool/, '招商截止日期不许挂在商家开关的条件上：它是无条件必填')
}

test('档期与商家招商拆成两块，标题固定、文案不按入口切', () => {
  assertContract()
})

test('负控：标题退回按身份插值会判红', () => {
  const wxml = fs.readFileSync(WXML_PATH, 'utf8').replace(
    '<view class="pd-section-title">档期</view>',
    `<view class="pd-section-title">{{merchantPoolEditable ? '档期与商家池' : '档期'}}</view>`,
  )
  assert.throws(() => assertContract({ wxml }), /区块标题不许随数据变/)
})

test('负控：开关文案退回按 lockClub 切会判红', () => {
  const wxml = fs.readFileSync(WXML_PATH, 'utf8').replace(
    '<text class="node-card__title">开放给商家承接</text>',
    `<text class="node-card__title">{{lockClub ? '愿意商家参与' : '开放给商家市场'}}</text>`,
  )
  assert.throws(() => assertContract({ wxml }), /固定文案|旧文案还在/)
})
