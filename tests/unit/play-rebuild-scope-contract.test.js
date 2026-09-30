const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const PLAY_JS = 'pages/play/index.js'

/**
 * 去注释。★必须去:注释里正当地写着「第 i 个点」「segStep 在后面声明」这类字样,
 * 不去掉就会把说明文字当成违规(2026-08-14 我第一次跑就是这么假报的)。
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** 抓出所有「单参箭头回调 + 返回对象字面量」的 .map((x) => ({ ... })) 块。 */
function singleParamMapBlocks(source) {
  const blocks = []
  const re = /\.map\(\((\w+)\)\s*=>\s*\(\{/g
  let m
  while ((m = re.exec(source)) !== null) {
    const param = m[1]
    let depth = 1
    let i = re.lastIndex
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth++
      else if (source[i] === '}') depth--
      i++
    }
    blocks.push({ param, body: source.slice(re.lastIndex, i), at: m.index })
  }
  return blocks
}

test('play 页的单参 map 回调不得引用不存在的 i —— 它会让 rebuild() 整个抛掉', () => {
  // 2026-08-14 实证:有人把 seatTiles 的 ringX/ringY 两行粘进了 scriptTiles 的
  // `.map((x) => ...)`。那个回调没有 i,segStep 又在 8 行之后才 const 声明(TDZ)。
  // 后果:rebuild() 在**所有玩法模式**下一进来就 ReferenceError,页面彻底不渲染 ——
  // 而 ci/xcx-check.sh 通过、两个契约测 44 pass,因为它们只做字符串匹配、没人执行 rebuild()。
  //
  // ⚠️ 本检查是静态的,只挡「单参 map 回调里用了裸 i / segStep」这一类。
  //    它证明不了 rebuild() 整体能跑通,别当行为测用。
  const source = stripComments(fs.readFileSync(path.join(ROOT, PLAY_JS), 'utf8'))
  const offenders = singleParamMapBlocks(source)
    .filter((b) => b.param !== 'i')
    .filter((b) => /\bi\b/.test(b.body) || /\bsegStep\b/.test(b.body))
  assert.deepEqual(offenders.map((b) => b.body.slice(0, 60)), [],
    '单参 map 回调里出现了裸 i / segStep：回调没有索引参数，运行时必抛 ReferenceError')
})

test('负控:把那两行粘回去,上面这条必须判红', () => {
  const source = stripComments(fs.readFileSync(path.join(ROOT, PLAY_JS), 'utf8'))
  const broken = source.replace(
    'const fmNodes = visibleNodes.map((x) => ({',
    'const fmNodes = visibleNodes.map((x) => ({\n      ringX: (50 + 40 * Math.cos((-90 + i * segStep) * Math.PI / 180)).toFixed(2),')
  // 2026-09-22 原锚点 scriptTiles(剧本 tab)随起始页删除,负控改挂同形状的 fmNodes 单参 map。
  assert.notEqual(broken, source, '负控锚点失效,fmNodes 的写法变了')
  const offenders = singleParamMapBlocks(broken)
    .filter((b) => b.param !== 'i')
    .filter((b) => /\bi\b/.test(b.body) || /\bsegStep\b/.test(b.body))
  assert.ok(offenders.length > 0, '粘回违规行后必须能抓到,否则这条检查是橡皮图章')
})

test('seatTiles 那份带索引参数,是合法的 —— 别把它一起误杀', () => {
  const source = stripComments(fs.readFileSync(path.join(ROOT, PLAY_JS), 'utf8'))
  // 只断言这一行的形态,不把整份源码塞进断言 —— 失败时会打印 9 万字符,反而看不见重点。
  const line = source.split('\n').find((l) => l.includes('const seatTiles ='))
  assert.ok(line, '找不到 seatTiles 声明,play 页结构变了')
  assert.match(line, /\.map\(\(\w+, i\) =>/,
    'seatTiles 必须保留 (x, i) 形态:它真的要用 i 算环上坐标 —— 实际是:' + line.trim())
})
