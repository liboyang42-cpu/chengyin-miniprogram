// 自由探索卡片详情 / 章节故事流 / 店铺分身 三屏契约(2026-09-07)。
//
// 锁的是**用户当面定的那几条**,不是实现细节:
//   1) 章节 / 店铺 / 游戏 三件事分明,各自的数据来源不许串
//   2) 章节正文「多则分段,少则一句」——按空行拆,不硬凑
//   3) 点大卡片进的是剧情不是游戏;进游戏只有底部那一个按钮
//   4) 对方消息不套气泡;开场问候在开口后让位
//   5) 门店分身对话的归属校验必须在进模型之前
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const REPO = path.resolve(ROOT, '..')
const js = fs.readFileSync(path.join(ROOT, 'pages/play/index.js'), 'utf8')
const wxml = fs.readFileSync(path.join(ROOT, 'pages/play/index.wxml'), 'utf8')
const wxss = fs.readFileSync(path.join(ROOT, 'pages/play/index.wxss'), 'utf8')

/** 取两个锚点之间的片段。**锚点必须都在** —— indexOf 找不到会返回 -1,
 *  slice(-1, -1) 悄悄退化成「整个文件」,断言就从此恒真。2026-09-08 实测踩过:
 *  合并两个 generate 方法后,以旧方法名为终点的两条断言直接扫了整份源码。 */
function between(src, a, b, what) {
  const i = src.indexOf(a)
  const j = src.indexOf(b)
  assert.ok(i >= 0, what + ':找不到起点锚点「' + a + '」,改名了就同步改这里')
  assert.ok(j > i, what + ':找不到终点锚点「' + b + '」(或在起点之前),改名了就同步改这里')
  return src.slice(i, j)
}

function heroView() {
  const start = js.indexOf('  _heroView(node) {')
  const end = js.indexOf('\n  },', start)
  assert.ok(start >= 0 && end > start, '_heroView 施工区必须可定位')
  return js.slice(start, end)
}

test('章节段只吃章节的料,店名不许冒充章节名', () => {
  const src = heroView()
  // 章节名/正文来自 chapterCards 的 join,不是 node.name
  assert.match(src, /chapMeta:\s*chap \?/)
  assert.match(src, /chapName:\s*chap \?\s*\(chap\.title/)
  assert.match(src, /chapDesc:\s*chap \?\s*\(chap\.description/)
  assert.doesNotMatch(src.split('chapName:')[1].split('\n')[0], /node\.name/,
    '章节名一旦回落 node.name,玩家看到的就是店名冒充章节名')
})

test('「小瘾说」钩子取 hookText,后端必须真下发这个字段', () => {
  assert.match(heroView(), /hook:\s*node\.hookText \|\| ''/)
  // 之前 hero 写的是 hookText || description,而后端根本没 put 过 hookText ⇒ 恒回落,
  // 章节正文被重复念一遍。这条断言把「后端有 put」钉住。
  const ctrl = fs.readFileSync(
    path.join(REPO, 'chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiPlayProgressController.java'), 'utf8')
  assert.match(ctrl, /m\.put\("hookText", n\.getHookText\(\)\)/)
})

test('章节正文只在故事流里,详情不再重复念一遍', () => {
  // 用户 09-07 口径:「章节详情里不写章节内容」。详情复述整章会让「点进故事流」失去理由。
  assert.doesNotMatch(js, /chapParas/,
    '详情又把整章正文分段下发了 —— 那是故事流的活;而且上一版它下发了却没人渲染,是死字段')
  assert.doesNotMatch(wxml, /chapDesc|chapParas/,
    '卡片详情的 wxml 里出现了章节正文字段')
  // 卡背只留开头一段:卡面装不下整章
  assert.match(heroView(), /chapLead:[\s\S]{0,200}\.filter\(Boolean\)\[0\]/)
  // 故事流才是正文的去处,按空行分段(多则分段,少则一句)
  const story = js.slice(js.indexOf('  openChapStory() {'), js.indexOf('  closeChapStory() {'))
  assert.match(story, /\.split\(\/\\n\\s\*\\n\|\\r\?\\n\/\)/)
  assert.match(story, /\.filter\(Boolean\)/, '空段必须滤掉,否则一个空行会多出一段空白')
})

test('点大卡片进剧情,进游戏只有底部那一个 CTA', () => {
  assert.match(wxml, /class="fx-hero__card[^"]*"[\s\S]{0,220}bindtap="openChapStory"/)
  // 底部 CTA 是唯一进玩法的入口,文案固定不带玩法名(用户 09-07 定)
  assert.match(wxml, /bindtap="heroEnter"[\s\S]{0,200}开始互动 获得奖励！/)
  assert.equal((wxml.match(/bindtap="heroEnter"/g) || []).length, 2,
    '只有卡片详情与故事流两处 CTA 进玩法;多出来说明又开了旁路入口')
  // 故事流那颗按玩法名走(样机同款「开始 · 找一本 1998」),没配玩法名才回落固定文案
  assert.match(wxml, /开始 · ' \+ hero\.node\.playName/)
})

test('新方法不许与页面既有同名 —— 同名会被静默覆盖,零报错', () => {
  // 施工时真踩到:story / openStory / closeStory 三个都已存在,新加的被后者顶掉,
  // 表现是「点了没反应」,控制台干净、门禁全绿。
  for (const name of ['openChapStory', 'closeChapStory', 'openShopNpc', 'closeShopNpc',
    'sendShopNpc', 'openHeroNav', '_heroView', '_settleStory']) {
    const hits = (js.match(new RegExp('^  ' + name + '\\(', 'gm')) || []).length
    assert.equal(hits, 1, name + ' 在页面里出现了 ' + hits + ' 次;重名会被静默覆盖')
  }
  const dataBlock = js.slice(js.indexOf('\n  data: {'), js.indexOf('\n  onLoad'))
  assert.equal((dataBlock.match(/^    chapStory:/gm) || []).length, 1)
  assert.equal((dataBlock.match(/^    shopNpc:/gm) || []).length, 1)
})

test('故事流:快滑不显形,慢滑就地浮出 —— 阈值按每帧位移算,不是按事件差值', () => {
  const scroll = between(js, '  onStoryScroll(e) {', '  _settleStory() {', 'onStoryScroll')
  // 样机的判据是每帧位移(px):|Δ| / Δt × 16。直接拿两次事件的差值当速度,
  // 会随机器快慢和事件密度漂 —— 慢机上一次事件挪得多,慢滑会被判成快滑。
  assert.match(scroll, /Math\.abs\(top - \(this\._storyTop \|\| 0\)\) \/ dt \* 16/,
    '速度必须归一到每帧位移')
  assert.match(scroll, /this\._storyVel < STORY_FAST_PX \? 30 : 70/,
    '快慢两档必须真的分叉;只有一档就等于没实现这条阈值')
  assert.match(js, /const STORY_FAST_PX = 18;/, '阈值是样机定的 18px/frame')
  assert.doesNotMatch(scroll, /setData\(\{\s*'chapStory\.lines'/,
    'onStoryScroll 里直接改 lines = 每帧跨线程量一次,会卡')
})

test('故事流:出屏复位,滚回来能重演', () => {
  const settle = between(js, '  _settleStory() {', '  _startStoryDust() {', '_settleStory')
  assert.match(settle, /if \(ln\.in && !inView\) return \{ \.\.\.ln, in: false/,
    '不复位的话,向下滚完再向上滚就没有任何效果')
})

/** 注释是说明不是声明。不剥掉的话,一句「样机是 padding:40% 30px 86%」就能把门禁带红 ——
 *  2026-09-08 实测踩到:给 .fx-story__pad 写改动理由时提到了样机的 padding,当场判红。 */
function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
}

test('故事流:滚动容器不许带左右 padding(本仓无全局 border-box)', () => {
  const clean = stripCssComments(wxss)
  const rule = clean.slice(clean.indexOf('.st-scroll{'), clean.indexOf('.fx-story__pad{'))
  assert.ok(rule.length > 0, '.st-scroll / .fx-story__pad 两个锚点都要在,顺序也不能反')
  assert.doesNotMatch(rule, /padding:[^;]*rpx/,
    'scroll-view 加 padding 会把内容框撑出屏幕,长句右边被裁掉一截')
  assert.match(wxss, /\.st-line\{ margin:0 \d+rpx/, '边距给行不给容器')
})

test('负控:真往 .st-scroll 里塞 padding 必须判红,而注释里提到 padding 不算', () => {
  const bad = stripCssComments('.st-scroll{ padding:0 32rpx; }\n.fx-story__pad{ height:1rpx; }')
  assert.match(bad.slice(bad.indexOf('.st-scroll{'), bad.indexOf('.fx-story__pad{')), /padding:[^;]*rpx/)
  const commented = stripCssComments('.st-scroll{ /* 样机是 padding:0 32rpx */ }\n.fx-story__pad{ height:1rpx; }')
  assert.doesNotMatch(commented.slice(commented.indexOf('.st-scroll{'), commented.indexOf('.fx-story__pad{')),
    /padding:[^;]*rpx/, '注释被当成了真声明 —— 误报会拿不存在的问题挡住别人的 PR')
})

test('重答失败不许覆盖原来那条答案', () => {
  const ask = between(js, '  _askShopNpc(text, replaceIdx) {', '  _pushShopNpcReply(text, replaceIdx, audioUrl) {', '_askShopNpc')
  assert.match(ask, /if \(!reply && replaceIdx != null\)[\s\S]{0,320}return;/,
    '重答拿不到回答就该保住原文;覆盖成「网络异常」= 玩家为了再问一次把好答案弄丢了')
  // 负控:兜底文案那一支仍然要能覆盖(正常问答的失败提示还是要出现在流里)
  assert.match(ask, /_pushShopNpcReply\(reply \|\| \(r && r\.msg/)
})

test('对方消息不套气泡,我方才是右侧胶囊', () => {
  assert.match(wxss, /\.fx-msg--ai \.fx-msg__t\{(?![^}]*background)[^}]*\}/,
    '助手消息一旦有 background 就成了气泡,与 ChatGPT / assistant-ui 的分工相反')
  assert.match(wxss, /\.fx-msg--me \.fx-msg__t\{[^}]*border-radius:var\(--cy-radius-lg\)/)
})

test('开场问候在开口后让位,不与消息流叠着', () => {
  assert.match(wxss, /\.fx-npc\.is-started \.fx-npc__hello\{[^}]*opacity:0/)
  assert.match(js, /onShopNpcFocus\(\) \{ if \(!this\.data\.shopNpc\.started\)/,
    '点输入框就该让位;只在发出第一句才让位的话,键盘弹起时大字还压在消息区上')
})

test('门店分身对话:归属校验必须在进模型之前', () => {
  const ctrl = fs.readFileSync(
    path.join(REPO, 'chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiAiNpcController.java'), 'utf8')
  // 归属判定只有一份(gateShopChat),打字与语音都必须先过它再进模型 ——
  // 各写一遍的话规则一改总会漏掉一边,而漏掉的那一边就是越权面。
  const gateBody = between(ctrl, 'private ShopGate gateShopChat(', 'private static final class ShopGate', '闸门实现')
  assert.match(gateBody, /hasPaidRegistration\(userId, 1, node\.getTopicId\(\)\)/,
    '没有归属校验的话,任何登录用户都能拿任意 nodeId 把别人家的分身当免费模型用')

  for (const [name, endAnchor] of [
    ['public AjaxResult shopChat(', 'private ShopGate gateShopChat('],
    ['public AjaxResult voiceChat(', 'private String shopMemoryOf('],
  ]) {
    const method = between(ctrl, name, endAnchor, name)
    const gate = method.indexOf('gateShopChat')
    const call = method.indexOf('chatWithShop')
    assert.ok(gate > 0 && call > gate, name + ':必须先过闸再进模型')
    assert.match(method, /npcFeatureFlags\.shopChatOn\(\)/, '功能闸必须在最前面')
  }
  const method = between(ctrl, 'public AjaxResult shopChat(', 'private ShopGate gateShopChat(', 'shopChat')
  // chatOn() 是「无形陪伴 V1 不提供自由追问」的合规闸,硬编码 false 且注明不许复用。
  // 挂上去这条链路就是死代码,而且哪天为漫游放开会把门店分身一起放开。
  assert.doesNotMatch(method, /npcFeatureFlags\.chatOn\(\)/,
    '门店分身对话必须走自己的开关,不许复用漫游那条合规闸')
})

test('门店分身对话:会话键取负,不与漫游会话撞 active-slot', () => {
  const svc = fs.readFileSync(
    path.join(REPO, 'chengyinhub-system/src/main/java/com/chengyinhub/business/service/impl/NpcChatService.java'), 'utf8')
  const m = between(svc, 'public NpcChatResp chatWithShop(', 'private NpcProfile findMerchantProfile(', 'chatWithShop')
  assert.match(m, /Long sessionKey = -nodeId;/,
    '两条链路共用 npc_chat_request;正负分开才结构性不可能撞 uk_active_session')
  assert.match(m, /findMerchantProfile\(merchantId\)/)
  assert.doesNotMatch(m, /findGlobalProfile\(\)/, '门店分身不许回落成全局 NPC 冒充店主')
})

test('喂给模型的现场事实里没有答案类字段', () => {
  const ctrl = fs.readFileSync(
    path.join(REPO, 'chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiAiNpcController.java'), 'utf8')
  const mem = ctrl.slice(ctrl.indexOf('private String shopMemoryOf('), ctrl.indexOf('private static String nz('))
  for (const leak of ['getQuestionAnswer', 'getCorrectAnswer', 'getHint1', 'getHint2', 'getAnswerReveal']) {
    assert.doesNotMatch(mem, new RegExp(leak), '提示词里出现 ' + leak + ' 会让模型把答案讲出来')
  }
})

test('店铺分身对话默认关,且不是靠 sys_config 缺省值蒙对的', () => {
  const flags = fs.readFileSync(
    path.join(REPO, 'chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/NpcFeatureFlags.java'), 'utf8')
  assert.match(flags, /KEY_SHOP_CHAT = "feature\.flag\.shopNpcChat"/)
  assert.match(flags, /public boolean shopChatOn\(\) \{\s*return on\(KEY_SHOP_CHAT\);/)
  // chatOn 那条合规闸不许被本轮改动松动
  assert.match(flags, /public boolean chatOn\(\) \{\s*return false;\s*\}/,
    'chatOn 一旦从硬编码 false 改成挂条件,漫游那条合规结论就静默失效了')
})

test('接口被闸掉时不许编借口,要把服务端原话端出来', () => {
  // 终点要写全签名:方法体里就调了 _pushShopNpcReply(,只匹配前缀会把切片提前截断。
  // 再去掉注释 —— 否则「不许出现某句话」会被解释那句话的注释本身命中。
  const send = js.slice(js.indexOf('  sendShopNpc() {'), js.indexOf('\n  _pushShopNpcReply(text, replaceIdx, audioUrl) {'))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.match(send, /r && r\.msg \? String\(r\.msg\)/,
    '默认关的接口回 403,编一句「我有点忙」会让玩家一直重试')
  assert.doesNotMatch(send, /有点忙/)
})

test('店铺分身语音回复走独立播放器并在离场时停止', () => {
  assert.match(js, /_pushShopNpcReply\([\s\S]{0,180}replaceIdx, d\.audioUrl\)/)
  assert.match(js, /d\.data && d\.data\.audioUrl/)
  assert.match(js, /_pushShopNpcReply\(text, replaceIdx, audioUrl\)[\s\S]{0,900}_playShopNpcVoice\(audioUrl\)/)
  assert.match(js, /closeShopNpc\(\)[\s\S]{0,260}_stopShopNpcVoice\(\)/)
  assert.match(js, /onUnload\(\)[\s\S]{0,220}_stopShopNpcVoice\(\)/)
})

test('故事流的图片块与文字共用同一套入场动效', () => {
  // 用户 09-06:「章节里有图片,也要和文字一样的样式」——两者必须都挂 .st-line,
  // 各写一套的话滚动显形的节奏会对不上。
  assert.match(wxml, /class="st-line st-line--img[^"]*is-in/)
  assert.match(wxml, /class="st-line \{\{item\.in/)
  const css = wxss.slice(wxss.indexOf('.st-line--img{'), wxss.indexOf('.st-line--img{') + 200)
  assert.doesNotMatch(css, /transition|opacity|filter/,
    '图片块不许自带一套过渡;它要吃 .st-line 那一套')
})

test('这一章的音频:作者没配就不渲染,不留点了没反应的壳', () => {
  // 音频键钉在右下(样机 .tmus 同位),作者没配就整个不渲染
  assert.match(wxml, /class="fx-story__aud[\s\S]{0,200}wx:if="\{\{chapStory\.audio\}\}"/)
  assert.match(wxml, /bindtap="toggleChapAudio"/)
  const t = js.slice(js.indexOf('  toggleChapAudio() {'), js.indexOf('  _stopChapAudio() {'))
  assert.match(t, /if \(!st\.audio\) return;/)
  // 三个终态都要把按钮态收回去,否则暂停图标会一直亮着
  for (const ev of ['onEnded', 'onStop', 'onError']) assert.match(t, new RegExp('ctx\\.' + ev + '\\('))
})

test('退出故事流必须把音频停掉并释放', () => {
  const close = js.slice(js.indexOf('  closeChapStory() {'), js.indexOf('  onStoryNativeBack()'))
  assert.match(close, /this\._stopChapAudio\(\)/, '不停的话退出去还在响')
  const stop = js.slice(js.indexOf('  _stopChapAudio() {'), js.indexOf('\n  },', js.indexOf('  _stopChapAudio() {')))
  assert.match(stop, /destroy\(\)/, 'innerAudioContext 不 destroy 会泄漏')
})

test('形象跟手转夹在 ±38°', () => {
  const mv = js.slice(js.indexOf('  onNpcTouchMove(e) {'), js.indexOf('  onNpcTouchEnd()'))
  assert.match(mv, /Math\.max\(-38, Math\.min\(38,/)
  assert.match(wxml, /class="fx-npc__fig"[\s\S]{0,160}bindtouchmove="onNpcTouchMove"/)
})

test('语音提问走和打字完全相同的那条链路,输入框一直在', () => {
  // 用户 09-06 原话:「点击语音的时候就返回不了打字了」。按住说话做在输入框**里面**,
  // 不是一个把打字挤掉的全屏通话态 —— 这条在结构上就不会再发生。
  assert.match(wxml, /class="fx-npc__inp[\s\S]{0,900}bindtouchstart="onVoiceStart"/)
  assert.match(wxml, /<input class="fx-npc__input"/)
  const inp = wxml.slice(wxml.indexOf('class="fx-npc__inp'), wxml.indexOf('fx-npc__send'))
  assert.ok(inp.indexOf('<input') >= 0 && inp.indexOf('onVoiceStart') >= 0,
    '输入框与按住说话必须在同一条 composer 里,少一个就等于把另一种模式挤掉了')
})

test('ASR 没接入时在进模型之前就拒绝,不扣额度不留假记录', () => {
  const ctrl = fs.readFileSync(
    path.join(REPO, 'chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiAiNpcController.java'), 'utf8')
  const m = ctrl.slice(ctrl.indexOf('public AjaxResult voiceChat('), ctrl.indexOf('private String shopMemoryOf('))
  assert.ok(m.length > 200, 'voiceChat 施工区必须可定位')
  const avail = m.indexOf('speechToTextService.available()')
  const call = m.indexOf('chatWithShop')
  assert.ok(avail > 0 && (call < 0 || avail < call), 'available() 必须先判')
  assert.match(m, /语音识别还没接入/, '要说清楚缺的是什么;含糊成「暂时不可用」会让人反复重试')
  // 空识别不许拿去调模型
  assert.match(m, /text == null \|\| text\.trim\(\)\.isEmpty\(\)/)
})

test('语音片段不落盘:只有识别出的文字进对话记录', () => {
  const ctrl = fs.readFileSync(
    path.join(REPO, 'chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiAiNpcController.java'), 'utf8')
  const m = ctrl.slice(ctrl.indexOf('public AjaxResult voiceChat('), ctrl.indexOf('private String shopMemoryOf('))
  for (const persist of ['uploadOss', 'uploadLocal', 'transferTo', 'FileOutputStream']) {
    assert.doesNotMatch(m, new RegExp(persist), '音频一旦落盘就多出一份没人管的声纹数据')
  }
  const noop = fs.readFileSync(
    path.join(REPO, 'chengyinhub-system/src/main/java/com/chengyinhub/business/service/ai/impl/NoopSpeechToTextService.java'), 'utf8')
  assert.match(noop, /public boolean available\(\)\s*\{\s*return false;/, '默认实现必须失败关闭')
})

test('负控:检查器本身不是空的', () => {
  const fake = 'm.put("hookText", null)'
  assert.doesNotMatch(fake, /m\.put\("hookText", n\.getHookText\(\)\)/)
  const fakeSettle = 'if (ln.in) return ln'
  assert.doesNotMatch(fakeSettle, /if \(ln\.in && !inView\) return \{ \.\.\.ln, in: false/)
})
