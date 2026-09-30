const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')

function walk(dir, out = []) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    if (e.name === 'node_modules' || e.name === '.git') return
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.isFile() && e.name.endsWith('.wxml')) out.push(p)
  })
  return out
}

/** 一个 cy-error 标签是不是「按下去什么都不会发生」。 */
function isDeadRetry(tag) {
  if (/bind:?retry/.test(tag)) return false        // 绑了监听 = 活的
  if (/retry\s*=\s*""/.test(tag)) return false     // 显式关掉按钮 = 压根不渲染
  // auto-back 走的是组件模板第一个分支(cy-error/index.wxml:2):原位只剩一块占位 + 零按钮
  // cy-result-sheet,带按钮的 wx:else 整棵子树都不渲 ⇒ 这里没有「死按钮」可言。
  if (/auto-back|autoBack/.test(tag)) return false
  return true
}

test('cy-error 的默认「重试」按钮不许没人接:全仓每个使用点要么绑 bind:retry,要么显式 retry="",要么走 auto-back(按钮压根不渲)', () => {
  // 成因:components/cy/error/index.js 的 retry 属性 value 默认是 '重试' ——
  // 不传它就会渲染出按钮,而 onRetry 只是 triggerEvent('retry')。使用方不绑 = 死按钮。
  // 2026-08-18 实测有 4 个这样的使用点(profile 三处 + coop/withdraw),
  // 其中 profile 三处还各自另画了一个「重新加载」,凑成一屏两个 CTA、先点到的那个是死的。
  const dead = []
  walk(ROOT).forEach((file) => {
    const src = fs.readFileSync(file, 'utf8')
    // WXML 条件表达式可以在引号内包含 `>`（如 list.length>0），不能把它误当标签结尾。
    const re = /<cy-error\b(?:[^>"']|"[^"]*"|'[^']*')*\/?>/gs
    let m
    while ((m = re.exec(src))) {
      if (isDeadRetry(m.group ? m.group(0) : m[0])) {
        dead.push(`${path.relative(ROOT, file)}:${src.slice(0, m.index).split('\n').length}`)
      }
    }
  })
  assert.deepEqual(dead, [], '这些 cy-error 会渲染出一个没人监听的「重试」:\n  ' + dead.join('\n  '))
})

test('判据自身的负控:构造的死/活标签必须分得开', () => {
  assert.equal(isDeadRetry('<cy-error title="x" />'), true)
  assert.equal(isDeadRetry('<cy-error title="x" retry="重试" />'), true, '只给文案不绑事件仍是死按钮')
  assert.equal(isDeadRetry('<cy-error title="x" bind:retry="reload" />'), false)
  assert.equal(isDeadRetry('<cy-error wx:if="{{list.length>0}}" bind:retry="reload" />'), false)
  assert.equal(isDeadRetry('<cy-error title="x" retry="" />'), false)
  assert.equal(isDeadRetry('<cy-error title="x" auto-back />'), false,
    'auto-back 只渲零按钮半屏,没有重试按钮可死')
})

test('组件默认值没变:retry 仍默认渲染按钮,所以上面那条契约必须一直在', () => {
  const js = fs.readFileSync(path.join(ROOT, 'components/cy/error/index.js'), 'utf8')
  assert.match(js, /retry:\s*\{\s*type:\s*String,\s*value:\s*'重试'\s*\}/,
    'cy-error 的 retry 默认值改了就来更新本契约(默认不渲染按钮的话这条可以放宽)')
})
