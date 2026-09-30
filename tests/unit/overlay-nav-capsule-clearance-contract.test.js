// 透明导航(cy-nav-bar overlay)页:内容不得钻到微信胶囊底下。
//
// 这类页故意让封面顶到屏幕顶(Figma 就是这么画的),导航浮在图上。
// 代价是**页面不再有 padding-top 帮你挡着** —— 一旦按 Figma 的绝对坐标排版,
// 就必须自己算清楚哪些数字会撞上右上角那颗胶囊。
//
// ⚠️ 已经踩过一次:Figma 画板的 y 坐标**含 49px 状态栏**,
//    把 y449 直接 ×2 写成 898rpx,圆钮下沿越出 .ctd-head 把「核销」标题压住了。
//    正确换算是 (449-49)×2 = 800rpx。这份合同把「换算错了会撞胶囊」这件事机器化。
//
// 胶囊底部的估算(取各机型最坏值):
//   状态栏最高 54px(灵动岛)+ 胶囊自身 32px = 86px = 172rpx。
//   低于这个数的绝对定位内容,在某些机型上一定被胶囊盖住。
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')
const CAPSULE_BOTTOM_RPX = 172

// 故意全幅、允许压在胶囊下的元素:背景图与它上面的遮罩。
// 胶囊的可读性由 scrim 负责,不是靠把图往下推。
const FULL_BLEED = /(cover|scrim|backdrop|bg)\b/

function absoluteTops(wxssPath) {
  const css = fs.readFileSync(wxssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const out = []
  for (const m of css.matchAll(/^(\.[\w-]+[^{]*)\{([^}]*)\}/gm)) {
    const [, selector, body] = m
    if (!/position:\s*absolute/.test(body)) continue
    // `top: 0` 是合法写法且没有单位 —— 漏掉它就等于漏掉最该检查的那一类(顶到顶的元素)
    const top = /(?<![\w-])top:\s*(-?[\d.]+)(rpx)?\s*;/.exec(body)
    if (!top) continue
    if (!top[2] && Number(top[1]) !== 0) continue   // 无单位只接受 0,px/vh 等不参与本判据
    out.push({ selector: selector.trim(), rpx: Number(top[1]) })
  }
  return out
}

function overlayPages() {
  const found = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (entry.name !== 'index.wxml') continue
      const src = fs.readFileSync(full, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
      if (/<cy-nav-bar[^>]*\boverlay\b/.test(src)) found.push(path.dirname(full))
    }
  }
  walk(path.join(ROOT, 'pages'))
  return found
}

test('透明导航页:绝对定位的内容必须让开胶囊', () => {
  const offenders = []
  for (const dir of overlayPages()) {
    const wxss = path.join(dir, 'index.wxss')
    if (!fs.existsSync(wxss)) continue
    for (const rule of absoluteTops(wxss)) {
      if (FULL_BLEED.test(rule.selector)) continue          // 背景与遮罩本来就该顶到顶
      if (rule.rpx >= CAPSULE_BOTTOM_RPX) continue
      // top 很小的往往是嵌在小容器里的装饰点,不是页面级定位;
      // 只有直接挂在页面 hero 上的才算。这里用「选择器里带 head/hero」收窄。
      if (!/head|hero/.test(rule.selector)) continue
      offenders.push(`${path.relative(ROOT, dir)} ${rule.selector} top:${rule.rpx}rpx`)
    }
  }
  assert.deepEqual(offenders, [],
    `这些元素会被微信胶囊盖住(胶囊底 ${CAPSULE_BOTTOM_RPX}rpx)`)
})

test('活动详情页的 hero 换算没有把状态栏那 49px 算进去', () => {
  const rules = absoluteTops(path.join(ROOT, 'pages/club/topic-detail/index.wxss'))
  const qa = rules.find(r => r.selector.includes('ctd-qa'))
  assert.ok(qa, '.ctd-qa 不见了,本合同的锚点要重挑')
  // 设计稿 y449 是画板坐标(含 49px 状态栏),本块基准是封面顶 → (449-49)×2
  assert.equal(qa.rpx, 800,
    `.ctd-qa 应为 800rpx;写成 898 就是把画板的 49px 状态栏一起算进去了(实测会压住「核销」标题)`)
})

test('负控:把任一 hero 元素挪到胶囊底下,门禁必须变红', () => {
  const wxss = path.join(ROOT, 'pages/club/topic-detail/index.wxss')
  const css = fs.readFileSync(wxss, 'utf8')
  const mutated = css.replace(/(\.ctd-head__logo\s*\{[^}]*?top:\s*)[\d.]+rpx/, '$1 40rpx')
  assert.notEqual(mutated, css, '变异没生效:.ctd-head__logo 的形状变了,这个负控在空转')

  const tmp = path.join(ROOT, 'tests/unit/.tmp-capsule-negative.wxss')
  fs.writeFileSync(tmp, mutated)
  try {
    const caught = absoluteTops(tmp).some(r =>
      !FULL_BLEED.test(r.selector) && /head|hero/.test(r.selector) && r.rpx < CAPSULE_BOTTOM_RPX)
    assert.equal(caught, true, '判据认不出被挪进胶囊的元素,它是橡皮图章')
  } finally { fs.unlinkSync(tmp) }
})

test('负控:判据不能把故意全幅的封面/遮罩判成违规', () => {
  const rules = absoluteTops(path.join(ROOT, 'pages/club/topic-detail/index.wxss'))
  const cover = rules.find(r => r.selector.includes('ctd-head__cover'))
  assert.ok(cover && cover.rpx === 0, '封面本来就该 top:0')
  assert.equal(FULL_BLEED.test(cover.selector), true, '封面被判成违规,门禁会逼人把图往下推')
})
