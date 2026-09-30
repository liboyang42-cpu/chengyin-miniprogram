/* P1 反馈接线契约(2026-08-21)
 *
 * ① 触感:成功时刻必须走 motion.haptic —— 它对减动效用户不震(触感也是动效)、机型 reject 不抛。
 *    ⚠️ 这里断言的是**行为**不是文本。上一版只断言「toast 前出现过 vibrateShort」,
 *    结果把「裸调用、不降级」这个缺口反过来钉成了契约(2026-08-21 code-review 抓到)。
 * ② 金额 countUp:动画只写 balanceDisplay 展示值,balance 真值不被帧污染
 *    (空态判断读真值;帧写进真值的话,余额落定前会闪空态)。
 * ③ 内容挂载淡入:.cy-fade-in 单一真源在 style/fade-in.wxss,读 --cy-motion-fade-swap;
 *    隔离组件必须 @import 同一份而不是各抄一份定义。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
const motion = require('../../utils/motion.js')

/* ---------- ① 触感:行为级 ---------- */

test('motion.haptic 在减动效下不震(触感也是动效)', () => {
  let calls = 0
  const haptics = { vibrateShort() { calls += 1 } }
  motion.haptic({ type: 'light', reducedMotion: true, haptics })
  assert.equal(calls, 0, '减动效偏好开启时绝不能震')
  const fired = motion.haptic({ type: 'light', reducedMotion: false, haptics })
  assert.equal(calls, 1, '未开减动效时必须照常震')
  assert.equal(fired, true)
})

test('motion.haptic 吞掉同步异常,不掀翻调用方', () => {
  const haptics = { vibrateShort() { throw new Error('device refused') } }
  assert.doesNotThrow(() => motion.haptic({ haptics }))
  assert.equal(motion.haptic({ haptics }), false, '同步拒绝时如实返回 false')
})

test('motion.haptic 同时吞掉 fail callback 与 Promise rejection', () => {
  let requestOptions = null
  let rejectionHandler = null
  const haptics = {
    vibrateShort(options) {
      requestOptions = options
      return { catch(handler) { rejectionHandler = handler } }
    },
  }

  assert.equal(motion.haptic({ haptics }), true, '调用已被平台接受时返回 true')
  assert.equal(typeof requestOptions.fail, 'function', '必须注册平台 fail callback')
  assert.equal(typeof rejectionHandler, 'function', '必须消费 Promise rejection')
  assert.doesNotThrow(() => requestOptions.fail({ errMsg: 'permission denied' }))
  assert.doesNotThrow(() => rejectionHandler(new Error('device refused')))
})

test('负控:去掉减动效闸后行为断言必须判红', () => {
  // 模拟"裸 wx.vibrateShort"那种写法:忽略 reducedMotion 一律震
  const naive = (opts) => { opts.haptics.vibrateShort({ type: 'light' }); return true }
  let calls = 0
  const haptics = { vibrateShort() { calls += 1 } }
  naive({ reducedMotion: true, haptics })
  assert.notEqual(calls, 0, '变异体确实会震(证明上面那条断言不是恒真)')
})

test('七个成功时刻都走 motion.haptic 且传了减动效偏好,没有裸 vibrateShort', () => {
  const spots = [
    ['pages/activity/official-detail/index.js', '报名成功'],
    ['pages/club/event-ops/index.js', '系列场次已创建'],
    ['pages/roam/index.js', '到达验证成功'],
    ['pages/merchant/citynode/index.js', '核销成功'],
    ['pages/play/index.js', '核销成功'],
  ]
  for (const [file, label] of spots) {
    const src = read(file)
    const idx = src.indexOf(label)
    assert.ok(idx > 0, `${file} 找不到「${label}」`)
    const near = src.slice(Math.max(0, idx - 400), idx)
    assert.match(near, /motion\.haptic\(\{[^}]*reducedMotion:/, `${file}「${label}」必须走 motion.haptic 并传 reducedMotion`)
    assert.doesNotMatch(near, /wx\.vibrateShort/, `${file}「${label}」不得裸调 wx.vibrateShort(绕开减动效闸)`)
  }
  // profile 组件里两处核销共用同一段代码
  const profile = read('components/cy/profile/index.js')
  const hits = profile.match(/motion\.haptic\(\{[^}]*reducedMotion:/g) || []
  assert.equal(hits.length, 2, `cy-profile 的两处核销都要震,实际 ${hits.length} 处`)
})

/* ---------- ② 金额 countUp ---------- */

function assertEarningsCountUp(js, wxml) {
  assert.match(js, /motion\.countUp\(/, '收益组件必须接 utils/motion 的 countUp')
  assert.match(js, /balanceDisplay:\s*v\.toFixed\(2\)/, 'countUp 帧只许写 balanceDisplay 展示值')
  assert.doesNotMatch(js, /balance:\s*v\.toFixed/, 'countUp 帧不得写 balance 真值(会让空态判断闪烁)')
  assert.match(js, /readReducedMotion\(\)\s*\|\|/, '减动效必须直接落定,不走滚动')
  assert.match(js, /balanceDisplay:\s*'0\.00'/, '起点必须显式归零,否则 refresh 时会闪出上次的金额')
  assert.match(js, /detached\(\)[\s\S]{0,120}_stopCountUp/, '组件销毁必须停掉滚动定时器')
  assert.match(wxml, /money\.amount\(balanceDisplay \|\| balance\)/, '展示位读 balanceDisplay,兜底真值')
  assert.match(wxml, /balance === '0\.00'/, '空态判断必须继续读 balance 真值')
}

test('收益金额滚动只污染展示值,真值与空态判断不受影响', () => {
  assertEarningsCountUp(
    read('components/cy/scene-asset-earnings/index.js'),
    read('components/cy/scene-asset-earnings/index.wxml'),
  )
})

test('负控:countUp 帧直接写 balance 真值必须判红', () => {
  const js = read('components/cy/scene-asset-earnings/index.js')
    .replace('balanceDisplay: v.toFixed(2)', 'balance: v.toFixed(2)')
  assert.throws(() => assertEarningsCountUp(js, read('components/cy/scene-asset-earnings/index.wxml')))
})

/* ---------- ③ 淡切 ---------- */

test('.cy-fade-in 单一真源在 style/fade-in.wxss,读 fade-swap 档', () => {
  const src = read('style/fade-in.wxss')
  const rule = src.match(/\.cy-fade-in\s*\{[^}]*\}/)
  assert.ok(rule, '.cy-fade-in 必须定义在 style/fade-in.wxss')
  assert.match(rule[0], /var\(--cy-motion-fade-swap\)/, '淡切时长必须读 --cy-motion-fade-swap token')
  assert.match(src, /@keyframes cy-fade-in/)
  // 时长与 motion.js 的 FADE_SWAP_MS 同源(两处漂移 = 两套淡切时长)
  const tokenMs = read('style/tokens.wxss').match(/--cy-motion-fade-swap:\s*(\d+)ms/)
  assert.ok(tokenMs)
  assert.equal(Number(tokenMs[1]), motion.FADE_SWAP_MS, 'token 与 motion.js 的 FADE_SWAP_MS 漂移了')
  // 全局侧靠 components.wxss 转发,不再各写一份
  assert.match(read('style/components.wxss'), /@import\s+'\.\/fade-in\.wxss'/)
})

test('所有隔离组件消费内容淡入时必须 @import 同一份定义,不许自抄', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === 'miniprogram_npm' ? [] : walk(full)
    return entry.name.endsWith('.wxml') ? [full] : []
  })
  for (const wxmlPath of walk(ROOT)) {
    if (!fs.readFileSync(wxmlPath, 'utf8').includes('cy-fade-in')) continue
    const jsonPath = wxmlPath.replace(/\.wxml$/, '.json')
    if (!fs.existsSync(jsonPath) || !JSON.parse(fs.readFileSync(jsonPath, 'utf8')).component) continue
    const wxssPath = wxmlPath.replace(/\.wxml$/, '.wxss')
    const wxss = fs.readFileSync(wxssPath, 'utf8')
    const rel = path.relative(ROOT, wxmlPath)
    assert.match(wxss, /@import\s+'[^']*style\/fade-in\.wxss'/, `${rel} 用了 cy-fade-in 就必须 @import 定义,否则隔离下静默失效`)
    assert.doesNotMatch(wxss, /@keyframes cy-fade-in/, `${rel} 不许自抄一份 keyframes(时长会各改各的)`)
  }
})

test('六个代表性状态页的 error/empty/ready 主分支都挂内容淡入', () => {
  const coupon = read('components/cy/scene-game-coupon-wallet/index.wxml')
  assert.match(coupon, /cy-empty[^>]*class="cy-fade-in"/)
  assert.match(coupon, /wx:else class="wallet-list cy-fade-in"/)
  const discover = read('components/cy/scene-roam-discover/index.wxml')
  assert.match(discover, /class="discover-list cy-fade-in"/)
  assert.match(discover, /cy-empty[^>]*class="cy-fade-in"/)
  const poi = read('components/cy/scene-roam-poi-detail/index.wxml')
  assert.match(poi, /cy-empty[^>]*class="cy-fade-in"/)
  assert.match(poi, /class="poi-body cy-fade-in"/)
  const task = read('components/cy/scene-roam-task-list/index.wxml')
  assert.match(task, /class="task-list cy-fade-in"/)
  assert.match(task, /cy-empty[^>]*class="cy-fade-in"/)
  const activity = read('components/cy/scene-play-activity-detail/index.wxml')
  assert.match(activity, /class="cy-fade-in"[^>]*state === 'ready'/)
  // 3 条 cy-empty 状态分支:missing / empty / gate(B-03 俱乐部门卡,和其余状态一样淡入)
  assert.equal((activity.match(/cy-empty class="cy-fade-in"/g) || []).length, 3)
  const customer = read('pages/merchant/customer/index.wxml')
  // 与上面 4 个页面同用 [^>]* 形:CU-M-148 给这三条状态分支另挂了 cu-state-clear
  // (让出底栏 + 安全区),钉死 class="cy-fade-in" 会把「还挂着淡入」这条真判据漏判。
  assert.match(customer, /cy-empty[^>]*class="cy-fade-in/)
  assert.match(customer, /class="cu-scroll cy-fade-in"/)
})

test('无动作状态不得显示按压反馈', () => {
  const profile = read('components/cy/profile/index.wxml')
  assert.match(profile, /pc-avatar-wrap[^>]*hover-class="\{\{isSelf \? 'cy-pressed' : 'none'\}\}"/)
  assert.match(profile, /pc-mrow[^>]*subjectMerchant\.address[\s\S]{0,260}hover-class="\{\{merchantHasGeo \? 'cy-pressed' : 'none'\}\}"/)
})

test('动态评论列表的关注图标必须真正绑定动作并回读服务端终态', () => {
  const wxml = read('pages/square/detail/index.wxml')
  const js = read('pages/square/detail/index.js')
  assert.match(wxml, /class="jia"[^>]*bindtap="commentFollowClick"[^>]*data-index="\{\{index\}\}"[^>]*aria-label="关注\{\{item\.memberNickname \? '：' \+ item\.memberNickname : ''\}\}"/,
    '评论头像上的 + 按钮不能只有图标，必须绑定当前行并有可读名称')
  assert.match(js, /commentFollowClick\(e\)[\s\S]*e\.currentTarget\.dataset\.index[\s\S]*follow_member_id:\s*item\.memberId/,
    '关注请求必须使用当前评论行的 memberId')
  assert.match(js, /commentFollowClick\(e\)[\s\S]*sendUiStateRequest\(app,\s*'\/api\/comment\/list'[\s\S]*isRecordList\(readback\.data\.rows\)[\s\S]*authoritative\.isFollowTheUser[\s\S]*this\.setData\(\{\s*list\s*\},[\s\S]*toast\('关注成功'\)/, // 2026-09-06 轻提示收口:toast('…') 取代 wx.showToast({ title })
    '只有回读当前评论行的服务端权威终态后才能回写并报成功')
  assert.match(js, /已提交，但状态确认失败，请刷新/,
    '回读失败不能静默或伪报成功')
  assert.match(js, /commentFollowClick\(e\)[\s\S]*fail\(\)[\s\S]*toast\('网络错误，请重试'\)/, // 同上
    '网络失败必须明确可重试')
})

test('内容淡入确实铺开了,不是只挂在一两个页面上', () => {
  const walk = (dir, acc) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'miniprogram_npm') continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full, acc)
      else if (e.name.endsWith('.wxml') && fs.readFileSync(full, 'utf8').includes('cy-fade-in')) acc.push(full)
    }
    return acc
  }
  const hits = walk(ROOT, [])
  assert.ok(hits.length >= 40, `内容淡入只铺了 ${hits.length} 个 wxml`)
})
