// 藏品卡回执 → 界面上的一张卡。游玩页当场出卡与藏品册共用这一处,两边不许各写一份。
//
// 后端 PlayerObjectCardVO 已经算好 frames(READY 时 24 张转台帧,其余只有原照片),
// 这里照搬,不在客户端另算。只在旧后端没带 frames 时退回原照片 —— 空数组喂给
// cy-spin-card 就是一张什么都没有的卡。

const { validBox } = require('./object-card-reveal.js');

const GENERATING = ['QUEUED', 'GENERATING'];

function toCard(vo) {
  if (!vo || typeof vo !== 'object') return null;
  const frames = Array.isArray(vo.frames) && vo.frames.length ? vo.frames.slice() : [vo.sourceUrl];
  return {
    id: vo.id,
    frames,
    title: vo.title || '',
    caption: vo.caption || '',
    sourceUrl: vo.sourceUrl || '',
    // 抠图贴纸与物品在原照片里的位置:没抠出来都是 null,界面据此退回照片卡
    cutoutUrl: vo.cutoutUrl || null,
    cutoutBox: validBox(vo.cutoutBox),
    category: vo.category || null,
    // 地点(主题名 · 节点名)只在藏品册列表里有;当场那一屏由页面给
    place: vo.place || '',
    cardStyle: vo.cardStyle === 'plain' ? 'plain' : 'foil',
    // 3D 还在后台生成:卡照常能看,界面据此出「3D 生成中」
    generating: GENERATING.indexOf(vo.genStatus) >= 0,
  };
}

module.exports = { toCard };
