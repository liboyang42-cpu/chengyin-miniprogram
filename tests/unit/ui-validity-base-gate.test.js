'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { resolveBase } = require('../../scripts/ui-validity-gates')

test('U3/U4 缺少远端基线时 fail-closed 且绝不探测 HEAD^', () => {
  const calls = []
  const missingRefs = (_command, args) => {
    calls.push(args.join(' '))
    throw new Error('missing ref')
  }

  assert.throws(() => resolveBase('/tmp/shallow-clone', missingRefs), /无可用基线/)
  assert.equal(calls.some((call) => call.includes('HEAD^')), false)
  assert.deepEqual(calls, [
    'rev-parse --verify github/master^{commit}',
    'rev-parse --verify origin/master^{commit}',
  ])
})

test('U3/U4 只采用远端 ref 与 HEAD 的 merge-base', () => {
  const fakeGit = (_command, args) => {
    if (args[0] === 'rev-parse' && args[2] === 'github/master^{commit}') return Buffer.from('ok')
    if (args[0] === 'merge-base') return 'abc123\n'
    throw new Error('unexpected command')
  }

  assert.equal(resolveBase('/tmp/full-clone', fakeGit), 'abc123')
})
