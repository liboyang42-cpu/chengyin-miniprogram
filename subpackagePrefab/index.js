const app = getApp()
const story = require('./story-engine.js')
const { resolveMenuChrome } = require('../utils/nav-safe-area.js')
const { readReducedMotion } = require('../utils/motion-preference.js')
const cyToast = require('../utils/toast.js')
const modal = require('../utils/modal.js')

const JOBS = [
  { name: '设计师', sub: '把东西做得好看', id: 'designer', desk: '一块数位板，两块屏幕', task: '把这个方案改得高大上一点。', ignored: '方案没有被否定。只是——不被采用。' },
  { name: '程序员', sub: '让机器听懂人话', id: 'coder', desk: '一台装好环境的电脑，键盘上还留着上一个人的指纹', task: '这个需求今天上线。', ignored: '你写的代码被回滚了。群里没有人说为什么。' },
  { name: '医生', sub: '把人治好', id: 'doctor', desk: '一间诊室，门口的号已经排满', task: '下一位。', ignored: '你写的会诊意见，被主任划掉了一行。' },
  { name: '老师', sub: '站到讲台上', id: 'teacher', desk: '一张讲台，和一排比记忆里更小的桌子', task: '这周把进度赶上。', ignored: '你设计的那节课，被换回了标准教案。' },
  { name: '销售', sub: '让人点头', id: 'sales', desk: '一部电话，和一张打满勾的客户名单', task: '回复那个客户，要客气，但要拒绝他。', ignored: '客户选了报价更高的那家。' },
  { name: '会计', sub: '让数字对上', id: 'accountant', desk: '一张表格。横轴是时间，纵轴是指标', task: '整理这周的数据。', ignored: '你指出的那处数字，再也没有人问起。' },
]
const BOOT_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'].map((row) => row.split(''))
const BOOT_TARGET = 'hello world'
const MAP_NOTES = [
  { id: 'sunny', who: '晴', text: '一个老人在等公交，等了很久。' },
  { id: 'k', who: 'K', text: '玻璃门上映着我自己。' },
]

const asset = (name) => '/subpackagePrefab/assets/' + name + '.webp'

function dreamCards(scene, state) {
  const userWindow = state.photos.window || asset('win')
  const userPhone = state.photos.phone || asset('phone')
  const avatar = state.profile.avatar || asset('corridor')
  if (scene === 'dream1') return [
    ['梦里的我在一条无尽的白色走廊，两边是一扇又一扇的门。', 'corridor'],
    ['我看到宇宙微波辐射的噪声图。', 'cosmic'], ['恒星坍缩，行星偏移轨道。', 'orbit'],
    ['看到恐龙灭绝的化石记录。', 'fossil'], ['金字塔开始建造，奴隶名单，工期延误。', 'pyramid'],
    ['我看到列宁格勒。', 'leningrad'], ['我看到原子弹试爆的光。', 'flash'],
    ['我看到贝多芬的乐谱，一遍一遍被转录……', 'score'],
    ['最后一扇门后面，是今天下午你自己看过的那个窗外。', userWindow],
    ['信息不断输入，我开始做梦。', 'corridor'],
  ]
  if (scene === 'dream2') return [
    ['我看到地球形成，水覆盖表面。', 'ocean'], ['单细胞分裂，没有目的，只是重复。', 'cells'],
    ['语言分化，同一个意思被反复误解。', 'script'], ['边界被画在地图上，线条越来越粗。', 'map'],
    ['征兵名单，年龄集中在十八到二十五。', 'soldiers'], ['法庭判决，有人站起，有人坐下。', 'court'],
    ['工厂流水线，动作被标准化。', 'factory'], ['家庭录像带，生日、婚礼、一次次重拍。', 'vhs'],
    ['我又一次穿过那扇窗。', userWindow], ['聊天记录，已读未回。', 'chat'],
    ['搜索关键词：如何成功，如何变瘦，如何不痛苦。', 'search'],
    ['心率监测曲线，在凌晨三点突然升高。', 'heart'],
  ]
  if (scene === 'dream3') return [
    ['意义是什么？', userWindow], ['爱是否真实？', userPhone], ['我会被记住吗？', avatar],
    ['没有人回答。走廊尽头的那扇门，今天是开着的。', 'corridor'],
  ]
  return []
}

const ENDINGS = [
  ['标准版本', '“你看，我现在站得直直的，双手贴在裤缝边。”', '什么都没有偏离。你过完了被安排好的一生。', '41%'],
  ['交接', '“接手的是一个更年轻的你。他站得比你更直。”', '在第三章之后，“咔哒”了很多次。', '17%'],
  ['边界', '“世界允许你存在，却不会完全接纳你。”', '你靠近过很多次。但没有推开最后那道边界。', '19%'],
  ['共处', '“他无所住，生其心。”', '看见足够多的人，读完所有的梦。然后选择留下。', '12%'],
  ['出走', '“你看。我现在站得直直的。”——然后它走出了屏幕。', '推开最后那道边界。也需要你真的看过这座城市。', '6%'],
  ['回收', '“V1.9 · 开始吧。”', '推开了边界，但没有人记得你。', '5%'],
]

function request(url, method, data) {
  return new Promise((resolve) => app.sendRequest({
    url, method, data, hideLoading: true,
    success: (res) => resolve(res || {}),
    successStatusAbnormal: (res) => resolve(res || { code: 'http_error' }),
    fail: () => resolve({ code: 'fail', msg: '网络异常，请重试' }),
  }))
}

Page({
  data: {
    chrome: { actionTop: 28, contentTop: 76 }, privacyGateShow: false,
    reducedMotion: false,
    loading: true, error: '', view: 'story', scene: 'prologue', sceneStep: 0,
    profile: {}, hp: 10, luck: 2, dreams: 0, thoughts: [], job: '',
    title: '开始吧', kicker: '预制人生 · 序章', cosmos: '无',
    walkProgress: 0, walkLeft: 420, routeChoice: false,
    bootChars: [], bootGhost: BOOT_TARGET, bootNext: 'h', bootRows: BOOT_ROWS,
    bootTimerWidth: 100, bootMessage: '', bootError: false, bootDone: false,
    countText: '', quizIndex: 0, registerStep: 0, teacherSeconds: 8,
    dreamCards: [], dreamIndex: 0, dreamReady: false, wakeProgress: 0, isDream: false, jobs: JOBS, endings: ENDINGS, showEndings: false,
    signChoice: false, noteText: '', soundOn: true, holding: false, holdProgress: 0,
    check: { show: false, dice: [1, 1], roll: 2, score: 0, dc: 0, ok: false, label: '' },
    stickerMode: false, photoCount: 0, syncing: false, syncError: '',
    mapBubble: { show: false },
    stationName: '上海城市规划展示馆', stationAddress: '人民大道 100 号',
  },

  onLoad(options) {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    let chrome = this.data.chrome
    try { chrome = resolveMenuChrome(info, wx.getMenuButtonBoundingClientRect()) } catch (error) {}
    this._session = options.activityId ? { activityId: options.activityId } : { topicId: options.topicId || '' }
    this._mock = options.mock === '1' && app.isDevEnv && app.isDevEnv()
    this._archive = this._currentArchiveSession()
    this._archiveKey = story.archiveKey(this._archive)
    this._state = story.loadArchive(wx, this._archive)
    this._mapNotes = MAP_NOTES.map((item) => Object.assign({}, item))
    this._quizScore = 0
    this.setData({ chrome, reducedMotion: readReducedMotion() })
    this._sync()
    if (this._mock) { this._nodes = [{ nodeId: 'preview', name: '上海城市规划展示馆', address: '人民大道 100 号' }]; this.setData({ loading: false }); return }
    this._loadRoute()
  },

  onShow() {
    const nextArchive = this._currentArchiveSession()
    const nextKey = story.archiveKey(nextArchive)
    if (nextKey === this._archiveKey) return
    this._archive = nextArchive
    this._archiveKey = nextKey
    this._state = story.loadArchive(wx, nextArchive)
    if (this._mapNotes) this._sync()
  },

  onUnload() {
    if (this._walkTimer) clearInterval(this._walkTimer)
    if (this._holdTimer) clearInterval(this._holdTimer)
    if (this._dreamTimer) clearInterval(this._dreamTimer)
    if (this._wakeTimer) clearInterval(this._wakeTimer)
    if (this._dreamExitTimer) clearTimeout(this._dreamExitTimer)
    if (this._bootTimer) clearInterval(this._bootTimer)
    if (this._bootResetTimer) clearTimeout(this._bootResetTimer)
    if (this._teacherTimer) clearInterval(this._teacherTimer)
    if (this._audio && this._audio.close) this._audio.close()
  },

  showPrivacyGate() { this.setData({ privacyGateShow: true }) },
  onPrivacyGateSettled() { this.setData({ privacyGateShow: false }) },

  _loadRoute() {
    if (!this._session.topicId && !this._session.activityId) {
      this.setData({ loading: false, error: '场次信息缺失，请从票夹重新进入' })
      return
    }
    request('/api/play/nodes', 'GET', this._session).then((res) => {
      if (res.code != 200 && res.code != '200') {
        this.setData({ loading: false, error: res.msg || '路线没加载出来，请稍后重试' })
        return
      }
      const nodes = (res.data && res.data.nodes) || []
      this._nodes = nodes
      const first = nodes[0] || {}
      this.setData({
        loading: false, error: '',
        stationName: first.name || '上海城市规划展示馆',
        stationAddress: first.address || '人民大道 100 号',
      })
    })
  },

  _currentArchiveSession() {
    const memberId = app.getUserID && app.getUserID()
    return Object.assign({}, this._session, { memberId })
  },

  _save() {
    const nextArchive = this._currentArchiveSession()
    const nextKey = story.archiveKey(nextArchive)
    if (!nextKey || (this._archiveKey && nextKey !== this._archiveKey)) return
    this._archive = nextArchive
    this._archiveKey = nextKey
    story.saveArchive(wx, nextArchive, this._state)
  },

  _sync() {
    const s = this._state
    const meta = this._sceneMeta(s.scene)
    const jobMeta = JOBS.find((item) => item.name === s.job) || JOBS[0]
    const cards = dreamCards(s.scene, s).map((item) => ({
      text: item[0],
      src: /^(?:https?:|wxfile:|\/)/.test(item[1]) ? item[1] : asset(item[1]),
    }))
    this.setData({
      scene: s.scene, profile: s.profile, hp: s.hp, luck: s.luck,
      dreams: s.dreams, thoughts: s.thoughts, picks: s.picks, photos: s.photos, job: s.job, sticker: s.sticker,
      sceneStep: s.step || 0, registerStep: s.scene === 'register' ? (s.step || 0) : 0,
      walkProgress: s.walkProgress || 0,
      walkLeft: Math.round(420 * (1 - (s.walkProgress || 0) / 100)),
      avatarInitial: String(s.profile.name || '我').slice(0, 1),
      jobImage: 'j_' + ({ 程序员: 'coder', 医生: 'doctor', 老师: 'teacher', 销售: 'sales', 会计: 'accountant' }[s.job] || 'designer'),
      jobMeta,
      dreamCards: cards,
      isDream: /^dream/.test(s.scene),
      photoCount: story.photoCount(s),
      noteText: s.note || '',
      kicker: meta.kicker, title: meta.title, cosmos: meta.cosmos,
      cosmosClass: { 无: 'void', 醒来: 'awake', 城市: 'city', 午后: 'afternoon', 粉笔灰: 'chalk', 静止: 'hush', 眨眼: 'grown', 日光灯: 'office' }[meta.cosmos],
    })
    if (/^dream/.test(s.scene) && this._dreamScene !== s.scene) this._startDream(s.scene, cards.length)
    if (s.scene === 'boot' && this._bootScene !== 'boot') this._prepareBoot()
    if (s.scene !== 'boot' && this._bootScene) this._clearBoot()
    if (s.scene === 'learning' && Number(s.step) === 2 && !this._teacherTimer) this._startTeacherTimer()
    if ((s.scene !== 'learning' || Number(s.step) !== 2) && this._teacherTimer) this._stopTeacherTimer()
    this._save()
  },

  _startDream(scene, length) {
    if (this._dreamTimer) clearInterval(this._dreamTimer)
    if (this._dreamExitTimer) clearTimeout(this._dreamExitTimer)
    this._dreamScene = scene
    this.setData({ dreamIndex: 0, dreamReady: length <= 1, wakeProgress: 0 })
    if (length <= 1) return
    this._dreamTimer = setInterval(() => {
      const next = this.data.dreamIndex + 1
      if (next >= length - 1) {
        clearInterval(this._dreamTimer); this._dreamTimer = null
        this.setData({ dreamIndex: length - 1, dreamReady: true }); this._feel('light')
        this._dreamExitTimer = setTimeout(() => this._finishDream(), 2200)
        return
      }
      this.setData({ dreamIndex: next }); this._feel('light')
    }, 1800)
  },

  wakeStart() {
    if (!this.data.isDream || this._wakeTimer) return
    const started = Date.now()
    this._wakeTimer = setInterval(() => {
      const wakeProgress = Math.min(100, Math.round((Date.now() - started) / 15))
      this.setData({ wakeProgress })
      if (wakeProgress >= 100) {
        clearInterval(this._wakeTimer); this._wakeTimer = null
        this._finishDream()
      }
    }, 50)
  },

  _prepareBoot() {
    this._clearBoot()
    this._bootScene = 'boot'
    this._bootText = ''
    this.setData({ bootChars: [], bootGhost: BOOT_TARGET, bootNext: 'h', bootTimerWidth: 100, bootMessage: '', bootError: false, bootDone: false })
  },
  _clearBoot() {
    if (this._bootTimer) clearInterval(this._bootTimer)
    if (this._bootResetTimer) clearTimeout(this._bootResetTimer)
    this._bootTimer = this._bootResetTimer = null
    this._bootStarted = 0
    this._bootScene = ''
  },
  _bootRetry(message) {
    if (this._bootTimer) clearInterval(this._bootTimer)
    this._bootTimer = null
    this.setData({ bootMessage: message + ' · 重新输入', bootError: true })
    this._feel('heavy')
    this._bootResetTimer = setTimeout(() => {
      this._bootStarted = 0
      this._bootText = ''
      this.setData({ bootChars: [], bootGhost: BOOT_TARGET, bootNext: 'h', bootTimerWidth: 100, bootMessage: '', bootError: false })
    }, 280)
  },
  bootKey(e) {
    if (this.data.bootDone || this._bootResetTimer) return
    const key = e.currentTarget.dataset.key
    let typed = this._bootText || ''
    if (key === 'back') {
      typed = typed.slice(0, -1)
      this._bootText = typed
      this.setData({ bootChars: typed.split(''), bootGhost: BOOT_TARGET.slice(typed.length), bootNext: BOOT_TARGET[typed.length] || '' })
      return
    }
    if (!this._bootStarted) {
      this._bootStarted = Date.now()
      this._bootTimer = setInterval(() => {
        const left = Math.max(0, 10 - (Date.now() - this._bootStarted) / 1000)
        this.setData({ bootTimerWidth: left * 10 })
        if (left <= 0) this._bootRetry('超时')
      }, 100)
    }
    typed += key
    this._tone(880, 0.05)
    if (typed[typed.length - 1] !== BOOT_TARGET[typed.length - 1]) {
      this._bootText = typed
      this.setData({ bootChars: typed.split(''), bootGhost: BOOT_TARGET.slice(typed.length), bootNext: BOOT_TARGET[typed.length] || '' })
      this._bootRetry('打错了')
      return
    }
    this._bootText = typed
    this.setData({ bootChars: typed.split(''), bootGhost: BOOT_TARGET.slice(typed.length), bootNext: BOOT_TARGET[typed.length] || '' })
    if (typed !== BOOT_TARGET) return
    const fast = Date.now() - this._bootStarted < 6000
    if (this._bootTimer) clearInterval(this._bootTimer)
    this._bootTimer = null
    if (fast) this._state = story.patch(this._state, { skills: Object.assign({}, this._state.skills, { precision: this._state.skills.precision + 1 }) })
    this.setData({ bootDone: true, bootTimerWidth: 0, bootMessage: fast ? '输入完成 · 很快' : '输入完成' })
    this._feel('light')
    this._bootResetTimer = setTimeout(() => { this._bootResetTimer = null; this._advance() }, 900)
  },
  wakeEnd() {
    if (!this._wakeTimer) return
    clearInterval(this._wakeTimer); this._wakeTimer = null
    this.setData({ wakeProgress: 0 })
  },

  _sceneMeta(scene) {
    const meta = {
      prologue: ['预制人生 · 序章', '开始吧', '无'],
      register: ['新生儿登记', '我问，你答。', '醒来'],
      boot: ['系统启动', 'hello world', '醒来'],
      walk: ['第 1 站', '去看一座被缩小的城市', '城市'],
      hall: ['在现场', '拍下展示馆的招牌', '城市'],
      birth: ['01 出生', '被确认的幸运', '午后'],
      dream1: ['第一个梦', '信息不断输入，我开始做梦。', '午后'],
      learning: ['02 学习', '标准答案', '粉笔灰'],
      dream2: ['第二个梦', '门更多了。', '静止'],
      career: ['好像只是眨了一下眼', '长大了，你希望做什么？', '眨眼'],
      work: ['03 工作', '被安排好的位置', '日光灯'],
      dream3: ['第三个梦', '不再是画面。是三个问题。', '无'],
      flow: ['原型到这里 · 1 / 4', '你走过的路，和别人走过的路', '无'],
    }[scene]
    return { kicker: meta[0], title: meta[1], cosmos: meta[2] }
  },

  toggleMap() { this.setData({ view: this.data.view === 'story' ? 'map' : 'story' }) },
  back() {
    if (getCurrentPages().length > 1) wx.navigateBack()
    else wx.switchTab({ url: '/pages/index/index' })
  },
  retry() { this.setData({ loading: true, error: '' }); this._loadRoute() },
  toggleSound() {
    const soundOn = !this.data.soundOn
    this.setData({ soundOn })
    if (soundOn) this._tone(660, 0.12)
  },

  _tone(freq, seconds) {
    if (!this.data.soundOn || !wx.createWebAudioContext) return
    try {
      const ctx = this._audio || (this._audio = wx.createWebAudioContext())
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      gain.gain.value = 0.035
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + seconds)
    } catch (error) {}
  },

  _feel(type) {
    if (wx.vibrateShort) wx.vibrateShort({ type: type || 'light' })
    this._tone(type === 'heavy' ? 160 : 760, type === 'heavy' ? 0.18 : 0.07)
  },

  primary() {
    const scene = this._state.scene
    if (scene === 'prologue') return this._advance()
    if (scene === 'walk') return this._startWalk()
    if (scene === 'flow') return this._syncCompletion()
  },

  _advance() { this._state = story.advance(this._state); this.setData({ dreamIndex: 0 }); this._feel('light'); this._sync() },

  onCountInput(e) { this.setData({ countText: e.detail.value }) },
  profileInput(e) {
    this._state = story.patch(this._state, { profile: { [e.currentTarget.dataset.key]: e.detail.value } })
    this._sync()
  },
  registerTextNext(e) {
    const key = e.currentTarget.dataset.key
    const value = String(this._state.profile[key] || '').trim()
    if (!value) return cyToast(key === 'name' ? '先写下你的名字' : key === 'place' ? '写下出生地' : '写下长大想做什么')
    this._state = story.patch(this._state, { profile: { [key]: value } })
    this._state = story.setStep(this._state, Number(this._state.step) + 1)
    this._feel('light')
    this._sync()
  },
  registerChip(e) {
    const key = e.currentTarget.dataset.key
    this._state = story.patch(this._state, { profile: { [key]: e.currentTarget.dataset.value } })
    this._state = story.setStep(this._state, Number(this._state.step) + 1)
    this._feel('light')
    this._sync()
  },
  chooseAvatar() {
    this._pickPhoto('avatar', (path) => {
      this._state = story.patch(this._state, { profile: { avatar: path } })
      this._finishRegistration()
      this._sync()
    })
  },
  skipAvatar() { this._finishRegistration(); this._sync() },
  _finishRegistration() {
    if (Number(this._state.step) !== 4) return
    this._state = story.applyProfile(this._state, this._state.profile)
    this._state = story.setStep(this._state, 5)
    this._feel('heavy')
  },
  submitProfile() {
    if (Number(this._state.step) !== 5) return
    this._advance()
  },
  _startWalk() {
    if (this._walkTimer || this.data.routeChoice || this.data.signChoice || this.data.walkProgress >= 100) return
    this._walkTimer = setInterval(() => {
      const next = Math.min(100, this.data.walkProgress + 2)
      this._state = story.patch(this._state, { walkProgress: next })
      this.setData({ walkProgress: next, walkLeft: Math.round(420 * (1 - next / 100)) })
      if (next === 50 && this._state.picks.route == null) {
        clearInterval(this._walkTimer); this._walkTimer = null; this._save(); this._feel('heavy'); this.setData({ routeChoice: true })
      }
      if (next === 74 && !this._state.picks.signAsked) {
        clearInterval(this._walkTimer); this._walkTimer = null
        this._state = story.choose(this._state, 'signAsked', true)
        this._save(); this.setData({ signChoice: true })
      }
      if (next === 100) { clearInterval(this._walkTimer); this._walkTimer = null; this._save(); this._advance() }
    }, 80)
  },
  routePick(e) {
    const value = Number(e.currentTarget.dataset.value)
    this._state = story.choose(this._state, 'route', value)
    if (value === 1) this._state = story.gain(this._state, { luck: 1 })
    this.setData({ routeChoice: false })
    this._sync()
    this._startWalk()
  },

  signPick(e) {
    const take = Number(e.currentTarget.dataset.value) === 1
    this.setData({ signChoice: false })
    if (!take) {
      this._state = story.choose(this._state, 'sign', 'skip')
      this._sync(); this._startWalk(); return
    }
    this._pickPhoto('sign', (path) => {
      this._state = story.photo(this._state, 'sign', path)
      this._state = story.choose(this._state, 'sign', 'photo')
      this._state = story.gain(this._state, { luck: 1 })
      this._sync(); this._startWalk()
    })
  },

  hallPhoto() {
    this._arrive().then((ok) => {
      if (!ok) return
      this._pickPhoto('hall', (path) => {
      this._state = story.photo(this._state, 'hall', path)
      this._sync()
      this._advance()
      })
    })
  },

  _arrive() {
    if (this._mock) return Promise.resolve(true)
    const node = (this._nodes || [])[0]
    if (!node || node.nodeId == null) { cyToast('没有找到第 1 站'); return Promise.resolve(false) }
    return new Promise((resolve) => {
      wx.getLocation({
        type: 'gcj02',
        success: (loc) => {
          request('/api/play/arrive', 'POST', Object.assign({}, this._session, {
            nodeId: node.nodeId, longitude: loc.longitude, latitude: loc.latitude,
          })).then((res) => {
            const ok = res.code == 200 || res.code == '200'
            if (!ok) cyToast(res.msg || '还没到展示馆附近')
            resolve(ok)
          })
        },
        fail: () => { cyToast('需要定位才能在现场签到'); resolve(false) },
      })
    })
  },
  firstPick(e) {
    const value = Number(e.currentTarget.dataset.value)
    this._state = story.choose(this._state, 'first', value)
    if (value === 1) this._state = story.gain(this._state, { thought: 'afternoon' })
    this._state = story.setStep(this._state, 1)
    this._sync()
  },

  standStart() {
    if (this._holdTimer) return
    const started = Date.now()
    this.setData({ holding: true, holdProgress: 0 })
    this._holdTimer = setInterval(() => {
      const holdProgress = Math.min(100, Math.round((Date.now() - started) / 30))
      this.setData({ holdProgress })
      if (holdProgress >= 100) {
        clearInterval(this._holdTimer); this._holdTimer = null
        this._state = story.setStep(this._state, 2)
        this._feel('heavy'); this.setData({ holding: false, holdProgress: 100 }); this._sync()
      }
    }, 80)
  },
  standEnd() {
    if (!this._holdTimer) return
    clearInterval(this._holdTimer); this._holdTimer = null
    this.setData({ holding: false, holdProgress: 0 })
  },
  windowPhoto() {
    this._pickPhoto('window', (path) => {
      this._state = story.photo(this._state, 'window', path)
      this._state = story.setStep(this._state, 3)
      this._sync()
    })
  },
  onNoteInput(e) { this.setData({ noteText: e.detail.value }) },
  pickNote(e) { this.setData({ noteText: e.currentTarget.dataset.value }) },
  submitNote() {
    const value = String(this.data.noteText || '').trim()
    if (!value) return cyToast('写下窗外有什么')
    this._state = story.patch(this._state, { note: value })
    this._state = story.observe(this._state, '展示馆的窗', value)
    this._sync(); this._advance()
  },
  _finishDream() {
    if (!this.data.isDream) return
    if (this._dreamTimer) { clearInterval(this._dreamTimer); this._dreamTimer = null }
    if (this._dreamExitTimer) { clearTimeout(this._dreamExitTimer); this._dreamExitTimer = null }
    this._state = story.gain(this._state, { dreams: 1 })
    this._advance()
  },

  quizPick(e) {
    const correct = Number(e.currentTarget.dataset.value) === Number(e.currentTarget.dataset.answer)
    const index = this.data.quizIndex + 1
    const score = this._quizScore + (correct ? 1 : 0)
    this._quizScore = score
    if (index < 3) this.setData({ quizIndex: index })
    else {
      this._state = story.choose(this._state, 'quiz', score)
      if (score >= 2) this._state = story.gain(this._state, { luck: 1 })
      this._state = story.setStep(this._state, 1)
      this._sync()
    }
  },
  submitCount() {
    const count = Number(this.data.countText)
    if (!Number.isFinite(count) || count < 0) return cyToast('写下你看到的人数')
    this._state = story.choose(this._state, 'count', count)
    this._state = story.observe(this._state, '展示馆', '模型前，有 ' + count + ' 个人在低头看手机。')
    this._state = story.setStep(this._state, 2)
    this._sync()
  },
  _startTeacherTimer() {
    let seconds = 8
    this.setData({ teacherSeconds: seconds })
    this._teacherTimer = setInterval(() => {
      seconds -= 1
      this.setData({ teacherSeconds: Math.max(0, seconds) })
      if (seconds > 0) return
      this._stopTeacherTimer()
      this.teacherPick({ currentTarget: { dataset: { value: 3 } } })
    }, 1000)
  },
  _stopTeacherTimer() {
    if (this._teacherTimer) clearInterval(this._teacherTimer)
    this._teacherTimer = null
  },
  teacherPick(e) {
    this._stopTeacherTimer()
    const value = Number(e.currentTarget.dataset.value)
    this._state = story.choose(this._state, 'teacher', value)
    if (value === 1) {
      this._state = story.setStep(this._state, 3)
      this._sync(); return
    }
    if (value === 0) return this._runCheck('rule', 9, '背出标准答案', (ok) => {
      if (ok) this._state = story.gain(this._state, { thought: 'standard' })
      else this._state = story.gain(this._state, { hp: -1 })
      this._advance()
    })
    if (value === 2) return this._runCheck('heart', 10, '问老师：有没有标准答案', (ok) => {
      if (ok) this._state = story.gain(this._state, { thought: 'noanswer' })
      this._advance()
    })
    this._advance()
  },
  teacherWindowPick(e) {
    const value = Number(e.currentTarget.dataset.value)
    this._state = story.choose(this._state, 'window', value)
    if (value === 0) { this._advance(); return }
    this._runCheck('precision', 10, '说出它哪里精密', (ok) => {
      if (ok) this._state = story.gain(this._state, { thought: 'precise' })
      else this._state = story.gain(this._state, { hp: -1 })
      this._advance()
    })
  },
  _runCheck(skill, dc, label, done) {
    const dice = [Math.floor(Math.random() * 6) + 1, Math.floor(Math.random() * 6) + 1]
    const result = story.check(this._state, skill, dc, dice)
    this._checkDone = done
    this._feel(result.ok ? 'light' : 'heavy')
    this.setData({ check: { show: true, dice: result.dice, roll: result.roll, score: result.score, dc, ok: result.ok, label } })
  },
  closeCheck() {
    const done = this._checkDone
    this._checkDone = null
    this.setData({ 'check.show': false })
    if (done) done(this.data.check.ok)
  },
  openStickerMap() { this.setData({ view: 'map', stickerMode: true }) },
  openMapNote(e) {
    const note = this._mapNotes[Number(e.currentTarget.dataset.index)]
    if (note) this.setData({ mapBubble: Object.assign({ show: true }, note) })
  },
  closeMapNote() { this.setData({ 'mapBubble.show': false }) },
  placeSticker(e) {
    const label = e.currentTarget.dataset.value
    this._state = story.patch(this._state, { sticker: { label, x: 150, y: 388 } })
    this._state = story.setStep(this._state, 1)
    this._feel('light')
    this.setData({ view: 'story', stickerMode: false })
    this._sync()
  },
  careerPick(e) {
    this._state = story.patch(this._state, { job: e.currentTarget.dataset.value })
    this._sync()
    this._advance()
  },
  bossPick(e) {
    const value = Number(e.currentTarget.dataset.value)
    this._state = story.choose(this._state, 'boss', value)
    const finish = (ok) => {
      if (ok === false) this._state = story.gain(this._state, { hp: -1 })
      this._state = story.setStep(this._state, 1)
      this._sync()
    }
    if (value === 1) return this._runCheck('rule', 10, '用系统的语言说话', finish)
    if (value === 2) return this._runCheck('heart', 11, '我想试试这个', finish)
    if (value === 3) this._state = story.gain(this._state, { thought: 'afternoon' })
    finish(true)
  },
  phonePhoto() {
    this._pickPhoto('phone', (path) => {
      this._state = story.photo(this._state, 'phone', path)
      this._sync()
      this._advance()
    })
  },
  _pickPhoto(key, done) {
    if (this._mock) { done(asset(key === 'hall' ? 'square' : key === 'sign' ? 'street' : key === 'avatar' ? 'corridor' : key)); return }
    app.chooseImage((urls) => {
      const path = urls && urls[0]
      if (path) { this._feel('light'); done(path) }
    }, 1, { bizType: 'play_photo' })
  },
  _syncCompletion() {
    if (this._state.synced || this._mock) { this.setData({ showEndings: true }); return }
    const node = (this._nodes || [])[0]
    const picUrl = this._state.photos.hall
    if (!node || node.nodeId == null || !picUrl) { this.setData({ showEndings: true }); return }
    this.setData({ syncing: true, syncError: '' })
    request('/api/play/photo', 'POST', Object.assign({}, this._session, { nodeId: node.nodeId, picUrl })).then((res) => {
      if (res.code == 200 || res.code == '200') {
        request('/api/play/nodes', 'GET', this._session).then((fresh) => {
          const rows = fresh && fresh.data && fresh.data.nodes
          const readback = Array.isArray(rows) && rows.find((item) => String(item.nodeId) === String(node.nodeId))
          if (readback && (readback.done || readback.picUrl)) {
            this._state = story.patch(this._state, { synced: true })
            this._sync(); this.setData({ syncing: false, showEndings: true }); return
          }
          this.setData({ syncing: false, syncError: '现场照片已提交，但暂时无法确认保存结果，请再核对一次' })
        })
        return
      }
      this.setData({ syncing: false, syncError: res.msg || '本地故事已保存，现场记录暂未同步' })
    })
  },
  closeEndings() { this.setData({ showEndings: false }) },
  confirmReplay() {
    modal.show({
      title: '重看剧情？',
      content: '只会清除这台设备上的剧情进度，不会重置已完成的任务或奖励。',
      confirmText: '重看剧情',
      danger: true,
      success: (res) => { if (res && res.confirm) this._resetLocalStory() },
    })
  },
  _resetLocalStory() {
    if (this._walkTimer) clearInterval(this._walkTimer)
    if (this._holdTimer) clearInterval(this._holdTimer)
    if (this._dreamTimer) clearInterval(this._dreamTimer)
    if (this._wakeTimer) clearInterval(this._wakeTimer)
    if (this._dreamExitTimer) clearTimeout(this._dreamExitTimer)
    if (this._bootTimer) clearInterval(this._bootTimer)
    if (this._bootResetTimer) clearTimeout(this._bootResetTimer)
    if (this._teacherTimer) clearInterval(this._teacherTimer)
    this._walkTimer = this._holdTimer = this._dreamTimer = this._wakeTimer = null
    this._dreamExitTimer = this._bootTimer = this._bootResetTimer = this._teacherTimer = null
    this._bootScene = ''
    this._dreamScene = ''
    this._bootText = ''
    this._quizScore = 0
    this._mapNotes = MAP_NOTES.map((item) => Object.assign({}, item))
    story.clearArchive(wx, this._archive)
    this._state = story.createState()
    this.setData({ view: 'story', sceneStep: 0, registerStep: 0, teacherSeconds: 8, walkProgress: 0, walkLeft: 420, quizIndex: 0, dreamReady: false, wakeProgress: 0, showEndings: false })
    this._sync()
  },
})
