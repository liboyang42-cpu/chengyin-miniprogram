'use strict'

/* 成功 toast 棘轮(2026-08-27)
 *
 * 8-26 那轮排查的核心结论:全仓 819 次 `wx.showToast`,其中相当一部分是在
 * **用提示代替状态**。toast 有三个致命属性,决定了它不能替代状态:
 *   ① 两秒后消失 —— 用户回到页面时,界面已经忘了他做过什么;
 *   ② 同一时刻只能有一个 —— 连续动作后面的会顶掉前面的;
 *   ③ 离开页面就没了 —— 从详情页返回列表,列表不知道你刚报过名。
 *
 * 「提示」是我告诉你一次,「状态」是你随时能看见。这条棘轮盯的是
 * `icon: 'success'` 这一类 —— 它们几乎总是在说「你刚做成了一件事」,
 * 而那正是最该留在界面上、最不该两秒后消失的东西。
 *
 * ⚠️ **只减不增**。每减一个,意味着多了一处真正的界面状态(按钮变文案、
 * 列表出角标、条目进历史)。数字调不小,说明没真修。
 *
 * ⚠️ 这条门禁**不管** `icon: 'none'` 的提示 —— 那多半是校验失败/网络异常,
 * 本来就该是一次性的。把它们一起卷进来会让棘轮变成一个降不下去的噪音源。
 */

const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const SKIP = new Set(['node_modules', 'miniprogram_npm', 'dist', '.git', 'tests', 'scripts', 'design'])

/* 当前值。**只准调小**,并在下面 CHANGELOG 记一笔。 */
// 2026-09-06:原扫描器只看 showToast 第一层花括号,带 success(){} 回调的多行调用一直漏数;
// 原生 toast 全部改成 toast.success(...) 后逐个可数,实测 110(不是涨了,是原来数漏了)。
// 2026-09-06 合入 github/master:专业发布页删掉 previewTopic 与合作者选择器,
// 连带 4 处 cyToast.success/成功提示一起没了 ⇒ 上限贴实测调小 110 → 106。
const SUCCESS_TOAST_CEILING = 101

/* CHANGELOG
 * 2026-09-11 106 → 101(**收紧**)。并入 master 后贴实测:本 PR 的结果面板替换再叠 master 上专业发布页等处减掉的成功 toast。
 * 2026-09-06 110 → 106(**收紧**)。结果面板 cy-result-sheet 接进 9 条链路,
 *   把「发布成功 / 已保存 / 购买成功 / 报名支付成功」这几处 icon:'success' 的一次性提示
 *   换成了「面板报一下 + 自愈后落到真正承载状态的那一页」(项目主页 / 订单详情 / 票夹 /
 *   协作列表)。正合本门禁的本意:每减一个,就是多了一处用户随时能看见的状态,
 *   而不是两秒后就忘了的提示。
 * 2026-08-27 立此门禁。106 是当天实测值(819 次 showToast 里的 icon:'success' 部分)。
 *   ⚠️ 第一版写的是 110 —— 那是用贪婪正则 `showToast\(\s*\{([^}]*)\}` 数出来的,
 *   它会把参数里 `success() {...}` 回调体一起吃进来,把回调里别的 icon 误算成本次的。
 *   「上限贴着实测值」那条断言当场把这个虚高抓出来了(110 vs 106)。
 *   这正是它存在的理由:虚高的上限 = 悄悄留给下一次增长的额度。
 *   ⚠️ 这个数字不是目标,是**上限**。8-25 那份清单把「减 toast」写进 P2 却没配门禁,
 *   一个月后 toast 总数不降反升 —— 所以先钉住再往下修。
 * 2026-08-30 106 → 102。危险动作三段式确认这一批把四处「成功 toast」换成了
 *   确认组件自己的 done() 终态(界面记得,不是弹一下就没)。往下调不需要理由,
 *   但记一笔是为了让下次看到 102 的人知道它是修出来的,不是拍的。
 */

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) { if (!SKIP.has(entry.name)) walk(path.join(dir, entry.name), out) }
    else if (entry.name.endsWith('.js')) out.push(path.join(dir, entry.name))
  }
  return out
}

/** @returns [{ file, count }] 按文件统计 icon:'success' 的 showToast */
function scan(read, files) {
  const rows = []
  for (const file of files) {
    const src = read(file)
    let count = 0
    // 只取 showToast 的**第一层对象**:参数里嵌 success(){} 回调很常见,
    // 贪婪匹配会把回调体一起吃进来,把里面别的 icon 误算成本次的。
    for (const m of src.matchAll(/showToast\(\s*\{([^{}]*)\}/g)) {
      if (/icon:\s*['"]success['"]/.test(m[1])) count += 1
    }
    // 2026-09-06 原生 toast 全删后,成功提示写成 toast.success(...) / cyToast.success(...)(utils/toast.js);
    // 同一件事换了写法,棘轮照数。
    count += (src.match(/\b(?:cy)?[tT]oast\.success\(/g) || []).length
    if (count) rows.push({ file, count })
  }
  return rows
}

const FILES = walk(ROOT).map((f) => path.relative(ROOT, f))
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

test('成功 toast 只减不增', () => {
  const rows = scan(read, FILES)
  const total = rows.reduce((sum, row) => sum + row.count, 0)
  assert.ok(total > 0, '一个都没扫到,扫描器坏了 —— 全绿在这里等于没测')
  assert.ok(total <= SUCCESS_TOAST_CEILING,
    '成功 toast ' + total + ' > 上限 ' + SUCCESS_TOAST_CEILING + '。\n' +
    '  新增一次「成功提示」= 又一处「做成了但界面不记得」。\n' +
    '  要么改成界面状态,要么把上限连同 CHANGELOG 一起显式调大并说明为什么。\n' +
    '  当前分布(前十):\n' +
    rows.sort((a, b) => b.count - a.count).slice(0, 10)
      .map((row) => '    ' + row.count + '  ' + row.file).join('\n'))
})

test('上限贴着实测值,不许留虚高余量 —— 留了余量就等于没有棘轮', () => {
  const total = scan(read, FILES).reduce((sum, row) => sum + row.count, 0)
  assert.ok(SUCCESS_TOAST_CEILING - total <= 3,
    '上限 ' + SUCCESS_TOAST_CEILING + ' 比实测 ' + total + ' 高出 ' +
    (SUCCESS_TOAST_CEILING - total) + ' —— 修好了就把上限调到实测值,别留空档给下一次悄悄涨')
})

test('★负控:凭空多一处成功 toast,棘轮必须判红', () => {
  const probe = 'pages/__probe__/index.js'
  const filler = "wx.showToast({ title: '好了', icon: 'success' })\n".repeat(SUCCESS_TOAST_CEILING + 1)
  const fakeRead = (rel) => (rel === probe ? filler : read(rel))
  const rows = scan(fakeRead, [probe])
  assert.equal(rows[0].count, SUCCESS_TOAST_CEILING + 1, '负控必须真的造出超额的量')
  assert.ok(rows[0].count > SUCCESS_TOAST_CEILING, '坏版本确实超限 —— 上面那条断言会因此判红')
})

test('★icon:none 不算进来 —— 校验失败/网络异常本来就该是一次性的', () => {
  const probe = 'pages/__probe2__/index.js'
  const fakeRead = () => "wx.showToast({ title: '网络异常', icon: 'none' })\n".repeat(50)
  assert.deepEqual(scan(fakeRead, [probe]), [],
    '把 icon:none 一起卷进来,棘轮会变成一个降不下去的噪音源,然后被关掉')
})

test('★嵌套回调不许被算成本次的 icon —— 贪婪匹配会把回调体一起吃进来', () => {
  const probe = 'pages/__probe3__/index.js'
  // 外层是 icon:'none',回调里另有一次 success —— 只该算里面那一次的所属函数,不该算外层
  const fakeRead = () => "wx.showToast({ title: 'a', icon: 'none', success() { inner({ icon: 'success' }) } })"
  assert.deepEqual(scan(fakeRead, [probe]), [],
    '外层是 none,却因为回调里出现 success 被算成成功 toast —— 那会让棘轮虚高')
})
