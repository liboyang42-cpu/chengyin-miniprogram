/* 抽卡卡面的图案 —— 逐块照抄原型 playkit.html 的 art() / win()。
 *
 * 不是装饰:一张卡只有标题和正文,图案是它唯一的「脸」。四张卡摞在一起时,
 * 玩家靠这块图分辨「这是刚才那张还是新的一张」。
 *
 * 小程序没有 <svg> 标签,同一段 SVG 编码成 data URI 当图用 —— 与硬币那边同一手法。
 * 配色按卡序轮转,同一张卡每次抽到必须同图同色。
 */

const K = '#111';          // 描边黑,原型 DK_K /* ds-ok */
const G = '#34a853';       // 绿,原型 DK_G /* ds-ok */
const PALETTE = [G, '#f7b326', '#dd363c', '#0b6adc']; /* ds-ok: 抽卡四色按原型轮转,跟主题走会让相邻卡撞色 */

/** 一扇「小窗」:黑影 + 白底 + 顶栏 + 三个红黄绿圆点,里面可以再放东西。 */
function win(x, y, w, h, inner) {
  return '<rect x="' + (x + 4) + '" y="' + (y + 6) + '" width="' + w + '" height="' + h + '" rx="4" fill="' + K + '"/>'
    + '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="4" fill="#fbfbfb" stroke="' + K + '" stroke-width="2.4"/>' /* ds-ok */
    + '<path d="M' + x + ' ' + (y + 13) + ' H' + (x + w) + '" stroke="' + K + '" stroke-width="2.4"/>'
    + '<circle cx="' + (x + 7) + '" cy="' + (y + 6.5) + '" r="2.4" fill="#dd363c"/>' /* ds-ok */
    + '<circle cx="' + (x + 15) + '" cy="' + (y + 6.5) + '" r="2.4" fill="#f7b326"/>' /* ds-ok */
    + '<circle cx="' + (x + 23) + '" cy="' + (y + 6.5) + '" r="2.4" fill="' + G + '"/>'
    + (inner || '');
}

/** 第 i 张卡的图案。三个主色按卡序错开取,所以相邻两张一眼能分开。 */
function artSvg(i) {
  const n = Number(i) || 0;
  const a1 = PALETTE[n % 4], a2 = PALETTE[(n + 1) % 4], a3 = PALETTE[(n + 2) % 4];
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 230 200">'
    + '<path d="M62 30a52 52 0 0 0 0 104Z" fill="' + a1 + '" stroke="' + K + '" stroke-width="2.4"/>'
    + '<path d="M156 26 214 42 168 88Z" fill="' + a2 + '" stroke="' + K + '" stroke-width="2.4"/>'
    + '<circle cx="58" cy="162" r="28" fill="' + a3 + '" stroke="' + K + '" stroke-width="2.4"/>'
    + '<rect x="162" y="132" width="48" height="48" rx="3" fill="' + a1 + '" stroke="' + K
      + '" stroke-width="2.4" transform="rotate(-8 186 156)"/>'
    + win(58, 34, 116, 132,
        '<circle cx="116" cy="78" r="16" fill="' + a2 + '" stroke="' + K + '" stroke-width="2.4"/>'
      + '<path d="M96 116h40M78 106l-10 10 10 10M154 106l10 10-10 10" stroke="' + K
      + '" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>')
    + '</svg>';
}

const toDataUri = (svg) => 'data:image/svg+xml;charset=utf8,' + encodeURIComponent(svg);

/** 直接给组件用:第 i 张卡的图,已经是可以喂 <image src> 的串。 */
function artFor(i) { return toDataUri(artSvg(i)); }

module.exports = { artFor, artSvg, win, PALETTE, toDataUri };
