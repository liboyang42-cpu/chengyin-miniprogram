/**
 * 草稿弹层高度契约(Figma 379:922)。
 *
 * 稿上的硬数字:画板 375x620、遮罩满屏 375x620、面板 y=190 h=430 —— 69.4%,
 * 正好是 cy-sheet 的 70vh 默认档。规格 157 行还要求「底下那层压暗后仍露在上面」。
 *
 * 2026-09-03 这块连着错了两次,方向相反,所以两边都要钉:
 *   ① 第一版:只传了 --cy-comp-sheet-max-h,以为面板就满了。可 bottom 档只有
 *      max-height、没有 height —— 抬上限对「内容矮」毫无作用,单条草稿仍是 1/4 屏。
 *   ② 第二版:改成抬到 --cy-comp-sheet-max-height(整屏),把底层完全盖死,反过来违反 157 行。
 * 正解是「不抬档位,只把面板从『按内容撑高』改成定高」。缺一边或多一边都不对,
 * 而两种错法都不抛异常、不报错,只是长得不对 —— 正是要门禁盯的形状。
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const wxml = read('pages/square/components/cy/post-drafts/index.wxml')
const wxss = read('pages/square/components/cy/post-drafts/index.wxss')
const composeWxss = read('pages/square/components/cy/post-compose/index.wxss')
const sheetWxss = read('components/cy/sheet/index.wxss')

// ① 不许抬档位:稿是 70%,抬上限会盖死底层,违反「压暗后仍露在上面」
assert.ok(
  !/--cy-comp-sheet-max-h\s*:/.test(wxml),
  '草稿弹层不能覆盖 --cy-comp-sheet-max-h:稿 379:922 是 430/620=69.4%(即 70vh 默认档),'
    + '抬到整屏会把压暗的底层盖死,违反规格 157 行「底下那层仍露在上面」'
)

// ② 定高:.pd 必须有确定的 min-height,否则内容矮时面板按内容撑高(第一版的错)
// ⚠️ 先剥注释再断言:.pd 的声明里带行尾注释,而且「把 min-height 整行注释掉」这种改法
//    会让注释里仍留着 min-height 字样 —— 不剥就抓不到(2026-09-03 负控实测漏过一次)。
const pdRule = wxss.match(/\.pd\s*\{[^}]*\}/)
assert.ok(pdRule, '找不到 .pd 规则')
const pdBody = pdRule[0].replace(/\/\*[\s\S]*?\*\//g, '')
assert.match(
  pdBody,
  /min-height:\s*calc\(/,
  '.pd 必须用 min-height 把面板撑到档位高度 —— cy-sheet 的 bottom 档只有 max-height,不给 height'
)
// height 会把溢出的草稿裁掉且滚不到,必须是 min-height
assert.ok(
  !/(^|[;{\s])height:/.test(pdBody),
  '.pd 不能写死 height:草稿多于一屏时会被裁掉且滚不到,只能用 min-height'
)

const pdExpr = pdBody.match(/min-height:\s*calc\(([\s\S]*?)\);/)[1].replace(/\s+/g, '')

// ③ 上限表达式必须与 .sh__panel 的 max-height 逐字一致 —— 抄一半就会一个变一个不变
const panelRule = sheetWxss.match(/\.sh__panel\s*\{[\s\S]*?\n\}/)
assert.ok(panelRule, '找不到 .sh__panel 规则')
const panelMax = panelRule[0].match(/max-height:\s*([^;]+);/)
assert.ok(panelMax, 'cy-sheet .sh__panel 的 max-height 形状变了,post-drafts 无从对齐')
assert.ok(
  pdExpr.startsWith(panelMax[1].replace(/\s+/g, '')),
  `.pd 的 min-height 必须以 .sh__panel 的 max-height 表达式(${panelMax[1].trim()})打头`
)

// ④ 反向钉住被复制的减法:面板 padding-bottom 的每一项 + .sh__body 的上下 padding。
//    ⚠️ 必须**按项比多重集**,不能用子串包含 —— 面板 padding 里本来就有 24rpx,
//    用 includes('-24rpx') 会把「.sh__body 改成 12rpx 后该减 24rpx」误判成已满足
//    (2026-09-03 负控实测:这条真的假绿过)。
const padBottom = panelRule[0].match(/padding:\s*0\s+var\(--cy-page-x\)\s+calc\((.*?)\);/)
assert.ok(
  padBottom,
  'cy-sheet .sh__panel 的 padding 形状变了,post-drafts 复制的减法公式已无从校对,请同步两边'
)
const bodyPad = sheetWxss.match(/\.sh__body\s*\{[^}]*padding:\s*([\d.]+)rpx\s+0\s*;?[^}]*\}/)
assert.ok(bodyPad, 'cy-sheet .sh__body 的 padding 形状变了,post-drafts 减掉的那截已无从校对')

const expected = padBottom[1].replace(/\s+/g, '').split('+')
  .concat([Number(bodyPad[1]) * 2 + 'rpx'])       // .sh__body 上下各一份
  .sort()
// 只 tokenize 减号后面的项:env(...) 和 var(...) 内部也有连字符,不能裸 split('-')
const tail = pdExpr.slice(panelMax[1].replace(/\s+/g, '').length)
const actual = (tail.match(/-\s*(env\([^)]*\)|var\([^)]*\)|[\d.]+[a-z%]+)/g) || [])
  .map((t) => t.replace(/^-\s*/, '')).sort()
assert.deepEqual(
  actual, expected,
  '.pd 减掉的项必须与 cy-sheet 实际内边距逐项相等(面板 padding-bottom 各项 + .sh__body 上下合计):'
    + `\n  期望 ${JSON.stringify(expected)}\n  实际 ${JSON.stringify(actual)}`
)

// ⑤ post-compose 的面板抄了同一份减法(它也是 cy-sheet 的 bottom 档 + 内容定高),
//    所以同一条公式要一起钉 —— 只钉一处的话另一处漂了照样绿。
const pcRule = composeWxss.match(/\.pc-panel\s*\{[\s\S]*?\n\}/)
assert.ok(pcRule, '找不到 .pc-panel 规则')
const pcBody = pcRule[0].replace(/\/\*[\s\S]*?\*\//g, '')
assert.match(
  pcBody, /min-height:\s*calc\(/,
  '.pc-panel 必须用 min-height 撑满面板:不撑满的话「留白 + 底部工具条贴底」就没了,发布钮会跟在正文下面浮着'
)
assert.ok(
  !/(^|[;{\s])height:/.test(pcBody),
  '.pc-panel 不能写死 height:正文写长了要能继续长、由面板滚'
)
const pcExpr = pcBody.match(/min-height:\s*calc\(([\s\S]*?)\);/)[1].replace(/\s+/g, '')
assert.ok(
  pcExpr.startsWith(panelMax[1].replace(/\s+/g, '')),
  `.pc-panel 的 min-height 必须以 .sh__panel 的 max-height 表达式(${panelMax[1].trim()})打头`
)
const pcTail = pcExpr.slice(panelMax[1].replace(/\s+/g, '').length)
const pcActual = (pcTail.match(/-\s*(env\([^)]*\)|var\([^)]*\)|[\d.]+[a-z%]+)/g) || [])
  .map((t) => t.replace(/^-\s*/, '')).sort()
assert.deepEqual(
  pcActual, expected,
  '.pc-panel 减掉的项必须与 .pd 一致(都是 cy-sheet 面板 padding-bottom 各项 + .sh__body 上下合计):'
    + `\n  期望 ${JSON.stringify(expected)}\n  实际 ${JSON.stringify(pcActual)}`
)

// ⑥ post-compose 的面板顶必须按胶囊实测算,不能用 --cy-comp-sheet-max-height 那个 token。
//    那个 token 是 env(safe-area-inset-top) 推的,env() 返回 0 的设备(模拟器 / 安卓)上
//    算出来的面板顶压在胶囊上 —— 2026-09-03 真机截图实拍到顶栏两枚图标被盖住。
// ⚠️ 不能只查「字符串出现过」:删掉主路径、只留兜底,那种断言照样绿(负控实测过)。
//    这里逐项钉住这段计算的三个组成部分:主源 + 兜底源 + 真正用到的那个坐标。
const composeJs = read('pages/square/components/cy/post-compose/index.js')
;[
  ['menuButtonInfo', '主源:app.globalData.menuButtonInfo(全站同一份胶囊坐标)'],
  ['getMenuButtonBoundingClientRect', '兜底源:globalData 还没填时直接问微信'],
  // ⚠️ 这条必须钉「算式」不是「字段名」:mb.bottom 在上面的空值守卫里也出现,
  //    只查字段名的话把 bottom 换成 top 照样绿(负控实测过)。
  [/bottom\s*\+\s*8\b/, '面板顶 = 胶囊【底】+ 8px 余量,不是胶囊顶、也不是状态栏高度'],
].forEach(([needle, why]) => assert.ok(
  typeof needle === 'string' ? composeJs.includes(needle) : needle.test(composeJs),
  `post-compose 的面板顶必须问胶囊坐标算,缺了「${needle}」—— ${why}`
))
const composeWxml = read('pages/square/components/cy/post-compose/index.wxml')
assert.ok(
  !/style="[^"]*--cy-comp-sheet-max-h:\s*var\(--cy-comp-sheet-max-height\)/.test(composeWxml),
  'post-compose 不能在 wxml 里把 max-h 写死成 --cy-comp-sheet-max-height:'
    + 'env() 返回 0 的设备上它会压住胶囊,要走 JS 算的 sheetStyle'
)

// ⑦ 子弹窗不能活得比宿主久:show 置 false 时必须一并收掉 draftsShow。
//    不收的话新建帖文关掉后,草稿面板会孤零零挂在广场页上 —— 不报错、零 console error,
//    单测和全部门禁一条都没盖到,2026-09-03 是靠真截图看出来的。
const closeBranch = composeJs.match(/show\(open\)\s*\{[\s\S]*?if\s*\(!open\)\s*\{([\s\S]*?)\n      \}/)
assert.ok(closeBranch, 'post-compose 的 show 观察器少了 !open 分支,无法核对子弹窗是否被收掉')
assert.match(
  closeBranch[1], /draftsShow:\s*false/,
  'show 置 false 时必须一并 setData({ draftsShow: false }):草稿层是子弹窗,不能活得比宿主久'
)

// ⑧ 附件三枚必须真接选图/选点/选活动,预览在 WXML。占位 toast 会让用户以为发出去了。
assert.doesNotMatch(composeJs, /\bonNotYet\b/, 'post-compose 不得再留 onNotYet 占位 toast')
assert.doesNotMatch(composeJs, /2026-12-01/, '附件到期日占位注释必须删掉,功能已经接上')
assert.doesNotMatch(composeWxml, /\bonNotYet\b/, 'WXML 不得再绑 onNotYet')
assert.match(composeWxml, /picList/, '已选图片预览必须在 WXML')
assert.match(composeWxml, /\baddress\b/, '已选地点预览必须在 WXML')
assert.match(composeWxml, /selectedActivity/, '已选活动标题预览必须在 WXML')
assert.match(composeJs, /chooseImage\(/, '选图必须复用广场 OSS 上传通道 app.chooseImage')
assert.match(composeJs, /pickLocation\(/, '选点必须走现成的 chooseLocation 封装,不要另写一套')
assert.match(composeJs, /\/api\/registration\/list/, '活动只能从我报名的列表里挑,禁止公开活动劫持')
assert.match(composeJs, /owner_type:\s*2/, '报名列表必须限定活动 owner_type=2')
assert.match(composeJs, /is_my:\s*1/, '活动也要从我主办的列表里挑')
assert.match(composeJs, /data_id/, '发布必须把活动写进后端已有的 data_id 字段')

