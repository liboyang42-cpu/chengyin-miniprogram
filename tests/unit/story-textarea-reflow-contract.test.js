'use strict'

// <textarea auto-height> 的首帧高度不是内容高,是微信组件自身的默认高。
// 2026-09-06 实测:一行文字首帧量到 136px,再渲染一次才收敛到 56px ——
// 用户看到的就是「打开一个已有文字的章节,每段文字下面空一大截」。
//
// ⚠️ CSS 改不动它(height:auto / min-height 都试过,首帧照样 136),只能在 JS 里补一帧。
//    所以这条契约钉的是**两个产生新 textarea 的入口都补了那一帧**:
//      · openStoryEditor —— 打开已有章节,所有文字块都是新建的
//      · insertStoryTextAt —— 新插一段文字
//    漏掉任何一个,那条路上的文字块就会以 2.4 倍高度显示,而且没有任何报错。

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const JS_PATH = path.resolve(__dirname, '../../pages/publish/fabu/index.js')

function methodBody(source, name) {
  const at = source.indexOf('\n  ' + name + '(')
  assert.ok(at >= 0, `找不到方法 ${name}`)
  const next = source.indexOf('\n  },', at)
  return source.slice(at, next)
}

function assertContract(source) {
  assert.match(source, /_reflowStoryTextareas\(chapterIndex\) \{/, '缺少 _reflowStoryTextareas 本体')
  assert.match(source, /wx\.nextTick\(/, '补帧必须落在 nextTick 上，同步再 setData 一次不会重新布局')
  for (const entry of ['openStoryEditor', 'insertStoryTextAt']) {
    assert.match(methodBody(source, entry), /_reflowStoryTextareas\(/,
      `${entry} 没有补那一帧：这条路上新建的 textarea 会以默认高显示`)
  }
}

test('两个会产生新 textarea 的入口都补了重排帧', () => {
  assertContract(fs.readFileSync(JS_PATH, 'utf8'))
})

test('负控：任一入口漏掉补帧必须判红', () => {
  const source = fs.readFileSync(JS_PATH, 'utf8')
  const broken = source.replace(
    '      // 新建的 textarea 首帧同样是默认高,补一次渲染(见 _reflowStoryTextareas)\n      this._reflowStoryTextareas(this.data.storyEditor.chapterIndex);\n', '')
  assert.notEqual(broken, source, '负控锚点失效')
  assert.throws(() => assertContract(broken), /insertStoryTextAt 没有补那一帧/)
})
