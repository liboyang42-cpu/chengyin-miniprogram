const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
const stripWxmlComments = (source) => source.replace(/<!--[\s\S]*?-->/g, '')

/* 按 <view> 配平取整块,不拿「下一个兄弟是谁」当哨兵。
   CU-C-111 把 Beta 条从 .cont 覆盖行挪到图下自成一行后,它的下一个兄弟换了人 ——
   哨兵一切就切出空串,里面的断言全部空转着变绿(2026-09-25 实测踩过一次同型的假绿)。 */
function balancedBlock(source, opener) {
  const start = source.indexOf(opener)
  if (start === -1) return ''
  const tag = /<view\b|<\/view>/g
  tag.lastIndex = start
  let depth = 0
  let match
  while ((match = tag.exec(source)) !== null) {
    depth += match[0] === '</view>' ? -1 : 1
    if (depth === 0) return source.slice(start, match.index + match[0].length)
  }
  return source.slice(start)
}

const BETA_OPENER = '<view class="topic-beta"'
const HERO_OVERLAY_OPENER = '<view class="cont topic-hero-meta"'

// Beta 试玩区:后端 betaFlag 是唯一真源,前端只渲染不推断。
// 这批断言盯的是「渲染到没到」和「谁能看到转正入口」,不是像素。

test('主题详情 Beta 条挂在 betaFlag 上，说明文案与徽标同区', () => {
  const wxml = stripWxmlComments(read('pages/topic/index/index.wxml'))
  const beta = balancedBlock(wxml, BETA_OPENER)

  assert.ok(wxml.includes(BETA_OPENER), 'Beta 条必须存在')
  assert.match(beta, /wx:if="\{\{info\.betaFlag==1\}\}"/, 'Beta 条只在 betaFlag==1 时渲染')
  assert.match(beta, /topic-beta__badge[^<]*>\s*Beta 试玩/, '徽标文案要出现')
  assert.match(beta, /topic-beta__note[^<]*>[^<]*反馈/, '说明文案要讲清楚要什么(反馈)')
})

test('转正入口只给作者，且调的是服务端 graduate 端点', () => {
  const wxml = stripWxmlComments(read('pages/topic/index/index.wxml'))
  const js = read('pages/topic/index/index.js')
  const beta = balancedBlock(wxml, BETA_OPENER)

  assert.match(beta, /topic-beta__action"\s+wx:if="\{\{info\.isOwner==1\}\}"/, '转正入口必须挂 isOwner 闸，玩家不能看到')
  assert.match(beta, /bindtap="onGraduateBeta"/, '转正按钮绑到 onGraduateBeta')
  assert.match(js, /onGraduateBeta\s*\(\s*\)\s*\{/, '页面要实现 onGraduateBeta')
  assert.match(js, /url:\s*'\/api\/topic\/beta\/graduate'/, '转正走服务端端点，不在前端改状态')
  assert.match(js, /\b(?:cy)?[mM]odal\.show\([\s\S]{0,400}confirmText:\s*'确认转正'/, '转正是不可逆动作，要二次确认(2026-09-06 起走 utils/modal.js)')
})

test('首页推荐位:无分类的 Beta 主题也要露出 Beta 标识', () => {
  const wxml = stripWxmlComments(read('pages/index/index.wxml'))
  const js = read('pages/index/index.js')
  const tags = wxml.slice(wxml.indexOf('<view class="v3-reco-tags'), wxml.indexOf('<view class="v3-reco-title"'))

  assert.match(tags, /wx:if="\{\{item\.tags\.length \|\| item\.betaFlag==1\}\}"/,
    '标签行的显示条件要含 betaFlag，否则无分类时 Beta 标识跟着一起消失')
  assert.match(tags, /v3-reco-tag--beta"\s+wx:if="\{\{item\.betaFlag==1\}\}"/, 'Beta 标签自身也要挂 betaFlag')
  assert.match(js, /betaFlag:\s*item\.betaFlag == 1 \? 1 : 0/, '推荐轮播卡要从列表项透传 betaFlag')
})

test('Beta 样式走 info 语义 token，不硬编码色值', () => {
  const detail = read('pages/topic/index/index.wxss')
  const index = read('pages/index/index.wxss')
  const betaRules = detail.slice(detail.indexOf('.topic-beta {'), detail.indexOf('.topic-category-list {'))
  const betaTag = index.slice(index.indexOf('.v3-reco-tag--beta {'), index.indexOf('.v3-reco-tag--status {'))

  assert.match(betaRules, /var\(--cy-color-status-info-soft\)/, '详情 Beta 条底色用 info-soft')
  assert.match(betaTag, /var\(--cy-color-status-info-soft\)/, '首页 Beta 标签底色同源')
  assert.doesNotMatch(betaRules, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, '详情 Beta 样式不得出现字面色值')
  assert.doesNotMatch(betaTag, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, '首页 Beta 标签不得出现字面色值')
})

/* CU-C-111(2026-09-25 走查):Beta 条原来挂在 .cont 那条贴在头图底边的覆盖行里,
 * 正好横穿封面里的路线图定位标记 —— 蓝色提示条压住图钉、图钉压住「欢迎在评论区反馈体验」,
 * 谁也别想读全;切「详情 / 路线节点 / 路线」都不解决,因为它压根不在 tab 内容里。
 * 判据不是「加了个 z-index」,是**位置**:提示条不许再坐在头图的覆盖行内,
 * 要自成一行排在头图之后、数据条之前。层级能压住装饰图,压不住"两条信息叠一块读不了"。 */
function assertBetaSitsBelowHero(wxml, label) {
  const overlay = balancedBlock(wxml, HERO_OVERLAY_OPENER)
  assert.ok(overlay, `${label}:头图覆盖行 .cont 不见了,锚点要重挑`)
  assert.ok(!overlay.includes(BETA_OPENER),
    `${label}:Beta 提示条不许压在头图覆盖行里 —— 它会横穿封面里的路线图标记,两边都读不全`)

  const betaAt = wxml.indexOf(BETA_OPENER)
  const overlayEnd = wxml.indexOf(overlay) + overlay.length
  const statbarAt = wxml.indexOf('<scroll-view scroll-x class="statbar"')
  assert.ok(betaAt > overlayEnd, `${label}:Beta 条要在头图覆盖行之后自成一行`)
  assert.ok(statbarAt === -1 || betaAt < statbarAt, `${label}:Beta 条要在数据条之前`)
}

test('CU-C-111:Beta 提示条在头图之下自成一行,不压封面装饰', () => {
  assertBetaSitsBelowHero(stripWxmlComments(read('pages/topic/index/index.wxml')), '现状')
})

test('负控:CU-C-111 把 Beta 条塞回头图覆盖行必须判红', () => {
  const wxml = stripWxmlComments(read('pages/topic/index/index.wxml'))
  const overlay = balancedBlock(wxml, HERO_OVERLAY_OPENER)
  // 修复前的形状:Beta 条是 .cont 的第一个孩子
  const mutated = wxml.replace(overlay,
    overlay.replace(HERO_OVERLAY_OPENER, `${HERO_OVERLAY_OPENER}<view class="topic-beta" wx:if="{{info.betaFlag==1}}"></view>`))
  assert.notEqual(mutated, wxml, '负控变异注入失败:.cont 锚点要先同步')
  assert.throws(() => assertBetaSitsBelowHero(mutated, '负控'), /不许压在头图覆盖行里/)
})
