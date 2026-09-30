const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

// 用户 2026-08-07 拍板:统一弹窗 = 半屏 bottom 变体(70vh) + 半透明玻璃底 + backdrop-filter 模糊。
// variant="full" 只留给「依附发起页的连续多步任务」(向导型表单),白名单如下;
// 新增任何 full 调用都必须先过这份契约(即:先来改这个白名单,说清为什么不能半屏)。
const FULL_VARIANT_WHITELIST = new Set([
  'pages/topic/merchantapply/index.wxml', // 商家报名三步向导(steps/canBack/dirty 全接线)
  'pages/activity/list/index.wxml', // 发起官方活动多步表单
  // 2026-09-17 用户裁决照 Revolut Business 314/315:商家售后回应是「填写 → 确认后果 → 提交」两步(steps/canBack 接线),
  // 与上面两条同属依附发起页的连续多步任务,不是单字段弹窗。
  'pages/merchant/aftercare/detail/index.wxml',
])

function walkWxml(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'tests' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkWxml(full, out)
    else if (entry.name.endsWith('.wxml')) out.push(full)
  }
  return out
}

test('cy-sheet variant="full" 只允许白名单里的向导表单,其余一律半屏 bottom', () => {
  const offenders = []
  for (const file of walkWxml(ROOT)) {
    const source = fs.readFileSync(file, 'utf8')
    // 只认真实的 <cy-sheet …> 标签(可跨行),不吃注释里的字样;<cy-scene-sheet 是另一个组件,不在本契约内
    const tags = source.match(/<cy-sheet[\s>][\s\S]*?>/g) || []
    if (tags.some((tag) => /variant="full"/.test(tag))) {
      const rel = path.relative(ROOT, file)
      if (!FULL_VARIANT_WHITELIST.has(rel)) offenders.push(rel)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `以下页面把弹窗做成了近全屏 variant="full",违反「弹窗=半屏玻璃」规范:\n${offenders.join('\n')}`,
  )
})

test('cy-sheet 面板必须是半透明玻璃底 + backdrop-filter 模糊 + 70vh 半屏', () => {
  const wxss = read('components/cy/sheet/index.wxss')
  const panel = wxss.match(/\.sh__panel\s*\{[^}]*\}/)
  assert.ok(panel, '找不到 .sh__panel 规则')

  assert.match(
    panel[0],
    /--cy-comp-sheet-bg:\s*var\(--cy-comp-sheet-role-glass/,
    '面板底必须读 role 档(玩家=深玻璃/商家=不透明白,2026-08-07 双规范),不能退回实底',
  )
  assert.match(
    panel[0],
    /backdrop-filter:\s*blur\(var\(--cy-comp-sheet-blur/,
    '面板必须有 backdrop-filter 玻璃模糊(读 --cy-comp-sheet-blur token)',
  )
  assert.match(
    panel[0],
    /-webkit-backdrop-filter:\s*blur\(var\(--cy-comp-sheet-blur/,
    '必须带 -webkit- 前缀,iOS webview 才生效',
  )
  // 2026-08-10:上限改成带兜底的变量。默认仍是 70vh(8-05 拍板值)—— 全站 63 处调用
  // 一处都不受影响;只有显式传 --cy-comp-sheet-max-h 的调用点才另算(用户 8-10 定:
  // 专业发布域的弹窗统一贴到胶囊底 +5px)。断言同时钉住「变量名」和「兜底值」,
  // 任一被改掉都判红 —— 只钉 70vh 的话,把 fallback 悄悄改成 90vh 抓不到。
  assert.match(panel[0], /max-height:\s*var\(--cy-comp-sheet-max-h,\s*70vh\)/,
    '半屏上限必须是 var(--cy-comp-sheet-max-h, 70vh):兜底 70vh 是 8-05 拍板值,不能动')
})

test('--cy-comp-sheet-blur token 必须在 tokens.wxss 定义', () => {
  assert.match(read('style/tokens.wxss'), /--cy-comp-sheet-blur:\s*\d+rpx/, '缺 --cy-comp-sheet-blur token 定义')
  // 2026-09-03 Brand Handbook 410-121 §③「深色阶去蓝紫」:30 → 28,拿掉最后一点蓝相。
  // 钉的仍是同一件事(深端玻璃底不许退回实底/不许换色),只是把值追平了新的真源。
  assert.match(read('style/tokens.wxss'), /--cy-comp-sheet-player-glass:\s*rgba\(28, 28, 28, \.82\)/, '缺钉死深端的玻璃底 token')
})

test('负控:白名单外出现 full、面板退回实底/丢模糊都必须判红', () => {
  // 白名单外的 full:拿真实存在的注销页模拟回潮
  const deregister = read('pages/deregister/index.wxml')
  const regressed = deregister.replace('<cy-sheet show="{{true}}"', '<cy-sheet show="{{true}}" variant="full" nav-title="账号注销"')
  assert.notEqual(regressed, deregister, '负控锚点失效:注销半屏弹窗不存在')
  const tags = regressed.match(/<cy-sheet[\s>][\s\S]*?>/g) || []
  assert.ok(tags.some((tag) => /variant="full"/.test(tag)), '负控自检:注入的 full 必须能被同一正则扫到')

  // 面板退回实底 / 丢 blur
  const wxss = read('components/cy/sheet/index.wxss')
  const solid = wxss.replace('--cy-comp-sheet-bg: var(--cy-comp-sheet-role-glass);', '--cy-comp-sheet-bg: var(--cy-comp-sheet-player-bg);')
  assert.notEqual(solid, wxss, '负控锚点失效:玻璃底声明不存在')
  assert.doesNotMatch(solid.match(/\.sh__panel\s*\{[^}]*\}/)[0], /--cy-comp-sheet-bg:\s*var\(--cy-comp-sheet-role-glass/)
  const noBlur = wxss.replace(/\s*backdrop-filter: blur\(var\(--cy-comp-sheet-blur, 24rpx\)\);/, '')
  assert.notEqual(noBlur, wxss, '负控锚点失效:blur 声明不存在')
  assert.doesNotMatch(noBlur.match(/\.sh__panel\s*\{[^}]*\}/)[0], /(?<!-webkit-)backdrop-filter:\s*blur\(var\(--cy-comp-sheet-blur/)
})
