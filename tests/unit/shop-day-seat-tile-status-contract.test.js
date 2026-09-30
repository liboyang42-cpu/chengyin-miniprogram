const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

function seatTilesBlock(js) {
  const m = js.match(/const seatTiles = mode !== 2 \? \[\] : nodes\.map\([\s\S]*?\)\);/)
  assert.ok(m, 'seatTiles 构造块必须存在于 pages/play/index.js')
  return m[0]
}

function assertSeatTileStatusContract(js, wxml) {
  const block = seatTilesBlock(js)
  for (const field of ['crowded: x.crowded', 'statusText: proofStatus(x)', 'waitText:']) {
    assert.ok(block.includes(field), 'seatTiles 缺凭证字段:' + field)
  }
  const st = wxml.match(/<view class="fx-tile__st">[^<]*<\/view>/)
  assert.ok(st, 'fx-tile__st 必须存在于 pages/play/index.wxml')
  assert.match(st[0], /item\.statusText/)
  assert.match(st[0], /item\.crowded/)
  assert.match(st[0], /item\.waitText/)
}

test('mode2 六宫格必须携带三态/拥挤字段且被 fx-tile__st 消费(F1:曾错加进 scriptTiles 致主屏全哑)', () => {
  assertSeatTileStatusContract(read('pages/play/index.js'), read('pages/play/index.wxml'))
})

test('mutation 负控:把 statusText 从 seatTiles 挪走时契约确实变红', () => {
  const js = read('pages/play/index.js')
  const block = seatTilesBlock(js)
  const mutated = js.replace(block, block.replace('statusText: proofStatus(x),', ''))
  assert.throws(() => assertSeatTileStatusContract(mutated, read('pages/play/index.wxml')), assert.AssertionError)
})
