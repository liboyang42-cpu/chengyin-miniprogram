// 相册模板只能落在故事流里当展示块。服务端不把 album 算作「有高级玩法」,
// 若被绑成普通节点,玩家到点直接打卡、照片一张都看不到 —— 故事以外的入口要在选模板时拦下。
// 放在主包:活动 / 主题章节 / 据点 / 发布分属不同分包,互相 require 不到。

function isAlbumTemplate(template) {
  const raw = template && template.advancedConfigJson;
  if (!raw) return false;
  try {
    const config = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return !!(config && config.album && config.album.enabled);
  } catch (e) {
    return false;
  }
}

const ALBUM_ONLY_IN_STORY = '相册只能加在故事里，请换一个玩法模板';

module.exports = { isAlbumTemplate, ALBUM_ONLY_IN_STORY };
