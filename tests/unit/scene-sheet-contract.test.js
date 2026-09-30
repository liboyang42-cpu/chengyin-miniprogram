'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')
const stack = require(path.join(ROOT, 'utils/scene-stack.js'))

test('scene-sheet exposes full/half shells and semantic close events', () => {
  const wxml = read('components/cy/scene-sheet/index.wxml')
  const js = read('components/cy/scene-sheet/index.js')
  const wxss = read('components/cy/scene-sheet/index.wxss')
  assert.match(wxml, /ss--\{\{variant\}\}/)
  assert.doesNotMatch(wxml, /variant === 'confirm'/)
  assert.match(wxml, /bindtap="onBack"/)
  assert.match(wxml, /bindtap="onClose"/)
  assert.match(wxml, /data-testid="scene-sheet-close"/)
  assert.match(wxml, /class="ss__close" wx:if="\{\{closable\}\}"/)
  assert.match(wxml, /aria-label="\{\{closeLabel\}\}"/)
  assert.match(js, /triggerEvent\('requestclose'/)
  assert.match(js, /dirty/)
  assert.match(js, /closeLabel/)
  assert.match(js, /closable:\s*\{ type: Boolean, value: true \}/)
  assert.match(wxss, /--cy-motion-standard/)
  assert.match(wxss, /box-shadow:\s*var\(--cy-sheet-inset-shadow\)/)
  assert.doesNotMatch(wxss, /--cy-motion-slow/)
  assert.match(wxss, /\.ss--full \.ss__panel\s*\{[\s\S]*height:\s*var\(--cy-comp-sheet-full-height\);/)
  // 2026-09-02 二次修正:一度改成 92vh(手册值),实测**三种机型全部压住微信右上角胶囊**。
  // 写死 vh 与安全区无关,注定复发 —— 改为从安全区反算,细节见 sheet-top-safe-area-contract。
  assert.match(read('style/tokens.wxss'),
    /--cy-comp-sheet-full-height:\s*var\(--cy-comp-sheet-max-height\);/,
    'T3 全屏高度必须走安全上限 token,不许写字面 vh,也不许写画板量出来的绝对像素')
  // 2026-09-02:peek 并入 half(下限相同、只差 12vh 上限,渲染常一模一样);
  // min-height 一并删掉 —— 它把一句话的说明也撑到近半屏。
  assert.doesNotMatch(wxss, /^\s*\.ss--peek\b/m, 'peek 档已合并,不该再有 .ss--peek 规则')
  assert.match(wxss, /\.ss--half \.ss__panel\s*\{[^}]*max-height:\s*70vh;/)
  assert.doesNotMatch(wxss, /^\s*min-height:\s*42vh/m, 'T1 不设下限:短内容不该被强行撑高')
  assert.doesNotMatch(wxss, /--cy-comp-sheet-full-max-height/, 'height 已是上限,孪生 max-height 应删掉')
  assert.match(wxss, /\.ss--merchant\s*\{[\s\S]*--cy-comp-sheet-bg:\s*var\(--cy-comp-sheet-merchant-bg\);/)
})

function assertCloseHitArea(tokens, wxml, wxss) {
  const hit = tokens.match(/--cy-comp-sheet-close-hit-size:\s*([\d.]+)rpx/)
  assert.ok(hit, '缺少关闭/返回控件的独立热区 token')
  assert.ok(Number(hit[1]) >= 88, '关闭/返回热区必须在不同稿宽下都保持至少 88rpx')
  assert.match(wxml, /class="ss__control"/, '视觉圆必须包在独立热区内,不能直接把圆放大')
  assert.match(wxss, /width:\s*var\(--cy-comp-sheet-close-hit-size\)/)
  assert.match(wxss, /\.ss__control\s*\{[\s\S]*width:\s*var\(--cy-comp-sheet-close-size\)/)
  // 2026-09-02(§3.21 · 用户当面点名):视觉层保留(它是「视觉尺寸 vs 88rpx 热区」的分界),但底色必须透明
  assert.match(wxss, /\.ss__control\s*\{[\s\S]*background:\s*transparent/, '✕ 去圆底,只留字形')
}

test('scene-sheet 的关闭/返回热区至少 88rpx,视觉圆仍保持 Figma 尺寸', () => {
  assertCloseHitArea(
    read('style/tokens.wxss'),
    read('components/cy/scene-sheet/index.wxml'),
    read('components/cy/scene-sheet/index.wxss'),
  )
})

test('negative control: 热区退回 63.992rpx 时必须判红', () => {
  const tokens = read('style/tokens.wxss')
  const mutated = tokens.replace('--cy-comp-sheet-close-hit-size: 88rpx', '--cy-comp-sheet-close-hit-size: 63.992rpx')
  assert.notEqual(mutated, tokens, '变异锚点失效')
  assert.throws(
    () => assertCloseHitArea(mutated, read('components/cy/scene-sheet/index.wxml'), read('components/cy/scene-sheet/index.wxss')),
    assert.AssertionError,
  )
})

test('cy-modal remains the only confirmation container and exposes button semantics', () => {
  const wxml = read('components/cy/modal/index.wxml')
  assert.match(wxml, /bindtap="onCancel"[^>]*aria-role="button"[^>]*aria-label="\{\{cancelText\}\}"/)
  assert.match(wxml, /bindtap="onConfirm"[^>]*aria-role="button"[^>]*aria-label="\{\{confirmText\}\}"/)
})

test('roam pilot is wired to the scene stack and requires a real trigger', () => {
  const pageJson = JSON.parse(read('pages/roam/index.json'))
  const js = read('pages/roam/index.js')
  const wxml = read('pages/roam/index.wxml')
  // 2026-09-10 漫游四模式脱离小程序 DS:本页 15 个半屏 + 仪式卡全部换成原型自己的 .psheet,
  //   cy-scene-sheet / cy-sheet 都不再注册。这里改成反向钉死:**不许偷偷把 DS 壳装回来**,
  //   否则「照 HTML 完全一致」会在某次顺手改动里悄悄退回去。
  assert.equal(pageJson.usingComponents['cy-scene-sheet'], undefined,
    '漫游页不该再注册 cy-scene-sheet —— 这四个模式用原型自己的半屏壳')
  assert.equal(pageJson.usingComponents['cy-sheet'], undefined,
    '同上:cy-sheet 也不该回来')
  assert.match(wxml, /class="psheet /, '半屏壳必须是原型那层 .psheet')
  assert.equal(pageJson.usingComponents['cy-modal'], '/components/cy/modal/index')
  assert.match(js, /openRoamRules\(\)\s*\{[\s\S]*openScene\(/)
  assert.match(js, /openScene\(id, params = \{\}\)/)
  assert.match(js, /requestSceneClose\(\)/)
  assert.match(wxml, /class="pcard__rules" catchtap="openRoamRules"/)
  // 2026-09-10 同上:漫游页的关闭口从组件事件换成本页 onProtoSheetClose,
  //   它内部按 canBack 分流到 backScene / requestSceneClose(脏态确认仍在后者)。
  assert.match(wxml, /class="psheet__x"[^>]*catchtap="onProtoSheetClose"/)
  assert.match(js, /onProtoSheetClose\(\)\s*\{[\s\S]*?requestSceneClose\(\)/)
  assert.match(wxml, /<cy-modal[^>]*bind:confirm="confirmSceneDiscard"[^>]*bind:cancel="cancelSceneDiscard"/)
  assert.match(wxml, /roam-scene-host[^>]*catchtouchmove="blockSceneTouch"/)
})

test('scene stack caps depth at two and replaces the active child beyond the cap', () => {
  let scenes = stack.pushScene([], { id: 'root', title: '根场景' })
  scenes = stack.pushScene(scenes, { id: 'child', title: '子场景' })
  scenes = stack.pushScene(scenes, { id: 'overflow', title: '替换子场景' })
  assert.deepEqual(scenes.map((scene) => scene.id), ['root', 'overflow'])
  assert.deepEqual(stack.popScene(scenes).map((scene) => scene.id), ['root'])
})

test('返回箭头只由实际栈深决定,注册表的子层提示不能污染首层', () => {
  let scenes = stack.pushScene([], { id: 'detail', title: '详情', canBack: true })
  assert.equal(stack.currentScene(scenes).canBack, false, '从空栈直开仍是首层,只能显示关闭')
  scenes = stack.pushScene(scenes, { id: 'child', title: '子层', canBack: false })
  assert.equal(stack.currentScene(scenes).canBack, true, '实际第二层必须显示返回')
})

test('back from a dirty scene requires confirmation but clean back pops immediately', () => {
  const dirty = stack.pushScene([], { id: 'edit', title: '编辑', dirty: true })
  assert.equal(stack.exitDecision(dirty, 'back'), 'confirm')
  const clean = stack.pushScene([], { id: 'read', title: '只读' })
  assert.equal(stack.exitDecision(clean, 'back'), 'back')
  assert.equal(stack.exitDecision(clean, 'close'), 'close')
  const rich = stack.currentScene(stack.pushScene([], { id: 'rich', params: { sessionId: 's1' }, maskClosable: true }))
  assert.equal(rich.maskClosable, true)
  assert.deepEqual(rich.params, { sessionId: 's1' })
})

test('dirty scene close enters confirmation instead of silently closing', () => {
  const scenes = stack.pushScene([], { id: 'edit', title: '编辑', dirty: true })
  assert.equal(stack.closeDecision(scenes), 'confirm')
  assert.equal(stack.closeDecision(stack.popScene(scenes)), 'close')
})

test('scene stack rejects an unidentifiable scene', () => {
  assert.throws(() => stack.pushScene([], { title: '没有 id' }), /requires an id/)
})

test('form scenes advertise capability without opening dirty', () => {
  const registry = require(path.join(ROOT, 'utils/scene-registry.js'))
  const scene = registry.getScene('member-withdraw')
  assert.equal(scene.form, true)
  assert.equal(scene.dirty, undefined)
  assert.equal(scene.maskClosable, false)
  const normalized = stack.normalizeScene(scene)
  assert.equal(normalized.form, true)
  assert.equal(normalized.dirty, false)
})
