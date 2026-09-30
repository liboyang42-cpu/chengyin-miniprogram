/* 玩法屏入场动效(pk-in)契约 —— 2026-09-22
 *
 * 为什么有这份门禁:`.pk-in` 的减弱动效兜底一开始写成 `.cy-motion-reduced .pk-in`,
 * 抄的是**页面**的做法。但 playkit-* 全是 `styleIsolation: isolated`,
 * 页面根上的类**选不到组件内部**;而且 play 页根挂的是 `play--reduced-motion`,
 * 压根没有 `cy-motion-reduced` 这个类 —— 两头都不成立,那是条永不命中的死规则,
 * 全量单测还是绿的(没有任何门禁看这一层)。这份契约就是补上那一层。
 *
 * 判据只有两条:① 共用的关掉规则必须按 `.pk--reduced` 写;
 * ② 每个用了 pk-in 的 kit,自己的外层 view 必须真的按 reducedMotion 挂上 .pk--reduced。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const COMPONENTS = path.join(ROOT, 'pages', 'play', 'components')
const SURFACE = path.join(ROOT, 'pages', 'play', 'style', 'play-surface.wxss')

/** 全仓扫出哪些 kit 的 wxml 用了 pk-in —— 不写死清单,新加一个屏自动纳管 */
function kitsUsingPkIn() {
  return fs.readdirSync(COMPONENTS)
    .filter((d) => fs.existsSync(path.join(COMPONENTS, d, 'index.wxml')))
    .filter((d) => /\bpk-in\b/.test(fs.readFileSync(path.join(COMPONENTS, d, 'index.wxml'), 'utf8')))
}

test('扫描分母正常:确实有屏在用 pk-in(否则这份门禁是空转)', () => {
  assert.ok(kitsUsingPkIn().length >= 5, `只扫到 ${kitsUsingPkIn().length} 个用 pk-in 的屏`)
})

/** 判据本体 —— 负控直接喂改坏的文本进来跑,确保它真的会红 */
function checkSurface(raw) {
  // ⚠️ 先剥注释再判:不剥的话把规则整条注释掉仍然绿(review 实测指出),门禁就哑了
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.match(css, /\.pk--reduced\s+\.pk-in\s*\{[^}]*animation:\s*none/,
    'play-surface.wxss 缺 `.pk--reduced .pk-in { animation: none }`')
  // 注释里可以解释这段历史,所以只看真正的规则行,不看整文件
  assert.doesNotMatch(css, /\.cy-motion-reduced\s+\.pk-in/,
    '又写回页面级的 .cy-motion-reduced —— 组件隔离下选不到,是死规则')
}

function checkKitWxml(kit, wxml) {
  assert.match(wxml, /reducedMotion\s*\?\s*'pk--reduced'/,
    `${kit} 写了 pk-in 却没挂减弱开关,动效关不掉`)
}

test('★减弱动效必须按组件自己的根类 .pk--reduced 写,不能用页面级的 .cy-motion-reduced', () => {
  checkSurface(fs.readFileSync(SURFACE, 'utf8'))
})

test('★每个用 pk-in 的屏,自己的外层 view 必须真的挂 .pk--reduced', () => {
  for (const kit of kitsUsingPkIn()) {
    checkKitWxml(kit, fs.readFileSync(path.join(COMPONENTS, kit, 'index.wxml'), 'utf8'))
  }
})

test('negative control:摘掉任一屏的 pk--reduced 绑定,判据必须真的抛', () => {
  const kit = kitsUsingPkIn()[0]
  const wxml = fs.readFileSync(path.join(COMPONENTS, kit, 'index.wxml'), 'utf8')
  const mutated = wxml.replace(/\s*\{\{reducedMotion \? 'pk--reduced' : ''\}\}/, '')
  assert.notEqual(mutated, wxml, '负控锚点失效:绑定没被摘掉,说明写法变了,判据要跟着改')
  assert.throws(() => checkKitWxml(kit, mutated))
})

test('negative control:把关掉规则写回 .cy-motion-reduced,判据必须真的抛', () => {
  const css = fs.readFileSync(SURFACE, 'utf8')
  const mutated = css.replace('.pk--reduced .pk-in', '.cy-motion-reduced .pk-in')
  assert.notEqual(mutated, css, '负控锚点失效:共用规则的写法变了')
  assert.throws(() => checkSurface(mutated))
})

/* ===== 重播接线(behaviors/replay-motion.js)=====
 * 关键帧只在节点新建时播。下面这几屏是节点复用、内容原地变,不重播就等于没有动效:
 * 重掷、第二次判定、同类型换下一个节点。三件套缺任一件都是死代码,而且不会报错。 */
const REPLAY_KITS = ['playkit-journey-check', 'playkit-photocheck', 'playkit-typein']

function checkReplayWiring(kit, js, wxml) {
  assert.match(js, /behaviors\/replay-motion\.js/, `${kit} 没挂 replay-motion behavior`)
  assert.match(js, /this\.replayMotion\(\)/, `${kit} 挂了 behavior 却从不调用,等于没接`)
  assert.match(wxml, /_motionReset \? 'pk--reset'/,
    `${kit} 调了 replayMotion 但外层 view 没挂 pk--reset —— 摘不掉动画,重播不了`)
}

test('★节点复用的屏必须把重播三件套接齐(behavior + 调用 + wxml 类)', () => {
  for (const kit of REPLAY_KITS) {
    checkReplayWiring(
      kit,
      fs.readFileSync(path.join(COMPONENTS, kit, 'index.js'), 'utf8'),
      fs.readFileSync(path.join(COMPONENTS, kit, 'index.wxml'), 'utf8'),
    )
  }
})

test('★摘除规则必须存在,否则 pk--reset 挂了也摘不掉动画', () => {
  const css = fs.readFileSync(SURFACE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  assert.match(css, /\.pk--reset\s+\.pk-in\s*\{[^}]*animation:\s*none/,
    'play-surface.wxss 缺 `.pk--reset .pk-in { animation: none }`')
  // 专属动效也要各自摘:共用那条只管 .pk-in
  const jc = fs.readFileSync(path.join(COMPONENTS, 'playkit-journey-check', 'index.wxss'), 'utf8')
  assert.match(jc, /\.pk--reset\s+\.jc__die\s*\{[^}]*animation:\s*none/,
    'jc__die 没有 pk--reset 的摘除规则,重掷时骰子仍然不重播')
})

test('negative control:摘掉任一件接线,判据必须真的抛', () => {
  const kit = REPLAY_KITS[0]
  const js = fs.readFileSync(path.join(COMPONENTS, kit, 'index.js'), 'utf8')
  const wxml = fs.readFileSync(path.join(COMPONENTS, kit, 'index.wxml'), 'utf8')
  // 只摘 wxml 那一件:behavior 与调用都还在,正是最容易漏且最不报错的那种漏法
  const mutated = wxml.replace(/\s*\{\{_motionReset \? 'pk--reset' : ''\}\}/, '')
  assert.notEqual(mutated, wxml, '负控锚点失效:绑定写法变了,判据要跟着改')
  assert.throws(() => checkReplayWiring(kit, js, mutated))
  // 再摘调用那一件
  assert.throws(() => checkReplayWiring(kit, js.replace(/this\.replayMotion\(\)/g, 'void 0'), wxml))
})
