/* 系统深色模式契约(2026-08-22)
 *
 * 本项目有两层「主题」,这套断言的全部意义是**不让它们混成一维**:
 *   · 业务域主题:玩家域恒深(沉浸式游戏语境)、商家域恒浅(长时工作台);
 *   · 系统外观:用户手机上的深色开关。它只该把**商家域**切深,不该动玩家域。
 *
 * 锁四件事:
 *   ① 深色块的选择器只命中浅色业务域,绝不命中玩家域(page 基底 / .theme-dark);
 *   ② 深色块的键集与 .theme-light 块**完全一致(双向)** —— 这是本仓踩过的
 *      「就地求值快照 + 只覆盖语义层」导致「一半变一半没变」的直接防线;
 *   ③ merchant-light.wxss 的深色镜像同样与它自己的 page{} 键集一致(page{} 机制逃不掉镜像);
 *   ④ app.json 声明了 darkmode,但**不配 themeLocation** —— 全局 chrome 属玩家域,恒深色。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

/** 取出 `@media (prefers-color-scheme: dark)` 里第一个规则块的正文 */
function darkBlock(src) {
  const at = src.indexOf('@media (prefers-color-scheme: dark)')
  if (at < 0) return null
  const open = src.indexOf('{', at)
  // 逐字符配平,拿到整个 @media 的范围
  let depth = 0, end = -1
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  assert.ok(end > 0, '@media 块括号不配平')
  return src.slice(open + 1, end)
}

/** 取某个选择器块的正文(选择器行到配平的 }) */
function ruleBody(src, selectorAnchor) {
  const at = src.indexOf(selectorAnchor)
  assert.ok(at >= 0, `找不到选择器 ${selectorAnchor}`)
  const open = src.indexOf('{', at)
  let depth = 0, end = -1
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  return src.slice(open + 1, end)
}

const keysOf = (body) => (body.match(/^\s*--cy-[a-z0-9-]+\s*:/gm) || [])
  .map((s) => s.trim().replace(/\s*:$/, ''))

function assertKeySetEqual(darkKeys, lightKeys, what) {
  const d = new Set(darkKeys), l = new Set(lightKeys)
  const missing = [...l].filter((k) => !d.has(k))
  const extra = [...d].filter((k) => !l.has(k))
  assert.deepEqual(
    missing, [],
    `${what}:深色块漏了 ${missing.length} 个 token —— 会出现「一半变深一半还浅」(${missing.slice(0, 5).join(', ')})`,
  )
  assert.deepEqual(
    extra, [],
    `${what}:深色块多出 ${extra.length} 个浅色块没有的 token,单真源被破坏(${extra.slice(0, 5).join(', ')})`,
  )
}

test('① 深色块只命中浅色业务域,不动玩家域', () => {
  const src = read('style/dark-mode.wxss')
  const at = src.indexOf('@media (prefers-color-scheme: dark)')
  assert.ok(at > 0, 'tokens.wxss 必须有系统深色块')
  const selectorLine = src.slice(at, src.indexOf('{', src.indexOf('{', at) + 1))
  assert.match(selectorLine, /\.theme-light/, '深色块必须覆盖 .theme-light')
  assert.match(selectorLine, /\.theme-merchant/, '深色块必须覆盖 .theme-merchant')
  assert.doesNotMatch(selectorLine, /\.theme-dark/, '玩家域恒深,不该被系统外观改写')
  // 选择器里不许出现裸 page(那会把玩家域基底一起改掉);page.theme-light 是允许的
  const bareePage = /(^|[\s,])page(\s*[,{]|\s*$)/m.test(selectorLine)
  assert.equal(bareePage, false, '不许用裸 page 选择器 —— 会把玩家域基底一起切掉')
})

test('② 深色块键集与 .theme-light 完全一致(双向)', () => {
  const light = keysOf(ruleBody(read('style/tokens.wxss'), 'page.theme-light,'))
  const dark = keysOf(darkBlock(read('style/dark-mode.wxss')))
  assert.ok(light.length > 50, `.theme-light 只解析出 ${light.length} 个 token,解析器失效?`)
  assertKeySetEqual(dark, light, 'tokens.wxss')
})

test('③ merchant-light.wxss 深色镜像与它的 page{} 键集一致', () => {
  const src = read('style/merchant-light.wxss')
  const light = keysOf(ruleBody(src, '\npage {'))
  const dark = keysOf(darkBlock(src))
  assert.ok(light.length > 50, `merchant-light page{} 只解析出 ${light.length} 个 token`)
  assertKeySetEqual(dark, light, 'merchant-light.wxss')
})

test('④ app.json 开 darkmode,但不配 themeLocation(全局 chrome 属玩家域恒深)', () => {
  const app = JSON.parse(read('app.json'))
  assert.equal(app.darkmode, true, 'app.json 必须声明 darkmode,否则 JS 读不到系统主题')
  assert.equal(app.themeLocation, undefined,
    '不配 themeLocation:导航/tabBar 属玩家域恒深色,配了会让它们跟系统变浅')
  assert.equal(app.tabBar.backgroundColor, '#0A0A0B', 'tabBar 应保持玩家域深色')
})

test('⑥ 深色块必须排在 tokens 之后被引入(同特异度靠源码顺序取胜)', () => {
  const appWxss = read('app.wxss')
  const iTokens = appWxss.indexOf("style/tokens.wxss")
  const iDark = appWxss.indexOf("style/dark-mode.wxss")
  assert.ok(iTokens >= 0 && iDark >= 0, 'app.wxss 必须同时引入 tokens 与 dark-mode')
  assert.ok(iDark > iTokens, 'dark-mode.wxss 必须排在 tokens.wxss 之后,否则被浅色值覆盖回去')
})

test('⑤ 深色值不得引用未定义 token(var() 引用未定义会让整条声明静默作废)', () => {
  const src = read('style/tokens.wxss') + read('style/dark-mode.wxss') + read('style/merchant-light.wxss')
  const defined = new Set((src.match(/^\s*(--cy-[a-z0-9-]+)\s*:/gm) || [])
    .map((s) => s.trim().replace(/\s*:$/, '')))
  const dark = darkBlock(read('style/dark-mode.wxss'))
  const refs = [...dark.matchAll(/var\((--cy-[a-z0-9-]+)/g)].map((m) => m[1])
  const undef = [...new Set(refs)].filter((r) => !defined.has(r))
  assert.deepEqual(undef, [], `深色块引用了未定义 token,整条声明会静默作废:${undef.join(', ')}`)
})

/* ---------- 值级:光有块不够,值必须真的变深 ---------- */

const valueOf = (body, name) => {
  const m = new RegExp('^\\s*' + name + '\\s*:\\s*([^;]+);', 'm').exec(body)
  return m ? m[1].trim() : null
}

test('⑦ 关键 token 的深色值必须真的不同于浅色值,且等于玩家域基底', () => {
  const tokens = read('style/tokens.wxss')
  const lightBody = ruleBody(tokens, 'page.theme-light,')
  const baseBody = ruleBody(tokens, '\npage {')
  const darkBody = darkBlock(read('style/dark-mode.wxss'))

  // 挑最能代表「变没变深」的四个:页底 / 主文字 / 主 CTA 底 / 主 CTA 字
  for (const name of ['--cy-color-bg-page', '--cy-color-text-primary',
                      '--cy-color-action-primary-bg', '--cy-color-action-primary-fg']) {
    const light = valueOf(lightBody, name)
    const dark = valueOf(darkBody, name)
    const base = valueOf(baseBody, name)
    assert.ok(light && dark && base, `${name} 三个块里都必须有值(light=${light} dark=${dark} base=${base})`)
    assert.notEqual(dark, light, `${name} 的深色值与浅色值相同 —— 块写了但等于没切`)
    assert.equal(dark, base, `${name} 的深色值必须取玩家域基底(那套调色板做过 R1 对比度校正),实际 ${dark} ≠ ${base}`)
  }
})

function assertMerchantDarkIconRules(src) {
  const dark = darkBlock(src)
  const navigationIcons = ruleBody(dark, '.merchant-nav-icon,')
  const quickActionIcons = ruleBody(dark, '.rv-hero-bell-ico,')

  assert.match(navigationIcons, /filter:\s*none\s*;/,
    '导航图标在深色底上必须恢复原始白色，不能继续 brightness(0)')
  assert.match(quickActionIcons, /filter:\s*brightness\(0\)\s+invert\(1\)\s*;/,
    '商家快捷图标原资源有黑/绿/灰多种颜色，深色底上必须统一转为白色')
}

test('F-52 组件会 import 的 merchant-light 不得保留导航 tag/descendant selector', () => {
  const source = read('style/merchant-light.wxss')
  assert.doesNotMatch(source,
    /\.back-btn\s+image|\.topic\s+\.topbar\s+\.titBar\s+\.back\s+button\s+image|\.sticky-nav-bar\s+\.sticky-back\s+button\s+image/,
    'project-join/project-drawer/project-host import 后，微信组件编译器会拒绝这些 tag/descendant selector')
  assert.equal((source.match(/\.merchant-nav-icon,/g) || []).length, 2,
    '浅色与系统深色镜像都必须保留同一个 class hook，不能靠删除样式消警告')
})

test('⑧ 商家深色必须撤销导航压黑，并把混合颜色快捷图标统一转白', () => {
  const page = read('pages/merchant/index/index.wxml')
  for (const asset of ['/images/nav_msg.svg', '/pages/merchant/images/icon_wallet.svg',
                       '/images/icon_shop.svg']) {
    assert.match(page, new RegExp(`src="${asset.replaceAll('/', '\\/')}"`), `更多菜单缺少实际资源 ${asset}`)
  }
  assertMerchantDarkIconRules(read('style/merchant-light.wxss'))
})

test('负控:变异真实 WXSS 使快捷图标退回压黑必须走同一检查器判红', () => {
  const source = read('style/merchant-light.wxss')
  const mutated = source.replace(
    /filter:\s*brightness\(0\)\s+invert\(1\)\s*;/,
    'filter: brightness(0);',
  )
  assert.notEqual(mutated, source, '负控变异注入失败')
  assert.throws(() => assertMerchantDarkIconRules(mutated), /统一转为白色/)
})

test('负控:把深色值写回浅色值必须判红', () => {
  const tokens = read('style/tokens.wxss')
  const lightBody = ruleBody(tokens, 'page.theme-light,')
  const light = valueOf(lightBody, '--cy-color-bg-page')
  const darkBody = darkBlock(read('style/dark-mode.wxss'))
    .replace(/--cy-color-bg-page:\s*[^;]+;/, `--cy-color-bg-page: ${light};`)
  assert.equal(valueOf(darkBody, '--cy-color-bg-page'), light, '变异注入失败')
  assert.throws(() => {
    const dark = valueOf(darkBody, '--cy-color-bg-page')
    assert.notEqual(dark, light, '相同 —— 块写了但等于没切')
  })
})

/* ---------- 负控:每条闸都要能变红 ---------- */

test('负控:深色块漏一个 token 必须判红', () => {
  const light = keysOf(ruleBody(read('style/tokens.wxss'), 'page.theme-light,'))
  const dark = keysOf(darkBlock(read('style/dark-mode.wxss'))).slice(1)          // 故意漏掉第一个
  assert.throws(() => assertKeySetEqual(dark, light, 'x'), /漏了/)
})

test('负控:深色块把玩家域一起切掉必须判红', () => {
  const line = '@media (prefers-color-scheme: dark) {\n  page,\n  .theme-light {'
  const bare = /(^|[\s,])page(\s*[,{]|\s*$)/m.test(line)
  assert.equal(bare, true, '检查器必须能识别出裸 page 选择器')
})

test('负控:引用未定义 token 必须判红', () => {
  const defined = new Set(['--cy-color-bg-page'])
  const refs = ['--cy-color-bg-page', '--cy-does-not-exist']
  const undef = refs.filter((r) => !defined.has(r))
  assert.deepEqual(undef, ['--cy-does-not-exist'])
})

/* ---------- ⑨ 中性面必须在每个域都有落点 ----------
 * 契约②只比「深色块与 .theme-light 键集相等」—— 两边**同时缺**同一个 token 时键集仍然相等,
 * 恒绿。--cy-color-bg-surface-strong 正是这么漏过去的:只在玩家档 page{} 声明过一次,
 * 五个日间/镜像块全没有,浅色页继承 #3B3B3D,商家步进键黑加减号 1.88:1(2026-09-02)。
 * 所以这条改成拿**玩家档基底**当基准表,逐块查缺,而不是两两互比。 */

const BG_SCOPES = [
  ['tokens.wxss  .theme-light', () => ruleBody(read('style/tokens.wxss'), 'page.theme-light,')],
  ['tokens.wxss  .theme-topic-editor', () => ruleBody(read('style/tokens.wxss'), 'page.theme-topic-editor,')],
  ['dark-mode.wxss  深色镜像', () => darkBlock(read('style/dark-mode.wxss'))],
  ['merchant-light.wxss  page{}', () => ruleBody(read('style/merchant-light.wxss'), '\npage {')],
  ['merchant-light.wxss  深色镜像', () => darkBlock(read('style/merchant-light.wxss'))],
]

const bgKeysOf = (body) => keysOf(body).filter((k) => k.startsWith('--cy-color-bg-'))

function assertBgKeysComplete(baseBody, scopes) {
  const base = bgKeysOf(baseBody)
  assert.ok(base.length >= 5, `玩家档 page{} 只解析出 ${base.length} 个 bg token,解析器失效?`)
  for (const [what, body] of scopes) {
    const missing = base.filter((k) => !new Set(bgKeysOf(body)).has(k))
    assert.deepEqual(
      missing, [],
      `${what} 缺 ${missing.length} 个中性面 token —— 会静默继承玩家档深色值(${missing.join(', ')})`,
    )
  }
}

test('⑨ 每个 --cy-color-bg-* 在玩家档之外的五个块里都必须有值', () => {
  assertBgKeysComplete(
    ruleBody(read('style/tokens.wxss'), '\npage {'),
    BG_SCOPES.map(([what, get]) => [what, get()]),
  )
})

test('负控:任一块少声明一个 --cy-color-bg-* 必须判红', () => {
  const base = ruleBody(read('style/tokens.wxss'), '\npage {')
  const victim = bgKeysOf(base).at(-1)
  const scopes = BG_SCOPES.map(([what, get]) => [what, get()])
  const [what, body] = scopes[0]
  const mutated = body.replace(new RegExp('^\\s*' + victim + '\\s*:[^;]+;.*$', 'm'), '')
  assert.notEqual(mutated, body, `负控变异注入失败:${what} 里没找到 ${victim}`)
  assert.equal(bgKeysOf(mutated).includes(victim), false, `负控变异没真删掉 ${victim}`)
  assert.throws(() => assertBgKeysComplete(base, [[what, mutated], ...scopes.slice(1)]), /缺 1 个中性面/)
})
