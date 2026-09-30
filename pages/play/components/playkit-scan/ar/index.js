// cy-scan-ar(扫码壳的子层,不是独立玩法壳)· 显形档的真 AR(微信 xr-frame + VisionKit)
//
// 用户 2026-09-22:「这个 ar 的效果并没有遵循物理 … 大多数不是需要放到一个平面然后生成的吗」
// <camera> 只出画面、不知道手机怎么动,叠上去的图钉在屏幕上;这里的东西钉在现实里:
//   PLANE  识别地面/桌面,玩家点一下屏幕,东西立在那个位置,手机怎么转它都在原地
//   MARKER 认出商家那张实物照片(墙上的画、招牌),东西贴着它长出来、跟着它走
//
// ★ 本组件只管画面,不管判定:到店凭证仍然只认扫码(服务端比对),AR 识别在手机上算、可伪造。
// ★ 启动失败(机型不支持/VisionKit 起不来)一律报 arerror,宿主回落到屏幕叠加,这一站照样走得完。
// ⚠️ 开发者工具模拟不了 VisionKit,画面只能真机看。

const { arSystemOf, cardScaleOf, growOf, dropOf, DROP_CONTACT, fitModelOf, flatForward } = require('./ar-math.js');
require('./effect-plane-shadow.js');   // 注册透明阴影材质 'plane-shadow'(官方示例移植)

const CARD_BASE = { PLANE: 0.4, MARKER: 1 };   // 平面:约 0.4 米宽的立牌;识别图:与那张图同宽
const MODEL_SIZE = { PLANE: 0.4, MARKER: 0.8 }; // 3D 模型最长边:平面约 0.4 米;识别图约 0.8 倍图宽
const GROW_MS = 520;
const DROP_MS = 600;     // 平面:从上方落下 + 轻弹一下的总时长
const DROP_H = 0.3;      // 平面:从约 30 厘米高处落下

Component({
  properties: {
    mode: { type: String, value: 'PLANE' },
    imageUrl: { type: String, value: '' },
    markerUrl: { type: String, value: '' },
    // 商家传的 3D 模型(.glb):有就放模型,没有就把显形图做成立牌
    modelUrl: { type: String, value: '' },
    // 减弱动效:不落不弹,点下去直接立在那儿(轻震由宿主的 motion.haptic 一并静音)
    reducedMotion: { type: Boolean, value: false },
  },
  data: {
    arSystem: 'modes:Plane',
    loaded: false,
    arReady: false,        // 识别器等 AR 准备好才挂(wxml 读)
    markerLocked: false,   // 识别图:锁进世界空间后卸掉识别器(wxml 读)
    cardX: 0.4,
    cardZ: 0.4,
    cardLift: 0.2,
  },
  observers: {
    'mode': function (mode) {
      const base = CARD_BASE[mode] || CARD_BASE.PLANE;
      this.setData({ arSystem: arSystemOf(mode) || 'modes:Plane', cardX: base, cardZ: base, cardLift: base / 2 });
    },
  },
  methods: {
    handleReady({ detail }) { this.scene = detail.value; },

    handleArReady() {
      this.setData({ arReady: true });
      this.triggerEvent('arready');
    },

    /** VisionKit 起不来:报给宿主,由它回落。不报 = 玩家对着一块黑屏,永远等不到东西。 */
    handleArError() { this.triggerEvent('arerror'); },

    handleAssetsLoaded() {
      // 卡片按那张图的宽高比长,不拉伸
      const tex = this.scene && this.scene.assets && this.scene.assets.getAsset('texture', 'reveal');
      const base = CARD_BASE[this.data.mode] || CARD_BASE.PLANE;
      const s = cardScaleOf(tex && tex.width, tex && tex.height, base);
      // 两种模式都是立着的卡:底边贴地(平面)或贴图(识别图)
      this.setData({ loaded: true, cardX: s.x, cardZ: s.z, cardLift: s.z / 2 }, () => {
        if (this.data.modelUrl) this._fitModel();
      });
      if (this.data.mode === 'PLANE') this._bindPlacement();
    },

    /** 平面找到/丢了:没找到之前点屏幕不放 —— 放了也是飘在半空。 */
    handlePlaneSwitch({ detail }) {
      // 找没找到是内部状态,走实例字段(wxml 不读的 setData 字段就是死数据)
      this._found = !!(detail && detail.value);
      this.triggerEvent('found', { value: this._found });
    },

    _bindPlacement() {
      if (!this.scene || this._placementBound) return;
      this._placementBound = true;
      this.scene.event.add('touchstart', () => {
        if (!this._found) return;   // 平面还没找到:放了也是飘在半空
        this.scene.ar.placeHere('reveal-root', true);
        // 重放一次就重落一次;减弱动效直接跳到终点(下一帧就落定并报 landed)
        this._dropFrom = Date.now() - (this.data.reducedMotion ? DROP_MS : 0);
        this._shown = true;
        this._landed = false;
        this.triggerEvent('placed');
      });
    },

    /** 识别图:认到就锁定(只锁一次);锁定之前认丢了要告诉宿主,好把说明文字换回「对准这张图」。 */
    handleTrackerSwitch({ detail }) {
      if (this.data.markerLocked) return;
      const value = !!(detail && detail.value);
      if (!value) { this.triggerEvent('tracked', { value: false }); return; }
      if (this._lockPending) return;
      this._lockPending = true;
      // 「认到了」等锁定成功再报:先报的话说明条先没了,锁定却可能失败,画面是空的
      // 官方 markerLock 同样延一帧:认到的这一刻识别器的世界坐标还没更新完
      setTimeout(() => this._lockMarker(), 30);
    },

    /** 把识别器的世界矩阵抄给 marker-root,东西从此钉在现实里;然后卸掉识别器(wxml 按 markerLocked)。 */
    _lockMarker() {
      if (this.data.markerLocked || !this.scene) return;
      const sys = typeof wx !== 'undefined' && wx.getXrFrameSystem && wx.getXrFrameSystem();
      const tracker = this.scene.getElementById && this.scene.getElementById('marker-tracker');
      const root = this.scene.getNodeById && this.scene.getNodeById('marker-root');
      if (!sys || !tracker || !root) { this._lockPending = false; return; }   // 下次认到再锁
      root.getComponent(sys.Transform).setLocalMatrix(tracker.getComponent(sys.Transform).worldMatrix);
      root.visible = true;
      this._shown = true;
      this.setData({ markerLocked: true });
      // 减弱动效:起点拨到终点之前,下一帧就是原大
      this._growFrom = Date.now() - (this.data.reducedMotion ? GROW_MS : 0);
      // 3D 模型跟着识别图的朝向:贴墙时会横躺。下一帧(世界坐标已更新)扶正一次,之后不动,玩家绕着看
      if (this.data.modelUrl) this._uprightNext = true;
      this.triggerEvent('tracked', { value: true });
    },

    _transform(nodeId) {
      const el = this.scene.getNodeById && this.scene.getNodeById(nodeId);
      const sys = wx.getXrFrameSystem && wx.getXrFrameSystem();
      return el && sys && el.getComponent(sys.Transform);
    },

    handleTick() {
      if (!this.scene) return;
      if (this._dropFrom) this._tickDrop();
      if (this._growFrom) this._tickGrow();
      if (this._uprightNext) { this._uprightNext = false; this._uprightModel(); }
      if (this._shown && !this.data.modelUrl) this._faceCamera();
    },

    /** 3D 模型:按包围盒把最长边缩到 MODEL_SIZE,水平居中、底面贴地(商家的模型大小与原点都不可控)。 */
    _fitModel() {
      const sys = typeof wx !== 'undefined' && wx.getXrFrameSystem && wx.getXrFrameSystem();
      const el = sys && this.scene && this.scene.getNodeById && this.scene.getNodeById('reveal-model');
      const gltf = el && el.getComponent(sys.GLTF);
      if (!gltf) return;
      const box = gltf.calcTotalBoundBox();
      const f = fitModelOf(box.center, box.size, MODEL_SIZE[this.data.mode] || MODEL_SIZE.PLANE);
      const tf = el.getComponent(sys.Transform);
      tf.scale.setValue(f.scale, f.scale, f.scale);
      tf.position.setValue(f.x, f.y, f.z);
    },

    /** 立牌每帧转向玩家(官方 xr-template-lookat)。 */
    _faceCamera() { this._standUpright('reveal-face'); },
    /** 3D 模型锁定后扶正一次(世界竖直、正面朝玩家),之后不动 —— 玩家绕着它看各个面。 */
    _uprightModel() { this._standUpright('reveal-upright'); },

    /**
     * 让 nodeId 在世界空间里「立着、正面朝玩家」:先在世界空间里算朝向,再换成相对 reveal-body 的本地朝向 ——
     * 识别图贴在墙上时父节点是歪的,直接绕本地 Y 转会把东西转成躺着。
     */
    _standUpright(nodeId) {
      const sys = wx.getXrFrameSystem && wx.getXrFrameSystem();
      if (!sys) return;
      if (!this._camera) {
        const camEl = this.scene.getElementById && this.scene.getElementById('ar-camera');
        this._camera = camEl && camEl.getComponent(sys.Transform);
      }
      const node = this._transform(nodeId);
      const body = this._transform('reveal-body');
      if (!this._camera || !node || !body) return;
      const f = flatForward(this._camera.worldPosition, node.worldPosition);
      if (!f) return;
      this._fwd = this._fwd || sys.Vector3.createFromNumber(0, 0, 1);
      this._up = this._up || sys.Vector3.createFromNumber(0, 1, 0);
      this._fwd.setValue(f.x, 0, f.z);
      this._want = sys.Quaternion.lookRotation(this._fwd, this._up, this._want);
      this._inv = body.worldQuaternion.invert(this._inv);
      this._inv.multiply(this._want, node.quaternion);
    },

    /** 平面:从上方落下、着地轻弹(影子由透明阴影地面实时接住);贴地那一刻报一次 landed(宿主轻震)。 */
    _tickDrop() {
      const elapsed = Date.now() - this._dropFrom;
      const d = dropOf(elapsed, DROP_MS, DROP_H);
      const body = this._transform('reveal-body');
      if (body) body.position.setValue(0, d.y, 0);
      if (!this._landed && elapsed >= DROP_MS * DROP_CONTACT) {
        this._landed = true;
        this.triggerEvent('landed');
      }
      if (elapsed >= DROP_MS) this._dropFrom = 0;
    },

    /** 识别图:锁定那一刻起,立在图上从很小长到原大(ease-out)。 */
    _tickGrow() {
      const k = growOf(Date.now() - this._growFrom, GROW_MS);
      const body = this._transform('reveal-body');
      if (body) body.scale.setValue(k, k, k);
      if (k >= 1) this._growFrom = 0;
    },
  },
});
