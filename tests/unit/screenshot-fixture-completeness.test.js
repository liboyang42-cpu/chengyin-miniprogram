const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const { SHOTS } = require(path.join(ROOT, 'scripts/shot-matrix.js'))
const FIXTURES = require(path.join(ROOT, 'scripts/fixtures.json'))
const SELECTORS = require(path.join(ROOT, 'scripts/selectors.json'))

// 只覆盖重拍中曾经 STATE-UNMET 的 27 张，不冒充全矩阵自动解析。
// paths 是页面/正文组件决定该截图状态所实际消费的最小键集；带 [] 的路径还要求
// 数组非空并继续校验元素键。这里锁键集关系和类型，不锁任何示例文案或金额。
const CONTRACTS = {
  A02: {
    sources: ['pages/index/index.js', 'pages/index/index.wxml'],
    paths: ['isAppReady', 'isLoading', 'listLoading.recommendedTopicList', 'listLoading.nearbyActivityList', 'listLoading.upcomingActivityList', 'listErr.recommendedTopicList', 'listErr.nearbyActivityList', 'listErr.upcomingActivityList', 'recommendedTopicList', 'recoHero', 'nearbyActivityList', 'upcomingActivityList'],
    arrays: ['recommendedTopicList', 'nearbyActivityList', 'upcomingActivityList'],
    equals: {
      isAppReady: true,
      isLoading: true,
      'listLoading.recommendedTopicList': true,
      'listLoading.nearbyActivityList': true,
      'listLoading.upcomingActivityList': true,
      'listErr.recommendedTopicList': false,
      'listErr.nearbyActivityList': false,
      'listErr.upcomingActivityList': false,
      recoHero: null,
    },
  },
  A03: {
    sources: ['pages/index/index.js', 'pages/index/index.wxml'],
    paths: ['isAppReady', 'isLoading', 'listLoading.recommendedTopicList', 'listLoading.nearbyActivityList', 'listLoading.upcomingActivityList', 'listErr.recommendedTopicList', 'listErr.nearbyActivityList', 'listErr.upcomingActivityList', 'recommendedTopicList', 'recoHero', 'nearbyActivityList', 'upcomingActivityList'],
    arrays: ['recommendedTopicList', 'nearbyActivityList', 'upcomingActivityList'],
    equals: {
      isAppReady: true,
      isLoading: false,
      'listLoading.recommendedTopicList': false,
      'listLoading.nearbyActivityList': false,
      'listLoading.upcomingActivityList': false,
      'listErr.recommendedTopicList': true,
      'listErr.nearbyActivityList': true,
      'listErr.upcomingActivityList': true,
      recoHero: null,
    },
  },
  A24: {
    sources: ['pages/search2/index.js', 'pages/search2/index.wxml'],
    paths: ['searchHistory', 'hotkeys[]', 'categoryList', 'categoryLoading', 'categoryError'],
    arrays: ['searchHistory', 'categoryList'],
    equals: { categoryLoading: false, categoryError: '' },
  },
  A28: {
    sources: ['pages/search2/result/index.js', 'pages/search2/result/index.wxml'],
    paths: ['keyword', 'searchLoading', 'showSearchSkeleton', 'searchError', 'resultGroups', 'visibleResults'],
    arrays: ['resultGroups', 'visibleResults'],
    equals: { searchLoading: true, showSearchSkeleton: true, searchError: '' },
  },
  A30: {
    sources: ['pages/searchmap/index.js', 'pages/searchmap/index.wxml'],
    paths: ['locationError', 'locationAction', 'locationMessage', 'listState'],
    equals: { locationError: true, locationAction: 'open-setting', listState: 'ready' },
  },
  A35: {
    sources: ['components/cy/profile/index.js', 'components/cy/profile/index.wxml'],
    shell: ['pages/member/index/index.wxml', 'id="profile"'],
    target: '#profile',
    paths: ['pointsSheet.show', 'pointsSheet.loading', 'pointsSheet.loaded', 'pointsSheet.failed', 'pointsSheet.tasks', 'sceneCurrent.id', 'sceneCurrent.variant', 'sceneCurrent.theme', 'sceneCurrent.title', 'sceneCurrent.maskClosable'],
    arrays: ['pointsSheet.tasks'],
    equals: {
      'pointsSheet.show': true,
      'pointsSheet.loading': true,
      'pointsSheet.loaded': false,
      'pointsSheet.failed': false,
      'sceneCurrent.id': 'points-tasks',
      'sceneCurrent.variant': 'half',
      'sceneCurrent.theme': 'player',
      'sceneCurrent.title': '积分任务',
      'sceneCurrent.maskClosable': true,
    },
  },
  A36: {
    sources: ['components/cy/profile/index.js', 'components/cy/profile/index.wxml'],
    shell: ['pages/member/index/index.wxml', 'id="profile"'],
    target: '#profile',
    paths: ['activeTab'],
    equals: { activeTab: 'posts' },
  },
  A37: {
    sources: ['components/cy/profile/index.js', 'components/cy/profile/index.wxml'],
    shell: ['pages/member/index/index.wxml', 'id="profile"'],
    target: '#profile',
    paths: ['activeTab', 'profileMetricState', 'profilePoint', 'rankDisplay.no', 'rankDisplay.delta', 'exploreStat.shops', 'exploreStat.weekExp'],
    equals: {
      activeTab: 'achievements',
      profileMetricState: 'ready',
      profilePoint: 128,
      'rankDisplay.no': '12',
      'rankDisplay.delta': '↑ 3',
      'exploreStat.shops': 12,
      'exploreStat.weekExp': 80,
    },
  },
  A38: {
    sources: ['components/cy/profile/index.js', 'components/cy/profile/index.wxml'],
    shell: ['pages/member/index/index.wxml', 'id="profile"'],
    target: '#profile',
    paths: ['activeTab', 'merchantState', 'subjectIsMerchant'],
    equals: { activeTab: 'about', merchantState: 'not-merchant', subjectIsMerchant: false },
  },
  A41: {
    sources: ['subpackageMember/signup/index.js', 'subpackageMember/signup/index.wxml'],
    // 2026-09-09 票夹合并两个 tab:渲染只认合成后的 walletState / ticketList,
    // 两条支线的原料已挪出 data(U4 死数据字段门禁)。契约跟着搬,钉的仍是
    // 「已取消票券要由真实 registrationStatus 驱动」。
    // 2026-09-18 UI-17 返修:票面零可见文字后,wTitle 只走 aria-label(仍在模板里消费);
    // kind 的消费点只剩 goTicket 的分流(JS,见 signup-state-contract「kind 决定点开跳哪」),
    // 模板不再有它的读取点,故从模板消费清单摘除,fixture 里的 kind 照旧保留。
    paths: ['walletState', 'ticketList', 'ticketList[].wTitle'],
    arrays: ['ticketList'],
    equals: { walletState: 'ready' },
  },
  A48: {
    sources: ['pages/mylike/mylike.js', 'pages/mylike/mylike.wxml'],
    paths: ['loading', 'refreshing', 'errorMsg', 'ztList1[].id', 'ztList1[].name', 'ztList1[].imgUrl'],
    equals: { loading: true, refreshing: true, errorMsg: '' },
  },
  A58: {
    sources: ['pages/privacy/index.js', 'pages/privacy/index.wxml'],
    paths: ['pendingAuthorization', 'submitting', 'submitError', 'failedAction'],
    equals: { pendingAuthorization: false, submitting: false, submitError: '', failedAction: '' },
  },
  A14: {
    // 2026-08-20 卡片重设计:卡体收进 cy-club-card,子键消费在组件源码(整对象经 club prop 传入)
    sources: ['pages/talent/list/index.js', 'pages/talent/list/index.wxml', 'components/cy/club-card/index.js', 'components/cy/club-card/index.wxml'],
    paths: ['activeTopTab', 'clubsLoaded', 'myClubs[].name', 'myClubs[].logoUrl', 'joinedClubs', 'nearbyClubs'],
    arrays: ['joinedClubs', 'nearbyClubs'],
    equals: { activeTopTab: 'club', clubsLoaded: true },
  },
  A15: {
    sources: ['pages/talent/list/index.js', 'pages/talent/list/index.wxml', 'components/cy/club-card/index.js', 'components/cy/club-card/index.wxml'],
    paths: ['activeTopTab', 'clubsLoaded', 'nearbyClubs[].name', 'nearbyClubs[].logoUrl', 'myClubs', 'joinedClubs'],
    arrays: ['myClubs', 'joinedClubs'],
    equals: { activeTopTab: 'club', clubsLoaded: true },
  },
  B07: {
    sources: ['components/cy/scene-roam-history/index.js', 'components/cy/scene-roam-history/index.wxml'],
    shell: ['subpackageRoam/history/index.wxml', '<cy-scene-roam-history'],
    target: 'cy-scene-roam-history',
    state: 'normal',
    paths: ['state', 'list[].title', 'list[].dateShort', 'list[].distanceText', 'list[].shopsText', 'list[].medals', 'summary.trips', 'summary.km', 'summary.shopsText'],
    equals: { state: 'ready' },
  },
  B08: {
    sources: ['components/cy/scene-roam-session/index.js', 'components/cy/scene-roam-session/index.wxml'],
    shell: ['subpackageRoam/session/index.wxml', '<cy-scene-roam-session'],
    target: 'cy-scene-roam-session',
    route: '/subpackageRoam/session/index?ts=1',
    paths: ['state', 'session.distanceText', 'session.time', 'session.pois[].name'],
    equals: { state: 'ready' },
  },
  B10: {
    sources: ['subpackageRoam/citynode-code/index.js', 'subpackageRoam/citynode-code/index.wxml'],
    paths: ['state', 'errMsg'],
    equals: { state: 'missing', errMsg: '' },
  },
  B18: {
    sources: ['components/cy/scene-play-activity-detail/index.js', 'components/cy/scene-play-activity-detail/index.wxml'],
    shell: ['pages/activity/detail/index.wxml', '<cy-scene-play-activity-detail'],
    target: 'cy-scene-play-activity-detail',
    paths: ['state', 'info.name', 'info.memberTemplateList', 'info.collaboratorsList', 'info.registrationList', 'info.commentList', 'tickets[]._id', 'tickets[].cmsRegistrationList'],
    arrays: ['info.memberTemplateList', 'info.collaboratorsList', 'info.registrationList', 'info.commentList'],
    equals: { state: 'ready' },
  },
  B19: {
    sources: ['components/cy/scene-play-activity-detail/index.js', 'components/cy/scene-play-activity-detail/index.wxml'],
    shell: ['pages/activity/detail/index.wxml', '<cy-scene-play-activity-detail'],
    target: 'cy-scene-play-activity-detail',
    paths: ['state', 'info.name', 'info.memberTemplateList', 'info.collaboratorsList', 'info.registrationList', 'info.commentList', 'tickets[]._id', 'actionState', 'actionText', 'isOwner', 'canConfirmSignup'],
    arrays: ['info.memberTemplateList', 'info.collaboratorsList', 'info.registrationList', 'info.commentList'],
    equals: { state: 'ready', actionState: 'view', actionText: '查看报名', isOwner: false, canConfirmSignup: false },
  },
  B20: {
    sources: ['components/cy/scene-play-activity-detail/index.js', 'components/cy/scene-play-activity-detail/index.wxml'],
    shell: ['pages/activity/detail/index.wxml', '<cy-scene-play-activity-detail'],
    target: 'cy-scene-play-activity-detail',
    state: 'normal',
    paths: ['state', 'info.name', 'info.memberTemplateList', 'info.collaboratorsList', 'info.registrationList', 'info.commentList', 'tickets[]._id', 'actionState', 'actionText', 'isOwner', 'canConfirmSignup'],
    arrays: ['info.memberTemplateList', 'info.collaboratorsList', 'info.registrationList', 'info.commentList'],
    equals: { state: 'ready', actionState: 'signup', actionText: '立即报名', isOwner: true, canConfirmSignup: false },
  },
  B22: {
    sources: ['pages/activity/baoming/baoming.js', 'pages/activity/baoming/baoming.wxml'],
    paths: ['pageState', 'participantState', 'activityInfo.name', 'selectedTicket.name', 'selectedTicket.price', 'selectedAddress.fullName', 'hostShareChecked', 'hostShareConsentReady', 'quoteReady', 'paymentReady', 'canPay', 'totalAmount', 'waitlistState', 'ticketSoldOut'],
    equals: { pageState: 'ready', participantState: 'ready', hostShareChecked: false, hostShareConsentReady: true, quoteReady: true, paymentReady: true, canPay: false, waitlistState: 'NONE', ticketSoldOut: false },
  },
  B23: {
    sources: ['pages/activity/baoming/baoming.js', 'pages/activity/baoming/baoming.wxml'],
    paths: ['pageState', 'participantState', 'activityInfo.name', 'selectedTicket.name', 'selectedTicket.price', 'selectedAddress.fullName', 'hostShareChecked', 'hostShareConsentReady', 'quoteReady', 'paymentReady', 'canPay', 'isPaying', 'submitError', 'waitlistState', 'ticketSoldOut'],
    equals: { pageState: 'ready', participantState: 'ready', hostShareChecked: true, hostShareConsentReady: true, quoteReady: true, paymentReady: true, canPay: true, isPaying: false, submitError: '报名服务暂时不可用，请稍后重试', waitlistState: 'NONE', ticketSoldOut: false },
  },
  B26: {
    sources: ['pages/activity/baoming/baoming.js', 'pages/activity/baoming/baoming.wxml'],
    paths: ['pageState', 'participantState', 'activityInfo.name', 'selectedTicket.name', 'selectedTicket.price', 'selectedAddress.fullName', 'hostShareChecked', 'hostShareConsentReady', 'quoteReady', 'paymentReady', 'totalAmount', 'pointsUsable', 'waitlistState', 'ticketSoldOut'],
    equals: { pageState: 'ready', participantState: 'ready', hostShareChecked: true, hostShareConsentReady: true, quoteReady: true, paymentReady: true, pointsUsable: false, waitlistState: 'NONE', ticketSoldOut: false },
  },
  B28: {
    sources: ['pages/activity/list/index.js', 'pages/activity/list/index.wxml'],
    paths: ['loading', 'tab', 'events', 'loadError', 'mineError', 'curError', 'errorMsg', 'emptyTitle', 'emptySub'],
    arrays: ['events'],
    equals: { loading: false, tab: 3, loadError: false, mineError: false, curError: false, errorMsg: '' },
  },
  B29: {
    sources: ['pages/activity/list/index.js', 'pages/activity/list/index.wxml'],
    paths: ['loading', 'tab', 'events[].id', 'events[].title', 'events[]._statusText', 'events[]._timeText', 'events[]._pct', 'loadError', 'mineError', 'curError', 'errorMsg'],
    equals: { loading: false, tab: 1, loadError: false, mineError: false, curError: false, errorMsg: '' },
  },
  B43: {
    sources: ['subpackageA/pages/myproject/index.js', 'subpackageA/pages/myproject/index.wxml'],
    paths: ['typeTab', 'projectState', 'loading', 'loaded', 'list[].title', 'list[].projectTypeText', 'list[]._stateVariant'],
    equals: { typeTab: 'topic', projectState: 'ready', loading: false, loaded: true },
  },
  B44: {
    sources: ['subpackageA/pages/myproject/index.js', 'subpackageA/pages/myproject/index.wxml'],
    paths: ['typeTab', 'tplList[].id', 'tplList[].title', 'tplList[].imgUrl', 'tplList[]._stateVariant', 'tplList[]._statusText', 'tplList[].publishStatus', 'tplLoaded', 'tplLoading', 'tplErrorMsg'],
    equals: { typeTab: 'template', tplLoaded: true, tplLoading: false, tplErrorMsg: '' },
  },
  B68: {
    sources: ['subpackageP3/pages/growthcenter/index/index.js', 'subpackageP3/pages/growthcenter/index/index.wxml'],
    paths: ['overviewState', 'overviewLoaded', 'overview.stats[].label', 'overview.stats[].value', 'badges[].name', 'badges[].code', 'badges[].initial', 'showBadges', 'showBadgeEmpty', 'badgeLoadError', 'badgeCountText'],
    arrays: ['badges'],
    equals: { overviewState: 'ready', overviewLoaded: true, showBadges: true, showBadgeEmpty: false, badgeLoadError: false },
  },
  B70: {
    sources: ['subpackageP3/pages/growthcenter/index/index.js', 'subpackageP3/pages/growthcenter/index/index.wxml'],
    paths: ['rankState', 'rankErrorKind', 'errorMsg', 'boardState', 'metric', 'period', 'unit', 'me.rank', 'me.name', 'me.initial', 'me.scoreText', 'me.avatarUrl', 'rankLoaded'],
    equals: { rankState: 'ready', rankErrorKind: 'data', errorMsg: '', boardState: 'ready', metric: 'point', period: 'total', unit: '积分', 'me.rank': 1, 'me.scoreText': '1,280', rankLoaded: true },
  },
  B75: {
    sources: ['subpackageP3/pages/growthcenter/leaderboard/index.js', 'subpackageP3/pages/growthcenter/leaderboard/index.wxml'],
    paths: ['loading', 'errorMsg', 'metric', 'period', 'unit', 'top3', 'rest', 'me'],
    arrays: ['top3', 'rest'],
    equals: { loading: false, errorMsg: '排行榜没有加载出来', metric: 'point', period: 'total', unit: '积分', me: null },
  },
  C01: {
    sources: ['pages/merchant/index/index.js', 'pages/merchant/index/index.wxml'],
    // 2026-09-16 去闸:consoleState 身份状态机已删除,失败态改由 consoleError 页内表达。
    paths: ['merchantAccess.canReadFinance', 'merchantAccess.canManageProjects', 'dashboardLoading', 'dashboardError', 'dashboardData.revenue', 'joinLoading', 'hostLoading', 'todoLoading', 'gameEntryLoading', 'projectCards[].title', 'notifications[].label'],
    equals: {
      'merchantAccess.active': true,
      'merchantAccess.canReadFinance': true,
      'merchantAccess.canManageProjects': true,
      dashboardLoading: false,
      dashboardError: '',
      joinLoading: false,
      hostLoading: false,
      todoLoading: false,
      gameEntryLoading: false,
    },
  },
  C02: {
    sources: ['pages/merchant/index/index.js', 'pages/merchant/index/index.wxml'],
    paths: ['merchantAccess.canManageProjects', 'dashboardLoading', 'joinLoading', 'hostLoading', 'todoLoading', 'gameEntryLoading', 'projectCards'],
    arrays: ['projectCards'],
    equals: {
      'merchantAccess.active': true,
      'merchantAccess.canManageProjects': true,
      dashboardLoading: false,
      joinLoading: false,
      hostLoading: false,
      todoLoading: false,
      gameEntryLoading: false,
    },
  },
  C06: {
    sources: ['pages/merchant/apply/index.js', 'pages/merchant/apply/index.wxml'],
    paths: ['bootstrapState', 'bootstrapError', 'bootstrapErrorKind', 'mode', 'step', 'name', 'phone', 'canNext', 'submitting', 'submitError', 'submitErrorKind'],
    equals: { bootstrapState: 'ready', bootstrapError: '', bootstrapErrorKind: '', mode: 'form', step: 1, name: '', phone: '', canNext: false, submitting: false, submitError: '', submitErrorKind: '' },
  },
  D14: {
    sources: ['subpackageMember/coupon/coupon.js', 'subpackageMember/coupon/coupon.wxml'],
    paths: ['loadState', 'errorMsg', 'list'],
    arrays: ['list'],
    equals: { loadState: 'ready', errorMsg: '' },
  },
  C12: {
    sources: ['pages/merchant/marketing/index.js', 'pages/merchant/marketing/index.wxml'],
    // 2026-08-26 营销页重做:statCards / marketingState / couponSummary 三个字段下线,
    // 指标搬进 hero、券卡搬进 couponCard。契约路径跟着换载体,守的还是
    // 「截图 fixture 必须覆盖页面真正消费的每个字段」。
    paths: ['accessState', 'marketingLoaded', 'hero.value', 'hero.sub', 'couponCard.title', 'couponCard.sub', 'deckGhosts', 'couponRate', 'recruitCount', 'myContent[].title', 'myContent[].count', 'myContent[].countText', 'entries[].title', 'entries[].action'],
    arrays: ['myContent', 'entries'],
    equals: { accessState: 'ready', marketingLoaded: true },
  },
  C12b: {
    sources: ['pages/merchant/marketing/ai-insight/index.js', 'pages/merchant/marketing/ai-insight/index.wxml'],
    paths: ['loading', 'error', 'factState', 'facts.window', 'valueCard.visitors', 'ai.summary', 'aiError', 'metricCards[].name'],
    equals: { loading: false, error: '', factState: 'ready', aiError: '' },
  },
  C12c: {
    sources: ['pages/merchant/marketing/ai-insight/index.js', 'pages/merchant/marketing/ai-insight/index.wxml'],
    paths: ['loading', 'error', 'factState', 'facts.window', 'valueCard.visitors', 'ai', 'aiError', 'metricCards[].name'],
    equals: { loading: false, error: '', factState: 'ready', ai: false, aiError: '智能解读暂不可用' },
  },
  // 2026-09-17 B-06:原 C36(pricing/partner)fixture 随孤儿页退役删除。
  B66: {
    sources: ['subpackageP3/pages/badge-wall/index/index.js', 'subpackageP3/pages/badge-wall/index/index.wxml'],
    paths: ['loaded', 'loadFail', 'partialFail', 'glFail', 'badges[].name'],
    equals: { loaded: true, loadFail: false, partialFail: false, glFail: false },
    matrix: false,
  },
  C03: {
    sources: ['pages/merchant/index/index.js', 'pages/merchant/index/index.wxml'],
    paths: ['consoleError'],
    equals: { consoleError: '工作台暂时无法加载' },
  },
  C09: {
    sources: ['pages/merchant/ledger/index.js', 'pages/merchant/ledger/index.wxml'],
    route: '/pages/merchant/ledger/index?view=settlement',
    paths: ['view', 'loading', 'error', 'overview.personalNetDisplay', 'entries[].sourceText', 'batches[].periodYm'],
    equals: { view: 'settlement', loading: false, error: false },
  },
  C14: {
    sources: ['pages/merchant/relation/index.js', 'pages/merchant/relation/index.wxml'],
    paths: ['pageState', 'error', 'activeTab', 'merchants[].displayName', 'clubs[].displayName'],
    equals: { pageState: 'ready', error: '' },
  },
  C19: {
    sources: ['pages/merchant/citynode/index.js', 'pages/merchant/citynode/index.wxml'],
    paths: ['accessState', 'merchantAccess.canManageProjects', 'loading', 'loadErr', 'nodes', 'applications', 'showClaim', 'claimable', 'claimState', 'quotaState', 'used', 'max'],
    arrays: ['nodes', 'applications', 'claimable'],
    equals: { accessState: 'ready', 'merchantAccess.active': true, 'merchantAccess.canManageProjects': true, loading: false, loadErr: false, showClaim: false, claimState: 'idle', quotaState: 'ready', used: 0, max: 3 },
  },
  C25: {
    sources: ['pages/topic/index/index.js', 'pages/topic/index/index.wxml'],
    paths: ['missingTopicId', 'loadError', 'topicLoaded', 'loadErrorTitle', 'loadErrorSub'],
    equals: { missingTopicId: true, loadError: true, topicLoaded: false },
  },
  C56: {
    sources: ['pages/coop/nearby/index.js', 'pages/coop/nearby/index.wxml'],
    paths: ['pageState', 'merchants', 'refreshing', 'errorKind', 'errorText'],
    arrays: ['merchants'],
    equals: { pageState: 'permission', refreshing: false, errorKind: 'permission' },
  },
  C40: {
    sources: ['pages/club/create/index.js', 'pages/club/create/index.wxml'],
    role: 'club',
    paths: ['step', 'dots', 'typeOptions[].val', 'typeOptions[].sub', 'dirOptions'],
    arrays: ['dots', 'dirOptions'],
    equals: { step: 1 },
  },
  C46: {
    sources: ['components/cy/scene-club-edit/index.js', 'components/cy/scene-club-edit/index.wxml'],
    shell: ['pages/club/edit/index.wxml', '<cy-scene-club-edit'],
    target: 'cy-scene-club-edit',
    paths: ['loadState', 'name', 'city', 'description', 'activityPrefs', 'typeOptions[].val', 'dirOptions', 'memberReservedQuota'],
    arrays: ['activityPrefs', 'dirOptions'],
    equals: { loadState: 'ready' },
  },
  C47: {
    sources: ['pages/club/enroll/index.js', 'pages/club/enroll/index.wxml'],
    route: '/pages/club/enroll/index?clubId=1',
    paths: ['clubId', 'permissionState', 'teamsState', 'teams[].name', 'teams[].signupCount'],
    equals: { permissionState: 'ready', teamsState: 'ready' },
  },
  C48: {
    sources: ['pages/club/enroll/index.js', 'pages/club/enroll/index.wxml'],
    route: '/pages/club/enroll/index?clubId=1',
    paths: ['clubId', 'permissionState', 'teamsState', 'teams[].name', 'teams[].dateText'],
    equals: { permissionState: 'ready', teamsState: 'ready' },
  },
  C49: {
    sources: ['pages/club/enroll/index.js', 'pages/club/enroll/index.wxml'],
    route: '/pages/club/enroll/index?clubId=1',
    paths: ['clubId', 'permissionState', 'teamsState', 'teams'],
    arrays: ['teams'],
    equals: { permissionState: 'ready', teamsState: 'ready' },
  },
  C52: {
    sources: ['pages/coop/list/index.js', 'pages/coop/list/index.wxml'],
    paths: ['tab', 'tabKey', 'listState', 'received[].partnerName', 'received[].topicText', 'received[].termsText', 'received[].decisionReady'],
    equals: { tab: 0, tabKey: '0', listState: 'ready', 'received[].decisionReady': true },
  },
  C60: {
    sources: ['components/cy/scene-merchant-profit/index.js', 'components/cy/scene-merchant-profit/index.wxml'],
    shell: ['pages/coop/finance/index.wxml', 'id="merchantProfit"'],
    target: '#merchantProfit',
    paths: ['loaded', 'loadErr', 'statItems', 'myIncomeTotal', 'canWithdraw', 'pendingCount', 'topics[].topicName', 'topics[].incomeText'],
    arrays: ['statItems'],
    equals: { loaded: true, loadErr: false, canWithdraw: true },
  },
  D01: {
    sources: ['components/cy/scene-member-order-history/index.js', 'components/cy/scene-member-order-history/index.wxml'],
    shell: ['subpackageMember/order/order.wxml', 'id="orderHistory"'],
    target: '#orderHistory',
    paths: ['activeTab', 'loading', 'errorMsg', 'hasOrders', 'nodata', 'list'],
    arrays: ['list'],
    equals: { activeTab: '0', loading: false, errorMsg: '', hasOrders: false, nodata: true },
  },
  D11: {
    sources: ['subpackageMember/components/scene-member-participation-detail/index.js', 'subpackageMember/components/scene-member-participation-detail/index.wxml'],
    shell: ['subpackageMember/mycanyuinfo/mycanyuinfo.wxml', 'id="participationDetail"'],
    target: '#participationDetail',
    paths: ['id', 'loadState', 'info.status', 'info.totalOrderNum', 'info.verifiedNum', 'displayInfo.topicName', 'displayInfo.formatDateRange'],
    equals: { loadState: 'ready', 'info.status': 1 },
  },
  D21: {
    sources: ['components/cy/scene-member-withdraw-history/index.js', 'components/cy/scene-member-withdraw-history/index.wxml'],
    shell: ['subpackageMember/tixianjilu/tixianjilu.wxml', 'id="withdrawHistory"'],
    target: '#withdrawHistory',
    paths: ['loading', 'loadErr', 'nodata', 'list[].createTimeText', 'list[].receivedAmountText', 'list[].statusText', 'list[].statusVariant'],
    equals: { loading: false, loadErr: false, nodata: false, 'list[].statusText': '提现中', 'list[].statusVariant': 'warn' },
  },
  D30: {
    sources: ['components/cy/scene-asset-income-detail/index.js', 'components/cy/scene-asset-income-detail/index.wxml'],
    shell: ['subpackageA/pages/assetcenter/income-detail/income-detail.wxml', 'id="incomeDetail"'],
    target: '#incomeDetail',
    paths: ['activeFilter', 'loading', 'loadErr', 'hasMore', 'list'],
    arrays: ['list'],
    equals: { activeFilter: 'all', loading: false, loadErr: false, hasMore: false },
  },
  D31: {
    sources: ['components/cy/scene-asset-income-detail/index.js', 'components/cy/scene-asset-income-detail/index.wxml'],
    shell: ['subpackageA/pages/assetcenter/income-detail/income-detail.wxml', 'id="incomeDetail"'],
    target: '#incomeDetail',
    paths: ['loading', 'loadErr', 'list'],
    arrays: ['list'],
    equals: { loading: false, loadErr: true },
  },
  D18: {
    sources: ['subpackageMember/coupon-qr/index.js', 'subpackageMember/coupon-qr/index.wxml'],
    paths: ['couponHistoryId', 'entryState', 'coupon.couponName', 'qrcodeUrl', 'qrState', 'errMsg', 'pollError', 'countdown', 'useStatus'],
    equals: { couponHistoryId: '1', entryState: 'ready', qrcodeUrl: '', qrState: 'error', errMsg: '二维码暂时没能生成，请稍后重试', pollError: '', countdown: 0, useStatus: 0 },
  },
  F02: {
    sources: ['subpackageP3/pages/badge-3d/index.js', 'subpackageP3/pages/badge-3d/index.wxml'],
    paths: ['name', 'sub', 'unsupported', 'renderState', 'fallbackSrc'],
    equals: { unsupported: true, renderState: 'fallback', fallbackSrc: '/subpackageP3/assets/badge-demo.png' },
  },
}

function tokensOf(contractPath) {
  return contractPath.split('.').map(part => ({ key: part.replace(/\[\]$/, ''), array: part.endsWith('[]') }))
}

function valuesAt(root, contractPath) {
  let values = [root]
  for (const { key, array } of tokensOf(contractPath)) {
    const next = []
    for (const value of values) {
      if (value == null || !Object.prototype.hasOwnProperty.call(value, key)) continue
      const child = value[key]
      if (array) {
        if (!Array.isArray(child) || child.length === 0) continue
        next.push(...child)
      } else {
        next.push(child)
      }
    }
    if (!next.length) return []
    values = next
  }
  return values
}

function hasFixturePath(root, contractPath) {
  return valuesAt(root, contractPath).length > 0
}

function valueAt(root, contractPath) {
  return contractPath.split('.').reduce((value, key) => (value == null ? undefined : value[key]), root)
}

function assertSourceConsumes(id, sources, contractPath) {
  const source = sources.map(read).join('\n')
  const tokens = tokensOf(contractPath)
  const escaped = tokens.map(({ key }) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const arrayAt = tokens.findIndex(({ array }) => array)
  if (arrayAt < 0) {
    const exactPath = escaped.join('\\s*\\.\\s*')
    assert.match(source, new RegExp(`\\b${exactPath}\\b`), `${id}: 源码未消费契约路径 ${contractPath}`)
    return
  }

  const arrayPath = escaped.slice(0, arrayAt + 1).join('\\s*\\.\\s*')
  const loopPattern = new RegExp(`wx:for\\s*=\\s*["']\\{\\{[^}]*\\b${arrayPath}\\b[^}]*\\}\\}["']`)
  const loopMatch = loopPattern.exec(source)
  assert.ok(loopMatch, `${id}: 源码未按数组渲染契约路径 ${contractPath}`)
  if (tokens.length > arrayAt + 1) {
    const leaf = escaped[escaped.length - 1]
    const tagStart = source.lastIndexOf('<', loopMatch.index)
    const tagEnd = source.indexOf('>', loopMatch.index)
    const opening = source.slice(tagStart, tagEnd + 1)
    const itemMatch = opening.match(/wx:for-item\s*=\s*["']([^"']+)["']/)
    const itemName = (itemMatch && itemMatch[1]) || 'item'
    const afterOpening = source.slice(tagEnd + 1)
    const nextLoopMatch = /wx:for\s*=/.exec(afterOpening)
    const loopBodyEnd = nextLoopMatch ? tagEnd + 1 + nextLoopMatch.index : source.length
    const loopChunk = source.slice(tagStart, loopBodyEnd)
    const escapedItem = itemName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const leafInChunk = new RegExp(`\\b${escapedItem}\\s*\\.\\s*${leaf}\\b`)
    if (!leafInChunk.test(loopChunk)) {
      // 2026-08-20:循环体把整个 item 交给子组件对象 prop(如 club="{{item}}")时,
      // 子键消费发生在组件源码里 —— 要求 sources 里声明组件文件,并在其中按 prop 名消费该子键。
      const propMatch = opening.match(new RegExp(`([a-zA-Z][a-zA-Z0-9-]*)\\s*=\\s*["']\\{\\{\\s*${escapedItem}\\s*\\}\\}["']`))
      assert.ok(propMatch, `${id}: 源码未在 ${arrayPath} 循环消费子键 ${contractPath}`)
      const propName = propMatch[1].replace(/-([a-z])/g, (m, c) => c.toUpperCase())
      assert.match(
        source,
        new RegExp(`\\b${propName}\\s*\\.\\s*${leaf}\\b`),
        `${id}: 源码未在 ${arrayPath} 循环消费子键 ${contractPath}(整对象经 prop ${propName} 传入,但组件源码没消费该子键)`,
      )
    }
  }
}

function assertFixtureCompleteness(fixtures = FIXTURES) {
  const shots = Object.fromEntries(SHOTS.map(shot => [shot.id, shot]))
  for (const [id, contract] of Object.entries(CONTRACTS)) {
    const fixture = fixtures[id]
    assert.ok(fixture && fixture.data, `${id}: fixture 缺少 data`)
    for (const contractPath of contract.paths) {
      assertSourceConsumes(id, contract.sources, contractPath)
      assert.ok(hasFixturePath(fixture.data, contractPath), `${id}: fixture 缺少 ${contractPath}`)
      if (contract.matrix !== false) {
        assert.ok(shots[id].data, `${id}: matrix 缺少 data fallback`)
        assert.ok(hasFixturePath(shots[id].data, contractPath), `${id}: matrix 缺少 ${contractPath}`)
      }
    }
    for (const arrayPath of contract.arrays || []) {
      assert.ok(Array.isArray(valueAt(fixture.data, arrayPath)), `${id}: fixture ${arrayPath} 应为 array`)
      if (contract.matrix !== false) {
        assert.ok(Array.isArray(valueAt(shots[id].data, arrayPath)), `${id}: matrix ${arrayPath} 应为 array`)
      }
    }
    for (const [valuePath, expected] of Object.entries(contract.equals || {})) {
      const fixtureValues = valuesAt(fixture.data, valuePath)
      assert.ok(
        fixtureValues.length && fixtureValues.every(value => Object.is(value, expected)),
        `${id}: fixture ${valuePath} 必须严格等于 ${JSON.stringify(expected)}`,
      )
      if (contract.matrix !== false) {
        const matrixValues = valuesAt(shots[id].data, valuePath)
        assert.ok(
          matrixValues.length && matrixValues.every(value => Object.is(value, expected)),
          `${id}: matrix ${valuePath} 必须严格等于 ${JSON.stringify(expected)}`,
        )
      }
    }
    if (contract.target) {
      assert.equal(shots[id].fixtureTarget, contract.target, `${id}: matrix 缺少正文 target ${contract.target}`)
      assert.equal(fixture.target, contract.target, `${id}: fixture 缺少正文 target ${contract.target}`)
      const [shellFile, shellNeedle] = contract.shell
      assert.ok(read(shellFile).includes(shellNeedle), `${id}: 深链壳未挂载 ${contract.target}`)
    }
    if (contract.route) assert.equal(shots[id].route, contract.route, `${id}: 必须通过真实路由参数进入目标模式`)
    if (contract.role) assert.equal(shots[id].role, contract.role, `${id}: role 必须通过页面进入闸`)
    if (contract.state) assert.equal(shots[id].state, contract.state, `${id}: matrix state 与当前 DOM 语义不一致`)
  }
}

// 2026-09-09 C61(探店日质量证据)随页删除,60→59。
// 2026-09-17 B-06:原 C36(pricing/partner)随孤儿页退役,59→58。
test('58 个 STATE-UNMET fixture 的键集覆盖页面/正文组件最小消费契约', () => {
  assert.equal(Object.keys(CONTRACTS).length, 58)
  assertFixtureCompleteness()
})

test('A14/A15、B66、C03 与子组件正文使用状态专属 DOM 断言', () => {
  for (const id of ['A14', 'A15']) {
    assert.equal(SELECTORS[id].selector, '.club-grid, .club-card')
    assert.ok(!SELECTORS[id].forbid.includes('cy-empty'), `${id}: 同页另一分区允许合法 cy-empty`)
  }
  assert.equal(SELECTORS.B66.selector, '.bw-list-row')
  assert.ok(SELECTORS.B66.forbid.includes('cy-empty'))
  assert.equal(SELECTORS.B43.selector, '.mp-card')
  // 2026-09-16 去闸:C03 工作台错误态从整屏 cy-error 改为页内 cy-inline-error 宿主类。
  assert.equal(SELECTORS.C03.selector, '.rv-console-error')
  for (const id of ['C47', 'C48']) {
    assert.equal(SELECTORS[id].selector, '.team')
    assert.ok(SELECTORS[id].forbid.includes('cy-error'))
  }
  assert.equal(SELECTORS.C60.selector, '.stat-grid, .fc-card, .fc-explainer')
  assert.equal(SELECTORS.C60.min, 3)
  assert.equal(SELECTORS.D21.selector, '.txjl_li')
  assert.equal(SELECTORS.A24.selector, '.hot-keys .li, .search-actions')
  assert.equal(SELECTORS.A24.min, 2)
  assert.deepEqual(SELECTORS.A24.forbid, ['.type-list'])
  assert.equal(SELECTORS.A35.selector, '.pts-hero, cy-skeleton')
  assert.equal(SELECTORS.A35.min, 2)
  assert.deepEqual(SELECTORS.A35.forbid, ['cy-empty', '.pts-loading'])
  assert.equal(SELECTORS.A48.selector, '.favorite-refreshing, .c1-page-title, .favorite-card')
  assert.equal(SELECTORS.A48.min, 3)
  assert.deepEqual(SELECTORS.A48.forbid, ['cy-empty', 'cy-error', 'cy-skeleton'])
  assert.equal(SELECTORS.B75.selector, '.gc-error-board')
  assert.equal(SELECTORS.C06.selector, '.wizard-progress, .wizard-actions')
  assert.equal(SELECTORS.C06.min, 2)
  assert.deepEqual(SELECTORS.C06.forbid, ['.status-card', 'cy-state-shell'])
})

test('A14-A17 俱乐部内容/空态 fixture 必须显式关闭迟到的错误态', () => {
  for (const id of ['A14', 'A15', 'A16', 'A17']) {
    assert.equal(FIXTURES[id].data.clubsError, false, `${id}: clubsError 未关闭会被接口失败回包覆盖`)
  }
})

test('商家入驻与俱乐部创建向导的 dots 保持四段数字形状', () => {
  for (const id of ['C04', 'C05', 'C06', 'C41', 'C42', 'C43']) {
    assert.deepEqual(FIXTURES[id].data.dots, [0, 1, 2, 3], `${id}: dots 不得被生成器伪造成对象数组`)
  }
  const shots = Object.fromEntries(SHOTS.map(shot => [shot.id, shot]))
  assert.equal(FIXTURES.C04.data.name, '城瘾示例店')
  assert.equal(FIXTURES.C04.data.phone, '13800138000')
  assert.equal(FIXTURES.C04.data.canNext, true, 'C04 必须证明资料已填、主按钮可继续的真实表单态')
  assert.equal(FIXTURES.C06.data.canNext, false, 'C06 必须保留必填不完整的禁用态')
  assert.notDeepEqual(FIXTURES.C04.data, FIXTURES.C06.data, 'C04/C06 不得再次退化成同一屏')
  assert.equal(SELECTORS.C04.selector, '.wizard-progress, .wizard-card, .wizard-actions')
  assert.equal(SELECTORS.C04.min, 3)
  for (const id of ['C41', 'C42', 'C43']) assert.equal(shots[id].role, 'club', `${id}: 俱乐部创建只能使用主理人身份`)
  assert.deepEqual(FIXTURES.C41.data.dirOptions, ['轻社交', '城市定向'])
})

// 2026-09-09 C61 期次 picker 的合同随「探店日质量证据」整页删除一并撤。

test('A41 已取消票券由 WXS 消费真实 registrationStatus，而不是旧 status 字段', () => {
  const shots = Object.fromEntries(SHOTS.map(shot => [shot.id, shot]))
  const wxml = read('subpackageMember/signup/index.wxml')
  assert.match(wxml, /item\.registrationStatus\s*==\s*3/)
  assert.match(wxml, /item\.verificationStatus\s*==\s*1/)
  for (const data of [shots.A41.data, FIXTURES.A41.data]) {
    assert.equal(data.ticketList.length, 1)
    assert.equal(data.ticketList[0].registrationStatus, 3)
    assert.equal(data.ticketList[0].verificationStatus, 0)
    assert.ok(data.ticketList[0].wTitle)
    assert.equal(Object.hasOwn(data.ticketList[0], 'status'), false)
  }
})

test('A32/A34 个人首页状态必须注入真实 #profile 组件', () => {
  const shots = Object.fromEntries(SHOTS.map(shot => [shot.id, shot]))
  for (const id of ['A32', 'A34']) {
    assert.equal(shots[id].fixtureTarget, '#profile', `${id}: matrix 仍指向不存在的组件选择器`)
    assert.equal(FIXTURES[id].target, '#profile', `${id}: fixture 未覆盖真实 profile 组件`)
  }
})

test('manifest 记录当次实际注入的 fixtureKeys', () => {
  const runtime = read('scripts/_shot_full_matrix.js')
  assert.match(runtime, /rec\.fixtureKeys = Object\.keys\(inject\)\.sort\(\)/)
})

test('C01 内容态关闭全部加载门', () => {
  assert.equal(FIXTURES.C01.data.dashboardLoading, false)
  assert.equal(FIXTURES.C01.data.joinLoading, false)
  assert.equal(FIXTURES.C01.data.hostLoading, false)
  assert.equal(FIXTURES.C01.data.todoLoading, false)
})

test('A09 游客态与 B13 自由探索态使用各自真实正文分支', () => {
  const shots = Object.fromEntries(SHOTS.map(shot => [shot.id, shot]))
  assert.equal(shots.A09.role, 'guest')
  assert.equal(shots.A09.state, 'normal')
  assert.ok(Array.isArray(FIXTURES.A09.data.list) && FIXTURES.A09.data.list.length > 0)
  assert.equal(FIXTURES.A09.data.loadError, false)
  assert.equal(SELECTORS.A09.selector, 'cy-post-card')
  assert.deepEqual(SELECTORS.A09.forbid, ['cy-error', 'cy-skeleton'])
  assert.equal(SELECTORS.B13.selector, '.fx-pack')
})

test('最终重拍的结构锚点跟当前 WXML 一致', () => {
  assert.equal(SELECTORS.B26.selector, '.setly_li--total, .bmbottom_box')
  assert.equal(SELECTORS.C12.selector, '.tile, .mine-tile, .coop')
  assert.equal(SELECTORS.C12.min, 8)
  assert.equal(SELECTORS.C44.selector, '.cover-wrap, cy-post-card')
  assert.equal(SELECTORS.F18.scrollSelector, '.gn-scroll')
  assert.equal(SELECTORS.F21.selector, 'cy-empty')   // 2026-09-06 裸文字空态收编进 cy-empty
  assert.equal(SELECTORS.F21.min, 2)
  assert.equal(SELECTORS.F24.selector, 'cy-empty')
  assert.equal(SELECTORS.F24.viewNodeMin, 7)
})

test('角色态与编辑器深层证据必须真正进入截图视口', () => {
  const shots = Object.fromEntries(SHOTS.map(shot => [shot.id, shot]))
  assert.ok(Number.isFinite(shots.B20.scrollTop) && shots.B20.scrollTop > 0,
    'B20 必须滚到主办方动作区，否则会与玩家首屏同屏')
  assert.equal(SELECTORS.B20.viewportSelector, '.activity-action')
  assert.ok(Number.isFinite(shots.E17.scrollTop) && shots.E17.scrollTop > 0,
    'E17 必须滚到已注入的章节，否则会与初始表单同屏')
  assert.equal(SELECTORS.E17.scrollSelector, '.slopes-sheet')
  assert.equal(SELECTORS.E17.selector, '.slopes-chapter-block')
  assert.equal(SELECTORS.E17.viewportSelector, '.slopes-chapter-block')
})

test('所有当前注册玩法都有玩家实际游玩填充态截图，不能只拍通用游玩页', () => {
  const shotsById = Object.fromEntries(SHOTS.map((shot) => [shot.id, shot]))
  const dispatcher = read('pages/play/components/playkit/index.js')
  const registryBody = dispatcher.match(/const KIT_TYPES = \[([\s\S]*?)\];/)
  assert.ok(registryBody, '无法从 cy-playkit 读取 KIT_TYPES 注册表')
  const registeredKits = [...registryBody[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
  const playShots = SHOTS.filter((shot) => shot.route.split('?')[0] === '/pages/play/index' && !shot.blocked)
  const coveredKits = new Set(playShots
    .filter((shot) => shot.data && shot.data.show === true && shot.data.kit)
    .map((shot) => shot.data.kit.type))
  for (const type of registeredKits) {
    assert.ok(coveredKits.has(type), `当前注册玩法 ${type} 缺少游玩填充态截图`)
  }

  const validationMethods = new Set(playShots
    .filter((shot) => shot.data && shot.data.screen === 'gamePlay' && shot.data.game)
    .map((shot) => shot.data.game.vm))
  for (const vm of [1, 2, 3, 4, 6]) {
    assert.ok(validationMethods.has(vm), `基础任务 validationMethod=${vm} 缺少游玩填充态截图`)
  }
  for (const id of ['F42', 'F43', 'F44', 'F45', 'F46']) {
    const hints = FIXTURES[id] && FIXTURES[id].data.shownHints
    assert.ok(Array.isArray(hints) && hints.every((hint) => typeof hint === 'string'),
      `${id}: shownHints 只能是可见字符串，不能渲染 [object Object]`)
  }

  const advancedKinds = new Set(playShots
    .filter((shot) => shot.fixtureTarget === '#advancedGame' && shot.data && shot.data.state)
    .flatMap((shot) => ['random', 'branch', 'multiplayer', 'leaderboard']
      .filter((kind) => shot.data.state.config[kind] && shot.data.state.config[kind].enabled)))
  for (const kind of ['random', 'branch', 'multiplayer', 'leaderboard']) {
    assert.ok(advancedKinds.has(kind), `高级玩法 ${kind} 缺少游玩填充态截图`)
  }

  assert.ok(playShots.some((shot) => shot.data && shot.data.gameModule && shot.data.gameModule.sheetShow
    && shot.data.gameModule.nodes && shot.data.gameModule.nodes.length), '俱乐部游戏缺少游玩填充态截图')
  assert.ok(SHOTS.some((shot) => shot.id === 'F17' && !shot.blocked), '俱乐部导演台填充态缺失')
  assert.ok(SHOTS.some((shot) => shot.id === 'F18' && !shot.blocked), '商家游戏节点填充态缺失')
  for (const id of ['F42', 'F43', 'F44', 'F45', 'F46', 'F52']) {
    assert.deepEqual(FIXTURES[id].data, shotsById[id].data,
      `${id}: 游戏页必须精确使用矩阵数据，不能混入生成器占位字段`)
  }
})

test('negative control：正确键改成旧拼写时精确指出 ID 与缺键', () => {
  const broken = JSON.parse(JSON.stringify(FIXTURES))
  broken.A14.data.myClubs[0].nickName = broken.A14.data.myClubs[0].name
  delete broken.A14.data.myClubs[0].name
  assert.throws(() => assertFixtureCompleteness(broken), /A14: fixture 缺少 myClubs\[\]\.name/)
})

test('negative control：分支状态类型漂移时精确指出 ID 与状态键', () => {
  const booleanBroken = JSON.parse(JSON.stringify(FIXTURES))
  booleanBroken.C09.data.error = 'false'
  assert.throws(
    () => assertFixtureCompleteness(booleanBroken),
    /C09: fixture error 必须严格等于 false/,
  )

  const numberBroken = JSON.parse(JSON.stringify(FIXTURES))
  numberBroken.C40.data.step = '1'
  assert.throws(() => assertFixtureCompleteness(numberBroken), /C40: fixture step 必须严格等于 1/)
})

test('F15 A05 图片夹具必须是可渲染 URL，不能把帖子对象塞进 image.src', () => {
  assert.ok(Array.isArray(FIXTURES.A05.data.picList))
  assert.ok(FIXTURES.A05.data.picList.length > 0)
  FIXTURES.A05.data.picList.forEach((url) => {
    assert.equal(typeof url, 'string')
    assert.match(url, /^(?:https?:\/\/|\/)/)
  })
  const broken = JSON.parse(JSON.stringify(FIXTURES.A05.data.picList))
  broken[0] = { title: '错误对象' }
  assert.throws(() => broken.forEach((url) => {
    assert.equal(typeof url, 'string')
  }))
})

test('F15 A17/A23/D04 内容态必须喂给真实字段并校验可见文字', () => {
  const shots = Object.fromEntries(SHOTS.map(shot => [shot.id, shot]))

  assert.equal(shots.A17.data.myClubs.length, 0)
  assert.equal(shots.A17.data.nearbyClubs[0].name, '外滩夜行俱乐部')
  assert.equal(FIXTURES.A17.data.nearbyClubs[0].name, '外滩夜行俱乐部')
  assert.ok(SELECTORS.A17.textIncludes.includes('外滩夜行俱乐部'))

  assert.deepEqual(shots.A23.data.searchHistory, ['外滩', '夜行'])
  assert.deepEqual(FIXTURES.A23.data.searchHistory, ['外滩', '夜行'])
  assert.ok(SELECTORS.A23.textIncludes.includes('外滩'))
  assert.ok(SELECTORS.A23.textIncludes.includes('示例灵感一'))

  assert.equal(shots.D04.data.list[0].actualPaidAmount, '69.00')
  assert.equal(FIXTURES.D04.data.list[0].actualPaidAmount, '69.00')
  assert.ok(SELECTORS.D04.textIncludes.includes('69.00'))
  assert.ok(SELECTORS.D04.textIncludes.includes('进行中'))

  const runner = read('scripts/_shot_full_matrix.js')
  assert.match(runner, /want\.textIncludes/)
  assert.match(runner, /rec\.textFailure/)
})
