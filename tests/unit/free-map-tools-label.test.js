const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

// 2026-08-04 用户裁决(做减法):撤掉「可见中文标签」——原来每个工具是「白文字胶囊 + 黑圆钮」
// 两件套并排飘在地图上,三组共 6 个元素,是地图最脏的一处。现在只留圆钮。
// ⚠️ 撤的是**可见文字**,不是读屏语义:aria-role/aria-label 和 44pt 点击区一条都不能少,
//    下面锁的就是这三样。要恢复可见标签请改这条测试并说明理由,别悄悄加回去。
test('地图工具保留 44pt 点击区与读屏语义(可见中文标签已按裁决撤除)', () => {
  const wxml = read('components/cy/free-map/index.wxml')
  const wxss = read('components/cy/free-map/index.wxss')
  const json = JSON.parse(read('components/cy/free-map/index.json'))
  const tools = [
    { action: 'recenter', aria: '回到当前位置', icon: 'gps' },
    { action: 'zoomIn', aria: '放大地图', icon: 'plus' },
    { action: 'zoomOut', aria: '缩小地图', icon: 'zoom-out' },
  ]

  tools.forEach(({ action, aria, icon }) => {
    const button = new RegExp(
      `<view class="fmap-btn[^"]*" bindtap="${action}"[^>]*aria-role="button"[^>]*aria-label="${aria}"[^>]*>[\\s\\S]*?<cy-icon name="${icon}" size="40"\\s*/>`,
    )
    assert.match(wxml, button, `${action} 必须保留点击目标与 aria-label`)
  })
  assert.equal(json.usingComponents?.['cy-icon'], '/components/cy/icon/index')
  assert.doesNotMatch(wxml, /class="fmap-(?:locate|plus|minus)"/,
    '地图工具不得退回空 view + CSS art 伪图标')

  // 点击区不许因为去掉标签而缩水
  assert.match(wxss, /\.fmap-btn\s*\{[^}]*width:\s*88rpx;[^}]*height:\s*88rpx;/s)
  // 缩放两枚合成一条轨,但内部按钮不得因此丢掉尺寸(--flush 只去边框/圆角/底色)
  assert.match(wxss, /\.fmap-btn--flush\s*\{[^}]*border:\s*0;/s)
  assert.doesNotMatch(wxss, /\.fmap-btn--flush\s*\{[^}]*(?:width|height):/s,
    '--flush 不得覆盖尺寸,否则缩放键会掉到 44pt 以下')
  // 可见文字标签确已撤除(留着 = 减法没做干净)
  assert.doesNotMatch(wxml, /fmap-btn__label/)
  assert.doesNotMatch(wxss, /fmap-btn__label/)
  assert.match(wxml, /<view class="fmap-ctrl"[^>]*>/s)
})
