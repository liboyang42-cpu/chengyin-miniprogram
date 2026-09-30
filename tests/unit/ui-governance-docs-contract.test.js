'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('F09 UI 规范、页面框架和全量复查方法都有仓内真源', () => {
  const design = read('docs/DESIGN.md')
  const chrome = read('docs/chrome-spec.md')
  const audit = read('docs/UI全量复查方法.md')

  assert.match(design, /style\/tokens\.wxss/)
  assert.match(design, /服务端、接口、回执/)
  assert.match(chrome, /cy-nav-bar/)
  assert.match(chrome, /cy-page-title/)
  assert.match(audit, /296 状态矩阵/)
  assert.match(audit, /textIncludes/)
  assert.match(audit, /unverified/)
})
