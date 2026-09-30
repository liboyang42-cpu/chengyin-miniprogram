const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
const stripWxmlComments = (source) => source.replace(/<!--[\s\S]*?-->/g, '')

/**
 * 「没有封面」不许留空壳(2026-09-25 走查 CU-M-104 / CU-M-129 / CU-M-110 / CU-C-121)。
 *
 * 四处同一种病:封面容器无条件渲染,只有里面的 <image> 挂在 wx:if 上,或者
 * 占位块是一块只有底色的空 view。数据侧 imgUrl/cover 允许为空(MySQL 侧 DEFAULT NULL),
 * 所以「没封面」是可出现的常态,不是异常 —— 空出来就是一整块像加载失败的大白板。
 * 两种解法都算修好:要么给出有信息量的缺图占位(图标 + 短文案,与 pages/template 同源),
 * 要么整块收起。这条门禁锁住「不许只剩底色」。
 */

test('CU-M-104 模板详情头图:无封面必须给图标 + 短文案,不是一块底色', () => {
  const wxml = stripWxmlComments(read('pages/templatedetail/templatedetail.wxml'))
  const wxss = read('pages/templatedetail/templatedetail.wxss')
  const slot = wxml.match(/<view class="xb-head-cover"[\s\S]*?<\/view>\s*<\/view>/)
  assert.ok(slot, 'xb-head-cover 锚点失效')

  assert.match(slot[0], /class="xb-head-cover-ph"[^>]*aria-role="img"/, '占位块要声明自己是图片位')
  assert.match(slot[0], /src="\/images\/no_data\.svg"/, '必须用全站缺图图标,不另造一套')
  assert.match(slot[0], /封面暂不可用/, '文案与 pages/template 列表同一口径')

  const ph = wxss.match(/\.xb-head-cover-ph\s*\{[^}]*\}/)
  assert.ok(ph, '.xb-head-cover-ph 规则缺失')
  assert.match(ph[0], /display:\s*flex/, '占位块必须真的排布图标与文字')
  assert.match(ph[0], /flex-direction:\s*column/)
  assert.match(ph[0], /align-items:\s*center/)
})

test('负控:模板详情头图退回空 view 占位时必须判红', () => {
  const wxml = stripWxmlComments(read('pages/templatedetail/templatedetail.wxml'))
  const mutated = wxml.replace(/<view wx:else class="xb-head-cover-ph"[\s\S]*?<\/view>\s*<\/view>/,
    '<view wx:else class="xb-head-cover-ph"></view></view>')
  assert.notEqual(mutated, wxml, '变异锚点失效')
  assert.throws(() => assert.match(mutated, /class="xb-head-cover-ph"[^>]*aria-role="img"/), assert.AssertionError)
})

test('CU-M-129 模板详情「包含内容」大图:无封面时整块收起,不留 520rpx 白板', () => {
  const wxml = stripWxmlComments(read('pages/templatedetail/templatedetail.wxml'))
  const wxss = read('pages/templatedetail/templatedetail.wxss')
  const card = wxml.match(/<view class="xb-edition-card" wx:else>[\s\S]*?<\/view>\s*<\/view>/)
  assert.ok(card, 'xb-edition-card 锚点失效')

  assert.match(card[0], /<image class="xb-edition-img" wx:if="\{\{ coverUrl \}\}"/,
    '大图必须只在真有封面时渲染')
  assert.doesNotMatch(card[0], /xb-edition-img--placeholder/,
    '不许用只有底色的空 view 顶替大图位')
  assert.match(card[0], /class="xb-edition-foot"/, '收起大图后卡片的玩法名称仍在')
  assert.equal(/\.xb-edition-img--placeholder\s*\{/.test(wxss), false,
    '占位样式已无宿主,留着就是死规则')
})

test('负控:「包含内容」退回空占位块时必须判红', () => {
  const wxss = read('pages/templatedetail/templatedetail.wxss')
  const mutated = wxss.replace('.xb-edition-foot {',
    '.xb-edition-img--placeholder {\n  background: linear-gradient(135deg, #111, #222);\n}\n\n.xb-edition-foot {')
  assert.notEqual(mutated, wxss, '变异锚点失效')
  assert.throws(
    () => assert.equal(/\.xb-edition-img--placeholder\s*\{/.test(mutated), false,
      '占位样式已无宿主,留着就是死规则'),
    assert.AssertionError,
  )
})

test('CU-M-110 / CU-C-121 邀约详情:无封面时整块封面区不渲染,而不是只藏掉 image', () => {
  const wxml = stripWxmlComments(read('pages/coop/invite-detail/index.wxml'))
  const cover = wxml.match(/<view class="cover \{\{[^}]*\}\}"[^>]*>/)
  assert.ok(cover, '.cover 容器锚点失效')
  assert.match(cover[0], /wx:if="\{\{invite\.cover\}\}"/,
    '容器自己就要吃这个条件 —— 原来只有里面 <image> 有 wx:if,380rpx 灰底照旧占位')
  assert.match(wxml, /<image class="cover-img"/, '有封面时正常渲染图片')
})

test('负控:邀约详情封面条件退回 image 层时必须判红', () => {
  const wxml = stripWxmlComments(read('pages/coop/invite-detail/index.wxml'))
  const mutated = wxml
    .replace(/<view class="cover \{\{[^}]*\}\}" wx:if="\{\{invite\.cover\}\}">/,
      '<view class="cover {{tone === \'closed\' ? \'cover--dim\' : \'\'}}">')
    .replace('<image class="cover-img"', '<image wx:if="{{invite.cover}}" class="cover-img"')
  assert.notEqual(mutated, wxml, '变异锚点失效')
  const cover = mutated.match(/<view class="cover \{\{[^}]*\}\}"[^>]*>/)
  assert.throws(() => assert.match(cover[0], /wx:if="\{\{invite\.cover\}\}"/), assert.AssertionError)
})

test('CU-C-121 消息流报名卡:imgUrl 为空时给缺图占位,不留半张卡的黑块', () => {
  const wxml = stripWxmlComments(read('subpackageB/pages/im/chat/index.wxml'))
  const wxss = read('subpackageB/pages/im/chat/index.wxss')
  assert.match(wxml, /<image wx:if="\{\{topicCache\[item\.card\.topicId\]\.imgUrl\}\}" class="rcard-img"/,
    '真图必须挂上有封面的条件')
  assert.match(wxml, /class="rcard-img rcard-img--nocover"/, '没封面走单独一档占位')
  assert.match(wxml, /aria-label="该主题暂无封面"/)

  const nocover = wxss.match(/\.rcard-img--nocover\s*\{[^}]*\}/)
  assert.ok(nocover, '.rcard-img--nocover 规则缺失')
  assert.match(nocover[0], /display:\s*flex/, '占位档要排布图标与文字')
  assert.match(nocover[0], /justify-content:\s*center/)
})

test('负控:报名卡退回无条件 image 时必须判红', () => {
  const wxml = stripWxmlComments(read('subpackageB/pages/im/chat/index.wxml'))
  const mutated = wxml.replace(
    '<image wx:if="{{topicCache[item.card.topicId].imgUrl}}" class="rcard-img"',
    '<image class="rcard-img"')
  assert.notEqual(mutated, wxml, '变异锚点失效')
  assert.throws(
    () => assert.match(mutated, /<image wx:if="\{\{topicCache\[item\.card\.topicId\]\.imgUrl\}\}" class="rcard-img"/),
    assert.AssertionError,
  )
})

// CU-C-147 俱乐部活动详情:一块 Hero 兜底,两块空壳收起。
// 这一页原先三处同病 —— Hero 无封面时只摆一枚通用 image 线条图标(读起来像资源
// 加载失败,而不是"这场活动没配图");商家 Logo 块和「主题」卡的封面块都是
// 容器无条件渲染、只有里面 <image> 挂 wx:if ⇒ 无图时留下两个空心圆角方块,
// 把标题和主操作整个推到首屏之外。
test('CU-C-147 活动详情 Hero:无封面给图标 + 短文案,不是只有一枚通用图标', () => {
  const wxml = stripWxmlComments(read('pages/club/topic-detail/index.wxml'))
  const wxss = read('pages/club/topic-detail/index.wxss')
  const slot = wxml.match(/<view class="ctd-head__cover">([\s\S]*?)\n      <\/view>/)
  assert.ok(slot, 'ctd-head__cover 锚点失效')

  assert.match(slot[0], /class="ctd-head__cover-fallback"[^>]*aria-role="img"/, '占位块要声明自己是图片位')
  assert.match(slot[0], /src="\/images\/no_data\.svg"/, '必须用全站缺图图标,不另造一套')
  assert.match(slot[0], /封面暂不可用/, '与模板详情头图 / IM 报名卡同一口径')

  const ph = wxss.match(/\.ctd-head__cover-fallback\s*\{[^}]*\}/)
  assert.ok(ph, '.ctd-head__cover-fallback 规则缺失')
  assert.match(ph[0], /flex-direction:\s*column/, '图标与文案要排成一列,不能只居中一个图标')
})

test('CU-C-147 活动详情:无商家 Logo / 无主题封面时两块空壳整块不出', () => {
  const wxml = stripWxmlComments(read('pages/club/topic-detail/index.wxml'))

  const logo = wxml.match(/<view class="ctd-head__logo"[^>]*>/)
  assert.ok(logo, 'ctd-head__logo 容器锚点失效')
  assert.match(logo[0], /wx:if="\{\{topic\.merchantLogo\}\}"/,
    '条件必须落在容器上 —— 原来只有里面 <image> 有 wx:if,128rpx 圆角块照旧占位')

  const topicCover = wxml.match(/<view class="ctd-topic__cover"[^>]*>/)
  assert.ok(topicCover, 'ctd-topic__cover 容器锚点失效')
  assert.match(topicCover[0], /wx:if="\{\{topic\.cover\}\}"/,
    '与 Hero 同一个 topic.cover,Hero 已经说了没图,这里不许再摆第二个空方块')
})

test('负控:Hero 兜底退回一枚没有文案的通用图标必须判红', () => {
  const wxml = stripWxmlComments(read('pages/club/topic-detail/index.wxml'))
  const mutated = wxml.replace(
    /<view wx:else class="ctd-head__cover-fallback"[^>]*>[\s\S]*?<\/view>/,
    '<view wx:else class="ctd-head__cover-fallback" aria-role="img" aria-label="暂无封面"><cy-icon name="image" size="128" /></view>',
  )
  assert.notEqual(mutated, wxml, '变异锚点失效')
  assert.throws(() => assert.match(mutated, /封面暂不可用/), assert.AssertionError)
})

test('负控:把商家 Logo / 主题封面的条件退回 image 层必须判红', () => {
  const wxml = stripWxmlComments(read('pages/club/topic-detail/index.wxml'))
  const logoMutated = wxml
    .replace('<view class="ctd-head__logo" wx:if="{{topic.merchantLogo}}"', '<view class="ctd-head__logo"')
    .replace('<image class="ctd-head__logo-img"', '<image wx:if="{{topic.merchantLogo}}" class="ctd-head__logo-img"')
  assert.notEqual(logoMutated, wxml, '变异锚点失效(Logo)')
  assert.throws(
    () => assert.match(logoMutated.match(/<view class="ctd-head__logo"[^>]*>/)[0], /wx:if="\{\{topic\.merchantLogo\}\}"/),
    assert.AssertionError,
  )

  const coverMutated = wxml
    .replace('<view class="ctd-topic__cover" wx:if="{{topic.cover}}">', '<view class="ctd-topic__cover">')
    .replace('<image class="ctd-topic__cover-img"', '<image wx:if="{{topic.cover}}" class="ctd-topic__cover-img"')
  assert.notEqual(coverMutated, wxml, '变异锚点失效(主题封面)')
  assert.throws(
    () => assert.match(coverMutated.match(/<view class="ctd-topic__cover"[^>]*>/)[0], /wx:if="\{\{topic\.cover\}\}"/),
    assert.AssertionError,
  )
})

// ── CU-M-156 商家·品牌浏览详情第二屏(2026-09-25 走查) ─────────────────────
// 这一处的病和上面几条同名但多一层:降级块里装的是两条【装饰性】灰条(aria-hidden),
// 既不说话也不分状态 —— 图真挂了(binderror)和"还没加载完"长得一模一样,
// 走查里滚到第二屏就是"一大块纯白骨架"。同时那条分类标签是白字压近白底。
// ⚠️ 白字不是本页写的:style/merchant-light.wxss:217 给了「暗底 + 白字」一对,
//   本页 wxss 同特异性只改写了 background 成 rgba(255,255,255,.5) 却没动 color。
//   @import 在第一行 ⇒ 共享规则先来、本页后来,谁声明谁赢 —— 只赢走一半就是隐形。
//   所以判据必须是【合并后的有效样式】,只看任一份文件都会漏判。
const MERCHANT_PAGE_WXSS = 'pages/topic/merchantinfo/merchantinfo.wxss'
const MERCHANT_SHARED_WXSS = 'style/merchant-light.wxss'
const CHIP_SELECTOR = '.topic .det1 .cont .row1 text'

function declarationsOf(wxssSource, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const block = wxssSource.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  assert.ok(block, `${selector} 选择器不存在`)
  const out = {}
  for (const decl of block[1].split(';')) {
    const m = decl.match(/\s*([a-z-]+)\s*:\s*(.+?)\s*$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

// 后到的同特异性规则逐属性覆盖先来者,没声明的属性留下先来者的值 —— 这正是本次事故的形状。
function effectiveDecls(pageSource, sharedSource) {
  return { ...declarationsOf(sharedSource, CHIP_SELECTOR), ...declarationsOf(pageSource, CHIP_SELECTOR) }
}

function relativeLuminance(hex) {
  const h = hex.replace('#', '')
  const channels = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(a, b) {
  const [la, lb] = [relativeLuminance(a), relativeLuminance(b)]
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function compositeOver(rgbaLiteral, backdropHex) {
  const m = rgbaLiteral.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/)
  assert.ok(m, `无法解析颜色字面值:${rgbaLiteral}`)
  const alpha = m[4] === undefined ? 1 : Number(m[4])
  const back = backdropHex.replace('#', '')
  const backChannels = [0, 2, 4].map((i) => parseInt(back.slice(i, i + 2), 16))
  return '#' + [1, 2, 3].map((i) => Math.round(Number(m[i]) * alpha + backChannels[i - 1] * (1 - alpha))
    .toString(16).padStart(2, '0')).join('').toUpperCase()
}

// 沿 var() 一路跳到十六进制。给定的两份主题文件里商家浅色档在前(merchant-light.wxss
// 的 page{} 在 :12,@media dark 镜像在 :358),商家页恒浅,取第一处命中就是真呈现值。
function resolveToHex(value, sources, depth = 0) {
  assert.ok(depth < 8, `${value} 解析层数过深,可能有环`)
  const nested = value.match(/^var\(\s*(--[\w-]+)\s*\)$/)
  if (nested) {
    for (const src of sources) {
      const hit = src.match(new RegExp(`${nested[1]}\\s*:\\s*([^;]+);`))
      if (hit) return resolveToHex(hit[1].trim(), sources, depth + 1)
    }
    assert.fail(`${nested[1]} 在给定主题文件里没有定义`)
  }
  assert.match(value, /^#[0-9A-Fa-f]{6}$/, `还没法解析成十六进制:${value}`)
  return value
}

function tokenSource() {
  return [read(MERCHANT_SHARED_WXSS), read('style/tokens.wxss')]
}

test('CU-M-156 商家详情第二屏:加载结束后无封面必须说话,骨架只留给加载中', () => {
  const wxml = stripWxmlComments(read('pages/topic/merchantinfo/merchantinfo.wxml'))
  const wxss = read(MERCHANT_PAGE_WXSS)
  const slot = wxml.match(/<view class="detail-cover-fallback"[\s\S]*?(?=\n\s*<view class="cont">)/)
  assert.ok(slot, 'detail-cover-fallback 锚点失效')

  assert.match(slot[0], /class="detail-cover-ph"[^>]*wx:if="\{\{ info\.name \}\}"/,
    '缺图档必须吃"加载已结束"这个条件 —— info: {} 时它不许说话,说了就是撒谎')
  assert.match(slot[0], /src="\/images\/no_data\.svg"/, '必须用全站缺图图标,不另造一套')
  assert.match(slot[0], /封面暂不可用/, '与其他三处缺图占位同一口径')
  assert.match(slot[0], /aria-role="img"/, '占位块要声明自己是图片位')
  assert.match(slot[0], /aria-label="\{\{ info\.name \}\} 暂无封面"/, '读屏要知道是哪条主题没图')
  assert.doesNotMatch(slot[0], /<view class="detail-cover-fallback"[^>]*aria-hidden/,
    '容器已经装了会说话的内容,再 aria-hidden 等于把这段抹掉')

  const ph = wxss.match(/\.topic \.det1 \.detail-cover-ph\s*\{[^}]*\}/)
  assert.ok(ph, '.detail-cover-ph 规则缺失')
  assert.match(ph[0], /flex-direction:\s*column/, '图标与文案排成一列')
  assert.match(ph[0], /align-items:\s*center/)
  assert.ok(fs.existsSync(path.join(ROOT, 'images/no_data.svg')), 'no_data.svg 不在这条路径上')
})

test('CU-M-156 商家详情第二屏:骨架必须退到未加载那一档,不许两态共用一块', () => {
  const wxml = stripWxmlComments(read('pages/topic/merchantinfo/merchantinfo.wxml'))
  const slot = wxml.match(/<view class="detail-cover-fallback"[\s\S]*?(?=\n\s*<view class="cont">)/)
  const skeleton = slot[0].match(/<view class="detail-cover-skeleton"[^>]*>/)
  assert.ok(skeleton, '骨架块锚点失效')
  assert.match(skeleton[0], /wx:else/, '骨架是"还没加载完"那一档,与缺图档互斥')
  assert.match(skeleton[0], /aria-hidden="true"/, '纯装饰骨架不进读屏')
})

test('负控:第二屏退回只有装饰灰条的降级块时必须判红', () => {
  const wxml = stripWxmlComments(read('pages/topic/merchantinfo/merchantinfo.wxml'))
  const mutated = wxml.replace(
    /<view class="detail-cover-fallback"[\s\S]*?(?=\n\s*<view class="cont">)/,
    '<view class="detail-cover-fallback" aria-hidden="true">\n        <view class="detail-cover-shape detail-cover-shape--large"></view>\n        <view class="detail-cover-shape"></view>\n      </view>\n',
  )
  assert.notEqual(mutated, wxml, '变异锚点失效')
  const slot = mutated.match(/<view class="detail-cover-fallback"[\s\S]*?(?=\n\s*<view class="cont">)/)
  assert.throws(() => assert.match(slot[0], /封面暂不可用/), assert.AssertionError)
  assert.throws(() => assert.doesNotMatch(slot[0], /<view class="detail-cover-fallback"[^>]*aria-hidden/),
    assert.AssertionError)
})

test('CU-M-156 分类标签:合并两份规则后的有效配色要读得清(≥4.5:1)', () => {
  const merged = effectiveDecls(read(MERCHANT_PAGE_WXSS), read(MERCHANT_SHARED_WXSS))
  assert.ok(merged.background, '有效样式里没有背景色,拿什么算对比')
  assert.ok(merged.color, '有效样式里没有文字色 —— 只改底不改字正是本次事故')

  // 标签压在 .det1 上,最坏底是没封面时那块 --cy-bg-card-2(比压在实景照片上更难读)。
  const worstBackdrop = resolveToHex('var(--cy-bg-card-2)', tokenSource())
  const chip = merged.background.startsWith('rgba')
    ? compositeOver(merged.background, worstBackdrop)
    : resolveToHex(merged.background, tokenSource())
  const fg = resolveToHex(merged.color, tokenSource())
  const ratio = contrastRatio(fg, chip)
  assert.ok(ratio >= 4.5,
    `分类标签文字 ${fg} 压在与 ${worstBackdrop} 合成的 ${chip} 上只有 ${ratio.toFixed(2)}:1(<4.5,AA 正文不达标)`)
})

test('负控:页面规则重新只改写 background 时必须判红', () => {
  const shared = read(MERCHANT_SHARED_WXSS)
  const mutatedPage = read(MERCHANT_PAGE_WXSS)
    .replace(/\.topic \.det1 \.cont \.row1 text \{([^}]*)\}/,
      '.topic .det1 .cont .row1 text {$1\n  background: rgba(255, 255, 255, 0.5);\n}')
  const merged = effectiveDecls(mutatedPage, shared)
  const chip = compositeOver(merged.background, resolveToHex('var(--cy-bg-card-2)', tokenSource()))
  const ratio = contrastRatio(resolveToHex(merged.color, tokenSource()), chip)
  assert.ok(ratio < 4.5, `变异没造出白字压白底(算出 ${ratio.toFixed(2)}:1),这条负控是空的`)
})
