// 漫游商家 POI 归组:把「同一家实体店的多条副本」收成一组。
//
// 为什么需要:同一家店会从多路来源各来一条,id 命名空间互不相干(见 pages/roam/index.js):
//   ① 跨源:/api/map/nearby 读 cms_registration_merchant(id=nodeId 数字)
//           /api/roam/pois 读 roam_poi(id='r'+roamPoiId 字符串),两表无 FK,零去重直接 concat
//   ② 源内:nearby 查的是【报名记录表】,一店报名 N 个主题 = N 行;node_id=0(mode=2 自由探索)
//           在 JS 里 falsy,`n.nodeId || n.id` 退到 regId ⇒ 同店两条不同 id、同一个 addressName
// 不归组 ⇒ 同名浮卡弹多张,且 stats.shops 把一家店数成两家。
//
// ★ 身份键 = 店名 + 坐标邻近,两者缺一不可:
//   - 只用 id:同一家店归不了组(上面 ①②)
//   - 只用店名:把【真不同的店】误并 —— 同名连锁分店(星巴克南京西路 vs 星巴克淮海路),
//     以及 index.js 的 `n.addressName || '商家'` 兜底(address_name 可空且无 @NotBlank,
//     建表 DEFAULT '')会让一批无名商家全叫「商家」。误并的后果比不并严重得多:
//     第二家店永久弹不出浮卡、探不了、不计数,且零告警。
//   所以:同名【且】在 SAME_SHOP_M 内才算同一家;名字是兜底伪造的(nameKnown===false)一律不归组。
//
// 纯函数、零 wx API,可 node --test 直测。

var distM = require('./roam-geo.js').distM;

/** 同名副本要多近才算同一家店(米)。多源副本取自同一个商家登记地址,实际只差几米;
 *  放太宽会把同栋楼的同名店误并 —— 宁可漏合并(多弹一张卡)也不误并(整家店消失)。 */
var SAME_SHOP_M = 30;

/** 归一化店名:仅去首尾空白。不做更激进的归一(去括号/去空格),宁可漏合并也不误合并。 */
function normName(name) {
  return String(name == null ? '' : name).trim();
}

/**
 * 代表条目:优先能承载服务端打卡的那条。
 * _apiCheckin 强依赖 poi.nodeId(没有就直接 return false,且失败仍提示"已记录")——
 * 挑错代表 = 服务端打卡静默失效。其次选 roam 真 POI(_roamId,能进 /api/roam 的账)。
 */
function pickRep(list) {
  var i;
  for (i = 0; i < list.length; i++) { if (list[i].nodeId) return list[i]; }
  for (i = 0; i < list.length; i++) { if (list[i]._roamId) return list[i]; }
  return list[0];
}

/** 组内已集章:本次探完(done)或历史探过(passed)都算已集 */
function isCollectedState(state) {
  return state === 'done' || state === 'passed';
}

function hasCoords(p) {
  return p && typeof p.lat === 'number' && typeof p.lng === 'number';
}

/** 同一家店?同名 + 坐标够近。任一条无坐标则不敢合并(宁可多弹一张)。 */
function sameShop(a, b) {
  if (!hasCoords(a) || !hasCoords(b)) return false;
  return distM(a, b) <= SAME_SHOP_M;
}

/**
 * 归组 pois 里的商家。
 * @param {Array} pois 全集(必须传 _pois 全集,不能传过滤后的数组 —— done/passed 被滤掉后
 *                     collected 恒 false,挡不住「同店另一源副本还是 fog 时重复弹卡」)
 * @returns {Array} [{ key, name, rep, all, collected, doneInSession }]
 *   key 唯一且稳定:name + '#' + rep.id。同名不同店 → rep.id 不同;同 id 不同名 → name 不同。
 */
function groupMerchantsByName(pois) {
  var buckets = [];
  (pois || []).forEach(function (p) {
    if (!p || p.cat !== 'merchant') return;
    var name = normName(p.name);
    if (!name) return;                    // 无名店无法归组,丢弃(不会出现在卡上)
    var groupable = p.nameKnown !== false; // 兜底伪造名(如 '商家')不参与归组
    var hit = null;
    if (groupable) {
      for (var i = 0; i < buckets.length; i++) {
        if (buckets[i].groupable && buckets[i].name === name && sameShop(buckets[i].all[0], p)) { hit = buckets[i]; break; }
      }
    }
    if (!hit) { hit = { name: name, groupable: groupable, all: [] }; buckets.push(hit); }
    hit.all.push(p);
  });
  return buckets.map(function (b) {
    var rep = pickRep(b.all);
    return {
      key: b.name + '#' + rep.id,
      name: b.name,
      rep: rep,
      all: b.all,
      collected: b.all.some(function (p) { return isCollectedState(p.state); }),
      doneInSession: b.all.some(function (p) { return p.state === 'done'; }),
    };
  });
}

/**
 * 集章进度:分母=可见商家组数,分子=已集(done|passed)组数。
 * 生产上 _fetchNearbyMerchants 会用真商家整批替换演示种子(见 index.js 的 others 过滤),
 * 所以这里数的就是屏幕上真实可见的店。
 */
function stampProgress(pois) {
  var groups = groupMerchantsByName(pois);
  var done = groups.filter(function (g) { return g.collected; }).length;
  return { done: done, total: groups.length };
}

/** 本次会话探店数(去重后)。#23 的落库口径依赖它,不能把同店两条数成两家。 */
function doneShopCount(pois) {
  return groupMerchantsByName(pois).filter(function (g) { return g.doneInSession; }).length;
}

/**
 * 选出该弹浮卡的商家组:NEAR_M 内有 fog/seen 副本、且本次会话还没探过。
 *
 * ★ 归组必须在 pois 全集上做。只把「近处 fog/seen」的子集拿去归组,doneInSession 恒为 false
 *   (done 早被滤掉了),挡不住「同店的另一源副本还是 fog 时重复弹卡」—— 这个坑踩过。
 *
 * ★ 过滤用 doneInSession 而非 collected:历史探过(passed)的店本来就允许本次再探一次
 *   (startVisit 只挡 done),滤掉 passed 会砍掉既有玩法。
 */
function selectNearShopGroups(pois, player, nearM) {
  var nearKeys = {};
  var groups = groupMerchantsByName(pois);
  groups.forEach(function (g) {
    g.all.forEach(function (p) {
      if (p.state !== 'fog' && p.state !== 'seen') return;
      var d = distM(p, player);
      if (d >= nearM) return;
      if (nearKeys[g.key] == null || d < nearKeys[g.key]) nearKeys[g.key] = Math.round(d);
    });
  });
  return groups
    .filter(function (g) { return nearKeys[g.key] != null && !g.doneInSession; })
    .map(function (g) { return { group: g, distM: nearKeys[g.key] }; })
    .sort(function (a, b) { return a.distM - b.distM; });
}

module.exports = {
  SAME_SHOP_M: SAME_SHOP_M,
  normName: normName,
  pickRep: pickRep,
  groupMerchantsByName: groupMerchantsByName,
  stampProgress: stampProgress,
  doneShopCount: doneShopCount,
  selectNearShopGroups: selectNearShopGroups,
};
