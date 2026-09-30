// 这份哨兵不再测 1+1：它盘点 test:unit 的真实 glob 与关键文件集合。
// CI 还会在 node --test 之外直接运行同一个 manifest，避免本文件自己都没被发现时假绿。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  SENTINELS,
  assertUnitManifest,
  currentManifest,
} = require('../../../ci/xcx-unit-manifest')

test('test:unit glob 发现完整文件基线与关键哨兵', () => {
  assertUnitManifest(currentManifest())
})

test('negative control: 临时移除关键哨兵必须判红', () => {
  const manifest = currentManifest()
  const files = manifest.files.filter((file) => file !== SENTINELS[0])
  assert.throws(() => assertUnitManifest({ ...manifest, files }), {
    name: 'AssertionError',
    message: /小程序 unit glob\/文件集合发生漂移/,
  })
})
