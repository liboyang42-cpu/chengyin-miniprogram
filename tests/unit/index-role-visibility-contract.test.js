const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(
  path.join(__dirname, '../../pages/index/index.js'),
  'utf8'
)

test('首页玩家分支清除旧角色留下的隐藏闸', () => {
  const playerBranch = source.match(/if \(isMerchantView\(\)\) \{[\s\S]*?\n    \}\n([\s\S]*?)\n    \/\/ 能力模型/)
  assert.ok(playerBranch, '首页 onLoad must keep an explicit player branch')
  assert.match(playerBranch[1], /setData\(\{ _needsRedirect: false \}\)/)
})

test('首页 onShow 玩家分支也复位隐藏闸', () => {
  const onShow = source.match(/onShow\(\) \{([\s\S]*?)\n  \},\n\n  \/\*|onShow\(\) \{([\s\S]*)$/)
  assert.ok(onShow, 'index page must expose onShow')
  const body = onShow[1] || onShow[2]
  assert.match(body, /if \(isMerchantView\(\)\)/)
  assert.match(body, /this\.setData\(\{ _needsRedirect: false \}\)/)
})

test('身份负控：删掉玩家分支复位会判红', () => {
  const mutated = source.replace(
    /\n    \/\/ data 初值可能在旧角色快照下创建[\s\S]*?that\.setData\(\{ _needsRedirect: false \}\);/,
    ''
  )
  assert.doesNotMatch(mutated, /data 初值可能在旧角色快照下创建/)
  assert.throws(() => {
    const playerBranch = mutated.match(/if \(isMerchantView\(\)\) \{[\s\S]*?\n    \}\n([\s\S]*?)\n    \/\/ 能力模型/)
    assert.match(playerBranch[1], /setData\(\{ _needsRedirect: false \}\)/)
  })
})
