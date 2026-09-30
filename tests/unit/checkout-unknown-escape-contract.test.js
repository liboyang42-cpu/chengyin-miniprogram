/* unknown 逃生门契约(2026-09-19 审查 F-UK-1)
 *
 * `utils/checkout/checkout-workflow.js` 把 unknown 做成**终态**:支付结果不明时 submit() 之后恒返回 false,
 * 对外也没有复位接口。这道闸是对的(防重复建单扣款),但它的代价全压在调用方身上 ——
 * 宿主若在 `if (!submitted)` 里只撤 loading,玩家刚付过钱、再点按钮就什么也不发生。
 *
 * 所以这条尺子量的不是「有没有闸」而是**闸会不会说话**:每个把 workflow 挂成宿主属性的文件,
 * 它的 `!submitted` 分支里必须有一句给人看的话(toast / modal / 带文案的 _finishAction)。
 * 少一句,那个宿主的按钮就是哑巴。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')

function listJs(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'tests') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listJs(full, out)
    else if (entry.name.endsWith('.js')) out.push(full)
  }
  return out
}

const HOSTS = ['pages', 'components', 'subpackageA', 'subpackageB', 'subpackageMember', 'subpackageP3']
  .map((d) => path.join(ROOT, d))
  .filter((d) => fs.existsSync(d))
  .reduce((acc, d) => acc.concat(listJs(d)), [])
  .map((f) => path.relative(ROOT, f))
  .filter((rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    return /_workflow\s*=\s*createCheckoutWorkflow/.test(src)
  })
  .sort()

/** 取 `if (!submitted) { ... }` 那一整块(花括号配平),没这块返回 null。 */
function submittedBlock(src) {
  const open = src.search(/if\s*\(\s*!\s*submitted\s*\)\s*\{/)
  if (open < 0) return null
  let depth = 0
  for (let i = src.indexOf('{', open); i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1)
  }
  return null
}

const VOICE = /modal\.show\s*\(|\btoast\s*\(|_finishAction\s*\(\s*[^)]*,\s*[^)]+,\s*['"`]/

test('每个 checkout workflow 宿主都得给 unknown 一个说法(闸不能是哑巴)', () => {
  assert.ok(HOSTS.length >= 5, '宿主清单缩水了,这条尺子就没用了:只找到 ' + HOSTS.length + ' 个')
  const silent = HOSTS.filter((rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    const block = submittedBlock(src)
    if (block === null) return true
    return !VOICE.test(block)
  })
  assert.deepEqual(silent, [],
    '这些宿主挂了 workflow 却在 !submitted 分支里不给一句话 —— 结果不明时按钮点了没反应:\n' + silent.join('\n'))
})
