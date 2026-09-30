const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const OWNED_ROOTS = [
  'pages/square',
  'pages/activity',
  'pages/index',
  'pages/search2',
  'pages/searchmap',
  'pages/talent',
  'pages/template',
  'pages/userinfo',
  'pages/address',
  'subpackageMember',
  'subpackageA/pages/myproject',
  'subpackageB',
  'components/cy',
  'utils',
]
const EXCLUDED_PREFIXES = [
  'subpackageMember/tixian/',
  'components/cy/profile/',
  'components/cy/date-sheet/',
  'components/cy/scene-merchant-profit/',
  'components/cy/scene-club-edit/',
  'components/cy/empty/',
  'components/cy/error/',
]
const EXCLUDED_FILES = new Set([
  'pages/square/list/index.wxml',
  'subpackageMember/components/scene-member-participation-detail/index.wxml',
  'components/cy/scene-play-activity-detail/index.wxml',
])
const HALF_WIDTH_PUNCTUATION_NEAR_HAN = /(?:\p{Script=Han}\s*[,():]|[,():]\s*\p{Script=Han})/gu

function walkWxml(relativePath, files) {
  const absolutePath = path.join(ROOT, relativePath)
  const entry = fs.statSync(absolutePath)
  if (entry.isDirectory()) {
    fs.readdirSync(absolutePath).forEach((name) => walkWxml(path.join(relativePath, name), files))
    return
  }
  if (!relativePath.endsWith('.wxml')) return
  if (EXCLUDED_FILES.has(relativePath)) return
  if (EXCLUDED_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) return
  files.push({ relativePath, source: fs.readFileSync(absolutePath, 'utf8') })
}

function ownedWxmlFiles() {
  const files = []
  OWNED_ROOTS.forEach((relativePath) => walkWxml(relativePath, files))
  return files
}

function withoutComments(source) {
  return source.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '))
}

function halfWidthPunctuationViolations(files) {
  const violations = []
  files.forEach(({ relativePath, source }) => {
    const visibleSource = withoutComments(source)
    for (const match of visibleSource.matchAll(HALF_WIDTH_PUNCTUATION_NEAR_HAN)) {
      const line = visibleSource.slice(0, match.index).split('\n').length
      violations.push(`${relativePath}:${line} ${match[0].trim()}`)
    }
  })
  return violations
}

function stateConsumerViolations(files) {
  const violations = []
  files.forEach(({ relativePath, source }) => {
    const visibleSource = withoutComments(source)
    for (const match of visibleSource.matchAll(/(?:^|\s)(?:retry|cta)="(点击重试|重新加载|重新读取|重新载入)"/g)) {
      const line = visibleSource.slice(0, match.index).split('\n').length
      violations.push(`${relativePath}:${line} 重试动作仍为“${match[1]}”`)
    }
    for (const match of visibleSource.matchAll(/<(?:button|view)\b[^>]*\bbindtap="[^"]+"[^>]*>\s*(点击重试|重新加载|重新读取|重新载入)\s*<\//g)) {
      const line = visibleSource.slice(0, match.index).split('\n').length
      violations.push(`${relativePath}:${line} 重试动作仍为“${match[1]}”`)
    }
    for (const match of visibleSource.matchAll(/<cy-error\b[^>]*\bicon="\/images\/no_data\.svg"[^>]*>/g)) {
      const line = visibleSource.slice(0, match.index).split('\n').length
      violations.push(`${relativePath}:${line} 错误态仍覆盖为空态插画`)
    }
  })
  return violations
}

test('负责范围内的 WXML 中文文案不使用半角逗号、冒号或括号', () => {
  const violations = halfWidthPunctuationViolations(ownedWxmlFiles())
  assert.deepEqual(violations, [], `发现半角中文标点：\n${violations.join('\n')}`)
})

test('negative control: 中文文案塞入半角逗号时扫描器必须判红', () => {
  const violations = halfWidthPunctuationViolations([
    { relativePath: 'fixture.wxml', source: '<text>中文,文案</text>' },
  ])
  assert.deepEqual(violations, ['fixture.wxml:1 文,'])
})

test('负责范围内的重试动作统一为“重试”，错误态不再覆盖为空态插画', () => {
  const violations = stateConsumerViolations(ownedWxmlFiles())
  assert.deepEqual(violations, [], `发现状态消费遗留：\n${violations.join('\n')}`)
})

test('聊天失败提示与页面重试按钮使用同一文案', () => {
  const source = fs.readFileSync(path.join(ROOT, 'subpackageB/pages/im/chat/index.js'), 'utf8')
  assert.match(source, /error: '消息没加载出来，点上方「重试」再试'/)
  assert.doesNotMatch(source, /点上方「重新加载」/)
})

test('地图只在列表显示的活动不再使用“未标注”开发术语', () => {
  const source = fs.readFileSync(path.join(ROOT, 'pages/searchmap/index.wxml'), 'utf8')
  assert.doesNotMatch(source, /未标注|无坐标/)
  assert.match(source, /个活动只在列表显示/)
})
