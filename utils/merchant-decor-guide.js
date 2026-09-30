// 店铺装修的资料完整度(七页规范 §1:百分比进度条改 setup-guide 勾选清单,对照 Shopify 19)。
// 纯函数。七项全部对应商家实体上真实存在的字段,不新增口径、不给"推荐项"凑数:
//   封面 coverImage / Logo logo / 店名 name / 行业 categoryId / 定位 locationVerified
//   / slogan slogan / 品牌故事 description
// 相册、特色标签、承接设置属「推荐」,不进必填完整度——否则永远勾不满,清单就没意义了。
//
// ⚠️ logo 的默认占位图(/images/mer1.jpg)只是显示兜底,不算已上传:
//    把兜底当成已完成,清单会谎报完整度。

const DEFAULT_LOGO = '/images/mer1.jpg';

const ITEMS = [
  { key: 'cover', label: '封面头图', action: 'uploadCover', has: (m) => nonEmpty(m.coverImage) },
  { key: 'logo', label: '店铺 Logo', action: 'uploadLogo', has: (m) => nonEmpty(m.logo) && m.logo !== DEFAULT_LOGO },
  { key: 'name', label: '店铺名称', action: 'editName', has: (m) => nonEmpty(m.name) },
  { key: 'category', label: '行业类型', action: 'goCategory', has: (m) => nonEmpty(m.categoryId) },
  { key: 'location', label: '门店定位', action: 'geoLocate', has: (m) => Number(m.locationVerified) === 1 },
  { key: 'slogan', label: '一句话 slogan', action: 'editSlogan', has: (m) => nonEmpty(m.slogan) },
  { key: 'story', label: '品牌故事', action: 'goStory', has: (m) => nonEmpty(m.description) },
];

function nonEmpty(v) {
  return v !== null && v !== undefined && String(v).trim() !== '';
}

function buildSetupGuide(merchant) {
  const m = merchant || {};
  const items = ITEMS.map((it) => ({ key: it.key, label: it.label, action: it.action, done: !!it.has(m) }));
  const done = items.filter((i) => i.done).length;
  return {
    done,
    total: items.length,
    text: done + '/' + items.length,
    complete: done === items.length,
    items,
    // 清单只列没做完的(照 19:完成项收起只留计数)
    todo: items.filter((i) => !i.done),
  };
}

module.exports = { buildSetupGuide, DEFAULT_LOGO };
