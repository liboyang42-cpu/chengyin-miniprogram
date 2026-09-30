// cy-playkit · v5.1/v5.2 新玩法分发器(Figma 组件库 v5.1 node 45:248 / v5.2 node 64:304)
//
// 为什么要这一层:节点玩法有九种壳,页面不该写九个 wx:if 和九组 bind。页面只给一个
// kit 对象({ type, ...玩法数据 }),事件统一收成 kitaction —— 页面按 action 分派。
// 分发器自己不持任何状态:玩法数据的所有权在页面(它才知道要不要回服务端)。
const KIT_TYPES = [
  'album',
  'timewindow', 'blindtaste', 'silentorder', 'diyname',
  'musiccorner', 'steps', 'dailysign', 'slowtask',
  // 整屏那批(原型真源:模板编辑页 v2)。它们不是半屏 sheet ——
  // 「整屏就是判定区」「墙就是手机的四条边」「整屏被油盖住」压在半屏里全部不成立。
  'coinflip', 'diceroll', 'reaction', 'ballshake', 'quiethold', 'shout', 'compass', 'countdown', 'stopwatch',
  // 问答族三种模式共用 'qa' 一屏(type / pick / shot),不铺成三种 type ——
  // 它们的差别只在中间那一块,铺开的话同一处改动要改三遍。
  'qa', 'branch', 'estimate', 'pricepair', 'hidden', 'predict', 'random', 'bingo', 'scan',
  /* R3 三个新玩法(施工文档 · 证据板):排序 / 连线 / 分类 */
  'sort', 'match', 'classify',
  /* 计步单独一个 'walk':已有的 'steps' 是 v5.1 那批半屏 sheet 的壳,
     与这一批整屏的不是一套东西。同名会让人以为换个 kit 就能切,实际两套壳。 */
  'walk',
  /* 《预制人生》四个新段(契约 §2)。photoCheck 与 qa 拍照题一样是两步,
     它的 shoot 也走 onShoot;profile 多一个头像上传动作。
     ⚠️ §2.3 的 check 段已作废 —— master 上的 R14 检定走 JOURNEY_SEGMENTS,不在这份分发器里。 */
  'profile', 'photocheck', 'note', 'typein',
];

Component({
  properties: {
    show: { type: Boolean, value: false },
    // { type: 'blindtaste', title, options, ... };type 不在册时整块不渲染
    kit:  { type: Object,  value: null },
    /* 内嵌(契约 §1.5):故事流里的那一份。绝大多数 kit 不需要这个属性 ——
       台面自己认 --pk-stage-* 变量切成在流里渲染。只有 diceRoll 例外:
       用户点名两种写法都保留,它按这个属性演**另一套构图**(故事流里直接掷),
       不是把整屏那版缩小。 */
    inline: { type: Boolean, value: false },
  },
  methods: {
    /* 所有子事件收口成一条 kitaction,payload 带上是哪种玩法的哪个动作。
       不逐个往上抛同名事件:页面要挂九组 bind 才接得全,漏一个就是静默失效。 */
    _emit(action, detail) {
      const kit = this.data.kit || {};
      this.triggerEvent('kitaction', {
        type: kit.type || '',
        action,
        detail: detail || {},
      });
    },

    onSubscribe() { this._emit('subscribe'); },
    onOpen() { this._emit('open'); },
    onAnswer(e) { this._emit('answer', e.detail); },
    onGiveUp(e) { this._emit('giveup', e.detail); },
    onNameChange(e) { this._emit('namechange', e.detail); },
    onSubmit(e) { this._emit('submit', e.detail); },
    onToggle(e) { this._emit('toggle', e.detail); },
    onRefresh() { this._emit('refresh'); },
    onAccept(e) { this._emit('accept', e.detail); },   // 接力签:detail = { text, photoUrl }
    onSlowStart() { this._emit('slowstart'); },
    onSlowClaim() { this._emit('slowclaim'); },
    onClose() { this._emit('close'); },
    onRequestClose(e) { this._emit('requestclose', e.detail); },

    /* 整屏那批的动作。同样收口成 kitaction —— 页面按 type + action 分派,
       不逐个往上抛同名事件(要挂十几组 bind 才接得全,漏一个就是静默失效)。 */
    onFlip() { this._emit('flip'); },
    onRoll() { this._emit('roll'); },
    onGoalChange(e) { this._emit('goalchange', e.detail); },
    onSync(e) { this._emit('sync', e.detail); },
    onClaim(e) { this._emit('claim', e.detail); },
    onCount(e) { this._emit('count', e.detail); },
    onDrawn(e) { this._emit('drawn', e.detail); },
    onDraw(e) { this._emit('draw', e.detail); },
    onSettled(e) { this._emit('settled', e.detail); },
    onSubmit(e) { this._emit('submit', e.detail); },
    onVerdict(e) { this._emit('verdict', e.detail); },
    onMicDenied() { this._emit('micdenied'); },
    onStart() { this._emit('start'); },
    onFinish() { this._emit('finish'); },
    onShoot(e) { this._emit('shoot', e && e.detail); },
    onAudio(e) { this._emit('audio', e.detail); },
    onChoose(e) { this._emit('choose', e.detail); },
    onScanned(e) { this._emit('scanned', e.detail); },
    // 建档的头像:选一张之后页面负责上传,传完把地址写回 kit(与拍照题同一个两步走)
    onAvatar(e) { this._emit('avatar', e.detail); },

    /* 类型白名单出口:页面/单测拿它校验后端下发的 type,别让分发器静默吞掉未知玩法 */
    _kitTypes() { return KIT_TYPES.slice(); },
  },
});
