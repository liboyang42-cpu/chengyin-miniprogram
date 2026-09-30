// K1/K3 客户两页:鉴权失败时**判据要宽、分流才要窄**。
//
// 两件事必须同时成立,少一件都出过事:
//   ① 只有 403 才说「岗位没权限」。401/登录失效/通用业务错误说成没权限,
//      会把人指去找主理人,而真正该做的是重新登录或重试。
//   ② 但**任何**鉴权失败都要立刻清掉已经渲染出来的客户 PII(姓名、脱敏手机号)——
//      身份已经不作数了,上一个身份的名单不能继续留在屏幕上。
//
// ⚠️ 2026-09-02 实测教训:为了修 ① 把 401/code 2 从判据里摘出去,
//    结果 401 落进通用错误分支,② 跟着失效 —— 名单还挂在屏幕上。
//    姊妹页 pages/club/enroll 早就是「宽判据 + 窄分流」的正确形态,
//    club-roster-recovery-contract 也一直在钉这条,只是客户两页没照做。
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')
const stripJsComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// 直接把两个纯函数抠出来跑 —— 判据是行为,不是文本。
// 钉文本会被判据自己的白名单数组 [2, 401, 403] 骗过(实测踩到)。
function evalPredicates(src) {
  const pick = name => {
    const m = new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`).exec(src)
    assert.ok(m, `抠不出 ${name},本合同的锚点要重挑`)
    return m[0]
  }
  return new Function(`${pick('isAuthFailure')}\n${pick('isForbidden')}
    return { isAuthFailure, isForbidden }`)()
}
const loadPredicates = jsPath => evalPredicates(read(jsPath))

const PAGES = [
  { js: 'pages/club/customers/index.js', wxml: 'pages/club/customers/index.wxml', pii: 'items' },
  { js: 'pages/club/customer-detail/index.js', wxml: 'pages/club/customer-detail/index.wxml', pii: 'detail' },
]

// 钉结构:取 deny() 的函数体,看它写了什么,不去匹配任何文案字面量
function denyBody(jsPath) {
  const src = stripJsComments(read(jsPath))
  const m = /\n  deny\(value, statusCode\) \{([\s\S]*?)\n  \},/.exec(src)
  assert.ok(m, `${jsPath} 里找不到 deny(value, statusCode),本合同的锚点要重挑`)
  return m[1]
}

for (const page of PAGES) {
  test(`${page.js}:判据要宽 —— 401 / code 2 / 403 都算鉴权失败`, () => {
    const { isAuthFailure } = loadPredicates(page.js)
    for (const code of [2, 401, 403]) {
      assert.equal(isAuthFailure({ code }), true, `判据漏了 ${code},这类失败不会触发清 PII`)
    }
    assert.equal(isAuthFailure({ code: 500 }), false, '判据太宽,把服务器错误也当成鉴权失败')
  })

  test(`${page.js}:分流要窄 —— 只有 403 进「没权限」`, () => {
    const body = denyBody(page.js)
    assert.match(body, /isForbidden\(/, 'deny 没有按 403 分流,又会把未登录说成没权限')
    assert.match(body, /'no-permission'\s*:\s*'error'/,
      '403 之外必须落到普通错误态,不能一律 no-permission')
    const { isForbidden } = loadPredicates(page.js)
    assert.equal(isForbidden({ code: 403 }), true, '403 必须判为没权限')
    assert.equal(isForbidden({ code: 401 }), false, '401 是未登录,不是没权限')
    assert.equal(isForbidden({ code: 2 }), false, 'code 2 是通用业务错误,不是没权限')
  })

  test(`${page.js}:任何鉴权失败都要清掉客户 PII`, () => {
    const body = denyBody(page.js)
    // 清空写在 setData 的公共部分,不能只挂在某个三元分支上
    assert.match(body, new RegExp(`${page.pii}:\\s*(\\[\\]|null)\\s*,`),
      `${page.pii} 没被无条件清空,旧身份的客户资料会留在屏幕上`)
    const line = body.split('\n').find(l => new RegExp(`^\\s*${page.pii}:`).test(l))
    assert.ok(line, `找不到 ${page.pii} 的赋值行`)
    assert.ok(!/[?]/.test(line), `${page.pii} 的清空写成了条件式:${line.trim()}`)
  })

  test(`${page.js}:每个失败回调都把 statusCode 传给 deny`, () => {
    const src = stripJsComments(read(page.js))
    const calls = [...src.matchAll(/that\.deny\(([^)]*)\)/g)].map(m => m[1])
    assert.ok(calls.length >= 3, `deny 调用点只有 ${calls.length} 个,少于三个回调`)
    // success 回调没有 statusCode 参数(HTTP 200 + 业务码),它传一个即可
    const missing = calls.filter(a => !/,/.test(a) && !/^res$/.test(a.trim()))
    assert.deepEqual(missing, [], '这些调用点吞掉了 statusCode,403 会被误判成普通错误')
  })
}

test('负控:把 401 从判据里摘掉,门禁必须变红', () => {
  const src = read(PAGES[0].js)
  // 两处都要改:return 里的比较,和上面那个 [2, 401, 403] 白名单数组。
  // 只改一处不会改变行为 —— 这正是「钉文本」会假绿、「跑行为」才作数的地方。
  const mutated = src
    .replace('code === 2 || code === 401 || code === 403', 'code === 403')
    .replace('[2, 401, 403].includes', '[403].includes')
  assert.notEqual(mutated, src, '变异没生效:判据形状已漂移,这个负控在空转')
  const { isAuthFailure } = evalPredicates(mutated)
  assert.equal(isAuthFailure({ code: 401 }), false, '判据没被真正削弱,这个负控在空转')
})

test('负控:把清 PII 挪进条件分支,门禁必须变红', () => {
  const body = denyBody(PAGES[0].js)
  const mutated = body.replace(/items:\s*\[\]\s*,/, 'items: forbidden ? [] : this.data.items,')
  assert.notEqual(mutated, body, '变异没生效:锚点已漂移,这个负控在空转')
  assert.equal(/items:\s*(\[\]|null)\s*,/.test(mutated), false, '判据认不出条件化的清空')
})
