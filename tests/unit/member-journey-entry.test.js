const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// 2026-08-06 主页统一到 cy-profile 共用组件：member/index 与 userinfo 的 wxml/wxss
// 只剩壳，本文件的断言原本钉在旧结构上。约束没失效、只是搬进了组件 ——
// 在读文件这一层展开，断言原样保留。
const { readResolved } = require('../helpers/resolve-profile');

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => readResolved(relativePath)

test('A32：玩家我的页只保留一个横向票夹按钮，项目不再画进度条', () => {
  const js = read('pages/member/index/index.js')
  const wxml = read('pages/member/index/index.wxml')

  // "游玩"重复分组已删除
  assert.doesNotMatch(wxml, /class="pc-journey-hub"/)
  assert.doesNotMatch(wxml, /bindtap="goJourneyContinue"/)

  // 自己的玩家视角隐藏「开始探索」和更多，仅票夹占满操作行；他人/商户语义不受影响。
  // 2026-08-11 商家主页收编:原来锁死 `{{!isSelf || isMerchantView}}` 这一串字面量。
  // 「他人」这一支现在要再分一次——被看者是商家时走「发起合作」，不再出关注钮——
  // 所以条件变成 `(!isSelf && !subjectIsMerchant) || (isSelf && isMerchantView)`。
  // 约束没变:**自己 + 玩家视角这一格必须为假**。按这两个分支分别断言，不锁整串。
  const primary = wxml.match(/<view class="pc-primary [^>]*bindtap="onPrimaryCta"/)
  assert.ok(primary, '主按钮必须仍由 onPrimaryCta 驱动')
  const cond = primary[0].match(/wx:if="\{\{([^}]*)\}\}"/)
  assert.ok(cond, '主按钮必须带 wx:if 条件')
  assert.match(cond[1], /isSelf && isMerchantView/, '自己视角只有商家(核销)才出主按钮')
  assert.doesNotMatch(cond[1], /(^|\|\|)\s*isSelf\s*($|\|\|)/, '玩家自己视角不得无条件出主按钮')
  assert.match(wxml, /class="pc-primary pc-ticket"[^>]*wx:if="\{\{isSelf && !isMerchantView\}\}"[^>]*bindtap="goSignup"/)
  // 2026-09-18 UI-12:公开视角也要「···」更多(条件放宽,自绘入口不复制)。
  assert.match(wxml, /class="pc-more"[^>]*wx:if="\{\{!isSelf \|\| isMerchantView\}\}"/)
  assert.doesNotMatch(wxml, /class="pc-xbox-bar"/)
  assert.match(js, /goSignup:\s*function \(\)\s*\{\s*wx\.navigateTo\(\{\s*url:\s*'\/subpackageMember\/signup\/index'/)
})
