const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { channelsForVisibility } = require('../../utils/roam-route-privacy.js')

// 3-24:「仅好友」文案承诺「微信转发给好友」,可渠道只有朋友圈(存图+引导)与保存,没有转发钮。
test('「仅好友」提示文案与实际渠道一致:不承诺转发,只说朋友圈/存图', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../../pages/roam/index.wxml'), 'utf8')
  const hint = wxml.match(/sh-vis__hint">[^<]*share\.visibility === 'friends' \? '([^']+)'/)
  assert.ok(hint, '找不到仅好友档提示文案')
  assert.deepEqual(channelsForVisibility('friends'), ['朋友圈', '保存'])
  assert.doesNotMatch(hint[1], /转发/)
  assert.match(hint[1], /朋友圈/)
})
