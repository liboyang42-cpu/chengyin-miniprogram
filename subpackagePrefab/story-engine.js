const SCENES = [
  'prologue', 'register', 'boot', 'walk', 'hall', 'birth', 'dream1',
  'learning', 'dream2', 'career', 'work', 'dream3', 'flow',
]

function createState() {
  return {
    version: 2,
    scene: SCENES[0],
    step: 0,
    profile: { name: '', place: '', gender: '', dream: '', avatar: '' },
    hp: 10,
    luck: 2,
    skills: { rule: 2, window: 2, heart: 2, precision: 1 },
    instability: 0,
    walkProgress: 0,
    dreams: 0,
    thoughts: [],
    observations: [],
    picks: {},
    photos: {},
    note: '',
    sticker: null,
    job: '',
    synced: false,
  }
}

function advance(state) {
  const current = SCENES.indexOf(state.scene)
  if (current < 0 || current === SCENES.length - 1) return state
  return Object.assign({}, state, { scene: SCENES[current + 1], step: 0 })
}

function patch(state, values) {
  const next = Object.assign({}, state, values)
  if (values.profile) next.profile = Object.assign({}, state.profile, values.profile)
  return next
}

function choose(state, key, value) {
  return Object.assign({}, state, { picks: Object.assign({}, state.picks, { [key]: value }) })
}

function photo(state, key, value) {
  return Object.assign({}, state, { photos: Object.assign({}, state.photos, { [key]: value }) })
}

function setStep(state, step) {
  return Object.assign({}, state, { step: Math.max(0, Number(step) || 0) })
}

function observe(state, where, text) {
  const value = String(text || '').trim()
  if (!value || state.observations.some((item) => item.text === value)) return state
  return Object.assign({}, state, { observations: state.observations.concat({ where, text: value }) })
}

function classify(text, groups, fallback) {
  const value = String(text || '')
  const found = groups.find((item) => item[0].test(value))
  return found ? found[1] : fallback
}

function applyProfile(state, profile) {
  const value = Object.assign({}, state.profile, profile || {})
  const placeSkill = classify(value.place, [
    [/想不起|不记得|不知道|忘/, 'precision'],
    [/县|镇|村|乡|山|海边/, 'window'],
    [/上海|北京|广州|深圳|市|城/, 'rule'],
  ], 'window')
  const dreamSkill = classify(value.dream, [
    [/宇航|科学|侦探|工程|程序|研究|天文|数学|机器|发明|电脑/, 'precision'],
    [/画|作家|写|音乐|歌|演|导演|诗|摄影|设计|跳舞/, 'heart'],
    [/医生|老师|警察|律师|第一|公务员|军|会计|老板|法官/, 'rule'],
    [/旅行|环游|酒吧|自由|流浪|远方|海|山|不知道|没想|很远/, 'window'],
  ], 'heart')
  const skills = Object.assign({}, state.skills)
  skills[placeSkill] += 1
  skills[dreamSkill] += 1
  return Object.assign({}, state, { profile: value, skills })
}

function check(state, skill, dc, rolls) {
  const source = Array.isArray(rolls) ? rolls.slice(0, 2) : [rolls, 1]
  const dice = source.map((value) => Math.max(1, Math.min(6, Number(value) || 1)))
  while (dice.length < 2) dice.push(1)
  const roll = dice[0] + dice[1]
  const score = roll + Number(state.skills[skill] || 0)
  return { state, dice, roll, score, ok: score >= Number(dc || 0) }
}

function photoCount(state) {
  return Object.keys(state.photos || {}).filter((key) => !!state.photos[key]).length
}

function gain(state, change) {
  const thought = change && change.thought
  return Object.assign({}, state, {
    hp: Math.max(0, Math.min(10, state.hp + Number(change.hp || 0))),
    luck: Math.max(0, Math.min(4, state.luck + Number(change.luck || 0))),
    dreams: Math.max(0, state.dreams + Number(change.dreams || 0)),
    thoughts: thought && state.thoughts.indexOf(thought) < 0
      ? state.thoughts.concat(thought) : state.thoughts.slice(),
  })
}

function restore(raw) {
  try {
    const value = JSON.parse(raw)
    if (!value || SCENES.indexOf(value.scene) < 0) return createState()
    if (value.version === 1) return Object.assign(createState(), value, { version: 2, step: 0 })
    if (value.version !== 2) return createState()
    return Object.assign(createState(), value)
  } catch (error) {
    return createState()
  }
}

function archiveSession(session) {
  if (session && session.activityId) return { type: 'activity', id: String(session.activityId) }
  if (session && session.topicId) return { type: 'topic', id: String(session.topicId) }
  return { type: 'preview', id: 'preview' }
}

function archiveKey(session) {
  const memberId = session && session.memberId
  if (memberId === null || memberId === undefined || memberId === '') return ''
  const source = archiveSession(session)
  return 'prefab_life_v3_member_' + memberId + '_' + source.type + '_' + source.id
}

function loadArchive(storage, session) {
  const key = archiveKey(session)
  if (!key) return createState()
  const saved = storage.getStorageSync(key)
  if (saved) return restore(saved)
  return createState()
}

function saveArchive(storage, session, state) {
  const key = archiveKey(session)
  if (key) storage.setStorageSync(key, JSON.stringify(state))
}

function clearArchive(storage, session) {
  const key = archiveKey(session)
  if (key) storage.removeStorageSync(key)
}

module.exports = {
  SCENES, createState, advance, patch, choose, photo, setStep, observe,
  applyProfile, check, photoCount, gain, restore,
  archiveKey, loadArchive, saveArchive, clearArchive,
}
