// 选项媒体(图片 / 音频)的前后端往返口径。
//
// 选项文本仍在 questionA~D 四列上,这里只承载「每个字母对应的图和音」,按字母对齐 ——
// 字母本来就是这套模型的键(correctAnswer 存的就是字母)。
//
// ⚠️ 形状必须与后端 QuestionOptionMedia 逐字一致:键只允许 A/B/C/D,
//    每个值只允许 { img, audio }。多塞一个键,后端 sanitize 会整条打回(不是静默丢),
//    编辑器这边就会看到「保存失败」而不知道是哪多了一个字段。

var LETTERS = ['A', 'B', 'C', 'D'];
var MEDIA_KEYS = ['img', 'audio'];

/** optionItems(编辑器行内态)→ 存库字符串。全空返回 ''(等价于「没配媒体」,后端存 NULL)。 */
function toJson(optionItems) {
  var out = {};
  (optionItems || []).forEach(function (item) {
    if (!item || LETTERS.indexOf(item.letter) < 0) return;
    var entry = {};
    MEDIA_KEYS.forEach(function (key) {
      var url = String(item[key] == null ? '' : item[key]).trim();
      if (url) entry[key] = url;
    });
    if (Object.keys(entry).length) out[item.letter] = entry;
  });
  return Object.keys(out).length ? JSON.stringify(out) : '';
}

/** 存库字符串 → { A: { img, audio } }。解析不了就当没配 —— 一条坏 JSON 不该让整张题打不开。 */
function fromJson(json) {
  var parsed;
  if (!json) return {};
  try {
    parsed = typeof json === 'string' ? JSON.parse(json) : json;
  } catch (e) {
    return {};
  }
  if (!parsed || typeof parsed !== 'object') return {};
  var out = {};
  LETTERS.forEach(function (letter) {
    var media = parsed[letter];
    if (!media || typeof media !== 'object') return;
    var entry = {};
    MEDIA_KEYS.forEach(function (key) {
      var url = typeof media[key] === 'string' ? media[key].trim() : '';
      if (url) entry[key] = url;
    });
    if (Object.keys(entry).length) out[letter] = entry;
  });
  return out;
}

/** 把存库的媒体贴回 optionItems。字母对不上的媒体直接丢(选项被删了,它的图也就没有归属了)。 */
function applyToOptions(optionItems, json) {
  var media = fromJson(json);
  return (optionItems || []).map(function (item) {
    var entry = media[item && item.letter] || {};
    return Object.assign({}, item, { img: entry.img || '', audio: entry.audio || '' });
  });
}

module.exports = {
  LETTERS: LETTERS,
  toJson: toJson,
  fromJson: fromJson,
  applyToOptions: applyToOptions,
};
