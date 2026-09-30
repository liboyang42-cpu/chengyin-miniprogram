const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../../pages/roam/index.js'), 'utf8');

test('漫游退出即使启动成功回调尚未到达，也必须释放 tracker 并同步关闭实时定位状态', () => {
  assert.match(
    source,
    /_stopReal\(\)\s*\{\s*bgTracker\.release\(['"]roam['"]\);[\s\S]*?this\._realOn\s*=\s*false;[\s\S]*?this\._onRealLoc\s*=\s*null;/,
    '_realOn 只表示页面回调已完成，不能阻止释放或留下回调句柄'
  );
  assert.doesNotMatch(source, /_stopReal\(\)\s*\{\s*bgTracker\.release\(['"]roam['"]\);\s*if\s*\(!this\._realOn\)\s*return;/);
  assert.doesNotMatch(source, /setData\(\{\s*gpsMode:/, 'gpsMode 不再是可见字段，停止定位不能写隐藏状态');
});
