process.env.TZ = 'UTC';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');

const PROJECT_HOME = /\/pages\/topic\/merchantinfo\/merchantinfo\?topicId=/;
const PLAYER_PAGE = /\/pages\/topic\/index\/index\?id=/;

/**
 * 项目主页(主办视图)的入口契约。
 *
 * 2026-08-05 实测:project-host 组件做完之后,全仓 grep `merchantinfo?topicId=` 零命中 ——
 * 页面做好了但没有任何地方能走到它,等于死码。这三条断点各修一次,这里钉死不许回退。
 *
 * 判据是「发布者要去的是哪儿」:topic/index 是**玩家买票页**,发布者在那儿看不到
 * 谁来接、谁带团、卖了多少。三个入口都必须指向项目主页。
 */
/* 2026-09-06 用户裁决「统一」:发布成功不再有按钮,面板自愈后直接跳。
 * 被保护的事实没变 —— 落点必须是项目主页(主办视图),不是玩家买票页。
 * 断言随之从「主按钮是 projectUrl」改成「面板收掉后跳的就是 projectUrl」。 */
test('发布成功后直接落项目主页,不是玩家买票页', () => {
  const js = read('pages/publish/fabu/index.js');
  assert.match(js, PROJECT_HOME, '发布成功后必须能落到项目主页');
  assert.match(js, /_resultSheetNext = projectUrl/, '落点就是它,不能换成别的页');
  assert.match(js, /if \(next\) wx\.redirectTo/, '面板收掉必须真的跳过去,不能只是关掉面板');
});

test('「我的项目」列表点主题卡进项目主页', () => {
  const js = read('subpackageA/pages/myproject/index.js');
  assert.match(js, PROJECT_HOME);
  // 活动详情已收成场景单一真源；主题去向变更不能把活动入口删掉或退回深链页。
  assert.match(js, /openScene\('play-activity-detail',\s*\{\s*id\s*\}\)/, '活动仍应进入活动详情场景');
});

// 原本这里还有第三条:商家工作台「我发布的主题」卡片。#516 重做工作台时把那个列表
// 整块删了(自己发布的主题统一从「我的项目」进),入口只剩上面两个,断言随之下掉。

/**
 * 负控的另一半:「预览玩家看到的」这件事本身要留着,否则上面几条断言用
 * 「全仓不许出现 topic/index」也能满足,那是错的闸。
 *
 * 2026-09-07 换锚:预览从**发布后跳玩家页**挪到了**发布前的确认页**
 * (_buildPublishPreview,读编辑器里的当前草稿)。旧那条跳的是 ?id= —— 读的永远是
 * 服务端上一次保存的那版,和刚发的内容对不上;新的这条才是真的"玩家会看到的样子"。
 * 所以锚点从 PLAYER_PAGE 改成预览构造器本身,是把闸挪到更严的位置,不是放宽。
 */
/* 2026-09-06:发布弹层统一后,「预览玩家看到的」那颗次按钮没了。
 * 原来这条钉的是发布页,删按钮后它只靠一个没人用的 topicUrl 死变量维持 = 假绿。
 * 出口已补到主办视图(project-host 标题下)—— goTopicDetail 原先只在**承接视图**
 * (project-join 的「我承接的」卡)上冒泡,而发完落到的是主办视图,那边一直没有入口。
 * 断言随之搬到真正承载它的那一页,并且**两头都钉**:入口在 wxml 上、页面方法真的跳
 * 玩家页 —— 少钉一头都可能悄悄断链(有入口没去处,或有去处没入口)。 */
test('主办视图有「预览玩家看到的」入口,且它真的跳玩家买票页', () => {
  const hostWxml = read('pages/topic/components/project-host/index.wxml');
  assert.match(hostWxml, /data-act="goTopicDetail"/, '主办视图必须有这个入口');
  assert.match(hostWxml, /预览玩家看到的/, '入口要有可读的文案,不能只是个裸 act');
  assert.match(read('pages/topic/merchantinfo/merchantinfo.js'), PLAYER_PAGE,
    'goTopicDetail 必须真的跳玩家买票页,不能是个有入口没去处的空壳');
});
