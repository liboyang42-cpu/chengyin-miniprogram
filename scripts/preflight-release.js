// SYS-S2 发版前机械自检(纯 node,无依赖)。
// 用法:cd chengyinhub-xcx && node scripts/preflight-release.js
// 覆盖专家报告 §维度6 发版硬伤项:域名指向生产 / 无明文 http / console 残留 / 主包体积 / 死注释。
// 退出码:有 BLOCK 级问题 → 1(可挂 CI);仅 WARN/INFO → 0。

const fs = require('fs');
const path = require('path');
const { validateAgreementDocs } = require('./release-legal-gate.js');
const { validateEvidenceOverlay, evidenceReadiness, inventoryMatchesCurrent } = require('./uiaudit/build-action-ledger.js');

const ROOT = path.resolve(__dirname, '..');
const problems = { block: [], warn: [], info: [] };
const add = (lvl, msg) => problems[lvl].push(msg);

// 递归收集【会出包的】业务源码。跳过目录与 project.config.json packOptions.ignore 出包口径对齐:
// node_modules / miniprogram_npm / scripts / tests / docs / .git / .obsidian / .serena 都不上传,
// 其中的 console.log / http 明文不构成发版硬伤,不应计入自检(否则 408 处里 ~356 是永不出包的脚本/测试噪声)。
const PACK_IGNORE_DIRS = ['node_modules', 'miniprogram_npm', '.git', 'scripts', 'tests', 'docs', '.obsidian', '.serena'];
function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (PACK_IGNORE_DIRS.includes(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) { walk(p, out); continue; }
    if (!/\.(js|wxml|wxss|json)$/.test(name)) continue;
    if (/ec-canvas|echarts|vant|weui/i.test(p)) continue; // 第三方
    out.push(p);
  }
  return out;
}
const files = walk(ROOT, []);
const rel = (p) => path.relative(ROOT, p);

// —— 1. release 必须固定生产；develop/trial 自 2026-08-25 起回落生产（无门禁，见下方 INFO）——
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const runtimeConfigModule = require(path.join(ROOT, 'utils/config.js'));
const configuredSite = runtimeConfigModule.apiBaseUrl;
const releaseRuntime = runtimeConfigModule.resolveRuntimeConfig('release');
const developRuntime = runtimeConfigModule.resolveRuntimeConfig('develop');
const stagingRuntime = runtimeConfigModule.resolveRuntimeConfig('trial');
if (!/siteBaseUrl\s*:\s*runtimeConfig\.apiBaseUrl/.test(appJs)) {
  add('block', 'app.js 的 siteBaseUrl 未接入 envVersion 运行时配置');
} else if (typeof configuredSite !== 'string' || /localhost|127\.0\.0\.1|http:\/\//.test(configuredSite)) {
  add('block', `apiBaseUrl 指向非生产/明文:${String(configuredSite)}`);
} else if (!/^https:\/\//.test(configuredSite)) {
  add('block', `apiBaseUrl 非 HTTPS:${String(configuredSite)}`);
} else if (releaseRuntime.apiBaseUrl !== configuredSite) {
  add('block', 'release 环境未固定正式 HTTPS');
} else {
  // 2026-08-25 用户裁决撤销 develop/staging 的 fail-closed（见 utils/config.js）。
  // ⚠️ 这里**没有**针对 develop/staging 的门禁，而且加不出来:不传 ext 配置时
  // resolveRuntimeConfig('develop'/'trial') 的 apiBaseUrl 恒等于上面已校验过的
  // API_BASE_URL 常量 —— 任何基于它的断言都是恒真的,变不了红,写了只会冒充「已把关」。
  // 真实风险(开发版/体验版的写请求落生产库)只有后端鉴权能拦，本脚本拦不住，
  // 故如实报出来而不是假装守着。
  // 2026-09-15 用户拍板删除运行时生产写闸(X01):原先那条 productionWritesAllowed
  // 断言只服务该闸且恒真,随闸一并删除。
  add('info', `release 固定 ${configuredSite}`);
  add('info', 'develop/trial 未配 ext.json 测试服时回落生产 HTTPS —— 其写请求会真落生产库,本脚本无门禁');
}

// —— 2. 源码里明文 http:// / localhost(排除注释行、协议注释)——
let cleartext = 0;
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((l, i) => {
    const t = l.trim();
    if (t.startsWith('//') || t.startsWith('*')) return; // 注释行不算
    if (/http:\/\/(localhost|127\.0\.0\.1|\d)/.test(l)) {
      cleartext++;
      if (cleartext <= 8) add('block', `明文 http/localhost:${rel(f)}:${i + 1}  ${t.slice(0, 80)}`);
    }
  });
}
if (cleartext > 8) add('block', `…共 ${cleartext} 处明文 http/localhost(仅列前 8)`);
if (cleartext === 0) add('info', '无明文 http/localhost 生产命中');

// —— 3. console.log / console.error 残留(WARN,不阻断)——
let consoleCnt = 0;
for (const f of files) {
  if (!f.endsWith('.js')) continue;
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    if (/console\.log\(/.test(line)) consoleCnt++;
  });
}
if (consoleCnt > 0) add('warn', `console.log 调试残留 ${consoleCnt} 处(发版建议清理;console.error 例外保留)`);

// —— 4. 主包页数(app.json pages[],WARN 阈值 40)——
const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
const mainPages = (appJson.pages || []).length;
const subCnt = (appJson.subpackages || appJson.subPackages || []).length;
if (mainPages > 40) add('warn', `主包页数 ${mainPages} > 40(见 FE-16 主包瘦身;分包 ${subCnt} 个)`);
else add('info', `主包页数 ${mainPages}(分包 ${subCnt})`);

// —— 4.5 主包体积(BLOCK)——
// 文件头一直写着「覆盖…主包体积」,但在 2026-08-25 之前这里根本没有体积检查 ——
// 于是 #798/#802/#813 的封面和 #803/#812 误入的 artifacts 截图一路进包,
// 主包被撑到 6.48MB(微信硬限 2MB),没有任何门禁拦住,直到有人去传才会发现。
//
// ⚠️ 这里量的是**未压缩**字节。微信上传会压代码、不会压图片,所以真实包体更小;
// 但用未压缩字节做棘轮足以拦住「又有人往包里塞资源」这一类回归。
// ⚠️ 出包口径以 project.config.json 的 packOptions.ignore 为单一真源,别再手抄一份 ——
// 上面那个 PACK_IGNORE_DIRS 就是抄漏了 artifacts 才让 4.7MB 截图溜进包的同款隐患。
{
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'project.config.json'), 'utf8'));
  const ig = (cfg.packOptions && cfg.packOptions.ignore) || [];
  const igDirs = new Set(ig.filter((i) => i.type === 'folder').map((i) => i.value.replace(/\/$/, '')));
  const igFiles = new Set(ig.filter((i) => i.type === 'file').map((i) => i.value));
  const subRoots = (appJson.subPackages || appJson.subpackages || [])
    .map((x) => x.root.replace(/\/$/, ''));
  const perTop = {};
  const sum = (dir, rel) => {
    let total = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        const top = childRel.split('/')[0];
        if (top.startsWith('.') || igDirs.has(top)) continue;
        if (subRoots.some((r) => childRel === r || childRel.startsWith(`${r}/`))) continue;
        total += sum(path.join(dir, e.name), childRel);
      } else if (!igFiles.has(childRel)) {
        total += fs.statSync(path.join(dir, e.name)).size;
      }
    }
    // 只在顶层目录记一次,否则每层递归都累加 = 重复计数(大头会算出比总量还大)
    if (rel && !rel.includes('/')) perTop[rel] = total;
    return total;
  };
  const bytes = sum(ROOT, '');
  const mb = (n) => (n / 1048576).toFixed(2);
  const CEILING = 3 * 1024 * 1024;
  const biggest = Object.entries(perTop).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, v]) => `${k} ${mb(v)}MB`).join(' / ');
  if (bytes > CEILING) {
    add('block', `主包未压缩 ${mb(bytes)}MB > 棘轮 ${mb(CEILING)}MB(微信真限 2MB 压缩后)。`
      + `大头:${biggest}。资源该走服务端静态目录或分包,别塞主包`);
  } else {
    add('info', `主包未压缩 ${mb(bytes)}MB(棘轮 ${mb(CEILING)}MB;大头 ${biggest})`);
  }
}

// —— 5. 死注释体检(INFO,S-1 顺手清)——
if (/\/\/\s*siteBaseUrl.*localhost/.test(appJs)) {
  add('info', 'app.js 存在被注释的 localhost siteBaseUrl 死行(可顺手删,非阻断)');
}

// —— 6. 提审法律文本与开发视角闸 ——
const agreementDocs = fs.readFileSync(path.join(ROOT, 'utils/agreement-docs.js'), 'utf8');
const agreementError = validateAgreementDocs(agreementDocs);
if (agreementError) {
  add('block', agreementError);
} else {
  add('info', '用户协议与注销须知已替换为提审文本');
}

if (!/if\s*\(!this\.isDevEnv\(\)\)\s*\{\s*wx\.removeStorageSync\(['"]debug_user_view['"]\)/.test(appJs)) {
  add('block', '非开发版未清理 debug_user_view，旧 Storage 可能改写真实身份视角');
} else {
  add('info', '体验版/正式版会清理开发视角残留');
}

// —— 7. Action Ledger 动态行为证据必须全部 release-ready ——
const actionLedger = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/uiaudit/action-ledger.json'), 'utf8'));
const actionEvidence = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/uiaudit/action-evidence.json'), 'utf8'));
if (!inventoryMatchesCurrent(actionLedger)) {
  add('block', 'Action Ledger inventory 已与当前源码漂移，先运行 npm run audit:actions:update 并审阅 diff');
} else {
  const actionEvidenceErrors = validateEvidenceOverlay(actionLedger, actionEvidence);
  if (actionEvidenceErrors.length) {
    add('block', `Action Ledger evidence 非法:${actionEvidenceErrors[0]}`);
  } else {
    const actionReadiness = evidenceReadiness(actionLedger, actionEvidence);
    if (!actionReadiness.ready) {
      add('block', `Action Ledger 动态证据未完成:pending=${actionReadiness.pending.length},nonPassed=${actionReadiness.nonPassed.length}`);
    } else {
      add('info', `Action Ledger ${actionLedger.controlCount} 个动作动态证据全部 release-ready`);
    }
  }
}

// —— 输出 ——
const line = '─'.repeat(56);
console.log(line + '\n 城瘾小程序 发版前自检 (SYS-S2)\n' + line);
const emit = (lvl, tag) => problems[lvl].forEach(m => console.log(`${tag} ${m}`));
emit('block', '⛔ BLOCK');
emit('warn', '⚠️  WARN ');
emit('info', 'ℹ️  INFO ');
console.log(line);
if (problems.block.length) {
  console.log(`结果:❌ ${problems.block.length} 个 BLOCK 级问题,禁止发版`);
  process.exit(1);
}
console.log(`结果:✅ 无阻断项(WARN ${problems.warn.length} / INFO ${problems.info.length})`);
process.exit(0);
