const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../../utils/pixel-avatar-data.js');
const px = require('../../utils/pixel-avatar.js');

/** 收集一次绘制里的所有 fillRect,用来断言"画了什么"而不只是"没报错"。 */
function fakeCtx() {
  const calls = [];
  let fill = null;
  return {
    calls,
    set fillStyle(v) { fill = v; },
    get fillStyle() { return fill; },
    fillRect(x, y, w, h) { calls.push({ x, y, w, h, fill }); },
  };
}

test('数据完整:每个形象都有网格、背景、调色板和行程', () => {
  assert.ok(data.AVATAR_IDS.length > 0);
  for (const id of data.AVATAR_IDS) {
    const a = data.AVATARS[id];
    assert.ok(a.n === 32 || a.n === 48, `${id} 的网格边长应为 32 或 48,实际 ${a.n}`);
    assert.match(a.bg, /^#[0-9A-F]{6}$/, `${id} 背景色格式不对`);
    assert.ok(a.pal.length > 0, `${id} 调色板为空`);
    assert.equal(a.d.length % 4, 0, `${id} 的行程编码长度必须是 4 的倍数`);
  }
});

test('行程编码不越界 —— 越界会静默画到画布外,不报错也看不见', () => {
  const CH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  for (const id of data.AVATAR_IDS) {
    const a = data.AVATARS[id];
    for (let p = 0; p + 3 < a.d.length; p += 4) {
      const x = CH.indexOf(a.d[p]), y = CH.indexOf(a.d[p+1]);
      const w = CH.indexOf(a.d[p+2]), ci = CH.indexOf(a.d[p+3]);
      assert.ok(x >= 0 && y >= 0 && w > 0 && ci >= 0, `${id} 第 ${p/4} 段有非法字符`);
      assert.ok(x + w <= a.n, `${id} 第 ${p/4} 段横向超出网格`);
      assert.ok(y < a.n, `${id} 第 ${p/4} 段纵向超出网格`);
      assert.ok(ci < a.pal.length, `${id} 第 ${p/4} 段的调色板下标越界`);
    }
  }
});

test('编码与 id 互为逆运算', () => {
  const id = data.AVATAR_IDS[6];
  assert.equal(px.stringifyCode(id), 'px1:' + id);
  assert.equal(px.parseCode('px1:' + id), id);
});

test('脏编码一律落到兜底形象,不抛错也不返回空', () => {
  // 这些都会从数据库来:老数据、别的版本写的、被人手改过的
  for (const code of ['', null, undefined, 'px1:', 'px1:nope', '/upload/a.png', 'lego1:sk0']) {
    assert.equal(px.parseCode(code), px.FALLBACK_ID, `${JSON.stringify(code)} 没落到兜底`);
  }
});

test('能认出这是预设形象还是商家上传的图片 —— 接线要靠它分流', () => {
  assert.equal(px.isPixelAvatar('px1:p01'), true);
  assert.equal(px.isPixelAvatar('https://cdn/x.png'), false);
  assert.equal(px.isPixelAvatar(''), false);
  assert.equal(px.isPixelAvatar(null), false);
});

test('缩放只取整数倍 —— 半像素会毁掉像素画', () => {
  assert.equal(px.fitScale(32, 76), 2);   // 2.37 倍 → 2
  assert.equal(px.fitScale(32, 64), 2);
  assert.equal(px.fitScale(48, 76), 1);
  assert.equal(px.fitScale(32, 256), 8);
  // 脏输入不能算出 0:0 会画出一个看不见的 marker,而且不报错
  assert.equal(px.fitScale(32, 0), 1);
  assert.equal(px.fitScale(0, 64), 1);
  assert.equal(px.fitScale(undefined, undefined), 1);
});

test('绘制:先铺底色再画前景,且全部落在框内', () => {
  const ctx = fakeCtx();
  const side = px.drawAvatar(ctx, 'px1:' + data.AVATAR_IDS[0], 10, 20, 4);
  const a = data.AVATARS[data.AVATAR_IDS[0]];
  assert.equal(side, a.n * 4);

  const first = ctx.calls[0];
  assert.deepEqual(
    { x: first.x, y: first.y, w: first.w, h: first.h, fill: first.fill },
    { x: 10, y: 20, w: side, h: side, fill: a.bg },
    '第一笔必须是背景 —— 背景格子打包时被丢掉了,靠它顶上');

  assert.ok(ctx.calls.length > 100, `只画了 ${ctx.calls.length} 笔,疑似前景没画上`);
  for (const c of ctx.calls.slice(1)) {
    assert.ok(c.x >= 10 && c.y >= 20, '有笔画到了原点左上方');
    assert.ok(c.x + c.w <= 10 + side, '有笔横向溢出边框');
    assert.ok(c.y + c.h <= 20 + side, '有笔纵向溢出边框');
    assert.equal(c.h, 4, '每一笔都是一格高');
  }
});

test('脏编码照样画得出东西,不是空画布', () => {
  const ctx = fakeCtx();
  px.drawAvatar(ctx, 'garbage', 0, 0, 2);
  assert.ok(ctx.calls.length > 100, 'marker 上宁可站错人,也不能开天窗');
});

test('缩放倍数被夹成正整数', () => {
  const ctx = fakeCtx();
  px.drawAvatar(ctx, 'px1:' + data.AVATAR_IDS[0], 0, 0, 2.9);
  for (const c of ctx.calls.slice(1)) assert.equal(c.h, 2, '2.9 倍必须夹成 2 倍');
});

test('放进非正方的框:底色铺满,像素按短边整数倍居中不拉伸', () => {
  const ctx = fakeCtx();
  const code = 'px1:' + data.AVATAR_IDS[0];
  const side = px.drawAvatarInBox(ctx, code, 16, 14, 76, 68);   // 地图 marker 的真实框
  const a = data.AVATARS[data.AVATAR_IDS[0]];

  // 短边 68 / 32 格 = 2 倍,不是 76/32 也不是拉伸
  assert.equal(side, a.n * 2);

  const bg = ctx.calls[0];
  assert.deepEqual({ x: bg.x, y: bg.y, w: bg.w, h: bg.h, fill: bg.fill },
    { x: 16, y: 14, w: 76, h: 68, fill: a.bg },
    '底色必须铺满整个框,否则长边方向会露出面板色');

  // 每一笔都是一格高,说明没有为了填满框而纵向拉伸
  for (const c of ctx.calls.slice(1)) assert.equal(c.h, 2);

  // 前景整体居中且不越框
  const xs = ctx.calls.slice(1);
  assert.ok(Math.min.apply(null, xs.map(c => c.x)) >= 16);
  assert.ok(Math.max.apply(null, xs.map(c => c.x + c.w)) <= 16 + 76);
  assert.ok(Math.min.apply(null, xs.map(c => c.y)) >= 14 + Math.floor((68 - side) / 2));
  assert.ok(Math.max.apply(null, xs.map(c => c.y + c.h)) <= 14 + 68);
});
