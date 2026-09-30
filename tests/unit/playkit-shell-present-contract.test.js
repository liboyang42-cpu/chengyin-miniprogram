/* 玩法屏的外壳 · 半屏弹层不许声明「默认内嵌」(2026-09-24)
 *
 * 玩法屏的外壳有三种形状:cy-play-stage(整屏台面)、cy-sheet(半屏弹层)、
 * 独立 view。**三种并存不是错** —— 半屏是本仓 P1-P6 弹层语言里的正当形状;
 * 而 present 的数据模型只有 inline / fullscreen 两个值(PRESENT_VALUES),
 * `fullscreen` 的真正含义是**「不内嵌」**,半屏满足它。
 * ⚠️ 本文件第一版把「声明整屏、实际半屏」当成违规、冻结了 7 处 —— 那是定偏的:
 * 它冻的是一批根本不算违规的东西,而真正的毛病只有一种形状。
 *
 * 唯一不可能的组合:**inline + 半屏**。
 * 内嵌要把玩法放进 `.chfull__para`,而那个段落恒带 transform + filter
 * (值永远是数字、不是 none),非 none 就是 position:fixed 后代的**包含块** ——
 * 半屏弹层贴的是视口,放进去会被圈进那 190rpx 的段落里,跟着一起缩放和模糊。
 * 这正是 2026-09-22 photoCheck 取景层踩过的同一个坑。
 *
 * 2026-09-24 实测只有 `blindTaste` 命中(显式「默认内嵌」+ cy-sheet)。它的组件有 Figma 稿
 * (v5.1 node 46:259,蒙眼猫是「闭眼」规则的唯一图示),所以**撤的是做不到的声明,不是改组件**;
 * 生产 0 个模板在用,撤默认不影响存量。撤完之后这条就是**零基线硬断言**。
 *
 * 判据两端都从现码读:呈现方式读 advanced-game-config.js,外壳读各组件 wxml 的根节点。
 * 两边都会变,所以都不在测试里抄一份。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const CFG = path.join(ROOT, 'pages', 'publish', 'utils', 'publish', 'advanced-game-config.js')
const KITS = path.join(ROOT, 'pages', 'play', 'components')

/** 从 advanced-game-config.js 读一张呈现方式名单(别在测试里抄,抄的那份一定会烂) */
function presentList(name) {
  const src = fs.readFileSync(CFG, 'utf8')
  const m = src.match(new RegExp(name + '\\s*=\\s*\\[([\\s\\S]*?)\\]'))
  assert.ok(m, `advanced-game-config.js 里找不到 ${name} —— 名单改名了,判据要跟着改`)
  return m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
}

/** 每个玩法屏的外壳形状:stage(整屏台面) / sheet(半屏弹层) / bare(裸壳) */
function shells() {
  const out = new Map()
  for (const dir of fs.readdirSync(KITS)) {
    if (!dir.startsWith('playkit-')) continue
    const wxml = path.join(KITS, dir, 'index.wxml')
    if (!fs.existsSync(wxml)) continue
    const src = fs.readFileSync(wxml, 'utf8')
    const first = src.split('\n').map((l) => l.trim()).find((l) => l.startsWith('<'))
    const kind = first && first.startsWith('<cy-sheet') ? 'sheet'
      : (src.includes('cy-play-stage') ? 'stage' : 'bare')
    out.set(dir.replace('playkit-', ''), kind)
  }
  return out
}

/** 段名(驼峰)→ 组件目录名(全小写)。这一层换算错了整条判据就静默恒绿。 */
const dirOf = (section) => section.toLowerCase()

/** 唯一违规形状:声明「默认内嵌」却是半屏弹层。 */
function inlineSheets() {
  const shell = shells()
  return presentList('PRESENT_INLINE_DEFAULT').filter((seg) => shell.get(dirOf(seg)) === 'sheet')
}

/** 现有 7 个半屏玩法屏。**它们不是违规**(fullscreen=不内嵌,半屏满足),
 *  登记在这里只为一件事:新玩法屏悄悄变成第八个半屏时有人知道。 */
const SHEET_KITS = ['blindtaste', 'diyname', 'musiccorner', 'silentorder', 'slowtask', 'steps', 'timewindow']

test('扫描分母正常:两端都读得到(否则下面全是空转)', () => {
  assert.ok(presentList('PRESENT_FULLSCREEN_ONLY').length >= 5, '只能全屏名单读空了')
  assert.ok(presentList('PRESENT_INLINE_DEFAULT').length >= 3, '默认内嵌名单读空了')
  assert.ok(shells().size >= 30, `只扫到 ${shells().size} 个玩法屏,选择器多半失配了`)
})

test('★声明「默认内嵌」的段不能是半屏弹层 —— 零基线硬断言', () => {
  const bad = inlineSheets()
  assert.deepEqual(bad, [],
    `这些段声明了「默认内嵌」,外壳却是半屏弹层:${bad.join(', ')}\n` +
    '  内嵌要放进 .chfull__para,那个段落恒带 transform+filter,是 position:fixed 后代的包含块 ——\n' +
    '  半屏弹层贴的是视口,放进去会被圈进 190rpx 的段落里跟着缩放和模糊。\n' +
    '  两条路:把组件改成 cy-play-stage(内嵌走 --pk-stage-pos 注入),或撤掉这个做不到的声明。')
})

test('★半屏玩法屏的名单只减不增 —— 新玩法屏变成半屏时要有人知道', () => {
  const sheets = [...shells()].filter(([, v]) => v === 'sheet').map(([k]) => k).sort()
  assert.deepEqual(sheets, [...SHEET_KITS].sort(),
    '半屏玩法屏的集合变了。半屏本身不是错,但它意味着:进不了故事流内嵌、\n' +
    '  退出键 / 限时条 / 还能错 / 3-2-1 / 两张判定屏都得自己写一份。新玩法屏优先套 cy-play-stage。')
})

test('★玩法屏的外壳只能三选一,独立壳限定相册、签到与拍物相机', () => {
  for (const k of new Set([...shells().values()])) {
    assert.ok(['stage', 'sheet', 'bare'].includes(k), `冒出了没见过的外壳形状:${k}`)
  }
  const bare = [...shells()].filter(([, v]) => v === 'bare').map(([k]) => k)
  // album 复用既有玻璃相册，没有限时或判定屏；objectcard 是既有独立全屏相机与揭晓流程，不使用通用玩法台面。
  assert.deepEqual(bare.sort(), ['album', 'dailysign', 'objectcard'],
    `独立壳仅允许相册、签到和拍物相机,实际:${bare.join(', ')}\n` +
    '  自己从零搭 = 退出键/限时条/判定屏各写一份,改一处漏一处。')
})

/* ===================== 负控 ===================== */

test('negative control:让一个「默认内嵌」的段变成半屏,必须被抓出来', () => {
  const shell = shells()
  const inline = presentList('PRESENT_INLINE_DEFAULT')
  const victim = inline.find((s) => shell.get(dirOf(s)) === 'stage')
  assert.ok(victim, '「默认内嵌」里一个 stage 段都没有,负控失去锚点')
  const faked = new Map(shell)
  faked.set(dirOf(victim), 'sheet')
  assert.ok(inline.filter((s) => faked.get(dirOf(s)) === 'sheet').includes(victim),
    `把 ${victim} 变成半屏没被判据认出来`)
})

test('negative control:「声明整屏 + 半屏」不许被误判成违规(第一版就是在这儿定偏的)', () => {
  // steps 显式「只能全屏」且实际是半屏 —— fullscreen 的含义是「不内嵌」,半屏满足,不算违规
  assert.ok(presentList('PRESENT_FULLSCREEN_ONLY').includes('steps'))
  assert.equal(shells().get('steps'), 'sheet')
  assert.deepEqual(inlineSheets(), [], '把「声明整屏 + 半屏」也算成了违规,规则又定偏了')
})

test('negative control:段名与目录名的大小写换算必须真的对上', () => {
  assert.equal(dirOf('blindTaste'), 'blindtaste')
  assert.ok(shells().has(dirOf('blindTaste')), '驼峰段名换算不到组件目录 —— 判据会静默放过所有段')
  assert.equal(shells().get(dirOf('blindTaste')), 'sheet', 'blindTaste 的实际外壳读错了')
})

test('negative control:名单读不到时必须抛,不能当成「没有违规」', () => {
  assert.throws(() => presentList('PRESENT_NOT_A_REAL_LIST'))
})

test('默认呈现和内嵌限制与实际服务端真源一致', () => {
  const java = fs.readFileSync(path.join(ROOT, '../chengyinhub-system/src/main/java/com/chengyinhub/business/service/support/AdvancedGameConfigValidator.java'), 'utf8')
  for (const [client, server] of [['PRESENT_INLINE_DEFAULT', 'PRESENT_INLINE_BY_DEFAULT'], ['PRESENT_FULLSCREEN_ONLY', 'PRESENT_FULLSCREEN_ONLY']]) {
    const match = java.match(new RegExp(server + '\\s*=\\s*setOf\\(([\\s\\S]*?)\\);'))
    assert.ok(match, server)
    const values = [...match[1].matchAll(/"([A-Za-z]+)"/g)].map(item => item[1])
    assert.deepEqual(presentList(client).sort(), values.sort())
  }
})
