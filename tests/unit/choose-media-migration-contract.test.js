/* wx.chooseMedia 迁移契约(2026-08-22)
 *
 * wx.chooseImage 已被官方标记废弃,基础库后续版本会失效。迁移时两个坑都是**静默的**
 * (不报错、不崩溃,只是行为不对),所以逻辑抽成纯函数并在这里真跑:
 *   ① 响应结构变了:tempFilePaths(字符串数组)→ tempFiles(对象数组,路径在 .tempFilePath);
 *      只改 API 名不改取值 ⇒ 选完图什么都没发生,而且不报错。
 *   ② 取消的 errMsg 前缀跟着变;只认旧前缀 ⇒ 用户点「取消」被弹成错误框。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const APP_JS = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8')
const { pickImagePaths, isChooseCancelled } = require('../../utils/choose-media.js')

test('已迁到 wx.chooseMedia,不再调用废弃的 wx.chooseImage', () => {
  assert.match(APP_JS, /wx\.chooseMedia\(/, '必须使用 wx.chooseMedia')
  assert.doesNotMatch(APP_JS, /wx\.chooseImage\(/, 'wx.chooseImage 已废弃,不得再调用')
  assert.match(APP_JS, /mediaType:\s*\['image'\]/, '必须限定 mediaType,否则用户能选出视频')
})

test('app.js 真的用了这两个适配函数(而不是各写一套)', () => {
  assert.match(APP_JS, /pickImagePaths\(res\)/, '取值必须走 pickImagePaths')
  assert.match(APP_JS, /isChooseCancelled\(res\.errMsg\)/, '取消判定必须走 isChooseCancelled')
})

test('取值:chooseMedia 的 tempFiles 结构能正确拿到路径', () => {
  assert.deepEqual(
    pickImagePaths({ tempFiles: [{ tempFilePath: '/a.png' }, { tempFilePath: '/b.png' }] }),
    ['/a.png', '/b.png'],
  )
})

test('取值:低版本回退到 tempFilePaths 旧结构时仍能拿到路径', () => {
  assert.deepEqual(pickImagePaths({ tempFilePaths: ['/old.png'] }), ['/old.png'])
})

test('取值:空/脏结果不炸,也不把 undefined 塞进上传', () => {
  assert.deepEqual(pickImagePaths({}), [])
  assert.deepEqual(pickImagePaths(undefined), [])
  assert.deepEqual(pickImagePaths({ tempFiles: [] }), [])
  assert.deepEqual(pickImagePaths({ tempFiles: [{}, null] }), [], '缺 tempFilePath 的条目要被滤掉')
  assert.deepEqual(pickImagePaths({ tempFiles: [{ tempFilePath: '/a.png' }, {}] }), ['/a.png'])
})

test('取消判定:新旧两种 errMsg 都算取消', () => {
  assert.equal(isChooseCancelled('chooseMedia:fail cancel'), true)
  assert.equal(isChooseCancelled('chooseImage:fail cancel'), true, '低版本回退时仍是旧前缀')
})

test('取消判定:真错误不能被当成取消吞掉', () => {
  for (const real of ['chooseMedia:fail auth deny', 'chooseMedia:fail system error', '', undefined, null]) {
    assert.equal(isChooseCancelled(real), false, `${String(real)} 是真错误/空值,不该被当成用户取消`)
  }
})

test('负控:只改 API 名不改取值,会静默丢掉所有图片', () => {
  const oldPick = (res) => res.tempFilePaths || []      // 迁移时最容易犯的错
  assert.deepEqual(oldPick({ tempFiles: [{ tempFilePath: '/a.png' }] }), [],
    '证明「只改名不改取值」确实会拿到空数组 —— 而且不报错,所以必须有这条测试')
  assert.deepEqual(pickImagePaths({ tempFiles: [{ tempFilePath: '/a.png' }] }), ['/a.png'])
})

test('负控:取消判定写成前缀宽松匹配会吞掉真错误', () => {
  const sloppy = (m) => /fail/.test(m || '')            // 常见的偷懒写法
  assert.equal(sloppy('chooseMedia:fail auth deny'), true, '证明宽松写法确实会把授权拒绝当成取消')
  assert.equal(isChooseCancelled('chooseMedia:fail auth deny'), false)
})
