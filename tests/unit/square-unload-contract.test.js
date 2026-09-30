const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const SRC = 'pages/square/list/index.js'
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function assertSingleUnload(source) {
  const matches = source.match(/onUnload\s*[:(]/g)
  assert.ok(matches, `${SRC} must define onUnload`)
  assert.equal(matches.length, 1, `${SRC} must define exactly one onUnload, got ${matches.length}`)
  const block = source.match(/onUnload\s*\([\s\S]*?\n\s*\},/)
  assert.ok(block, `${SRC} onUnload block not found`)
  assert.ok(/scrollStopTimer/.test(block[0]), `${SRC} onUnload must clear scrollStopTimer`)
  assert.ok(/merchantPageRestore/.test(block[0]), `${SRC} onUnload must call merchantPageRestore`)
}

test('square/list onUnload merges timer cleanup and theme restore into a single hook', () => {
  const source = read(SRC)
  assertSingleUnload(source)
})

test('negative control: a second onUnload fragment is rejected', () => {
  const source = read(SRC)
  const mutated = source + '\n,\n  onUnload() {}\n'
  assert.throws(() => { assertSingleUnload(mutated) })
})

test('negative control: removing merchantPageRestore from onUnload is rejected', () => {
  const source = read(SRC)
  const mutated = source.replace('merchantTheme.merchantPageRestore();', '')
  assert.throws(() => { assertSingleUnload(mutated) })
})
