const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const WXML = path.join(ROOT, 'pages/play/index.wxml')

/**
 * 2026-08-28 全量审核抓到的 P0:通关面板整个被吞进「本局结局」条件里。
 *
 * `<view class="finsheet__game-ending" wx:if="{{gameModule.story.ending}}">` 少了一个
 * `</view>`,于是里程碑、路线图、成绩、照片、失败重试、下一程、继续、同行榜、分享、
 * 保存足迹卡**全部**成了它的后代。而 `gameModule.story.ending` 默认是 null
 * (pages/play/index.js:274),`openFinish()` 也不会给普通经典/自由探索伪造结局 ——
 * 结果:正常通关时这一屏只剩「主题通关 / 章节名 / 已通关」三行标题,
 * 所有正文和所有出口都不渲染。**核心完成链完全不可用,且零报错。**
 *
 * 这类缺陷靠读 diff 和跑逻辑单测都抓不到:JS 全对,坏的是 WXML 的标签配对,
 * 编译器也不报错(WXML 允许隐式闭合)。所以这里做结构测:配对算出
 * finsheet__game-ending 的真实闭合位置,断言那些出口不在它的作用域里。
 */
function endingBlockRange(source) {
  const lines = source.split('\n')
  const openIndex = lines.findIndex(line => line.includes('class="finsheet__game-ending"'))
  assert.notEqual(openIndex, -1, '找不到 finsheet__game-ending 起始标签,选择器可能被改名了')

  // 自闭合的 <view ... /> 不增加深度
  const openCount = line => (line.match(/<view\b(?![^>]*\/>)/g) || []).length
  let depth = 0
  for (let i = openIndex; i < lines.length; i += 1) {
    depth += openCount(lines[i]) - (lines[i].match(/<\/view>/g) || []).length
    if (depth <= 0 && i > openIndex) return { openIndex, closeIndex: i, lines }
  }
  assert.fail('finsheet__game-ending 在文件结束前没有闭合')
}

test('通关面板的正文与出口不能落在「本局结局」的 wx:if 作用域里', () => {
  const source = fs.readFileSync(WXML, 'utf8')
  const { openIndex, closeIndex, lines } = endingBlockRange(source)
  const inside = lines.slice(openIndex, closeIndex + 1).join('\n')

  // 结局块自己该有的三行留在里面
  assert.ok(inside.includes('finsheet__game-ending-title'), '结局标题应当仍在结局块内')

  // 这些是「不管有没有游戏结局都必须出现」的正文与出口
  const mustBeOutside = [
    ['finish-milestone', '城市探索里程碑'],
    ['finsheet__map', '通关路线图'],
    ['saveFinishCard', '保存足迹卡'],
    ['shareFinish', '分享足迹'],
    ['openBoard', '同行者榜'],
  ]
  for (const [needle, label] of mustBeOutside) {
    assert.ok(
      !inside.includes(needle),
      `${label}(${needle})被包进了 finsheet__game-ending 的 wx:if —— ` +
      `gameModule.story.ending 默认为 null,普通通关时它整块不渲染,` +
      `这一屏会只剩标题壳。检查第 ${openIndex + 1} 行那个 view 的 </view> 是不是漏了。`
    )
    assert.ok(source.includes(needle), `${label}(${needle})在整份 WXML 里都不见了`)
  }
})
