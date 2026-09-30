const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const { resolveOpenState } = require('../../pages/play/utils/play-open-state.js')

test('营业态按 openStatus 优先、businessTime 兜底、都没有则留空', () => {
  // 留空是有意的:拿不到就整行不渲染,不许编「营业时间未知」这种假信息。
  assert.equal(resolveOpenState({ openStatus: '营业中' }).openText, '营业中')
  assert.equal(resolveOpenState({ openStatus: '即将打烊' }).openText, '即将打烊')
  assert.equal(resolveOpenState({ openStatus: '已打烊' }).openText, '已打烊')
  assert.equal(resolveOpenState({ businessTime: '10:00-22:00' }, 12 * 60).openText, '营业中')
  assert.equal(resolveOpenState({ businessTime: '10:00-22:00' }, 3 * 60).openText, '已打烊')
  assert.equal(resolveOpenState({}).openText, '')
  assert.equal(resolveOpenState(null).openText, '')
})

test('openStatus 存在时不看 businessTime —— 后端三态优先', () => {
  // 凌晨 3 点但后端说营业中(如通宵店/后端已算过)⇒ 必须听后端的,不许被客户端兜底覆盖。
  assert.equal(resolveOpenState({ openStatus: '营业中', businessTime: '10:00-22:00' }, 3 * 60).openText, '营业中')
})

test('三处消费方都读换算结果,不得再读 normNode 根本不产的 node.openText', () => {
  // 2026-08-14 实证:normNode() 产 businessTime/openStatus,**从不产 openText**;
  // 而 poiCard / 六宫格瓦片 / 商家权益页当时都在读 `n.openText || ''` ⇒ 营业信息永久不显示,
  // 且不报错、不留空字符串以外的痕迹 —— 是「发出去的死 UI」,静态门禁与字符串契约测都看不见。
  const playJs = fs.readFileSync(path.join(ROOT, 'pages/play/index.js'), 'utf8')
  const merchantJs = fs.readFileSync(path.join(ROOT, 'pages/play/merchant/index.js'), 'utf8')
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  assert.doesNotMatch(strip(playJs), /\b[a-z]\.openText \|\| ''/,
    'play 页不得再回落读 x.openText —— 那个字段不存在,读了等于永久空白')
  assert.match(strip(playJs), /resolveOpenState\(/, 'play 页必须走共享换算')
  assert.match(strip(merchantJs), /resolveOpenState\(/, '商家权益页必须走共享换算')
})

test('负控:把 openStatus 分支删掉,三态断言必须判红', () => {
  const source = fs.readFileSync(path.join(ROOT, 'pages/play/utils/play-open-state.js'), 'utf8')
  assert.match(source, /if \(status\) \{/, '负控锚点失效:openStatus 优先分支的写法变了')
  // 这里只证明锚点还在、可被破坏;真正的红由上面三条断言在实现被改坏时给出。
})
