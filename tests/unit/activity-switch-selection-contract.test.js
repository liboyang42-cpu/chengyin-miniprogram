const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

// 2026-08-05:本契约原名「将开关作为中性选择态，而非成功状态」，断言
// DEFAULT_COLOR === '#F6F7FA'（中性白）。用户裁决推翻了这个方向 —— 规范真源 §3.3:
// **所有切换按钮一律绿色**。保留的是这份契约的另一半意图:现行宿主必须用共享
// 组件而不是原生 <switch> 自己传色。颜色断言改为「必须是 status-success 的实值
// 镜像」，而不是写死某个 hex —— 写死 hex 正是上一版挡住这次修改的原因。
test('官方活动发布用共享开关组件，颜色由组件统一给', () => {
  const activityList = read('pages/activity/list/index.wxml');
  const sharedSwitch = read('components/cy/switch/index.js');
  const decor = read('pages/merchant/decor/index.wxml');

  /* 2026-09-03:「发起官方活动」面板整块删掉(官方活动改由 Web 后台上传),
     activity/list 已不再有开关。这条契约的意图是「宿主必须用共享组件、颜色由组件给」,
     现存宿主是 merchant/decor —— 断言改盯它,顺带钉死 activity/list 不许把原生
     <switch color="..."> 抄回来(那正是这条契约最初要拦的形状)。 */
  assert.doesNotMatch(activityList, /<switch[^>]*color=/);
  assert.match(decor, /<cy-switch[^>]*checked=/, '现存宿主必须用共享开关组件');
  // 原生 <switch> 的 color 只吃字面量，组件里只能留一份实值镜像。断言它确实等于
  // tokens 里 --cy-color-status-success 的玩家域取值 —— 两处漂移就红，但不锁死具体 hex。
  const declared = /const DEFAULT_COLOR = '(#[0-9A-Fa-f]{6})'/.exec(sharedSwitch)
  assert.ok(declared, 'cy-switch 必须声明 DEFAULT_COLOR')
  const tokens = read('style/tokens.wxss')
  // 2026-09-02:真源换成 --cy-comp-switch-on。status/success 是文字用的绿(为过 4.5:1 而调亮),
  // 当轨道这种大色块就发白、白滑块压上去只有 2.55:1。轨道单开一档,不动基色。
  const switchOn = /--cy-comp-switch-on:\s*(#[0-9A-Fa-f]{6})\s*;/.exec(tokens)
  assert.ok(switchOn, 'tokens 里应定义 --cy-comp-switch-on(开关开启态轨道底)')
  assert.equal(declared[1].toUpperCase(), switchOn[1].toUpperCase(),
    'cy-switch 的 DEFAULT_COLOR 与 --cy-comp-switch-on 漂移了，两处必须同步')
  // decor 是 theme-merchant(浅色)页。此前它必须显式传浅端绿 —— 因为旧真源
  // --cy-color-status-success 在浅色主题下会解析成另一个值,而原生 <switch> 吃不到 var()。
  // 2026-09-02 起轨道底改用 --cy-comp-switch-on,**三个域同值**(它是控件填充,不随明暗域变),
  // 所以这个 override 不再需要,留着反而会让商家页的开关和别处不一样。
  assert.doesNotMatch(decor, /<cy-switch\s+color=/,
    'decor 不该再给开关传色 —— 轨道底已是三域同值的 --cy-comp-switch-on,传了就会漂')
  assert.match(decor, /<cy-switch\s+checked="\{\{m\.businessStatus\s*!=\s*0\}\}"/,
    'decor 的营业开关仍应使用共享 cy-switch 组件')
});
