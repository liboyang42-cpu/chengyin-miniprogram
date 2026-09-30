/* WXML 表达式里不许出现反斜杠转义(2026-09-02)
 *
 * 起因是一次真实事故:club-topic-end-confirm 写了
 *     content="{{errorText ? bodyCopy + '\n' + errorText : bodyCopy}}"
 * 微信开发者工具直接报
 *     Bad attr `content` with message: error at token `$`
 * —— **整个小程序编译不出来、模拟器起不来**。截图核对因此一张图都拿不到,
 * 而当时被归因成「本机锁屏」,多绕了好几轮。
 *
 * 为什么必须单独立一条:
 *   WXML 表达式由微信自己的解析器处理,它**不支持 '\n' '\t' '\\' 这类反斜杠转义**。
 *   而本仓的单测与 DS 门禁**都不编译 WXML** —— 这类错在 CI 里完全不可见,
 *   只有真的打开开发者工具才炸。属于「单测全绿但发不出去」的一类。
 *
 * 正确做法:字符串拼接放 JS(observer / 计算属性),WXML 只负责摆样子。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const ROOTS = ['pages', 'components', 'subpackageA', 'subpackageB', 'subpackageP3',
  'subpackageMember', 'subpackageRoam']

function allWxml() {
  const out = []
  const walk = (d) => {
    if (!fs.existsSync(d)) return
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p) }
      else if (e.name.endsWith('.wxml')) out.push([path.relative(ROOT, p), fs.readFileSync(p, 'utf8')])
    }
  }
  ROOTS.forEach((r) => walk(path.join(ROOT, r)))
  return out
}

/** 找出 {{ }} 表达式里带反斜杠转义的属性 —— 微信的表达式解析器不认这些 */
function findEscapesInExpressions(files) {
  const bad = []
  for (const [rel, src] of files) {
    // 先剥 <!-- --> 注释:解释这条规则的注释里必然出现反例
    const code = src.replace(/<!--[\s\S]*?-->/g, '')
    for (const m of code.matchAll(/\{\{([^}]*)\}\}/g)) {
      if (/\\[nrt\\'"]/.test(m[1])) bad.push(`${rel}: {{${m[1].trim().slice(0, 60)}}}`)
    }
  }
  return bad
}

const realFiles = () => allWxml()

test('WXML 表达式里不许有反斜杠转义 —— 微信解析器不认,整个小程序编译不出来', () => {
  const bad = findEscapesInExpressions(realFiles())
  assert.deepEqual(bad, [],
    '这些表达式含反斜杠转义,微信开发者工具会报 "Bad attr ... error at token `$`" 并且'
    + '**整个小程序编译不出来、模拟器起不来**。单测与 DS 门禁都不编译 WXML,所以只有真编译才炸。\n'
    + '把字符串拼接搬进 JS(observer / 计算属性),WXML 只负责摆样子:\n' + bad.join('\n'))
})

test('扫描分母正常:能扫到足够多的 wxml', () => {
  assert.ok(realFiles().length > 100, `只扫到 ${realFiles().length} 个 wxml,扫描根多半错了`)
})

test('负控:注入一处转义必须判红', () => {
  const clean = [['x.wxml', '<a content="{{ok ? a + b : b}}" />']]
  assert.deepEqual(findEscapesInExpressions(clean), [], '干净输入不该报')

  const mutated = [['x.wxml', "<a content=\"{{ok ? a + '\\n' + b : b}}\" />"]]
  const bad = findEscapesInExpressions(mutated)
  assert.equal(bad.length, 1, `没抓到注入的转义:${JSON.stringify(bad)}`)
})

test('负控:注释里写反例不算违规 —— 判据看代码不看注解', () => {
  const withComment = [['x.wxml',
    "<!-- 反例:content=\"{{a + '\\n' + b}}\" 会让整个小程序编译不出来 -->\n<a content=\"{{c}}\" />"]]
  assert.deepEqual(findEscapesInExpressions(withComment), [],
    '解释这条规则的注释里必然出现反例,按原文扫会把注释判成违规')
})
