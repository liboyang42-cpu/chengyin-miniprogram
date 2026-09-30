// 创作端故事流的唯一状态变更入口。页面只负责收集意图与 setData，
// blocks / nodes / pendingMaterials 的联动都在这里完成。

var materials = require('./pro-editor-materials.js');
var MAX_BLOCKS_PER_CHAPTER = 200;

function clone(input) {
  return JSON.parse(JSON.stringify(input == null ? null : input));
}

function insertionIndex(blocks, rawIndex) {
  var index = Number(rawIndex);
  if (!Number.isInteger(index) || index < 0 || index > blocks.length) {
    throw new Error('插入点已失效，请重新选择');
  }
  return index;
}

function sameId(left, right) {
  return left != null && right != null && String(left) === String(right);
}

// 媒体块只承载一个 url,不进 description 投影 —— 章节摘要是纯文本,
// 把图片地址拼进去会直接漏到列表页。后端 ChapterFlowCompiler 用的是同一条口径。
// ⚠️ 2026-09-06 用户裁决「章节一个音频,里面节点一个音频,不冲突」:两者并存 ——
//    chapter.audioUrl 是整章的背景旁白(进本章自动播放、没有位置),
//    blocks 里的 audio 是**带位置**的片段(读到这儿才响)。所以这里 image + audio 都算媒体块。
//    (9-04 那版曾把 audio 整个撤出块流,已按 9-06 的裁决恢复。)
function isMediaType(type) {
  return type === 'image' || type === 'audio';
}

// 《预制人生》新块型 dream(施工契约 2026-09-17 §3.2):一组图 + 每张一句,
// 玩家端按「穿过去」一张张播。它不是媒体块 —— 没有单个 url,是一张有序的图单。
// ⚠️ 契约写死 1–6 张:0 张的梦等于一段占位,7 张以上不给配。
var DREAM_MAX_IMAGES = 6;

function isDreamType(type) {
  return type === 'dream';
}

// 三处共用同一条清洗(物化 / 存盘 / 校验),避免「编辑器里能看、存下去被丢」。
function normalizeDreamImages(images) {
  return (Array.isArray(images) ? images : []).map(function (item) {
    return {
      url: String(item && item.url == null ? '' : item.url).trim(),
      line: String(item && item.line == null ? '' : item.line),
    };
  }).filter(function (item) { return !!item.url; });
}

// 从地址末段取文件名:去掉 query/hash,再 decode。取不出来就返回空串,由调用方兜底。
function fileNameOf(url) {
  var path = String(url || '').split('?')[0].split('#')[0];
  var last = path.split('/').pop() || '';
  try { last = decodeURIComponent(last); } catch (e) {}
  return last;
}

function nodeForBlock(nodes, block) {
  if (block && block.nodeKey) {
    return nodes.find(function (node) { return node && node._localId === block.nodeKey; });
  }
  if (block && block.nodeId != null) {
    return nodes.find(function (node) { return node && sameId(node.id, block.nodeId); });
  }
  if (block && Number.isInteger(Number(block.nodeIndex))) {
    return nodes[Number(block.nodeIndex)];
  }
  return null;
}

function orderedNodes(chapter) {
  var nodes = (chapter && chapter.nodes) || [];
  var ordered = [];
  var seen = {};
  ((chapter && chapter.blocks) || []).forEach(function (block) {
    if (!block || block.type !== 'node') return;
    var node = nodeForBlock(nodes, block);
    if (!node || !node._localId) throw new Error('节点块引用已失效');
    if (seen[node._localId]) throw new Error('同一节点不能重复出现在故事流中');
    seen[node._localId] = true;
    ordered.push(node);
  });
  if (ordered.length !== nodes.length) throw new Error('存在未编排进故事流的正式节点');
  return ordered;
}

function projectedDescription(blocks) {
  var textBlocks = [];
  for (var i = 0; i < blocks.length; i += 1) {
    if (blocks[i].type === 'node') break;
    if (blocks[i].type === 'text') textBlocks.push(String(blocks[i].content == null ? '' : blocks[i].content));
  }
  return textBlocks.join('\n');
}

// 故事变量(契约 §3.1):正文里写 {name},玩家没值时写 {name|那个人}。
// 取值的真源在服务端会话视图的 vars map;创作端只负责列出「这个主题里有哪些键」——
// 键来自各节点玩法模板的 profile 题,加上会产出结果的玩法(diyName / check)。
var VAR_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,15}$/;

function parseAdvancedConfig(raw) {
  if (!raw) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    var parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    return null;
  }
}

function collectStoryVars(chapters) {
  var list = [];
  var seen = {};
  var push = function (key, label) {
    var name = String(key == null ? '' : key).trim();
    if (!VAR_KEY_PATTERN.test(name) || seen[name]) return;
    seen[name] = true;
    list.push({ key: name, label: String(label == null ? '' : label).trim() || name, token: '{' + name + '}' });
  };
  (Array.isArray(chapters) ? chapters : []).forEach(function (chapter) {
    ((chapter && chapter.nodes) || []).forEach(function (node) {
      var info = node && node.templateInfo;
      var advanced = parseAdvancedConfig(info && info.advancedConfigJson);
      if (!advanced) return;
      var profile = advanced.profile;
      if (profile && profile.enabled && Array.isArray(profile.questions)) {
        profile.questions.forEach(function (question) {
          if (question) push(question.key, question.label);
        });
      }
      if (advanced.diyName && advanced.diyName.enabled) push('name', '作品名');
      /* R14 检定不在这里列:它的结果落在作者自定义的 state 变量上(带前缀的具名键),
         而变量语法 {名字} 只收字母开头的裸键,写不出 counter.xxx —— 契约 §3.1 更正。 */
    });
  });
  return list;
}

// 把 {key} 插到光标处;没记到光标(-1)或越界就追加到末尾 ——
// 插进半句话中间,比没插进去更难发现。
function varInsertIndex(content, cursor) {
  var length = String(content == null ? '' : content).length;
  var parsed = Number(cursor);
  return Number.isInteger(parsed) && parsed >= 0 ? Math.max(0, Math.min(length, parsed)) : length;
}

function insertVarAt(content, key, cursor) {
  var text = String(content == null ? '' : content);
  var token = '{' + String(key == null ? '' : key) + '}';
  var at = varInsertIndex(text, cursor);
  return text.slice(0, at) + token + text.slice(at);
}

function synchronizeChapter(chapter) {
  chapter.nodes = orderedNodes(chapter);
  chapter.nodes.forEach(function (node, index) { node.sortID = index + 1; });
  var byLocalId = {};
  chapter.nodes.forEach(function (node) { byLocalId[node._localId] = node; });
  var nodeNumber = 0;
  (chapter.blocks || []).forEach(function (block) {
    if (!block || block.type !== 'node') return;
    nodeNumber += 1;
    var node = byLocalId[block.nodeKey] || {};
    block._nodeNumber = nodeNumber;
    block._nodeName = node.name || '未命名节点';
    block._nodeAddress = node.address || '地点待补';
    block._nodeGameplayReady = Number(node.templateId) > 0
      || !!(node.templateInfo && node.templateInfo.title);
    // 节点块要显示节点实拍缩略图(用户 2026-08-10 定)。imgUrl 是逗号分隔的多图串,
    // 块上只投影第一张 —— 取第一张这件事在 wxs(img.first)和这里各做一次会有两份口径,
    // 所以统一在投影层切好,wxml 只管渲染。
    block._nodeThumb = String(node.imgUrl || '').split(',').filter(Boolean)[0] || '';
  });
  chapter.description = projectedDescription(chapter.blocks || []);
  chapter.schemaVersion = 1;
  chapter.required = 1;
  return chapter;
}

function materializeChapter(source, makeKey) {
  var chapter = clone(source || {}) || {};
  var keyFactory = typeof makeKey === 'function' ? makeKey : function () {
    throw new Error('故事流块缺少本地标识');
  };
  chapter.nodes = chapter.nodes || [];
  if (!Array.isArray(chapter.blocks)) {
    chapter.nodes.sort(function (a, b) { return Number(a.sortID || a.sortId || 0) - Number(b.sortID || b.sortId || 0); });
    chapter.blocks = [{ key: keyFactory(), type: 'text', content: chapter.description || '' }];
    chapter.nodes.forEach(function (node) {
      chapter.blocks.push({ key: keyFactory(), type: 'node', nodeKey: node._localId });
    });
    return synchronizeChapter(chapter);
  }

  chapter.blocks = chapter.blocks.map(function (sourceBlock) {
    var block = sourceBlock || {};
    if (block.type === 'text') {
      return {
        key: block.key || keyFactory(),
        type: 'text',
        content: String(block.content == null ? '' : block.content),
      };
    }
    if (block.type === 'node') {
      var node = nodeForBlock(chapter.nodes, block);
      if (!node || !node._localId) throw new Error('节点块引用已失效');
      return { key: block.key || keyFactory(), type: 'node', nodeKey: node._localId };
    }
    // 梦块:图单原样带回来(每张的 url + 一句话),没有单个 url 的媒体态
    if (isDreamType(block.type)) {
      return { key: block.key || keyFactory(), type: 'dream', ...(block.title != null ? { title: block.title } : {}), images: normalizeDreamImages(block.images) };
    }
    if (isMediaType(block.type)) {
      var url = String(block.url == null ? '' : block.url);
      // 音频可以先落一个**空占位块**(同 applyStoryCommand#insertMediaAt),重开章节 /
      // 恢复本地草稿时必须原样保留它 —— 之前这里对空 url 一律 throw,导致带空音频块的草稿
      // 一恢复就在 _materializeCityStoryChapters 里未捕获抛错、openStoryEditor 也永久打不开。
      // 图片没有空态,继续当场拒。
      // 空判用 .trim() 与 insertMediaAt / fillMedia / toPayloadChapter 三处对齐(纯空白 url 也算空)。
      if (!url.trim() && block.type !== 'audio') throw new Error('媒体块缺少地址');
      var media = { key: block.key || keyFactory(), type: block.type, url: url };
      // 重开章节时 payload 里只剩 {type,url} —— 文件名从地址末段派生,至少不显示成"音频片段"。
      // 时长派生不出来,由页面拿播放器异步补(见 index.js#_fillStoryAudioMeta)。空占位块无 url,不派生。
      if (block.type === 'audio' && url.trim()) {
        media._name = block._name || fileNameOf(url);
        if (block._duration) media._duration = Number(block._duration) || 0;
      }
      return media;
    }
    throw new Error('不支持的故事流块类型');
  });
  return synchronizeChapter(chapter);
}

function stripLocalFields(input) {
  var output = {};
  Object.keys(input || {}).forEach(function (key) {
    if (key.charAt(0) !== '_') output[key] = input[key];
  });
  return output;
}

function toPayloadChapter(source) {
  var chapter = clone(source || {}) || {};
  chapter.nodes = orderedNodes(chapter);
  var nodeIndexes = {};
  chapter.nodes.forEach(function (node, index) { nodeIndexes[node._localId] = index; });
  chapter.blocks = (chapter.blocks || []).filter(function (block) {
    // 还没选文件的空音频块只是编辑器里的占位,没有任何内容可上送 —— 不落库,也不报错。
    if (isMediaType(block.type) && !String(block.url == null ? '' : block.url).trim()) return false;
    // 一张图都还没加的梦块同理:空壳不落库
    if (isDreamType(block.type) && !normalizeDreamImages(block.images).length) {
      if (block.title != null) throw new Error('相册至少添加 1 张照片');
      return false;
    }
    return true;
  }).map(function (block) {
    if (block.type === 'text') {
      return { type: 'text', content: String(block.content == null ? '' : block.content) };
    }
    if (block.type === 'node' && Object.prototype.hasOwnProperty.call(nodeIndexes, block.nodeKey)) {
      return { type: 'node', nodeIndex: nodeIndexes[block.nodeKey] };
    }
    if (isDreamType(block.type)) {
      // 契约 §3.2 的块形状带 key:后端 ChapterBlockReadSupport 原样透传,
      // 重开编辑器时这个 key 还用来对齐块(见 materializeChapter)。
      return { type: 'dream', key: block.key, ...(block.title != null ? { title: block.title } : {}), images: normalizeDreamImages(block.images) };
    }
    if (isMediaType(block.type)) {
      return { type: block.type, url: String(block.url == null ? '' : block.url) };
    }
    throw new Error('节点块引用已失效');
  });
  chapter.nodes = chapter.nodes.map(stripLocalFields);
  chapter.description = projectedDescription(chapter.blocks);
  chapter.schemaVersion = 1;
  chapter.required = 1;
  return stripLocalFields(chapter);
}

// CU-M-115:梦块卡上的话是「一张都没有的梦不会保存，先加一张」。在此之前这条过滤只发生在
// toPayloadChapter(发布取 payload 那一层),编辑器的本地草稿照旧留着空梦块 —— 用户按「完成」
// 回到章节卡再重进,那张 0/6 的空卡还在原地,话说了一套做了一套(与本文件 normalizeDreamImages
// 上面那句「避免编辑器里能看、存下去被丢」的既定口径也相反)。收编辑器时就在草稿里丢掉。
function countEmptyDreamBlocks(chapter) {
  var blocks = (chapter && Array.isArray(chapter.blocks)) ? chapter.blocks : [];
  return blocks.filter(function (block) {
    return block && isDreamType(block.type) && !normalizeDreamImages(block.images).length;
  }).length;
}

// 就地丢掉没有一张图的梦块;只有真的丢了块才重新投影 description / 节点序号。
function discardEmptyDreamBlocks(chapter) {
  var target = chapter || {};
  if (!Array.isArray(target.blocks)) return target;
  var kept = target.blocks.filter(function (block) {
    return !(block && isDreamType(block.type) && !normalizeDreamImages(block.images).length);
  });
  if (kept.length === target.blocks.length) return target;
  target.blocks = kept;
  return synchronizeChapter(target);
}

function applyStoryCommand(input, command) {
  var draft = clone(input || {}) || {};
  draft.chapter = draft.chapter || { nodes: [], blocks: [] };
  draft.chapter.nodes = draft.chapter.nodes || [];
  draft.chapter.blocks = draft.chapter.blocks || [];
  draft.pendingMaterials = draft.pendingMaterials || [];
  command = command || {};

  if (command.type === 'insertTextAt') {
    if (draft.chapter.blocks.length >= MAX_BLOCKS_PER_CHAPTER) throw new Error('每章最多 200 个内容块');
    var at = insertionIndex(draft.chapter.blocks, command.index);
    draft.chapter.blocks.splice(at, 0, {
      key: command.blockKey,
      type: 'text',
      content: '',
    });
    synchronizeChapter(draft.chapter);
    return { draft: draft, insertedBlockKey: command.blockKey };
  }

  if (command.type === 'insertNodeAt') {
    if (draft.chapter.blocks.length >= MAX_BLOCKS_PER_CHAPTER) throw new Error('每章最多 200 个内容块');
    var node = clone(command.node || {});
    if (!node._localId) throw new Error('节点缺少本地标识');
    if (draft.chapter.blocks.some(function (item) {
      return item && item.type === 'node' && item.nodeKey === node._localId;
    })) {
      throw new Error('节点已经在故事流中');
    }
    var nodeAt = insertionIndex(draft.chapter.blocks, command.index);
    draft.chapter.nodes = draft.chapter.nodes.filter(function (item) {
      return !item || item._localId !== node._localId;
    });
    draft.chapter.nodes.push(node);
    draft.chapter.blocks.splice(nodeAt, 0, {
      key: command.blockKey,
      type: 'node',
      nodeKey: node._localId,
    });
    draft.pendingMaterials = draft.pendingMaterials.filter(function (item) {
      return !item || item._localId !== node._localId;
    });
    synchronizeChapter(draft.chapter);
    return { draft: draft, insertedBlockKey: command.blockKey };
  }

  if (command.type === 'insertMediaAt') {
    if (draft.chapter.blocks.length >= MAX_BLOCKS_PER_CHAPTER) throw new Error('每章最多 200 个内容块');
    if (!isMediaType(command.mediaType) && !isDreamType(command.mediaType)) throw new Error('不支持的媒体块类型');
    var mediaAt = insertionIndex(draft.chapter.blocks, command.index);
    // 梦块与音频块同理,可以先落一个**空块**再一张张加图 —— 一次拉起
    // 1–6 张的选择器是微信不给的,分次添加才做得到「每张一句话」这件事。
    if (isDreamType(command.mediaType)) {
      var dreamBlock = { key: command.blockKey, type: 'dream', ...(command.title ? { title: command.title } : {}), images: normalizeDreamImages(command.images) };
      draft.chapter.blocks.splice(mediaAt, 0, dreamBlock);
      synchronizeChapter(draft.chapter);
      return { draft: draft, insertedBlockKey: command.blockKey };
    }
    var mediaUrl = String(command.url == null ? '' : command.url).trim();
    // 音频可以先落一个**空块**:稿(TE · Screens P8)的流程是「点插入缝的音频 → 先插一个
    // 灰色空块,写着『▶ 上传音频』→ 再点它选文件」。这样中途取消也还留着这个块,
    // 人知道自己刚才做了什么。图片没有这一态,继续当场拒 —— 一个点不开的空图壳没有用。
    if (!mediaUrl && command.mediaType !== 'audio') throw new Error('媒体块缺少地址');
    // _name / _duration 只服务编辑器的显示(音频块要显示文件名与时长)。
    // 下划线开头 = 本地字段:stripLocalFields 会剥掉,toPayloadChapter 也只重建 {type,url},
    // 所以它们进不了 payload,不必动后端的块形状。重开章节时由页面按 url 重新派生。
    var inserted = { key: command.blockKey, type: command.mediaType, url: mediaUrl };
    if (command.name) inserted._name = String(command.name);
    if (command.duration) inserted._duration = Number(command.duration) || 0;
    draft.chapter.blocks.splice(mediaAt, 0, inserted);
    synchronizeChapter(draft.chapter);
    return { draft: draft, insertedBlockKey: command.blockKey };
  }

  // 梦块的三条图单命令:加一张 / 改一句话 / 删一张。图片本身先上传再进块
  // (与 insertStoryImageAt 同一条规矩),这里只收已经拿到的 url。
  if (command.type === 'updateAlbumTitle') {
    var albumBlock = draft.chapter.blocks.find(function (item) { return item.key === command.blockKey && isDreamType(item.type); });
    if (!albumBlock) throw new Error('未找到相册');
    // 输入中不 trim:否则删到空会回弹、名称中间打不出空格。首尾空白在编译时去掉
    albumBlock.title = String(command.title || '');
    if (albumBlock.title.trim().length > 20) throw new Error('相册名称不能超过 20 字');
    return { draft: draft };
  }

  if (command.type === 'appendDreamImage') {
    var dreamIndex = draft.chapter.blocks.findIndex(function (item) {
      return item && item.key === command.blockKey && isDreamType(item.type);
    });
    if (dreamIndex < 0) throw new Error('未找到要编辑的梦块');
    var dreamImages = draft.chapter.blocks[dreamIndex].images;
    if (!Array.isArray(dreamImages)) dreamImages = draft.chapter.blocks[dreamIndex].images = [];
    if (dreamImages.length >= DREAM_MAX_IMAGES) throw new Error('一个梦最多 ' + DREAM_MAX_IMAGES + ' 张图');
    var dreamUrl = String(command.url == null ? '' : command.url).trim();
    if (!dreamUrl) throw new Error('梦的图片缺少地址');
    dreamImages.push({ url: dreamUrl, line: '' });
    synchronizeChapter(draft.chapter);
    return { draft: draft };
  }

  if (command.type === 'updateDreamLine') {
    var lineBlockIndex = draft.chapter.blocks.findIndex(function (item) {
      return item && item.key === command.blockKey && isDreamType(item.type);
    });
    if (lineBlockIndex < 0) throw new Error('未找到要编辑的梦块');
    var lineImages = draft.chapter.blocks[lineBlockIndex].images || [];
    if (!lineImages[command.index]) throw new Error('这一张已经不在梦里了');
    lineImages[command.index].line = String(command.line == null ? '' : command.line);
    synchronizeChapter(draft.chapter);
    return { draft: draft };
  }

  if (command.type === 'removeDreamImage') {
    var dropIndex = draft.chapter.blocks.findIndex(function (item) {
      return item && item.key === command.blockKey && isDreamType(item.type);
    });
    if (dropIndex < 0) throw new Error('未找到要删除的梦块');
    var dropImages = draft.chapter.blocks[dropIndex].images || [];
    if (!dropImages[command.index]) throw new Error('这一张已经不在梦里了');
    dropImages.splice(command.index, 1);
    synchronizeChapter(draft.chapter);
    return { draft: draft };
  }

  // 给「先插空块、再上传」那一步用:只往已经存在的媒体块上补 url / 文件名。
  if (command.type === 'fillMedia') {
    var fillIndex = draft.chapter.blocks.findIndex(function (item) {
      return item && item.key === command.blockKey && isMediaType(item.type);
    });
    if (fillIndex < 0) throw new Error('未找到要上传的媒体块');
    var fillUrl = String(command.url == null ? '' : command.url).trim();
    if (!fillUrl) throw new Error('媒体块缺少地址');
    draft.chapter.blocks[fillIndex].url = fillUrl;
    if (command.name) draft.chapter.blocks[fillIndex]._name = String(command.name);
    synchronizeChapter(draft.chapter);
    return { draft: draft };
  }

  if (command.type === 'removeMedia') {
    var mediaIndex = draft.chapter.blocks.findIndex(function (item) {
      return item && item.key === command.blockKey && (isMediaType(item.type) || isDreamType(item.type));
    });
    if (mediaIndex < 0) throw new Error('未找到要删除的媒体块');
    draft.chapter.blocks.splice(mediaIndex, 1);
    synchronizeChapter(draft.chapter);
    return { draft: draft };
  }

  if (command.type === 'editText') {
    var editIndex = draft.chapter.blocks.findIndex(function (item) {
      return item && item.key === command.blockKey && item.type === 'text';
    });
    if (editIndex < 0) throw new Error('未找到要编辑的文字块');
    draft.chapter.blocks[editIndex].content = String(command.content == null ? '' : command.content);
    synchronizeChapter(draft.chapter);
    return { draft: draft };
  }

  if (command.type === 'editNode') {
    var editedNode = clone(command.node || {});
    if (!editedNode._localId) throw new Error('节点缺少本地标识');
    var editedNodeIndex = draft.chapter.nodes.findIndex(function (item) {
      return item && item._localId === editedNode._localId;
    });
    if (editedNodeIndex < 0 || !draft.chapter.blocks.some(function (item) {
      return item && item.type === 'node' && item.nodeKey === editedNode._localId;
    })) {
      throw new Error('未找到要编辑的节点块');
    }
    draft.chapter.nodes[editedNodeIndex] = editedNode;
    synchronizeChapter(draft.chapter);
    return { draft: draft };
  }

  // 2026-08-11 用户定:✕ = 真删,不再"移到待编排区"。撤销靠调用方手上的 removed 快照
  // (block / node / blockIndex 三样都在),5 秒内可整块塞回原位 —— 所以"删干净"和"能撤销"
  // 不冲突,不需要在数据里留一份影子副本。
  // ⚠️ 命令名跟着语义改:叫 removeNodeToPending 却不往 pending 里放,是会骗到下一个人的。
  if (command.type === 'removeNode') {
    var blockIndex = draft.chapter.blocks.findIndex(function (block) {
      return block && block.key === command.blockKey && block.type === 'node';
    });
    if (blockIndex < 0) throw new Error('未找到要删除的节点块');
    var block = draft.chapter.blocks[blockIndex];
    var nodeIndex = draft.chapter.nodes.findIndex(function (node) {
      return node && node._localId === block.nodeKey;
    });
    if (nodeIndex < 0) throw new Error('节点块引用已失效');
    var node = clone(command.node || draft.chapter.nodes[nodeIndex]);
    if (!node._localId || node._localId !== block.nodeKey) throw new Error('节点块引用已失效');
    draft.chapter.nodes[nodeIndex] = node;
    draft.chapter.blocks.splice(blockIndex, 1);
    draft.chapter.nodes.splice(nodeIndex, 1);
    synchronizeChapter(draft.chapter);
    return {
      draft: draft,
      removed: { blockIndex: blockIndex, block: block, node: node },
    };
  }

  if (command.type === 'removeText') {
    var textIndex = draft.chapter.blocks.findIndex(function (item) {
      return item && item.key === command.blockKey && item.type === 'text';
    });
    if (textIndex < 0) throw new Error('未找到要删除的文字块');
    draft.chapter.blocks.splice(textIndex, 1);
    synchronizeChapter(draft.chapter);
    return { draft: draft };
  }

  throw new Error('不支持的故事流命令: ' + String(command.type || ''));
}

module.exports = {
  fileNameOf: fileNameOf,
  applyStoryCommand: applyStoryCommand,
  materializeChapter: materializeChapter,
  countEmptyDreamBlocks: countEmptyDreamBlocks,
  discardEmptyDreamBlocks: discardEmptyDreamBlocks,
  projectedDescription: projectedDescription,
  toPayloadChapter: toPayloadChapter,
  collectStoryVars: collectStoryVars,
  insertVarAt: insertVarAt,
  varInsertIndex: varInsertIndex,
  DREAM_MAX_IMAGES: DREAM_MAX_IMAGES,
};
