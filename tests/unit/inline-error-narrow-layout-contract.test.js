'use strict'

/* cy-inline-error 在窄容器里必须能折行(2026-09-02 实拍坐实)。
 *
 * 病:组件是 `display:flex` 单行排布 —— 图标(40rpx)+ 间距(24)+ 操作键(min-width 144rpx)
 * + 左右内边距(48)固定占位,正文拿 `flex:1` 吃剩下的。放进创建域「玩家人数 / 玩法时长」
 * 那种两列格(列宽约 330rpx)时,正文只剩几十 rpx ⇒ **标题被压成每行一个字的竖排**。
 * 这不是"挤一点",是整块信息读不出来,而且只在错误态出现 —— 平时截图根本看不到。
 *
 * 判据:窄容器要能把操作键挤到下一行,而不是把正文压没。
 * 负控:去掉 flex-wrap 或把 min-width 归零,本文件必须红。
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const WXSS = path.join(__dirname, '../../components/cy/inline-error/index.wxss')
const css = fs.readFileSync(WXSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ')
const rule = (sel) => {
  const m = css.match(new RegExp(`\\${sel}\\s*\\{([^}]*)\\}`))
  assert.ok(m, `缺少样式规则 ${sel}`)
  return m[1]
}

test('窄容器里操作键换行,正文不被压成竖排', () => {
  assert.match(rule('.inline-error'), /flex-wrap:\s*wrap/, '不折行的 flex 在窄容器里会把正文压没')
  const copy = rule('.inline-error__copy')
  const min = copy.match(/min-width:\s*(\d+)rpx/)
  assert.ok(min, '正文必须有 min-width,否则 flex 会一路压到 0')
  assert.ok(Number(min[1]) >= 200, `正文最小宽度 ${min[1]}rpx 太小,仍会压出竖排`)
})

test('操作键与图标仍不参与收缩(它们是固定占位,收缩了会变形)', () => {
  assert.match(rule('.inline-error__action'), /flex:\s*none/)
  assert.match(rule('.inline-error__icon'), /flex:\s*none/)
})
