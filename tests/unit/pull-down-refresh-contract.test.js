const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');

test('有 onPullDownRefresh 的页面必须开 enablePullDownRefresh,且 handler 不能是空壳', () => {
  const walk = (dir, out) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) { if (name !== 'node_modules') walk(full, out); }
      else if (name.endsWith('.js')) out.push(full);
    }
    return out;
  };
  const roots = fs.readdirSync(root).filter((n) => n === 'pages' || n.startsWith('subpackage'));
  const files = roots.flatMap((r) => walk(path.join(root, r), []));
  const offenders = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const m = src.match(/onPullDownRefresh\s*\([^)]*\)\s*\{([\s\S]*?)\n\s*\},?/);
    if (!m) continue;
    const rel = path.relative(root, file);
    if (!m[1].trim()) { offenders.push(rel + ':空 handler'); continue; }
    const jsonPath = file.replace(/\.js$/, '.json');
    if (!fs.existsSync(jsonPath)) continue;
    const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    if (json.component) continue;
    if (json.enablePullDownRefresh !== true) offenders.push(rel + ':json 没开 enablePullDownRefresh');
  }
  // 反向:开了下拉却没 handler,下拉圈会转到超时才收
  for (const file of files) {
    const jsonPath = file.replace(/\.js$/, '.json');
    if (!fs.existsSync(jsonPath)) continue;
    const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    if (json.enablePullDownRefresh !== true) continue;
    if (!/onPullDownRefresh\s*\(/.test(fs.readFileSync(file, 'utf8'))) offenders.push(path.relative(root, file) + ':开了 enablePullDownRefresh 却没有 onPullDownRefresh');
  }
  assert.deepEqual(offenders, []);
});
