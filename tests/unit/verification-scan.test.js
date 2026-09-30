const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveVerificationScan } = require('../../utils/verification-scan.js');

test('团动态码只会路由到团核销端点', () => {
  const code = 'v1.900.group_55.1999999999999.7.signature';

  assert.deepEqual(resolveVerificationScan(code), {
    kind: 'group',
    code,
    url: '/api/verify/groupcode/redeem',
    data: { code },
    loadingTitle: '核销中...',
    successTitle: '已记录接待该团',
  });
});

test('玩家动态票不向小程序回传 type，而是交由服务端验签后决定', () => {
  const code = 'v1.900.activity.1999999999999.7.signature';

  assert.deepEqual(resolveVerificationScan(code), {
    kind: 'dynamic-ticket',
    code,
    url: '/api/registration/scan_dynamic_code',
    data: { code },
    loadingTitle: '验票中...',
    successTitle: '验票成功',
  });
});

test('旧 JSON 票码保持原有 type 加 code 契约', () => {
  assert.deepEqual(resolveVerificationScan('{"type":"activity","code":"VER-1"}'), {
    kind: 'legacy-ticket',
    code: 'VER-1',
    url: '/api/registration/scan_qr_code',
    data: { type: 'activity', code: 'VER-1' },
    loadingTitle: '验票中...',
    successTitle: '验票成功',
  });
});

test('真正认不出的动态码仍然只有「不支持」，不凭空长出指路', () => {
  assert.deepEqual(resolveVerificationScan('v1.900.whatever_55.1999999999999.7.signature'), {
    kind: 'invalid',
    message: '暂不支持此动态码',
  });
});

test('券出示码 cq1.* 路由到券核销端点，由服务端 HMAC 验签', () => {
  const code = 'cq1.301.1726380000.c2lnbmF0dXJl';

  assert.deepEqual(resolveVerificationScan(code), {
    kind: 'coupon',
    code,
    url: '/api/coupon/verification',
    data: { code },
    loadingTitle: '核销中...',
    successTitle: '核销成功',
  });
});

test('形似 cq1 但段数不对的码不进券核销端点', () => {
  assert.equal(resolveVerificationScan('cq1.301.1726380000').kind, 'invalid');
  assert.equal(resolveVerificationScan('cq1301.1726380000.sig.x').kind, 'invalid');
});

// 据点码的核销在另一个端点，护栏必须继续把它挡在这张共享路由表外面；
// 但挡下之后要说清「码没坏、是入口不对」，并给出可跳转的出口（F-RM-1 / #20）。
test('据点码不进验票端点，但带一句指路与可跳转出口', () => {
  const scan = resolveVerificationScan('v1.900.citynode_55.1999999999999.7.signature');

  assert.equal(scan.kind, 'invalid', '绝不能被任何宿主当成可核销码送进端点');
  assert.equal(scan.url, undefined);
  assert.match(scan.message, /城市据点/);
  assert.equal(scan.path, '/pages/merchant/citynode/index');
  assert.equal(scan.confirmText, '去据点页');

  // 指路不能指向一个不存在的页面 —— 那比不指路更糟。
  const appJson = require('../../app.json');
  const registered = (appJson.pages || []).concat(
    (appJson.subPackages || appJson.subpackages || []).reduce((acc, pkg) => acc.concat(
      (pkg.pages || []).map((p) => pkg.root + '/' + p)
    ), [])
  ).map((p) => '/' + p.replace(/^\//, ''));
  assert.ok(registered.indexOf(scan.path) >= 0, scan.path + ' 必须已在 app.json 注册');
});

// F-RM-3 / #22:两处出码口的 ttlMs 兜底原来各写一份(300s 与 60s,差 5 倍)。
// 真值只有一档,分叉的表现是「码一直在换」而不是明确报错,所以钉在尺子上。
test('出码口的兜底 TTL 只有这一个真源,且等于服务端签发口径', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const issuers = [
    'subpackageRoam/citynode-code/index.js',
    'pages/merchant/game-node/index.js',
  ];
  for (const rel of issuers) {
    const src = fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
    assert.match(src, /ttlMs \|\| DYN_TTL_MS/, rel + ' 必须用共享常量兜底');
    assert.doesNotMatch(src, /ttlMs \|\| \d/, rel + ' 不许再写裸数字兜底');
  }
  assert.equal(require('../../utils/verification-scan.js').DYN_TTL_MS, 300_000,
    'ApiVerifyController.java:45 DYN_TTL_MS = 300_000L,前端兜底不得另立一档');
});
