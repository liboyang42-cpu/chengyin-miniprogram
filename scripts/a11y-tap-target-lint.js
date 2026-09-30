#!/usr/bin/env node
/* a11y-tap-target-lint.js —— 可点击元素的命中区不得小于 44px (2026-08-27, X12)
 *
 * 为什么需要它:现有的 DS 闸(ds-hardcode-gate.sh / ui-spec-audit.py /
 * _audit_spec_compliance.js)管的全是颜色与字号 token,**没有一条规则管 width/height**。
 * 于是 23 个绑了 tap 的元素声明尺寸小于 88rpx,最小的 .del 只有 24×24rpx(12×12px),
 * 而且其中好几个正是删除类操作 —— 既难点中,又容易在点相邻元素时误触,删除通常不可撤销。
 * 微信与 WCAG 2.5.5 的基线都是 44px(88rpx)。
 *
 * ★ 判据必须保守,宁可漏报不可误报
 * ------------------------------------------------------------------
 * 只在「同一条 class 规则里**同时**显式写了 width 和 height,且**没有**
 * padding / min-width / min-height」时才判。理由:
 *   · 只写了一个维度 ⇒ 另一维由内容撑开,静态判不了;
 *   · 写了 padding ⇒ 小程序默认 content-box,padding 会把命中区撑大,
 *     静态算不准最终值(还要看 box-sizing),算了就是猜;
 *   · 写了 min-height/min-width ⇒ 作者已经显式表达过下限意图。
 * 这条口径就是人工复核那 23 条时用的口径 —— 实测 .ph-follow 显式写了
 * `padding:0; margin:0; min-height:0`,命中区确实就是 15×15px,不是假阳性。
 *
 * ★ 只在「这个 wxml 真能用到的 wxss」里找 class
 * ------------------------------------------------------------------
 * 小程序的样式默认按页面/组件隔离,不做作用域限制会把别的页面同名 class 的尺寸
 * 算到这个元素头上。所以只读:同名 .wxss + 它 @import 的文件(一层) + app.wxss。
 *
 * 例外:在 wxml 元素上写 ds-ok="理由" 放行(与仓库既有的 ds-ok 标记同名同义)。
 *
 * 用法:
 *   node scripts/a11y-tap-target-lint.js            # 扫描,超基线判红
 *   node scripts/a11y-tap-target-lint.js --list     # 列出全部过小命中区
 *   node scripts/a11y-tap-target-lint.js --selftest # 自证(含负控)
 *   node scripts/a11y-tap-target-lint.js --update-baseline
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASELINE = path.join(ROOT, 'tests/lint/a11y-tap-target-baseline.json');
const SKIP_DIRS = new Set(['node_modules', 'miniprogram_npm', 'dist', 'artifacts']);
const MIN_PX = 44;

function walk(dir, ext, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, ext, acc);
    else if (e.name.endsWith(ext)) acc.push(full);
  }
  return acc;
}

// 等量换行替换注释:整块删会让后面所有元素的行号偏移,报出来的 file:line 指不到真实位置。
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
const stripCssComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/** 找到 openTagStart 处标签的结束下标(引号内的 > 不算) */
function tagEnd(s, from) {
  let q = null;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; }
    else if (c === '"' || c === "'") q = c;
    else if (c === '>') return i;
  }
  return -1;
}

/** rpx/px → px。判不了的返回 null(不下结论)。 */
function toPx(raw) {
  if (raw == null) return null;
  const v = String(raw).trim();
  let m = /^(-?\d+(?:\.\d+)?)rpx$/i.exec(v);
  if (m) return parseFloat(m[1]) / 2;          // 750rpx = 375px 基准
  m = /^(-?\d+(?:\.\d+)?)px$/i.exec(v);
  if (m) return parseFloat(m[1]);
  return null;                                  // %, vw, calc(), auto, 变量…一律不判
}

/**
 * 解析一条 `::after` / `::before` 规则撑出来的热区尺寸。
 *
 * 只认两种写法(都是仓库既有的):
 *   ① 显式尺寸:  width: 88rpx; height: 88rpx        —— cy-info-pop 的写法
 *   ② 负向内缩:  left/right/top/bottom 为负值撑开   —— cy-btn 的写法
 *      此时热区 = 宿主尺寸 + 两侧外扩,宿主尺寸这里还不知道,
 *      所以只把「外扩量」记下来,由 smallSize() 与宿主尺寸相加。
 *
 * 判不出的一律返回 null —— 不下结论好过给一个假绿。
 */
function pseudoHitBox(body) {
  const decl = (prop) => {
    const d = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)', 'i').exec(body);
    return d ? d[1].trim() : null;
  };
  if (!/position\s*:\s*absolute/i.test(body)) return null;   // 不绝对定位就不是热区层
  const w = toPx(decl('width'));
  const h = toPx(decl('height'));
  if (w !== null && h !== null) return { w, h, absolute: true };
  // 负向内缩:calc((64rpx - 88rpx)/2) 这类算式解析不了,退而认它「声明了纵向外扩」
  const insets = ['left', 'right', 'top', 'bottom'].map((k) => decl(k));
  const grows = insets.filter((v) => v !== null && (/^-/.test(v) || /-\s*88rpx/.test(v) || /88rpx\s*\)/.test(v)));
  if (grows.length >= 2) return { w: MIN_PX, h: MIN_PX, absolute: true, inferred: true };
  return null;
}

/**
 * 从 wxss 文本里抽出规则的尺寸声明,按「叶子 class」建索引。
 *
 * 收两类选择器:
 *   ① `.foo` / `.foo:active` / `image.foo`  —— 直接命中
 *   ② `.wrap image.foo`(后代选择器)        —— 叶子是 .foo,祖先条件另行核对
 * 第二类必须收:实测 pages/gerenziliao 的 24rpx 删除按钮写的正是
 * `.shzlbox_li_left_txt_li image.del{...}`,只认单 class 会把它整条漏掉。
 *
 * 但后代选择器的命中条件静态判不死,所以规则里记下 `ancestors`(选择器里除叶子外
 * 提到的所有 class),由调用方核对「这些 class 在同一个 wxml 里是否真的出现过」。
 * 都出现过才判 —— 仍然可能有误判,但比整条漏掉更接近事实,且例外有 ds-ok 可走。
 *
 * `.a.b` 这类同元素复合选择器不收:它要求元素同时带两个 class,判起来要和
 * 元素的 class 列表求交,收益不抵复杂度。
 */
function indexWxss(text) {
  const src = stripCssComments(text);
  const map = new Map();   // class -> {width,height,hasPadding,hasMin,ancestors}
  // ⚠️ 不要在这里加 `(^|\})` 前缀锚:那样每条规则会把自己的 `}` 吃进匹配,
  // 下一条规则就再也找不到「前面紧邻一个 }」—— 实测效果是**隔一条漏一条**
  // (自证里单条规则的用例全绿,真仓库里 .fd__clear / .ag__close 整片消失)。
  // 选择器部分 [^{}@]+? 本来就跨不过 `}`,自己就是分隔符,不需要额外的锚。
  const re = /([^{}@]+?)\s*\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) {
    const selector = m[1].trim();
    const body = m[2];
    for (const part of selector.split(',')) {
      const sel = part.trim();
      if (!sel || /[>+~]/.test(sel)) continue;          // 子/兄弟组合器不收
      const compounds = sel.split(/\s+/).filter(Boolean);
      const leaf = compounds[compounds.length - 1];
      // 叶子必须是 `.cls` 或 `tag.cls`(可带一个伪类),且只带一个 class
      // 伪元素热区规则:.foo::after / .foo::before —— 仓库既有手法(cy-btn / cy-info-pop),
      // 用透明 ::after 把热区撑到 88rpx 而视觉尺寸不变。必须先于普通选择器判,
      // 否则 `::after` 会被下面的伪类分支当成 `:after` 吃掉,热区规则永远读不到。
      const pm = /^(?:[a-z][a-z0-9-]*)?\.([A-Za-z0-9_-]+)::(after|before)$/.exec(leaf);
      if (pm) {
        const box = pseudoHitBox(body);
        if (box) {
          const e = map.get(pm[1]) || { width: null, height: null, hasPadding: false, hasMin: false, ancestors: [] };
          e.hitW = Math.max(e.hitW || 0, box.w);
          e.hitH = Math.max(e.hitH || 0, box.h);
          map.set(pm[1], e);
        }
        continue;
      }
      const cm = /^[a-z][a-z0-9-]*?\.([A-Za-z0-9_-]+)(?::[a-z-]+(?:\([^)]*\))?)?$|^\.([A-Za-z0-9_-]+)(?::[a-z-]+(?:\([^)]*\))?)?$/.exec(leaf);
      if (!cm) continue;
      const cls = cm[1] || cm[2];
      const ancestors = [];
      let bad = false;
      for (const c of compounds.slice(0, -1)) {
        const am = c.match(/\.[A-Za-z0-9_-]+/g);
        if (!am) { bad = true; break; }                 // 祖先不是 class 选择器 ⇒ 判不了
        for (const a of am) ancestors.push(a.slice(1));
      }
      if (bad) continue;
      const decl = (prop) => {
        const d = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)', 'i').exec(body);
        return d ? d[1].trim() : null;
      };
      const entry = map.get(cls) || { width: null, height: null, hasPadding: false, hasMin: false, ancestors: [] };
      if (ancestors.length) entry.ancestors = ancestors;
      const w = decl('width'); if (w !== null) entry.width = w;
      const h = decl('height'); if (h !== null) entry.height = h;
      if (/(?:^|;)\s*padding(?:-[a-z]+)?\s*:/i.test(body)) {
        // padding:0 不撑大命中区,不该因此豁免 —— 实测 .ph-follow 正是这样写的。
        const p = decl('padding');
        const allZero = p !== null && /^(?:0(?:px|rpx|%)?\s*)+$/i.test(p);
        if (!allZero) entry.hasPadding = true;
      }
      if (/(?:^|;)\s*min-(?:width|height)\s*:/i.test(body)) {
        const mw = decl('min-width'); const mh = decl('min-height');
        const zero = (v) => v !== null && /^0(?:px|rpx|%)?$/i.test(v.trim());
        if (!(zero(mw) || zero(mh)) || (mw && !zero(mw)) || (mh && !zero(mh))) entry.hasMin = true;
      }
      map.set(cls, entry);
    }
  }
  return map;
}

/** 这个 wxml 真正能用到的样式表:同名 wxss + 它 @import 的(一层) + app.wxss */
function stylesFor(wxmlAbs, readFile) {
  const files = [];
  const own = wxmlAbs.replace(/\.wxml$/, '.wxss');
  const app = path.join(ROOT, 'app.wxss');
  for (const f of [own, app]) {
    const t = readFile(f);
    if (t == null) continue;
    files.push(t);
    const importRe = /@import\s+['"]([^'"]+)['"]/g;
    let im;
    while ((im = importRe.exec(t))) {
      const target = im[1].startsWith('/')
        ? path.join(ROOT, im[1].slice(1))
        : path.resolve(path.dirname(f), im[1]);
      const it = readFile(target.endsWith('.wxss') ? target : target + '.wxss');
      if (it != null) files.push(it);
    }
  }
  const merged = new Map();
  for (const t of files) {
    for (const [k, v] of indexWxss(t)) {
      const prev = merged.get(k);
      merged.set(k, prev ? {
        width: v.width || prev.width,
        height: v.height || prev.height,
        hasPadding: v.hasPadding || prev.hasPadding,
        hasMin: v.hasMin || prev.hasMin,
        ancestors: (v.ancestors && v.ancestors.length) ? v.ancestors : prev.ancestors,
        hitW: Math.max(v.hitW || 0, prev.hitW || 0),
        hitH: Math.max(v.hitH || 0, prev.hitH || 0),
      } : v);
    }
  }
  return merged;
}

/** 一个 class 的声明尺寸是否确定小于 44px。判不了返回 null。 */
function smallSize(entry) {
  if (!entry) return null;
  // 透明 ::after 热区(DS §3.2 的标准手法):热区达标就不看视觉尺寸。
  if ((entry.hitW || 0) >= MIN_PX && (entry.hitH || 0) >= MIN_PX) return null;
  if (entry.hasPadding || entry.hasMin) return null;   // 撑得大,静态算不准 ⇒ 不下结论
  const w = toPx(entry.width);
  const h = toPx(entry.height);
  if (w === null || h === null) return null;           // 只写一维/单位判不了 ⇒ 不下结论
  const min = Math.min(w, h);
  return min < MIN_PX ? { w, h, min } : null;
}

function scanFile(src, rel, styles) {
  const s = stripComments(src);
  const out = [];
  // 后代选择器的祖先条件:只核对「这个 class 在同一个 wxml 里出现过」。
  // 不做真实的祖先链判定 —— 那要建 DOM 树,而 wx:if/wx:for 让静态树本来就不唯一。
  const classesInFile = new Set();
  {
    const cre = /\sclass\s*=\s*"([^"]*)"/g;
    let cm2;
    while ((cm2 = cre.exec(s))) {
      for (const c of cm2[1].split(/\s+/)) if (c && !c.includes('{')) classesInFile.add(c);
    }
  }
  const re = /<([a-z][a-z0-9-]*)(\s[^>]*)?>/gi;
  let m;
  while ((m = re.exec(s))) {
    const tag = m[1];
    const openStart = m.index;
    const openEnd = tagEnd(s, openStart);
    if (openEnd < 0) continue;
    const attrs = s.slice(openStart + tag.length + 1, openEnd);
    const hasTapHandler = /\s(bind|catch)(:)?tap\s*=/.test(attrs);
    const isNativeInteractive = tag === 'button' || tag === 'navigator';
    if (!hasTapHandler && !isNativeInteractive) continue;
    if (/=\s*"noop"/.test(attrs)) continue;
    if (/\sds-ok\s*=\s*"[^"]+"/.test(attrs)) continue;      // 显式豁免(必须带理由)
    const cm = /\sclass\s*=\s*"([^"]*)"/.exec(attrs);
    if (!cm) continue;
    for (const cls of cm[1].split(/\s+/)) {
      if (!cls || cls.includes('{')) continue;              // {{}} 动态类名判不了
      const entry = styles.get(cls);
      if (entry && entry.ancestors && entry.ancestors.length
          && !entry.ancestors.every((a) => classesInFile.has(a))) {
        continue;                                        // 祖先 class 本页压根没有 ⇒ 这条规则命不中
      }
      const small = smallSize(entry);
      if (!small) continue;
      const line = s.slice(0, openStart).split('\n').length;
      out.push({
        file: rel, line, tag, cls,
        size: `${small.w}x${small.h}px`,
        min: small.min,
      });
      break;                                                 // 一个元素只报一次
    }
  }
  return out;
}

function scanRepo() {
  const readFile = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
  const found = [];
  for (const abs of walk(ROOT, '.wxml')) {
    const styles = stylesFor(abs, readFile);
    found.push(...scanFile(fs.readFileSync(abs, 'utf8'), path.relative(ROOT, abs), styles));
  }
  return found;
}

const keyOf = (v) => `${v.file}:${v.line} .${v.cls}`;

/* ---------------- 自证:检查器必须能判红,也必须不乱判 ---------------- */
function selftest() {
  const cases = [
    ['24rpx 的删除按钮必须被抓到',
      '<view class="del" bindtap="onDel" />', '.del{width:24rpx;height:24rpx}', 1],
    ['88rpx 正好达标,放行',
      '<view class="ok" bindtap="go" />', '.ok{width:88rpx;height:88rpx}', 0],
    ['一维达标一维不达标仍算不达标',
      '<view class="bar" bindtap="go" />', '.bar{width:200rpx;height:40rpx}', 1],
    ['★负控:写了 padding 就不下结论(content-box 会撑大,算了就是猜)',
      '<view class="p" bindtap="go" />', '.p{width:24rpx;height:24rpx;padding:20rpx}', 0],
    ['★负控:padding:0 不算撑大,仍要抓(.ph-follow 就是这么写的)',
      '<view class="z" bindtap="go" />', '.z{width:30rpx;height:30rpx;padding:0;margin:0;min-height:0}', 1],
    ['★负控:只写了一个维度不下结论',
      '<view class="one" bindtap="go" />', '.one{height:24rpx}', 0],
    ['★负控:百分比/calc 判不了,不下结论',
      '<view class="pc" bindtap="go" />', '.pc{width:100%;height:24rpx}', 0],
    ['min-height 明确写了下限就不下结论',
      '<view class="mh" bindtap="go" />', '.mh{width:24rpx;height:24rpx;min-height:88rpx}', 0],
    ['后代选择器:祖先 class 在本页出现过,要判',
      '<view class="wrap"><view class="kid" bindtap="go" /></view>',
      '.wrap .kid{width:24rpx;height:24rpx}', 1],
    ['★负控:后代选择器的祖先 class 本页没有 ⇒ 这条规则命不中,不判',
      '<view class="kid" bindtap="go" />', '.wrap .kid{width:24rpx;height:24rpx}', 0],
    ['带标签限定的后代选择器(实测 pages/gerenziliao 就是这么写的)',
      '<view class="box"><image class="del" bindtap="onDel" src="/a.png" /></view>',
      '.box image.del{width:24rpx;height:24rpx}', 1],
    ['★负控:祖先不是 class 选择器(裸标签)⇒ 判不了,不判',
      '<view class="kid" bindtap="go" />', 'view .kid{width:24rpx;height:24rpx}', 0],
    ['★负控:子组合器 > 不收',
      '<view class="wrap"><view class="kid" bindtap="go" /></view>',
      '.wrap > .kid{width:24rpx;height:24rpx}', 0],
    ['★负控:没绑 tap 的小元素不算',
      '<view class="del" />', '.del{width:24rpx;height:24rpx}', 0],
    ['★负控:noop 不算交互',
      '<view class="del" catchtap="noop" />', '.del{width:24rpx;height:24rpx}', 0],
    ['★负控:注释里的不算',
      '<!-- <view class="del" bindtap="onDel" /> -->', '.del{width:24rpx;height:24rpx}', 0],
    ['★负控:ds-ok 带理由才放行',
      '<view class="del" bindtap="onDel" ds-ok="装饰角标，真正命中区在父级" />',
      '.del{width:24rpx;height:24rpx}', 0],
    ['★负控:ds-ok 为空串不放行',
      '<view class="del" bindtap="onDel" ds-ok="" />', '.del{width:24rpx;height:24rpx}', 1],
    ['原生 button 没有 bindtap 也要判',
      '<button class="del" open-type="share" />', '.del{width:24rpx;height:24rpx}', 1],
    ['px 单位同样判(44px 达标)',
      '<view class="pxok" bindtap="go" />', '.pxok{width:44px;height:44px}', 0],
    ['px 单位不达标要抓',
      '<view class="pxbad" bindtap="go" />', '.pxbad{width:20px;height:20px}', 1],
    ['一个元素多个小 class 只报一次',
      '<view class="del david_del" bindtap="go" />',
      '.del{width:24rpx;height:24rpx}.david_del{width:40rpx;height:40rpx}', 1],
    ['伪类选择器上的声明也算(.a:active)',
      '<view class="ac" bindtap="go" />', '.ac:active{width:24rpx;height:24rpx}', 1],
    ['★负控:样式在别的页面里,不该算到本元素头上',
      '<view class="foreign" bindtap="go" />', '', 0],
    ['透明 ::after 把热区撑到 88rpx 就算达标(cy-info-pop 的写法)',
      '<view class="ip" bindtap="go" />',
      '.ip{width:32rpx;height:32rpx}.ip::after{content:"";position:absolute;left:50%;top:50%;width:88rpx;height:88rpx;transform:translate(-50%,-50%)}', 0],
    ['负向内缩式 ::after 同样算达标(cy-btn 的写法)',
      '<view class="b" bindtap="go" />',
      '.b{width:200rpx;height:64rpx}.b::after{content:"";position:absolute;left:0;right:0;top:calc((64rpx - 88rpx)/2);bottom:calc((64rpx - 88rpx)/2)}', 0],
    ['★负控:::after 只有 60rpx,没撑够 88 仍要抓',
      '<view class="s" bindtap="go" />',
      '.s{width:32rpx;height:32rpx}.s::after{content:"";position:absolute;width:60rpx;height:60rpx}', 1],
    ['★负控:::after 没有 position:absolute 就不是热区层,不算数',
      '<view class="n" bindtap="go" />',
      '.n{width:32rpx;height:32rpx}.n::after{content:"";width:88rpx;height:88rpx}', 1],
    ['★负控:热区在别的 class 上,不该算到本元素头上',
      '<view class="x" bindtap="go" />',
      '.x{width:32rpx;height:32rpx}.y::after{content:"";position:absolute;width:88rpx;height:88rpx}', 1],
  ];
  let ok = true;
  for (const [name, wxml, wxss, expect] of cases) {
    const got = scanFile(wxml, 't.wxml', indexWxss(wxss)).length;
    const pass = got === expect;
    if (!pass) ok = false;
    console.log(`  ${pass ? '✓' : '✗'} ${name}(期望 ${expect} 实得 ${got})`);
  }
  console.log(ok ? `[a11y-tap] 自证通过(${cases.length} 项,含 padding/单维/百分比/后代选择器/空 ds-ok 假保证陷阱)`
                 : '[a11y-tap] 自证失败');
  return ok;
}

/* ---------------- main ---------------- */
const argv = process.argv.slice(2);
if (argv.includes('--selftest')) process.exit(selftest() ? 0 : 1);

const found = scanRepo();
const keys = found.map(keyOf).sort();

if (argv.includes('--update-baseline')) {
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, JSON.stringify({ entries: keys }, null, 2) + '\n');
  console.log(`[a11y-tap] 基线已写入 ${keys.length} 条`);
  process.exit(0);
}

if (argv.includes('--list')) {
  for (const v of found.slice().sort((a, b) => a.min - b.min)) {
    console.log(`${v.size.padStart(12)}  <${v.tag}> .${v.cls}  ${v.file}:${v.line}`);
  }
  console.log(`共 ${found.length} 处命中区小于 ${MIN_PX}px`);
  process.exit(0);
}

if (!selftest()) { console.error('[a11y-tap] 检查器自证未过,拒绝给出扫描结论'); process.exit(1); }

const baseline = fs.existsSync(BASELINE)
  ? new Set(JSON.parse(fs.readFileSync(BASELINE, 'utf8')).entries || [])
  : new Set();
const added = keys.filter((k) => !baseline.has(k));
const fixed = [...baseline].filter((k) => !keys.includes(k));

console.log(`[a11y-tap] 过小命中区 ${keys.length} 处(基线 ${baseline.size},阈值 ${MIN_PX}px)`);
if (fixed.length) console.log(`[a11y-tap] 提示:基线里 ${fixed.length} 条已修好,跑 --update-baseline 收窄棘轮`);
if (added.length) {
  console.error(`[a11y-tap] ✗ 新增 ${added.length} 处过小命中区:`);
  for (const k of added) console.error('   ' + k);
  process.exit(1);
}
console.log('[a11y-tap] ✓ 无新增(棘轮只许变小)');
