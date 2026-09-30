const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8')

test('沉浸游玩页保留地图退出能力，开始飞行层出现时隐藏出口，并消费安全区', () => {
  const wxml = read('pages/play/index.wxml')
  const wxss = read('pages/play/index.wxss')
  // 2026-08-06 用户裁决:起飞过场删除、地图左上退出钮删除(返回走系统手势/结算页)。
  assert.doesNotMatch(wxml, /startFlight/, '起飞过场已删,不得回流')
  // 2026-09-22 主地图整层删除后页面已没有带 show-exit 的地图;契约拆成两半:页面不许打开它,
  // 组件默认值必须是 false —— 只留前半条的话,组件改了默认值这里照样绿。
  assert.doesNotMatch(wxml, /show-exit="\{\{true\}\}"/)
  assert.match(read('components/cy/free-map/index.js'), /showExit:\s*\{\s*type:\s*Boolean,\s*value:\s*false\s*\}/)
  // 2026-09-09:顶部输入地址占住了胶囊底下那条位置带,状态条整体让到它下面(§6.6),
  // 所以 top 是 contentTop 加一个偏移。要守的仍是「由胶囊真实位置算出来」,不是那个字面表达式。
  assert.match(read('pages/play/index.wxml'), /class="play-topstack"[^>]*style="top:\{\{chrome\.contentTop \+ \d+\}\}px"/,
    '状态条必须由胶囊真实位置定位,不能退回写死 top')
  assert.match(read('pages/play/index.wxml'), /<cy-map-address-search[^>]*top="\{\{chrome\.contentTop\}\}"/,
    '输入地址自己必须贴在胶囊底下那条位置带上')
  const freeMap = read('components/cy/free-map/index.wxml')
  const freeMapJs = read('components/cy/free-map/index.js')
  const freeMapWxss = read('components/cy/free-map/index.wxss')
  // 2026-07-29:退出钮拆成「外层命中区 + 内层视觉圆钮」,tap 在外层(见 ds-ada-foundation-contract)
  assert.match(freeMap, /class="fmap-exit-hit"[\s\S]*bindtap="onExitTap"[\s\S]*class="fmap-exit"/)
  assert.match(freeMap, /style="top:\{\{exitTop\}\}px;"/)
  assert.match(freeMapJs, /showExit:\s*\{[\s\S]*type:\s*Boolean/)
  assert.match(freeMapJs, /onExitTap\(\)\s*\{[\s\S]*triggerEvent\('exit'\)/)
  assert.match(freeMapWxss, /\.fmap-exit[\s\S]*z-index:\s*130/)
  // 2026-08-06 用户裁决:游戏改半屏弹窗(gp2),关闭钮随之收进 sheet 头部
  assert.match(wxml, /class="gp2__back" bindtap="closeGame"/)
  assert.match(wxml, /class="gp2mask"[^>]*bindtap="closeGame"/)
  assert.match(wxss, /\.pcard[\s\S]*bottom:\s*calc\([^;]*env\(safe-area-inset-bottom\)/)
  assert.match(wxss, /\.sheet-body[\s\S]*padding:[^;]*env\(safe-area-inset-bottom\)/)
})

test('negative control: removing the map exit is rejected', () => {
  const original = read('pages/play/index.wxml')
  const mutated = read('components/cy/free-map/index.wxml').replace(/class="fmap-exit-hit"/, 'class="fmap-exit--removed"')
  assert.throws(() => assert.match(mutated, /class="fmap-exit-hit"[\s\S]*bindtap="onExitTap"[\s\S]*class="fmap-exit"/))
})
