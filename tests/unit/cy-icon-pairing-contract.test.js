const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const XCX = path.resolve(__dirname, '../..')
const REPO = path.resolve(XCX, '..')
const readXcx = (file) => fs.readFileSync(path.join(XCX, file), 'utf8')
const readRepo = (file) => fs.readFileSync(path.join(REPO, file), 'utf8')
const clone = (value) => JSON.parse(JSON.stringify(value))

const SPEC = JSON.parse(readXcx('components/cy/icon/spec.json'))
const TOKENS = readXcx('style/tokens.wxss')

const MIN_HIT_TARGET = 88
const REGULAR_RATIO = { min: 0.4, max: 0.55 }

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function tokenValue(source, name, seen = new Set()) {
  assert.ok(!seen.has(name), `${name} token 不能循环引用`)
  seen.add(name)

  const match = source.match(new RegExp(`${escapeRegExp(name)}\\s*:\\s*([^;]+);`))
  assert.ok(match, `${name} token 缺失`)
  const raw = match[1].trim()
  const rpx = raw.match(/^(\d+(?:\.\d+)?)rpx$/)
  if (rpx) return Number(rpx[1])

  const alias = raw.match(/^var\((--[\w-]+)\)$/)
  assert.ok(alias, `${name} 必须是 rpx 值或单一 token alias，实际为 ${raw}`)
  return tokenValue(source, alias[1], seen)
}

function assertTokenMetric(source, record, field, suffix) {
  const token = `${record.tokenPrefix}-${suffix}`
  assert.equal(tokenValue(source, token), record[field], `${token} 与登记值 ${record[field]}rpx 漂移`)
}

function assertPairedRecord(source, id, record, { exception }) {
  assert.equal(record.kind, 'paired', `${id} 必须声明 paired 类型`)
  assert.equal(record.interactive, true, `${id} 圆框配对必须是独立交互目标`)
  assertTokenMetric(source, record, 'hitTarget', 'hit')
  assertTokenMetric(source, record, 'visibleCircle', 'circle')
  assertTokenMetric(source, record, 'glyph', 'glyph')
  assert.ok(record.hitTarget >= MIN_HIT_TARGET, `${id} hit target ${record.hitTarget}rpx 小于 88rpx 无障碍下限`)
  assert.ok(record.visibleCircle <= record.hitTarget, `${id} visible circle 不能大于 hit target`)
  assert.ok(record.glyph > 0 && record.glyph < record.visibleCircle, `${id} glyph 必须落在 visible circle 内`)

  const ratio = record.glyph / record.visibleCircle
  const withinRegularRange = ratio >= REGULAR_RATIO.min && ratio <= REGULAR_RATIO.max
  if (!exception) {
    assert.ok(withinRegularRange, `${id} glyph:circle=${ratio.toFixed(3)} 越界且未登记 exception`)
  } else if (!withinRegularRange) {
    assert.equal(record.allowRatioDeviation, true, `${id} 越界 exception 必须显式登记 allowRatioDeviation`)
  }
}

function assertExceptionRegistration(id, record) {
  assert.equal(record.decision, 'preserve', `${id} 必须记录用户 preserve 裁决`)
  assert.ok(typeof record.reason === 'string' && record.reason.length >= 8, `${id} 必须记录例外理由`)
  assert.ok(Array.isArray(record.sources) && record.sources.length >= 2, `${id} 必须同时登记源码与契约来源`)
  for (const source of record.sources) {
    const file = source.split(':')[0]
    assert.ok(fs.existsSync(path.join(XCX, file)), `${id} 登记了不存在的来源 ${file}`)
  }
}

function assertIconPairSpec(spec, tokens) {
  assert.deepEqual(spec.regularRatioRange, REGULAR_RATIO, '常规 glyph:circle 比例窗口必须固定为 40%–55%')

  for (const [id, record] of Object.entries(spec.pairs)) {
    assertPairedRecord(tokens, id, record, { exception: false })
  }

  for (const [id, record] of Object.entries(spec.exceptions)) {
    assertExceptionRegistration(id, record)
    if (record.kind === 'paired') {
      assertPairedRecord(tokens, id, record, { exception: true })
      continue
    }

    assert.equal(record.kind, 'glyph-only', `${id} 非圆框例外只能登记为 glyph-only`)
    assert.equal(record.interactive, false, `${id} glyph-only 不能伪造独立 hit target`)
    assert.equal(record.hitTarget, null, `${id} 的点击热区归交互 owner，不得填假值`)
    assert.equal(record.visibleCircle, null, `${id} 没有可见圆框，不得填假圆框`)
    assert.ok(record.visibleFrame >= MIN_HIT_TARGET, `${id} owner frame 不得小于 88rpx`)
    assert.ok(record.glyph > 0 && record.glyph < record.visibleFrame, `${id} glyph 必须落在 owner frame 内`)
    assert.ok(record.interactionOwner, `${id} 必须登记真正承接点击的 owner`)
    assertTokenMetric(tokens, record, 'visibleFrame', 'frame')
    assertTokenMetric(tokens, record, 'glyph', 'glyph')
  }
}

test('图标规格以语义配对而非独立绝对 size 档位约束 hit / visible circle / glyph', () => {
  assertIconPairSpec(SPEC, TOKENS)
  assert.deepEqual(Object.keys(SPEC.pairs).sort(), ['compact-floating', 'standard-icon-button'])
  assert.deepEqual(Object.keys(SPEC.exceptions).sort(), [
    'merchant-quick-action',
    'play-primary-action',
    'roam-history-walk',
    'searchmap-back',
  ])

  assert.deepEqual(
    Object.fromEntries(Object.entries(SPEC.exceptions).map(([id, value]) => [id, {
      hit: value.hitTarget,
      circle: value.visibleCircle,
      frame: value.visibleFrame || null,
      glyph: value.glyph,
    }])),
    {
      'play-primary-action': { hit: 124, circle: 124, frame: null, glyph: 61 },
      'merchant-quick-action': { hit: 120, circle: 120, frame: null, glyph: 44 },
      'searchmap-back': { hit: 88, circle: 64, frame: null, glyph: 32 },
      'roam-history-walk': { hit: null, circle: null, frame: 138, glyph: 61 },
    },
    '四条用户裁决例外必须原值登记，不能静默归一',
  )
})

test('负控：glyph 与圆框比例越界或 hit target 小于 88rpx 时门禁变红', () => {
  const oversizedGlyph = TOKENS.replace(
    /(--cy-comp-icon-pair-standard-glyph:\s*)40rpx;/,
    (_, prefix) => `${prefix}64rpx;`,
  )
  assert.notEqual(oversizedGlyph, TOKENS, '比例负控必须突变真实 token')
  const oversizedSpec = clone(SPEC)
  oversizedSpec.pairs['standard-icon-button'].glyph = 64
  assert.throws(() => assertIconPairSpec(oversizedSpec, oversizedGlyph), /glyph:circle=.*越界/)

  const undersizedHit = TOKENS.replace(
    /(--cy-comp-icon-pair-standard-hit:\s*)88rpx;/,
    (_, prefix) => `${prefix}80rpx;`,
  )
  assert.notEqual(undersizedHit, TOKENS, '热区负控必须突变真实 token')
  const undersizedSpec = clone(SPEC)
  undersizedSpec.pairs['standard-icon-button'].hitTarget = 80
  assert.throws(() => assertIconPairSpec(undersizedSpec, undersizedHit), /小于 88rpx/)
})

test('负控：越界值未登记必须红，登记完整的 exception 必须绿', () => {
  assert.doesNotThrow(() => assertIconPairSpec(SPEC, TOKENS))

  const unregistered = clone(SPEC)
  unregistered.pairs['merchant-quick-action'] = unregistered.exceptions['merchant-quick-action']
  delete unregistered.exceptions['merchant-quick-action']
  assert.throws(
    () => assertIconPairSpec(unregistered, TOKENS),
    /glyph:circle=.*越界且未登记 exception/,
  )
})

test('每枚 cy-icon 都有独立 optical scale/offset 元数据，play 保留相反重心证据', () => {
  const iconNames = Array.from(
    readXcx('components/cy/icon/icons.wxss').matchAll(/\.cyi--([\w-]+)\s*\{/g),
    (match) => match[1],
  ).sort()
  const metricNames = Object.keys(SPEC.optical.icons).sort()
  assert.deepEqual(metricNames, iconNames, 'icons.wxss 每个 glyph 必须恰有一条 optical 元数据')
  assert.equal(SPEC.optical.offsetUnit, 'percent-of-glyph-box')

  for (const [name, metric] of Object.entries(SPEC.optical.icons)) {
    assert.ok(Number.isFinite(metric.scale) && metric.scale > 0, `${name} optical scale 必须是正数`)
    assert.ok(Number.isFinite(metric.offset.x) && Number.isFinite(metric.offset.y), `${name} optical offset 必须完整`)
    assert.match(metric.review, /^(?:pending|bbox-audited)$/, `${name} optical review 状态不合法`)
  }

  const play = SPEC.optical.icons.play
  assert.ok(play.evidence.bboxCenter.x > 0, 'play bbox 中心必须保留右偏证据')
  assert.ok(play.evidence.areaCentroid.x < 0, 'play 面积重心必须保留左偏证据')
  assert.equal(play.offset.x, 0, '相反证据未完成视觉验收前不得统一 translate')
})

test('权威基准与 cy-icon 注释指向真实图标配对章节，不再声称 24/32/40/48 枚举', () => {
  const designSystem = readRepo('docs/城瘾小程序_设计系统权威基准_20260801.md')
  const iconJs = readXcx('components/cy/icon/index.js')

  assert.match(designSystem, /^### 4\.5 \[城\] 图标尺寸：glyph 与圆框配对/m)
  assert.match(designSystem, /searchmap[^\n]*64rpx[^\n]*88rpx/)
  assert.match(designSystem, /bbox[^\n]*面积重心[^\n]*方向相反/)
  assert.match(iconJs, /DS §4\.5/)
  assert.doesNotMatch(iconJs, /枚举\s*24\/32\/40\/48/)
})
