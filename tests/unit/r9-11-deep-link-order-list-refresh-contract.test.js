'use strict'
// 1-36 R9-11 残留核实:scene-deep-link 壳不需要监听 orderchanged —— 订单列表与订单详情在同一条
// wx:if/elif 链里互斥渲染,打开详情时列表已卸载,返回时重新挂载并在 attached() 重拉列表。
// 本契约钉住这个前提:谁把两者改成同时挂载(列表留在底下),就必须像 subpackageMember/order 那样接 orderchanged。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')

test('R9-11:深链壳里订单列表与详情互斥挂载,或列表必须监听 orderchanged', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'components/cy/scene-deep-link/index.wxml'), 'utf8')
  const branchOf = id => {
    const line = wxml.split('\n').find(l => l.includes(`sceneCurrent.id === '${id}'`))
    assert.ok(line, `深链壳缺 ${id} 分支`)
    return line.match(/wx:(if|elif)=/)[1]
  }
  const exclusive = branchOf('member-order-detail') === 'elif' && branchOf('member-order-history') === 'elif'
  const listensOrderChanged = /cy-scene-member-order-detail[^>]*bind:orderchanged=/.test(wxml)
  assert.ok(exclusive || listensOrderChanged, '列表与详情同时挂载时必须接 orderchanged 刷新列表')

  // 重新挂载即重拉:attached 里必须调 getList
  const js = fs.readFileSync(path.join(ROOT, 'components/cy/scene-member-order-history/index.js'), 'utf8')
  const attached = js.match(/attached\(\)\s*\{([\s\S]*?)\n\s{4}\}/)
  assert.ok(attached && /this\.getList\(/.test(attached[1]), '列表挂载时必须拉取最新订单')
})
