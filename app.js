// app.js
const modal = require('./utils/modal.js');
const { createNetworkStatus } = require('./utils/network-status.js');
const cyToast = require('./utils/toast.js');
const cyLoading = require('./utils/loading.js');
const { pickImagePaths, isChooseCancelled } = require('./utils/choose-media.js');
const config = require('./utils/config.js');
const { applyTheme } = require('./utils/theme.js');
const { createSessionStore } = require('./utils/session/session-store.js');
const { createSessionManager } = require('./utils/session/session-manager.js');
const { createRequestClient } = require('./utils/transport/request-client.js');
const { createUploadClient } = require('./utils/transport/upload-client.js');
const { createPageBoundOperation } = require('./utils/page-bound-operation.js');
const { createConsentClient } = require('./utils/compliance/consent-client.js');
const { captureFromQuery } = require('./utils/ticket-source.js');
const { captureDoorScene } = require('./utils/game-door-entry.js');
const roleGuard = require('./utils/roleGuard.js');
const { safeUserMessage } = require('./utils/transport/safe-user-message.js');
App({
  // 只允许在开发版使用本地 mock 兜底，体验版/正式版必须暴露真实登录失败。
  isDevEnv: function () {
    try {
      return wx.getAccountInfoSync().miniProgram.envVersion === 'develop';
    } catch (e) {
      return false;
    }
  },
  // 添加初始化状态和Promise
  isAppReady: false,
  appReadyPromise: null,
  // 假 ready 修复(Phase 1.2):isAppReady 仅表示"初始化完成"(app 照常起、可看公共内容),
  // 不代表已登录;需要登录态的页面/动作用 getAuthorization()/getUserID() 判定真实会话。
  onLaunch(e) {
    const runtimeConfig = config.resolveFromWx(wx);
    // 全局基调:暗色(全站默认深空黑;原生导航栏/状态栏同步深色)。个别浅色页根节点挂 class="theme-light"。
    applyTheme('dark');

    // 全局网络状态:cy-nav-bar 订阅后在标题栏下挂 cy-offline-banner(审核清单 §6.5)
    this.networkStatus = createNetworkStatus(wx);

    // 3-5 票源归因:分享卡的 query 只在冷启动的 onLaunch / 热启动的 onShow 里出现一次,
    // 落地页各自去捞会漏(探店日分享落的是主题详情,而那页由别的会话拥有)。捕获闸自身 fail-closed。
    this.captureTicketSource(e);
    this.captureDoorScene(e);

    // 微信升级会保留 Storage。debug_user_view 只服务开发版截图/身份走查；体验版与正式版
    // 若继续读取这个旧键，会让真实商家被强制渲染成玩家视角，造成提审与生产身份错乱。
    if (!this.isDevEnv()) {
      wx.removeStorageSync('debug_user_view');
    }

    wx.hideTabBar({
      fail: function() {
        setTimeout(function() {
          wx.hideTabBar(); // 重试一次
        }, 500)
      }
    });


    // 创建Promise用于控制初始化完成状态
    this.appReadyPromise = new Promise((resolve, reject) => {
      //获取状态栏高度
      const systemInfo = wx.getWindowInfo();

      // 获取胶囊按钮信息
      const menuButtonInfo = wx.getMenuButtonBoundingClientRect();

      this.globalData = {
        runtimeConfig: runtimeConfig,
        siteBaseUrl: runtimeConfig.apiBaseUrl,
        assetBaseUrl: runtimeConfig.assetBaseUrl,
        statusBarHeight: systemInfo.statusBarHeight,
        navBarHeight: 44, // 标题栏高度
        authorization: '',
        open_id: '',
        user_id: '',
        user_type: '',
        avatar: '',
        nickname: '',

        // M10 灰度功能开关:启动拉取 /api/config/features 覆盖,默认全关(网络异常时容错保持关闭)
        features: { drops: false, roamNpcEvent: false, roamNpcChat: false, roamDemoPois: false, finishNearbyRoute: false, clubMembership: false, shopNpcChat: false, merchantNpcChat: false },

        // 添加胶囊按钮信息
        menuButtonInfo: {
          width: menuButtonInfo.width,
          height: menuButtonInfo.height,
          top: menuButtonInfo.top,
          right: menuButtonInfo.right,
          bottom: menuButtonInfo.bottom,
          left: menuButtonInfo.left
        }
      };
      this.initPrivacyAuthorization();

      // 会话快照恢复:七字段(user_type/user_id/authorization/open_id/avatar/nickname/role)
      // 从 Storage 恢复到 globalData,空值不覆盖。统一交给 session-store,target 绑定 globalData
      // 同一对象,故现有「直接读 globalData.*」的代码无需改动即自动同步。
      // RBAC 角色仍作前端身份单一真源,user_type 双身份机制保持不变。
      this.getSession().restore();
      if (!this.isDevEnv() && this.getAuthorization() === this.DEV_TOKEN) {
        this.getSession().clearSession();
      }

      // 展示本地存储能力
      const logs = wx.getStorageSync('logs') || []
      logs.unshift(Date.now())
      wx.setStorageSync('logs', logs)

      // 初始化并resolve Promise
      this.appInitial(e).then(() => {
        this.isAppReady = true;
        resolve();
      }).catch(err => {
        console.error('App初始化失败');
        reject(err);
      });

    });
  },
  // 修改为异步函数
  appInitial: function (e) {
    let that = this;
    return new Promise((resolve, reject) => {
      that.firstLogin(e).then(() => {
        that.loadFeatureFlags(); // M10 灰度开关(不阻断初始化)
        resolve();
      }).catch(err => {
        reject(err);
      });
    });
  },

  // 热启动:从分享卡/扫码再次进入时,query 只出现在 onShow 上。
  onShow: function (e) {
    this.captureTicketSource(e);
    this.captureDoorScene(e);
  },

  // 3-5 票源归因捕获。合法性(是不是这一期的执行俱乐部、还在不在售票窗内)由后端
  // freezeTicketSourceOnPayment 在支付成功那一刻判并冻结,这里只负责不丢、不编造。
  captureTicketSource: function (e) {
    try {
      captureFromQuery((e && e.query) || {});
    } catch (err) { /* 归因失败只能降级为平台归因,绝不阻断启动 */ }
  },

  // 门口游戏码:query.scene 只在扫小程序码的 onLaunch/onShow 出现一次。
  // 不能每次首页 onShow 去读 getEnterOptionsSync,否则进了游玩再回首页会被再踢走。
  captureDoorScene: function (e) {
    try {
      this.pendingDoorScene = captureDoorScene(e, this.pendingDoorScene);
    } catch (err) { /* 门口码捕获失败只是这次不分流,不阻断启动 */ }
  },

  // M10 拉取灰度功能开关入 globalData.features(失败保持默认全关,不阻断启动)
  loadFeatureFlags: function () {
    var that = this;
    try {
      that.sendRequest({
        url: '/api/config/features',
        method: 'POST',
        hideLoading: true,
        success: function (res) {
          if (res && (res.code == '200' || res.code == 200) && res.data) {
            that.globalData.features = Object.assign({}, that.globalData.features, res.data);
          }
        }
      });
    } catch (e) {}
  },

  // 首登(委托单航班登录管理器)。ensureSession:已有缓存会话(openid+authorization,来自 onLaunch restore)
  // 直接成功、不发多余网络登录(过期 token 会在首个真实请求 401 时由 reLogin 静默续期)。
  // 保留:开发版 mock 兜底、各失败路径原文案 toast。始终 resolve(初始化与认证解耦,不阻断 appReady)。
  firstLogin: function (e) {
    var that = this;
    return this.getSessionManager().ensureSession().then(function (r) {
      // 仅"真鉴权拒绝"(服务端换 token 成功但拒登=noData)才清会话;networkFail/wxLoginFail
      // 属瞬时失败,保留刚恢复的缓存会话,避免弱网把持有效 token 的用户登出本次。
      if (r && !r.ok && r.reason === 'noData') {
        that.getSession().clearSession();
      }
      if (r && !r.ok && !that.isDevEnv()) {
        var msg = r.reason === 'wxLoginFail' ? '微信登录失败，请重试'
          : r.reason === 'networkFail' ? '网络异常，登录失败'
          : safeUserMessage(r, '登录失败，请稍后重试');
        cyToast(msg);
      }
      // 不 reject:登录失败不阻断初始化(契约 #18/#19)。
    });
  },
  // 开发版本地 mock 会话的 token。它对真后端无效(必被判 401),所以只能撑起
  // 「页面读 globalData 里的头像昵称」,换不来任何数据 —— session-manager 据此判断
  // 「已经在用 dev 会话」,不再对 401 触发的重登二次兜底。
  DEV_TOKEN: 'dev-token',
  useDevUser: function () {
    const mockData = require('./utils/mockData.js');
    const user = mockData.getDefaultUser();
    this.setOpenID(user.wxOpenId);
    this.setAuthorization(this.DEV_TOKEN);
    this.setUserID(user.id);
    this.setUserType(user.userType);
    this.setAvatar(user.avatar);
    this.setNickname(user.nickname);
  },
  // 登录态失效时静默重新登录(委托单航班登录管理器,与首登共享在途锁:
  // N 个并发 401 只触发一次换 token)。完成后回调 ok=true/false,对调用方语义不变。
  reLogin: function (callback) {
    var that = this;
    this.getSessionManager().refresh().then(function (r) {
      var ok = !!(r && r.ok);
      if (!ok) {
        that.getSession().clearSession();
      }
      typeof callback == 'function' && callback(ok, r);
    });
  },
  // 等待app初始化的方法
  waitForAppReady: function () {
    if (this.isAppReady) {
      return Promise.resolve();
    }
    return this.appReadyPromise;
  },

  globalData: {
    authorization: '',
    open_id: '',
    user_id: '',
    user_type: '',
    avatar: '',
    nickname: '',
    statusBarHeight: 0,
    navBarHeight: 0
  },
  // 会话存储:绑定 globalData 同一对象引用,统一管理七字段的内存/Storage 一致性。
  // 详见 utils/session/session-store.js。下方七组 setter/getter 全部委托给它,
  // 方法名保留不变,页面调用方零感知。
  getSession: function () {
    if (!this._session) {
      this._session = createSessionStore({
        target: this.globalData,
        onClear: function (identity) {
          roleGuard.clear();
          try {
            wx.removeStorageSync('selectedAddress');
            if (identity && identity.userId) wx.removeStorageSync('selectedAddressId_v1_' + String(identity.userId));
          } catch (e) {}
        }
      });
    }
    return this._session;
  },
  // 登录管理器(单航班登录/续期):把 wx.login + /api/login/code 收敛为一处并加在途锁。
  getSessionManager: function () {
    if (!this._sessionManager) {
      var that = this;
      this._sessionManager = createSessionManager({
        session: that.getSession(),
        wxLogin: function () {
          return new Promise(function (resolve, reject) {
            wx.login({ success: resolve, fail: reject });
          });
        },
        exchangeCode: function (code) {
          return new Promise(function (resolve, reject) {
            if (!that.globalData.siteBaseUrl) {
              reject(new Error('runtime api environment is not configured'));
              return;
            }
            wx.request({
              url: that.globalData.siteBaseUrl + '/api/login/code',
              method: 'POST',
              timeout: 12000,
              header: { 'content-type': 'application/x-www-form-urlencoded;' },
              data: { code: code },
              success: function (res) { resolve(res.data); },
              fail: function (e) { reject(e); }
            });
          });
        },
        isDevEnv: function () { return that.isDevEnv(); },
        useDevUser: function () { that.useDevUser(); },
        devToken: that.DEV_TOKEN
      });
    }
    return this._sessionManager;
  },
  // 统一请求通道(Phase 1.3):把原 sendRequest 行为收口到 request-client,并自动注入认证头,
  // 页面不再手拼 Authorization。装配真实 wx.request/会话/重登/toast。
  getRequestClient: function () {
    if (!this._requestClient) {
      var that = this;
      this._requestClient = createRequestClient({
        wxRequest: function (opts) { return wx.request(opts); },
        getBaseUrl: function () { return that.globalData.siteBaseUrl; },
        getAuthorization: function () { return that.getAuthorization(); },
        reLogin: function (cb) { that.reLogin(cb); },
        showToast: function (msg) { cyToast(msg); },
        hideToast: function () { that.hideToast(); },
        getErrorMessage: function (res, fallback) { return that.getRequestErrorMessage(res, fallback); },
        shouldAutoToast: function (param, body) { return that.shouldAutoToastRequestError(param, body); }
      });
    }
    return this._requestClient;
  },
  // 统一上传通道(Phase 1.3):替换 chooseImage/chooseDocument 的 uploadFile 循环,
  // 独立 multipart 路径也带会话认证,修「部分失败 loading 卡死」。
  getUploadClient: function () {
    if (!this._uploadClient) {
      var that = this;
      this._uploadClient = createUploadClient({
        wxUploadFile: function (opts) { return wx.uploadFile(opts); },
        getBaseUrl: function () { return that.globalData.siteBaseUrl; },
        getAuthorization: function () { return that.getAuthorization(); }
      });
    }
    return this._uploadClient;
  },
  // 原生选择/裁剪可能比页面活得更久；统一监视发起页面，离页即 abort。
  createPageBoundOperation: function () {
    var pages = getCurrentPages();
    return createPageBoundOperation({
      owner: pages[pages.length - 1] || null,
      getPages: function () { return getCurrentPages(); }
    });
  },
  getConsentClient: function () {
    if (!this._consentClient) {
      var that = this;
      this._consentClient = createConsentClient({
        sendRequest: function (options) { that.sendRequest(options); }
      });
    }
    return this._consentClient;
  },
  recordConsent: function (input) {
    return this.getConsentClient().record(input);
  },
  initPrivacyAuthorization: function () {
    var that = this;
    if (!wx.onNeedPrivacyAuthorization) return;
    this._privacyResolvers = [];
    wx.onNeedPrivacyAuthorization(function (resolve) {
      that._privacyResolvers.push(resolve);
      that.openPrivacyAuthorizationPage();
    });
  },
  // 隐私授权闸:优先用【当前页内的真弹窗】(cy-privacy-gate),它不压页面栈、不触发底层页 onHide、
  // 不盖住 tabBar,系统返回也绕不过去。只有当前页没挂这个组件时,才回退到旧的路由页(伪弹窗)。
  // ⚠️ 回退路径本身有过一个真 bug:系统返回退页时没有任何 resolve 被调用 ⇒ Promise 永不 settle
  //    ⇒ 后续需要隐私授权的接口静默挂起。那条已由 pages/privacy/index.js 的 onUnload 兜底。
  openPrivacyAuthorizationPage: function () {
    if (this._privacyNavigationPending) return;
    var pages = getCurrentPages();
    var current = pages[pages.length - 1];
    if (current && current.route === 'pages/privacy/index') return;
    // 真弹窗优先
    if (current && typeof current.showPrivacyGate === 'function') {
      current.showPrivacyGate();
      return;
    }
    this._privacyNavigationPending = true;
    wx.navigateTo({
      url: '/pages/privacy/index',
      complete: function () { this._privacyNavigationPending = false; }.bind(this)
    });
  },
  resolvePrivacyAuthorization: function (result) {
    var resolvers = this._privacyResolvers || [];
    this._privacyResolvers = [];
    resolvers.forEach(function (resolve) { resolve(result); });
  },
  hasPendingPrivacyAuthorization: function () {
    return !!(this._privacyResolvers && this._privacyResolvers.length);
  },
  setAuthorization: function (authorization) { this.getSession().setAuthorization(authorization); },
  setUserID: function (user_id) { this.getSession().setUserID(user_id); },
  setOpenID: function (open_id) { this.getSession().setOpenID(open_id); },
  setUserType: function (user_type) { this.getSession().setUserType(user_type); },
  setAvatar: function (avatar) { this.getSession().setAvatar(avatar); },
  setNickname: function (nickname) { this.getSession().setNickname(nickname); },
  getAvatar: function () { return this.getSession().getAvatar(); },
  getNickname: function () { return this.getSession().getNickname(); },
  getUserType: function () { return this.getSession().getUserType(); },
  getAuthorization: function () { return this.getSession().getAuthorization(); },
  getOpenID: function () { return this.getSession().getOpenID(); },
  getUserID: function () { return this.getSession().getUserID(); },
  // 获取配置信息的方法
  getConfig() {
    return config;
  },
  getPageSize() {
    return 10;
  },
  tips: function (str) {
    cyToast(safeUserMessage(str, '操作失败'))
  },
  getRequestErrorMessage: function (res, fallback) {
    return safeUserMessage(res, fallback || '请求失败，请稍后重试');
  },
  shouldAutoToastRequestError: function (param, res) {
    if (param && param.silentError) return false;
    if (param && param.autoErrorToast === false) return false;
    if (!res) return true;
    return res.code && res.code != 200;
  },
  goBack: function (time, inx) {
    setTimeout(function () {
      wx.navigateBack({
        delta: inx
      });
    }, (time > 0 ? time : 1500))
  },
  getTotalPage(total, page_size) {
    let page_total = parseInt(total / page_size);
    page_total = ((total % page_size) > 0) ? (page_total + 1) : page_total;
    return page_total;
  },
  // 获取图片完整URL的方法
  getImgUrl(imgPath) {
    if (!imgPath) return '';
    if (imgPath.indexOf('/') === 0) return imgPath;
    if (/^https?:\/\//i.test(imgPath)) return config.isTrustedAssetUrl(imgPath) ? imgPath : '';
    var assetBaseUrl = (this.globalData && this.globalData.assetBaseUrl) || config.baseImgUrl;
    return assetBaseUrl ? assetBaseUrl + imgPath : '';
  },
  //api统一请求函数(请求参数,请求地址)。行为收口到 request-client(Phase 1.3),
  //认证头自动注入,页面无需再手拼 Authorization。
  sendRequest: function (param, customSiteUrl) {
    return this.getRequestClient().send(param, customSiteUrl);
  },
  //获取当前时间戳
  getTimestamp: function () {
    var timestamp = Date.parse(new Date());
    return timestamp = timestamp / 1000;
  },
  //弹出提示消息(2026-09-06 收口到 utils/toast.js;success/complete 回调按原契约照旧回调)
  showToast: function (param) {
    var p = param || {};
    cyToast(p.title, { icon: p.icon, duration: p.duration || 1500, mask: p.mask });
    typeof p.success == 'function' && p.success({ errMsg: 'showToast:ok' });
    typeof p.complete == 'function' && p.complete({ errMsg: 'showToast:ok' });
  },
  //隐藏提示消息
  hideToast: function () {
    cyToast.hide();
  },
  // 统一取会员角色(RBAC):优先 globalData.role → storage role → 最后按 userType 兜底。
  // 三级回退保证即使某处未及时回填,也能拿到尽量准确的身份(含 club);不破坏 user_type 机制。
  getUserRole: function () {
    if (this.globalData.role) return this.globalData.role;
    var cachedRole = wx.getStorageSync('role');
    if (cachedRole) {
      this.globalData.role = cachedRole;
      return cachedRole;
    }
    var userType = wx.getStorageSync('user_type');
    return userType == 2 ? 'merchant' : 'player';
  },
  // 存角色缓存(委托 session-store,保留 `!role` 空值守卫):同时写 globalData 与 storage,
  // 作为前端身份单一真源(登录/重登/role-info 后调用)。getUserRole 的三级回退保持不变。
  setUserRole: function (snapOrRole) {
    if (typeof snapOrRole === 'string') { this.getSession().setUserRole(snapOrRole); return; }
    // 能力快照:存 role + 能力字段到 globalData(roleGuard 缓存的同时也持久化到 storage)
    if (snapOrRole && snapOrRole.role) {
      this.getSession().setUserRole(snapOrRole.role);
      try {
        wx.setStorageSync('role_permission_cache_v1', snapOrRole);
      } catch (e) {}
    }
  },
  // 把 N 张一次性交给裁剪页(/pages/crop/index),它内部逐张迭代,裁完一次抛回数组。
  // ⚠️ 别改回「调用方逐张开页」:emit 同步 → resolve 后同一 tick 就发下一次 navigateTo,
  //    而上一张的 navigateBack 还没落地 → 弹错页 / 静默丢图(2026-07-17 review 实证)。
  // resolve(null) = 用户取消整批;resolve(原数组) = 裁剪页拉不起来的兜底(绝不静默丢图)。
  cropAll: function (paths, ratio) {
    return new Promise(function (resolve) {
      var settled = false;
      var once = function (v) { if (!settled) { settled = true; resolve(v); } };
      wx.navigateTo({
        url: '/pages/crop/index',
        events: {
          cropDone: function (res) { once(res && res.paths && res.paths.length ? res.paths : null); },
        },
        // 临时路径可能有 9 条,塞 query 会超长 → 经 eventChannel 递
        success: function (res) {
          res.eventChannel.emit('cropInit', { paths: paths, ratio: ratio || 'free' });
        },
        // 页面栈满(10 层)等原因打不开 → 退回原图上传,别让整条流程断在这
        fail: function () { once(paths); },
      });
    });
  },
  //上传图片(上传循环收口到 upload-client,Phase 1.3:全部 settle 后统一收 loading,修部分失败卡死)
  // 选中的每张图都会经过自建裁剪页(/pages/crop/index,全站统一的 Threads 式深色裁剪):
  // · 传 options.cropScale → 用该比例('16:9'/'9:16'/'4:3'/'3:4'/'5:4'/'4:5'/'1:1');
  // · 只传 crop:true       → 1:1;
  // · 都不传               → 自由比例(框=原图比例,可放大取局部),构图交给用户。
  // · 传 options.skipCrop  → **整个跳过裁剪页**,原图直传。只给「透明底素材」这一类用:
  //   裁剪页导出固定 jpg,且导出前先铺一层白底(不铺白 PNG 的透明像素会被合成成黑),
  //   过一趟透明就没了。取景轮廓(photoCheck.frameUrl)要的正是透明底线条图 ——
  //   铺成白底再浮在实时画面上就是一层白纱,恰好是「现场感」的反面。
  //   ⚠️ 别顺手给普通配图用:跳过裁剪 = 用户没有构图机会,原图多大传多大。
  // ⚠️ 自由比例不是「偷懒没定」,是刻意的:营业执照 / 微信二维码 / 拍照任务凭证 / 资质证件
  //    这几类图一旦按固定比例裁,会裁掉信用代码、二维码定位角、判定主体 —— 是功能性损坏不是难看。
  //    要给某个位置定比例,前提是它的**消费容器**本就写死了比例(如 merchant/profile 的
  //    .pr-gimg 240×135 = 16:9),否则别定。
  // 多选不降级:选 N 张就逐张排队裁剪(张数一律听 count);取消 = 放弃整批(裁剪页上有「3/9」,
  // 用户知道自己在放弃什么),此处补一次 toast,别让整批无声蒸发。
  chooseImage: function (callback, count, options) {
    let that = this;
    options = options || {};
    var operation = that.createPageBoundOperation();
    var doUpload = function (filePaths) {
      if (operation.isAborted()) return;
      if (typeof options.onUploadStart === 'function') options.onUploadStart(filePaths);
      operation.onAbort(function () { cyLoading.hide(); });
      cyLoading.show('提交中');
      operation.attach(that.getUploadClient().uploadAll(filePaths, {
        bizType: options.bizType || (ratio === 'free' ? 'image_free' : 'image_' + ratio.replace(':', '_')),
        formData: options.formData,
        mapResult: typeof options.mapResult === 'function'
          ? options.mapResult : function (data) { return data.url; },
        onDone: function (r) {
          if (operation.isAborted()) return;
          operation.finish();
          cyLoading.hide();
          var handled = typeof options.onUploadDone === 'function'
            && options.onUploadDone(r, filePaths) === true;
          if (r.ok) {
            if (!handled) typeof callback == 'function' && callback(r.results);
          } else if (!handled) {
            that.showModal({ content: (r.failures[0] && r.failures[0].msg) || '上传失败' });
          }
        }
      }));
    };
    // 张数一律听调用方的:老代码里「裁剪=强制单张」是 wx.cropImage 一次只能裁一张的限制,
    // 裁剪页内部迭代后已经没这个限制 —— 门店相册就要「9 张都按 16:9 裁」
    var pickCount = count || 1;
    // 比例真源 = cropScale;只给 crop:true 不给比例的按 1:1;都没有 = 自由比例
    var ratio = options.cropScale || (options.crop ? '1:1' : 'free');
    // 2026-08-22:wx.chooseImage 已被官方标记废弃,迁到 wx.chooseMedia。
    // ⚠️ 响应结构不同:chooseImage 给 res.tempFilePaths(字符串数组),
    //    chooseMedia 给 res.tempFiles(对象数组,路径在 .tempFilePath)。下面两种都兜,
    //    因为低版本基础库回退到 chooseImage 时仍是旧结构。
    wx.chooseMedia({
      count: pickCount,
      mediaType: ['image'],
      // 跳过裁剪的那一路要原图:compressed 会把 PNG 转码,透明底同样保不住
      sizeType: options.skipCrop ? ['original'] : ['compressed'],
      sourceType: ['album', 'camera'],
      success: function (res) {
        if (operation.isAborted()) return;
        var paths = pickImagePaths(res);
        if (!paths.length) { operation.finish(); return; }
        if (options.skipCrop) { doUpload(paths); return; }
        that.cropAll(paths, ratio).then(function (out) {
          if (operation.isAborted()) return;
          // null = 用户取消整批。给一次提示:选了 9 张裁到第 9 张才取消,
          // 无声返回会让人以为卡住了(旧代码单张时无声尚可,排队后是随张数放大的悬崖)
          if (!out) { operation.finish(); cyToast('已取消上传'); return; }
          doUpload(out);
        }).catch(function () {
          if (operation.isAborted()) return;
          operation.finish();
          that.showModal({ content: '图片处理失败，请重试' });
        });
      },
      fail: function (res) {
        if (operation.isAborted()) return;
        operation.finish();
        if (!isChooseCancelled(res.errMsg)) {
          that.showModal({
            content: safeUserMessage(res, '无法选择图片，请稍后重试')
          })
        }
      }
    });
    return operation;
  },
  // 更通用的文件上传方法，支持多种文件类型
  chooseDocument: function (callback, count, fileTypes) {
    let that = this;
    var operation = that.createPageBoundOperation();
    const allowedTypes = fileTypes || ['pdf', 'doc', 'docx', 'xls', 'xlsx'];

    wx.chooseMessageFile({
      count: count || 1,
      type: 'file',
      success: function (res) {
        if (operation.isAborted()) return;
        // 过滤指定类型的文件
        let tempFiles = res && Array.isArray(res.tempFiles) ? res.tempFiles : [];
        let filteredFiles = tempFiles.filter(file => {
          if (!file || typeof file.name !== 'string' || typeof file.path !== 'string') return false;
          const fileExt = file.name.toLowerCase().split('.').pop();
          return allowedTypes.includes(fileExt);
        });

        if (filteredFiles.length === 0) {
          operation.finish();
          that.showModal({
            content: `请选择支持的文件类型：${allowedTypes.join(', ')}`
          });
          return;
        }

        let tempFilePaths = filteredFiles.map(file => file.path);

        operation.onAbort(function () { cyLoading.hide(); });
        cyLoading.show('上传中');

        operation.attach(that.getUploadClient().uploadAll(tempFilePaths, {
          // 选择回调已带 size:交给共享上传入口按真实单文件限额(10MB)前置拒绝,
          // 给出「压缩/换文件」的可操作提示,不发起注定被容器截断的连接。size 未知时自动放行。
          fileSizes: filteredFiles.map(file => file.size),
          formData: function (i) {
            return {
              'fileType': filteredFiles[i].name.split('.').pop(),
              'fileName': filteredFiles[i].name
            };
          },
          mapResult: function (data, i) {
            return {
              url: data.url,
              filename: filteredFiles[i].name,
              size: filteredFiles[i].size,
              type: filteredFiles[i].name.split('.').pop()
            };
          },
          onDone: function (r) {
            if (operation.isAborted()) return;
            operation.finish();
            cyLoading.hide();
            if (r.ok) {
              typeof callback == 'function' && callback(r.results);
            } else {
              that.showModal({ content: '上传失败：' + ((r.failures[0] && r.failures[0].msg) || '') });
            }
          }
        }));
      },
      fail: function (res) {
        if (operation.isAborted()) return;
        operation.finish();
        if (res.errMsg != 'chooseMessageFile:fail cancel') {
          that.showModal({
            content: safeUserMessage(res, '无法选择文件，请稍后重试')
          });
        }
      }
    });
    return operation;
  },
  //showModal 提示框
  showModal: function (param) {
    modal.show({
      title: param.title || '提示',
      content: param.content,
      showCancel: param.showCancel || false,
      cancelText: param.cancelText || '取消',
      cancelColor: param.cancelColor || '#000000',
      confirmText: param.confirmText || '确定',
      danger: !!param.danger,
      success: function (res) {
        if (res.confirm) {
          typeof param.confirm == 'function' && param.confirm(res);
        } else {
          typeof param.cancel == 'function' && param.cancel(res);
        }
      },
      fail: function (res) {
        typeof param.fail == 'function' && param.fail(res);
      },
      complete: function (res) {
        typeof param.complete == 'function' && param.complete(res);
      }
    })
  },
})
