const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyLoadFailure,
  fallbackRoute,
  parseReviewRouteOptions,
  shapePage,
} = require('../../pages/merchant/reviews/view-model.js');

const ROOT = path.resolve(__dirname, '../..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

test('single review page supports public and merchant manage modes with truthful states', () => {
  const js = read('pages/merchant/reviews/index.js');
  const wxml = read('pages/merchant/reviews/index.wxml');

  assert.match(js, /mode\s*===\s*['"]manage['"]/);
  assert.match(js, /\/api\/merchant\/reviews\/public/);
  assert.match(js, /\/api\/merchant\/reviews\/manage/);
  assert.match(wxml, /pageState === 'loading'/);
  assert.match(wxml, /pageState === 'empty'/);
  assert.match(wxml, /pageState === 'error'/);
  assert.match(wxml, /submitting/);
  assert.match(wxml, /核销已验证/);
  assert.doesNotMatch(wxml, /已处理/);
});

test('review creation is bounded and guarded against duplicate submits', () => {
  const js = read('pages/merchant/reviews/index.js');
  const wxml = read('pages/merchant/reviews/index.wxml');

  assert.match(js, /if\s*\(this\.data\.submitting\)\s*return/);
  assert.match(js, /createReviewRequestId/);
  assert.match(js, /images\.length\s*>=\s*9/);
  assert.match(wxml, /maxlength="1000"/);
  assert.match(wxml, /最多 9 张/);
  assert.match(wxml, /disabled="\{\{!canSubmit/);
});

test('评分点击由 88rpx 语义 radio 承载，cy-icon 只负责绘制星形', () => {
  const wxml = read('pages/merchant/reviews/index.wxml');
  const wxss = read('pages/merchant/reviews/index.wxss');

  assert.match(wxml, /class="review-stars review-stars--input"[^>]*aria-role="radiogroup"/);
  assert.match(wxml, /class="review-star-hit"[^>]*bindtap="selectRating"[^>]*aria-role="radio"[^>]*aria-checked=/);
  assert.match(wxml, /<cy-icon class="review-star[\s\S]*?name="star" size="48"\s*\/>/);
  assert.doesNotMatch(wxml, /<cy-icon[^>]*bindtap="selectRating"/);
  assert.match(wxss, /\.review-star-hit\s*\{[^}]*width:\s*88rpx;[^}]*min-height:\s*88rpx;/s);
});

test('public and merchant reports use different authenticated endpoints', () => {
  const js = read('pages/merchant/reviews/index.js');

  assert.match(js, /\/api\/merchant\/reviews\/report/);
  assert.match(js, /\/api\/merchant\/reviews\/manage\/report/);
  assert.match(js, /expectedVersion/);
  assert.match(js, /reportSubmitting/);
});

test('review visibility maps to stable WXML status classes', () => {
  const shaped = shapePage({
    mode: 'manage', pageNum: 1, pageSize: 20, total: 3, hasMore: false,
    items: [
      { id: 1, version: 0, rating: 5, status: 'HIDDEN', imageUrls: [], verifiedRedemption: true, canReply: true, canReport: true },
      { id: 2, version: 0, rating: 4, status: 'VISIBLE', imageUrls: [], verifiedRedemption: true, canReply: true, canReport: true },
      { id: 3, version: 0, rating: 4, status: 'PENDING_REVIEW', imageUrls: [], verifiedRedemption: true, canReply: true, canReport: true },
    ],
  }, 'manage');

  assert.equal(shaped.items[0].statusClass, 'hidden');
  assert.equal(shaped.items[1].statusClass, 'visible');
  assert.equal(shaped.items[2].statusClass, 'pending');
  assert.equal(shaped.items[2].statusText, '待平台复核');
});

test('评价分页元数据与每一行必须完整匹配请求，畸形 200 整页 fail-closed', () => {
  const valid = {
    mode: 'manage', pageNum: 2, pageSize: 20, total: 21, hasMore: false,
    pendingReplyCount: 6, monthNewCount: 12, replyRatePct: 82,
    items: [{
      id: 21, version: 0, rating: 5, status: 'VISIBLE', imageUrls: [],
      verifiedRedemption: true, canReply: true, canReport: true,
    }],
  };
  const shaped = shapePage(valid, 'manage', 2, 20);
  assert.ok(shaped);
  assert.equal(shaped.pendingReplyCount, 6);
  assert.equal(shaped.monthNewCount, 12);
  assert.equal(shaped.replyRatePct, 82);

  const missingStats = shapePage({
    mode: 'manage', pageNum: 1, pageSize: 20, total: 0, hasMore: false, items: [],
  }, 'manage', 1, 20);
  assert.ok(missingStats);
  assert.equal(missingStats.pendingReplyCount, 0);
  assert.equal(missingStats.monthNewCount, 0);
  assert.equal(missingStats.replyRatePct, 0);

  const malformed = [
    Object.assign({}, valid, { total: '21' }),
    Object.assign({}, valid, { pageNum: 1 }),
    Object.assign({}, valid, { pageSize: 19 }),
    Object.assign({}, valid, { hasMore: 'false' }),
    Object.assign({}, valid, { pendingReplyCount: '6' }),
    Object.assign({}, valid, { monthNewCount: -1 }),
    Object.assign({}, valid, { replyRatePct: 101 }),
    Object.assign({}, valid, { items: valid.items.concat({ id: 22, version: true, rating: 5, status: 'VISIBLE' }) }),
    Object.assign({}, valid, { items: [{ id: 21, version: 0, rating: 5, status: 'UNKNOWN' }] }),
    Object.assign({}, valid, { items: [{ id: 21, version: 0, rating: 5, status: 'VISIBLE', imageUrls: [''] }] }),
  ];
  malformed.forEach((payload) => {
    assert.equal(shapePage(payload, 'manage', 2, 20), null, JSON.stringify(payload));
  });

  const js = read('pages/merchant/reviews/index.js');
  assert.match(js, /shapePage\(res\.data,\s*mode,\s*pageNum,\s*20\)/,
    '页面必须把本次请求页码和页大小交给 shape 层核对');
});

test('merchant reputation redesign keeps backend stats visible instead of deriving them from current page', () => {
  const js = read('pages/merchant/reviews/index.js');
  const wxml = read('pages/merchant/reviews/index.wxml');
  const wxss = read('pages/merchant/reviews/index.wxss');

  assert.match(wxml, /class="review-stats-grid"/);
  assert.match(wxml, /pendingReplyCount/);
  assert.match(wxml, /monthNewCount/);
  assert.match(wxml, /replyRatePct/);
  assert.match(wxml, /待回复 \{\{pendingReplyCount\}\}/);
  assert.match(wxml, /data-filter="low"/);
  assert.match(wxml, /data-filter="photo"/);
  assert.match(wxml, /wx:for="\{\{filteredItems\}\}"/);
  assert.match(js, /filteredItems:\s*filterReviewItems\(items,\s*this\.data\.activeFilter\)/);
  assert.doesNotMatch(js, /pendingReplyCount:\s*items\.filter/);
  assert.match(wxss, /\.review-stats-grid\s*\{/);
});

test('reply action is an inline public reply bar and report flow remains reachable', () => {
  const wxml = read('pages/merchant/reviews/index.wxml');
  const js = read('pages/merchant/reviews/index.js');

  assert.match(wxml, /写下公开回复/);
  assert.match(wxml, /class="review-reply-send"/);
  assert.match(wxml, /bindtap="tapReplySend"/);
  assert.match(wxml, /bindtap="openReport"/);
  assert.match(js, /tapReplySend\(/);
  assert.match(js, /submitReply\(\)/);
  assert.match(js, /submitReport\(\)/);
});

test('new review UI treats platform review as pending instead of published', () => {
  const js = read('pages/merchant/reviews/index.js');

  assert.match(js, /PENDING_REVIEW/);
  assert.match(js, /评价已提交，等待平台复核/);
  assert.doesNotMatch(js, /评价已发布/);
});

test('public route accepts only canonical merchantRowId and never owner member aliases', () => {
  assert.deepEqual(parseReviewRouteOptions({ merchantRowId: '7', merchantMemberId: '202', merchantId: '999', memberId: '888' }), {
    mode: 'public', merchantRowId: 7,
  });
  assert.deepEqual(parseReviewRouteOptions({ merchantId: '999' }), {
    mode: 'public', merchantRowId: null,
  });
  assert.deepEqual(parseReviewRouteOptions({ memberId: '888' }), {
    mode: 'public', merchantRowId: null,
  });

  const js = read('pages/merchant/reviews/index.js');
  assert.match(js, /merchantRowId=/);
  assert.doesNotMatch(js, /merchantMemberId=/);
});

test('ambiguous legacy owner redemption is shown as fail-closed instead of guessed store ownership', () => {
  const js = read('pages/merchant/reviews/index.js');
  const wxml = read('pages/merchant/reviews/index.wxml');

  assert.match(js, /mode === 'manage' && items\.length === 0/);
  assert.match(wxml, /AMBIGUOUS_LEGACY_MERCHANT_SCOPE/);
  assert.match(wxml, /平台不会替你猜测归属/);
});

test('cold-start fallback keeps public viewers out of merchant workbench', () => {
  assert.deepEqual(fallbackRoute('public'), { method: 'switchTab', url: '/pages/index/index' });
  assert.deepEqual(fallbackRoute('manage'), { method: 'reLaunch', url: '/pages/merchant/index/index' });

  const js = read('pages/merchant/reviews/index.js');
  assert.match(js, /fallbackRoute\(this\.data\.mode\)/);
});

test('manage permission denial has a dedicated truthful state', () => {
  assert.equal(classifyLoadFailure('manage', { code: 403 }), 'no-permission');
  assert.equal(classifyLoadFailure('manage', { code: 401 }), 'no-permission');
  assert.equal(classifyLoadFailure('manage', { code: 500 }), 'error');
  assert.equal(classifyLoadFailure('public', { code: 403 }), 'error');

  // 2026-09-16 去闸:拒权/失败改成页内 cy-inline-error + 重试,不再整屏 cy-empty/cy-error。
  const wxml = read('pages/merchant/reviews/index.wxml');
  const inlineError = wxml.match(/<cy-inline-error\b[^>]*wx:elif="\{\{pageState === 'no-permission'\}\}"[^>]*\/>/);
  assert.ok(inlineError, '拒权必须有页内内联错误');
  assert.match(inlineError[0], /没有口碑管理权限/);
  assert.match(inlineError[0], /bind:action="retry"/);
  // 公开态的「登录后查看评价资格」是玩家侧资格说明,不在本次商家闸范围内。
  assert.doesNotMatch(wxml, /登录后查看商家|登录后处理|cta="去登录"/, '商家整屏登录闸文案必须删除');
});

test('负控:管理态拒权退回整屏 cy-empty 时必须判红', () => {
  const wxml = read('pages/merchant/reviews/index.wxml');
  const mutated = wxml.replace(
    /<cy-inline-error\b[^>]*wx:elif="\{\{pageState === 'no-permission'\}\}"[^>]*\/>/,
    '<cy-empty wx:elif="{{pageState === \'no-permission\'}}" title="没有口碑管理权限" cta="去登录" />',
  );
  assert.notEqual(mutated, wxml, '负控锚点失效');
  assert.throws(() => {
    const inlineError = mutated.match(/<cy-inline-error\b[^>]*wx:elif="\{\{pageState === 'no-permission'\}\}"[^>]*\/>/);
    assert.ok(inlineError, '拒权必须有页内内联错误');
    assert.doesNotMatch(mutated, /cta="去登录"/);
  }, /拒权必须有页内内联错误/);
});

// M-14(2026-09-22 走查):空态说明直接露出状态码 ACTIVE。给商家看的文案不得出现工程枚举。
test('口碑页评价资格说明不外露工程状态码', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../../pages/merchant/reviews/index.wxml'), 'utf8')
  assert.doesNotMatch(wxml, /[一-龥][^<>{}]*\b(ACTIVE|REVOKED|PENDING)\b[^<>{}]*[一-龥]/)
  assert.match(wxml, /完成核销后才能评价/)
})
