/**
 * 组件/资源路径门禁:三条判据。
 *
 * ① usingComponents 里的每条路径必须真能解析到一个组件目录。
 *    为什么:2026-09-04 把 11 个 club-* 组件从主包下沉到 pages/club 分包时,
 *    组件内部那些 `../scene-sheet/index` 相对路径全部指错了 —— 而**所有既有门禁都是绿的**,
 *    只有微信编译器在 upload 时才报「路径下未找到组件」,而上传本身还 exit 0。
 *    判据很笨但够用:把路径解析成磁盘目录,要求 index.json 存在。
 *      绝对路径 `/components/cy/x/index`  -> <root>/components/cy/x/index.json
 *      相对路径 `../x/index`              -> 相对该 json 所在目录解析
 *
 * ② 主包 json 不许引用分包内的组件(2026-09-16 加)。
 *    实证:components/cy/scene-deep-link(主包)引了 pages/play 与 subpackageA 里的 3 个场景组件,
 *    真机控制台报「Component is not found in path ...」,对应分支整个不出正文。
 *
 * ③ 主包**任何文件**不许引用分包内的**资源**(2026-09-16 加)。
 *    实证:post-card(主包组件)的 wxml 引 pages/square/images 的图标;主包先于分包下载,
 *    真机拿不到,只在总控人肉巡查时才被发现 —— 既有门禁只管 usingComponents,管不到资源。
 *    规则同一句话:**分包可以引主包,主包不能引分包**。
 *    覆盖:wxml 的 src/url(含 `{{...}}` 里的字面量兜底)、wxss 的 url()/@import、
 *    js/wxs 的 require/import 与资源扩展名字符串、app.json 的 tabBar 图标。
 *    **先剥注释再扫**:注释里写路径不算引用(否则文档注释会误判)。
 *    存量 2 条已知债见 KNOWN_CROSS_REFS(已出清单,修它会动主包资源棘轮,待总控决定)。
 *
 * ④ 分包**之间**不许互相引用资源(2026-09-16 加,同第三类判据同一次全扫发现)。
 *    实证:pages/merchant 引 pages/topic/images/icon_copy.svg,两个分包谁先下载不确定,
 *    目标分包未下载时图标白。同一分包内引用、分包引主包均合法。
 *    本基线全扫为 0 条,故无债单,新增一条即判红。
 *
 * 用法:node scripts/component-path-resolve-lint.js
 *      node scripts/component-path-resolve-lint.js --selftest
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', 'artifacts', 'docs', 'tests', 'scripts', 'design', 'miniprogram_npm']);
const RESOURCE_EXT = /\.(?:png|jpe?g|gif|svg|webp|bmp|mp3|mp4|m4a|wav|aac|ttf|otf|woff2?)$/i;
const EXTERNAL = /^(?:https?:|data:|cloud:|wxfile:|plugin:|wxc-|weui-|\/\/)/;

function collectJson(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink()) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) collectJson(p, out); continue; }
    if (e.name.endsWith('.json')) out.push(p);
  }
  return out;
}

function collectSources(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink()) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) collectSources(p, out); continue; }
    if (/\.(wxml|wxss|js|wxs|json)$/i.test(e.name)) out.push(p);
  }
  return out;
}

// ⚠️ root 必须由调用方传进来,不能用模块级 ROOT ——
//    自证跑在临时目录上,写死 ROOT 会让绿的那条也判红(第一版就是这么错的)。
function resolveTarget(root, jsonFile, value) {
  const v = String(value);
  if (/^plugin:|^wxc-|^weui-/.test(v)) return null;            // 插件/内置,不落磁盘
  const base = v.startsWith('/') ? path.join(root, v.slice(1)) : path.resolve(path.dirname(jsonFile), v);
  return base + '.json';
}

function subPackageRoots(root) {
  try {
    const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
    return (app.subPackages || app.subpackages || [])
      .map((pkg) => String(pkg.root || '').replace(/^\/|\/$/g, ''))
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

/** 这个仓库相对路径属于哪个分包;主包(或不在任何分包里)返回 '' */
function ownerOf(rel, roots) {
  const clean = String(rel).replace(/^\//, '');
  return roots.find((r) => clean === r || clean.startsWith(r + '/')) || '';
}

function lint(root = ROOT) {
  const bad = [];
  const cross = [];
  const roots = subPackageRoots(root);
  let checked = 0;
  for (const f of collectJson(root, [])) {
    let j;
    try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { continue; }
    const fromRel = path.relative(root, f);
    const fromOwner = ownerOf(fromRel, roots);
    for (const [name, value] of Object.entries(j.usingComponents || {})) {
      const target = resolveTarget(root, f, value);
      if (!target) continue;
      checked += 1;
      if (!fs.existsSync(target)) {
        bad.push({ file: fromRel, name, value: String(value), target: path.relative(root, target) });
        continue;
      }
      const toRel = path.relative(root, target);
      const toOwner = ownerOf(toRel, roots);
      if (!fromOwner && toOwner) {
        cross.push({ file: fromRel, name, value: String(value), target: toRel, owner: toOwner });
      }
    }
  }
  const { hits: crossRefs, crossPkg, missingRefs } = collectCrossRefs(root, roots);
  return { bad, cross, crossRefs, crossPkg, missingRefs, checked };
}

/* ---------------- 第三类判据:主包引用分包资源 ---------------- */

/* 存量债(2026-09-16 全扫发现,清单在《修复交接材料/worktree收口_0915/主包引分包资源全扫_报告.md》)。
   修法都要把资源挪进主包 / 改服务端,会动主包资源棘轮(tests/unit 里 ASSET_CEILING 只准降),
   待总控决定;决定前按 WARN 输出,不判红。名单外一条都判红。清单条目对应的违例修掉后,直接删行。 */
const KNOWN_CROSS_REFS = [
  { file: 'pages/publish/utils/publish/route-map-view.js', value: '/pages/publish/images/map-pin.png' },     // 到期 2026-10-16 · 修法:随文件下沉到唯一调用分包
];

function isKnownDebt(hit) {
  return KNOWN_CROSS_REFS.some((k) => k.file === hit.file && k.value === hit.value);
}

/** wxml 属性值:`{{x || '/a.png'}}` 里抽出字符串字面量;普通值原样返回 */
function attrLiterals(value) {
  if (!value.includes('{{')) return [value];
  const out = [];
  for (const m of value.matchAll(/'([^']*)'|"([^"]*)"/g)) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
}

/** 剥注释(lite 版:按引号状态机走,字符串里的 `//` `/*` 不动),行号不丢 */
function stripComments(src, kind) {
  if (kind === 'wxml') return src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  let out = '';
  let i = 0;
  let quote = '';
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\' && d !== undefined) { out += d; i += 2; continue; }
      if (c === quote) quote = '';
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i += 1; continue; }
    if (c === '/' && d === '/') { const j = src.indexOf('\n', i); i = j < 0 ? src.length : j; continue; }
    if (c === '/' && d === '*') {
      const j = src.indexOf('*/', i + 2);
      const end = j < 0 ? src.length : j + 2;
      out += src.slice(i, end).replace(/[^\n]/g, ' ');
      i = end;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch (e) { return false; }
}

/** 引用字符串 -> 磁盘绝对路径;外部链接/插值/空值返回 null */
function resolvePath(root, file, value) {
  const v = String(value).split('?')[0].split('#')[0].trim();
  if (!v || EXTERNAL.test(v) || v.includes('{{')) return null;
  return v.startsWith('/') ? path.join(root, v.slice(1)) : path.resolve(path.dirname(file), v);
}

/** require/import 的模块路径,允许省略扩展名 */
function resolveModule(root, file, value) {
  const base = resolvePath(root, file, value);
  if (!base) return null;
  const cands = [base, base + '.js', base + '.json', base + '.wxs', base + '.wxss',
    path.join(base, 'index.js'), path.join(base, 'index.json'), path.join(base, 'index.wxs')];
  return cands.find(isFile) || null;
}

function collectCrossRefs(root, roots) {
  const hits = [];      // 主包 -> 分包资源(第三类)
  const crossPkg = [];  // 分包 A -> 分包 B 资源(第四类)
  const missingRefs = [];
  const stamp = (extra) => path.relative(root, extra);
  for (const file of collectSources(root, [])) {
    const rel = stamp(file);
    const fromOwner = ownerOf(rel, roots);
    const ext = path.extname(file).toLowerCase();
    const src = stripComments(fs.readFileSync(file, 'utf8'), ext === '.wxml' ? 'wxml' : 'c');
    const lineAt = (idx) => src.slice(0, idx).split('\n').length;
    const hit = (kind, idx, raw, abs) => {
      const target = stamp(abs);
      const owner = ownerOf(target, roots);
      if (!owner) return;                                    // 主包内部引用,合法
      const row = { file: rel, line: lineAt(idx), kind, value: String(raw), target, owner, size: fs.statSync(abs).size };
      if (!fromOwner) hits.push(row);                        // 主包发出的,一律入第三类
      else if (owner !== fromOwner) crossPkg.push({ ...row, from: fromOwner });  // 分包之间才入第四类(引主包/引自己合法)
    };
    const checkAttr = (kind, idx, raw) => {
      const abs = resolvePath(root, file, raw);
      if (abs && isFile(abs)) hit(kind, idx, raw, abs);
    };
    if (ext === '.wxml') {
      for (const m of src.matchAll(/\b(?:src|url)\s*=\s*"([^"]*)"/g)) {
        for (const v of attrLiterals(m[1])) checkAttr('wxml src/url', m.index, v);
      }
      for (const m of src.matchAll(/\b(?:src|url)\s*=\s*'([^']*)'/g)) {
        for (const v of attrLiterals(m[1])) checkAttr('wxml src/url', m.index, v);
      }
      for (const m of src.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) checkAttr('wxml style url()', m.index, m[1]);
    } else if (ext === '.wxss') {
      for (const m of src.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) checkAttr('wxss url()', m.index, m[1]);
      for (const m of src.matchAll(/@import\s+(?:url\(\s*)?['"]([^'"]+)['"]/g)) {
        const abs = resolvePath(root, file, m[1]);
        if (!abs) continue;
        const cands = abs ? [abs, abs + '.wxss'] : [];
        const found = cands.find(isFile);
        if (found) hit('wxss @import', m.index, m[1], found);
        else missingRefs.push({ file: rel, line: lineAt(m.index), value: m[1] });
      }
    } else if (ext === '.js' || ext === '.wxs') {
      for (const m of src.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const abs = resolveModule(root, file, m[1]);
        if (abs) hit('require(...)', m.index, m[1], abs);
      }
      for (const m of src.matchAll(/\b(?:from|import)\s*['"]([^'"]+)['"]/g)) {
        const abs = resolveModule(root, file, m[1]);
        if (abs) hit('import ... from', m.index, m[1], abs);
      }
      for (const m of src.matchAll(/['"]([^'"\n]+)['"]/g)) {
        if (!RESOURCE_EXT.test(m[1])) continue;
        const abs = resolvePath(root, file, m[1]);
        if (abs && isFile(abs)) hit('资源路径字符串', m.index, m[1], abs);
      }
    } else if (ext === '.json' && path.basename(file) === 'app.json') {
      let j;
      try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { j = null; }
      for (const item of ((j && j.tabBar && j.tabBar.list) || [])) {
        for (const key of ['iconPath', 'selectedIconPath']) checkAttr('tabBar.' + key, 0, item[key]);
      }
    }
  }
  const seen = new Set();
  const dedupe = (arr) => arr.filter((h) => {                // 同一处被多条正则命中(require 的串也像资源路径)只留一条
    const k = h.file + ':' + h.line + ':' + h.target;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { hits: dedupe(hits), crossPkg: dedupe(crossPkg), missingRefs };
}

function selfTest() {
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cpl-'));
  const w = (rel, body) => {
    const p = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  w('app.json', JSON.stringify({ pages: ['pages/p/index'], subPackages: [{ root: 'subpackageA', pages: [] }, { root: 'subpackageB', pages: [] }] }));
  w('components/cy/ok/index.json', '{}');
  w('subpackageA/components/inner/index.json', '{}');
  w('images/ok.png', 'png');
  w('subpackageA/images/secret.png', 'png');
  // ① 绿:主包引主包,绝对路径能解析
  w('pages/p/index.json', JSON.stringify({ usingComponents: { 'cy-ok': '/components/cy/ok/index' } }));
  const green = lint(tmp);
  // ① 红:相对路径指向不存在的兄弟(正是 2026-09-04 搬家踩的形状)
  w('pages/p/index.json', JSON.stringify({ usingComponents: { 'cy-gone': '../gone/index' } }));
  const redMissing = lint(tmp);
  // ② 红:主包引分包组件(正是 2026-09-16 scene-deep-link 踩的形状)
  w('pages/p/index.json', JSON.stringify({ usingComponents: { 'cy-inner': '/subpackageA/components/inner/index' } }));
  const redCross = lint(tmp);
  // ② 绿:分包引主包是合法方向(先把主包样例恢复成绿,免得它混进这条自证)
  w('pages/p/index.json', JSON.stringify({ usingComponents: { 'cy-ok': '/components/cy/ok/index' } }));
  w('subpackageA/pages/own/index.json', JSON.stringify({ usingComponents: { 'cy-ok': '/components/cy/ok/index' } }));
  const subToMain = lint(tmp);
  // ③ 绿:主包引主包资源;注释里的分包路径必须剥掉;分包引主包资源合法
  w('pages/p/index.wxml', '<!-- <image src="/subpackageA/images/secret.png"/> --><image src="/images/ok.png"/>');
  w('pages/p/index.wxss', '/* url("/subpackageA/images/secret.png") */ .a{background:url("/images/ok.png")}');
  w('pages/p/index.js', "// const A = '/subpackageA/images/secret.png'\nconst I = '/images/ok.png';");
  w('subpackageA/pages/own/index.wxml', '<image src="/images/ok.png"/>');
  const resGreen = lint(tmp);
  // ③ 红:主包 wxml 的 src 指分包图片(负控同形状)
  w('pages/p/index.wxml', '<image src="/subpackageA/images/secret.png"/>');
  const resWxml = lint(tmp);
  // ③ 红:主包 wxss 的 url() 指分包图片
  w('pages/p/index.wxml', '<image src="/images/ok.png"/>');
  w('pages/p/index.wxss', '.a{background:url("/subpackageA/images/secret.png")}');
  const resWxss = lint(tmp);
  // ③ 红:WXSS @import 指向不存在的文件(微信编译器会直接阻断整页)
  w('pages/p/index.wxss', '@import "./gone.wxss";');
  const missingWxssImport = lint(tmp);
  // ③ 红:主包 js require 分包模块
  w('pages/p/index.wxss', '.a{background:url("/images/ok.png")}');
  w('subpackageA/util/helper.js', 'module.exports = {}');
  w('pages/p/index.js', "const h = require('/subpackageA/util/helper.js');");
  const resJsModule = lint(tmp);
  // ③ 红:主包 js 资源路径字符串指分包图片(utils/roam-hangout 同形状)
  w('pages/p/index.js', "const A = '/subpackageA/images/secret.png';");
  const resJsAsset = lint(tmp);
  // ③ 红:wxml {{}} 里的兜底字面量指分包图片(post-card 同形状)
  w('pages/p/index.js', "const I = '/images/ok.png';");
  w('pages/p/index.wxml', '<image src="{{img || \'/subpackageA/images/secret.png\'}}"/>');
  const resWxmlMustache = lint(tmp);
  // ④ 绿:分包引主包、分包引自己都合法(两个分包 root 都在,必须 0 条)
  w('pages/p/index.wxml', '<image src="/images/ok.png"/>');
  w('subpackageA/pages/own/index.js', "const A = '/subpackageA/images/secret.png';");
  const pkgSelf = lint(tmp);
  // ④ 红:分包 A 引分包 B 的资源(merchant -> topic/images/icon_copy.svg 同形状)
  w('subpackageB/images/secret2.png', 'png');
  w('subpackageA/pages/own/index.js', "const A = '/subpackageB/images/secret2.png';");
  const pkgCross = lint(tmp);
  fs.rmSync(tmp, { recursive: true, force: true });
  const n = (r) => r.crossRefs.length;
  const p = (r) => r.crossPkg.length;
  const ok = green.bad.length === 0 && green.cross.length === 0 && n(green) === 0 && p(green) === 0
    && redMissing.bad.length === 1
    && redCross.bad.length === 0 && redCross.cross.length === 1
    && subToMain.cross.length === 0 && n(subToMain) === 0 && p(subToMain) === 0
    && n(resGreen) === 0 && p(resGreen) === 0
    && n(resWxml) === 1 && n(resWxss) === 1 && n(resJsModule) === 1 && n(resJsAsset) === 1 && n(resWxmlMustache) === 1
    && missingWxssImport.missingRefs.length === 1
    && p(pkgSelf) === 0 && p(pkgCross) === 1;
  console.log(ok
    ? '组件/资源路径门禁:自证通过(能判绿也能判红:搬家指错、主包引分包组件/资源、分包互引资源都判红;主包引主包、分包引主包、分包引自己、注释里的路径判绿)'
    : `组件/资源路径门禁:自证失败 green=${green.bad.length}/${green.cross.length}/${n(green)}/${p(green)}`
      + ` missing=${redMissing.bad.length} cross=${redCross.cross.length} subToMain=${subToMain.cross.length}/${n(subToMain)}/${p(subToMain)}`
      + ` res=${n(resGreen)}/${p(resGreen)}/${n(resWxml)}/${n(resWxss)}/${n(resJsModule)}/${n(resJsAsset)}/${n(resWxmlMustache)}`
      + ` pkg=${p(pkgSelf)}/${p(pkgCross)}`);
  return ok;
}

if (require.main === module) {
  if (process.argv.includes('--selftest')) process.exit(selfTest() ? 0 : 1);
  if (!selfTest()) process.exit(1);
  const { bad, cross, crossRefs, crossPkg, missingRefs, checked } = lint();
  const known = crossRefs.filter(isKnownDebt);
  const fresh = crossRefs.filter((h) => !isKnownDebt(h));
  if (known.length) {
    console.log(`主包引用分包资源门禁:存量债 ${known.length} 条(已出清单,待总控决定;不判红)`);
    known.forEach((c) => console.log(`  [债] ${c.file}:${c.line} -> ${c.value}  (落在分包 ${c.owner}, ${c.size} B)`));
  }
  if (bad.length || cross.length || fresh.length || crossPkg.length || missingRefs.length) {
    if (bad.length) {
      console.log(`组件路径可解析门禁:不通过 —— ${bad.length} 条路径解析不到组件`);
      bad.forEach((b) => console.log(`  ${b.file}: "${b.name}" -> ${b.value}  (找不到 ${b.target})`));
      console.log('  ⚠️ 这类错本地一路绿,只有微信编译器在 upload 时才报,而 upload 还 exit 0。');
    }
    if (cross.length) {
      console.log(`主包引用分包门禁:不通过 —— ${cross.length} 条主包 usingComponents 指向分包`);
      cross.forEach((c) => console.log(`  ${c.file}: "${c.name}" -> ${c.value}  (落在分包 ${c.owner})`));
      console.log('  ⚠️ 分包可以引主包,主包不能引分包:主包 json 在分包下载前就要解析,引不到就整块不出正文。');
      console.log('     要么把组件搬进主包,要么改成按分包路由跳转。');
    }
    if (fresh.length) {
      console.log(`主包引用分包资源门禁:不通过 —— ${fresh.length} 条主包文件引用分包资源`);
      fresh.forEach((c) => console.log(`  ${c.file}:${c.line} [${c.kind}] -> ${c.value}  (落在分包 ${c.owner}, ${c.size} B)`));
      console.log('  ⚠️ 主包先于分包下载,真机分包未就绪时拿不到:图片白、marker 没图标、样式丢。');
      console.log('     要么复制进主包(注意主包资源棘轮 ASSET_CEILING 只准降),要么改服务端静态目录,要么随用它的页面一起下沉。');
    }
    if (crossPkg.length) {
      console.log(`分包互引资源门禁:不通过 —— ${crossPkg.length} 条分包引用其它分包资源`);
      crossPkg.forEach((c) => console.log(`  ${c.file}:${c.line} [${c.kind}] -> ${c.value}  (${c.from} 引 ${c.owner}, ${c.size} B)`));
      console.log('  ⚠️ 两个分包下载顺序不确定,目标分包未就绪时资源拿不到(静默白图)。');
      console.log('     要么复制进引用方分包(零主包棘轮),要么随用它的页面一起下沉,要么提进主包并抬棘轮后拍板。');
    }
    if (missingRefs.length) {
      console.log(`WXSS 引用门禁:不通过 —— ${missingRefs.length} 条 @import 路径不存在`);
      missingRefs.forEach((c) => console.log(`  ${c.file}:${c.line} -> ${c.value}`));
    }
    process.exit(1);
  }
  console.log(`组件/资源路径门禁:通过(${checked} 条 usingComponents 路径解析到位;主包引分包资源 0 条新增${known.length ? `,存量债 ${known.length} 条` : ''};分包互引资源 0 条)`);
}

module.exports = { lint };
