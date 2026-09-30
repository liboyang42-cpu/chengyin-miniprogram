const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const SOURCE_ROOTS = [
  'components',
  'pages',
  'subpackageA',
  'subpackageB',
  'subpackageMember',
  'subpackageP3',
  'subpackageRoam',
]
const TEXT_ICON = /[›‹✕✓✔❯❮→←＋✚]|\p{Extended_Pictographic}/u
const STANDALONE_PLUS = />\s*\+\s*</u

function visibleWxml(source) {
  return source.replace(/<!--[\s\S]*?-->/g, '')
}

function collectWxml(dir, result = []) {
  if (!fs.existsSync(dir)) return result
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) collectWxml(absolute, result)
    else if (entry.isFile() && entry.name.endsWith('.wxml')) result.push(absolute)
  }
  return result
}

function assertUsesRealIcons(source, label) {
  const visible = visibleWxml(source)
  assert.doesNotMatch(visible, TEXT_ICON, `${label} 仍含字符或 emoji 伪图标`)
  assert.doesNotMatch(visible, STANDALONE_PLUS, `${label} 仍含独立文字 + 伪图标`)
}

test('全部生产 WXML 不再以字符、emoji 或独立文字 + 充当可见图标', () => {
  const files = SOURCE_ROOTS.flatMap((dir) => collectWxml(path.join(ROOT, dir)))
  assert.ok(files.length >= 200, '扫描分母异常，必须覆盖全部生产 WXML')
  for (const file of files) {
    assertUsesRealIcons(fs.readFileSync(file, 'utf8'), path.relative(ROOT, file))
  }
})

test('负控：文字箭头、emoji 与独立 + 均能让全局图标门禁变红', () => {
  for (const source of ['<view>›</view>', '<view>🧭</view>', '<view>+</view>']) {
    assert.throws(() => assertUsesRealIcons(source, 'mutation'), assert.AssertionError)
  }
})
