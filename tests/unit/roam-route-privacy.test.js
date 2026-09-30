'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const {
  CLIP_DEFAULT,
  CLIP_MAX,
  CLIP_MIN,
  STORAGE_KEY,
  VISIBILITY,
  channelFlags,
  channelsForVisibility,
  clipTrackForSharing,
  isChannelAllowed,
  normalizeClipPercent,
  normalizeSharePrivacy,
  readSharePrivacy,
  writeSharePrivacy,
} = require('../../utils/roam-route-privacy.js')

const ROOT = path.resolve(__dirname, '../..')

function track(count) {
  // 一条严格单调的直线:任意两点都不相等,端点变没变一眼可判
  return Array.from({ length: count }, (_, index) => ({
    lat: 31.2 + index * 0.001,
    lng: 121.4 + index * 0.001,
  }))
}

function fakeStorage(initial) {
  const box = { value: initial }
  return {
    getStorageSync(key) {
      assert.equal(key, STORAGE_KEY)
      return box.value
    },
    setStorageSync(key, value) {
      assert.equal(key, STORAGE_KEY)
      box.value = value
    },
  }
}

// 「裁剪确实发生了」这组断言单独抽出来:主用例拿它判绿,负控拿它判红。
// 同一段断言两处复用,才谈得上「负控证明它能变红」—— 各写一份就只是两段独立的话。
function assertRouteWasClipped(source, clipped) {
  assert.notEqual(clipped.length, source.length, '裁剪没有发生:点数与原轨迹一样')
  assert.notDeepEqual(clipped[0], source[0], '起点没变:出发点(通常是家)仍然暴露在分享图上')
  assert.notDeepEqual(
    clipped[clipped.length - 1],
    source[source.length - 1],
    '终点没变:回家点仍然暴露在分享图上',
  )
}

test('裁剪算法:首尾各裁掉指定比例，点数与两个端点都必须变', () => {
  const source = track(100)
  const clipped = clipTrackForSharing(source, { clipEnabled: true, clipPercent: 10 })

  assertRouteWasClipped(source, clipped)

  // 100 点 × 10% = 首尾各裁 10 点
  assert.equal(clipped.length, 80)
  assert.deepEqual(clipped[0], source[10])
  assert.deepEqual(clipped[clipped.length - 1], source[89])
})

test('负控:把裁剪比例改成 0(闸门失效)，上面那组断言必须判红', () => {
  const source = track(100)

  // 变异体:同一条轨迹、同一个函数,只把「裁多少」改成 0。
  // clipPercent 会被归一化夹到 1%,所以「比例为 0」由 clipEnabled=false 表达 ——
  // 两者对分享产物的后果完全一样:整条轨迹原样发出去。
  const mutant = clipTrackForSharing(source, { clipEnabled: false, clipPercent: 10 })

  // ★ 第一行先证明变异真的发生了(闸门确实没裁),再证明断言抓得住它
  assert.equal(mutant.length, source.length, '变异没生效:关掉裁剪却还是裁了,负控本身是假的')
  assert.deepEqual(mutant[0], source[0])
  assert.deepEqual(mutant[mutant.length - 1], source[source.length - 1])

  assert.throws(
    () => assertRouteWasClipped(source, mutant),
    /裁剪没有发生/,
    '闸门失效时断言仍然绿 —— 这组测试是恒真的,抓不住回归',
  )
})

test('负控:9 个点 × 1% 裁不掉任何点，端点原样 —— 证明「变了」不是断言写法带来的必然', () => {
  const source = track(9)
  const clipped = clipTrackForSharing(source, { clipEnabled: true, clipPercent: 1 })
  assert.equal(clipped.length, 9, 'floor(9 × 1%) = 0,本来就裁不掉点')
  assert.deepEqual(clipped[0], source[0])
  assert.throws(() => assertRouteWasClipped(source, clipped), /裁剪没有发生/)
})

test('裁剪比例可调 1%–40%，每一档都真的按点数裁', () => {
  const source = track(200)
  const cases = [
    [1, 2, 196],
    [10, 20, 160],
    [25, 50, 100],
    [40, 80, 40],
  ]
  cases.forEach(([percent, drop, remain]) => {
    const clipped = clipTrackForSharing(source, { clipEnabled: true, clipPercent: percent })
    assert.equal(clipped.length, remain, `${percent}% 剩余点数不对`)
    assert.deepEqual(clipped[0], source[drop], `${percent}% 起点裁的位置不对`)
    assert.deepEqual(clipped[clipped.length - 1], source[source.length - drop - 1], `${percent}% 终点裁的位置不对`)
    assertRouteWasClipped(source, clipped)
  })
})

test('裁完剩不下两个点时返回空轨迹，绝不回退成完整轨迹', () => {
  // 4 点 × 40% = 首尾各裁 1 点 ⇒ 剩 2 点,还能画
  assert.equal(clipTrackForSharing(track(4), { clipEnabled: true, clipPercent: 40 }).length, 2)
  // 3 点 × 40% = 首尾各裁 1 点 ⇒ 剩 1 点,画不出线段:返回空,不能退回 3 点原轨迹
  assert.deepEqual(clipTrackForSharing(track(3), { clipEnabled: true, clipPercent: 40 }), [])
  // 少于 2 点本来就没有轨迹可裁
  assert.deepEqual(clipTrackForSharing([], { clipEnabled: true, clipPercent: 10 }), [])
  assert.deepEqual(clipTrackForSharing(null, { clipEnabled: true, clipPercent: 10 }), [])
})

test('默认值:没设置过 = 裁剪开着、10%、公开', () => {
  assert.deepEqual(normalizeSharePrivacy(null), {
    clipEnabled: true,
    clipPercent: CLIP_DEFAULT,
    visibility: VISIBILITY.PUBLIC,
  })
  assert.equal(CLIP_MIN, 1)
  assert.equal(CLIP_MAX, 40)
  assert.equal(CLIP_DEFAULT, 10)
})

test('存储读不出来时退默认(裁剪仍开着)，而不是退成「不裁」', () => {
  const broken = {
    getStorageSync() { throw new Error('storage broken') },
    setStorageSync() {},
  }
  assert.equal(readSharePrivacy(broken).clipEnabled, true)
  assert.equal(readSharePrivacy(broken).clipPercent, CLIP_DEFAULT)
  // 存储 API 完全缺席也一样
  assert.equal(readSharePrivacy({}).clipEnabled, true)
})

test('比例越界一律夹回 1–40，脏值不会把闸门冲开', () => {
  assert.equal(normalizeClipPercent(0), 1)
  assert.equal(normalizeClipPercent(-30), 1)
  assert.equal(normalizeClipPercent(99), 40)
  assert.equal(normalizeClipPercent('abc'), CLIP_DEFAULT)
  assert.equal(normalizeClipPercent(null), CLIP_DEFAULT)
  assert.equal(normalizeClipPercent(undefined), CLIP_DEFAULT)
  assert.equal(normalizeClipPercent(12.6), 13)
})

test('设置落盘并读回;写失败要如实返回 ok:false 而不是假装存上了', () => {
  const storage = fakeStorage(undefined)
  const saved = writeSharePrivacy({ clipPercent: 25, visibility: VISIBILITY.PRIVATE }, storage)
  assert.equal(saved.ok, true)
  assert.equal(saved.clipPercent, 25)
  assert.deepEqual(readSharePrivacy(storage), {
    clipEnabled: true,
    clipPercent: 25,
    visibility: VISIBILITY.PRIVATE,
  })

  const failing = {
    getStorageSync() { return undefined },
    setStorageSync() { throw new Error('quota') },
  }
  assert.equal(writeSharePrivacy({ clipPercent: 30 }, failing).ok, false)
})

test('可见性是真闸:每一档只放行它真能兑现的渠道', () => {
  assert.deepEqual(channelsForVisibility(VISIBILITY.PUBLIC), ['广场', '朋友圈', '小红书', '保存'])
  assert.deepEqual(channelsForVisibility(VISIBILITY.FRIENDS), ['朋友圈', '保存'])
  assert.deepEqual(channelsForVisibility(VISIBILITY.PRIVATE), ['保存'])
  // 仅自己 / 仅好友 绝不能落到广场(那是真发帖)
  assert.equal(isChannelAllowed('广场', VISIBILITY.PRIVATE), false)
  assert.equal(isChannelAllowed('广场', VISIBILITY.FRIENDS), false)
  assert.equal(isChannelAllowed('广场', VISIBILITY.PUBLIC), true)
  // 脏值退默认档(公开),不会退成「什么都不放行」把功能锁死
  assert.deepEqual(channelsForVisibility('bogus'), ['广场', '朋友圈', '小红书', '保存'])
})

test('channelFlags:模板只读布尔，不在 WXML 里对中文字面量做 indexOf', () => {
  // 2026-08-27 实测:WXML 表达式里 `channels.indexOf('广场') >= 0` 恒为 false,
  // 四个渠道会一起置灰,而 data 层断言全绿(automator 回读 class 才抓到)。
  assert.deepEqual(channelFlags(VISIBILITY.PUBLIC), { square: true, moments: true, xhs: true, save: true })
  assert.deepEqual(channelFlags(VISIBILITY.FRIENDS), { square: false, moments: true, xhs: false, save: true })
  assert.deepEqual(channelFlags(VISIBILITY.PRIVATE), { square: false, moments: false, xhs: false, save: true })
})

test('契约:分享 sheet 的置灰只能读 share.can 布尔，不许在 WXML 里 indexOf', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/roam/index.wxml'), 'utf8')
  // 2026-09-19 裁决:分享 sheet 退出口只留 ✕(底部「取消」已删),区间尾锚改用 sheet 之后的 canvas。
  const sheet = wxml.slice(wxml.indexOf('sh-channels'), wxml.indexOf('<canvas type="2d" id="iconcv"'))
  assert.equal(/indexOf/.test(sheet), false, '渠道置灰又用回了 WXML indexOf —— 那个表达式恒假,置灰不会生效')
  assert.match(sheet, /share\.can\.square/)
  assert.match(sheet, /share\.can\.save/)
})

test('契约:两条分享链路都必须过裁剪，缺一条就有一张图仍然带着家门口', () => {
  const roam = fs.readFileSync(path.join(ROOT, 'pages/roam/index.js'), 'utf8')
  const session = fs.readFileSync(path.join(ROOT, 'subpackageRoam/session/index.js'), 'utf8')

  assert.match(roam, /clipTrackForSharing\(this\._track, readSharePrivacy\(wx\)\)/,
    'pages/roam 的分享卡(archSegs)没过裁剪')
  assert.match(session, /clipSavedTrackForSharing\(s\.track \|\| \[\], readSharePrivacy\(wx\)\)/,
    'subpackageRoam/session 的足迹卡没过裁剪')
  assert.match(roam, /isChannelAllowed\(ch, this\.data\.share\.visibility\)/,
    '可见性没有在 shareTo 里真拦渠道,只置灰 = 假闸')
})
