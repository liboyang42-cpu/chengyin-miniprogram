#!/usr/bin/env node
'use strict'

// 探店日 / 漫游静态红线门禁。两族规则、一个真源：
//
//   R 族（漫游免费层红线）——《探店日施工审计 5 · 漫游与导流》S2。扫描面按
//     「玩家在漫游中实际可撞到的行为」划，不按目录划：漫游页 + 漫游分包 +
//     scene-roam-* 组件 + ApiRoamController.java + RoamMapper.xml +
//     ApiPlayProgressController.java。审计 §六.7 明确 `route` 是多义词，
//     全仓 grep 一个词会误伤城市定向，所以每条规则各带各的面。
//
//   H 族（H11 零回归）——裁决表 §1.5 H11 + §三「偏离 3」。扫本分支相对
//     github/master 的**新增/修改行**，覆盖 admin UI / 小程序 / 后端
//     Java·XML·SQL 三栈；不扫全仓，避免把 master 早已存在的历史列当新增。
//
// 用法：node chengyinhub-xcx/scripts/roam-redline-gate.js [--selftest]
// 接线：ci/xcx-check.sh（小程序静态门）+ .github/workflows/ci.yml 的 changes job
//       （H 族要覆盖后端/后台 UI 改动，只挂 xcx path filter 会假绿——审计 5 §六.6）。

const assert = require('assert')
const childProcess = require('child_process')
const fs = require('fs')
const path = require('path')
const { maskNonCode, maskJavaScriptComments } = require('./lib/xcx-scan')

const REPO_ROOT = childProcess.execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()

const ROAM_PAGE = 'chengyinhub-xcx/pages/roam'
const ROAM_SUBPACKAGE = 'chengyinhub-xcx/subpackageRoam'
const ROAM_COMPONENT_PREFIX = 'chengyinhub-xcx/components/cy/scene-roam-'
const ROAM_CONTROLLER = 'chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiRoamController.java'
const ROAM_MAPPER = 'chengyinhub-system/src/main/resources/mapper/business/RoamMapper.xml'
const PLAY_CONTROLLER = 'chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiPlayProgressController.java'
const ROUTE_STORY_POLICY = 'chengyinhub-system/src/main/java/com/chengyinhub/business/service/RoamRouteStoryPolicy.java'
// 官方活动任务的运行期前置求值曾长在这里(prerequisitesCompleteNow + prerequisite_json)。
// 它是「已通电的越线能力」——后台存量有值,免费层就真的出现任务先后关系。求值已移除,
// 这个文件进 R3 扫描面把它永久钉住:R3 的口径本来就是「顺序与前置」,不是「漫游目录」。
const OFFICIAL_EVENT_SERVICE = 'chengyinhub-system/src/main/java/com/chengyinhub/business/service/impl/OfficialEventV2ServiceImpl.java'

const SCANNED_EXTENSIONS = new Set(['.js', '.wxml', '.wxss', '.json', '.java', '.xml'])

// 前瞻指引口径的**唯一真源**是运行期那道闸 RoamRouteStoryPolicy.java；这里只复制一份
// 字面量，并由 R7 断言两者始终一致。改 Java 那条正则而不改这里（或反过来）必须红。
const FORWARD_GUIDANCE_SOURCE = '下次|下一次|下回|接下来|下一站|建议|推荐|不妨|可以去|应该去|先[\\s\\S]{0,40}(再|然后)'

// ---------------------------------------------------------------------------
// 注释屏蔽：注释里出现禁词多半是「这里已经删掉了 X」的留痕，判它红就是逼人删掉解释。
// 复用共享词法扫描；保留用户文案，只遮注释，整文件扫描保留跨行状态与原行号。
function stripComments(source, filename) {
  source = String(source)
  if (filename && path.extname(filename) === '.js') {
    try { return maskJavaScriptComments(source) } catch (error) {
      throw new Error(`${filename}: JS 注释解析失败：${error.message}`)
    }
  }
  // 无文件名的自测/片段若是合法 JS，也使用完整语法上下文。
  // Java/XML/SQL 等调用仍保留原处理；禁止对已知完整 JS 做启发式降级。
  if (!filename) {
    try { return maskJavaScriptComments(source) } catch (error) {
      if (error.name !== 'SyntaxError') throw error
    }
  }
  return maskNonCode(source, { preserveLiterals: true, htmlComments: true })
    .split('\n').map(line => /^[\s+]*(?:\*|#|--\s)/.test(line) ? '' : line).join('\n')
}

function walkFiles(absoluteDir, files) {
  files = files || []
  if (!fs.existsSync(absoluteDir)) return files
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const absolute = path.join(absoluteDir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'miniprogram_npm') continue
      walkFiles(absolute, files)
    } else if (SCANNED_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(path.relative(REPO_ROOT, absolute).split(path.sep).join('/'))
    }
  }
  return files
}

function roamComponentDirs() {
  const parent = path.join(REPO_ROOT, 'chengyinhub-xcx/components/cy')
  if (!fs.existsSync(parent)) return []
  return fs.readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && `chengyinhub-xcx/components/cy/${entry.name}`.startsWith(ROAM_COMPONENT_PREFIX))
    .map((entry) => path.join(parent, entry.name))
}

function surface(name) {
  switch (name) {
    // 分享卡 / 足迹回看：对外表达面。审计 5 S2「足迹/回顾表达」那一行的扫描对象。
    case 'review':
      return walkFiles(path.join(REPO_ROOT, ROAM_SUBPACKAGE))
    // 漫游地图页本体。审计 5 §三「S2 导航」负控原文就写的 `pages/roam/**`。
    case 'map':
      return walkFiles(path.join(REPO_ROOT, ROAM_PAGE))
    // 玩家在漫游里能撞到的全部代码面（含它实际请求的后端）。
    case 'roam': {
      const files = walkFiles(path.join(REPO_ROOT, ROAM_PAGE))
      walkFiles(path.join(REPO_ROOT, ROAM_SUBPACKAGE), files)
      roamComponentDirs().forEach((dir) => walkFiles(dir, files))
      return files.concat([ROAM_CONTROLLER, ROAM_MAPPER, OFFICIAL_EVENT_SERVICE])
    }
    case 'roamBackend':
      return [ROAM_CONTROLLER, ROAM_MAPPER]
    case 'playBackend':
      return [PLAY_CONTROLLER]
    default:
      throw new Error(`未知扫描面：${name}`)
  }
}

// ---------------------------------------------------------------------------
// R 族规则。每条都必须能指出「哪个文件的哪一行」，否则报出来也修不动。
const ROAM_RULES = [
  {
    id: 'R1',
    surface: 'review',
    title: '漫游分享卡/足迹回看出现前瞻指引',
    pattern: new RegExp(FORWARD_GUIDANCE_SOURCE),
    why: '审计 5 S2：回顾只能总结已发生的足迹，不得出现「下次/建议/推荐/先…再…」等下一步引导',
  },
  {
    id: 'R2',
    surface: 'review',
    title: '漫游分享卡/足迹回看以「路线」对外命名',
    pattern: /路线/,
    why: '审计 5 S2 + 批 4-4a：连续轨迹来自本人也不得命名为路线，对外统一「足迹回看」',
  },
  {
    id: 'R3',
    surface: 'roam',
    title: '漫游面出现顺序/前置语义',
    // ⚠️ prerequisite 一族**不能**加词边界:真实写法全是后接字母的派生名 ——
    //    prerequisitesCompleteNow / getPrerequisiteJson / PREREQUISITE_NOT_COMPLETE。
    //    首版按 [^A-Za-z_] 收尾,结果一条都抓不到(自测样本当场证伪),是典型的「\b 假绿」。
    //    其余几个是完整标识符,保留边界防子串误报;整条加 i 顺带覆盖驼峰与全大写常量。
    pattern: /(^|[^A-Za-z_])(nextNodeId|next_node_id|unlockAfter|unlock_after|isPrevDone|is_prev_done)([^A-Za-z_]|$)|prerequisite|请先完成上一/i,
    why: '审计 5 S2「顺序与前置」：免费层里 POI 的可见/发现/完成不得取决于另一个 POI 或任务'
      + '（含官方活动任务的运行期前置求值 —— 后台存量有值即通电）',
  },
  {
    id: 'R4',
    surface: 'map',
    title: '漫游地图页出现指向性导航',
    pattern: /wx\.openLocation|arrowLine/,
    why: '审计 5 S2「方向导航」：漫游页不得唤起外部导航或画指向目标点的箭头（商户型 POI 详情的地址跳转不在此面）',
  },
  {
    id: 'R5',
    surface: 'roamBackend',
    title: '漫游后端触碰探店日履约/票权事实',
    pattern: /player_node_progress|playerNodeProgress|registration_entitlement|RegistrationEntitlement|queue_joined_at|queueJoinedAt|oms_ticket|OmsTicket/,
    why: '审计 5 §六 + 文档 3 边界：漫游到访不得合写进探店日进店表，POI 查询不得按购票/权益过滤',
  },
  {
    id: 'R8',
    surface: 'map',
    title: '漫游页调用 play 域接口',
    pattern: /['"`]\/api\/play\//,
    why: '审计 5 S1：漫游只写漫游到访。走 /api/play/* 会被 play 的会话闸拦成「请先购买」(免费层里的付费墙)，'
      + '而持 ③ 票时又会按 GPS 写下 player_node_progress 进店行 —— 一条从没扫过店内静态码的进店事实，'
      + '正好是 G2 硬门 queue_joined_at 的取值来源',
  },
  {
    id: 'R6',
    surface: 'playBackend',
    title: 'play 共用进度入口新增 roam 分支',
    pattern: /roam/i,
    why: '审计 5 §六.4：/api/play/arrive 是多玩法共用入口，在控制器里为漫游放宽或加分支会改掉经典定向语义',
  },
]

function scanRoam() {
  const issues = []
  for (const rule of ROAM_RULES) {
    for (const file of surface(rule.surface)) {
      const absolute = path.join(REPO_ROOT, file)
      if (!fs.existsSync(absolute)) continue
      stripComments(fs.readFileSync(absolute, 'utf8'), file).split('\n').forEach((line, index) => {
        if (rule.pattern.test(line)) {
          issues.push({ rule, file, line: index + 1, text: line.trim().slice(0, 120) })
        }
      })
    }
  }
  return issues
}

// R7：口径真源一致性。门禁的前瞻指引正则必须与运行期闸逐字相同。
function routeStoryPolicySource() {
  const source = fs.readFileSync(path.join(REPO_ROOT, ROUTE_STORY_POLICY), 'utf8')
  const match = /Pattern\.compile\(\s*"((?:[^"\\]|\\.)*)"/.exec(source)
  if (!match) throw new Error(`R7 读不到 ${ROUTE_STORY_POLICY} 的 Pattern.compile 字面量`)
  return match[1].replace(/\\\\/g, '\\')
}

// ---------------------------------------------------------------------------
// H 族：H11 禁项。作废清单见裁决表 §三「偏离 3」。
//
// ⚠️ 两个已知误报陷阱，写死在正则里，别放宽：
//   1. `perk_min_value` / `PerkMinValue`（权益档零售价门槛，早于探店日存在）不是 `k_min`。
//      所以 k_min 前必须是非 [a-z_]、kMin 前必须是非字母数字。
//   2. `min_people` / `team_status` 是 oms_ticket 既有列，H11 管的是「不得复制到活动票」
//      这个行为（已由 OmsTicketCopyToActivityTest 与后台 payload 断言锁住），不是列本身
//      的存在，所以**不在**本表里。
//   3. 裸 `N_BE` 是保留项（H11 原文：保留计算、不作闸），只有把它当闸/门才红。
const H11_PATTERNS = [
  { id: 'H11-1', pattern: /(^|[^A-Za-z_])(open_line|tier_k|unlocked_at|k_min)([^A-Za-z_]|$)/, why: '偏离 3 作废清单：开场线/阶梯档/逐场解锁/k_min 一个都不做' },
  { id: 'H11-2', pattern: /(^|[^A-Za-z0-9])(openLine|tierK|unlockedAt|kMin)([^A-Za-z0-9]|$)/, why: '同上，驼峰形（前后必须是非字母数字，规避 perkMinValue 子串误报）' },
  { id: 'H11-3', pattern: /逐场解锁|阶梯表|成团线|条件预售池|最低人数/, why: '偏离 3：阶梯表因逐场解锁而存在，一起倒；报名最低人数/成团线/条件预售池同废' },
  { id: 'H11-4', pattern: /N_BE[\s　]*[闸门]/, why: 'H11：N_BE 保留计算、不作开售闸' },
]

const H11_PATHS = [
  'chengyinhub-ui/src',
  'chengyinhub-xcx',
  'chengyinhub-admin/sql',
  'chengyinhub-admin/src/main',
  'chengyinhub-system/src/main',
  'chengyinhub-common/src/main',
  'chengyinhub-framework/src/main',
  'chengyinhub-quartz/src/main',
]

// 负控本体、契约测试与一次性脚本会**按名点到**禁项，扫它们等于逼人删掉负控。
const H11_EXCLUDED = /^(chengyinhub-xcx\/(tests|scripts|docs)\/|.*\/src\/test\/|chengyinhub-ui\/tests\/)/

function resolveBase(execFileSync) {
  execFileSync = execFileSync || childProcess.execFileSync
  const candidates = [process.env.ROAM_REDLINE_GATE_BASE, 'github/master', 'origin/master'].filter(Boolean)
  for (const candidate of candidates) {
    try {
      execFileSync('git', ['rev-parse', '--verify', `${candidate}^{commit}`], { cwd: REPO_ROOT, stdio: 'ignore' })
      return execFileSync('git', ['merge-base', 'HEAD', candidate], { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
    } catch (_) {
      // 继续尝试下一条远端基线。
    }
  }
  throw new Error('H11 无可用基线：必须 fetch github/master 或 origin/master，禁止静默降级到 HEAD^')
}

// 相对基线 diff 到**工作区**（不是 HEAD），干净树上照样扫得到本分支的全部新增行，
// 同时未提交的变异也进扫描面——本仓有「干净树跑 = 恒真断言」的案底。
function changedLines(base, execFileSync) {
  execFileSync = execFileSync || childProcess.execFileSync
  const diff = execFileSync('git', ['diff', '--unified=0', base, '--'].concat(H11_PATHS), {
    cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  })
  const added = []
  let file = null
  let lineNo = 0
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw.slice(4).replace(/^b\//, '')
      continue
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw)
    if (hunk) {
      lineNo = Number(hunk[1])
      continue
    }
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      if (file && file !== '/dev/null') added.push({ file, line: lineNo, text: raw.slice(1) })
      lineNo += 1
    }
  }
  return added
}

function scanH11(added) {
  const issues = []
  const jsLines = new Map()
  for (const entry of added) {
    if (H11_EXCLUDED.test(entry.file)) continue
    // diff 行可能位于模板/注释/正则内；先解析完整 JS，再只检查原来的新增行集合。
    const absolute = path.join(REPO_ROOT, entry.file)
    let line
    let sourceUncertain = false
    if (path.extname(entry.file) === '.js' && fs.existsSync(absolute)) {
      if (!jsLines.has(entry.file)) {
        jsLines.set(entry.file, stripComments(fs.readFileSync(absolute, 'utf8'), entry.file).split('\n'))
      }
      line = jsLines.get(entry.file)[entry.line - 1]
      if (line === undefined) throw new Error(`${entry.file}:${entry.line}: diff 行超出当前文件，禁止跳过扫描`)
    } else if (path.extname(entry.file) === '.js') {
      // 独立可解析的注释片段也可能是模板正文；缺源时保留原文，命中只标待核验。
      line = entry.text
      sourceUncertain = true
    } else {
      line = stripComments(entry.text, entry.file)
    }
    for (const rule of H11_PATTERNS) {
      if (rule.pattern.test(line)) {
        const issue = { rule, file: entry.file, line: entry.line, text: line.trim().slice(0, 120) }
        if (sourceUncertain) issue.sourceUncertain = true
        issues.push(issue)
      }
    }
  }
  return issues
}

// ---------------------------------------------------------------------------
function matchesRule(rule, text) {
  return rule.pattern.test(stripComments(text))
}

function runSelftest() {
  // R 族：每条规则各注入一次真违规必须命中，配一份合法样本必须放过。
  const roamCases = {
    R1: {
      red: "s.hint = '下次建议先去武康大楼再去安福路'",
      green: "s.routeName = poiNames[0] + '等' + poiNames.length + '处足迹回看'",
    },
    R2: {
      red: "title: (s.routeName || '城市漫游路线') + ' · 已完成'",
      green: "title: (s.routeName || '城市漫游足迹') + ' · ' + s.completeFact",
    },
    R3: {
      red: 'if (!poi.isPrevDone) return error("请先完成上一站");',
      green: 'const found = pois.filter((poi) => poi.distance <= poi.radiusM);',
    },
    R4: {
      red: "wx.openLocation({ latitude: next.lat, longitude: next.lng })",
      green: "patch.polyline = [{ points: this._track, color: '#3B82F6' }]",
    },
    R5: {
      red: 'select * from player_node_progress where member_id = #{memberId}',
      green: 'where status = 1 and lat between #{minLat} and #{maxLat}',
    },
    R6: {
      red: 'if (mode == PlayMode.ROAM) return roamArrive(memberId, node);',
      green: 'if (resolveMode(actId, ctx.topicId) == PlayMode.LINEAR_ORIENTEERING)',
    },
    R8: {
      red: "    return req('/api/play/arrive', 'POST', { nodeId: String(poi.nodeId) });",
      green: "    return req('/api/roam/shop/visit', 'POST', { sourceType: String(sourceType) });",
    },
  }
  for (const rule of ROAM_RULES) {
    const sample = roamCases[rule.id]
    assert.ok(sample, `${rule.id} 缺自测样本`)
    assert.ok(matchesRule(rule, sample.red), `${rule.id} 注入违规未变红：${sample.red}`)
    assert.ok(!matchesRule(rule, sample.green), `${rule.id} 合法样本被误报：${sample.green}`)
  }
  // 注释里的留痕不得判红，否则「这里已删掉 X」的解释会被逼着删掉。
  assert.ok(!matchesRule(ROAM_RULES[1], '// 不画路线、不上报坐标。'))
  assert.ok(!matchesRule(ROAM_RULES[1], ' * Canvas 读不到 WXSS token；路线/文字灰阶复用 play-visual-tokens'))
  // ⚠️ 首版真栽在这：WXSS/WXML 把说明写在**代码行尾**，只剪行首标记会把 ds-ok 注释判红。
  assert.ok(!matchesRule(ROAM_RULES[1], '.ss-card-map { overflow: hidden; } /* ds-ok 成果卡路线画布复用页面路线图中性渐变 */'))
  assert.ok(!matchesRule(ROAM_RULES[1], '<view class="ss-card" /> <!-- 路线图画布 -->'))
  // 但行尾注释只屏蔽注释本身，同行的真代码仍要抓得住。
  assert.ok(matchesRule(ROAM_RULES[1], "title: '城市漫游路线' /* ds-ok 与旧版对齐 */"))

  // R3 的面必须真含官方活动服务:否则「前置求值已移除」这句话没有任何东西守着。
  assert.ok(surface('roam').includes(OFFICIAL_EVENT_SERVICE),
    'R3 扫描面必须含 OfficialEventV2ServiceImpl —— 运行期前置求值就长在那里')
  for (const derived of [
    'if (!prerequisitesCompleteNow(eventId, memberId, mission, missionByCode)) return blocked();',
    '            JSONArray prerequisites = JSON.parseArray(mission.getPrerequisiteJson());',
    '        return rejected(result, "PREREQUISITE_NOT_COMPLETE");',
    '        <result property="prerequisiteJson" column="prerequisite_json"/>',
  ]) {
    assert.ok(matchesRule(ROAM_RULES.find((r) => r.id === 'R3'), derived),
      `R3 抓不住前置求值的派生写法（\\b 假绿):${derived}`)
  }

  // R7：口径真源一致性——门禁正则必须与 RoamRouteStoryPolicy.java 逐字相同。
  assert.equal(routeStoryPolicySource(), FORWARD_GUIDANCE_SOURCE.replace(/\\\\/g, '\\'))

  // H 族：每条禁项注入必须红，两个已知误报陷阱必须绿。
  const h11Red = [
    ['H11-1', "  open_line int default 24 comment '开场线'"],
    ['H11-1', '    private Integer kMinTier; // 无关行'.replace('kMinTier', 'tier_k')],
    ['H11-2', '      payload.unlockedAt = ticket.unlockedAt'],
    ['H11-3', '      <el-form-item label="报名最低人数">'],
    ['H11-4', '    if (!breakEven.pass) throw new IllegalStateException("N_BE 闸未通过");'],
  ]
  for (const [id, text] of h11Red) {
    const hits = scanH11([{ file: 'chengyinhub-admin/src/main/java/X.java', line: 1, text }])
    assert.ok(hits.some((hit) => hit.rule.id === id), `${id} 注入违规未变红：${text}`)
  }
  const migrationPath = 'chengyinhub-admin/sql/migration_h11_selftest.sql'
  assert.ok(H11_PATHS.includes('chengyinhub-admin/sql'), 'H11 扫描面必须覆盖真实 migration 目录')
  for (const text of [
    'ALTER TABLE oms_ticket ADD COLUMN open_line INT;',
    'ALTER TABLE oms_ticket ADD COLUMN tier_k INT;',
    'ALTER TABLE oms_ticket ADD COLUMN unlocked_at DATETIME;',
    'ALTER TABLE oms_ticket ADD COLUMN k_min INT;',
  ]) {
    const hits = scanH11([{ file: migrationPath, line: 1, text }])
    assert.ok(hits.some((hit) => hit.rule.id === 'H11-1'), `H11-1 migration 注入违规未变红：${text}`)
  }
  for (const text of [
    'ALTER TABLE merchant_chapter_offer ADD COLUMN perk_min_value DECIMAL(10,2);',
    'ALTER TABLE oms_ticket ADD COLUMN min_people INT;',
    'ALTER TABLE oms_ticket ADD COLUMN team_status VARCHAR(16);',
    'SELECT N_BE FROM topic_edition_cost;',
  ]) {
    assert.deepEqual(scanH11([{ file: migrationPath, line: 1, text }]), [], `H11 误报合法 migration：${text}`)
  }
  const h11Green = [
    'assertUnchanged("权益门槛", patch.getPerkMinValue(), current.getPerkMinValue());',
    '        <result property="perkMinValue" column="perk_min_value" />',
    "  onChapterPerkMinValueInput(event) { this.setData({ perkMinValue: event.detail.value }) }",
    '        <result property="minPeople" column="min_people" />',
    '    ticket.setTeamStatus(null);',
    '/** 探店日期级成本与 CM/N_BE 必要输入；版本只追加。 */',
    '  <el-descriptions-item label="保本人数 N_BE">{{ financeOverview.breakEvenTickets }}',
    '     * <p>裁决表 §三「偏离 3」删掉四档阶梯表、改成「一次性签一份」时，',
  ]
  for (const text of h11Green) {
    const hits = scanH11([{ file: 'chengyinhub-admin/src/main/java/X.java', line: 1, text }])
    assert.deepEqual(hits.map((hit) => hit.rule.id), [], `H11 误报合法代码：${text}`)
  }
  // 负控本体自己会点名禁项，扫它等于逼人删负控。
  assert.deepEqual(
    scanH11([{ file: 'chengyinhub-ui/tests/unit/shop-day-admin-entry-contract.test.js', line: 1, text: "  /open_line/i, /tier_k/i" }]),
    [],
  )
  // 基线不可静默降级：没有 github/master 也没有 origin/master 必须抛，不能退回 HEAD^。
  assert.throws(() => resolveBase(() => { throw new Error('no such ref') }), /无可用基线/)

  console.log(`R 族自证通过：${ROAM_RULES.length} 条漫游红线各注入一次真违规变红，合法足迹回看/地理排序保持绿`)
  console.log('R7 自证通过：门禁前瞻指引正则与 RoamRouteStoryPolicy.java 逐字一致')
  console.log(`H11 自证通过：${H11_PATTERNS.length} 条禁项规则 + 4 个 migration 作废列注入变红；perk_min_value/min_people/team_status/裸 N_BE/注释留痕均不误报`)
}

function main() {
  if (process.argv.includes('--selftest')) return runSelftest()

  const roamIssues = scanRoam()
  const policySource = routeStoryPolicySource()
  const expectedPolicy = FORWARD_GUIDANCE_SOURCE.replace(/\\\\/g, '\\')
  const base = resolveBase()
  const added = changedLines(base)
  const h11Issues = scanH11(added)

  let failed = false
  for (const issue of roamIssues) {
    failed = true
    console.error(`${issue.rule.id} FAIL:${issue.file}:${issue.line} ${issue.rule.title}｜${issue.rule.why}\n    ${issue.text}`)
  }
  if (policySource !== expectedPolicy) {
    failed = true
    console.error(`R7 FAIL:${ROUTE_STORY_POLICY} 的前瞻指引正则与门禁不一致，两处必须同改\n    Java: ${policySource}\n    门禁: ${expectedPolicy}`)
  }
  for (const issue of h11Issues) {
    failed = true
    const diagnosis = issue.sourceUncertain ? '待核验：缺少完整 JS 上下文，命中尚非已证实违规' : `H11 禁项｜${issue.rule.why}`
    console.error(`${issue.rule.id} FAIL:${issue.file}:${issue.line} ${diagnosis}\n    ${issue.text}`)
  }

  const roamFileCount = new Set(ROAM_RULES.flatMap((rule) => surface(rule.surface))).size
  console.log(`漫游红线 R 族(${ROAM_RULES.length} 条):${roamIssues.length ? '未通过' : '通过'}（${roamFileCount} 个文件：漫游页/漫游分包/scene-roam 组件/ApiRoamController/RoamMapper/ApiPlayProgressController/OfficialEventV2ServiceImpl）`)
  console.log(`口径真源 R7:${policySource === expectedPolicy ? '通过' : '未通过'}（对 ${ROUTE_STORY_POLICY}）`)
  console.log(`H11 零回归:${h11Issues.length ? '未通过' : '通过'}（相对 ${base} 的 ${added.length} 行新增/修改，覆盖后台 UI + 小程序 + 后端 Java/XML/SQL）`)
  if (failed) process.exit(h11Issues.some(issue => issue.sourceUncertain) ? 2 : 1)
}

if (require.main === module) main()

module.exports = { ROAM_RULES, H11_PATTERNS, scanRoam, scanH11, changedLines, resolveBase, routeStoryPolicySource, stripComments }
