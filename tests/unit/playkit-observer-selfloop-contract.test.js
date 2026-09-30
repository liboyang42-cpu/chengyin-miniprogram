/* 自触发 observer 门禁(2026-09-10)
 *
 * 这个形状我在一轮里踩了**三次**:问答、猜图/扫码、掷骰子。
 * 症状一模一样,而且极难认:observer 监听某个键,函数体里(或它调的方法里)又 setData 那个键,
 * 于是自己触发自己 —— 死循环把小程序运行时打挂。
 *
 * ⚠️ 最坏的地方是它**一条错都不报**:控制台干净、单测全绿,只有真机/模拟器上
 * 「第一屏好好的,第二屏起全部超时」。我第一次是花了一轮排查环境才找到它。
 *
 * 两条都要扫:
 *   · 直接 —— observer 里 setData({ 被监听的键: … })
 *   · 间接 —— observer 调了本组件的 _方法,那个方法里 setData 了被监听的键
 * 只扫直接的话,掷骰子那次(observer → _place() → setData({diceCount})）就漏了。
 */
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const DIR = path.join(ROOT, 'pages/play/components')

/** 只认「对象字面量里的键」:前面必须是 { 或 ,。
 *  ⚠️ 别用裸 `键\s*:` —— `left: (seconds > 0 ? seconds : 0)` 里那个三元会被当成写键,
 *  实测误报三处,而假阳性比漏检更费时间。 */
const keyWritten = (src, key) =>
  new RegExp('[{,]\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:').test(src)

function shells() {
  return fs.readdirSync(DIR).filter((n) => /^(playkit|play)-/.test(n)).sort()
}

function offenders() {
  const bad = []
  for (const name of shells()) {
    const file = path.join(DIR, name, 'index.js')
    if (!fs.existsSync(file)) continue
    const src = fs.readFileSync(file, 'utf8')
    const block = /observers:\s*\{([\s\S]*?)\n {2}\},/.exec(src)
    if (!block) continue
    const body = block[1]
    for (const om of body.matchAll(/'([^']+)':\s*function/g)) {
      const watched = om[1].split(',').map((k) => k.trim().split('.')[0])
      let seg = body.slice(om.index + om[0].length)
      const next = /\n {4}'[^']+':\s*function/.exec(seg)
      if (next) seg = seg.slice(0, next.index)
      for (const w of new Set(watched)) {
        // 直接写
        for (const sd of seg.matchAll(/setData\(/g)) {
          if (keyWritten(seg.slice(sd.index, sd.index + 800), w)) {
            bad.push(name + ' → observer 监听 ' + w + ',函数体里又 setData ' + w)
            break
          }
        }
        // 间接:调了本组件的 _方法,那个方法写了它
        for (const call of seg.matchAll(/this\.(_[A-Za-z]\w*)\(/g)) {
          const fn = call[1]
          const fm = new RegExp('\\n {4}' + fn + '\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n {4}\\},').exec(src)
          if (fm && keyWritten(fm[1], w)) {
            bad.push(name + ' → observer 监听 ' + w + ',而 ' + fn + '() 里写了 ' + w)
          }
        }
      }
    }
  }
  return [...new Set(bad)]
}

test('★没有玩法壳存在自触发 observer', () => {
  assert.ok(shells().length >= 15, '只扫到 ' + shells().length + ' 个壳,扫描器多半坏了')
  assert.deepEqual(offenders(), [],
    '这些 observer 会自己触发自己 —— 死循环打挂运行时,而且一条错都不报:\n  '
    + offenders().join('\n  '))
})

test('★负控:构造一个直接自触发,必须抓得到', () => {
  const src = [
    'Component({',
    '  observers: {',
    "    'foo': function (foo) {",
    '      this.setData({ foo: foo + 1 });',
    '    },',
    '  },',
    '});',
  ].join('\n')
  const block = /observers:\s*\{([\s\S]*?)\n {2}\},/.exec(src)
  assert.ok(block, '负控样本自己要能被解析')
  assert.equal(keyWritten(block[1], 'foo'), true, '直接自触发必须被认出来')
})

test('★负控:三元里的同名标识符不算写键(这条曾误报三处)', () => {
  const seg = 'this.setData({ left: (seconds > 0 ? seconds : 0) });'
  assert.equal(keyWritten(seg, 'seconds'), false,
    '`? seconds : 0` 里的 seconds 是取值不是写键 —— 认成写键会让门禁天天喊狼来了')
  assert.equal(keyWritten(seg, 'left'), true, '真正的键还是要认出来')
})
