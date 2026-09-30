const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

test('merchant decor load has a bounded loading watchdog and clears it on completion', () => {
  const source = read('pages/merchant/decor/index.js')
  assert.match(source, /this\._loadWatchdog\s*=\s*setTimeout/)
  assert.match(source, /that\.data\.loadState\s*!==\s*'loading'/)
  assert.match(source, /loadState:\s*'error'/)
  assert.match(source, /clearTimeout\(that\._loadWatchdog\)/)
})

test('negative control: removing the watchdog is rejected', () => {
  const source = read('pages/merchant/decor/index.js').replace(/\n\s*this\._loadWatchdog\s*=\s*setTimeout\([\s\S]*?\n\s*\}, 8000\);/, '')
  assert.throws(() => assert.match(source, /this\._loadWatchdog\s*=\s*setTimeout/))
})
