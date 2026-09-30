const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PLAY_JS = fs.readFileSync(
  path.join(__dirname, '../../pages/play/index.js'), 'utf8');

test('未报名的本场领队不再被「你还没有报名这个场次」挡住', () => {
  const gate = PLAY_JS.match(
    /if \(d\.registered === false([^)]*)\) \{\s*\n\s*that\.setData\(\{ loading: false, emptyTip: '你还没有报名这个场次'/);
  assert.ok(gate, '找不到未报名空态那道闸');
  assert.match(gate[1], /&& !d\.leadSpectator/,
    '领队(leadSpectator)必须放行,否则发车/广播/放行章节都够不着(F-37)');
});

test('leadSpectator 只解锁渲染,不得被当成报名或权益判据', () => {
  for (const wrong of [
    // (?!=) 是必须的:没有它,`d.registered === false && !d.leadSpectator` 这句比较
    //   会被当成赋值命中,断言变成恒红。
    /registered\s*=(?!=)\s*[^;\n]*leadSpectator/,
    /leadSpectator[^\n]*\?\s*true\s*:\s*[^\n]*registered/,
  ]) {
    assert.doesNotMatch(PLAY_JS, wrong,
      'leadSpectator 不能回流进 registered —— 运营权不等于玩家领奖权');
  }
});
