// 出示游戏码 · T1 底部弹层(Figma s7SEFaoJ3GQUIxJhdqcFUb / 335:1275)
//
// 这张稿相比原来的全屏凭证只多一件事,但那件事就是它存在的理由:
// **有些玩法要把码打印出来贴在站点上**,现场靠纸质码核销。所以底部那个
// download 图标不是分享装饰,少了它这一页就不成立。
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const C = 'pages/club/components/club-game-code-sheet'

test('走 T1 底部弹层的壳,不是自绘', () => {
  const wxml = read(`${C}/index.wxml`)
  assert.match(wxml, /<cy-scene-sheet[^>]*variant="half"/, '稿是 T1 底部弹层(half)')
  assert.match(wxml, /closable/, 'T1 顶部要有圆形 ✕')
  const json = JSON.parse(read(`${C}/index.json`))
  // 钉的是「壳复用 cy-scene-sheet」这件事,不是那条路径长什么样 ——
  // 2026-09-04 本组件下沉到 pages/club 分包后,指向主包 DS 组件只能写绝对路径,
  // 原来写死 '../scene-sheet/index' 的断言当场失配。组件身份没变,写法变了。
  assert.match(json.usingComponents['cy-scene-sheet'], /(^|\/)scene-sheet\/index$/)
})

test('保存入口必须在,且只在真有码时才给', () => {
  const wxml = read(`${C}/index.wxml`)
  const save = /<view[^>]*class="cgcs__save"[\s\S]*?<\/view>/.exec(wxml)
  assert.ok(save, '缺保存入口 —— 打印不出来,这一页就没意义了')
  assert.match(save[0], /wx:if="\{\{state === 'ready' && qr\}\}"/,
    '没码时也给保存,存下来是张空白图')
  assert.match(save[0], /<cy-icon[^>]*name="download"/, '按稿 335:1347 用 download 图标')
  assert.match(read('components/cy/icon/icons.wxss'), /\.cyi--download\b/,
    'download 图标不在图标库里,绑了也是空的')
})

test('二维码底恒为浅色 —— 深色底扫不出来', () => {
  const wxss = read(`${C}/index.wxss`)
  const rule = /\.cgcs__qr\s*\{([^}]*)\}/.exec(wxss)
  assert.ok(rule, '.cgcs__qr 规则不见了')
  assert.match(rule[1], /background:\s*#F8F8F8/i, '扫码底必须是浅色实色,不能跟着暗色主题走')
})

test('保存失败三种原因分开说,不许一句「保存失败」糊过去', () => {
  const js = read(`${C}/index.js`)
  assert.match(js, /auth deny|authorize/, '拒过授权要引导去设置,再调 authorize 不会弹窗')
  assert.match(js, /openSetting/, '缺去设置的入口')
  assert.match(js, /downloadFile/, '缺下载失败分支')
  assert.match(js, /indexOf\('cancel'\)/, '用户自己取消不该当成错误打扰他')
})

test('负控:把保存入口拿掉,门禁必须判红', () => {
  const wxml = read(`${C}/index.wxml`)
  const mutated = wxml.replace(/<view[^>]*class="cgcs__save"[\s\S]*?<\/view>/, '')
  assert.notEqual(mutated, wxml, '变异没生效:锚点已漂移,这个负控在空转')
  assert.equal(/class="cgcs__save"/.test(mutated), false, '判据认不出保存入口被删')
})

// CU-C-148:错误态原来复用那张 518×516 的码格(死尺寸),没码时整块空白把半屏撑成接近满屏,
// 正文「…请稍后重试」被挤到码格窄栏里在「重/试」中间硬折行。现在错误态自成一块按内容高的说明。
function assertErrorIsCompact(wxml, wxss) {
  const qr = /<view\b[^>]*class="cgcs__qr[^"]*"[^>]*>/.exec(wxml)
  assert.ok(qr, '.cgcs__qr 容器不见了')
  assert.match(qr[0], /wx:if="\{\{state !== 'error'\}\}"/,
    '错误态还在渲染 518×516 码格 —— 那正是走查里那一大块空白')
  assert.match(wxml, /class="cgcs__error"/, '错误态要有自己的紧凑块')
  const errBox = /\.cgcs__error\s*\{([^}]*)\}/.exec(wxss)
  assert.ok(errBox, '.cgcs__error 规则不见了')
  assert.doesNotMatch(errBox[1], /height:\s*\d+rpx/, '错误块不得再钉死高度,高要跟着文案走')
  const errText = /\.cgcs__error-text\s*\{([^}]*)\}/.exec(wxss)
  assert.ok(errText, '.cgcs__error-text 规则不见了')
  assert.doesNotMatch(errText[1], /white-space:\s*nowrap/, '错误文案要能自然换行,不许 nowrap 顶穿')
  const retry = /class="cgcs__retry"[^>]*>([^<]*)</.exec(wxml)
  assert.ok(retry && retry[1].trim() === '重试', '「重试」要独占一个热区,不再和正文挤在同一窄栏里折行')
}

test('CU-C-148 错误态缩成按内容高的说明块,不复用死码格', () => {
  assertErrorIsCompact(read(`${C}/index.wxml`), read(`${C}/index.wxss`))
})

test('负控:CU-C-148 把错误态塞回 518×516 死码格必须判红', () => {
  const wxml = read(`${C}/index.wxml`)
  const mutated = wxml.replace(/<view wx:if="\{\{state !== 'error'\}\}" class="cgcs__qr/, '<view class="cgcs__qr')
  assert.notEqual(mutated, wxml, '变异没生效:.cgcs__qr 的 state 闸门锚点漂移')
  assert.throws(
    () => assertErrorIsCompact(mutated, read(`${C}/index.wxss`)),
    /518×516|码格/,
    '错误态退回死码格时契约必须判红',
  )
})
