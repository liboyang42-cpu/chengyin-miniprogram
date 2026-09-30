const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

test('内容区切换走 fill 下划线，不走 chip 药丸', () => {
  /* 2026-09-10:合作中心这一档改钉「不是药丸/分段」,不再钉 variant="fill" 这个字面值。
     本条规范(2026-08-31)要的是**下划线形态**;稿 234:282(2026-09-03,更晚)明确画的是
     两档左对齐、下划线只有 20px 宽居中在文字下 —— 那是 cy-tabs 的默认档,不是 fill。
     fill 会让两档各占半屏、下划线撑满半个屏幕,与稿不符。
     ⚠️ 只放开这一页;下面 club/detail 那两处仍按原样钉 fill。 */
  const center = read('pages/merchant/coop-center/index.wxml')
  const ccTabs = center.match(/<cy-tabs[^>]*class="cc-tabs"[^>]*>/)
  assert.ok(ccTabs)
  assert.doesNotMatch(ccTabs[0], /variant="(chip|segmented)"/, '内容区切换不许退回药丸/分段')

  const club = read('pages/club/detail/index.wxml')
  const eventView = club.match(/<cy-tabs[^>]*class="event-view-tabs"[^>]*>/)
  assert.ok(eventView)
  assert.match(eventView[0], /variant="fill"/)
  assert.doesNotMatch(eventView[0], /variant="chip"/)
})

test('同页状态筛选走 chip 药丸，不走 fill 下划线', () => {
  const aftercare = read('pages/merchant/aftercare/index.wxml')
  const filters = aftercare.match(/<cy-tabs[^>]*class="acl-filter"[^>]*>/g)
  assert.equal(filters && filters.length, 2)
  filters.forEach((tag) => {
    assert.match(tag, /variant="chip"/)
    assert.doesNotMatch(tag, /variant="fill"/)
  })

  const roster = read('pages/club/event-ops/index.wxml')
  const rosterTabs = roster.match(/<cy-tabs[^>]*class="roster-filter"[^>]*>/)
  assert.ok(rosterTabs)
  assert.match(rosterTabs[0], /variant="chip"/)
  assert.doesNotMatch(rosterTabs[0], /variant="fill"/)
})
