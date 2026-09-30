/* 玩法屏与原型的保真契约(2026-09-10)
 *
 * 「一模一样」这件事不能靠并排看图判断 —— 看图会漏,而且下一个人改坏了没人知道。
 * 这份把**原型里实测出来的值**写成断言,钉在小程序的 wxss 上。
 *
 * 值的来源:交互原型 playkit.html 的对应 CSS 块,以及在浏览器里对着渲染结果
 * 读回来的 computed style。原型是 375px 画布,小程序 1px = 2rpx。
 *
 * ⚠️ 不是「颜色写死不许改」:要改先改原型,再改这里。
 * 这条契约防的是**单方面漂移** —— 小程序悄悄改一个值,两边就再也对不上了。
 */
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const DIR = path.join(ROOT, 'pages/play/components')
const readC = (name, ext) => fs.readFileSync(
  path.join(ROOT, 'pages/play/components', name, 'index.' + ext), 'utf8')
const wxss = (n) => readC(n, 'wxss')
/* hex 的大小写没有含义,只对**颜色**做不区分大小写的比对。
   ⚠️ 别图省事把整份文件 toLowerCase 再比:translateY / rotateX / scaleY 这些
   大小写敏感的函数名会被一起压平,于是「查位移」的断言全线假红 —— 踩过一次。 */
const hasHex = (src, hex) => src.toLowerCase().includes(hex.toLowerCase())
const wxml = (n) => readC(n, 'wxml')
const js = (n) => readC(n, 'js')

test('共享玩法组件的 WXSS import 必须指向真实文件，否则整个试玩包无法编译', () => {
  for (const name of fs.readdirSync(DIR)) {
    const file = path.join(DIR, name, 'index.wxss')
    if (!fs.existsSync(file)) continue
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/@import\s+["']([^"']+)["']/g)) {
      const target = match[1].startsWith('/')
        ? path.join(ROOT, match[1]) : path.resolve(path.dirname(file), match[1])
      assert.ok(fs.existsSync(target), name + ': ' + match[1])
    }
  }
})

test('皮肤表逐字对应原型 .phone[data-skin=…]', () => {
  const s = fs.readFileSync(path.join(ROOT, 'pages/play/style/play-surface.wxss'), 'utf8')
  const WANT = {
    'skin-estimate': ['#fcfcfc', '#111114', '#6c6c6c', '#e7e7e7', '#fc3f3f', '#12a06f'],
    'skin-guess':    ['#0e0e0e', '#f0ece5', '#8a857d', '#1b1b1a', '#e4ddd2', '#3ecf8e'],
    'skin-hidden':   ['#0d0d10', '#f8f8f8', '#919199', '#1c1c1e', '#12b886', '#12b886'],
    'skin-predict':  ['#08080a', '#f4f4f6', '#78787f', '#141418', '#ffffff', '#ffffff'],
    'skin-bingo':    ['#cfe2f5', '#111114', '#4d6076', '#b7d2ec', '#fc7ebd', '#3fd2d2'],
    'skin-draw':     ['#e7e7e7', '#111114', '#5a5f66', '#d6d6d6', '#00bdfc', '#00bdfc'],
    'skin-qa':       ['#fcfcfc', '#111114', '#6c6c6c', '#ececec', '#fc3f3f', '#12a06f'],
    'skin-qadark':   ['#0d0d10', '#f6f6f8', '#8a8a92', '#1b1b20', '#ff6b6b', '#3ecf8e'],
    'skin-branch':   ['#12100e', '#f2efe9', '#8b857a', '#211e1a', '#d8a05a', '#d8a05a'],
  }
  for (const [cls, vals] of Object.entries(WANT)) {
    const line = s.split('\n').find((l) => l.trim().startsWith('.' + cls))
    assert.ok(line, cls + ' 这一档皮肤没了')
    for (const v of vals) assert.ok(hasHex(line, v), cls + ' 少了 ' + v + ' —— 与原型漂开了')
  }
})

test('★变色就点的三档信号色照抄 Human Benchmark 那套约定', () => {
  const s = wxss('playkit-reaction')
  assert.ok(hasHex(s, '#c5372f'), '等待期必须是红 —— 上一版用深蓝灰,那个颜色不说话')
  assert.ok(hasHex(s, '#22c55e'), '变绿那档是 #22c55e,不是随便一个绿')
  assert.ok(hasHex(s, '#1b1b22'), '抢跑单独一态')
  assert.ok(hasHex(s, '#0f172a'), '判完那档')
})

test('九宫格是有厚度的棋子:黑白相间 + 实心侧壁 + 点亮按下去', () => {
  const s = wxss('playkit-bingo')
  assert.ok(/0 8rpx 0 #000/.test(s), '厚度靠实心投影当侧壁,不是柔影')
  assert.ok(hasHex(s, '#ffffff') && hasHex(s, '#111114'), '黑白相间')
  assert.ok(hasHex(s, '#3fd2d2'), '点亮是青')
  assert.ok(hasHex(s, '#fc7ebd'), '连成线转粉')
  assert.ok(/\.bg__cell\.done[\s\S]{0,200}translateY\(6rpx\)/.test(s), '点亮的格子要被按下去')
})

test('抽卡是一副牌摊成扇形,不是一张孤零零的卡', () => {
  const s = wxss('playkit-random')
  assert.ok(hasHex(s, '#0b6adc'), '底是蓝的')
  assert.ok(hasHex(s, '#e6e3e4'), '卡是纸色')
  for (const t of ['rotate(-2.2deg)', 'rotate(2deg)', 'rotate(5.5deg)']) {
    assert.ok(s.includes(t), '扇形的倾角丢了:' + t)
  }
  assert.ok(s.includes('dk-fold'), '甩出去那一下没了')
})

test('★硬币是银的、绕横轴翻、边上有滚花', () => {
  const s = wxss('playkit-coinflip')
  assert.ok(s.includes('conic-gradient'), '滚花靠 conic 明暗交替,一条 radial 看着像塑料')
  assert.ok(/rotateX\(180deg\)/.test(s), '绕横轴翻 —— 绕竖轴那是转陀螺')
  assert.ok(hasHex(s, '#000'), '底必须黑,不然高光读不出来')
  const j = js('playkit-coinflip')
  /* 2026-09-11:侧壁那六十片薄条已删。小程序会把这一层的 3D 压平,六十片摊成一条
     横穿屏幕的虚线(用户截图里问的就是它)。滚花现在只在两个面自己的 SVG 里 ——
     faces.js 的 common() 用两圈 dash 描边画齿,所以判据换成它,坏掉照样红。 */
  assert.ok(!/cf__slice/.test(s), '侧壁薄条不能回来:这一层 3D 在小程序里会被压平成一条横线')
  const f = fs.readFileSync(path.join(DIR, 'playkit-coinflip/faces.js'), 'utf8')
  assert.ok(/ring\(80\.5/.test(f) && /ring\(69/.test(f), '面上的两圈滚花齿丢了,硬币会读成塑料片')
  // 动画时长两边必须一致,否则「转完了」和「显示结果」错开
  assert.equal((j.match(/const SPIN_MS = (\d+)/) || [])[1], '2200')
  assert.ok(s.includes('2.2s'), 'CSS 那条过渡也必须是 2.2s')
})

test('★问答的选项是几条细横线,不是卡片', () => {
  const s = wxss('playkit-qa')
  assert.ok(/\.qa__opt \{[\s\S]{0,400}?border-bottom: 2rpx solid var\(--soft\)/.test(s),
    '选项是一条细横线')
  assert.equal(/\.qa__opt \{[\s\S]{0,400}?border-radius/.test(s), false,
    '选项不许有圆角 —— 有了就变成卡片,而选项不是东西,是一行字')
  assert.ok(/\.qa__input \{[\s\S]{0,400}?background: transparent/.test(s),
    '答案框不能是灰盒子 —— 盒子把「写答案」变成「填表格」')
})

test('猜数字是滚筒:一格一个数,上下两个不翻转', () => {
  const s = wxss('playkit-estimate')
  const m = wxml('playkit-estimate')
  const j = js('playkit-estimate')
  /* 2026-09-11 纠正:上一版钉的是「上下两条是镜像(scaleY(-1))」—— 那是我自己加的,
     原型那段渲染里写明「字形一个都不翻」,它第一版翻过来才是错的。
     邻数靠缩、糊、淡三样连续变化读出距离。 */
  assert.equal(s.includes('scaleY(-1)'), false, '邻数不翻转 —— 翻过来的数字没人认得出是 499')
  assert.ok(/blur\(\d+rpx\)/.test(s) && s.includes('scale(.92)'), '邻数要缩要糊,否则读不出远近')
  /* 它是滚轮:500 的邻居就该是 499 和 501。跳格的话中间那个数和上下两个不连续。 */
  assert.ok(/span <= 2000\) return 1/.test(j), '常见量程必须一格一个数,不许跳格')
  assert.ok(s.includes('mask-image'), '滚筒上下要淡出,才看着无头无尾')
  assert.ok(m.includes('picker-view'), '手势交给原生 picker-view')
  assert.equal(/<input/.test(m), false,
    '这一屏不是打字输入 —— 打字要人心里先有个数,滚轮是让人滑到差不多')
})

test('猜图的底色顺序照原型,深色那格字要翻浅', () => {
  const j = js('playkit-pricepair')
  /* ⚠️ 这条断言上一版钉的是**小程序当时的写法**(红紫黑蓝),还顺手编了一句
     「别按红蓝黑紫的直觉排」替它辩护 —— 那是拿自己的产物当真源。
     原型 playkit.html:2382 是 ['#f0402f','#3563e9','#2a2a28','#8a6bf2',…],
     四张排在一起是红、蓝、深、紫。截图并排看才发现顺序反了。 */
  assert.ok(j.includes("'#f0402f', '#3563e9', '#2a2a28', '#8a6bf2'"),
    '底色顺序逐位照原型 tile.style.background 那一行')
  assert.ok(/i % 6 === 2 \? '#e4ddd2'/.test(j), '第 3 格是深的,里面的字要翻浅')
})


test('★题干使用统一 sheet-title token /800/1.35', () => {
  const SPEC = /font-size: var\(--cy-type-sheet-title\);[\s\S]{0,120}?font-weight: 800;[\s\S]{0,120}?line-height: 1\.35;/
  for (const n of ['playkit-bingo', 'playkit-estimate']) {
    assert.match(wxss(n), SPEC, n + ' 的题干没按 .hdr .t 的实测值来')
  }
})

test('★副标题一律不显示 —— 原型 .hdr .s{display:none},那是「删除提示语」那条拍板', () => {
  /* header(title, sub) 的第二个参数在原型里被 CSS 全局隐藏了。
     照着 JS 抄会把它显示出来 —— 我在九宫格和滚筒上就是这么错的:
     读 JS 看到有 sub 就渲染,没去看 CSS 把它关掉了。 */
  const BANNED = ['本周任务 · 城瘾', '上下滑动，松手后会自己滑一段', '上下滑动,松手后会自己滑一段']
  for (const n of fs.readdirSync(DIR).filter((x) => /^playkit-/.test(x))) {
    const f = path.join(DIR, n, 'index.wxml')
    if (!fs.existsSync(f)) continue
    const src = fs.readFileSync(f, 'utf8')
    for (const b of BANNED) {
      // aria-label 里留着是对的:副标题只留给读屏器
      const visible = src.split('\n').filter((l) => l.includes(b) && !/aria-label/.test(l))
      assert.deepEqual(visible, [], n + ' 把副标题「' + b + '」显示出来了 —— 原型里它是 display:none')
    }
  }
})

test('★精准停表照的是试玩台 #kit2 那块浅色玻璃屏,不是主手机的皮肤表', () => {
  const s = wxss('playkit-stopwatch')
  assert.ok(hasHex(s, '#F2F4F6'), '底色是 #F2F4F6 —— 走 skin-* 那套会变成深色屏')
  assert.ok(/\.sw__btn \{[\s\S]{0,700}?background: #111111/.test(s),
    '这一屏的主按钮是黑的,不是别的玩法那颗白胶囊 —— 浅玻璃底上白按钮会糊进背景')
  assert.ok(/font-size: var\(--cy-play-display-4xl\)/.test(s), '走动的大数字使用 4xl 展示 token')
  assert.ok(/font-size: var\(--cy-play-display-2xl\)/.test(s), '准备屏的目标秒数使用 2xl 展示 token')
  assert.ok(/font-size: var\(--cy-type-data-xl\)/.test(s), '准备屏的误差使用 data-xl token')

  const m = wxml('playkit-stopwatch')
  assert.ok(m.includes('开跑 1 秒后数字会消失') && m.includes('点屏幕任意处停'),
    '准备屏那两行提示逐字照原型')
  assert.ok(m.includes('目标') && m.includes('误差'), '目标 / 误差是一对带标签的数,不是一句说明')
  assert.ok(/—— · ——/.test(m), '数字藏了要有两道破折号占位,不能整块消失')
})

test('★负控:随便改一个值,上面的断言必须判红', () => {
  const s = wxss('playkit-reaction')
  const broken = s.replace(/#22c55e/i, '#12b886')
  assert.notEqual(broken, s, '负控必须真的改动了输入')
  assert.equal(/#22c55e/i.test(broken), false,
    '坏版本里那个绿确实没了 —— 上面第二条会因此判红')
})
