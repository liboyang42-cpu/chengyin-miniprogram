const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildGroupCodeIssuePayload, listGroupCodeActivities } = require('../../utils/group-code-session.js');

test('团核销码签发只携带具体活动场次，不把主题ID当场次ID', () => {
  assert.deepEqual(buildGroupCodeIssuePayload('42'), { activityId: 42 });
});

test('同名活动用本地月日和时间区分场次，缺时间字段保留旧名称', () => {
  const activities = listGroupCodeActivities([
    { id: 11, name: 'E2E 探店日一期', startDate: '2026-09-21 10:00:00' },
    { id: 12, name: 'E2E 探店日一期', startDate: '2026-09-22', startTime: '14:30' },
    { id: 13, name: 'E2E 探店日一期', startDate: '2026-09-23' },
    { id: 14, name: 'E2E 探店日一期', startTime: '16:00' },
  ]);

  assert.deepEqual(activities, [
    { id: 11, name: 'E2E 探店日一期 · 9月21日 10:00' },
    { id: 12, name: 'E2E 探店日一期 · 9月22日 14:30' },
    { id: 13, name: 'E2E 探店日一期' },
    { id: 14, name: 'E2E 探店日一期' },
  ]);
});
