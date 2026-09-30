'use strict';

const assert = require('assert');
const test = require('node:test');
const { activityStatusMeta, activityStatusText } = require('../../utils/activity-status');

// 这里断的是**产品裁决**(哪个状态配哪种色),不是实现细节,所以逐档写死是对的 ——
// 和「写死某个 hex」那类字面量断言不是一回事:变了就该有人来这里显式改一次。
// 2026-08-05 用户裁决(规范真源 §4):进行中=绿。status=3 由 blue 改 green。
// 2026-09-01 状态胶囊从 cy-tag 迁到 cy-badge,variant 改用 cy-badge 的词表:
// blue→info、green→success、mono/done→neutral。**颜色裁决一个没变**,变的是名字 ——
// cy-tag 的 done 与 mono 只差字色(body vs secondary)同底色,cy-badge 没有这档区分,
// 这是本次唯一被合并掉的东西,视觉上可忽略。
test('公开活动状态保留列表的文案、标签语义与 live 判定', () => {
  assert.deepStrictEqual(activityStatusMeta(2), { text: '报名中', variant: 'info', live: true });
  assert.deepStrictEqual(activityStatusMeta('3'), { text: '进行中', variant: 'success', live: true });
  assert.deepStrictEqual(activityStatusMeta(1), { text: '即将开始', variant: 'neutral', live: false });
  assert.deepStrictEqual(activityStatusMeta(9), { text: '已下线', variant: 'neutral', live: false });
});

test('发布者视图保留待发布与草稿的专属文案', () => {
  assert.strictEqual(activityStatusText(0, 'owner'), '草稿');
  assert.strictEqual(activityStatusText(1, 'owner'), '待发布');
  assert.strictEqual(activityStatusText(2, 'owner'), '报名中');
  assert.strictEqual(activityStatusText(9, 'owner'), '已下线');
});

test('未知状态不会伪造已结束文案', () => {
  assert.deepStrictEqual(activityStatusMeta(999), { text: '', variant: 'neutral', live: false });
  assert.strictEqual(activityStatusText(999, 'owner'), '');
});
