/* 银币两面的 SVG —— 逐块照抄原型 playkit.html 的 GAMES.coin。
 *
 * 小程序没有 <svg> 标签,所以同一段 SVG 编码成 data URI 当 background-image 用。
 * 结构一处没改:抬起的外圈、两道二进制数据环、四个方位菱形、
 * 正面等距 logo 浮雕 + 上下两条弧字、背面中央一块二维码。
 *
 * 浮雕的读法是同一形状画三遍 —— 暗的往右下偏 0.85、亮的往左上偏 0.85,
 * 中间那层是本体。只画一层是平的,画两层是描边,三层才是压出来的。
 */
const LOGO = require('./logo.js');

function emb(inner) {
  return '<g transform="translate(.85,.85)" fill="rgba(38,43,50,.62)" stroke="rgba(38,43,50,.62)">' + inner + '</g>'
       + '<g transform="translate(-.85,-.85)" fill="rgba(255,255,255,.52)" stroke="rgba(255,255,255,.52)">' + inner + '</g>'
       + '<g fill="rgba(146,153,163,.9)" stroke="rgba(146,153,163,.9)">' + inner + '</g>';
}

/** 数据环:长短不一的短块绕一圈,读起来像一串二进制,不是一圈均匀虚线。 */
function ring(r, w, dash) {
  return '<circle cx="100" cy="100" r="' + r + '" fill="none" stroke-width="' + w
    + '" stroke-dasharray="' + dash + '"/>';
}

/** 两面都有的那几圈。 */
function common() {
  return '<circle cx="100" cy="100" r="97" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="1"/>'
    + emb('<circle cx="100" cy="100" r="93" fill="none" stroke-width="4.5"/>')
    + emb('<circle cx="100" cy="100" r="88" fill="none" stroke-width="1"/>')
    + emb(ring(80.5, 5.2, '7 3 2.5 3 10 4 3 3 6 3.5 2 3'))
    + emb('<circle cx="100" cy="100" r="74" fill="none" stroke-width="1"/>')
    + emb(ring(69, 3.4, '3 2 8 3 2 2 5 4 2 2.5'))
    + emb('<circle cx="100" cy="100" r="63" fill="none" stroke-width="1"/>');
}

/** logo 浮雕:brightness(0) 压成纯剪影只留 alpha,再 invert 出亮的那层。 */
function logoRelief(x, y, s) {
  const img = (dx, dy, css) =>
    '<image href="' + LOGO + '" x="' + (x + dx) + '" y="' + (y + dy) + '" width="' + s
      + '" height="' + s + '" preserveAspectRatio="xMidYMid meet" style="' + css + '"/>';
  return img(1.1, 1.1, 'filter:brightness(0);opacity:.6')
    + img(-1.1, -1.1, 'filter:brightness(0) invert(1);opacity:.55')
    + img(0, 0, 'filter:brightness(0) invert(.62);opacity:.95');
}

/** 正面:logo 浮雕 + 上下两条弧字(商家写的那两句)。 */
function faceMark(topTxt, botTxt) {
  const arc = (id, path, txt) =>
    '<text fill="rgba(38,43,50,.5)" transform="translate(.7,.7)"><textPath href="#' + id
      + '" startOffset="50%" text-anchor="middle">' + txt + '</textPath></text>'
    + '<text fill="rgba(232,236,241,.75)"><textPath href="#' + id
      + '" startOffset="50%" text-anchor="middle">' + txt + '</textPath></text>';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">'
    + '<defs><path id="arcT" d="M22 100a78 78 0 0 1 156 0"/>'
    + '<path id="arcB" d="M178 100a78 78 0 0 1 -156 0"/></defs>'
    + common()
    + logoRelief(62, 62, 76)
    + '<g font-size="11" font-weight="700" letter-spacing="4.2">'
    + arc('arcT', null, esc(topTxt)) + arc('arcB', null, esc(botTxt))
    + '</g></svg>';
}

/** 背面:中央一块二维码。★ 种子写死,每次生成同一张 ——
 *  随机生成的话每次翻面图案都不一样,那就不是同一枚币了。 */
function faceCode() {
  const N = 13, cell = 4.6, x0 = 100 - N * cell / 2, y0 = x0;
  const m = [];
  for (let r = 0; r < N; r++) { m.push([]); for (let c = 0; c < N; c++) m[r].push(0); }
  const mark = (r0, c0) => {
    for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++)
      m[r0 + i][c0 + j] = (i === 0 || i === 6 || j === 0 || j === 6 ||
        (i >= 2 && i <= 4 && j >= 2 && j <= 4)) ? 1 : 0;
  };
  mark(0, 0); mark(0, N - 7); mark(N - 7, 0);
  let seed = 20260909;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if ((r < 7 && c < 7) || (r < 7 && c >= N - 7) || (r >= N - 7 && c < 7)) continue;
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    m[r][c] = ((seed >> 16) & 0xff) % 100 < 46 ? 1 : 0;
  }
  let cells = '';
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (m[r][c])
    cells += '<rect x="' + (x0 + c * cell).toFixed(1) + '" y="' + (y0 + r * cell).toFixed(1)
      + '" width="' + cell + '" height="' + cell + '"/>';
  const lozenge = (deg) =>
    '<g transform="rotate(' + deg + ' 100 100)">'
    + '<path d="M100 46l3.4 7-3.4 7-3.4-7z"/>'
    + '<circle cx="100" cy="36" r="1.6"/><circle cx="100" cy="62" r="1.6"/></g>';
  const frame = '<rect x="' + (x0 - 5).toFixed(1) + '" y="' + (y0 - 5).toFixed(1) + '" width="'
    + (N * cell + 10).toFixed(1) + '" height="' + (N * cell + 10).toFixed(1)
    + '" fill="none" stroke-width="1.6"/>';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">'
    + common()
    + emb(lozenge(0) + lozenge(90) + lozenge(180) + lozenge(270))
    + emb(frame)
    + emb('<g stroke-width="0">' + cells + '</g>')
    + '</svg>';
}

/** SVG 里的 & < > 必须转义,否则整张图解析失败 —— 商家文案里出现「&」就白屏。 */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** SVG → 可直接喂给 background-image 的 data URI。 */
function toDataUri(svg) {
  return 'data:image/svg+xml;charset=utf8,' + encodeURIComponent(svg);
}

module.exports = { faceMark, faceCode, toDataUri, esc, _common: common };
