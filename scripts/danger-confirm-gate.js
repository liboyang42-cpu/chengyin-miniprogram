#!/usr/bin/env node
'use strict';

/**
 * DANGER-GATE:不可逆动作必须有确认弹窗,新增裸删除判红。
 *
 * 背景:全站 255 处危险操作只有 13 个确认弹窗、808 处 toast —— 删完给个 toast 就完事,
 * 用户既不知道会连带删掉什么,也没有更轻的退路。本门禁把三件事钉死:
 *
 *   D1 覆盖:源码里出现的危险 endpoint 调用点,必须逐条登记在 danger-action-registry.json。
 *           新写一个 /api/xxx/delete 而不登记 = 红(这就是「新增裸删除判红」)。
 *   D2 守卫:登记为 irreversible 的调用点,所在文件必须真的把它的 confirmKey 交给
 *           cy-danger-confirm 打开确认(`.open('<key>'`)。只登记不接线 = 红。
 *   D3 文案:每个被引用的 confirmKey,在 utils/danger-actions.js 里必须
 *           ①irreversible 的后果清单中有一条含「此操作不可撤销」;②至少一条后果。
 *
 * ⚠ D2 只证明「确认组件被这个 key 打开过」,不证明用户真点了才发请求 —— 那要行为测试。
 *    这道闸挡的是「压根没有确认弹窗」这一类,别把它当成端到端证明。
 *
 * 用法:
 *   node scripts/danger-confirm-gate.js
 *   node scripts/danger-confirm-gate.js --selftest   # 负控:构造该红的场景确认真判红
 */

const fs = require('fs');
const path = require('path');

const XCX_ROOT = path.resolve(__dirname, '..');
const REGISTRY_PATH = path.join(__dirname, 'danger-action-registry.json');
const SCAN_DIRS = ['pages', 'components', 'subpackageA'];
const EXCLUDED = new Set(['node_modules', 'miniprogram_npm', 'dist', 'coverage']);

// 危险 endpoint 的判据:路径里出现这些动词段。宁可多抓(登记为 reversible 即可放行),
// 也不能漏 —— 漏掉的那个就是下一个裸删除。
// 2026-09-11 补 finish:新端点 /api/topic/chapter/finish 是不可逆写(结束后这一章不再
// 接受商家承接,也不能重开),但一个动词都没命中 ⇒ D1/D2 根本看不见它,门禁照样打印 PASS。
// 这正是本文件上面那句「漏掉的那个就是下一个裸删除」。
// ⚠️ 同批试过再补 end|close|terminate|archive,当场抓出两条 master 既有的流程
//    (club/topic-setting/end 结束主题、club/membership/invoice/close 关账单)——
//    它们各有自己的确认组件(J5 cy-club-topic-end-confirm),不走 cy-danger-confirm,
//    按 D2 会直接判红。把它们收编进同一套确认是**另一件事**,要单独一轮评估,
//    不能顺手塞进这个 PR 里逼别的页改。所以这次只补 finish。
const DANGER_VERB = /(?:^|[/_-])(delete|del|remove|quit|dissolve|disband|kick|revoke|reject|offline|withdraw|cancel|finish)(?:$|[/_-])/i;
const API_LITERAL = /'(\/api\/[A-Za-z0-9/_-]+)'/g;
// 读接口带这些动词只是在「列出已取消的」,不是在执行危险动作。
const READONLY_TAIL = /\/(list|page|detail|info|count|status|query|check|history)$/i;

function walkJs(dir, out = []) {
  const abs = path.join(XCX_ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || EXCLUDED.has(entry.name)) continue;
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJs(rel, out);
    else if (entry.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

/** 扫出全部危险 endpoint 调用点。返回 [{ endpoint, file, line }]。 */
function scanDangerSites(readFile) {
  const sites = [];
  for (const rel of walkJs('pages').concat(walkJs('components'), walkJs('subpackageA'))) {
    const src = readFile(rel);
    if (src === null) continue;
    let m;
    API_LITERAL.lastIndex = 0;
    while ((m = API_LITERAL.exec(src))) {
      const endpoint = m[1];
      if (!DANGER_VERB.test(endpoint)) continue;
      if (READONLY_TAIL.test(endpoint)) continue;
      sites.push({
        endpoint,
        file: rel,
        line: src.slice(0, m.index).split('\n').length,
      });
    }
  }
  return sites;
}

/**
 * 文件里是否真的用这个 key 打开过确认组件。
 * 不用 `.open('key'` 直接匹配 —— 实参常是三元(`dc.open(biz === 'x' ? 'a.delete' : 'b.delete', ...)`),
 * 那样会假红。改成:找到每个 `.open(`,在它之后的实参窗口里找带引号的 key。
 * 窗口取 200 字符,够覆盖一个三元加两个参数,又不会一路吃到下一个方法。
 */
function openedWithKey(src, key) {
  const quoted = [`'${key}'`, `"${key}"`];
  // 2026-09-06 起还有第二种接法:modal.show({ dangerKey: 'x', … })(utils/modal.js 路由到 cy-danger-confirm),
  // 同样在 `dangerKey:` 之后的实参窗口里找 key。
  for (const needle of ['.open(', 'dangerKey:']) {
    let at = src.indexOf(needle);
    while (at !== -1) {
      const window = src.slice(at, at + 200);
      if (quoted.some((q) => window.includes(q))) return true;
      at = src.indexOf(needle, at + 1);
    }
  }
  // 2026-09-16:key 先落成文件级常量、再传进 .open(CONST) 的写法(cy-post-actions 即此)。
  //   只认常量名不够 —— 常量声明必须真的是这个 key 的值,否则「抽个常量」就成了一条
  //   绕过字面量检查的暗道。
  const names = [];
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*'([^']+)'/g)) {
    if (m[2] === key) names.push(m[1]);
  }
  return names.some((name) => new RegExp(`\\.open\\(\\s*${name}\\b|dangerKey:\\s*${name}\\b`).test(src));
}

/** 从 utils/danger-actions.js 里取登记表。用 require,拿的是真值而不是正则猜。 */
function loadActions(actionsPath) {
  delete require.cache[require.resolve(actionsPath)];
  return require(actionsPath).DANGER_ACTIONS;
}

function run(opts) {
  const readFile = opts.readFile;
  const registry = opts.registry;
  const actions = opts.actions;
  const errors = [];

  const registryByKey = new Map();
  for (const entry of registry.sites) {
    registryByKey.set(entry.endpoint + '@' + entry.file, entry);
  }

  const sites = scanDangerSites(readFile);
  const seen = new Set();

  // ---- D1 覆盖:每个扫到的调用点必须登记 ----
  for (const site of sites) {
    const id = site.endpoint + '@' + site.file;
    seen.add(id);
    if (!registryByKey.has(id)) {
      errors.push(
        `D1 未登记的危险动作:${site.endpoint}(${site.file}:${site.line})\n` +
        `   → 在 scripts/danger-action-registry.json 里登记这一条。` +
        `不可逆的必须给 confirmKey 并在 utils/danger-actions.js 写明后果。`
      );
    }
  }

  // 登记表里有、源码里没有 = 过期条目,同样判红,免得清单越攒越假。
  // 2026-09-17 补 trigger=payload:危险性在请求体的决策值上、不在 URL 动词上(售后 respond 的 decision=REJECT)。
  //   动词扫描天然看不见它,所以不进 D1 覆盖;过期判定改成「登记文件里仍有这个 endpoint 字面」——
  //   调用点删了照样判红,D2/D3 与其它条目完全同一套。
  for (const entry of registry.sites) {
    const id = entry.endpoint + '@' + entry.file;
    if (entry.trigger === 'payload') {
      const src = readFile(entry.file);
      if (src === null || !src.includes(entry.endpoint)) {
        errors.push(`D1 登记表有但源码里已找不到:${entry.endpoint}(${entry.file})→ 删掉这条登记。`);
      }
      continue;
    }
    if (!seen.has(id)) {
      errors.push(`D1 登记表有但源码里已找不到:${entry.endpoint}(${entry.file})→ 删掉这条登记。`);
    }
  }

  // ---- D2 守卫 + D3 文案 ----
  for (const entry of registry.sites) {
    if (!entry.irreversible && !entry.confirmKey) continue;

    if (!entry.confirmKey) {
      errors.push(`D2 ${entry.endpoint}(${entry.file})标了 irreversible 却没有 confirmKey。`);
      continue;
    }
    const action = actions[entry.confirmKey];
    if (!action) {
      errors.push(`D2 ${entry.endpoint}(${entry.file})的 confirmKey「${entry.confirmKey}」在 utils/danger-actions.js 里不存在。`);
      continue;
    }

    // D2:文件里必须真的用这个 key 打开确认组件。
    // 确认闸可以长在组件内部(如 cy-post-actions 自带 cy-danger-confirm):此时调用点文件
    // 只转发事件,由登记表的 confirmFile 指向真正持有 .open('<key>') 的那个文件。
    const confirmFile = entry.confirmFile || entry.file;
    const src = readFile(confirmFile);
    if (src === null) {
      errors.push(`D2 登记的确认文件读不到:${confirmFile}`);
      continue;
    }
    if (!openedWithKey(src, entry.confirmKey)) {
      errors.push(
        `D2 裸执行:${entry.endpoint}(${confirmFile})登记了 confirmKey「${entry.confirmKey}」,` +
        `但文件里找不到 .open('${entry.confirmKey}') —— 危险动作没有确认弹窗把关。`
      );
    }

    // D3:不可逆的必须写明不可撤销,且至少有一条后果。
    if (entry.irreversible && !action.irreversible) {
      errors.push(`D3 ${entry.confirmKey} 在调用点登记为 irreversible,登记表里却是可逆 —— 两处对不上。`);
    }
    const list = action.consequences || [];
    if (!list.length) {
      errors.push(`D3 ${entry.confirmKey} 没有写任何后果 —— 不可逆动作必须说清会发生什么。`);
    } else if (action.irreversible && !list.some((item) => String(item.text || '').includes('此操作不可撤销'))) {
      errors.push(`D3 ${entry.confirmKey} 的后果清单里没有「此操作不可撤销」—— 不可逆动作必须写明。`);
    }
  }

  return errors;
}

function realReadFile(rel) {
  const abs = path.join(XCX_ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf8');
}

// ---------------------------------------------------------------- 负控自证
function selftest() {
  const baseRegistry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const baseActions = loadActions(path.join(XCX_ROOT, 'utils/danger-actions.js'));
  const cases = [];

  // 先断言变异真的发生了 —— 不然「注入后仍然红」可能只是本来就红。
  const clean = run({ readFile: realReadFile, registry: baseRegistry, actions: baseActions });
  cases.push({ name: '基线', expectRed: false, errors: clean });

  // 负控 1:新写一个裸删除(源码有、登记表没有)→ D1 必须红
  {
    const FAKE = 'pages/__selftest__/index.js';
    const readFile = (rel) => (rel === FAKE
      ? `app.sendRequest({ url: '/api/selftest/wipe-everything/delete', method: 'POST' });`
      : realReadFile(rel));
    // 让 walk 扫到它:直接把它塞进 scan 结果不现实,改为临时落盘再删。
    const abs = path.join(XCX_ROOT, FAKE);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, readFile(FAKE));
    let errors;
    try {
      errors = run({ readFile: realReadFile, registry: baseRegistry, actions: baseActions });
    } finally {
      fs.rmSync(path.dirname(abs), { recursive: true, force: true });
    }
    const mutated = errors.some((e) => e.includes('wipe-everything'));
    cases.push({
      name: 'D1 新增裸删除未登记',
      expectRed: true,
      errors,
      mutationSeen: mutated,
      mutationDesc: '临时写入 pages/__selftest__/index.js,内含未登记的 /api/selftest/wipe-everything/delete',
    });
  }

  // 负控 2:登记为不可逆、却没人 .open(key) → D2 必须红
  {
    const registry = JSON.parse(JSON.stringify(baseRegistry));
    const victim = registry.sites.find((s) => s.irreversible && s.confirmKey);
    const victimFile = victim.confirmFile || victim.file;
    const before = realReadFile(victimFile);
    const mutatedSrc = before.split(`.open('${victim.confirmKey}'`).join(`.open('__selftest_broken__'`);
    const mutationSeen = mutatedSrc !== before;
    const readFile = (rel) => (rel === victimFile ? mutatedSrc : realReadFile(rel));
    const errors = run({ readFile, registry, actions: baseActions });
    cases.push({
      name: 'D2 不可逆动作丢掉确认弹窗',
      expectRed: true,
      errors,
      mutationSeen,
      mutationDesc: `把 ${victimFile} 里的 .open('${victim.confirmKey}') 改名`,
    });
  }

  // 负控 3:不可逆动作的文案里删掉「此操作不可撤销」→ D3 必须红
  {
    const registry = JSON.parse(JSON.stringify(baseRegistry));
    const victim = registry.sites.find((s) => s.irreversible && s.confirmKey);
    const actions = JSON.parse(JSON.stringify(baseActions));
    const list = actions[victim.confirmKey].consequences;
    const before = JSON.stringify(list);
    actions[victim.confirmKey].consequences = list.map((item) => ({
      icon: item.icon,
      text: String(item.text).split('此操作不可撤销').join('这个动作还行'),
    }));
    const mutationSeen = JSON.stringify(actions[victim.confirmKey].consequences) !== before;
    const errors = run({ readFile: realReadFile, registry, actions });
    cases.push({
      name: 'D3 不可逆文案里没写不可撤销',
      expectRed: true,
      errors,
      mutationSeen,
      mutationDesc: `把 ${victim.confirmKey} 后果清单里的「此操作不可撤销」抹掉`,
    });
  }

  // 负控 4:后果清单清空 → D3 必须红
  {
    const registry = JSON.parse(JSON.stringify(baseRegistry));
    const victim = registry.sites.find((s) => s.irreversible && s.confirmKey);
    const actions = JSON.parse(JSON.stringify(baseActions));
    const had = (actions[victim.confirmKey].consequences || []).length > 0;
    actions[victim.confirmKey].consequences = [];
    const errors = run({ readFile: realReadFile, registry, actions });
    cases.push({
      name: 'D3 不可逆动作没写任何后果',
      expectRed: true,
      errors,
      mutationSeen: had,
      mutationDesc: `清空 ${victim.confirmKey} 的 consequences`,
    });
  }

  // 负控 5:把字面量抽成「值不是这个 key」的常量 → D2 必须红
  //   (常量解析是 2026-09-16 为组件内确认闸加的;这条钉住它别退化成「见到 .open(常量) 就放行」)
  {
    const registry = JSON.parse(JSON.stringify(baseRegistry));
    const victim = registry.sites.find((s) => s.irreversible && s.confirmKey);
    const victimFile = victim.confirmFile || victim.file;
    const before = realReadFile(victimFile);
    const constName = '__SELFTEST_WRONG_KEY__';
    const mutatedSrc = `var ${constName} = 'not.the.registered.key';\n`
      + before.split(`.open('${victim.confirmKey}'`).join(`.open(${constName}`)
        .split(`.open("${victim.confirmKey}"`).join(`.open(${constName}`);
    const mutationSeen = mutatedSrc !== before;
    const readFile = (rel) => (rel === victimFile ? mutatedSrc : realReadFile(rel));
    const errors = run({ readFile, registry, actions: baseActions });
    cases.push({
      name: 'D2 常量值不是该 key 时不得放行',
      expectRed: true,
      errors,
      mutationSeen,
      mutationDesc: `把 ${victimFile} 的 .open('${victim.confirmKey}') 换成值为别的 key 的常量`,
    });
  }

  // 负控 6:trigger=payload 条目(售后「不同意」)丢掉 dangerKey → D2 必须红;调用点删掉 → D1 过期必须红
  {
    const victim = baseRegistry.sites.find((s) => s.trigger === 'payload' && s.confirmKey);
    if (!victim) {
      cases.push({ name: 'D2/D1 payload 型条目负控', expectRed: true, errors: [], mutationSeen: false,
        mutationDesc: '登记表里没有 trigger=payload 条目,负控无从变异' });
    }
    const before = victim ? realReadFile(victim.file) : '';
    const noConfirm = before.split(`'${victim && victim.confirmKey}'`).join(`'__selftest_broken__'`);
    const errorsNoConfirm = run({
      readFile: (rel) => (rel === victim.file ? noConfirm : realReadFile(rel)),
      registry: baseRegistry, actions: baseActions,
    });
    cases.push({
      name: 'D2 payload 型危险决策丢掉确认',
      expectRed: true,
      errors: errorsNoConfirm,
      mutationSeen: !!victim && noConfirm !== before,
      mutationDesc: victim ? `把 ${victim.file} 里的 '${victim.confirmKey}' 改名` : '登记表里没有 trigger=payload 条目',
    });
    const noEndpoint = before.split(victim ? victim.endpoint : '\u0000').join('/api/__selftest__/gone');
    const errorsStale = run({
      readFile: (rel) => (rel === victim.file ? noEndpoint : realReadFile(rel)),
      registry: baseRegistry, actions: baseActions,
    });
    cases.push({
      name: 'D1 payload 型条目调用点删掉后判过期',
      expectRed: true,
      errors: errorsStale,
      mutationSeen: !!victim && noEndpoint !== before,
      mutationDesc: victim ? `把 ${victim.file} 里的 ${victim.endpoint} 抹掉` : '登记表里没有 trigger=payload 条目',
    });
  }

  let failed = 0;
  for (const c of cases) {
    const red = c.errors.length > 0;
    // 第一行先断言变异真发生了:变异没生效的话「红」是假红,证明不了门禁有效。
    if (c.expectRed && c.mutationSeen === false) {
      console.log(`✗ ${c.name}:变异根本没发生(${c.mutationDesc})—— 这一条自证无效`);
      failed++;
      continue;
    }
    if (red === c.expectRed) {
      console.log(`✓ ${c.name}:${c.expectRed ? '按预期判红' : '按预期通过'}${c.mutationDesc ? `(变异已生效:${c.mutationDesc})` : ''}`);
    } else {
      console.log(`✗ ${c.name}:预期${c.expectRed ? '红' : '绿'},实际${red ? '红' : '绿'}`);
      if (red) c.errors.slice(0, 5).forEach((e) => console.log('    ' + e.split('\n')[0]));
      failed++;
    }
  }
  return failed;
}

function main() {
  if (process.argv.includes('--selftest')) {
    const failed = selftest();
    console.log(failed ? `\nDANGER-GATE 自证失败 ${failed} 项` : '\nDANGER-GATE 自证通过');
    process.exit(failed ? 1 : 0);
  }

  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const actions = loadActions(path.join(XCX_ROOT, 'utils/danger-actions.js'));
  const errors = run({ readFile: realReadFile, registry, actions });

  if (errors.length) {
    console.error('DANGER-GATE FAIL:\n');
    errors.forEach((e) => console.error('  ' + e + '\n'));
    console.error(`共 ${errors.length} 项。`);
    process.exit(1);
  }
  const irreversible = registry.sites.filter((s) => s.irreversible).length;
  console.log(`DANGER-GATE PASS:${registry.sites.length} 个危险调用点已登记,其中 ${irreversible} 个不可逆动作全部有确认弹窗且写明不可撤销。`);
}

if (require.main === module) main();
module.exports = { run, scanDangerSites };
