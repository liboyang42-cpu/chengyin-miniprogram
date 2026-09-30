const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  analyzePrivacyContract,
  verifyPackageInfo,
  parseBytes,
  collectUsedLocationApis,
  stripJavaScriptComments,
  stripWxmlComments,
  main,
} = require('../../scripts/wechat-release-contract');

const BASE_APP = {
  requiredPrivateInfos: [
    'chooseLocation',
    'choosePoi',
    'getLocation',
    'onLocationChange',
    'startLocationUpdate',
  ],
  permission: {
    'scope.userLocation': { desc: '用于附近活动推荐及游玩中到点打卡判定' },
  },
};

const BASE_SOURCE = [
  {
    path: 'app.js',
    content: 'wx.onNeedPrivacyAuthorization(function () {}); wx.openPrivacyContract({});',
  },
  {
    path: 'pages/privacy/index.wxml',
    content: '<button open-type="agreePrivacyAuthorization" bindagreeprivacyauthorization="agreePrivacy">同意</button>',
  },
  {
    path: 'pages/play/index.js',
    content: 'wx.getLocation({}); wx.startLocationUpdate({}); wx.onLocationChange(function () {});',
  },
  {
    path: 'pages/publish/index.js',
    content: 'wx.chooseLocation({}); wx.choosePoi({});',
  },
];

test('privacy contract passes when every location API is declared and consent chain exists', () => {
  const result = analyzePrivacyContract(BASE_APP, BASE_SOURCE);
  assert.equal(result.ok, true);
  assert.deepEqual(result.usedApis, [
    'chooseLocation',
    'choosePoi',
    'getLocation',
    'onLocationChange',
    'startLocationUpdate',
  ]);
  assert.deepEqual(result.missingDeclarations, []);
  assert.deepEqual(result.missingConsentPieces, []);
});

test('privacy contract turns red when a used location API is removed from app.json', () => {
  const app = { ...BASE_APP, requiredPrivateInfos: BASE_APP.requiredPrivateInfos.filter((name) => name !== 'choosePoi') };
  const result = analyzePrivacyContract(app, BASE_SOURCE);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingDeclarations, ['choosePoi']);
});

test('privacy contract ignores commented-out API examples', () => {
  const source = [
    ...BASE_SOURCE,
    { path: 'utils/example.js', content: '// wx.chooseAddress({});\n/* wx.startLocationUpdate({}); */' },
  ];
  const result = analyzePrivacyContract(BASE_APP, source);
  assert.equal(result.ok, true);
  assert.deepEqual(result.usedApis, [
    'chooseLocation',
    'choosePoi',
    'getLocation',
    'onLocationChange',
    'startLocationUpdate',
  ]);
});

test('privacy contract detects wx aliases and bracket API calls', () => {
  const source = [
    ...BASE_SOURCE,
    { path: 'pages/alias/index.js', content: 'const api = wx; api["chooseAddress"]({});' },
  ];
  const result = analyzePrivacyContract({
    ...BASE_APP,
    requiredPrivateInfos: [...BASE_APP.requiredPrivateInfos, 'chooseAddress'],
  }, source);
  assert.equal(result.ok, true);
  assert.equal(result.usedApis.includes('chooseAddress'), true);
  assert.deepEqual(collectUsedLocationApis([
    { path: 'x.js', content: 'const api = wx; api.getFuzzyLocation({});' },
  ]), ['getFuzzyLocation']);
  assert.deepEqual(collectUsedLocationApis([
    { path: 'x.js', content: 'var _wx = resolveWx(env); _wx.choosePoi({});' },
  ]), ['choosePoi']);
});

test('privacy contract does not accept consent markup hidden in WXML comments', () => {
  const source = BASE_SOURCE.map((file) => file.path.endsWith('.wxml')
    ? { ...file, content: '<!-- <button open-type="agreePrivacyAuthorization">同意</button> -->' }
    : file);
  const result = analyzePrivacyContract(BASE_APP, source);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingConsentPieces, ['agreePrivacyAuthorization button and callback binding']);
  assert.equal(stripWxmlComments(source[1].content).includes('agreePrivacyAuthorization'), false);
});

test('privacy contract requires a real button and authorization callback binding', () => {
  const noBinding = BASE_SOURCE.map((file) => file.path.endsWith('.wxml')
    ? { ...file, content: '<button open-type="agreePrivacyAuthorization">同意</button>' }
    : file);
  assert.deepEqual(analyzePrivacyContract(BASE_APP, noBinding).missingConsentPieces,
    ['agreePrivacyAuthorization button and callback binding']);

  const notButton = BASE_SOURCE.map((file) => file.path.endsWith('.wxml')
    ? { ...file, content: '<view open-type="agreePrivacyAuthorization" bindagreeprivacyauthorization="agreePrivacy">同意</view>' }
    : file);
  assert.deepEqual(analyzePrivacyContract(BASE_APP, notButton).missingConsentPieces,
    ['agreePrivacyAuthorization button and callback binding']);
});

test('comment stripper removes strings and comments without manufacturing API calls', () => {
  assert.equal(stripJavaScriptComments('const s = "wx.getLocation({})"; // wx.choosePoi({})'), 'const s = ; ');
});

test('privacy contract turns red when the official consent chain is incomplete', () => {
  const source = BASE_SOURCE.filter(({ path }) => path !== 'pages/privacy/index.wxml');
  const result = analyzePrivacyContract(BASE_APP, source);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingConsentPieces, ['agreePrivacyAuthorization button and callback binding']);
});

test('privacy contract reports missing JavaScript consent hooks independently', () => {
  const noHook = BASE_SOURCE.map((file) => file.path === 'app.js'
    ? { ...file, content: 'wx.openPrivacyContract({});' }
    : file);
  assert.deepEqual(analyzePrivacyContract(BASE_APP, noHook).missingConsentPieces,
    ['onNeedPrivacyAuthorization or getPrivacySetting hook']);

  const noContract = BASE_SOURCE.map((file) => file.path === 'app.js'
    ? { ...file, content: 'wx.onNeedPrivacyAuthorization(function () {});' }
    : file);
  assert.deepEqual(analyzePrivacyContract(BASE_APP, noContract).missingConsentPieces,
    ['openPrivacyContract call']);
});

test('package info accepts byte values and enforces official per-package and total limits', () => {
  const result = verifyPackageInfo({
    mainPackage: { size: 1.7 * 1024 * 1024 },
    subPackages: [
      { name: 'subpackageA', size: 1.2 * 1024 * 1024 },
      { name: 'subpackageB', size: 1.1 * 1024 * 1024 },
    ],
  }, {
    packageRoots: ['subpackageA', 'subpackageB'],
    internalMainLimitBytes: 1.8 * 1024 * 1024,
  });
  assert.equal(result.ok, true);
  assert.equal(result.totalBytes, (1.7 + 1.2 + 1.1) * 1024 * 1024);
  assert.deepEqual(result.violations, []);
});

test('package info accepts DevTools size.total/packages shape and package aliases', () => {
  const result = verifyPackageInfo({
    size: {
      total: '4MB',
      packages: [
        { name: 'main', size: '1.5MB' },
        { name: 'subpackageA', size: '1.2MB' },
        { name: 'subpackageB', size: '1.3MB' },
      ],
    },
  }, { packageRoots: ['subpackageA', 'subpackageB'] });
  assert.equal(result.ok, true);
  assert.equal(result.reportedTotalBytes, 4 * 1024 * 1024);
  assert.equal(result.totalBytes, 4 * 1024 * 1024);
});

test('package info accepts miniprogram-ci subPackageInfo __APP__/__FULL__ records', () => {
  const result = verifyPackageInfo({
    subPackageInfo: [
      { name: '__APP__', size: 1.5 * 1024 * 1024 },
      { name: '__FULL__', size: 2.5 * 1024 * 1024 },
      { name: 'subpackagePlay', size: 1 * 1024 * 1024 },
    ],
  }, { packageRoots: [{ root: 'pages/play', name: 'subpackagePlay' }] });
  assert.equal(result.ok, true);
  assert.equal(result.mainBytes, 1.5 * 1024 * 1024);
  assert.equal(result.reportedTotalBytes, 2.5 * 1024 * 1024);
  assert.equal(result.totalBytes, 2.5 * 1024 * 1024);
});

test('package info reads nested size objects and rejects a mismatched reported total', () => {
  const result = verifyPackageInfo({
    main: { size: { bytes: 1024 } },
    subPackages: [{ root: 'subpackageA', size: { sizeBytes: 1024 } }],
    total: 999,
  }, { packageRoots: ['subpackageA'] });
  assert.equal(result.ok, false);
  assert.equal(result.totalBytes, 2048);
  assert.equal(result.reportedTotalBytes, 999);
  assert.deepEqual(result.violations, ['reported total package size does not match package entries']);
});

test('package info turns red for an oversized subpackage and total, while internal main target remains a warning', () => {
  const result = verifyPackageInfo({
    mainPackage: { size: '1.90MB' },
    subPackages: [
      { name: 'subpackageA', size: '2.01MB' },
      { name: 'subpackageB', size: '28MB' },
    ],
  }, {
    packageRoots: ['subpackageA', 'subpackageB'],
    internalMainLimitBytes: 1.8 * 1024 * 1024,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.violations, [
    'subpackageA exceeds official 2M limit',
    'subpackageB exceeds official 2M limit',
    'all packages exceed official 30M limit',
  ]);
  assert.deepEqual(result.warnings, ['main package reaches internal 1.8M target']);
});

test('package info warns but stays green at the internal 1.8M target', () => {
  const result = verifyPackageInfo({ mainPackage: { size: 1.8 * 1024 * 1024 } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.warnings, ['main package reaches internal 1.8M target']);
});

test('CLI keeps the official 2MiB limit blocking but reports an internal-target-only overage as WARN', () => {
  const app = require('../../app.json');
  const roots = app.subPackages || [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-contract-two-tier-'));
  const script = path.resolve(__dirname, '../../scripts/wechat-release-contract.js');
  const writeInfo = (name, mainSize) => {
    const infoPath = path.join(dir, name);
    fs.writeFileSync(infoPath, JSON.stringify({
      mainPackage: { size: mainSize },
      subPackages: roots.map((item) => ({ root: item.root, size: 1 })),
    }));
    return infoPath;
  };

  try {
    const officialOver = spawnSync(process.execPath, [script, '--info', writeInfo('official-over.json', 2 * 1024 * 1024 + 1)], {
      cwd: path.resolve(__dirname, '../..'), encoding: 'utf8',
    });
    assert.equal(officialOver.status, 1);
    assert.match(officialOver.stdout, /package size: FAIL/);
    assert.match(officialOver.stdout, /main package exceeds official 2M limit/);

    const internalOnly = spawnSync(process.execPath, [script, '--info', writeInfo('internal-only.json', 1_984_395)], {
      cwd: path.resolve(__dirname, '../..'), encoding: 'utf8',
    });
    assert.equal(internalOnly.status, 0);
    assert.match(internalOnly.stdout, /package size: WARN/);
    assert.match(internalOnly.stdout, /current=1,984,395 bytes/);
    assert.match(internalOnly.stdout, /internal target=1,887,437 bytes/);
    assert.match(internalOnly.stdout, /official margin=112,757 bytes/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('package info fails closed when a package size is missing', () => {
  const result = verifyPackageInfo({
    mainPackage: { size: 100 },
    subPackages: [{ name: 'subpackageA' }],
  }, { packageRoots: ['subpackageA'] });
  assert.equal(result.ok, false);
  assert.deepEqual(result.violations, ['subpackageA size is missing or invalid']);
});

test('package info fails closed when the main package size is missing', () => {
  const result = verifyPackageInfo({}, { packageRoots: [] });
  assert.equal(result.ok, false);
  assert.deepEqual(result.violations, ['main package size is missing or invalid']);
});

test('byte parser rejects ambiguous values instead of guessing', () => {
  assert.equal(parseBytes(1024), 1024);
  assert.equal(parseBytes('1.5MB'), 1.5 * 1024 * 1024);
  assert.equal(parseBytes('1.5 MiB'), 1.5 * 1024 * 1024);
  assert.equal(parseBytes('unknown'), null);
  assert.equal(parseBytes(-1), null);
  assert.equal(parseBytes('2KiB'), 2 * 1024);
  assert.equal(parseBytes({ size: 1 }), null);
});

test('CLI source-only mode and info-output mode return a verifiable status', () => {
  assert.equal(main([]), 2);
  assert.equal(main(['--source-only']), 0);
  assert.equal(main(['--source-only'], path.join(os.tmpdir(), 'missing-wechat-project')), 2);

  const app = require('../../app.json');
  const packageInfo = {
    mainPackage: { size: 1 * 1024 * 1024 },
    subPackages: (app.subPackages || []).map((item) => ({ root: item.root, size: 1 })),
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-contract-'));
  const infoPath = path.join(dir, 'info.json');
  fs.writeFileSync(infoPath, JSON.stringify(packageInfo));
  try {
    assert.equal(main(['--info', infoPath]), 0);
    assert.equal(main(['--info', path.join(dir, 'missing.json')]), 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
