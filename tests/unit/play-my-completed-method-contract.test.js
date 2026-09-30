const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const XCX_ROOT = path.resolve(__dirname, '../..');
const REPO_ROOT = path.resolve(XCX_ROOT, '..');

test('成长里程碑与后端 my-completed 使用同一个 POST 方法契约', () => {
  const page = fs.readFileSync(path.join(XCX_ROOT, 'pages/play/index.js'), 'utf8');
  const controller = fs.readFileSync(path.join(
    REPO_ROOT,
    'chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiPlayProgressController.java'
  ), 'utf8');

  assert.match(
    page,
    /url:\s*['"]\/api\/play\/my-completed['"]\s*,\s*method:\s*['"]POST['"]/,
    '前端里程碑请求必须按后端契约使用 POST'
  );
  assert.match(
    controller,
    /@PostMapping\("\/my-completed"\)/,
    '后端 my-completed 必须继续声明为 POST'
  );
});
