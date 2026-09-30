#!/usr/bin/env node
'use strict';

/**
 * UI-GATE-0:小程序静态 UI 有效性门禁。
 *
 * U1:app.sendRequest 的 /api 路径必须能匹配后端 Mapping;动态/变量路径逐条报告。
 * U2:复用 scripts/wxml-handler-lint.js,校验 WXML 事件绑定的方法存在。
 * U3:handler-like 方法必须至少有一个 WXML 绑定,合法回调使用精确白名单。
 * U4:setData 顶层字段必须在同页 WXML 消费,纯 JS 控制流字段使用精确白名单。
 * U5:silentError:true 必须逐调用点登记理由。
 *
 * 用法:
 *   node tests/lint/ui-integrity.js
 *   node tests/lint/ui-integrity.js --selftest
 */
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
// 2026-08-18:解析层已搬进 scripts/lib/xcx-scan.js(与 U3/U4 共用),
// wxml-handler-lint 只剩判据 + 自证,所以这里分两处 require —— 别再从 lint 模块要解析函数。
const {
  extractHandlerNames,
  findEventBindings,
  maskNonCode,
  matchBrace,
  resolveSpreadRequireTargets,
} = require('../../scripts/lib/xcx-scan');
const { lintRepo: lintWxmlHandlers } = require('../../scripts/wxml-handler-lint');
const BASELINE = require('./ui-integrity-baseline');

const XCX_ROOT = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(XCX_ROOT, '..');
const WARN_AS_ERROR = process.argv.includes('--warn-as-error');
const NON_INCREASING_CEILING = Object.freeze({
  u1Variable: 13,
  u3Debt: 103,
  u4Debt: 196,
  u4Dynamic: 65,
  // 2026-08-26 12 → 13:merchant/customer 触达历史改为「有旧记录时刷新失败静默降级」,
  //   fail 不再写可见错误态,故该 silentError 调用点需要逐项登记理由(已登记,见 baseline)。
  // 2026-09-03 13 → 15:activity/list 删掉「发起官方活动」面板后,那两个列表读取的
  //   silentError 调用点不再被"自动豁免"推导命中(推导会顺着同文件里的具名函数体
  //   往下找可见反馈,面板一删,原来命中的那条路径没了)。**行为没变**:失败仍落
  //   loadError/mineError + errorMsg,页面 cy-error 照常呈现并给重试 —— 只是从
  //   "自动认定安全"转成"逐项登记理由",两条已写进 baseline。
  // 2026-09-10 13 → 15:漫游地图上的「附近还在走的人」新增一对位置心跳,
  //   上行 _reportPresence(30 s)、下行 _fetchRunners(45 s),两条都必须静默 ——
  //   它们每分钟各跑一两次,不承载任何用户动作,也没有「重试」可给(下一次心跳就是重试);
  //   真失效的表现是自己从别人地图上消失 / 附近显示没人,不是弹一个框。
  //   逐项理由已登记在 baseline 的 u5Silent 里(pages/roam/index.js:1842 与 :1851)。
  //   2026-09-11 并 master 后两批叠加:13 → 15(master 那两条)→ 17(漫游心跳那两条)。
  // 2026-09-11 与 master 合流:两边各自抬过这个冻结上限,合并后实测 20。
  //   本分支:merchantapply / signup / merchantinfo 主办章节只读。
  //   master:漫游 f-hangout 与组局 h-place 背景读取。
  // 2026-09-12 审核收口:广场 post-compose 选活动两路列表失败落组件 activityError,
  //   关掉自动 toast 避免双弹,23 → 25。
  // 2026-09-17 release-0917 第三阶段 C 25 → 26:总控裁定(唯一允许的 U5 放宽)——支付成功面板/订单详情上
  //   取商家营销同意状态的附属 GET 失败只隐藏可选勾选行,不弹通道默认错误 toast(utils/marketing-consent-entry.js:60)。
  // 2026-09-19 批复1-a=2 定价页接合作方入口 26 → 27:loadLineupNames 阵容补名是 best-effort
  //   装饰读取(拉不到留类型兜底名,点开合作方页自有错误态),新增一条逐项登记。两条放宽各自成立。
  // 2026-09-21 漫游入口地图新增活动/队伍两路后台刷新。失败均落页面 entryLoadError 并提供重试，
  //   禁用通道 toast 避免拖图时与页内错误态重复反馈，27 → 29。
  u5Silent: 29,
});
const EXCLUDED_DIRS = new Set([
  '.git', 'node_modules', 'miniprogram_npm', 'tests', 'scripts', 'coverage', 'dist',
]);

const U1_VARIABLE_ALLOWLIST = new Map(Object.entries(BASELINE.u1Variable || {}));
// U3/U4 是显式存量债务清单，不冒充“已证明安全”的白名单；新债务默认红，只能随修复缩小。
const U3_DEBT_BASELINE = new Map(Object.entries(BASELINE.u3Debt || {}));
const U4_DEBT_BASELINE = new Map(Object.entries(BASELINE.u4Debt || {}));
const U4_DYNAMIC_ALLOWLIST = new Map(Object.entries(BASELINE.u4Dynamic || {}));
const U5_SILENT_ALLOWLIST = new Map(Object.entries(BASELINE.u5Silent || {}));

function walkFiles(root, extension, excluded = EXCLUDED_DIRS) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || (entry.isDirectory() && excluded.has(entry.name))) continue;
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(target, extension, excluded));
    else if (entry.isFile() && entry.name.endsWith(extension)) out.push(target);
  }
  return out.sort();
}

function repoRel(file) {
  return path.relative(REPO_ROOT, file).split(path.sep).join('/');
}

function lineNumber(source, offset) {
  let line = 1;
  for (let i = 0; i < offset; i += 1) if (source[i] === '\n') line += 1;
  return line;
}

function splitTopLevel(masked, start, end) {
  const ranges = [];
  let depth = 0;
  let segmentStart = start;
  for (let i = start; i < end; i += 1) {
    const c = masked[i];
    if (depth === 0 && c === ',') {
      ranges.push([segmentStart, i]);
      segmentStart = i + 1;
      continue;
    }
    if (c === '{' || c === '(' || c === '[') depth += 1;
    else if (c === '}' || c === ')' || c === ']') depth -= 1;
  }
  ranges.push([segmentStart, end]);
  return ranges;
}

function stripLeadingTrivia(raw) {
  let offset = 0;
  while (offset < raw.length) {
    const whitespace = /^\s+/.exec(raw.slice(offset));
    if (whitespace) { offset += whitespace[0].length; continue; }
    const lineComment = /^\/\/[^\n]*(?:\n|$)/.exec(raw.slice(offset));
    if (lineComment) { offset += lineComment[0].length; continue; }
    const blockComment = /^\/\*[\s\S]*?\*\//.exec(raw.slice(offset));
    if (blockComment) { offset += blockComment[0].length; continue; }
    break;
  }
  return { text: raw.slice(offset), offset };
}

function objectProperties(source, masked, openBrace, closeBrace) {
  const properties = [];
  const dynamic = [];
  for (const [start, end] of splitTopLevel(masked, openBrace + 1, closeBrace)) {
    const raw = source.slice(start, end);
    const leading = stripLeadingTrivia(raw);
    const trimmed = leading.text.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('...')) {
      dynamic.push({ raw: trimmed, offset: start + leading.offset });
      continue;
    }
    if (trimmed.startsWith('[')) {
      const computed = /^\[\s*(?:`|['"])([A-Za-z_$][\w$]*)(?:[.[`'"])/.exec(trimmed);
      if (computed) {
        properties.push({ name: computed[1], raw: trimmed, start: start + leading.offset, end, offset: start + leading.offset });
      } else {
        dynamic.push({ raw: trimmed, offset: start + leading.offset });
      }
      continue;
    }
    const match = /^\s*(?:(['"])([^'"]+)\1|([A-Za-z_$][\w$]*))\s*(?::|\(|$)/.exec(leading.text);
    if (!match) {
      dynamic.push({ raw: trimmed, offset: start + leading.offset });
      continue;
    }
    properties.push({
      name: match[2] || match[3],
      raw: leading.text,
      start: start + leading.offset,
      end,
      offset: start + leading.offset + match.index,
    });
  }
  return { properties, dynamic };
}

function stripJsComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

function mappingPaths(annotationArgs) {
  if (annotationArgs == null || !annotationArgs.trim()) return [''];
  const quoted = [];
  const re = /(['"])(.*?)\1/g;
  let match;
  while ((match = re.exec(annotationArgs))) {
    if (match[2].startsWith('/')) quoted.push(match[2]);
  }
  return quoted.length ? quoted : [''];
}

function joinRoute(base, child) {
  const joined = `${base || ''}/${child || ''}`.replace(/\/{2,}/g, '/');
  if (joined.length > 1) return joined.replace(/\/$/, '');
  return joined;
}

function collectBackendRoutes(repoRoot = REPO_ROOT) {
  const routes = new Set();
  const moduleDirs = fs.readdirSync(repoRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('chengyinhub-'))
    .map((entry) => path.join(repoRoot, entry.name, 'src', 'main', 'java'))
    .filter(fs.existsSync);
  const annotationRe = /@(Request|Get|Post|Put|Delete|Patch)Mapping\s*(?:\(([\s\S]*?)\))?/g;
  for (const javaFile of moduleDirs.flatMap((dir) => walkFiles(dir, '.java', new Set()))) {
    const source = stripJsComments(fs.readFileSync(javaFile, 'utf8'));
    const classIndex = source.search(/\b(?:class|interface)\s+[A-Za-z_$]/);
    if (classIndex < 0) continue;
    const prefix = source.slice(0, classIndex);
    const classBases = [];
    let match;
    annotationRe.lastIndex = 0;
    while ((match = annotationRe.exec(prefix))) {
      if (match[1] === 'Request') classBases.push(...mappingPaths(match[2]));
    }
    const bases = classBases.length ? classBases : [''];
    annotationRe.lastIndex = classIndex;
    while ((match = annotationRe.exec(source))) {
      const children = mappingPaths(match[2]);
      for (const base of bases) for (const child of children) {
        const route = joinRoute(base, child);
        if (route.startsWith('/api/')) routes.add(route);
      }
    }
  }
  return routes;
}

function routeMatches(frontendRoute, backendRoute) {
  const front = frontendRoute.replace(/[?#].*$/, '').replace(/\/$/, '').split('/').filter(Boolean);
  const back = backendRoute.replace(/\/$/, '').split('/').filter(Boolean);
  const dynamicTail = front[front.length - 1] === ':dynamic';
  if (front.length !== back.length) return false;
  return front.every((segment, index) => {
    if (dynamicTail && index === front.length - 1) return true;
    const candidate = back[index];
    return segment === ':dynamic' || /^\{[^}]+\}$/.test(candidate) || candidate === '*' || segment === candidate;
  });
}

function expressionToApiRoute(expression) {
  const value = expression.trim();
  if (value.startsWith('`')) {
    const end = value.lastIndexOf('`');
    if (end <= 0) return null;
    const content = value.slice(1, end);
    if (!content.startsWith('/api/')) return null;
    const dynamic = content.includes('${');
    return { route: content.replace(/\$\{[\s\S]*?\}/g, ':dynamic').replace(/[?#].*$/, ''), dynamic };
  }
  const literal = /^(['"])(\/api\/[^'"]*)\1\s*$/.exec(value);
  if (literal) return { route: literal[2].replace(/[?#].*$/, ''), dynamic: false };
  const first = /^(['"])(\/api\/[^'"]*)\1/.exec(value);
  if (!first) return null;
  let route = '';
  let cursor = 0;
  const stringRe = /(['"])(.*?)\1/g;
  let match;
  while ((match = stringRe.exec(value))) {
    if (match.index > cursor && value.slice(cursor, match.index).replace(/[+\s]/g, '')) route += ':dynamic';
    route += match[2];
    cursor = stringRe.lastIndex;
  }
  if (value.slice(cursor).replace(/[+\s]/g, '')) route += ':dynamic';
  return { route: route.replace(/[?#].*$/, ''), dynamic: true };
}

function concatenatedRouteTail(source, start) {
  let cursor = start;
  let tail = '';
  let dynamic = false;
  while (cursor < source.length) {
    while (/\s/.test(source[cursor]) && source[cursor] !== '\n') cursor += 1;
    if (source[cursor] !== '+') break;
    dynamic = true;
    cursor += 1;
    while (/\s/.test(source[cursor]) && source[cursor] !== '\n') cursor += 1;
    const quote = source[cursor];
    if (quote === "'" || quote === '"' || quote === '`') {
      cursor += 1;
      let literal = '';
      while (cursor < source.length) {
        if (source[cursor] === '\\') {
          literal += source[cursor];
          if (cursor + 1 < source.length) literal += source[cursor + 1];
          cursor += 2;
          continue;
        }
        if (source[cursor] === quote) { cursor += 1; break; }
        literal += source[cursor];
        cursor += 1;
      }
      tail += literal.replace(/\$\{[\s\S]*?\}/g, ':dynamic');
      continue;
    }
    let paren = 0;
    while (cursor < source.length) {
      const ch = source[cursor];
      if (ch === '(' || ch === '[' || ch === '{') paren += 1;
      else if (ch === ')' || ch === ']' || ch === '}') {
        if (paren === 0) break;
        paren -= 1;
      }
      if (paren === 0 && (ch === '+' || ch === ',' || ch === ';' || ch === '\n')) break;
      cursor += 1;
    }
    tail += ':dynamic';
  }
  return { tail, dynamic };
}

function collectApiLiterals(source) {
  const found = [];
  let i = 0;
  while (i < source.length) {
    if (source[i] === '/' && source[i + 1] === '/') {
      i = source.indexOf('\n', i + 2);
      if (i < 0) break;
      continue;
    }
    if (source[i] === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 2;
      continue;
    }
    const quote = source[i];
    if (quote !== "'" && quote !== '"' && quote !== '`') { i += 1; continue; }
    const start = i;
    i += 1;
    let value = '';
    while (i < source.length) {
      if (source[i] === '\\') {
        value += source[i];
        if (i + 1 < source.length) value += source[i + 1];
        i += 2;
        continue;
      }
      if (source[i] === quote) { i += 1; break; }
      value += source[i];
      i += 1;
    }
    if (!value.startsWith('/api/')) continue;
    const concatenation = concatenatedRouteTail(source, i);
    const dynamic = (quote === '`' && value.includes('${')) || concatenation.dynamic;
    let route = value.replace(/\$\{[\s\S]*?\}/g, ':dynamic').replace(/[?#].*$/, '');
    route += concatenation.tail;
    route = route.replace(/[?#].*$/, '');
    found.push({
      offset: start,
      route,
      dynamic,
    });
  }
  return found;
}

function enclosingNamedFunctions(masked, offset) {
  const candidates = [];
  const patterns = [
    { kind: 'function', re: /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^(){}\n]*)\)\s*\{/g },
    { kind: 'method', re: /\b([A-Za-z_$][\w$]*)\s*\(([^(){}\n]*)\)\s*\{/g },
    { kind: 'property', re: /\b([A-Za-z_$][\w$]*)\s*:\s*function\s*\(([^(){}\n]*)\)\s*\{/g },
  ];
  for (const pattern of patterns) {
    const fnRe = pattern.re;
    let match;
    while ((match = fnRe.exec(masked)) && match.index < offset) {
      if (['if', 'for', 'while', 'switch', 'catch', 'function'].includes(match[1])) continue;
      const bodyStart = masked.indexOf('{', match.index);
      const bodyEnd = matchBrace(masked, bodyStart);
      if (bodyStart < offset && bodyEnd > offset) {
        candidates.push({
          kind: pattern.kind,
          name: match[1],
          nameOffset: match.index + match[0].indexOf(match[1]),
          params: match[2].split(',').map((item) => item.trim())
            .filter((item) => /^[A-Za-z_$][\w$]*$/.test(item)),
        });
      }
    }
  }
  return candidates;
}

function callArguments(source, masked, openParen) {
  let depth = 0;
  let closeParen = openParen + 1;
  for (; closeParen < masked.length; closeParen += 1) {
    const ch = masked[closeParen];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) break;
      depth -= 1;
    }
  }
  return splitTopLevel(masked, openParen + 1, closeParen)
    .map(([start, end]) => source.slice(start, end).trim());
}

function scanU1(jsFiles, backendRoutes) {
  const violations = [];
  const dynamicReports = [];
  const variableReports = [];
  let staticCount = 0;
  for (const file of jsFiles) {
    const source = fs.readFileSync(file, 'utf8');
    for (const parsed of collectApiLiterals(source)) {
      const key = `${repoRel(file)}:${lineNumber(source, parsed.offset)}`;
      if (parsed.dynamic) dynamicReports.push({ key, route: parsed.route });
      else staticCount += 1;
      if (![...backendRoutes].some((route) => routeMatches(parsed.route, route))) {
        violations.push({ code: 'U1', key, message: `${parsed.dynamic ? '动态' : '静态'}路径 ${parsed.route} 无后端 Mapping` });
      }
    }
    const masked = maskNonCode(source);
    const wrappers = new Map();
    const requestRe = /\.\s*sendRequest\s*\(/g;
    let request;
    while ((request = requestRe.exec(masked))) {
      const openParen = masked.indexOf('(', request.index);
      let argStart = openParen + 1;
      while (/\s/.test(masked[argStart])) argStart += 1;
      const enclosing = enclosingNamedFunctions(masked, request.index);
      let expression = '';
      if (masked[argStart] === '{') {
        const closeBrace = matchBrace(masked, argStart);
        if (closeBrace < 0) continue;
        const { properties } = objectProperties(source, masked, argStart, closeBrace);
        const urlProp = properties.find((property) => property.name === 'url');
        if (urlProp) {
          const colon = urlProp.raw.indexOf(':');
          expression = colon >= 0 ? urlProp.raw.slice(colon + 1).trim() : urlProp.name;
          if (expressionToApiRoute(expression)) continue;
          if (collectApiLiterals(expression).length > 0) continue;
        }
      } else {
        const closeParen = masked.indexOf(')', argStart);
        expression = source.slice(argStart, closeParen < 0 ? argStart + 120 : closeParen).trim();
      }
      let urlParamIndex = -1;
      const wrapper = enclosing.find((fn) => fn.params.some((param, index) => {
        const matches = (expression === param
          && (fn.kind !== 'property' || param === 'url'))
        || (fn.kind !== 'property' && /^Object\.assign\s*\(/.test(expression)
          && new RegExp(`\\b${param}\\b`).test(expression));
        if (matches) urlParamIndex = index;
        return matches;
      }));
      if (wrapper) {
        wrappers.set(wrapper.name, { ...wrapper, urlParamIndex });
        continue;
      }
      const key = `${repoRel(file)}:${lineNumber(source, request.index)}`;
      const allowed = U1_VARIABLE_ALLOWLIST.get(key);
      variableReports.push({ key, detail: expression.slice(0, 100) || 'sendRequest 参数无静态 url', allowed });
      if (!allowed) {
        violations.push({ code: 'U1', key, message: '运行时变量请求路径无法核对，必须改成可枚举 /api 字面量或受控 wrapper' });
      }
    }
    for (const wrapper of wrappers.values()) {
      const callRe = new RegExp(`(?:\\bthis\\.${wrapper.name}|(?<![\\w$.])${wrapper.name})\\s*\\(`, 'g');
      let call;
      while ((call = callRe.exec(masked))) {
        const nameOffset = call.index;
        if (nameOffset === wrapper.nameOffset) continue;
        const openParen = masked.indexOf('(', nameOffset);
        const args = callArguments(source, masked, openParen);
        const argument = args[wrapper.urlParamIndex] || '';
        if (collectApiLiterals(argument).length > 0) continue;
        const key = `${repoRel(file)}:${lineNumber(source, nameOffset)}`;
        const allowed = U1_VARIABLE_ALLOWLIST.get(key);
        variableReports.push({ key, detail: `${wrapper.name}(${argument.slice(0, 80)})`, allowed });
        if (!allowed) {
          violations.push({ code: 'U1', key,
            message: `受控 wrapper ${wrapper.name} 的首参不是可枚举 /api 字面量` });
        }
      }
    }
  }
  return { violations, staticCount, dynamicReports, variableReports, backendRouteCount: backendRoutes.size };
}

const PAGE_LIFECYCLES = new Set([
  'onLoad', 'onReady', 'onShow', 'onHide', 'onUnload', 'onPullDownRefresh',
  'onReachBottom', 'onShareAppMessage', 'onShareTimeline', 'onPageScroll',
  'onResize', 'onTabItemTap', 'onAddToFavorites', 'onSaveExitState',
]);
const HANDLER_LIKE_RE = /^(?:on|go|tap|handle|retry)[A-Z0-9_$]/;

function collectWxmlSource(file, seen = new Set()) {
  if (!file || seen.has(file) || !fs.existsSync(file)) return '';
  seen.add(file);
  const source = fs.readFileSync(file, 'utf8');
  let combined = source;
  const includeRe = /<include\s+src=["']([^"']+)["']/g;
  let match;
  while ((match = includeRe.exec(source))) {
    combined += `\n${collectWxmlSource(path.resolve(path.dirname(file), match[1]), seen)}`;
  }
  return combined;
}

function methodLine(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)\\s*(?:async\\s+)?${escaped}\\s*(?:\\(|:)`).exec(source);
  return match ? lineNumber(source, match.index) : 1;
}

function jsReferencesMethod(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const references = source.match(new RegExp(`\\b${escaped}\\b`, 'g')) || [];
  return references.length > 1;
}

function scanU3(jsFiles, debtBaseline = U3_DEBT_BASELINE) {
  const violations = [];
  const candidates = [];
  for (const file of jsFiles) {
    const wxmlFile = file.replace(/\.js$/, '.wxml');
    if (!fs.existsSync(wxmlFile)) continue;
    const source = fs.readFileSync(file, 'utf8');
    // extractHandlerNames 会跟进 `...MODULE_METHODS` 拿到 spread 目标里的定义,
    // 但「js 内部有没有引用它」不能只看宿主正文 —— 定义在目标文件、调用在宿主,
    // 只搜宿主就把 onPrepareSession 这类恒判成孤儿。目标要**去重**:
    // 同一个模块常被 spread 两次(DATA + METHODS 同源),拼两遍会让目标里每个定义
    // 都「出现两次」,反过来把真孤儿静默放行,比不修更糟。
    const spreadSources = [...new Set(resolveSpreadRequireTargets(source))].map((rel) => {
      try { return fs.readFileSync(path.resolve(path.dirname(file), rel), 'utf8'); } catch (e) { return ''; }
    });
    const jsScope = maskNonCode([source].concat(spreadSources).join('\n'));
    const wxml = collectWxmlSource(wxmlFile);
    const bound = new Set();
    for (const binding of findEventBindings(wxml)) {
      const names = binding.value.match(/[A-Za-z_$][\w$]*/g) || [];
      names.forEach((name) => bound.add(name));
    }
    for (const name of new Set(extractHandlerNames(file))) {
      if (!HANDLER_LIKE_RE.test(name) || PAGE_LIFECYCLES.has(name) || bound.has(name)
          || jsReferencesMethod(jsScope, name)) continue;
      const key = `${repoRel(file)}#${name}`;
      const allowed = debtBaseline.get(key);
      const item = { key, line: methodLine(source, name), allowed };
      candidates.push(item);
      if (!allowed) violations.push({ code: 'U3', key: `${repoRel(file)}:${item.line}`, message: `${name} 是零 WXML 绑定的 handler-like 方法` });
    }
  }
  return { violations, candidates };
}

function wxmlConsumesField(wxml, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w$.])${escaped}\\b`).test(wxml.replace(/<!--[\s\S]*?-->/g, ' '));
}

function stripCommentsOnly(source) {
  const out = source.split('');
  let quote = null;
  for (let i = 0; i < source.length; i += 1) {
    if (quote) {
      if (source[i] === '\\') { i += 1; continue; }
      if (source[i] === quote) quote = null;
      continue;
    }
    if (source[i] === "'" || source[i] === '"' || source[i] === '`') {
      quote = source[i];
      continue;
    }
    if (source[i] === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') { out[i] = ' '; i += 1; }
      i -= 1;
      continue;
    }
    if (source[i] === '/' && source[i + 1] === '*') {
      out[i] = ' '; out[i + 1] = ' '; i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] !== '\n') out[i] = ' ';
        i += 1;
      }
      if (i < source.length) { out[i] = ' '; out[i + 1] = ' '; i += 1; }
    }
  }
  return out.join('');
}

function jsConsumesDataField(source, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const dotRead = new RegExp(`\\bthis\\.data\\.${escaped}\\b`).test(maskNonCode(source));
  const bracketRead = new RegExp(`\\bthis\\.data\\[['\"]${escaped}['\"]\\]`).test(stripCommentsOnly(source));
  return dotRead || bracketRead;
}

function scanU4(jsFiles, debtBaseline = U4_DEBT_BASELINE, dynamicAllowlist = U4_DYNAMIC_ALLOWLIST) {
  const violations = [];
  const candidates = [];
  const dynamicReports = [];
  for (const file of jsFiles) {
    const wxmlFile = file.replace(/\.js$/, '.wxml');
    if (!fs.existsSync(wxmlFile)) continue;
    const source = fs.readFileSync(file, 'utf8');
    const masked = maskNonCode(source);
    const wxml = collectWxmlSource(wxmlFile);
    const seenFields = new Set();
    const callRe = /\b(?:this|that)\s*\.\s*setData\s*\(/g;
    let call;
    while ((call = callRe.exec(masked))) {
      const openParen = masked.indexOf('(', call.index);
      let argStart = openParen + 1;
      while (/\s/.test(masked[argStart])) argStart += 1;
      const line = lineNumber(source, call.index);
      if (masked[argStart] !== '{') {
        const key = `${repoRel(file)}:${line}`;
        const allowed = dynamicAllowlist.get(key);
        dynamicReports.push({ key, allowed, detail: 'setData 参数不是对象字面量' });
        if (!allowed) violations.push({ code: 'U4', key, message: '动态 setData 未登记,无法核对顶层字段消费' });
        continue;
      }
      const closeBrace = matchBrace(masked, argStart);
      if (closeBrace < 0) {
        violations.push({ code: 'U4', key: `${repoRel(file)}:${line}`, message: 'setData 对象大括号无法配对' });
        continue;
      }
      const { properties, dynamic } = objectProperties(source, masked, argStart, closeBrace);
      for (const entry of dynamic) {
        const key = `${repoRel(file)}:${lineNumber(source, entry.offset)}`;
        const allowed = dynamicAllowlist.get(key);
        dynamicReports.push({ key, allowed, detail: entry.raw.slice(0, 100) });
        if (!allowed) violations.push({ code: 'U4', key, message: '动态 setData 字段未登记,无法核对 WXML 消费' });
      }
      for (const property of properties) {
        const field = property.name.split(/[.[]/, 1)[0];
        if (!field || seenFields.has(field) || wxmlConsumesField(wxml, field)
            || jsConsumesDataField(source, field)) continue;
        seenFields.add(field);
        const key = `${repoRel(file)}#${field}`;
        const allowed = debtBaseline.get(key);
        const item = { key, line: lineNumber(source, property.offset), allowed };
        candidates.push(item);
        if (!allowed) violations.push({ code: 'U4', key: `${repoRel(file)}:${item.line}`, message: `setData 顶层字段 ${field} 在同页 WXML 零消费` });
      }
    }
  }
  return { violations, candidates, dynamicReports };
}

function namedFunctionBodies(source, name) {
  const masked = maskNonCode(source);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`\\bfunction\\s+${escaped}\\s*\\([^)]*\\)\\s*\\{`, 'g'),
    new RegExp(`\\b${escaped}\\s*:\\s*function\\s*\\([^)]*\\)\\s*\\{`, 'g'),
    new RegExp(`\\b${escaped}\\s*=\\s*(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>\\s*\\{`, 'g'),
    new RegExp(`\\b${escaped}\\s*\\([^)]*\\)\\s*\\{`, 'g'),
  ];
  const bodies = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(masked))) {
      const open = masked.indexOf('{', match.index);
      const close = open < 0 ? -1 : matchBrace(masked, open);
      if (close > open) {
        const signature = source.slice(match.index, open);
        const paramStart = signature.indexOf('(');
        const paramEnd = signature.lastIndexOf(')');
        let params = [];
        if (paramStart >= 0 && paramEnd > paramStart) {
          const signatureMasked = maskNonCode(signature);
          params = splitTopLevel(signatureMasked, paramStart + 1, paramEnd)
            .map(([start, end]) => signature.slice(start, end).trim())
            .map((item) => (/^[A-Za-z_$][\w$]*$/.test(item) ? item : null));
        } else {
          const arrowParam = /=\s*([A-Za-z_$][\w$]*)\s*=>/.exec(signature);
          if (arrowParam) params = [arrowParam[1]];
        }
        bodies.push({ body: source.slice(open + 1, close), params });
      }
    }
  }
  return bodies;
}

function matchParen(masked, openParen) {
  let depth = 0;
  for (let i = openParen; i < masked.length; i += 1) {
    if (masked[i] === '(') depth += 1;
    else if (masked[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

function helperRendersVisibleMessage(file, body, literalParams) {
  const masked = maskNonCode(body);
  const wxmlPath = file.replace(/\.js$/, '.wxml');
  const wxml = fs.existsSync(wxmlPath) ? collectWxmlSource(wxmlPath) : '';
  const tainted = new Set(literalParams);
  const assignmentRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g;
  let changed = true;
  while (changed) {
    changed = false;
    assignmentRe.lastIndex = 0;
    let assignment;
    while ((assignment = assignmentRe.exec(masked))) {
      if (tainted.has(assignment[1])) continue;
      if ([...tainted].some((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(assignment[2]))) {
        tainted.add(assignment[1]);
        changed = true;
      }
    }
  }
  const setDataRe = /\bsetData\s*\(\s*\{/g;
  let match;
  while ((match = setDataRe.exec(masked))) {
    const patchStart = masked.indexOf('{', match.index);
    const patchEnd = patchStart < 0 ? -1 : matchBrace(masked, patchStart);
    if (patchEnd < 0) break;
    const patch = objectProperties(body, masked, patchStart, patchEnd).properties;
    if (patch.some((property) => /(?:err|error|message|messages)/i.test(property.name)
      && wxmlConsumesField(wxml, property.name.split(/[.[]/, 1)[0])
      && [...tainted].some((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
        .test(maskNonCode(property.raw))))) return true;
    setDataRe.lastIndex = patchEnd + 1;
  }
  return false;
}

function hasVisibleU5Feedback(file, source, candidate, seen = new Set()) {
  const masked = maskNonCode(candidate);
  // 2026-09-06 原生弹层全删:轻提示统一走 utils/toast.js(toast / toast.success / toast.error / cyToast),它们就是可见反馈
  if (/\bshowToast\s*\(|\.tips\s*\(|\b(?:cy)?[tT]oast(?:\.(?:success|error|show))?\s*\(/.test(masked)) return true;
  const wxmlPath = file.replace(/\.js$/, '.wxml');
  const wxml = fs.existsSync(wxmlPath) ? collectWxmlSource(wxmlPath) : '';
  const setDataRe = /\bsetData\s*\(\s*\{/g;
  let setDataMatch;
  while ((setDataMatch = setDataRe.exec(masked))) {
    const patchStart = masked.indexOf('{', setDataMatch.index);
    const patchEnd = patchStart < 0 ? -1 : matchBrace(masked, patchStart);
    if (patchEnd < 0) break;
    const patch = objectProperties(candidate, masked, patchStart, patchEnd).properties;
    if (patch.some((property) => {
      const field = property.name.split(/[.[]/, 1)[0];
      const requestErrorFallback = /\bgetRequestErrorMessage\s*\([^)]*,\s*['"][^'"]+['"]/.test(candidate);
      const errorField = /(?:err|error|empty|offline|failed)/i.test(property.name)
        && (/\:\s*true\b/.test(property.raw)
          || /['"][^'"]+['"]/.test(property.raw)
          || /\:\s*[A-Z_$][A-Z0-9_$]*(?:ERROR|EMPTY|OFFLINE|FAILED)[A-Z0-9_$]*/.test(property.raw)
          || requestErrorFallback);
      const explicitErrorState = /(?:state|status)$/i.test(property.name)
        && /['"](?:error|empty|offline|failed)['"]/i.test(property.raw);
      const errorSemantic = errorField || explicitErrorState;
      return errorSemantic && wxmlConsumesField(wxml, field);
    })) return true;
    setDataRe.lastIndex = patchEnd + 1;
  }
  if (seen.size >= 6) return false;
  const callRe = /(?:(?:this|that)\s*\.\s*)?\b([A-Za-z_$][\w$]*)\s*\(/g;
  let call;
  while ((call = callRe.exec(masked))) {
    const name = call[1];
    if (seen.has(name) || ['resolve', 'reject', 'setData'].includes(name)) continue;
    const bodies = namedFunctionBodies(source, name);
    if (!bodies.length) continue;
    const openParen = callRe.lastIndex - 1;
    const closeParen = matchParen(masked, openParen);
    if (closeParen > openParen && bodies.some(({ body, params }) => {
      const args = splitTopLevel(masked, openParen + 1, closeParen)
        .map(([start, end]) => candidate.slice(start, end).trim());
      const literalParams = params.filter((param, index) => param && /^(['"])[^'"]+\1$/.test(args[index] || ''));
      return literalParams.length && helperRendersVisibleMessage(file, body, literalParams);
    })) return true;
    const nextSeen = new Set(seen);
    nextSeen.add(name);
    if (bodies.some(({ body }) => hasVisibleU5Feedback(file, source, body, nextSeen))) return true;
  }
  return false;
}

function scanU5(jsFiles, allowlist = U5_SILENT_ALLOWLIST) {
  const violations = [];
  const callsites = [];
  const autoSafe = [];
  for (const file of jsFiles) {
    const source = fs.readFileSync(file, 'utf8');
    const masked = maskNonCode(source);
    const re = /\bsilentError\s*:\s*true\b/g;
    let match;
    while ((match = re.exec(masked))) {
      const key = `${repoRel(file)}:${lineNumber(source, match.index)}`;
      const requestStart = masked.lastIndexOf('.sendRequest', match.index);
      const objectStart = requestStart < 0 ? -1 : masked.indexOf('{', requestStart);
      const objectEnd = objectStart < 0 ? -1 : matchBrace(masked, objectStart);
      const sameRequest = objectStart >= 0 && objectStart < match.index && objectEnd > match.index
        ? source.slice(objectStart, objectEnd + 1) : '';
      const sameRequestMasked = maskNonCode(sameRequest);
      const { properties } = sameRequest
        ? objectProperties(sameRequest, sameRequestMasked, 0, sameRequest.length - 1)
        : { properties: [] };
      const failProperty = properties.find((property) => property.name === 'fail');
      const failSource = failProperty ? failProperty.raw : '';
      const visibleFallback = hasVisibleU5Feedback(file, source, failSource);
      if (visibleFallback) {
        autoSafe.push({ key, detail: 'fail 回调内存在 toast/tips 或 WXML 已消费的错误/空态 setData' });
        continue;
      }
      const allowed = allowlist.get(key);
      callsites.push({ key, allowed });
      if (!allowed) violations.push({ code: 'U5', key, message: 'silentError:true 调用点未登记允许静默的理由' });
    }
  }
  return { violations, callsites, autoSafe };
}

function scanLegacy(jsFiles, wxmlFiles) {
  const errors = [];
  const warnings = [];
  const app = JSON.parse(fs.readFileSync(path.join(XCX_ROOT, 'app.json'), 'utf8'));
  const registered = new Set((app.pages || []).map((page) => `/${page}`));
  for (const subpackage of app.subPackages || []) {
    const root = subpackage.root.replace(/^\/|\/$/g, '');
    for (const page of subpackage.pages || []) registered.add(`/${root}/${page}`);
  }
  const normalize = (raw) => raw.trim().replace(/[?#].*$/, '').replace(/\/$/, '');
  for (const file of jsFiles) {
    const source = fs.readFileSync(file, 'utf8');
    let match;
    const navRe = /(?:navigateTo|redirectTo|reLaunch)\s*\(\s*\{[^}]*?url:\s*[`'"]([^`'"]+)[`'"]/g;
    while ((match = navRe.exec(source))) {
      const target = normalize(match[1]);
      if (target.startsWith('/') && !target.includes('${') && !registered.has(target)) {
        errors.push({ code: 'LEGACY', key: `${repoRel(file)}:${lineNumber(source, match.index)}`, message: `导航目标 ${target} 未在 app.json 注册` });
      }
    }
    // 提示文案闸都扫剥掉注释后的代码:注释里提到「参数错误」不算,代码里 msg.includes('参数错误') 也不算(那是在拦它)。
    const code = stripCommentsOnly(source);
    const TOAST_CALL = '(?:app\\.tips|(?:cy)?[tT]oast(?:\\.(?:success|error|show))?)\\s*\\(';
    const PLACEHOLDER_WORDS = '开发中|暂未开放|暂未上线|敬请期待|即将开放|功能建设中|待开放|即将上线|尚未可用|尚未开放|实验预览';
    const placeholderRe = new RegExp(`(?:(?:title|content):|${TOAST_CALL})\\s*[\`'"][^\`'"\\n]*(?:${PLACEHOLDER_WORDS})[^\`'"\\n]*[\`'"]`, 'g');
    while ((match = placeholderRe.exec(code))) {
      warnings.push({ code: 'LEGACY', key: `${repoRel(file)}:${lineNumber(code, match.index)}`, message: '存在占位入口文案' });
    }
    // 怪文案闸(审核清单 §6.3):开发者口径 / 没有下一步的网络文案 / 半角逗号 / 超长 toast。
    // safe-user-message.js 是净化层本身,里面出现这些词是为了拦它们。
    if (!repoRel(file).endsWith('utils/transport/safe-user-message.js')) {
      const devTermRe = /[`'"][^`'"\n]*(?:参数错误|参数异常|数据异常|系统错误|系统异常|网络请求失败)[^`'"\n]*[`'"]/g;
      while ((match = devTermRe.exec(code))) {
        // includes('参数错误') / === '参数错误' 是在识别后端原话,不是给用户看的
        if (/(?:includes|indexOf|startsWith|test)\(\s*$|[=!]==?\s*$/.test(code.slice(Math.max(0, match.index - 14), match.index))) continue;
        warnings.push({ code: 'LEGACY', key: `${repoRel(file)}:${lineNumber(code, match.index)}`, message: '开发者口径文案(参数/数据异常类),要写成用户下一步能做什么' });
      }
      const bareNetRe = /[`'"](?:网络错误|网络异常)[`'"]/g;
      while ((match = bareNetRe.exec(code))) {
        warnings.push({ code: 'LEGACY', key: `${repoRel(file)}:${lineNumber(code, match.index)}`, message: '网络文案没有下一步,统一「网络异常，请重试」' });
      }
      const toastLiteralRe = new RegExp(`${TOAST_CALL}\\s*([\`'"])([^\`'"\\n]+)\\1`, 'g');
      while ((match = toastLiteralRe.exec(code))) {
        const text = match[2];
        const key = `${repoRel(file)}:${lineNumber(code, match.index)}`;
        if (text.includes(',')) warnings.push({ code: 'LEGACY', key, message: '提示文案用了半角逗号' });
        const size = text.replace(/\$\{[^}]*\}/g, '').replace(/\s/g, '').length;   // 模板占位不算字数
        if (size > 16) warnings.push({ code: 'LEGACY', key, message: `提示文案 ${size} 字,超过 16 字上限,长说明请落到页内错误态` });
      }
    }
  }
  for (const file of wxmlFiles) {
    const source = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    const navRe = /<navigator[^>]*\burl=["']([^"']+)["']/g;
    let match;
    while ((match = navRe.exec(source))) {
      const target = normalize(match[1]);
      if (target.startsWith('/') && !target.includes('{{') && !registered.has(target)) {
        errors.push({ code: 'LEGACY', key: `${repoRel(file)}:${lineNumber(source, match.index)}`, message: `navigator 目标 ${target} 未在 app.json 注册` });
      }
    }
  }
  return { errors, warnings };
}

function enforcedLegacyViolations(legacy) {
  return [...legacy.errors, ...(WARN_AS_ERROR ? legacy.warnings : [])];
}

function assertSelftest(name, bad, good, detail) {
  if (!bad || !good) throw new Error(`${name} 自证失败:${detail}`);
  console.log(`[SELFTEST][${name}] RED caught; restored GREEN — ${detail}`);
}

function baselineKeyDigest(baseline) {
  return crypto.createHash('sha256').update([...baseline.keys()].sort().join('\n')).digest('hex');
}

function baselineContract(name, baseline, observedKeys, ratchetLimit, ceiling = ratchetLimit,
  expectedDigest) {
  const violations = [];
  const observed = new Set(observedKeys);
  for (const [key, reason] of baseline) {
    if (!observed.has(key)) {
      violations.push({ code: 'BASELINE', key, message: `${name} 基线已未命中，必须删除过期项` });
    }
    if (typeof reason !== 'string' || reason.trim().length < 12) {
      violations.push({ code: 'BASELINE', key, message: `${name} 保留理由必须逐项写明真实原因` });
    }
  }
  if (!Number.isInteger(ratchetLimit) || ratchetLimit !== baseline.size) {
    violations.push({
      code: 'BASELINE', key: name,
      message: `${name} 棘轮=${ratchetLimit}、基线=${baseline.size}；修复后必须显式同步调小，新增不得隐式放宽`,
    });
  }
  if (!Number.isInteger(ceiling) || baseline.size > ceiling) {
    violations.push({
      code: 'BASELINE', key: name,
      message: `${name} 基线=${baseline.size} 超过冻结上限=${ceiling}；债务/豁免只准变小，新增必须单独审查并显式改门禁`,
    });
  }
  if (typeof expectedDigest !== 'string' || !/^[0-9a-f]{64}$/.test(expectedDigest)) {
    violations.push({
      code: 'BASELINE', key: name,
      message: `${name} keyDigest 缺失或格式无效；债务/豁免 key 集合必须显式冻结`,
    });
  } else if (expectedDigest !== baselineKeyDigest(baseline)) {
    violations.push({
      code: 'BASELINE', key: name,
      message: `${name} key 集合变化但 digest 未显式更新；等量替换也必须单独审查`,
    });
  }
  return violations;
}

function runSelftest() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-gate-0-'));
  try {
    const js = path.join(fixtureRoot, 'index.js');
    const wxml = path.join(fixtureRoot, 'index.wxml');

    fs.writeFileSync(js, "function req(url){return getApp().sendRequest({url})}Page({load(){req('/api/missing')}})\n");
    fs.writeFileSync(wxml, '<view bindtap="load"></view>\n');
    const u1Bad = scanU1([js], new Set(['/api/present']), new Map()).violations.some((v) => v.code === 'U1');
    fs.writeFileSync(js, "function req(url){return getApp().sendRequest({url})}Page({load(){req('/api/present')}})\n");
    const u1Good = scanU1([js], new Set(['/api/present']), new Map()).violations.length === 0;
    const chained = collectApiLiterals("req('/api/present/' + id + '/accept')")[0];
    const u1ChainedGood = chained.route === '/api/present/:dynamic/accept'
      && routeMatches(chained.route, '/api/present/{id}/accept')
      && !routeMatches('/api/present/:dynamic', '/api/present/{id}/extra');
    fs.writeFileSync(js, "const route=getRuntimeRoute();Page({load(){getApp().sendRequest({url:route})}})\n");
    const u1VariableBad = scanU1([js], new Set(['/api/present'])).violations
      .some((item) => item.message.includes('运行时变量'));
    fs.writeFileSync(js, "function req(url){return getApp().sendRequest({url})}Page({load(){req(getRuntimeRoute())}})\n");
    const u1WrapperVariableBad = scanU1([js], new Set(['/api/present'])).violations
      .some((item) => item.message.includes('受控 wrapper'));
    fs.writeFileSync(js, "Page({onTap(e){getApp().sendRequest({url:e.currentTarget.dataset.url})}})\n");
    const u1HandlerVariableBad = scanU1([js], new Set(['/api/present'])).violations
      .some((item) => item.message.includes('运行时变量'));
    assertSelftest('U1', u1Bad && u1VariableBad && u1WrapperVariableBad && u1HandlerVariableBad,
      u1Good && u1ChainedGood,
      '不存在的 /api Mapping 会阻断，拼接后缀与路由段数不会 fail-open');

    fs.writeFileSync(js, 'Page({ realHandler() {} })\n');
    fs.writeFileSync(wxml, '<button bindtap="ghostHandler">x</button>\n');
    const u2Bad = lintWxmlHandlers(fixtureRoot).violations.length === 1;
    fs.writeFileSync(js, 'Page({ ghostHandler() {} })\n');
    const u2Good = lintWxmlHandlers(fixtureRoot).violations.length === 0;
    assertSelftest('U2', u2Bad, u2Good, '真实 lintRepo 扫描路径能判红并恢复绿');

    fs.writeFileSync(js, 'Page({ retryLoad() {} })\n');
    fs.writeFileSync(wxml, '<view>no binding</view>\n');
    const u3Bad = scanU3([js], new Map()).violations.some((v) => v.code === 'U3');
    fs.writeFileSync(wxml, '<button bindtap="retryLoad">retry</button>\n');
    const u3Good = scanU3([js], new Map()).violations.length === 0;
    assertSelftest('U3', u3Bad, u3Good, '零绑定 handler-like 方法会阻断');

    fs.writeFileSync(js, 'Page({ load() { this.setData({ reco: [] }) } })\n');
    fs.writeFileSync(wxml, '<view>empty</view>\n');
    const u4Bad = scanU4([js], new Map(), new Map()).violations.some((v) => v.code === 'U4');
    fs.writeFileSync(wxml, '<view wx:for="{{reco}}">{{item}}</view>\n');
    const u4WxmlGood = scanU4([js], new Map(), new Map()).violations.length === 0;
    fs.writeFileSync(js, "Page({ load() { this.setData({ reco: [] }); return this.data['reco'] } })\n");
    fs.writeFileSync(wxml, '<view>JS-only state</view>\n');
    const u4BracketGood = scanU4([js], new Map(), new Map()).violations.length === 0;
    fs.writeFileSync(js, 'Page({ writeBack() { this._prev.setData({ nodes: [] }) } })\n');
    const u4ForeignReceiverGood = scanU4([js], new Map(), new Map()).violations.length === 0;
    assertSelftest('U4', u4Bad, u4WxmlGood && u4BracketGood && u4ForeignReceiverGood,
      'WXML 零消费会阻断，this.data bracket 真实消费不会被注释掩码误报');

    fs.writeFileSync(js, "const app=getApp();Page({load(){app.sendRequest({url:'/api/present',silentError:true})}})\n");
    const u5Bad = scanU5([js], new Map()).violations.some((v) => v.code === 'U5');
    fs.writeFileSync(js, "const app=getApp();Page({load(){app.sendRequest({url:'/api/present',silentError:true,fail(){}})}})\n");
    const u5EmptyFailBad = scanU5([js], new Map()).violations.some((v) => v.code === 'U5');
    fs.writeFileSync(js, "const app=getApp();Page({load(){app.sendRequest({url:'/api/present',silentError:true,fail(){resolve(null)}})}})\n");
    const u5ResolveNullBad = scanU5([js], new Map()).violations.some((v) => v.code === 'U5');
    fs.writeFileSync(js, "const app=getApp();Page({load(){app.sendRequest({url:'/api/present',silentError:true,fail(err){auditFailures.push(err)}})}})\n");
    const u5SideEffectFailBad = scanU5([js], new Map()).violations.some((v) => v.code === 'U5');
    fs.writeFileSync(js, "const app=getApp();function renderFailure(page){page.setData({loading:false})}Page({load(){app.sendRequest({url:'/api/present',silentError:true,fail(){renderFailure(this)}})}})\n");
    fs.writeFileSync(wxml, '<view wx:if="{{loading}}">加载中</view>\n');
    const u5HelperLoadingBad = scanU5([js], new Map()).violations.some((v) => v.code === 'U5');
    fs.writeFileSync(js, "const app=getApp();function renderFailure(page,label){auditFailures.push(label);page.setData({message:''})}Page({load(){app.sendRequest({url:'/api/present',silentError:true,fail(){renderFailure(this,'audit')}})}})\n");
    fs.writeFileSync(wxml, '<view>{{message}}</view>\n');
    const u5HelperEmptyMessageBad = scanU5([js], new Map()).violations.some((v) => v.code === 'U5');
    fs.writeFileSync(js, "const app=getApp();function renderFailure(ignored=0,message,page){page.setData({message:message})}Page({load(){app.sendRequest({url:'/api/present',silentError:true,fail(){renderFailure('audit',null,this)}})}})\n");
    const u5HelperParamShiftBad = scanU5([js], new Map()).violations.some((v) => v.code === 'U5');
    fs.writeFileSync(js, "const app=getApp();Page({load(){app.sendRequest({url:'/api/present',silentError:true,success(){wx.showToast({title:'完成'})},fail(){resolve(null)}})}})\n");
    const u5SuccessToastBad = scanU5([js], new Map()).violations.some((v) => v.code === 'U5');
    fs.writeFileSync(js, "const app=getApp();Page({load(){app.sendRequest({url:'/api/present',silentError:true,fail(){wx.showToast({title:'网络异常'})}})}})\n");
    const u5VisibleToastGood = scanU5([js], new Map()).violations.length === 0;
    fs.writeFileSync(js, "const app=getApp();Page({load(){app.sendRequest({url:'/api/present',silentError:true,fail(){this.setData({loadError:true})}})}})\n");
    fs.writeFileSync(wxml, '<view wx:if="{{loadError}}">加载失败</view>\n');
    const u5VisibleStateGood = scanU5([js], new Map()).violations.length === 0;
    fs.writeFileSync(js, "const app=getApp();function renderFailure(page){page.setData({state:'ERROR'})}Page({load(){app.sendRequest({url:'/api/present',silentError:true,fail(){renderFailure(this)}})}})\n");
    fs.writeFileSync(wxml, '<view wx:if="{{state === \'ERROR\'}}">加载失败</view>\n');
    const u5VisibleHelperStateGood = scanU5([js], new Map()).violations.length === 0;
    const u5Key = `${repoRel(js)}:1`;
    fs.writeFileSync(js, "const app=getApp();Page({load(){app.sendRequest({url:'/api/present',silentError:true,fail(){resolve(null)}})}})\n");
    const u5AllowlistedGood = scanU5([js], new Map([[u5Key, 'fixture:调用方确认该增强允许静默']])).violations.length === 0;
    assertSelftest('U5', u5Bad && u5EmptyFailBad && u5ResolveNullBad
      && u5SideEffectFailBad && u5HelperLoadingBad && u5HelperEmptyMessageBad
      && u5HelperParamShiftBad && u5SuccessToastBad,
    u5VisibleToastGood && u5VisibleStateGood && u5VisibleHelperStateGood && u5AllowlistedGood,
    'resolve(null)、纯副作用、helper 仅关闭 loading/写空 message/参数错位及 success-only toast 都会红；fail 内可见 toast/错误态与显式逐项登记会绿');

    const roamForbiddenBaselineKeys = [
      'chengyinhub-xcx/pages/roam/index.js#retryReco',
      'chengyinhub-xcx/pages/roam/index.js#reco',
      'chengyinhub-xcx/pages/roam/index.js#goal',
      'chengyinhub-xcx/pages/roam/index.js#onGoalTap',
    ];
    const baselineSections = [BASELINE.cleanupPlan || {}, BASELINE.u3Debt || {}, BASELINE.u4Debt || {}];
    const roamBaselineClear = roamForbiddenBaselineKeys.every((key) => baselineSections.every((section) => !section[key]));
    fs.writeFileSync(js, 'Page({ retryReco() {}, onGoalTap() {}, load() { this.setData({ reco: [], goal: {} }) } })\n');
    fs.writeFileSync(wxml, '<view>no roam controls</view>\n');
    const roamU3Bad = scanU3([js], new Map()).violations.filter((item) => item.code === 'U3').length === 2;
    const roamU4Bad = scanU4([js], new Map(), new Map()).violations.filter((item) => item.code === 'U4').length === 2;
    fs.writeFileSync(js, 'Page({ onGoalTap() {}, load() { this.setData({ goal: {} }) } })\n');
    fs.writeFileSync(wxml, '<view bindtap="onGoalTap">{{goal.text}}</view>\n');
    const roamWiredGood = scanU3([js], new Map()).violations.length === 0
      && scanU4([js], new Map(), new Map()).violations.length === 0;
    assertSelftest('ROAM-NAMING', roamBaselineClear && roamU3Bad && roamU4Bad, roamWiredGood,
      'retryReco/reco 死链必须删除，goal/onGoalTap 必须 WXML 可见且真实绑定，四个 key 禁止 baseline 逃逸');

    const placeholderBad = [
      "Page({show(){wx.showToast({title:'功能建设中'})}})\n",
      "Page({show(){cyToast('二维码功能即将上线')}})\n",
      "Page({show(){toast('参数错误')}})\n",
      "Page({show(){toast('网络异常')}})\n",
      "Page({show(){toast('这家还没有在平台建档,先电话联系')}})\n",
      "Page({show(){toast.error('主办退出必须先完成受控转交，不能在收件箱直接退出')}})\n",
      "Page({show(){app.tips('标记已读失败,请重试')}})\n",
    ].every((src) => { fs.writeFileSync(js, src); return enforcedLegacyViolations(scanLegacy([js], [])).length >= 1; });
    // 注释里提到这些词、代码里 includes('参数错误') 拦它们,都不算违规
    fs.writeFileSync(js, "// 后端偶尔回 '参数错误'\nPage({show(){wx.showToast({title:'操作完成'}); toast('网络异常，请重试'); if (msg.includes('参数错误')) return;}})\n");
    const placeholderGood = enforcedLegacyViolations(scanLegacy([js], [])).length === 0;
    assertSelftest('WARN-AS-ERROR', placeholderBad, placeholderGood,
      '--warn-as-error 下占位/开发者口径/裸网络/半角逗号/超长提示文案会进入失败判定');

    const staleBaseline = baselineContract('U3', new Map([['old#handler', '真实旧理由足够长']]),
      [], 1).some((item) => item.message.includes('未命中'));
    const growthRed = baselineContract('U3', new Map([['new#handler', '新增债务应被冻结上限拦截']]),
      ['new#handler'], 1, 0).some((item) => item.message.includes('冻结上限'));
    const oldDigest = baselineKeyDigest(new Map([['old#handler', '旧键']]));
    const swapRed = baselineContract('U3', new Map([['new#handler', '等量替换也应显式审查']]),
      ['new#handler'], 1, 1, oldDigest).some((item) => item.message.includes('digest'));
    const missingDigestRed = baselineContract('U3', new Map(), [], 0, 0, undefined)
      .some((item) => item.message.includes('keyDigest'));
    const emptyDigest = baselineKeyDigest(new Map());
    const ratchetGreen = baselineContract('U3', new Map(), [], 0, 0, emptyDigest).length === 0;
    assertSelftest('BASELINE-RATCHET', staleBaseline && growthRed && swapRed && missingDigestRed, ratchetGreen,
      '未命中、增长、等量换 key 或缺 digest 真红；显式删除并调小棘轮后恢复绿');
    console.log('UI-GATE-0 selftest:PASS (U1-U5 五条均完成变异红→撤销→绿)');
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function runRepoScan() {
  const jsFiles = walkFiles(XCX_ROOT, '.js');
  const wxmlFiles = walkFiles(XCX_ROOT, '.wxml');
  const backendRoutes = collectBackendRoutes();
  const u1 = scanU1(jsFiles, backendRoutes);
  const u2 = lintWxmlHandlers();
  const u2Violations = u2.violations.map((item) => ({
    code: 'U2', key: `${repoRel(item.file)}:${item.line}`, message: `${item.attrName}="${item.handler}" 对应 JS 方法不存在`,
  }));
  const u3 = scanU3(jsFiles);
  const u4 = scanU4(jsFiles);
  const u5 = scanU5(jsFiles);
  const legacy = scanLegacy(jsFiles, wxmlFiles);
  const ratchet = BASELINE.ratchet || {};
  const baselineViolations = [
    ...baselineContract('U1-VARIABLE', U1_VARIABLE_ALLOWLIST,
      u1.variableReports.map((item) => item.key), ratchet.u1Variable, NON_INCREASING_CEILING.u1Variable,
      ratchet.keyDigest.u1Variable),
    ...baselineContract('U3-DEBT', U3_DEBT_BASELINE, u3.candidates.map((item) => item.key),
      ratchet.u3Handler, NON_INCREASING_CEILING.u3Debt, ratchet.keyDigest.u3Debt),
    ...baselineContract('U4-DEBT', U4_DEBT_BASELINE, u4.candidates.map((item) => item.key),
      ratchet.u4Field, NON_INCREASING_CEILING.u4Debt, ratchet.keyDigest.u4Debt),
    ...baselineContract('U4-DYNAMIC', U4_DYNAMIC_ALLOWLIST, u4.dynamicReports.map((item) => item.key),
      ratchet.u4Dynamic, NON_INCREASING_CEILING.u4Dynamic, ratchet.keyDigest.u4Dynamic),
    ...baselineContract('U5', U5_SILENT_ALLOWLIST, u5.callsites.map((item) => item.key),
      ratchet.u5Silent, NON_INCREASING_CEILING.u5Silent, ratchet.keyDigest.u5Silent),
  ];
  const violations = [
    ...u1.violations, ...u2Violations, ...u3.violations, ...u4.violations,
    ...u5.violations, ...enforcedLegacyViolations(legacy), ...baselineViolations,
  ];

  console.log(`UI-GATE-0 扫描:${jsFiles.length} JS / ${wxmlFiles.length} WXML / ${backendRoutes.size} backend Mapping`);
  console.log(`U1 ${u1.violations.length ? 'FAIL' : 'PASS'}:静态路径 ${u1.staticCount},动态路径 ${u1.dynamicReports.length},变量路径 ${u1.variableReports.length},逐项理由 ${u1.variableReports.filter((item) => item.allowed).length}`);
  u1.dynamicReports.forEach((item) => console.log(`  [U1 DYNAMIC] ${item.key} -> ${item.route}`));
  u1.variableReports.forEach((item) => console.log(`  [U1 VARIABLE${item.allowed ? ' ALLOW' : ''}] ${item.key} ${item.detail}${item.allowed ? ` — ${item.allowed}` : ''}`));
  console.log(`U2 ${u2Violations.length ? 'FAIL' : 'PASS'}:绑定 ${u2.checkedBindingCount},显式 skip ${u2.skipped.length},白名单 0(复用 wxml-handler-lint)`);
  console.log(`U3 ${u3.violations.length ? 'FAIL' : 'PASS'}:零绑定债务 ${u3.candidates.length}/${u3.candidates.filter((item) => item.allowed).length} 已登记,生命周期规则 ${PAGE_LIFECYCLES.size}`);
  console.log(`U4 ${u4.violations.length ? 'FAIL' : 'PASS'}:零消费债务 ${u4.candidates.length}/${u4.candidates.filter((item) => item.allowed).length} 已登记,动态 setData ${u4.dynamicReports.length}/${u4.dynamicReports.filter((item) => item.allowed).length} 已登记`);
  console.log(`U5 ${u5.violations.length ? 'FAIL' : 'PASS'}:需逐项理由 ${u5.callsites.length},同请求内静态证明显式处理 ${u5.autoSafe.length},逐项理由 ${u5.callsites.filter((item) => item.allowed).length}`);
  console.log(`Legacy ${legacy.errors.length ? 'FAIL' : 'PASS'}:error ${legacy.errors.length},warn ${legacy.warnings.length}`);
  legacy.warnings.forEach((item) => console.log(`  [WARN] ${item.key} ${item.message}`));

  if (violations.length) {
    console.error(`UI-GATE-0:FAIL (${violations.length} violations)`);
    violations.forEach((item) => console.error(`  [${item.code}] ${item.key} ${item.message}`));
    process.exitCode = 1;
  } else {
    console.log('UI-GATE-0:PASS');
  }
}

if (require.main === module) {
  if (process.argv.includes('--selftest')) runSelftest();
  else runRepoScan();
}

module.exports = {
  XCX_ROOT,
  collectBackendRoutes,
  collectApiLiterals,
  expressionToApiRoute,
  objectProperties,
  routeMatches,
  scanU1,
  scanU3,
  scanU4,
  scanU5,
  scanLegacy,
  walkFiles,
};
