const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const JS_PATH = path.join(__dirname, '../../pages/agreement/index.js');
const WXML_PATH = path.join(__dirname, '../../pages/agreement/index.wxml');
// 2026-07-31:协议文本抽到 utils/agreement-docs.js 作为单一真源(路由页 + 全屏弹窗共用),
// 故「文档内容」类断言跟着搬到真源文件上;「页面行为」类断言仍钉在页面上。
const DOCS_PATH = path.join(__dirname, '../../utils/agreement-docs.js');
const BACKEND_CONFIG_PATH = path.join(__dirname, '../../../chengyinhub-admin/src/main/resources/application.yml');
const SHEET_WXML_PATH = path.join(__dirname, '../../components/cy/agreement-sheet/index.wxml');
const SHEET_JS_PATH = path.join(__dirname, '../../components/cy/agreement-sheet/index.js');

function assertAgreementContract(docs, source, wxml) {
  // ① 两份文档 + 未知 type 回退 —— 现在归 utils/agreement-docs.js
  assert.match(docs, /user_agreement:\s*\{/);
  assert.match(docs, /cancellation_notice:\s*\{/);
  assert.match(docs, /DOCS\[key\]\s*\?\s*key\s*:\s*DEFAULT_TYPE/);
  // ② 提审包必须是已定稿文本，不能再把占位说明展示给用户
  assert.doesNotMatch(docs, /占位版本|占位文案|占位说明|正式条款以|最终发布版|法务\/律师最终版本/);
  assert.match(docs, /西安吾令文化传媒有限公司/);
  assert.match(docs, /陕西省西安市高新区锦业路1号绿地领海B座6层604室A043号/);
  assert.match(docs, /15229020419/);
  assert.match(docs, /2026-08-12/);
  assert.match(docs, /version:\s*'v2\.2'/);
  assert.match(docs, /version:\s*'v2\.1'/);
  assert.match(docs, /未满十八周岁/);
  assert.match(docs, /暂不面向未成年人提供注册和使用服务/);
  assert.match(docs, /七日冷静期/);
  // ③ 页面行为:原生标题跟着 doc 走,正文按 sections 渲染,生效日期在文末
  assert.match(source, /wx\.setNavigationBarTitle\(\{\s*title:\s*doc\.title\s*\}\)/);
  assert.match(wxml, /wx:for="\{\{doc\.sections\}\}"/);
  assert.match(wxml, /生效日期/);
}

function assertRouteUsesCanonicalTypeResolver(source) {
  assert.match(
    source,
    /const\s+\{[^}]*\bgetDoc\b[^}]*\bresolveKey\b[^}]*\}\s*=\s*require\(['"][^'"]*agreement-docs\.js['"]\)/,
    '协议路由页必须消费 agreement-docs 的统一 type 解析器，不能自行绕过别名映射',
  );
  assert.match(source, /const\s+doc\s*=\s*getDoc\(type\)/,
    '路由 query 必须经 getDoc 解析，?type=deregister 才会展示账号注销须知');
  assert.match(source, /const\s+docType\s*=\s*resolveKey\(type\)/,
    'Back 兜底必须使用与正文相同的解析 key，不能把 deregister 送回设置页');
  assert.doesNotMatch(source, /const\s+doc\s*=\s*DOCS\[type\]/,
    '禁止直接按原始 query 查 DOCS：短别名会静默回退成用户服务协议');
}

function loadAgreementPage() {
  const oldPage = global.Page;
  const oldWx = global.wx;
  const observed = { titles: [], redirects: [] };
  let definition;

  global.Page = (page) => { definition = page; };
  global.wx = {
    setNavigationBarTitle({ title }) { observed.titles.push(title); },
    navigateBack({ fail }) { fail(); },
    redirectTo({ url }) { observed.redirects.push(url); },
  };
  try {
    delete require.cache[require.resolve(JS_PATH)];
    require(JS_PATH);
  } catch (error) {
    if (oldPage === undefined) delete global.Page;
    else global.Page = oldPage;
    if (oldWx === undefined) delete global.wx;
    else global.wx = oldWx;
    delete require.cache[require.resolve(JS_PATH)];
    throw error;
  }

  return {
    definition,
    observed,
    restore() {
      if (oldPage === undefined) delete global.Page;
      else global.Page = oldPage;
      if (oldWx === undefined) delete global.wx;
      else global.wx = oldWx;
      delete require.cache[require.resolve(JS_PATH)];
    },
  };
}

// 弹窗与路由页必须消费同一份真源,不许自己再抄一份法律文本
function assertSheetSharesSource(sheetJs, sheetWxml, docs) {
  assert.match(sheetJs, /require\(['"][^'"]*utils\/agreement-docs\.js['"]\)/,
    '全屏协议弹窗必须从 utils/agreement-docs.js 取文本');
  assert.doesNotMatch(sheetJs, /一、协议的接受与变更/,
    '弹窗里不得内联抄一份法律条款正文(两份必然改一处漏一处)');
  assert.match(sheetWxml, /wx:for="\{\{doc\.sections\}\}"/);
  assert.match(sheetWxml, /生效日期/);
  // 短别名两条都要在真源里注册,否则弹窗传 type="service" 会静默回退成默认文档
  assert.match(docs, /service:\s*'user_agreement'/);
  assert.match(docs, /deregister:\s*'cancellation_notice'/);
}

test('协议文本覆盖用户协议、注销须知与未知 type 回退', () => {
  assertAgreementContract(
    fs.readFileSync(DOCS_PATH, 'utf8'),
    fs.readFileSync(JS_PATH, 'utf8'),
    fs.readFileSync(WXML_PATH, 'utf8'),
  );
});

test('提审协议包含已确认的运营主体、联系方式、生效日和未成年人规则', () => {
  assertAgreementContract(
    fs.readFileSync(DOCS_PATH, 'utf8'),
    fs.readFileSync(JS_PATH, 'utf8'),
    fs.readFileSync(WXML_PATH, 'utf8'),
  );
});

test('前后端法律文档版本一致，留痕不会继续记到旧版本', () => {
  const docs = fs.readFileSync(DOCS_PATH, 'utf8');
  const backend = fs.readFileSync(BACKEND_CONFIG_PATH, 'utf8');
  assert.match(docs, /user_agreement:\s*\{[\s\S]*?version:\s*'v2\.2'/);
  assert.match(docs, /cancellation_notice:\s*\{[\s\S]*?version:\s*'v2\.1'/);
  assert.match(backend, /user_service_agreement:\s*v2\.2/);
  assert.match(backend, /account_cancellation_notice:\s*v2\.1/);
});

test('协议路由页通过统一解析器处理 deregister 短别名与 Back caller', () => {
  const source = fs.readFileSync(JS_PATH, 'utf8');
  const { getDoc, resolveKey } = require(DOCS_PATH);

  assert.equal(getDoc('deregister').title, '账号注销须知');
  assert.equal(resolveKey('deregister'), 'cancellation_notice');
  assert.equal(resolveKey('unknown-type'), 'user_agreement');
  assertRouteUsesCanonicalTypeResolver(source);
});

test('协议路由页将 deregister 同时解析为注销正文和注销页 Back 兜底', () => {
  const page = loadAgreementPage();
  try {
    const context = {
      data: { ...page.definition.data },
      setData(update) { Object.assign(this.data, update); },
    };

    page.definition.onLoad.call(context, { type: 'deregister' });
    assert.equal(context.data.doc.title, '账号注销须知');
    assert.equal(context.data.docType, 'cancellation_notice');
    assert.deepEqual(page.observed.titles, ['账号注销须知']);

    page.definition.onBack.call(context);
    assert.deepEqual(page.observed.redirects, ['/pages/deregister/index']);
  } finally {
    page.restore();
  }
});

test('全屏协议弹窗与路由页共用同一份文本真源', () => {
  assertSheetSharesSource(
    fs.readFileSync(SHEET_JS_PATH, 'utf8'),
    fs.readFileSync(SHEET_WXML_PATH, 'utf8'),
    fs.readFileSync(DOCS_PATH, 'utf8'),
  );
});

test('协议契约的变异负控确实能变红', () => {
  const docs = fs.readFileSync(DOCS_PATH, 'utf8');
  const source = fs.readFileSync(JS_PATH, 'utf8');
  const wxml = fs.readFileSync(WXML_PATH, 'utf8');

  // 删掉注销须知这份文档
  assert.throws(
    () => assertAgreementContract(docs.replace(/cancellation_notice:\s*\{/, 'cancellation_removed: {'), source, wxml),
    /cancellation_notice/,
  );
  // 把占位说明加回提审文本
  assert.throws(() => assertAgreementContract(docs + '\n// 占位版本', source, wxml));
  // 摘掉运营主体
  assert.throws(() => assertAgreementContract(docs.replace(/西安吾令文化传媒有限公司/g, '运营方'), source, wxml));
  // 弹窗改成自己内联抄一份法律文本
  assert.throws(() => assertSheetSharesSource(
    fs.readFileSync(SHEET_JS_PATH, 'utf8') + "\nconst COPY = [{ h: '一、协议的接受与变更' }];\n",
    fs.readFileSync(SHEET_WXML_PATH, 'utf8'),
    docs,
  ));
  // 弹窗不再 require 真源
  assert.throws(() => assertSheetSharesSource(
    fs.readFileSync(SHEET_JS_PATH, 'utf8').replace(/require\([^)]*agreement-docs\.js[^)]*\)/, '{}'),
    fs.readFileSync(SHEET_WXML_PATH, 'utf8'),
    docs,
  ));
  assert.throws(() => assertRouteUsesCanonicalTypeResolver(
    source.replace('const doc = getDoc(type);', 'const doc = DOCS[type] || DOCS.user_agreement;'),
  ));
});
