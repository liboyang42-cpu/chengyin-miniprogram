const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveLeadMemberTicket } = require('../../pages/play/utils/lead-ticket-scan.js');

test('带队核销保留动态主题票原串，由服务端验签后分流', () => {
  const code = 'v1.900.topic.1999999999999.7.signature';
  assert.deepEqual(resolveLeadMemberTicket(code), { code, error: '' });
});

test('带队核销解包旧 JSON 主题票', () => {
  assert.deepEqual(resolveLeadMemberTicket('{"type":"topic","code":"VER-1"}'), {
    code: 'VER-1', error: ''
  });
});

test('带队核销前端拒绝旧 JSON 场次票', () => {
  assert.deepEqual(resolveLeadMemberTicket('{"type":"activity","code":"VER-2"}'), {
    code: '', error: '本场次只可核销主题票'
  });
});
