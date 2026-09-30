const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { PRESETS, LEGACY_ALIAS, normalizeAtmosphere, atmosphereClass } = require('../../utils/chapter-atmosphere.js')

test('章节配色只有五个受控预设（2026-09-06 换成黑蓝红黄白纯色），未知值回退默认', () => {
  assert.deepEqual(PRESETS.map((item) => item.value), ['DEFAULT', 'BLUE', 'RED', 'YELLOW', 'WHITE'])
  assert.deepEqual(PRESETS.map((item) => item.label), ['黑', '蓝', '红', '黄', '白'])
  assert.equal(normalizeAtmosphere('blue'), 'BLUE')
  assert.equal(normalizeAtmosphere('#ff00aa'), 'DEFAULT')
  assert.equal(atmosphereClass('WHITE'), 'atmosphere--white')
})

// ★ 换取值域时最容易出事的不是新值,是**老数据**:库里存着 NIGHT/ARCHIVE/MOSS/NEON。
//   别名表一旦漏掉某个,那些章节会静默变成默认黑 —— 作者选过的颜色没了,而且零报错。
test('存量四档必须落到最接近的新档，不能整片塌回默认', () => {
  assert.equal(normalizeAtmosphere('NIGHT'), 'BLUE')
  assert.equal(normalizeAtmosphere('ARCHIVE'), 'YELLOW')
  assert.equal(normalizeAtmosphere('NEON'), 'RED')
  // 苔野没有对应色,落回默认是有意的(见 utils/chapter-atmosphere.js 的说明)
  assert.equal(normalizeAtmosphere('MOSS'), 'DEFAULT')
  assert.deepEqual(Object.keys(LEGACY_ALIAS).sort(), ['ARCHIVE', 'MOSS', 'NEON', 'NIGHT'])
})

// 前后端各有一份别名表,不一致会让同一条数据在发布器与玩家端显示成两个颜色。
test('前后端别名表必须逐条一致', () => {
  const java = fs.readFileSync(path.resolve(__dirname,
    '../../../chengyinhub-system/src/main/java/com/chengyinhub/business/util/ChapterAtmospherePreset.java'), 'utf8')
  for (const [legacy, target] of Object.entries(LEGACY_ALIAS)) {
    const expected = target === 'DEFAULT' ? 'DEFAULT' : `"${target}"`
    assert.match(java, new RegExp(`alias\\.put\\("${legacy}",\\s*${expected.replace(/"/g, '"')}\\)`),
      `后端别名表缺 ${legacy} → ${target}`)
  }
  for (const value of PRESETS.map((p) => p.value)) {
    if (value === 'DEFAULT') continue
    assert.match(java, new RegExp(`"${value}"`), `后端取值域缺 ${value}`)
  }
})

test('编辑器写章节字段，玩家剧情和谜题层消费同一个预设', () => {
  const editor = fs.readFileSync(path.resolve(__dirname, '../../pages/publish/fabu/index.wxml'), 'utf8')
  const play = fs.readFileSync(path.resolve(__dirname, '../../pages/play/index.wxml'), 'utf8')

  assert.match(editor, /chapterForm\.atmospherePreset/)
  assert.match(play, /chapter\.atmosphereClass/)
  assert.ok((play.match(/chapter\.atmosphereClass/g) || []).length >= 2)
})
