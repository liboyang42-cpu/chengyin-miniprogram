/* 按压反馈覆盖率契约(2026-08-25)
 *
 * 可点却没有任何按压回应 = 用户按下去不知道有没有点到。这条闸做两件事:
 *   ① 锁住 .cy-pressed 的**物理反馈**:只有 opacity 是「变暗」不是「按下去」,
 *      必须带位移;同时减少动态效果时只撤位移、保留减淡(反馈不能归零)。
 *   ② 给「可点但没有按压态」立棘轮:只准变小,新增即判红。
 *
 * ⚠️ 棘轮数字**必须取本检查器实测**,不许手算。修完一批就把 RATCHET 显式调小,
 *    等量替换(修好 A 又漏了 B)会被总数原地不动掩盖 —— 所以下面还按文件锁了
 *    top 缺口的额度,单文件回潮同样判红。
 *
 * 不算缺口的情况(不是漏,是有意):
 *   · 标签本身自带按压态(cy-btn / cy-cell / cy-merchant-card / 原生 button)
 *   · hover-class 写了条件式(如 {{canTap ? 'cy-pressed' : 'none'}}) —— 这正是
 *     p1-feedback-wiring-contract「无动作状态不得显示按压反馈」要求的写法
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const SKIP_DIR = new Set(['node_modules', 'miniprogram_npm', 'tests', 'docs', 'images', '.git', 'scripts'])
/** 这些标签自己就渲染按压态,宿主不必再挂 hover-class */
// 2026-09-25 #1172 cy-club-card 与 cy-merchant-card 同构:根节点自带 hover-class=cc--press(components/cy/club-card/index.wxml:1),
//   宿主挂 bind:tap 不缺按压反馈;此前没登记只是因为还没有页面在宿主上绑 tap。
const SELF_PRESSED = new Set(['cy-btn', 'cy-cell', 'cy-merchant-card', 'cy-club-card', 'button'])
const TAG = /<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)\/?>/g

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

function collectWxml(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectWxml(full, out)
    else if (entry.name.endsWith('.wxml')) out.push(full)
  }
  return out
}

/** 注释里的 hover-class / bindtap 都不算数 */
function stripComments(source) {
  return source.replace(/<!--[\s\S]*?-->/g, '')
}

function missingPressFeedback(source) {
  let missing = 0
  let tappable = 0
  for (const match of stripComments(source).matchAll(TAG)) {
    const [, tag, attrs] = match
    if (!/\b(bind|catch)(:)?tap\s*=/.test(attrs)) continue
    tappable += 1
    if (SELF_PRESSED.has(tag)) continue
    const hover = /hover-class\s*=\s*"([^"]*)"/.exec(attrs)
    const value = hover ? hover[1].trim() : ''
    if (value && value !== 'none') continue
    missing += 1
  }
  return { missing, tappable }
}

/** 该文件里「可点但没有按压反馈」的元素分别绑了哪个 handler —— 挡板豁免与它的负控共用这一份逻辑 */
function bareTapHandlers(source) {
  const handlers = []
  for (const match of stripComments(source).matchAll(TAG)) {
    const [, tag, attrs] = match
    if (!/\b(bind|catch)(:)?tap\s*=/.test(attrs)) continue
    if (SELF_PRESSED.has(tag)) continue
    const hover = /hover-class\s*=\s*"([^"]*)"/.exec(attrs)
    const value = hover ? hover[1].trim() : ''
    if (value && value !== 'none') continue
    const bound = /\b(?:bind|catch)(?::)?tap="([^"]*)"/.exec(attrs)
    handlers.push(bound ? bound[1] : '')
  }
  return handlers
}

function surveyAll(overrides = {}) {
  const files = collectWxml(ROOT)
  let missing = 0
  let tappable = 0
  const byFile = {}
  for (const file of files) {
    const relative = path.relative(ROOT, file)
    const source = overrides[relative] !== undefined ? overrides[relative] : fs.readFileSync(file, 'utf8')
    const result = missingPressFeedback(source)
    missing += result.missing
    tappable += result.tappable
    if (result.missing) byFile[relative] = result.missing
  }
  return { missing, tappable, byFile, fileCount: files.length }
}

/** 实测冻结值 —— 修完一批必须显式调小,别让等量替换蒙混过去 */
/* 2026-08-25 rebase 到含 #816/#825 的 master 后 7 → 9。⚠️ 这不是回退:
   本分支定 7 时的 master 还没有 cy-dropdown / cy-date-sheet 这两个组件,
   它们各自带一个 catchtap="noop" 弹窗挡板 —— 是**新长出来的挡板**,不是丢失的反馈。
   下面「豁免不能被滥用」那条会逐文件反查:登记在册的 handler 必须真的全是 noop,
   所以这两条加进来是被验证过的,不是靠调大数字蒙混。
   真实缺口(可点却毫无回应)本次从 183 降到 0。 */
/* 2026-08-26 Figma v5.1 新玩法落地后 9 → 10:cy-playkit-dailysign 是新长出来的全屏浮层,
   它的 catchtap="noop" 是防穿透挡板(点卡片本体不该关掉签),同样按"挡板不给按压态"处理。
   逐文件那条会反查它登记的确实是 noop,所以这条加一不是把数字调大蒙混。 */
/* 2026-09-03 T5 胶囊(cy-popover)落地 10 → 11:它的全屏关闭挡板 .pop__catch 是
   **全透明**的,给它 .cy-pressed 等于什么都不做 —— 纯粹为让门禁闭嘴,那才是假绿。
   它与 noop 挡板同理「不该有按压态」,但**有动作**(关闭),不能混进 noop 那张表,
   所以单列 DISMISS_CEILING,并用同样结构化的方式反查(见下面那条 test)。 */
/* 2026-09-10 10 → 12:漫游四模式按用户裁决脱离小程序 DS,玩法说明与 TA 的漫游两屏
   不再套 cy-scene-sheet,改用原型自己的 .sheet —— 于是本页多出两个 catchtap="noop"
   防穿透挡板(点半屏正文不该把自己关掉)。它们和 cy-scene-sheet 里那一个是同一件东西,
   只是换了个宿主:那边少一处、这边多两处,净 +2 而不是凭空多两个死按钮。
   下面「豁免不能被滥用」那条会逐文件反查它俩确实绑的是 noop。 */
/* 2026-09-10 第二批 12 → 25:漫游页剩下的 13 个半屏也一起换成原型壳,
   每个带一个同样的防穿透挡板,pages/roam 一共 15 个。**全部是挡板,没有一个是动作**
   —— 逐文件那条会把这 15 个的 handler 一个个反查必须是 noop,数字调大蒙混不过去。
   分母的另一头同时在变小:这 13 个半屏各自少了一件 cy-scene-sheet。
   同一批里首次发现仪式卡也从 cy-sheet 换成原型壳,再 +1 ⇒ 26,pages/roam 共 16 个挡板。
   2026-09-10 26 → 27:旅程手记也照原型重做成半屏,pages/play 多一个同性质的挡板。
   2026-09-10 27 → 30:漫游补上原型的工具抽屉 + 设置页 + 清空确认,三层壳各带一个同性质挡板,
   pages/roam 共 19 个。逐文件那条会把这 19 个的 handler 一个个反查必须是 noop。
   2026-09-11 30 → 37:组局照原型重做,七层壳(工具抽屉/列表/局卡/局详情/举报/开一局/丢弃确认)
   各带一个同性质挡板。同一批里 subpackageRoam/nearby 少了六件 cy-sheet,
   常驻 peek 面板与图例整块退场。
   2026-09-11 37 → 38:补上原型 topicSheet,又一层壳、又一个同性质挡板。
   2026-09-11 38 → 52:游玩页(城市定向 / 自由探索)也脱离 DS —— 12 个半屏从 cy-scene-sheet
   换成原型 .psheet、2 个从 cy-sheet 换成原型 .sheet,每层壳带一个同性质防穿透挡板,
   pages/play 1 → 15。**14 个全是 noop**,逐文件那条会一个个反查;
   分母另一头同时减少:这 14 个半屏各自少了一件 cy-scene-sheet / cy-sheet。
   2026-09-11 53 → 52:漫游的「查找附近好玩的」换成原型 f-fun 的横滑白卡,
   roam-discover 那件半屏从漫游页摘掉 —— 它的防穿透挡板随之少一个(19 → 18)。
   这是**修好一格**,按规矩把棘轮与该文件额度都显式调小。
   2026-09-11 52 → 55:照原型补上 f-topic / f-city(主题半屏)与 f-checkin(打卡后能做什么),
   pages/roam 18 → 20;组局补上 h-place(别人打过卡的地方)半屏,subpackageRoam/nearby 8 → 9。
   **全部是 noop 挡板**,逐文件那条会一个个反查。
   2026-09-15 54 → 49:地图组队 P 方案,组局页改成附近的队伍 —— 工具抽屉/列表/局卡/局详情/举报/开一局/丢弃确认/打卡点
   八层壳退场,换成队伍卡/队长审批/我的队伍三层(主题半屏保留),subpackageRoam/nearby 9 → 4。修好五格,显式调小。 */
/* 2026-09-11 并 github/master:master 那边 10 → 11(cy-popover 的 .pop__catch),
   本分支 10 → 52,两批叠加 ⇒ 53。两边加的都是挡板,各自有反查表。 */
const RATCHET = 49
/** 实测剩下的 9 处全部是 bindtap="noop" 的弹窗挡板(吞点击防穿透关闭)。
 *  挡板本身不是动作,给它按压态就是伪造可交互暗示 —— 所以它们**永远**留在这张表上,
 *  作为「已判定为不该有反馈」的登记,而不是被悄悄移出分母。 */
const SWALLOWER_CEILING = {
  'pages/square/components/activity-picker/index.wxml': 2,
  'components/cy/scene-sheet/index.wxml': 1,
  'components/cy/sheet/index.wxml': 1,
  'components/cy/publish-sheet/index.wxml': 1,
  'pages/play/components/story-sheet/index.wxml': 1,
  // 2026-08-25 随 #816/#825 进入 master 的两个新弹窗,各带一个吞冒泡挡板
  'components/cy/dropdown/index.wxml': 1,
  'components/cy/date-sheet/index.wxml': 1,
  // 2026-08-26 v5.1 今日城市签:全屏签卡的防穿透挡板
  'pages/play/components/playkit-dailysign/index.wxml': 1,
  // 2026-09-10 漫游四模式脱离 DS 壳:两屏改用原型自己的 .sheet,
  //   本体各带一个 catchtap="noop" 防穿透挡板(点正文不该把自己关掉)——
  //   与 cy-scene-sheet 那一个同性质,只是这四个模式不再走那件组件。
  //   2026-09-10 第二批:漫游页 15 个半屏 + 首次发现仪式卡全部换完,挡板随之 2 → 16。
  //   2026-09-10 第三批:补上工具抽屉 + 设置页 + 清空确认三层壳,16 → 19。
  //   2026-09-11 第四批:roam-discover 半屏从漫游摘掉,19 → 18;
  //   同日补 f-topic/f-city 与 f-checkin 两层,18 → 20。
  'pages/roam/index.wxml': 20,
  // 2026-09-10 旅程手记照原型 journalScreen 重做成半屏:本体带一个防穿透挡板。
  // 2026-09-11 游玩页 12 个 .psheet + 2 个 .sheet 也换完,挡板 1 → 15。
  'pages/play/index.wxml': 15,
  // 2026-09-11 组局照原型重做:八层壳各一个防穿透挡板(含工具抽屉与主题半屏)。
  // 2026-09-11 补上原型 h-place(别人打过卡的地方)半屏,8 → 9。
  // 2026-09-15 地图组队 P 方案:只剩队伍卡 / 队长审批 / 我的队伍 / 主题半屏四层,9 → 4。
  'subpackageRoam/nearby/index.wxml': 4,
}

/** 全屏关闭挡板:透明、覆盖全屏、handler 只做 triggerEvent('close')。
 *  与 noop 挡板分表登记 —— noop 那张表的守卫「必须真是吞冒泡的 noop」一字未动,
 *  这张表有自己的反查:handler 必须只关闭、不干别的。 */
const DISMISS_CEILING = {
  'pages/square/components/cy/popover/index.wxml': 1,
}

test('可点却无按压反馈的元素只减不增', () => {
  const survey = surveyAll()
  assert.ok(survey.fileCount >= 200, '扫描分母异常，必须覆盖全部生产 WXML')
  assert.ok(
    survey.missing <= RATCHET,
    `可点无按压反馈 ${survey.missing} 处 > 棘轮 ${RATCHET}：新增了按下去没有回应的元素`,
  )
  assert.equal(
    survey.missing, RATCHET,
    `已修好一批(实测 ${survey.missing} < 棘轮 ${RATCHET})：必须把 RATCHET 显式调到实测值，否则等量替换会被总数掩盖`,
  )
})

test('剩余缺口只剩弹窗挡板，且逐文件锁死', () => {
  const { byFile } = surveyAll()
  const registered = Object.assign({}, SWALLOWER_CEILING, DISMISS_CEILING)
  const unexpected = Object.keys(byFile).filter((f) => !(f in registered))
  assert.deepEqual(unexpected, [], '出现了挡板以外的新缺口：这些元素按下去没有任何回应')
  for (const [file, ceiling] of Object.entries(registered)) {
    const actual = byFile[file] || 0
    assert.ok(actual <= ceiling, `${file} 缺按压 ${actual} 处 > 额度 ${ceiling}`)
    assert.equal(actual, ceiling, `${file} 实测 ${actual} < 额度 ${ceiling}：修好了就把额度调小`)
  }
})

test('.cy-pressed 必须有位移，不能退回「只是变暗」', () => {
  const css = read('style/components.wxss')
  const rule = /\.cy-pressed\s*\{[^}]*\}/.exec(css)
  assert.ok(rule, '找不到 .cy-pressed')
  assert.match(rule[0], /transform:\s*scale\(\.9[5-8]\)/, '按压必须落在 Emil 的 0.95–0.98 区间')
  assert.match(rule[0], /opacity:/, '位移之外仍要保留减淡')
  assert.match(rule[0], /transition:[^;}]*transform/, '位移要有过渡，不能硬跳')
})

test('减少动态效果时撤位移但保留减淡（反馈不能归零）', () => {
  const css = read('style/components.wxss')
  const guard = /\.cy-motion-reduced\s+\.cy-pressed\s*\{[^}]*\}/.exec(css)
  assert.ok(guard, '缺少 .cy-motion-reduced 兜底')
  assert.match(guard[0], /transform:\s*none/, '减少动态效果必须撤掉位移')
  assert.doesNotMatch(guard[0], /opacity:\s*1\b/, '不能把减淡也一起撤掉，那等于按下去毫无回应')
})

test('负控：新增一个裸可点元素必须判红', () => {
  const victim = 'pages/index/index.wxml'
  const mutated = `${read(victim)}\n<view bindtap="onFakeTap">裸可点</view>\n`
  assert.notEqual(mutated, read(victim), '负控必须真实改动输入')
  const survey = surveyAll({ [victim]: mutated })
  assert.equal(survey.missing, RATCHET + 1, '新增的裸可点元素必须被计入')
  assert.ok(survey.missing > RATCHET, '超过棘轮必须判红')
})

test('负控：把 hover-class 摘掉必须判红；条件式与自带按压标签不算缺口', () => {
  const withHover = '<view bindtap="a" hover-class="cy-pressed">x</view>'
  const withoutHover = '<view bindtap="a">x</view>'
  const conditional = `<view bindtap="a" hover-class="{{ok ? 'cy-pressed' : 'none'}}">x</view>`
  const selfPressed = '<cy-btn bindtap="a">x</cy-btn>'
  const commented = '<!-- <view bindtap="a">x</view> -->'

  assert.equal(missingPressFeedback(withHover).missing, 0)
  assert.equal(missingPressFeedback(withoutHover).missing, 1, '摘掉 hover-class 必须被抓')
  assert.equal(missingPressFeedback(conditional).missing, 0, '条件式是「无动作不给按压」的正确写法，不是缺口')
  assert.equal(missingPressFeedback(selfPressed).missing, 0, '自带按压的标签不该重复要求')
  assert.equal(missingPressFeedback(commented).tappable, 0, '注释里的可点元素不算数')
  assert.equal(missingPressFeedback('<view bindtap="a" hover-class="none">x</view>').missing, 1,
    'hover-class="none" 是显式关掉反馈，仍要留在缺口账上等人判断')
})

test('挡板豁免不能被滥用：登记在册的必须真是吞冒泡的 noop', () => {
  for (const file of Object.keys(SWALLOWER_CEILING)) {
    for (const handler of bareTapHandlers(read(file))) {
      assert.equal(handler, 'noop',
        `${file} 里 ${handler} 不是吞冒泡的挡板，不能靠挡板豁免免掉按压反馈`)
    }
  }
})

test('负控：把挡板的 noop 换成真动作，豁免必须失效', () => {
  const file = 'components/cy/sheet/index.wxml'
  // 挡板可能写 bindtap 也可能写 catchtap，负控不锁写法，只把 handler 换成真动作
  const mutated = read(file).replace(/(\b(?:bind|catch)(?::)?tap=")noop(")/, '$1onRealAction$2')
  assert.notEqual(mutated, read(file), '负控必须真实改动输入')
  const handlers = bareTapHandlers(mutated)
  assert.ok(handlers.includes('onRealAction'), '真动作必须落回缺口账上')
  assert.ok(handlers.some((h) => h !== 'noop'), '不能再被当成挡板整体放过')
})

test('关闭挡板豁免不能被滥用：登记在册的 handler 必须只做关闭', () => {
  for (const file of Object.keys(DISMISS_CEILING)) {
    const js = read(file.replace(/\.wxml$/, '.js'))
    for (const handler of bareTapHandlers(read(file))) {
      // handler 必须存在,且函数体里除了 triggerEvent('close') 没有别的语句 ——
      // 一旦有人往这里塞真动作(跳转 / 发请求),豁免立刻失效。
      const body = new RegExp(handler + "\\s*\\(\\)\\s*\\{([^}]*)\\}").exec(js)
      assert.ok(body, `${file} 的 ${handler} 在同名 js 里找不到,无法核对它只做关闭`)
      const stmts = body[1].split(';').map((x) => x.trim()).filter(Boolean)
      assert.deepEqual(
        stmts, ["this.triggerEvent('close')"],
        `${file} 里 ${handler} 不只是关闭(实测 ${JSON.stringify(stmts)}),不能靠关闭挡板豁免免掉按压反馈`,
      )
    }
  }
})

