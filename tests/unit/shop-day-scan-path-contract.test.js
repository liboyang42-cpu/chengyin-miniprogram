const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

function assertScanPathContract(js) {
  // mode2 的 checkin 成功分支必须在 onComplete 之前被拦下:onComplete 会本地置 done+庆祝,
  // 把「进店」演成「已核销」(2026-08-15 F6)。
  assert.match(js, /that\.data\.mode === 2 && !isGame\) \{ that\.onShopDayArrived\(litId, r\.data\); return; \}/)
  assert.match(js, /onShopDayArrived\(nodeId, data\) \{/)
  const guard = js.indexOf('that.onShopDayArrived(litId')
  const complete = js.indexOf('that.onComplete(litId')
  assert.ok(guard !== -1 && complete !== -1 && guard < complete, 'mode2 拦截必须先于 onComplete')
  assert.match(js, /onShopDayArrived[\s\S]{0,400}\/pages\/play\/merchant\/index\?nodeId=/)
}

function assertCoordinateArrivalContract(js) {
  const arrive = js.slice(js.indexOf('  arrive(nodeId, via) {'), js.indexOf('  checkin(nodeId, code, source) {'))
  assert.match(
    arrive,
    /that\.data\.mode === 2\) \{ that\.onShopDayArrived\(nodeId, r\.data\); return; \}/,
    'mode2 无坐标/手动到店成功后也只能进入到店态，不能直接完成节点',
  )
  const guard = arrive.indexOf('that.onShopDayArrived(nodeId')
  const complete = arrive.indexOf('that.onComplete(nodeId')
  assert.ok(guard !== -1 && complete !== -1 && guard < complete, '到店态拦截必须先于 onComplete')
}

test('探店日扫码进店不得走 onComplete,必须转商家页三步条', () => {
  assertScanPathContract(read('pages/play/index.js'))
})

test('探店日无坐标站点手动到店不得走 onComplete,必须转商家页三步条', () => {
  assertCoordinateArrivalContract(read('pages/play/index.js'))
})

test('mutation 负控:删掉 mode2 拦截时契约确实变红', () => {
  const js = read('pages/play/index.js')
    .replace('if (that.data.mode === 2 && !isGame) { that.onShopDayArrived(litId, r.data); return; }', '')
  assert.throws(() => assertScanPathContract(js), assert.AssertionError)
})

test('mutation 负控:删掉无坐标到店拦截时契约确实变红', () => {
  const js = read('pages/play/index.js')
    .replace('if (that.data.mode === 2) { that.onShopDayArrived(nodeId, r.data); return; }', '')
  assert.throws(() => assertCoordinateArrivalContract(js), assert.AssertionError)
})
