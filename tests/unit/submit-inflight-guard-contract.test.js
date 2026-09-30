'use strict'

/* 提交类按钮的在途保护(2026-08-26)
 *
 * 起因:排查「按钮要知道点过了」时,粗扫报出「20 个提交按钮裸奔」。
 * 逐个读下来**只有 1 个是真的** —— 那 20 个是三次高估叠出来的:
 *   ① 正则只看 wxml 属性,没看 handler 到底发不发请求(本地 setData 的也算进去了);
 *   ② 函数体按固定字符数截断,越过边界把别的函数的请求算成了自己的;
 *   ③ 没算 `hideLoading: false` —— 那会出系统 loading 遮罩,本身就挡住了重复点击。
 *
 * 所以这条门禁的口径必须写全,否则它会变成一个天天误报的噪音源:
 * 一个提交按钮算「有保护」,只要满足**任意一条**:
 *   A. wxml 上有 loading= / disabled= / kind 里给了 disabled;
 *   B. handler 里有在途闸(data 的 submitting/saving/… 或实例的 this._xxx);
 *   C. 请求没关系统遮罩(没写 hideLoading: true)—— 遮罩期间点不到按钮。
 *
 * 当前违规 0 —— 立此门禁是为了**防新增**,不是为了清理存量(存量已经清完了)。
 *
 * 2026-08-27 口径加固(两条已查证的逃逸):
 *   ① handler 也认 catchtap / catch:tap —— 之前只认 bind:tap,catchtap 的按钮取不到
 *      handler 就整个跳过(仓内 9 处 cy-btn 用 catchtap);
 *   ② 文案白名单补「确定/确认/完成/下一步」。
 * 扩后全量扫仍为 0 违规 —— 新进扫描范围的 30 处已逐个读码核过:或有界面在途态(A),
 * 或是不发请求的本地动作,或走系统遮罩(C,如 merchantinfo reconfirmCircleSupply
 * 的 hideLoading: false 已回读确认)。无需登记表条目。
 *
 * ⚠️ 已知盲区(有意不做,列在这防止误以为门禁全覆盖):
 *   - 非 cy-btn 的可点元素(view/button 原生 tap)不在扫描范围;
 *   - 转调:handler 只 triggerEvent / this.xxx() 转调时,请求在别的函数或父组件里,
 *     REQUEST_CALL 会漏判成「本地动作」(如 topic/components/project-host:87 emit;
 *     又如 merchant/shezhi:77 submitSceneForm 经 selectComponent().submitForm() 转调,
 *     实际防线在子组件自己的 submitting 早退闸,不是本门禁扫出来的);
 *   - 箭头函数 / 动态挂载的 handler,bodyOf 取不到函数体;
 *   - 按钮内容超 80 字符(如 publish/fabu「创建节点」按钮,内嵌 cy-icon 撑长)整个
 *     匹配不上 —— 该处已人工核过:onTapAddNode 是本地动作不发请求;
 *   - 文案是 {{绑定}} 的按钮(如 project-join 的 chapterActionText)测不了白名单。
 */

const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const SKIP = new Set(['node_modules', 'miniprogram_npm', 'dist', 'tests', 'scripts', 'docs'])

/** 会产生后果的动作文案。只挡这些 —— 「查看」「返回」这类点多少次都无所谓 */
const SUBMIT_LABEL = /提交|保存|发布|报名|申请|支付|领取|参加|创建|下单|加入|结算|兑换|核销|撤回|确定|确认|完成|下一步/
const REQUEST_CALL = /sendRequest|wx\.request|requestPayment/

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, acc)
    else if (e.name.endsWith('.wxml')) acc.push(full)
  }
  return acc
}

/** 括号匹配取函数体 —— 按字符数截断会把隔壁函数的请求算进来 */
function bodyOf(src, name) {
  const head = new RegExp('\\b' + name + '\\s*(?::\\s*function)?\\s*\\([^)]*\\)\\s*\\{')
  const m = head.exec(src)
  if (!m) return null
  const start = src.indexOf('{', m.index)
  let depth = 0
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return null
}

/* ⚠️ 扫描逻辑参数化,负控喂内存里的假文件 —— **测试绝不能往仓库里写探针文件**。
   本仓的单测是并发跑的,台账/死组件那些扫描器同时在遍历目录,
   临时建出来的探针会被它们看见,把无关用例带红(实测踩过)。 */
function scanPairs(pairs) {
  const bad = []
  for (const pair of pairs) {
    const file = pair.name
    const markup = String(pair.markup || '').replace(/<!--[\s\S]*?-->/g, '')
    const src = String(pair.src || '')

    const re = /<cy-btn([^>]*)>([\s\S]{0,80}?)<\/cy-btn>/g
    let m
    while ((m = re.exec(markup))) {
      const attrs = m[1]
      const label = m[2].replace(/\s+/g, ' ').trim()
      if (!SUBMIT_LABEL.test(label)) continue

      // A:界面上已经表达了在途/不可点
      if (/loading=|disabled=|kind="\{\{[^"]*disabled/.test(attrs)) continue

      // catchtap 与 bind:tap 同权 —— 之前只认 bind,catchtap 的提交按钮整个漏扫
      const handler = (attrs.match(/(?:bind|catch):?tap="([a-zA-Z_]\w*)"/) || [])[1]
      if (!handler) continue
      const body = bodyOf(src, handler)
      if (!body) continue
      if (!REQUEST_CALL.test(body)) continue // 本地动作,点多少次都不发请求

      // B:handler 里有在途闸
      if (/(submitting|saving|loading|posting|creating|joining|paying|claiming)\s*:\s*true/.test(body)) continue
      if (/this\._\w+\s*=\s*true/.test(body) || /if\s*\(\s*this\._\w+\s*\)\s*return/.test(body)) continue

      // C:没关系统遮罩 —— 遮罩期间根本点不到
      if (!/hideLoading\s*:\s*true/.test(body)) continue

      bad.push(file + ':' + (markup.slice(0, m.index).split('\n').length) +
        ' 「' + label.slice(0, 20) + '」 → ' + handler)
    }
  }
  return bad
}

/** 真实仓库的扫描 —— 只读,不写 */
function scanUnguarded() {
  const pairs = []
  for (const file of walk(ROOT)) {
    const js = file.replace(/\.wxml$/, '.js')
    if (!fs.existsSync(js)) continue
    pairs.push({
      name: path.relative(ROOT, file),
      markup: fs.readFileSync(file, 'utf8'),
      src: fs.readFileSync(js, 'utf8'),
    })
  }
  return scanPairs(pairs)
}

test('会产生后果的按钮都必须挡住连点 —— 界面、js 闸、系统遮罩,三者有其一', () => {
  const bad = scanUnguarded()
  assert.deepEqual(bad, [],
    '这些按钮会发请求,却既没有界面在途态、也没有 js 闸、还关掉了系统遮罩:\n  ' +
    bad.join('\n  ') +
    '\n三选一:wxml 加 loading/disabled、handler 加在途闸、或去掉 hideLoading: true。')
})

test('负控:造一个三样都不占的提交按钮,必须判红', () => {
  const bad = scanPairs([{
    name: 'probe/index.wxml',
    markup: '<cy-btn bindtap="doSubmit">提交</cy-btn>',
    src: 'Component({ methods: { doSubmit() { app.sendRequest({ hideLoading: true, url: "/x" }) } } })',
  }])
  assert.equal(bad.length, 1, '新增的裸奔提交按钮必须被抓到')
  assert.match(bad[0], /probe/)
})

test('负控:三种保护各自都要能让它变绿,不能只认其中一种', () => {
  const variants = [
    ['界面 loading', '<cy-btn loading="{{busy}}" bindtap="doSubmit">提交</cy-btn>',
      'Component({ methods: { doSubmit() { app.sendRequest({ hideLoading: true, url: "/x" }) } } })'],
    ['js 在途闸', '<cy-btn bindtap="doSubmit">提交</cy-btn>',
      'Component({ methods: { doSubmit() { if (this._f) return; this._f = true; app.sendRequest({ hideLoading: true, url: "/x" }) } } })'],
    ['系统遮罩', '<cy-btn bindtap="doSubmit">提交</cy-btn>',
      'Component({ methods: { doSubmit() { app.sendRequest({ url: "/x" }) } } })'],
  ]
  for (const [name, markup, src] of variants) {
    assert.deepEqual(scanPairs([{ name: 'probe/index.wxml', markup, src }]), [],
      name + ' 这一种保护没有被认出来,门禁会误报')
  }
})

test('负控:catchtap 的裸奔提交按钮同样要判红 —— 这曾是真实逃逸口', () => {
  const bad = scanPairs([{
    name: 'probe/index.wxml',
    markup: '<cy-btn catchtap="doSubmit">提交</cy-btn>',
    src: 'Component({ methods: { doSubmit() { app.sendRequest({ hideLoading: true, url: "/x" }) } } })',
  }])
  assert.equal(bad.length, 1, 'catchtap 取不到 handler 直接跳过 = 门禁只是装着在看')
  assert.match(bad[0], /probe/)
})

test('负控:「确定/确认/完成/下一步」文案的裸奔提交按钮要判红 —— 白名单补漏', () => {
  for (const label of ['确定', '确认', '完成', '下一步']) {
    const bad = scanPairs([{
      name: 'probe/index.wxml',
      markup: '<cy-btn bindtap="doSubmit">' + label + '</cy-btn>',
      src: 'Component({ methods: { doSubmit() { app.sendRequest({ hideLoading: true, url: "/x" }) } } })',
    }])
    assert.equal(bad.length, 1, '「' + label + '」不在白名单里,这类按钮整个漏扫')
  }
})

test('负控:只发本地 setData 的按钮不该被要求加在途保护', () => {
  assert.deepEqual(scanPairs([{
    name: 'probe/index.wxml',
    markup: '<cy-btn bindtap="doSubmit">确认这个店址</cy-btn>',
    src: 'Component({ methods: { doSubmit() { this.setData({ confirmed: true }) } } })',
  }]), [], '本地动作被要求加在途保护 —— 误报会拿不存在的问题挡住别人的 PR')
})
