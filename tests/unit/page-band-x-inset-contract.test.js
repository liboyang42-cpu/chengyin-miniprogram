/**
 * 页面顶档不得从 x=0 起排（CU-M-174）
 *
 * 走查:商家工作台 → 项目 → 我的项目 → 活动,「长按卡片可上下架 / 删除」这行提示
 * 从容器左边界之外开始,截图只露出后半段,首字符还在屏幕外。
 *
 * 根因不在这条文案,在这一页的骨架约定:`.mp-page` 自己【不带】横向内距,
 * 页面每一档内容条各自加 --cy-page-x(.tabs / .filter / .toolbar / .list 都有)。
 * 于是任何一条新加进来的顶档只要忘了补,就直接贴着屏幕左缘渲染 ——
 * 与卡片左边界也对不齐,在刘海上还被安全区再吃一刀。
 * 同一次排查里 `正在同步最新项目…`(.mp-refreshing)在 wxss 里连一条规则都没有,是同一个洞的第二个实例。
 *
 * 判据是语义关系不是字面量:只挑「页面顶档 + 该档自己直接承载裸文本」的交集。
 * 装组件的档(.mp-tabs 里是 cy-tabs、.mp-state 里是 cy-empty)由组件自管,不误伤;
 * 卡片内部的 .mp-card / .mp-body 不是顶档,也不管。
 * 所以以后再有人新加一条裸文本顶档却忘了缩进,同样会红。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const PAGE = 'subpackageA/pages/myproject/index'

/** 拆 wxml:注释整段剥掉;标签体允许 {{ }} 里出现 > ,只认引号外的第一个 > */
function tokenize(source) {
  const src = source.replace(/<!--[\s\S]*?-->/g, '')
  const out = []
  const re = /<\/?([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g
  let last = 0
  let m
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) out.push({ type: 'text', value: src.slice(last, m.index) })
    out.push({
      type: src[m.index + 1] === '/' ? 'close' : 'open',
      tag: m[1],
      attrs: m[2] || '',
      selfClose: m[3] === '/',
    })
    last = re.lastIndex
  }
  if (last < src.length) out.push({ type: 'text', value: src.slice(last) })
  return out
}

function classesOf(attrs) {
  const m = attrs.match(/\bclass\s*=\s*"([^"]*)"/)
  return m ? m[1].split(/\s+/).filter(Boolean) : []
}

/**
 * 收集「页面顶档」:根节点 class=rootClass 下的直接子元素,以及直接子 <block> 的子元素。
 * 返回 [{ classes, hasOwnText }];组件标签(cy-*)整枝跳过,由组件自管缩进。
 */
function collectBands(wxmlSource, rootClass) {
  const stack = []
  const bands = []
  for (const tok of tokenize(wxmlSource)) {
    if (tok.type === 'text') {
      const top = stack[stack.length - 1]
      if (top && tok.value.trim()) top.hasOwnText = true
      continue
    }
    if (tok.type === 'close') {
      const el = stack.pop()
      if (el && el.level === 'band') bands.push({ classes: el.classes, hasOwnText: el.hasOwnText })
      continue
    }
    if (tok.selfClose) {
      const classes = classesOf(tok.attrs)
      if (stack.length && stack[stack.length - 1].level === 'band' && !/^cy-/.test(tok.tag)) {
        // 自闭合顶档(<image class="x" />)不承载文本,但仍是档 —— 记下来,文本判据自然放行
        bands.push({ classes, hasOwnText: false })
      }
      continue
    }
    const classes = classesOf(tok.attrs)
    const parent = stack[stack.length - 1]
    let level = 'inner'
    if (!parent) {
      level = classes.includes(rootClass) ? 'root' : 'outside'
    } else if (parent.level === 'root') {
      if (/^cy-/.test(tok.tag)) level = 'ignored'
      else level = tok.tag === 'block' ? 'block' : 'band'
    } else if (parent.level === 'block') {
      if (/^cy-/.test(tok.tag)) level = 'ignored'
      else level = tok.tag === 'block' ? 'block' : 'band'
    } else if (parent.level === 'ignored' || parent.level === 'outside') {
      level = parent.level
    }
    stack.push({ level, classes, hasOwnText: false })
  }
  return bands
}

/** 抽出 wxss 里所有【选择器类名命中 classes 之一】的规则体,合并成一份声明表 */
function mergedDecls(wxssSource, classes) {
  const stripped = wxssSource.replace(/\/\*[\s\S]*?\*\//g, '')
  const decls = new Map()
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(stripped)) !== null) {
    const selectors = m[1].split(',').map((s) => s.trim()).filter(Boolean)
    const hit = selectors.some((sel) => classes.some((c) => new RegExp(`\\.${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(sel)))
    if (!hit) continue
    for (const d of m[2].split(';')) {
      const kv = d.match(/^\s*([a-z-]+)\s*:\s*(.+?)\s*$/)
      if (kv) decls.set(kv[1], kv[2])
    }
  }
  return decls
}

const isZero = (v) => v === undefined || /^0[a-z%]*$/.test(v.trim())

/** 该档是否拿到非零横向内距(padding / padding-inline / padding-left+right) */
function hasHorizontalInset(decls) {
  const inline = decls.get('padding-inline')
  if (inline && !isZero(inline)) return true
  if (decls.has('padding-left') || decls.has('padding-right')) {
    if (!isZero(decls.get('padding-left')) || !isZero(decls.get('padding-right'))) return true
  }
  const pad = decls.get('padding')
  if (!pad) return false
  const parts = pad.trim().split(/\s+/)
  // 1 值=四边同值;2/3 值→左右取第 2 个;4 值→左右取第 4 个
  const horizontal = parts.length === 1 ? parts[0] : parts.length === 4 ? parts[3] : parts[1]
  return !isZero(horizontal)
}

/** 返回所有「裸文本顶档却没拿到横向内距」的档名 */
function flushLeftTextBands(wxmlSource, wxssSource, rootClass) {
  return collectBands(wxmlSource, rootClass)
    .filter((b) => b.hasOwnText && !hasHorizontalInset(mergedDecls(wxssSource, b.classes)))
    .map((b) => b.classes.join(' '))
}

test('我的项目页:每一档裸文本都从页面安全边距起排', () => {
  const wxml = read(`${PAGE}.wxml`)
  const wxss = read(`${PAGE}.wxss`)

  // 判据本身不能是空转:先确认顶档确实被认出来,且报障那一档在集合里。
  const textBands = collectBands(wxml, 'mp-page').filter((b) => b.hasOwnText).map((b) => b.classes.join(' '))
  assert.ok(textBands.length >= 3, `只认出 ${textBands.length} 档裸文本顶档,收集器八成漂了`)
  assert.ok(
    textBands.some((c) => c.includes('mp-longtip')),
    `走查报障的 .mp-longtip 没进顶档集合,判据对它无效:\n${textBands.join('\n')}`,
  )

  assert.deepEqual(flushLeftTextBands(wxml, wxss, 'mp-page'), [], '以下顶档裸文本贴 x=0,会被刘海/安全区裁掉首字')
})

test('负控:把 .mp-longtip 的左安全边距撤掉必须判红', () => {
  const wxss = read(`${PAGE}.wxss`)
  const mutated = wxss.replace(
    /\.mp-longtip\s*\{([^}]*)padding:0 var\(--cy-page-x\);/,
    (all, head) => `.mp-longtip {${head}`,
  )
  assert.notEqual(mutated, wxss, '变异锚点漂了,负控本身是假的')
  assert.deepEqual(
    flushLeftTextBands(read(`${PAGE}.wxml`), mutated, 'mp-page'),
    ['mp-longtip'],
    '撤掉修复却判绿,说明这条契约没真读到 padding',
  )
})

test('负控:撤掉 .mp-refreshing 整条规则必须判红(同一条病的第二个实例)', () => {
  const wxss = read(`${PAGE}.wxss`)
  const mutated = wxss.replace(/^\.mp-refreshing\s*\{[^}]*\}\n/m, '')
  assert.notEqual(mutated, wxss, '变异锚点漂了,负控本身是假的')
  assert.ok(
    flushLeftTextBands(read(`${PAGE}.wxml`), mutated, 'mp-page').some((c) => c.includes('mp-refreshing')),
    '裸文本顶档没有规则却判绿,收集器漏了 wxss 侧',
  )
})

test('负控:收集器不得把装组件的档误判成贴边裸文本', () => {
  // .mp-tabs / .mp-state 只包组件,自己不留裸文本 —— 它们没 padding 也不该报。
  const wxml = read(`${PAGE}.wxml`)
  const bands = collectBands(wxml, 'mp-page')
  const tabs = bands.find((b) => b.classes.includes('mp-tabs'))
  const state = bands.find((b) => b.classes.includes('mp-state'))
  assert.ok(tabs && state, '顶档收集漂了')
  assert.equal(tabs.hasOwnText, false, '.mp-tabs 里只有 cy-tabs,不该被当成裸文本档')
  assert.equal(state.hasOwnText, false, '.mp-state 里只有 cy-empty / cy-error,不该被当成裸文本档')
})
