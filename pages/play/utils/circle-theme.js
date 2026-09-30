const ROLE_LABELS = {
  EXPERIENCE: '主体验',
  REST: '补给/休息',
  EXPRESSION: '社交/表达',
}

const PRIMARY_THEME_CODES = ['FITNESS', 'MIDLIFE', 'DATE', 'FRIENDS', 'SHANGHAI']

function candidate(code, name, merchant, supply, role) {
  return { code, name, merchant, supply, role, roleLabel: ROLE_LABELS[role] || role }
}

const THEMES = {
  FITNESS: {
    name: '一起动起来',
    subtitle: '不办年卡，和朋友试几种更容易坚持的运动生活。',
    recommended: ['F1', 'F5', 'F6', 'F7'],
    candidates: [
      candidate('F1', '身体起点', '健身房、私教工作室', '单次体测或私教体验课', 'EXPERIENCE'),
      candidate('F2', '出拳解压', '拳击、搏击、泰拳馆', '零基础体验课', 'EXPERIENCE'),
      candidate('F3', '柔韧恢复', '瑜伽、普拉提、拉伸馆', '入门小班或单次课', 'REST'),
      candidate('F4', '一起攀或一起打', '攀岩馆、球类俱乐部', '体验票、场地票或公开课', 'EXPERIENCE'),
      candidate('F5', '城市开跑', '跑团、骑行俱乐部', '公开跑、公开骑行或常规活动', 'EXPRESSION'),
      candidate('F6', '运动补给', '轻食店、健康餐、果昔店', '轻食、饮品或正常套餐', 'REST'),
      candidate('F7', '装备试一试', '运动服装、跑鞋、户外店', '试穿、足型测试或单品购买', 'EXPRESSION'),
      candidate('F8', '放松一下', '运动恢复、拉伸、按摩店', '单次恢复或放松服务', 'REST'),
    ],
    interactions: [
      { stage: 'PRE_CHOICE', title: '出发前', prompt: '今天最想长期坚持哪一项？', source: 'selectedCandidates' },
      { stage: 'POST_CHOICE', title: '完成后', prompt: '现在最想长期坚持哪一项？', source: 'selectedCandidates' },
    ],
  },
  MIDLIFE: {
    name: '四十正当时',
    subtitle: '暂时放下妈妈的任务，和同龄朋友留一点时间给自己。',
    recommended: ['M1', 'M2', 'M3', 'M7'],
    candidates: [
      candidate('M1', '安静喝一杯', '咖啡馆、茶馆', '饮品、下午茶或正常座位时段', 'REST'),
      candidate('M2', '今天穿给自己', '女装、鞋包、买手店', '试穿、搭配建议或正常商品', 'EXPRESSION'),
      candidate('M3', '身体舒展开', '瑜伽、普拉提、舞蹈工作室', '入门小班或单次课', 'EXPERIENCE'),
      candidate('M4', '状态焕新', '美发、美甲、护肤、造型店', '单次服务', 'EXPRESSION'),
      candidate('M5', '重新读点自己的', '书店、文化空间', '书单、讲座或正常活动', 'EXPERIENCE'),
      candidate('M6', '做一件小作品', '花店、陶艺、手作工作室', '常规体验课', 'EXPERIENCE'),
      candidate('M7', '留一张现在的照片', '摄影馆、写真馆、自拍馆', '单人或朋友合照服务', 'EXPRESSION'),
      candidate('M8', '晚一点回家', '餐厅、小酒馆、酒吧', '晚餐、饮品或正常套餐', 'REST'),
    ],
    interactions: [
      { stage: 'SELF_MOMENT', title: '一句话记忆', prompt: '今天哪一刻最像我自己？', input: 'text' },
    ],
  },
  DATE: {
    name: '今天认真约会',
    subtitle: '不只是吃饭看电影，重新认识一次身边的人。',
    recommended: ['C1', 'C2', 'C5', 'C7'],
    candidates: [
      candidate('C1', '先坐下来聊', '咖啡馆、茶馆', '双人饮品或正常消费', 'REST'),
      candidate('C2', '替对方选一件', '服装、饰品、眼镜、买手店', '商品或正常试戴试穿', 'EXPRESSION'),
      candidate('C3', '选一种彼此的味道', '香氛、护肤、生活方式店', '试香或正常商品', 'EXPRESSION'),
      candidate('C4', '带一束回家', '花店、植物店', '花束或小型商品', 'EXPRESSION'),
      candidate('C5', '一起做一件东西', '陶艺、银饰、烘焙、绘画工作室', '双人或单人常规体验', 'EXPERIENCE'),
      candidate('C6', '吃一个甜点', '甜品店、烘焙店', '甜点或饮品', 'REST'),
      candidate('C7', '留下今天', '自拍馆、照相馆、拍贴店', '拍摄服务', 'EXPERIENCE'),
      candidate('C8', '最后一杯', '酒吧、小酒馆、无酒精酒吧', '饮品或正常座位', 'REST'),
    ],
    interactions: [{
      stage: 'QUESTION_CARD', title: '约会问题卡', prompt: '一起选一张，慢慢聊。',
      choices: [
        { value: 'Q1', label: '最近一次觉得对方很可爱的瞬间？' },
        { value: 'Q2', label: '最近一次被对方照顾到是什么时候？' },
        { value: 'Q3', label: '下一次想一起认真做什么？' },
      ],
    }],
  },
  FRIENDS: {
    name: '朋友别只在群里',
    subtitle: '三五好友的一次不赶场见面局。',
    recommended: ['P1', 'P3', 'P4', 'P8'],
    candidates: [
      candidate('P1', '集合第一杯', '咖啡馆、茶饮店', '饮品或正常套餐', 'REST'),
      candidate('P2', '一起吃点好的', '餐厅、轻食、地方小吃', '菜品或正常套餐', 'REST'),
      candidate('P3', '朋友互相挑', '服装、古着、饰品店', '商品和正常试穿', 'EXPRESSION'),
      candidate('P4', '玩一局', '桌游店、棋牌空间', '小时票或常规项目', 'EXPERIENCE'),
      candidate('P5', '唱一会儿', 'KTV、音乐空间', '包间或开放麦活动', 'EXPERIENCE'),
      candidate('P6', '一起做一件', '陶艺、画室、烘焙、手作店', '常规体验', 'EXPERIENCE'),
      candidate('P7', '拍一张新的', '自拍馆、拍贴店、摄影馆', '多人拍摄服务', 'EXPRESSION'),
      candidate('P8', '最后一轮', '酒吧、小酒馆、无酒精酒吧', '饮品或正常桌位', 'REST'),
    ],
    interactions: [
      { stage: 'PRE_WISH', title: '出发前', prompt: '今天最想做哪件事？', source: 'selectedCandidates' },
      { stage: 'NEXT_PICK', title: '结束后', prompt: '共同投一个“下次还会来”。', source: 'selectedCandidates' },
    ],
  },
  SHANGHAI: {
    name: '上海生活切片',
    subtitle: '不打卡地标，和朋友体验几种有上海味道的普通生活。',
    recommended: ['S1', 'S2', 'S3', 'S8'],
    candidates: [
      candidate('S1', '上海早点', '早餐店、小吃店、烘焙店', '早餐或招牌单品', 'REST'),
      candidate('S2', '城市咖啡时间', '咖啡馆、烘焙咖啡店', '咖啡或正常套餐', 'REST'),
      candidate('S3', '穿一点上海', '本地服装、古着、旗袍或设计店', '商品和正常试穿', 'EXPRESSION'),
      candidate('S4', '翻几页城市', '书店、杂志店、文化空间', '书刊或正常活动', 'EXPERIENCE'),
      candidate('S5', '带走一件本地设计', '文创、设计零售、手作店', '本地设计商品', 'EXPRESSION'),
      candidate('S6', '吃一口本地味道', '本帮菜、小吃、甜品店', '菜品或正常套餐', 'REST'),
      candidate('S7', '留下一张街头感', '自拍馆、拍贴店、摄影服务', '拍摄服务', 'EXPERIENCE'),
      candidate('S8', '上海夜里见', '酒吧、小酒馆、现场音乐空间', '饮品、演出或正常座位', 'EXPERIENCE'),
    ],
    interactions: [{
      stage: 'CITY_KEYWORDS', title: '我们的上海', prompt: '为完成的商家选城市关键词。',
      choices: ['味道', '穿搭', '声音', '夜色', '人情'], perRecordedOffer: true,
    }],
  },
}

function themeOf(themeCode) {
  return THEMES[String(themeCode || '').toUpperCase()] || null
}

function validateSelection(themeCode, candidateCodes) {
  const theme = themeOf(themeCode)
  if (!theme) return { ok: false, message: '这不是可配置的圈层主题' }
  const selected = Array.from(new Set((candidateCodes || []).map(String)))
  if (selected.length < 3 || selected.length > 4) {
    return { ok: false, message: '请选择3—4个商家角色' }
  }
  const byCode = new Map(theme.candidates.map((item) => [item.code, item]))
  if (selected.some((code) => !byCode.has(code))) {
    return { ok: false, message: '所选角色不属于这个主题' }
  }
  const roles = new Set(selected.map((code) => byCode.get(code).role))
  const missing = Object.keys(ROLE_LABELS).filter((role) => !roles.has(role))
  if (missing.length) {
    return { ok: false, message: '还需覆盖' + missing.map((role) => ROLE_LABELS[role]).join('、') }
  }
  return { ok: true, message: '' }
}

function interactionsFor(themeCode, selectedCodes) {
  const theme = themeOf(themeCode)
  if (!theme) return []
  const selected = new Set(selectedCodes || [])
  const selectedCandidates = theme.candidates.filter((item) => selected.has(item.code))
  return theme.interactions.map((item) => Object.assign({}, item, {
    choices: item.source === 'selectedCandidates'
      ? selectedCandidates.map((candidate) => ({ value: candidate.code, label: candidate.name }))
      : item.choices,
  }))
}

module.exports = {
  ROLE_LABELS,
  PRIMARY_THEME_CODES,
  THEMES,
  themeOf,
  validateSelection,
  interactionsFor,
}
