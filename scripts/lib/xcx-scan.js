#!/usr/bin/env node
'use strict';

/**
 * 小程序 wxml ↔ js 静态解析共享底座。
 *
 * 起因(2026-08-18):U2(死链绑定)/U3(孤儿 handler)/U4(死数据字段)三条门禁要问的是
 * 同一件事的三个方向——「wxml 上写的、js 里定义的,到底对不对得上」。这三条各写一份
 * wxml/js 解析必然会漂:同一个 `<!-- -->` 注释、同一个正则字面量、同一个 behaviors 混入,
 * 三份实现里只要有一份认得不一样,门禁之间就会互相打架(A 说是绑定、B 说不是)。
 * 所以解析层只有这一份,三条门禁只写各自的判据。
 *
 * 本文件的 maskNonCode / scanTopLevelKeys / extractHandlerNames / maskWxmlComments /
 * findEventBindings / classifyBinding / buildIncludeParentMap / companionJs 全部原样
 * 迁自 scripts/wxml-handler-lint.js(2026-07-31 建,已在仓库里跑熟),不是新写的解析器。
 * wxml-handler-lint.js 现在只剩判据 + 自证,解析走这里——它的自证仍然全绿,就是这次
 * 搬迁无损的证据。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

// 与 js-scope-lint 使用 Node 自带的 Acorn；普通 node 门禁没有 --expose-internals。
// 延迟加载，默认 maskNonCode 及其 U2/U3/U4 调用者不依赖该解析器。
let commentParser;
function maskJavaScriptComments(src) {
  if (!commentParser) {
    try {
      commentParser = require('internal/deps/acorn/acorn/dist/acorn');
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error;
      const bundled = process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'];
      if (!bundled) throw new Error('注释扫描需要 Node 内置 Acorn；当前 Node 不提供，禁止跳过 JS 扫描');
      const parserModule = { exports: {} };
      require('vm').runInNewContext(bundled, { module: parserModule, exports: parserModule.exports });
      commentParser = parserModule.exports;
    }
  }
  let comments;
  for (const sourceType of ['script', 'module']) {
    comments = [];
    try {
      commentParser.parse(src, {
        ecmaVersion: 'latest', sourceType, allowHashBang: true,
        allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true,
        onComment: (_block, _text, start, end) => comments.push([start, end]),
      });
      break;
    } catch (error) {
      if (error.name !== 'SyntaxError' || sourceType === 'module') throw error;
    }
  }
  const out = src.split('');
  for (const [start, end] of comments) {
    for (let i = start; i < end; i += 1) {
      if (!/[\r\n\u2028\u2029]/.test(src[i])) out[i] = ' ';
    }
  }
  return out.join('');
}

// / 前一个"有意义字符"决定 / 是除号还是正则字面量开头的经典歧义(JS 词法本身就要靠
// 上下文判断)。这几类前导字符/关键字之后的 / 一律当正则处理;栈里的仓库代码里真
// 出现过 /'/g 这种正则字面量,字符类里带引号——如果只按引号/注释掩码不认正则,会把
// 正则内容误当成字符串,吃掉后面不成对的引号,连锁腐蚀后续所有大括号计数。
const REGEX_PRECEDING_CHARS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', ';', '\n', undefined]);
const REGEX_PRECEDING_KEYWORDS = ['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'case', 'do', 'else'];

// ---------- 通用:屏蔽字符串/注释/正则字面量内容,但保留原始长度和换行位置(行号不受影响) ----------
function maskNonCode(src, { preserveLiterals = false, htmlComments = false } = {}) {
  const out = src.split('');
  let i = 0;
  let lastSignificant = undefined; // 最近一个非空白、非注释、非字符串的"有意义"字符,用于判断 / 是否是正则开头
  let lastWord = '';
  const templateExpressions = [];
  // 文案模式保留模板文字，但 ${...} 内仍是代码；栈记录嵌套插值中的对象/代码块深度。
  function templateContent(start) {
    let j = start;
    lastWord = '';
    while (j < src.length) {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === '`') { lastSignificant = ')'; return j + 1; }
      if (src[j] === '$' && src[j + 1] === '{') {
        templateExpressions.push(0);
        lastSignificant = '{';
        return j + 2;
      }
      j += 1;
    }
    return j;
  }
  while (i < src.length) {
    const c = src[i];
    if (htmlComments && src.startsWith('<!--', i)) {
      const close = src.indexOf('-->', i + 4);
      const end = close === -1 ? src.length : close + 3;
      while (i < end) { out[i] = src[i] === '\n' ? '\n' : ' '; i += 1; }
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      let j = i;
      while (j < src.length && src[j] !== '\n') { out[j] = ' '; j += 1; }
      i = j;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      let j = i;
      out[j] = ' '; out[j + 1] = ' '; j += 2;
      while (j < src.length && !(src[j] === '*' && src[j + 1] === '/')) {
        out[j] = src[j] === '\n' ? '\n' : ' ';
        j += 1;
      }
      if (j < src.length) { out[j] = ' '; out[j + 1] = ' '; j += 2; }
      i = j;
      continue;
    }
    if (preserveLiterals && c === '`') {
      i = templateContent(i + 1);
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') {
      const q = c;
      if (!preserveLiterals) out[i] = ' ';
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { if (!preserveLiterals) { out[j] = ' '; if (j + 1 < src.length) out[j + 1] = src[j + 1] === '\n' ? '\n' : ' '; } j += 2; continue; }
        if (src[j] === q) { if (!preserveLiterals) out[j] = ' '; j += 1; break; }
        if (!preserveLiterals) out[j] = src[j] === '\n' ? '\n' : ' ';
        j += 1;
      }
      i = j;
      lastSignificant = ')'; // 字符串字面量整体等价一个操作数,后面紧跟 / 应按除号处理
      continue;
    }
    if (c === '/' && (REGEX_PRECEDING_CHARS.has(lastSignificant) || REGEX_PRECEDING_KEYWORDS.includes(lastWord))) {
      // 正则字面量:找到未转义的下一个 /,中途 [...] 字符类里的 / 不算结束,末尾允许 gimsuy 标志。
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < src.length) {
        const rc = src[j];
        if (rc === '\n') break; // 正则字面量不跨行,跨行说明误判成正则,放弃当正则处理
        if (rc === '\\') { j += 2; continue; }
        if (rc === '[') { inClass = true; j += 1; continue; }
        if (rc === ']') { inClass = false; j += 1; continue; }
        if (rc === '/' && !inClass) { closed = true; j += 1; break; }
        j += 1;
      }
      if (closed) {
        while (j < src.length && /[a-z]/i.test(src[j])) j += 1;
        if (!preserveLiterals) for (let k = i; k < j; k += 1) out[k] = ' ';
        i = j;
        lastSignificant = ')';
        continue;
      }
      // 没找到闭合 / 或跨了行:大概率是我们对"正则起始"的启发式判断错了,当普通字符放行,
      // 避免把真代码整段吞掉。
    }
    if (templateExpressions.length) {
      const top = templateExpressions.length - 1;
      if (c === '{') templateExpressions[top] += 1;
      else if (c === '}') {
        if (templateExpressions[top] === 0) {
          templateExpressions.pop();
          i = templateContent(i + 1);
          continue;
        }
        templateExpressions[top] -= 1;
      }
    }
    if (/\s/.test(c)) { i += 1; continue; }
    lastSignificant = c;
    lastWord = /[a-zA-Z_$]/.test(c) ? lastWord + c : '';
    if (!/[a-zA-Z_$0-9]/.test(c)) lastWord = '';
    i += 1;
  }
  return out.join('');
}

function lineNumber(source, offset) {
  let line = 1;
  for (let i = 0; i < offset; i += 1) if (source[i] === '\n') line += 1;
  return line;
}

// 找到与 openIdx 处的 { 匹配的 }(openIdx 本身必须是 '{')
function matchBrace(masked, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < masked.length; i += 1) {
    if (masked[i] === '{') depth += 1;
    else if (masked[i] === '}') { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

// 在 [start, end)(某个 {...} 的内部)按"顶层逗号"切段,返回 [{start, end}]。
// 顶层 = 用 {}/()/[] 统一深度计数,深度回到 0 时才是同级 key 之间的分隔逗号。
function scanTopLevelSegments(masked, start, end) {
  const segs = [];
  let depth = 0;
  let segStart = start;
  for (let i = start; i < end; i += 1) {
    const c = masked[i];
    if (depth === 0 && c === ',') { segs.push({ start: segStart, end: i }); segStart = i + 1; continue; }
    if (c === '{' || c === '(' || c === '[') depth += 1;
    else if (c === '}' || c === ')' || c === ']') depth -= 1;
  }
  segs.push({ start: segStart, end });
  return segs;
}

// 在 [start, end) 范围内扫描"顶层"key,返回 [{name, isFunction}]。
function scanTopLevelKeys(masked, start, end) {
  const keys = [];
  scanTopLevelSegments(masked, start, end).forEach(({ start: s, end: e }) => {
    const seg = masked.slice(s, e);
    // ⚠️ 必须认 async:仓库里 pages/play/merchant/index.js 一个文件就有 7 个 `async xxx() {}` 方法,
    //    漏了这一支它们全被判成「wxml 绑了但 js 里没有」⇒ U2 死链按钮门禁整片误报,
    //    而 U3/U4 与它共用本解析器,一起错。(2026-08-18 合并时实测:未修前 async ghostHandler 认不出来。)
    const m = /^\s*(?:async\s+)?['"]?([a-zA-Z_$][\w$]*)['"]?\s*(:|\()/.exec(seg);
    if (!m) return;
    const name = m[1];
    let isFunction = false;
    if (m[2] === '(') {
      isFunction = true;
    } else {
      const afterColon = seg.slice(m.index + m[0].length);
      if (/^\s*(async\s+)?function\b/.test(afterColon)) isFunction = true;
      else if (/^\s*(async\s*)?\([^)]*\)\s*=>/.test(afterColon)) isFunction = true;
      else if (/^\s*[a-zA-Z_$][\w$]*\s*=>/.test(afterColon)) isFunction = true;
    }
    keys.push({ name, isFunction, start: s, end: e });
  });
  return keys;
}

// 找 behaviors:[...] 里引用的变量名对应的 require 目标路径。
// 结构定位必须用去注释/字符串后的等长源码，路径再回原文同一位置取；
// 否则 `// behaviors: [b]` 会把真实的 `behaviors: []` 覆盖掉并造成假绿。
function resolveBehaviorRequireTargets(raw) {
  const masked = maskNonCode(raw);
  const behaviorsMatch = /behaviors\s*:\s*\[([\s\S]*?)\]/.exec(masked);
  if (!behaviorsMatch) return [];
  const innerMaskedStart = behaviorsMatch.index + behaviorsMatch[0].indexOf('[') + 1;
  const innerMasked = behaviorsMatch[1];
  const varNames = innerMasked.split(',').map((s) => s.trim()).filter(Boolean)
    .filter((s) => !/^require\(/.test(s))
    // behaviors 可挂 factory 调用(exitMotion(220));这里取被调用的标识符,
    // 不能把整段表达式拿去拼声明正则,否则会静默漏掉该 behavior。
    .map((s) => {
      const m = /^([A-Za-z_$][\w$]*)/.exec(s);
      return m ? m[1] : '';
    }).filter(Boolean);
  const targets = [];
  varNames.forEach((name) => {
    const declRe = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*require\\s*\\(`);
    const dm = declRe.exec(masked);
    if (!dm) return;
    const sourceTail = raw.slice(dm.index, dm.index + dm[0].length + 512);
    const pathMatch = /require\s*\(\s*(['"])([^'"]+)\1\s*\)/.exec(sourceTail);
    if (pathMatch) targets.push(pathMatch[2]);
  });
  const inlineRe = /require\s*\(/g;
  let im;
  while ((im = inlineRe.exec(innerMasked))) {
    const sourceTail = raw.slice(innerMaskedStart + im.index, innerMaskedStart + im.index + 512);
    const pathMatch = /require\s*\(\s*(['"])([^'"]+)\1\s*\)/.exec(sourceTail);
    if (pathMatch) targets.push(pathMatch[2]);
  }
  return targets;
}

// 对象展开混入:`Page({ ..., ...DIRECTOR_METHODS, ... })`。
// behaviors 那条路径只认 `behaviors: [x]`,认不出展开 —— 而展开是 Page() 唯一能用的混入方式
// (Page 不支持 behaviors,只有 Component 支持)。2026-09-03 导演台从独立页收编进活动详情页时
// 踩到:600 行处理器搬进 ./director.js 后,19 个控件的 handler 真源全定位不到(行号记成 0),
// 台账门禁只能靠调大棘轮放行 —— 那等于把审计弄瞎。这里让它跟着展开走。
function resolveSpreadRequireTargets(raw) {
  const masked = maskNonCode(raw);
  const def = findDefinitionBody(masked);
  if (!def) return [];
  const body = masked.slice(def.bodyStart, def.bodyEnd);
  const names = [...body.matchAll(/\.\.\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  const targets = [];
  [...new Set(names)].forEach((name) => {
    // 支持 `const { X } = require(...)` 与 `const X = require(...)` 两种写法
    const declRe = new RegExp(
      `(?:const|let|var)\\s+(?:\\{[^}]*\\b${name}\\b[^}]*\\}|${name})\\s*=\\s*require\\s*\\(`);
    const dm = declRe.exec(masked);
    if (!dm) return;
    const sourceTail = raw.slice(dm.index, dm.index + dm[0].length + 512);
    const pathMatch = /require\s*\(\s*(['"])([^'"]+)\1\s*\)/.exec(sourceTail);
    if (pathMatch) targets.push(pathMatch[2]);
  });
  return targets;
}

function resolveRequireFile(fromDir, rel) {
  const p = path.resolve(fromDir, rel);
  if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  if (fs.existsSync(p + '.js')) return p + '.js';
  return null;
}

// 定位 Page()/Component()/Behavior()/App() 的定义体范围。
function findDefinitionBody(masked) {
  const callMatch = /\b(Page|Component|Behavior|App)\s*\(/.exec(masked);
  if (!callMatch) return null;
  const openIdx = masked.indexOf('{', callMatch.index + callMatch[0].length);
  if (openIdx === -1) return null;
  const closeIdx = matchBrace(masked, openIdx);
  if (closeIdx === -1) return null;
  return { kind: callMatch[1], bodyStart: openIdx + 1, bodyEnd: closeIdx };
}

// 本文件自己定义的、wxml 能直接 bind 到的方法名(不含 behaviors 混入)。
// Page: 顶层(深度1)里"值是函数"的 key。
// Component/Behavior: methods:{} 子块里的全部 key(该子块内约定即函数);
//   没有 methods:{} 块的退化成顶层函数 key,兼容极简 Behavior 写法。
function ownHandlerEntries(masked) {
  const def = findDefinitionBody(masked);
  if (!def) return [];
  if (def.kind === 'Component' || def.kind === 'Behavior') {
    const methodsMatch = /methods\s*:\s*\{/.exec(masked.slice(def.bodyStart, def.bodyEnd));
    if (methodsMatch) {
      const mOpen = def.bodyStart + methodsMatch.index + methodsMatch[0].length - 1;
      const mClose = matchBrace(masked, mOpen);
      if (mClose === -1) return [];
      return scanTopLevelKeys(masked, mOpen + 1, mClose);
    }
    return scanTopLevelKeys(masked, def.bodyStart, def.bodyEnd).filter((k) => k.isFunction);
  }
  return scanTopLevelKeys(masked, def.bodyStart, def.bodyEnd).filter((k) => k.isFunction);
}

function extractOwnHandlerEntries(filePath, seen) {
  seen = seen || new Set();
  if (seen.has(filePath)) return [];
  seen.add(filePath);
  const src = fs.readFileSync(filePath, 'utf8');
  const masked = maskNonCode(src);
  // k.start 落在上一个逗号之后(可能还带着换行+缩进),直接算行号会偏到上一行。
  const own = ownHandlerEntries(masked).map((k) => {
    // k.start 之前的注释在 masked 里已被抹成空白；用 masked 求 lead 才能落到真实方法名 token，
    // 否则 raw 切片会停在注释起首(如 /**)，staticSource 行号指向定义前一行。
    const maskedRaw = masked.slice(k.start, k.end);
    const lead = maskedRaw.length - maskedRaw.replace(/^\s+/, '').length;
    return { name: k.name, line: lineNumber(src, k.start + lead), file: filePath, start: k.start + lead, end: k.end };
  });
  // 展开混入进来的方法,真源在被 require 的那个文件里 —— 不跟过去就只能记 :0。
  const dir = path.dirname(filePath);
  const mixed = [];
  resolveSpreadRequireTargets(src).forEach((rel) => {
    const resolved = resolveRequireFile(dir, rel);
    if (!resolved) return;
    const modSrc = fs.readFileSync(resolved, 'utf8');
    const modMasked = maskNonCode(modSrc);
    // 模块里是裸对象字面量(module.exports = { A, B }),没有 Page()/Component() 外壳,
    // 所以直接扫每个顶层对象字面量的键。
    for (const m of modMasked.matchAll(/(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*\{/g)) {
      const open = m.index + m[0].length - 1;
      const close = matchBrace(modMasked, open);
      if (close === -1) continue;
      scanTopLevelKeys(modMasked, open + 1, close)
        .filter((k) => k.isFunction)
        .forEach((k) => {
          const maskedRaw = modMasked.slice(k.start, k.end);
          const lead = maskedRaw.length - maskedRaw.replace(/^\s+/, '').length;
          mixed.push({ name: k.name, line: lineNumber(modSrc, k.start + lead), file: resolved, start: k.start + lead, end: k.end });
        });
    }
  });
  const byName = new Map();
  mixed.concat(own).forEach((entry) => { byName.set(entry.name, entry); }); // 本文件定义的覆盖混入的
  return [...byName.values()];
}

// 提取一个 Page()/Component() 定义源文件里,wxml 能直接 bind 到的全部方法名(含 behaviors 混入)。
function extractHandlerNames(filePath, seen) {
  seen = seen || new Set();
  if (seen.has(filePath)) return [];
  seen.add(filePath);
  const src = fs.readFileSync(filePath, 'utf8');
  const masked = maskNonCode(src);

  let names = ownHandlerEntries(masked).map((k) => k.name);
  if (!findDefinitionBody(masked)) return [];

  const behaviorDir = path.dirname(filePath);
  // behaviors:[x] 引用的变量声明(const x = require(...))通常写在 Page()/Component() 调用
  // 之外的文件顶部,必须在整份源码里找,只在调用体内找会漏。用原始 src 不用 masked——
  // require 路径就是个字符串字面量,maskNonCode 会把引号内容连引号一起抹成空格,
  // 拿掉了 declRe 要匹配的引号本身。
  resolveBehaviorRequireTargets(src).forEach((rel) => {
    const resolved = resolveRequireFile(behaviorDir, rel);
    if (resolved) names = names.concat(extractHandlerNames(resolved, seen));
  });

  // 对象展开混入(`...X`)。Page() 不支持 behaviors,展开是它唯一的混入方式 ——
  // 不跟过去的话,住在被 require 模块里的处理器会被判成「JS 方法不存在」(2026-09-03 实证)。
  resolveSpreadRequireTargets(src).forEach((rel) => {
    const resolved = resolveRequireFile(behaviorDir, rel);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    const modSrc = fs.readFileSync(resolved, 'utf8');
    const modMasked = maskNonCode(modSrc);
    for (const m of modMasked.matchAll(/(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*\{/g)) {
      const open = m.index + m[0].length - 1;
      const close = matchBrace(modMasked, open);
      if (close === -1) continue;
      names = names.concat(
        scanTopLevelKeys(modMasked, open + 1, close).filter((k) => k.isFunction).map((k) => k.name));
    }
  });

  return names;
}

// ---------- wxml ----------

// 注释掉的 WXML 不会被框架渲染,里面的 bindtap 也就不是活的绑定。
// 2026-08-01 实证:merchantapply2.wxml:159 有一行 <!-- <button bindtap="addOption">恢复选项</button> -->,
// 原实现直接正则扫全文,把它当成真绑定报了个死链——门禁误报比漏报更坏,它会拿一个不存在的问题
// 挡住别人的 PR。这里把注释内容抹成空格(保留换行 ⇒ 行号不受影响),再交给下面的正则。
function maskWxmlComments(source) {
  const out = source.split('');
  const re = /<!--[\s\S]*?-->/g;
  let m;
  while ((m = re.exec(source))) {
    for (let i = m.index; i < m.index + m[0].length; i += 1) {
      if (out[i] !== '\n') out[i] = ' ';
    }
  }
  return out.join('');
}

const EVENT_ATTR_RE = /((?:capture-)?(?:bind|catch)(?::)?[a-zA-Z][\w-]*)\s*=\s*"([^"]*)"/g;

function findEventBindings(source) {
  const scannable = maskWxmlComments(source);
  const bindings = [];
  let m;
  EVENT_ATTR_RE.lastIndex = 0;
  while ((m = EVENT_ATTR_RE.exec(scannable))) {
    const attrName = m[1];
    const value = m[2].trim();
    bindings.push({ attrName, value, offset: m.index, line: lineNumber(scannable, m.index) });
  }
  return bindings;
}

function classifyBinding(value) {
  if (value === '') return { kind: 'empty' };
  if (value.startsWith('{{')) return { kind: 'expression' };
  if (/^[a-zA-Z_$][\w$]*$/.test(value)) return { kind: 'identifier', name: value };
  return { kind: 'unrecognized' };
}

// 扫出全部标签及其范围(引号内的 > 不算结束)。
function scanTags(source) {
  const tags = [];
  let i = 0;
  while (i < source.length) {
    if (source[i] !== '<') { i += 1; continue; }
    const nm = /^<\/?([a-zA-Z][\w:-]*)/.exec(source.slice(i, i + 80));
    if (!nm) { i += 1; continue; }
    let j = i + 1;
    let q = null;
    while (j < source.length) {
      const c = source[j];
      if (q) { if (c === q) q = null; }
      else if (c === '"' || c === '\'') q = c;
      else if (c === '>') break;
      j += 1;
    }
    tags.push({ name: nm[1], start: i, end: Math.min(j, source.length - 1) });
    i = j + 1;
  }
  return tags;
}

const MUSTACHE_RESERVED = new Set(['true', 'false', 'null', 'undefined', 'typeof', 'in', 'new', 'this', 'NaN', 'Infinity']);

// 从一段表达式里取出"顶层被引用的标识符"。
// ★ 这里刻意不用 /\bNAME\b/ 去匹配:\b 的单词边界把连字符当边界,/\bdetail\b/ 会命中
//   detail-cta-bar,门禁就会认为字段 detail "已被消费" 而假绿(本仓 2026-07 已栽过)。
//   改成先切成标识符 token 再全等比对,连字符名字天然切不出 detail 这个 token。
function identifiersIn(expr) {
  const cleaned = expr.replace(/(['"])(?:\\.|(?!\1)[\s\S])*?\1/g, ' ');
  const out = [];
  const re = /[A-Za-z_$][\w$]*/g;
  let m;
  while ((m = re.exec(cleaned))) {
    const before = cleaned.slice(0, m.index).replace(/\s+$/, '');
    if (before.endsWith('.')) continue;     // a.b 里的 b 是成员名,不是页面字段
    if (MUSTACHE_RESERVED.has(m[0])) continue;
    out.push(m[0]);
  }
  return out;
}

function mustacheIdentifiers(value) {
  const out = [];
  const re = /\{\{([\s\S]*?)\}\}/g;
  let m;
  while ((m = re.exec(value))) out.push(...identifiersIn(m[1]));
  return out;
}

// 不上屏的属性:值再对,用户也看不见。
// aria-*/accessibility-*:只喂读屏器。
// data-*/id/wx:key:只喂事件/框架,不渲染成内容。
// ⚠️ 只列 wxml 里**真的**不渲染的属性。别照搬 HTML 直觉:
//    title / alt 在 HTML 里是 tooltip 和替代文本,在 wxml 里根本不是标准属性,
//    <cy-page-title title="{{x}}"> / <cy-empty title="{{x}}"> 里的 title 是自定义组件的
//    普通 prop,是**要上屏的正文**。把 title 当无障碍属性会一口气误报 22 个字段(实测),
//    正确做法是让它走下面的"自定义组件到底消不消费这个 prop"那条判据。
function isNonRenderingAttr(attr) {
  return /^aria-/.test(attr) || /^accessibility-/.test(attr) || /^data-/.test(attr)
    || attr === 'id' || attr === 'wx:key';
}

function isA11yAttr(attr) {
  return /^aria-/.test(attr) || /^accessibility-/.test(attr);
}

/**
 * 扫一个 wxml 里所有 {{}} 里引用到的标识符。
 * 返回 { refs: [{name, line, tag, attr}], scopeNames:Set, rawText }
 * attr === null 表示这个引用在文本节点里(= 直接上屏)。
 * scopeNames = wx:for 引入的局部名(item/index 或 wx:for-item/wx:for-index 指定的名字),
 * 它们是循环变量不是页面字段,拿它当"字段已被消费"的证据会假绿。
 */
function extractWxmlRefs(source) {
  const masked = maskWxmlComments(source);
  const tags = scanTags(masked);
  const refs = [];
  const scopeNames = new Set();
  const attrValueRanges = [];

  tags.forEach((t) => {
    const blob = masked.slice(t.start, t.end + 1);
    const re = /([A-Za-z_@:][\w:.-]*)\s*=\s*"([^"]*)"/g;
    let am;
    while ((am = re.exec(blob))) {
      const attr = am[1];
      const value = am[2];
      const valStart = t.start + am.index + am[0].length - value.length - 1;
      attrValueRanges.push([valStart, valStart + value.length]);
      if (attr === 'wx:for-item' || attr === 'wx:for-index') { scopeNames.add(value.trim()); continue; }
      if (attr === 'wx:for') { scopeNames.add('item'); scopeNames.add('index'); }
      mustacheIdentifiers(value).forEach((name) => {
        refs.push({ name, line: lineNumber(masked, valStart), tag: t.name, attr });
      });
    }
  });

  const mre = /\{\{([\s\S]*?)\}\}/g;
  let mm;
  while ((mm = mre.exec(masked))) {
    const inAttr = attrValueRanges.some(([a, b]) => mm.index >= a && mm.index < b);
    if (inAttr) continue;
    identifiersIn(mm[1]).forEach((name) => {
      refs.push({ name, line: lineNumber(masked, mm.index), tag: null, attr: null });
    });
  }

  return { refs, scopeNames, masked };
}

// ---------- setData 顶层字段 ----------

function topLevelField(key) {
  return key.split(/[.[]/)[0];
}

function parseObjectKeySegment(raw) {
  const s = raw.trim();
  if (!s) return null;
  if (s.startsWith('...')) return { dynamic: true, reason: '展开运算符,字段名不可静态判定' };
  if (s.startsWith('[')) return { dynamic: true, reason: '计算属性名,字段名不可静态判定' };
  let m = /^(['"`])([^'"`]*)\1\s*:/.exec(s);
  if (m) return { name: topLevelField(m[2]) };
  m = /^([A-Za-z_$][\w$]*)\s*:/.exec(s);
  if (m) return { name: m[1] };
  m = /^([A-Za-z_$][\w$]*)$/.exec(s);
  if (m) return { name: m[1] };                      // 简写 { goal }
  m = /^([A-Za-z_$][\w$]*)\s*\(/.exec(s);
  if (m) return { name: m[1] };
  return { dynamic: true, reason: '无法解析的键:' + s.replace(/\s+/g, ' ').slice(0, 60) };
}

/**
 * 抽一个 js 里全部 setData({...}) 的顶层字段名。
 * 返回 { fields: [{name, line}], unscannable: [{line, reason}] }
 * unscannable 逐条列出,不静默——静态门禁看不懂的地方必须自己说出来。
 */
function extractSetDataFields(src) {
  const masked = maskNonCode(src);
  const fields = [];
  const unscannable = [];
  const re = /\bsetData\s*\(/g;
  let m;
  while ((m = re.exec(masked))) {
    // ★ 接收者不是本页/本组件时,这些字段属于【另一个对象的 data】,本文件判不了。
    //   实例:pages/play/merchant/index.js 的 `this._prev.setData({ nodes })` —— nodes 是
    //   **上一页**(play/index)的字段,而那一页的 wxml 真在渲染它。按接收者一刀切成
    //   「本文件的死数据字段」就是误报,而误报的门禁和不会红的门禁一样会被人绕过。
    //   不静默跳过:进 unscannable,由调用方列出来。(2026-08-18 并入 master 时实测到)
    const before = masked.slice(Math.max(0, m.index - 64), m.index);
    if (/(?:this|[A-Za-z_$][\w$]*)\s*\.\s*[A-Za-z_$][\w$]*\s*\.\s*$/.test(before)) {
      unscannable.push({
        line: lineNumber(src, m.index),
        reason: 'setData 的接收者不是本页/本组件(形如 this.X.setData),字段属于另一个对象的 data,本文件判不了',
      });
      continue;
    }
    const openParen = m.index + m[0].length - 1;
    let i = openParen + 1;
    while (i < masked.length && /\s/.test(masked[i])) i += 1;
    if (masked[i] !== '{') {
      unscannable.push({ line: lineNumber(src, m.index), reason: 'setData 参数不是对象字面量(变量/函数返回值),字段名不可静态判定' });
      continue;
    }
    const close = matchBrace(masked, i);
    if (close === -1) {
      unscannable.push({ line: lineNumber(src, m.index), reason: 'setData 对象字面量大括号未闭合(解析器读不动)' });
      continue;
    }
    scanTopLevelSegments(masked, i + 1, close).forEach((seg) => {
      const raw = src.slice(seg.start, seg.end);
      const parsed = parseObjectKeySegment(raw);
      if (!parsed) return;
      const lead = raw.length - raw.replace(/^\s+/, '').length;
      const line = lineNumber(src, seg.start + lead);
      if (parsed.dynamic) unscannable.push({ line, reason: parsed.reason });
      else fields.push({ name: parsed.name, line });
    });
  }
  return { fields, unscannable };
}

// ---------- 文件遍历 / wxml ↔ js 配对 ----------

function walkFiles(directory, ext) {
  const files = [];
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'miniprogram_npm' || entry.name.startsWith('.')) return;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(target, ext));
    else if (entry.isFile() && entry.name.endsWith(ext)) files.push(target);
  });
  return files;
}

function buildIncludeParentMap(wxmlFiles) {
  const map = new Map(); // 被包含文件的绝对路径 -> 包含它的 wxml 绝对路径
  wxmlFiles.forEach((file) => {
    const src = fs.readFileSync(file, 'utf8');
    const re = /<include\s+src="([^"]+)"/g;
    let m;
    while ((m = re.exec(src))) {
      const target = path.resolve(path.dirname(file), m[1]);
      map.set(target, file);
    }
  });
  return map;
}

function companionJs(wxmlFile, includeParentMap) {
  const direct = wxmlFile.slice(0, -'.wxml'.length) + '.js';
  if (fs.existsSync(direct)) return direct;
  const parent = includeParentMap.get(wxmlFile);
  if (parent) return companionJs(parent, includeParentMap);
  return null;
}

/**
 * js 绝对路径 -> 它负责的全部 wxml(同名 wxml + 通过 <include> 挂在它下面的片段)。
 * ★ 孪生页面陷阱:本仓有 12 对「pages/xx 页面 ↔ components/cy/scene-xx 场景弹窗」双份实现,
 *   只扫 pages/** 会漏掉组件里那一份。这里从 ROOT 整棵树 walk,pages / components /
 *   subpackage* / custom-tab-bar 全在内,两份都看得见。
 */
// root 可指定:U2 的自证要在临时夹具目录上跑「注入违规→变红→撤销→变绿」,
// 只会扫全仓的话自证就退化成「拿真仓库当夹具」,既慢又不可控。(2026-08-18 合并时补回)
function buildJsToWxmlMap(root = ROOT) {
  const wxmlFiles = walkFiles(root, '.wxml');
  const includeParentMap = buildIncludeParentMap(wxmlFiles);
  const map = new Map();
  const orphanWxml = [];
  wxmlFiles.forEach((wxmlFile) => {
    const js = companionJs(wxmlFile, includeParentMap);
    if (!js) { orphanWxml.push(wxmlFile); return; }
    if (!map.has(js)) map.set(js, []);
    map.get(js).push(wxmlFile);
  });
  return { map, orphanWxml, wxmlFiles, includeParentMap };
}

// usingComponents:标签名 -> 组件目录下的文件前缀(不带扩展名)
function loadUsingComponents(ownerFile) {
  const jsonFile = ownerFile.replace(/\.(wxml|js)$/, '.json');
  let json = {};
  try { json = JSON.parse(fs.readFileSync(jsonFile, 'utf8')); } catch (e) { json = {}; }
  let appJson = {};
  try { appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8')); } catch (e) { appJson = {}; }
  const merged = Object.assign({}, appJson.usingComponents || {}, json.usingComponents || {});
  const out = new Map();
  Object.keys(merged).forEach((tag) => {
    const rel = merged[tag];
    const base = rel.startsWith('/') ? path.join(ROOT, rel.slice(1)) : path.resolve(path.dirname(ownerFile), rel);
    out.set(tag, base);
  });
  return out;
}

function kebabToCamel(name) {
  return name.replace(/-([a-zA-Z])/g, (_, c) => c.toUpperCase());
}

// 组件内部到底消不消费这个 prop:组件自己的 wxml 里 {{}} 引用过,或 js 里读过。
const componentPropCache = new Map();
function isXrFrameComponent(componentBase) {
  try {
    return JSON.parse(fs.readFileSync(componentBase + '.json', 'utf8')).renderer === 'xr-frame';
  } catch (e) {
    return false;
  }
}

function componentConsumesProp(componentBase, attr) {
  const prop = kebabToCamel(attr);
  const key = componentBase + '::' + prop;
  if (componentPropCache.has(key)) return componentPropCache.get(key);
  let consumed = false;
  // ★ xr-frame 渲染器组件(json 里 "renderer": "xr-frame",2026-09-22 显形档真 AR 引入):
  //   宿主传的 width / height 是**渲染器自己读的画布分辨率** —— 官方入门写法就是组件不声明、宿主直接传,
  //   组件代码里本来就不会出现这两个名字。只豁免这两个名字、只豁免 xr-frame 组件;别的属性照常判。
  if ((prop === 'width' || prop === 'height') && isXrFrameComponent(componentBase)) {
    componentPropCache.set(key, true);
    return true;
  }
  const wxml = componentBase + '.wxml';
  if (fs.existsSync(wxml)) {
    const { refs } = extractWxmlRefs(fs.readFileSync(wxml, 'utf8'));
    consumed = refs.some((r) => r.name === prop);
  }
  if (!consumed) {
    const js = componentBase + '.js';
    if (fs.existsSync(js)) {
      const rawJs = fs.readFileSync(js, 'utf8');
      let masked = maskNonCode(rawJs);
      // ★ 只有真正挂进 behaviors:[...] 的 behavior 才能替组件消费 prop(2026-08-21):
      // 组件可以把 observer/生命周期整段
      // 抽进 behaviors/*.js(cy-sheet / cy-modal 的退场动画就是),此时 prop 在组件自己的 js 里
      // 只剩 properties 那一次声明 —— 不跟进去看就会把「消费了」误判成「没消费」,
      // 连累所有调用方被判成 C 类死字段。只跟 behaviors/ 下的相对 require,不做全图追踪。
      // ⚠️ 路径要从原始源码解析(maskNonCode 会抹掉字符串),但不能把「只 require、未挂载」
      // 算成已消费;否则门禁会假绿。
      for (const rel of resolveBehaviorRequireTargets(rawJs)) {
        const bp = resolveRequireFile(path.dirname(js), rel);
        if (bp && fs.existsSync(bp)) masked += '\n' + maskNonCode(fs.readFileSync(bp, 'utf8'));
      }
      // 属性声明本身算 1 次;真被读到会有第 2 次(this.data.prop / observer 里用)。
      const hits = (masked.match(new RegExp('[^\\w$]' + prop + '[^\\w$]', 'g')) || []).length;
      consumed = hits > 1;
    }
  }
  componentPropCache.set(key, consumed);
  return consumed;
}

// ---------- 存量基线(ratchet) ----------
// 三条门禁首跑必然带一大票存量。硬红会把 master 的 7/7 门禁永久锁死、这个 PR 自己都合不进去;
// 直接放行又等于"测试存在但从没被跑过"。折中是棘轮:存量记进 baseline 文件(它本身就是存量清单),
// 门禁只对**新增**判红,存量清单只能变小不能变大。
function loadBaseline(file) {
  if (!fs.existsSync(file)) return new Set();
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  return new Set(json.entries || []);
}

function writeBaseline(file, keys, note) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    note,
    generatedBy: path.basename(process.argv[1] || '') + ' --update-baseline',
    count: keys.length,
    entries: keys.slice().sort(),
  }, null, 2) + '\n');
}

// 棘轮本身也要有负控:loadBaseline/比较逻辑写错了,门禁就变成"永远不会红"的恒真断言,
// 比没有门禁更危险(本仓 2026-07-16 在 deploy.yml 上栽过一模一样的坑)。三条门禁的 --selftest
// 都调这个。
function selfTestRatchet() {
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xcx-ratchet-'));
  const file = path.join(dir, 'b.json');
  writeBaseline(file, ['a::x', 'b::y'], '自证用');
  const loaded = loadBaseline(file);
  const ok = loaded.size === 2 && loaded.has('a::x')
    && ['a::x', 'c::z'].filter((k) => !loaded.has(k)).length === 1   // 新增的 c::z 必须判红
    && ['a::x', 'b::y'].filter((k) => !loaded.has(k)).length === 0   // 全是存量必须放行
    && loadBaseline(path.join(dir, 'nope.json')).size === 0;         // 基线文件缺失 = 空基线,不是全豁免
  fs.rmSync(dir, { recursive: true, force: true });
  return ok;
}

function rel(p) {
  return path.relative(ROOT, p);
}

module.exports = {
  ROOT,
  rel,
  maskNonCode,
  maskJavaScriptComments,
  lineNumber,
  matchBrace,
  scanTopLevelSegments,
  scanTopLevelKeys,
  findDefinitionBody,
  ownHandlerEntries,
  extractOwnHandlerEntries,
  resolveSpreadRequireTargets,
  extractHandlerNames,
  resolveBehaviorRequireTargets,
  resolveRequireFile,
  maskWxmlComments,
  findEventBindings,
  classifyBinding,
  scanTags,
  identifiersIn,
  mustacheIdentifiers,
  isNonRenderingAttr,
  isA11yAttr,
  extractWxmlRefs,
  extractSetDataFields,
  parseObjectKeySegment,
  walkFiles,
  buildIncludeParentMap,
  companionJs,
  buildJsToWxmlMap,
  loadUsingComponents,
  kebabToCamel,
  componentConsumesProp,
  loadBaseline,
  writeBaseline,
  selfTestRatchet,
};
