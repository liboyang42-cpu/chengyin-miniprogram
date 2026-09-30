/*
 * 把页面 wxml 里的 <cy-profile /> 就地展开成组件自身的 wxml。
 *
 * 2026-08-06：自己/他人主页统一到 cy-profile 共用组件后，
 * pages/member/index/index.wxml 整个变成一行 `<cy-profile viewer="self" />`，
 * pages/userinfo/userinfo.wxml 同理。原来钉在这两个页面上的 17 条契约测试
 * （隐私、可达性、双出口、勋章兜底、安全区…）全部断言不到节点而变红。
 *
 * 那些约束**没有失效**，只是搬进了组件。删测试等于把保护一起删掉；
 * 逐条改断言又要重写 17 处。⇒ 在读文件这一层展开，断言原样保留。
 */
const fs = require('fs');
const path = require('path');

const XCX = path.join(__dirname, '..', '..');
const PROFILE = path.join(XCX, 'components/cy/profile/index.wxml');

function readWxmlResolved(relativePath) {
  let src = fs.readFileSync(path.join(XCX, relativePath), 'utf8');
  if (!/<cy-profile[\s/>]/.test(src)) return src;
  const comp = fs.readFileSync(PROFILE, 'utf8');
  src = src.replace(/<cy-profile\b[^>]*\/>/g, comp)
           .replace(/<cy-profile\b[^>]*>[\s\S]*?<\/cy-profile>/g, comp);
  return src;
}

/**
 * wxss 同理：member/index.wxss 与 userinfo.wxss 的规则也搬进了组件，
 * 页面自己只剩壳。读这两个页面的 wxss 时，把组件的 wxss 接在后面，
 * 契约里那些 `.pc-xxx { ... }` 断言就能照常命中。
 */
function readWxssResolved(relativePath) {
  const own = fs.readFileSync(path.join(XCX, relativePath), 'utf8');
  if (!/(member\/index|userinfo)\/?[a-z]*\.wxss$/.test(relativePath)) return own;
  const comp = fs.readFileSync(path.join(XCX, 'components/cy/profile/index.wxss'), 'utf8');
  return `${own}\n/* —— 以下由 tests/helpers/resolve-profile 接入 cy-profile 组件样式 —— */\n${comp}`;
}

/**
 * js 同理：member/index.js 从 887 行减到只剩壳，方法(onPrimaryCta / goSignup /
 * onTabChange…)都搬进了组件。契约里断言方法名、跳转路径的那些照样要能命中。
 */
function readJsResolved(relativePath) {
  const own = fs.readFileSync(path.join(XCX, relativePath), 'utf8');
  if (!/(member\/index\/index|userinfo\/userinfo)\.js$/.test(relativePath)) return own;
  const comp = fs.readFileSync(path.join(XCX, 'components/cy/profile/index.js'), 'utf8');
  return `${own}\n/* —— 以下由 tests/helpers/resolve-profile 接入 cy-profile 组件逻辑 —— */\n${comp}`;
}

/** 按扩展名自动选：给统一的 read() 用 */
function readResolved(relativePath) {
  if (relativePath.endsWith('.wxml')) return readWxmlResolved(relativePath);
  if (relativePath.endsWith('.wxss')) return readWxssResolved(relativePath);
  if (relativePath.endsWith('.js')) return readJsResolved(relativePath);
  return fs.readFileSync(path.join(XCX, relativePath), 'utf8');
}

module.exports = { readWxmlResolved, readWxssResolved, readJsResolved, readResolved };
