const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP_PATH = path.join(__dirname, '../../app.js');
const PREFLIGHT_PATH = path.join(__dirname, '../../scripts/preflight-release.js');
const AGREEMENT_PATH = path.join(__dirname, '../../utils/agreement-docs.js');
const LEGAL_GATE_PATH = path.join(__dirname, '../../scripts/release-legal-gate.js');

test('体验版和正式版启动时清理开发视角残留，不能让旧 storage 改写真实身份首页', () => {
  const source = fs.readFileSync(APP_PATH, 'utf8');
  assert.match(source, /if\s*\(!this\.isDevEnv\(\)\)\s*\{\s*wx\.removeStorageSync\(['"]debug_user_view['"]\)/,
    '非 develop 版本必须清掉 debug_user_view；微信升级会保留旧 storage');
});

test('负控：去掉非开发版清理会判红', () => {
  const source = fs.readFileSync(APP_PATH, 'utf8');
  const broken = source.replace(/if\s*\(!this\.isDevEnv\(\)\)\s*\{\s*wx\.removeStorageSync\(['"]debug_user_view['"]\);?\s*\}/, '');
  assert.throws(() => assert.match(broken, /if\s*\(!this\.isDevEnv\(\)\)\s*\{\s*wx\.removeStorageSync\(['"]debug_user_view['"]\)/));
});

test('独立发版闸覆盖注册地址和未成年人规则，且删任一项都会判红', () => {
  const preflight = fs.readFileSync(PREFLIGHT_PATH, 'utf8');
  assert.match(preflight, /validateAgreementDocs\(agreementDocs\)/);
  delete require.cache[require.resolve(LEGAL_GATE_PATH)];
  const { validateAgreementDocs } = require(LEGAL_GATE_PATH);
  const agreement = fs.readFileSync(AGREEMENT_PATH, 'utf8');
  assert.equal(validateAgreementDocs(agreement), '');
  for (const text of [
    '陕西省西安市高新区锦业路1号绿地领海B座6层604室A043号',
    '暂不面向未成年人提供注册和使用服务',
    '未满十八周岁',
  ]) {
    assert.notEqual(validateAgreementDocs(agreement.split(text).join('')), '', `${text} 被删时必须阻断`);
  }
});
