// ADA 借鉴卡 C(刮开揭示)与 E(零文字上手)的契约
//
// 两条都是「过程即体验」类改造,坏了不会报错:
//   · 刮开判错 → 要么碰一下就送、要么刮到手酸也不给;
//   · 步骤图形化漏了读屏文案 → 图形化的代价全由读屏用户承担。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { scratchProgress, shouldReveal, PIXEL_STRIDE } =
  require('../../pages/play/utils/scratch-progress.js')
const { stepIcons, stepsA11yLabel, STEPS } = require('../../pages/play/utils/playkit-steps.js')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** 造一张 RGBA 图:前 clearedRatio 比例的像素 alpha=0(已擦),其余 255 */
function fakeImage(pixels, clearedRatio) {
  const data = new Array(pixels * 4).fill(0)
  const clearedUntil = Math.floor(pixels * clearedRatio)
  for (let i = 0; i < pixels; i++) {
    data[i * 4 + 3] = i < clearedUntil ? 0 : 255
  }
  return data
}

// ==================== C · 刮开揭示 ====================

test('进度按已擦除面积占比算', () => {
  const pixels = PIXEL_STRIDE * 400
  assert.equal(scratchProgress(fakeImage(pixels, 0)), 0)
  assert.equal(scratchProgress(fakeImage(pixels, 1)), 1)
  const half = scratchProgress(fakeImage(pixels, 0.5))
  assert.ok(half > 0.45 && half < 0.55, '半张擦开应约等于 0.5,实得 ' + half)
})

test('负控_数据不可用时给 0 而不是 1', () => {
  // 判不出来就当没擦 —— 反过来会「取不到像素就白送」,那是最糟的失败方向
  assert.equal(scratchProgress(null), 0)
  assert.equal(scratchProgress([]), 0)
  assert.equal(scratchProgress(undefined), 0)
})

test('负控_阈值非法时退回 0.45,不能退回 0', () => {
  // 退回 0 会让「碰一下就揭示」,正是稿要避免的纯点击领奖
  assert.equal(shouldReveal(0.01, 0), false)
  assert.equal(shouldReveal(0.01, undefined), false)
  assert.equal(shouldReveal(0.01, -1), false)
  assert.equal(shouldReveal(0.5, 0), true)
})

test('阈值边界:刚好够就算,差一点不算', () => {
  assert.equal(shouldReveal(0.45, 0.45), true)
  assert.equal(shouldReveal(0.449, 0.45), false)
  assert.equal(shouldReveal(1, 0.45), true)
  assert.equal(shouldReveal(0, 0.45), false)
})

test('刮开组件必须留一条不用手势的退路', () => {
  const wxml = read('pages/play/components/scratch/index.wxml')
  const js = read('pages/play/components/scratch/index.js')

  // 运动障碍 / 戴手套 / 减动效的人不该被一个擦除手势挡在内容外面。
  assert.ok(/bindtap="onDirectReveal"/.test(wxml),
    '必须有不依赖持续擦除或长按的直接揭示按钮')
  assert.ok(/onDirectReveal\s*\(/.test(js), 'onDirectReveal 必须真存在')
  assert.ok(wxml.includes('直接揭示'), '退路必须是可见文案,不能藏在长按手势里')
  assert.ok(
    /!revealed && !reducedMotion/.test(js),
    '减动效用户应直接拿到结果:遮罩层根本不挂,而不是挂了再给按钮'
  )
  // 真内容一直在 DOM 里:读屏器不该等你刮完才知道这儿有东西
  assert.match(wxml, /<slot\s*\/?>/, '真内容必须一直在 DOM 里')
})

test('生产组件必须真调用被负控覆盖的进度判定', () => {
  const js = read('pages/play/components/scratch/index.js')
  assert.match(js, /scratch-progress\.js/, '不能测试一套纯函数、生产再自算另一套')
  assert.match(js, /sampledAlphaProgress\s*\(/)
  assert.match(js, /shouldReveal\s*\(/)
})

test('庆祝不在擦的过程里发生', () => {
  const js = read('pages/play/components/scratch/index.js')
  // 稿:金币庆祝只在结果确认后出现。组件自己只发 reveal,庆祝由调用方在之后做
  assert.ok(!/celebrate|confetti|庆祝动画/.test(js), '组件不该自带庆祝')
  assert.ok(/triggerEvent\('reveal'/.test(js), '揭示后要通知调用方,由它决定怎么庆祝')
})

// ==================== E · 零文字上手 ====================

test('每种玩法的步骤都是图标 + 短标签', () => {
  const types = Object.keys(STEPS)
  // 分母 8→7:2026-09-20 审查 #7 批复删除 stickerbook 纯孤儿,表里少一档
  assert.ok(types.length >= 7, '至少覆盖七种玩法')
  for (const type of types) {
    const steps = stepIcons(type)
    assert.ok(steps.length >= 2 && steps.length <= 4, type + ' 的步骤数应为 2–4')
    steps.forEach((s, i) => {
      assert.equal(s.index, i + 1, '序号必须连续从 1 起')
      assert.ok(s.icon && s.icon.length, type + ' 第 ' + s.index + ' 步缺图标')
      // 标签是短词不是说明书 —— 稿:文字只做氛围不做说明书
      assert.ok(s.label.length <= 5, type + ' 的标签「' + s.label + '」太长,应 ≤5 字')
    })
  }
})

test('图标必须都在 cy-icon 的在册清单里', () => {
  // 写了个不存在的图标名,真机上是**空白**而不是报错 —— 静默失效
  const icons = read('components/cy/icon/icons.wxss')
  const registered = new Set(
    (icons.match(/^\.cyi--[a-z0-9-]+/gm) || []).map((s) => s.replace('.cyi--', ''))
  )
  for (const [type, steps] of Object.entries(STEPS)) {
    for (const step of steps) {
      assert.ok(registered.has(step.icon), `${type} 用了未注册的图标 ${step.icon}`)
    }
  }
})

test('未知玩法给空数组,不给半个步骤行', () => {
  assert.deepEqual(stepIcons('nope'), [])
  assert.equal(stepsA11yLabel('nope'), '')
})

test('读屏文案:服务端配了就用它,没配才用标签拼', () => {
  const fromServer = stepsA11yLabel('blindtaste', '① 向店员领盲品小样 ② 闭眼尝 ③ 睁眼作答')
  assert.equal(fromServer, '① 向店员领盲品小样 ② 闭眼尝 ③ 睁眼作答')

  const fallback = stepsA11yLabel('blindtaste')
  assert.ok(fallback.startsWith('玩法步骤:'), fallback)
  assert.ok(fallback.includes('领小样'), fallback)
  // 空串也要走兜底,不能把空的 aria-label 交出去
  assert.equal(stepsA11yLabel('blindtaste', '   '), fallback)
})

test('图形化之后,读屏器仍然拿得到完整步骤', () => {
  const wxml = read('pages/play/components/playkit-blindtaste/index.wxml')
  assert.ok(wxml.includes('class="pk-steps"'), '图标步骤行必须真渲染')
  assert.ok(
    /aria-label="\{\{steps\}\}"/.test(wxml),
    '图标行必须带 aria-label —— 否则图形化的代价由读屏用户承担'
  )
  // 原来那行整句说明必须真被替换掉,而不是和图标行并排
  assert.ok(
    !wxml.includes('pk-desc--dim">{{steps}}'),
    '整句说明应被图标行替代;并排等于没改(读者仍会去读那行字)'
  )
})
