const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const SQL_PATH = path.join(ROOT, 'chengyinhub-admin/sql/migration_seed_official_solo_story_topics_20260823.sql');
const sql = fs.readFileSync(SQL_PATH, 'utf8');
const dependencies = JSON.parse(fs.readFileSync(path.join(ROOT, 'ci/migration-dependencies.json'), 'utf8'));

const TOPICS = [
  '城市藏宝猎人',
  '野生邻居观察局',
  '异常事务局：不存在的坐标',
  '末日广播：最后一座中继站',
  '时间污染：被删除的今天',
];

test('官方单人剧情种子与商家模板分层，配好首发参数但默认不公开', () => {
  TOPICS.forEach((name) => assert.match(sql, new RegExp(`'${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`)));
  assert.match(sql, /SELECT 100000, 1, 1, seed\.name/,
    '五个主题必须是 CITY_ORIENTEERING(product_type=1)');
  assert.match(sql, /0, 1, 0, 0, 1, 19\.90, 100, seed\.medal_name, 0, 0/,
    '必须是非模板、有效但未公开，并配好 19.90 元与 100 份首发配额');
  assert.match(sql, /t\.user_status<>0 OR t\.lifecycle<>0/,
    '未发布阶段必须同时锁定为未上架和 DRAFT');
  assert.match(sql, /SELECT t\.id, 'CONTENT', 'PLATFORM', NULL, 1/,
    '内容槽必须归平台，不得绑定商户');
  assert.doesNotMatch(sql, /INSERT INTO cms_topic_template_meta/,
    '官方活动不得混入主题模板货架元数据');
  assert.ok(dependencies.dependencies.seed_official_solo_story_topics_20260823.includes('topic_lifecycle_recruit'),
    '使用 lifecycle 前必须声明对应迁移依赖');
});

test('五个主题各有五个 GPS 剧情节点，每站展示档案且末站有三选一结局', () => {
  const gameTitles = new Set([...sql.matchAll(/'(OS\d{2}-[^']+)'/g)].map((row) => row[1]));
  assert.equal(gameTitles.size, 25, '应有 25 个互不重复的节点玩法');

  const branchConfigs = [...sql.matchAll(/CAST\('\{"schemaVersion":1,"branch"/g)];
  assert.equal(branchConfigs.length, 5, '每个主题的最终站都应有一个分支结局');
  assert.match(sql, /UPDATE seed_official_solo_story_games[\s\S]*WHERE advanced_config_json IS NULL/,
    '前四站必须复用高级分支运行时展示完整现场档案');

  assert.match(sql, /seed\.rule_instructions, 5,/,
    '节点基础完成方式必须是带 50m 围栏的 GPS 到达');
  assert.match(sql, /COUNT\(DISTINCT n\.id\)<>5/,
    '事务内回读必须拒绝节点数不是 5 的主题');
  assert.match(sql, /n\.sort_id>1 AND n\.unlock_after_node_id IS NULL/,
    '除起点外，每站必须存在前置解锁');
  assert.match(sql, /m\.validation_method<>5/,
    '事务内回读必须拒绝非 GPS 节点');
  assert.match(sql, /t\.self_play<>1 OR t\.self_play_price<>19\.90 OR t\.self_play_quota<>100/,
    '事务内回读必须锁定自玩、首发价和配额');
  assert.match(sql, /m\.advanced_config_json IS NOT NULL[\s\S]*<>5/,
    '事务内回读必须要求每个节点都有剧情档案');
  assert.match(sql, /JSON_LENGTH\(m\.advanced_config_json, '\$\.branch\.steps\[0\]\.options'\)=3[\s\S]*<>1/,
    '事务内回读必须要求每个主题恰有一个三选一最终分支');
  assert.match(sql, /COUNT\(r\.id\)<>1/,
    '每个官方主题必须恰有一个有效平台角色');
  assert.match(sql, /seed_official_solo_story_topics seed[\s\S]*NOT \(t\.total_mileage <=> seed\.total_mileage\)/,
    '幂等回放必须回读主题期望值，不能只数行');
  assert.match(sql, /seed_official_solo_story_nodes seed[\s\S]*NOT \(n\.longitude <=> seed\.longitude\)[\s\S]*NOT \(n\.sort_id <=> seed\.sort_id\)/,
    '幂等回放必须回读节点坐标与顺序');
  assert.match(sql, /NOT \(m\.advanced_config_json <=> seed\.advanced_config_json\)/,
    '剧情档案与最终分支配置必须逐字回读，不能只校验 JSON 非空');
  assert.match(sql, /NOT \(n\.unlock_after_node_id <=> previous_node\.id\)/,
    '每站前驱必须精确指向上一站，不能只校验非空');
});

test('路线里程不小于相邻坐标的直线距离', () => {
  const topicSeed = sql.slice(
    sql.indexOf('INSERT INTO seed_official_solo_story_topics'),
    sql.indexOf('INSERT INTO cms_topic\n', sql.indexOf('INSERT INTO seed_official_solo_story_topics'))
  );
  const declaredMileage = new Map();
  TOPICS.forEach((name) => {
    const start = topicSeed.indexOf(`'${name}'`);
    const next = topicSeed.indexOf('UNION ALL SELECT', start);
    const row = topicSeed.slice(start, next < 0 ? topicSeed.length : next);
    // 锚点是 img_url 那一列的起始引号,别写死具体前缀 —— 封面从 /images/ 搬到
    // prod-api/profile 时这条就是这么被顺带弄红的。
    const match = row.match(/,\s*(\d+)(?:\s+total_time)?,\s*([\d.]+)(?:\s+total_mileage)?,\s*'(?:https:\/\/|\/)/);
    assert.ok(match, `没有解析到主题里程:${name}`);
    declaredMileage.set(name, Number(match[2]));
  });

  const nodeSeedStart = sql.indexOf('INSERT INTO seed_official_solo_story_nodes');
  const nodeSeed = sql.slice(nodeSeedStart, sql.indexOf('INSERT INTO cms_topic_node', nodeSeedStart));
  const coordinates = new Map(TOPICS.map((name) => [name, []]));
  const nodePattern = /(?:SELECT|UNION ALL SELECT)\s+'([^']+)'(?:\s+topic_name)?,\s*(\d+)(?:\s+sort_id)?,[\s\S]*?'(\d{3}\.\d{6})'(?:\s+longitude)?,\s*'(\d{2}\.\d{6})'(?:\s+latitude)?,\s*'OS/g;
  for (const match of nodeSeed.matchAll(nodePattern)) {
    if (coordinates.has(match[1])) {
      coordinates.get(match[1]).push({ sortId: Number(match[2]), lng: Number(match[3]), lat: Number(match[4]) });
    }
  }

  const distanceKm = (from, to) => {
    const radians = (degrees) => degrees * Math.PI / 180;
    const lat1 = radians(from.lat);
    const lat2 = radians(to.lat);
    const dLat = lat2 - lat1;
    const dLng = radians(to.lng - from.lng);
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  };

  TOPICS.forEach((name) => {
    const points = coordinates.get(name).sort((a, b) => a.sortId - b.sortId);
    assert.equal(points.length, 5, `应解析到五个路线坐标:${name}`);
    const straightLineMinimum = points.slice(1)
      .reduce((sum, point, index) => sum + distanceKm(points[index], point), 0);
    assert.ok(declaredMileage.get(name) >= straightLineMinimum,
      `${name} 声明 ${declaredMileage.get(name)}km，小于相邻点直线下限 ${straightLineMinimum.toFixed(2)}km`);
  });
});

// 封面已搬出小程序包(主包 2MB 硬限):线上走 prod-api/profile 静态目录,
// 母版留在仓库 assets/covers/ 供追溯与重传 —— 两头都要钉住,少一头就会悄悄回潮:
//   · 只钉 URL ⇒ 母版可以被换成占位图,没人发现
//   · 只钉母版 ⇒ seed 可以又写回 /images/ 包内路径,主包再次撑爆
test('主题封面走服务端静态目录,且仓库留有真实摄影母版', () => {
  const covers = [...sql.matchAll(/'(https:\/\/www\.chengyinhub\.com\/prod-api\/profile\/topic-covers\/[a-z-]+\.webp)'/g)]
    .map((row) => row[1]);
  assert.equal(new Set(covers).size, 5, '五个主题必须使用五张不同封面');
  assert.doesNotMatch(sql, /'\/images\//,
    'seed 不得再把封面写成小程序包内路径 —— 那正是主包被撑到 6.48MB 的原因');
  covers.forEach((cover) => {
    const stem = cover.split('/').pop().replace(/\.webp$/, '');
    const master = path.join(ROOT, 'assets/covers/topic-templates/shanghai-solo', `${stem}.jpg`);
    assert.equal(fs.existsSync(master), true,
      `线上封面必须在仓库留有母版(否则服务器一丢就没得重传):${master}`);
    const image = fs.readFileSync(master);
    assert.ok(image.length > 50_000, `母版不应是占位图:${master}`);
    assert.deepEqual([...image.subarray(0, 3)], [0xff, 0xd8, 0xff], `母版必须是 JPEG:${master}`);
  });
  assert.match(sql, /wildlife-observation\.webp/);
  assert.match(sql, /anomaly-coordinate\.webp/);
  assert.match(sql, /apocalypse-broadcast\.webp/);
  assert.match(sql, /time-pollution\.webp/);
  assert.match(sql, /Chainwit\. \/ Wikimedia Commons \/ CC BY 4\.0/);
  assert.match(sql, /Supanut Arunoprayote \/ Wikimedia Commons \/ CC BY 4\.0/);
});

test('首发路线、时段与安全边界已写入种子', () => {
  assert.doesNotMatch(sql, /世纪大道地铁站/,
    '末日线不得再从远离陆家嘴的世纪大道站起步');
  assert.match(sql, /陆家嘴地铁站 2 号口地面/);
  assert.ok(sql.indexOf('龙腾大道3398号') < sql.indexOf('龙腾大道2600号'));
  assert.ok(sql.indexOf('龙腾大道2600号') < sql.indexOf('龙腾大道2555号'));
  assert.ok(sql.indexOf('龙腾大道2555号') < sql.indexOf('龙腾大道2380号'));
  assert.match(sql, /THEN '10:00-18:00' ELSE '09:00-18:00' END/);
  assert.match(sql, /下一站约需步行 25–30 分钟/);
  assert.match(sql, /25 点 GCJ-02 双机实走/);
  assert.match(sql, /收容 3\/5：只观察厂房结构/);
  assert.doesNotMatch(sql, /收容 3\/5：只观察圆形罐体/);
});

test('安全边界写进节点内容，不把虚构剧情包装成现实风险', () => {
  assert.match(sql, /不投喂、不追逐、不接触动物/);
  assert.match(sql, /故事完全虚构/);
  assert.match(sql, /这不是应急指南/);
  assert.match(sql, /不进入、不触碰任何真实基础设施/);
  assert.match(sql, /恶劣天气停止任务/);
});
