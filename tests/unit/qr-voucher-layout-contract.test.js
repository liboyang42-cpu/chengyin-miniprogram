const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
const SOURCE = {
  wxml: read('components/cy/qr-voucher/index.wxml'),
  wxss: read('components/cy/qr-voucher/index.wxss'),
}

const renderable = wxml => wxml.replace(/<!--[\s\S]*?-->/g, '')

function parseWxml(wxml) {
  const root = { name: '#root', attrs: {}, children: [] }
  const stack = [root]
  const tag = /<\/?([A-Za-z][\w-]*)(\s[^<>]*?)?\/?\s*>/g
  let match
  while ((match = tag.exec(renderable(wxml)))) {
    const raw = match[0]
    const name = match[1]
    if (raw.startsWith('</')) {
      const node = stack.pop()
      assert.ok(node && node.name === name, `WXML 标签栈失配：实际 ${raw}`)
      continue
    }
    const attrs = {}
    const attr = /([:@\w-]+)(?:\s*=\s*"([^"]*)")?/g
    let pair
    while ((pair = attr.exec(match[2] || ''))) attrs[pair[1]] = pair[2] === undefined ? true : pair[2]
    const node = { name, attrs, children: [], parent: stack.at(-1) }
    node.parent.children.push(node)
    if (!raw.endsWith('/>')) stack.push(node)
  }
  assert.equal(stack.length, 1, `WXML 有未闭合标签：${stack.at(-1).name}`)
  return root
}

function walk(node) {
  return [node, ...node.children.flatMap(walk)]
}

function classHas(node, className) {
  return String(node.attrs.class || '').split(/\s+/).includes(className)
}

function ruleBody(wxss, selector) {
  const start = wxss.indexOf(`${selector} {`)
  assert.ok(start >= 0, `缺少 ${selector} 规则`)
  const end = wxss.indexOf('}', start)
  assert.ok(end >= 0, `${selector} 规则未闭合`)
  return wxss.slice(start, end + 1)
}

function replaceInRule(wxss, selector, from, to) {
  const start = wxss.indexOf(`${selector} {`)
  assert.ok(start >= 0, `负控变异失败：缺少 ${selector} 规则`)
  const end = wxss.indexOf('}', start)
  assert.ok(end >= 0, `负控变异失败：${selector} 规则未闭合`)
  const body = wxss.slice(start, end + 1)
  assert.ok(body.includes(from), `负控变异失败：${selector} 内缺少 ${from}`)
  return wxss.slice(0, start) + body.replace(from, to) + wxss.slice(end + 1)
}

function declaration(rule, name) {
  const match = [...rule.matchAll(/([\w-]+):\s*([^;]+);/g)].find(item => item[1] === name)
  return match && match[2].replace(/\/\*[\s\S]*?\*\//g, '').trim()
}

function assertDeclaration(rule, name, expected) {
  assert.equal(declaration(rule, name), expected, `${name} 必须是 ${expected}`)
}

/* 2026-07-31 用户原话「这个是白色的 需要重新设计」⇒ 错误态不再套白色码卡:
 * 白卡是「给对方扫」的物理需求(§5.9 对比度),没有码可扫时那张大白卡只是无意义色块。
 * 本契约随之从「错误态在白卡内长什么样」改钉「错误态**不在**白卡内、且在暗 scrim 上可读可点」。
 * 仍然保留的原始意图:长文案可换行、文案与重试纵向分开且顺序固定、重试不被 flex 压缩、
 * 重试绑定 onRetry、ready/loading 两态零改动。 */
function assertQrVoucherLayout(source) {
  const tree = parseWxml(source.wxml)
  const nodes = walk(tree)

  // ① 错误态独立于白卡:同级互斥,不是白卡的后代
  const error = nodes.find(node => node.name === 'view' && classHas(node, 'qr__error'))
  assert.ok(error, '错误态必须有独立的 .qr__error 容器(不再复用白卡内的占位)')
  /* 错误态的判定条件必须**同时**覆盖两种「没有码可出示」:
     ① state==='error';② state==='ready' 但 qr / code 双空(消费方直接写死 state:'ready'
     不校验有没有码,改造前靠卡内链条的兜底 wx:else 落到错误占位)。
     漏掉②会让那一路掉进卡内新的兜底(转圈)⇒ 永久转圈、无重试。 */
  assert.equal(
    error.attrs['wx:if'],
    "{{state === 'error' || (state === 'ready' && !qr && !code)}}",
    '错误态必须同时覆盖 state==="error" 与 ready-但无码,否则 ready 无码会永久转圈',
  )
  const card = nodes.find(node => node.name === 'view' && classHas(node, 'qr__card'))
  assert.ok(card, 'ready/loading 的二维码必须继续落在浅色卡面内')
  assert.ok('wx:else' in card.attrs, '白卡必须是错误态的 wx:else —— 错误态下白卡不得渲染')
  assert.ok(
    !walk(card).includes(error),
    '错误态不得再是白卡的后代(否则又变回「白色大卡里放报错」)',
  )
  assert.ok(
    !nodes.some(node => classHas(node, 'qr__ph--error')),
    '旧的白卡内错误占位 .qr__ph--error 不得回潮',
  )

  // ② 错误态三件套:图标 → 文案 → 重试,顺序固定
  const icon = error.children.find(node => node.name === 'image' && classHas(node, 'qr__error-ic'))
  assert.ok(icon, '错误态必须有插画位')
  assert.equal(icon.attrs.src, '/images/no_data.svg', '错误态插画走已有资产 no_data.svg')
  const content = error.children.find(node => classHas(node, 'qr__err-content'))
  assert.ok(content, '错误文案与重试入口必须有独立内容容器')
  assert.deepEqual(
    content.children.map(node => [node.name, node.attrs.class]),
    [['text', 'qr__err-txt'], ['view', 'qr__err-retry']],
    '错误文案和重试入口必须按文案→重试的顺序垂直排列'
  )
  const retry = content.children.find(node => classHas(node, 'qr__err-retry'))
  assert.equal(retry.attrs.catchtap, 'onRetry', '重试按钮必须继续绑定 catchtap onRetry')

  // ③ 出口不能丢:错误态与 ready/loading 共用 scene-full 顶层关闭键,凭证内容不再自绘第二个出口
  const shell = nodes.find(node => node.name === 'cy-scene-sheet')
  assert.ok(shell, '二维码必须挂在统一 scene-sheet 外壳内')
  assert.equal(shell.attrs.variant, 'full', '二维码必须使用 full scene 外壳')
  assert.equal(shell.attrs['bind:requestclose'], 'onClose', '统一关闭出口必须回到 QR 组件的 onClose')
  assert.ok(!nodes.some(node => classHas(node, 'qr__error-close')), '二维码错误态不得自绘第二个关闭键')
  assert.ok(!nodes.some(node => classHas(node, 'qr__close')), '二维码卡内不得再自绘第二个关闭键')

  // ④ ready / loading 两态零改动
  const readyImage = nodes.find(node => node.name === 'image' && node.attrs['wx:if'] === "{{state === 'ready' && qr}}")
  assert.ok(readyImage && classHas(readyImage, 'qr__img'), 'ready 二维码分支不能被错误态改动破坏')
  const codeText = nodes.find(node => node.attrs['wx:elif'] === "{{state === 'ready' && code}}")
  assert.ok(codeText && classHas(codeText, 'qr__code-text'), 'ready 无图时的文本防伪码兜底不能丢')
  const loading = nodes.find(node => node.name === 'view' && classHas(node, 'qr__ph') && !classHas(node, 'qr__error'))
  assert.ok(loading && walk(loading).some(n => classHas(n, 'qr__spin')), 'loading 转圈分支不能被破坏')

  // ⑤ 错误态在暗 scrim 上的可读性 / 可点性
  const errorRule = ruleBody(source.wxss, '.qr__error')
  assertDeclaration(errorRule, 'display', 'flex')
  assertDeclaration(errorRule, 'flex-direction', 'column')
  assertDeclaration(errorRule, 'align-items', 'center')
  assertDeclaration(errorRule, 'justify-content', 'center')
  assertDeclaration(errorRule, 'min-height', '440rpx')   // 占住原码卡那块区域,不塌成一行

  const iconRule = ruleBody(source.wxss, '.qr__error-ic')
  assertDeclaration(iconRule, 'width', '240rpx')
  assertDeclaration(iconRule, 'height', '240rpx')

  const contentRule = ruleBody(source.wxss, '.qr__err-content')
  assertDeclaration(contentRule, 'display', 'flex')
  assertDeclaration(contentRule, 'flex-direction', 'column')
  assertDeclaration(contentRule, 'align-items', 'center')
  assertDeclaration(contentRule, 'gap', 'var(--cy-space-2)')
  assertDeclaration(contentRule, 'width', '100%')

  const textRule = ruleBody(source.wxss, '.qr__err-txt')
  assertDeclaration(textRule, 'display', 'block')
  assertDeclaration(textRule, 'width', '100%')
  assertDeclaration(textRule, 'box-sizing', 'border-box')
  assertDeclaration(textRule, 'line-height', 'var(--cy-leading-normal)')
  assertDeclaration(textRule, 'text-align', 'center')
  assertDeclaration(textRule, 'word-break', 'break-all')
  // 暗 scrim 上必须是浅字(原来是浅卡内的深字 #334155,直接搬过来会看不见)
  assertDeclaration(textRule, 'color', '#F6F7FA')
  assertDeclaration(textRule, 'font-size', 'var(--cy-type-section-title)')

  // 重试是白色实心按钮,不是浅卡里那条品牌紫文字链接
  const retryRule = ruleBody(source.wxss, '.qr__err-retry')
  assertDeclaration(retryRule, 'flex', '0 0 auto')
  assertDeclaration(retryRule, 'background', 'var(--cy-btn-solid-bg)')
  assertDeclaration(retryRule, 'color', 'var(--cy-btn-solid-fg)')
  assertDeclaration(retryRule, 'min-height', 'var(--cy-btn-h)')

  const cardRule = ruleBody(source.wxss, '.qr__card')
  assertDeclaration(cardRule, 'position', 'relative')
  assertDeclaration(cardRule, 'padding', 'var(--cy-space-5)')

  assert.equal(source.wxss.includes('.qr__close'), false, '二维码组件不得保留旧的卡内关闭按钮样式')
}

test('二维码错误态脱离白卡、在暗 scrim 上可读可点，ready/loading 不受影响', () => {
  assertQrVoucherLayout(SOURCE)
})

test('二维码错误态布局契约可判红（回潮与关键约束负控）', () => {
  const mutants = [
    {
      name: '错误态回潮成白卡内占位(.qr__ph--error)',
      source: { ...SOURCE, wxml: SOURCE.wxml.replace('class="qr__error"', 'class="qr__ph qr__ph--error"') },
    },
    {
      // 这条钉的是自审抓到的真实回归:只判 state==='error' 会让「ready 但没码」永久转圈
      name: '错误态条件漏掉 ready-但无码(那一路会永久转圈)',
      source: { ...SOURCE, wxml: SOURCE.wxml.replace(
        "{{state === 'error' || (state === 'ready' && !qr && !code)}}",
        "{{state === 'error'}}",
      ) },
    },
    {
      name: '白卡不再与错误态互斥(错误态下仍渲染白卡)',
      source: { ...SOURCE, wxml: SOURCE.wxml.replace('<view wx:else class="qr__card">', '<view class="qr__card">') },
    },
    {
      name: '统一 scene-sheet 关闭出口脱离 QR onClose(整屏无出口)',
      source: { ...SOURCE, wxml: SOURCE.wxml.replace('bind:requestclose="onClose"', 'bind:requestclose="noop"') },
    },
    {
      name: '重试解绑 onRetry',
      source: { ...SOURCE, wxml: SOURCE.wxml.replace('class="qr__err-retry" catchtap="onRetry"', 'class="qr__err-retry"') },
    },
    {
      name: '错误插画被删',
      source: { ...SOURCE, wxml: SOURCE.wxml.replace(/\n\s*<image class="qr__error-ic"[\s\S]*?\/>\n/, '\n') },
    },
    {
      name: '文案沿用浅卡深字(暗底上看不见)',
      source: { ...SOURCE, wxss: replaceInRule(SOURCE.wxss, '.qr__err-txt', 'color: #F6F7FA;', 'color: #334155;') },
    },
    {
      name: '重试退回文字链接(丢掉实心按钮底)',
      source: { ...SOURCE, wxss: replaceInRule(SOURCE.wxss, '.qr__err-retry', 'background: var(--cy-btn-solid-bg);', 'background: transparent;') },
    },
    {
      name: '错误态塌成一行(不再占住码卡区域)',
      source: { ...SOURCE, wxss: replaceInRule(SOURCE.wxss, '.qr__error', 'min-height: 440rpx;', 'min-height: 0;') },
    },
    {
      name: '删除错误内容容器的纵向 flex',
      source: { ...SOURCE, wxss: replaceInRule(SOURCE.wxss, '.qr__err-content', 'display: flex;', 'display: block;') },
    },
    {
      name: '改为横向排列',
      source: { ...SOURCE, wxss: replaceInRule(SOURCE.wxss, '.qr__err-content', 'flex-direction: column;', 'flex-direction: row;') },
    },
    {
      name: '删除长错误文案断词约束',
      source: { ...SOURCE, wxss: replaceInRule(SOURCE.wxss, '.qr__err-txt', 'word-break: break-all;', 'word-break: normal;') },
    },
    {
      name: '允许重试按钮被 flex 压缩',
      source: { ...SOURCE, wxss: replaceInRule(SOURCE.wxss, '.qr__err-retry', 'flex: 0 0 auto;', 'flex: 1 1 auto;') },
    },
  ]

  for (const mutant of mutants) {
    assert.throws(() => assertQrVoucherLayout(mutant.source), undefined, mutant.name)
  }
})

/* CU-M-140(2026-09-25 走查)。上面 ⑤ 钉死的 #F6F7FA 只对「外面是暗 scrim」的承载面成立,
 * 而它被当成恒真写进了组件:关于页「我的二维码」把 embedded 正文直接铺在页面底上,
 * 那层底随身份在商家日间 #F3F4F4 与玩家暗域 #000 之间翻 ⇒ 浅字压浅底只剩 1.05:1,
 * 错误态「玩家个人码待生成」在屏幕上等于不存在。
 * 治法:组件把「我外面是什么底」显式化成 surface 两档 —— scrim 沿用钉死浅字,
 * host 整套改走主题 token。这里同时钉两件事:覆盖存在,且**两档底都算得出对比度**。 */
const TOKENS = read('style/tokens.wxss')
const ABOUT_WXML = read('pages/shezhi/about/index.wxml')
const HOST_TEXT = ['.qr__err-txt', '.qr__desc', '.qr__secondary']
const DARK_SCOPE = 'page.theme-dark,'
const LIGHT_SCOPE = 'page.theme-light,'

/** tokens.wxss 里某个主题域(到最近一个行首 `}` 为止)的声明文本 */
function scopeBody(anchor) {
  const at = TOKENS.indexOf(anchor)
  assert.ok(at >= 0, `tokens.wxss 缺少 ${anchor.trim()} 域,本契约的取值锚点失效`)
  const end = TOKENS.indexOf('\n}', at)
  assert.ok(end > at, `${anchor.trim()} 域未闭合`)
  return TOKENS.slice(at, end)
}

function hexIn(anchor, token) {
  const match = scopeBody(anchor).match(new RegExp(`--${token}:\\s*(#[0-9A-Fa-f]{6})\\s*;`))
  assert.ok(match, `${anchor.trim()} 域里 --${token} 必须是 6 位 hex,否则算不出对比度`)
  return match[1]
}

const channel = value => (value / 255 <= 0.03928 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4)
const luma = hex => 0.2126 * channel(parseInt(hex.slice(1, 3), 16))
  + 0.7152 * channel(parseInt(hex.slice(3, 5), 16))
  + 0.0722 * channel(parseInt(hex.slice(5, 7), 16))
const contrast = (a, b) => {
  const [high, low] = [luma(a), luma(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}

function assertHostSurface(source) {
  // ① 组件必须真的按 surface 分档:wxml 挂 class、两处 template data 都带上 surface
  assert.match(source.wxml, /class="qr \{\{surface === 'host' \? 'qr--host-surface' : ''\}\}/,
    '正文根节点必须按 surface 挂 host 档 class')
  for (const use of source.wxml.matchAll(/<template\s+is="qr-voucher-body"([^>]*)\/>/g)) {
    assert.match(String(use[1]), /\bsurface\b/,
      'surface 必须进每一处 <template is> 的 data —— template 作用域独立,漏了恒为 undefined')
  }
  // ② host 档三处正文全部改走主题 token(写死 hex 就等于又钉了一次单底假设)
  for (const selector of HOST_TEXT) {
    const override = ruleBody(source.wxss, `.qr--host-surface ${selector}`)
    const color = declaration(override, 'color')
    assert.match(String(color), /^var\(--cy-color-text-[a-z]+\)$/,
      `.qr--host-surface ${selector} 的 color 必须是主题 token,实得 ${color}`)
  }
  // ③ 两档页面底都要真算得出对比度,不能只靠「token 名字看起来对」
  for (const [anchor, surfaceName] of [[DARK_SCOPE, '玩家暗域'], [LIGHT_SCOPE, '商家日间']]) {
    const pageBg = hexIn(anchor, 'cy-color-bg-page')
    for (const selector of HOST_TEXT) {
      const color = String(declaration(ruleBody(source.wxss, `.qr--host-surface ${selector}`), 'color'))
      const token = color.match(/^var\(--([a-z0-9-]+)\)$/)[1]
      const fg = hexIn(anchor, token)
      const ratio = contrast(fg, pageBg)
      assert.ok(ratio >= 4.5,
        `${selector} 在${surfaceName}页底 ${pageBg} 上必须 ≥4.5:1,实得 ${ratio.toFixed(2)}(${token}=${fg})`)
    }
  }
  // ④ 调用方必须真的选档:关于页 embedded 在会翻转的页面底上
  const aboutVoucher = ABOUT_WXML.match(/<cy-qr-voucher\b[\s\S]*?\/>/)
  assert.ok(aboutVoucher, '关于页玩家个人码的 cy-qr-voucher 调用点未找到,锚点失效')
  assert.match(aboutVoucher[0], /\bsurface="host"/,
    '关于页必须声明 surface="host" —— 不传就落回 scrim 档,浅字压浅底的 bug 原样回来')
}

test('surface=host:铺在页面底上的正文随主题取色,暗/日间两档都可读', () => {
  assertHostSurface({ wxml: SOURCE.wxml, wxss: SOURCE.wxss })
})

test('负控:host 承载面契约可判红(覆盖被抽掉 / 退回钉死浅字 / 调用方不选档)', () => {
  const mutants = [
    {
      name: 'host 档覆盖整条被删(关于页又用回 scrim 浅字)',
      apply: source => ({
        ...source,
        wxss: source.wxss.replace(/\.qr--host-surface \.qr__err-txt \{[^}]*\}\n/, ''),
      }),
    },
    {
      name: 'host 档退回写死的 scrim 浅色(token 假设没了,日间底照样看不见)',
      apply: source => ({
        ...source,
        wxss: replaceInRule(source.wxss, '.qr--host-surface .qr__err-txt',
          'color: var(--cy-color-text-primary);', 'color: #F6F7FA;'),
      }),
    },
    {
      // token 名字看着仍是主题档,但 --cy-color-text-inverse 在两域分别求值为 #0A0A0A / #FFFFFF,
      // 各自压在同域的页底上就是 1.05:1 —— 只有真算对比度才拦得住这种「名字对、合成错」
      name: 'host 档改用 inverse 字(两域各自压在同色页底上)',
      apply: source => ({
        ...source,
        wxss: replaceInRule(source.wxss, '.qr--host-surface .qr__secondary',
          'color: var(--cy-color-text-primary);', 'color: var(--cy-color-text-inverse);'),
      }),
    },
    {
      name: 'wxml 摘掉 surface 的 class 绑定(host 档成死样式)',
      apply: source => ({
        ...source,
        wxml: source.wxml.replace("{{surface === 'host' ? 'qr--host-surface' : ''}} ", ''),
      }),
    },
    {
      name: '新增字段只传进一处 template data(另一承载面静默空白)',
      apply: source => ({
        ...source,
        wxml: source.wxml.replace('show, reducedMotion, surface, state', 'show, reducedMotion, state'),
      }),
    },
  ]

  for (const mutant of mutants) {
    assert.throws(() => assertHostSurface(mutant.apply(SOURCE)), undefined, mutant.name)
  }

  // 调用方那条也得能红:把关于页的 surface="host" 摘掉,正文会落回 scrim 档
  const droppedCallSite = ABOUT_WXML.replace(/\n\s*surface="host"/, '')
  assert.notEqual(droppedCallSite, ABOUT_WXML, '负控变异失败:关于页没有 surface="host"')
  assert.throws(
    () => assert.match(droppedCallSite.match(/<cy-qr-voucher\b[\s\S]*?\/>/)[0], /\bsurface="host"/),
    assert.AssertionError,
    '关于页摘掉 surface="host" 时必须判红',
  )
})
