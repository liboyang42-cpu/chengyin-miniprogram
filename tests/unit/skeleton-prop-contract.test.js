const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const TARGETS = [
  'pages/activity/baoming/baoming.wxml',
  'pages/merchant/coop-center/index.wxml',
  'pages/merchant/profile/index.wxml',
  'subpackageA/pages/myproject/index.wxml',
]
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function assertSkeletonUsesCount(source, file) {
  const skel = source.match(/<cy-skeleton[\s\S]*?\/>/g)
  assert.ok(skel && skel.length > 0, `${file} must contain cy-skeleton tags`)
  for (const tag of skel) {
    assert.match(tag, /\bcount\s*=\s*"/, `${file} cy-skeleton must use count prop, got: ${tag}`)
    if (/items\s*=\s*"/.test(tag)) {
      assert.fail(`${file} cy-skeleton must not use unsupported items prop, got: ${tag}`)
    }
  }
}

test('all skeleton usages use declared count prop, not unsupported items', () => {
  for (const file of TARGETS) {
    assertSkeletonUsesCount(read(file), file)
  }
})

test('negative control: replacing count with items is rejected', () => {
  const file = TARGETS[0]
  const source = read(file)
  const mutated = source.replace('count="{{skeletonItems.length}}"', 'items="{{skeletonItems}}"')
  assert.throws(() => { assertSkeletonUsesCount(mutated, file) })
})

test('negative control: dropping the count prop from skeleton is rejected', () => {
  const file = TARGETS[0]
  const source = read(file)
  const mutated = source.replace(' count="{{skeletonItems.length}}"', '')
  assert.throws(() => { assertSkeletonUsesCount(mutated, file) })
})
