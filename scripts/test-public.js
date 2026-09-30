'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const excluded = require('../tests/public-test-scope.json')
const all = fs.readdirSync(path.join(root, 'tests/unit'), { recursive: true })
  .filter(name => name.endsWith('.test.js'))
  .map(name => 'tests/unit/' + name.replaceAll(path.sep, '/'))
  .sort()
for (const [name, reason] of Object.entries(excluded)) {
  assert.ok(all.includes(name), 'Stale exclusion: ' + name)
  assert.ok(reason, 'Missing exclusion reason: ' + name)
}
const selected = all.filter(name => !Object.hasOwn(excluded, name))
assert.ok(selected.length > 0, 'No public tests selected')
console.log(`Public client tests: ${selected.length}; private-monorepo/device tests excluded: ${Object.keys(excluded).length}`)
for (const [name, reason] of Object.entries(excluded)) console.log(`EXCLUDED ${name}: ${reason}`)
const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...selected], {
  cwd: root,
  stdio: 'inherit',
})
if (result.error) throw result.error
process.exit(result.status == null ? 1 : result.status)
