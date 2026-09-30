const toast = require('../../../utils/toast.js');
const app = getApp();
function jsonBody(data) { return JSON.stringify(data || {}); }
function jsonHeader() { return { 'Content-Type': 'application/json' }; }
// 活动倾向选中态:WXML 只能做成员访问,不能调 indexOf。
function prefsMap(arr) {
  var map = {};
  (arr || []).forEach(function (v) { map[v] = true; });
  return map;
}

// 编辑俱乐部资料(新字段模型,与创建页一致):clubType(单选大类)/activityPrefs(多选路线方向)/city/keywords/style/logo/cover/description。
// 多俱乐部:按 clubId 加载与保存(改当前选中团);主理人姓名/电话属 club_leader,不在此编辑。
// 俱乐部编辑 = 三级(从俱乐部管理点开的编辑操作)⇒ 场景弹窗,宿主是俱乐部管理页。
// pages/club/edit 保留为深链兼容壳。表单是可写的 ⇒ 关闭要走 dirty 闸,由宿主的 requestclose 承担。
Component({
  properties: {
    clubId: { type: String, value: '' },
    theme: { type: String, value: 'player' },
  },
    data: {
      clubId: null,
      // 表单字段(新模型)
      name: '',
      clubType: '',
      activityPrefs: [],
      city: '',
      keywords: '',
      style: '',
      description: '',
      logo: '',
      cover: '',
      prioritySignupEnabled: false,
      memberReservedQuota: '',
      joinPolicy: 0,
      joinPolicySupported: false,
      isOwner: false,
      nonOwnerMemberCount: 0,
      // 选项(与创建页一致)
      typeOptions: [
        { val: '校园社团', sub: '学生组织 · 校园路线' },
        { val: '旅行组织', sub: '城市探索 · 户外带队' },
        { val: '兴趣社群', sub: '同好聚集 · 城市路线' },
        { val: '商业活动组织方', sub: '品牌路线 · 商业执行' },
        { val: '内容创作团队', sub: '内容产出 · IP 运营' },
        { val: '其他', sub: '' }
      ],
      dirOptions: ['轻社交', '深度社交', 'RPG体验', '城市定向', '解谜路线', '沉浸式剧情', '运动路线', '艺术体验', '美食体验', '主题聚会'],
      loadState: 'loading',
      loadErrorText: '',
      saveErrorText: '',
      canSave: false,
      saving: false,
      dissolving: false,
      dissolutionErrorText: '',
      dissolutionBlockerText: '',
      // 稿 P6 31:38 把阻断项按资金类型分节。后端一次只抛一类(两个 catch 分支),
      // 所以这里只存当前这一节的抬头。
      dissolutionBlockerSection: '',
      showDissolutionBlockers: false,
      dissolutionBlockerItems: [],
      // 定位:T1 半屏 draft(点「应用」才写回表单)。倾向回显直接在 wxml 上读 activityPrefs,
      // 不再派生一份文本 —— 派生了原数组就成了 wxml 零引用的内部状态(U4-A2)。
      pickerKind: '',      // '' | 'type' | 'prefs'
      draftType: '',
      draftPrefs: [],
      // WXML 表达式不会执行方法调用:`draftPrefs.indexOf(item)>=0` 恒为 falsy,
      // 多选半屏一个 chip 都不高亮(实测 draftPrefs 有 2 项、10 个 chip class 全是 `chip`)。
      // 选中态是这个半屏唯一的反馈,所以改成成员访问能读的映射。
      draftPrefsOn: {},
      // 管理员锁态卡第三行:三项经营配置的现值回显
      opCurrentText: ''
    },
  lifetimes: {
    attached() {
      const clubId = this.data.clubId
      if (clubId) this.setData({ clubId })
      this.loadClub()
    },
  },
  methods: {
    loadClub() {
      var that = this;
      this.setData({ loadState: 'loading', loadErrorText: '' });
      if (this.data.clubId) { this.fetchDetail(); return; }
      // 多俱乐部下不能猜 owned[0]：深链缺参时选错对象比打不开更危险。
      that.setData({ loadState: 'missing-param', loadErrorText: '没有指定要编辑的俱乐部，请返回俱乐部页重新进入。' });
    },

    fetchDetail() {
      var that = this;
      this.setData({ loadState: 'loading', loadErrorText: '' });
      app.sendRequest({
        url: '/api/club/detail', method: 'POST', data: jsonBody({ id: this.data.clubId }), header: jsonHeader(),
        success: function (res) {
          if (res.code == '200' && res.data) {
            var c = res.data;
            // 2026-08-26:管理员(viewerIsAdmin)也能改**展示信息**;经营配置与解散仍只给主理人。
            // 后端 canGovernClub 是真闸,这里只是别把表单藏起来。
            if (c.isOwner !== true && c.viewerIsAdmin !== true) {
              that.setData({
                isOwner: false,
                loadState: 'permission',
                loadErrorText: '只有该俱乐部主理人或管理员可以编辑资料，请返回俱乐部页。'
              });
              return;
            }
            that._nonOwnerMemberCount = Number(c.nonOwnerMemberCount) || 0;
            that.setData({
              name: c.name || '',
              clubType: c.clubType || '',
              activityPrefs: c.activityPrefs ? c.activityPrefs.split(',') : [],
              city: c.city || c.address || '',
              keywords: c.keywords || '',
              style: c.style || '',
              description: c.description || '',
              logo: c.logo || '',
              cover: c.cover || '',
              prioritySignupEnabled: Number(c.prioritySignupEnabled) === 1,
              memberReservedQuota: c.memberReservedQuota === null || c.memberReservedQuota === undefined ? '' : String(c.memberReservedQuota),
              joinPolicy: Number(c.joinPolicy) === 1 ? 1 : 0,
              joinPolicySupported: c.joinPolicySupported === true,
              isOwner: c.isOwner === true,
              loadState: 'ready',
              loadErrorText: '',
              saveErrorText: ''
            }, function () { that.validate(); that.syncDerived(); });
          } else {
            that.setData({ loadState: 'business-error', loadErrorText: res.msg || '俱乐部不存在' });
          }
        },
        fail: function () {
          that.setData({ loadState: 'network-error', loadErrorText: '网络异常，请重试' });
        }
      });
    },

    validate() {
      var d = this.data;
      this.setData({ canSave: !!(d.name && d.city) });
    },

    // 管理员锁态卡第三行:三项经营配置的现值回显 —— 管理员改不了它们,
    // 这一句是他唯一能知道现值的地方,所以三项任一变化都要重算。
    syncDerived() {
      var d = this.data;
      var parts = ['优先报名 ' + (d.prioritySignupEnabled ? '已开' : '已关')];
      if (d.joinPolicySupported) parts.push('入会审批 ' + (Number(d.joinPolicy) === 1 ? '已开' : '已关'));
      parts.push('保留 ' + (d.memberReservedQuota === '' ? 0 : Number(d.memberReservedQuota) || 0) + ' 个');
      this.setData({ opCurrentText: parts.join(' · ') });
    },

    // ===== 输入 =====
    markDirty() {
      if (this.data.saveErrorText) this.setData({ saveErrorText: '' });
      this.triggerEvent('dirtychange', { dirty: true });
    },

    onInput(e) {
      var f = e.currentTarget.dataset.field;
      this.setData({ [f]: e.detail.value }, () => {
        this.validate();
        this.markDirty();
      });
    },

    onPrioritySignupChange(e) {
      this.setData({ prioritySignupEnabled: !!e.detail.value }, () => { this.markDirty(); this.syncDerived(); });
    },

    onJoinPolicyChange(e) {
      this.setData({ joinPolicy: e.detail.value ? 1 : 0 }, () => { this.markDirty(); this.syncDerived(); });
    },

    // ===== 定位:T1 半屏选择器 =====
    // 打开时把当前值拷成 draft;改 draft 不影响表单,点「应用」才写回,直接关掉 = 放弃。
    openTypePicker() {
      this.setData({ pickerKind: 'type', draftType: this.data.clubType });
    },

    openPrefsPicker() {
      var arr = (this.data.activityPrefs || []).slice();
      this.setData({ pickerKind: 'prefs', draftPrefs: arr, draftPrefsOn: prefsMap(arr) });
    },

    closePicker() { this.setData({ pickerKind: '' }); },

    pickDraftType(e) {
      this.setData({ draftType: e.currentTarget.dataset.val });
    },

    toggleDraftDir(e) {
      var val = e.currentTarget.dataset.val;
      var arr = this.data.draftPrefs.slice();
      var i = arr.indexOf(val);
      if (i >= 0) arr.splice(i, 1);
      else {
        if (arr.length >= 3) { toast('最多选 3 个'); return; }
        arr.push(val);
      }
      this.setData({ draftPrefs: arr, draftPrefsOn: prefsMap(arr) });
    },

    applyPicker() {
      // 两个分支各写各的字面量字段:动态 setData(计算键/展开)静态门禁核不了消费面,
      // 会被 U4 判成「无法核对 WXML 消费」。
      var kind = this.data.pickerKind;
      var done = () => { this.validate(); this.syncDerived(); this.markDirty(); };
      if (kind === 'type') this.setData({ clubType: this.data.draftType, pickerKind: '' }, done);
      else if (kind === 'prefs') this.setData({ activityPrefs: this.data.draftPrefs.slice(), pickerKind: '' }, done);
    },

    // ===== logo / 封面 =====
    pickLogo() {
      var that = this;
      app.chooseImage(function (urls) {
        if (urls && urls.length) that.setData({ logo: urls[0] }, () => that.markDirty());
      }, 1, { crop: true, cropScale: '1:1' });
    },
    pickCover() {
      var that = this;
      app.chooseImage(function (urls) {
        if (urls && urls.length) that.setData({ cover: urls[0] }, () => that.markDirty());
      }, 1, { crop: true, cropScale: '16:9' });
    },

    // ===== 保存(JSON,带 id 改指定团)=====
    dismissSaveError() { if (!this.data.saving) this.setData({ saveErrorText: '' }); },

    save() {
      // loadState==='ready' 本身就是权限证明(permission 态根本渲染不出表单),不另立 canEdit
      if (this.data.loadState !== 'ready' || !this.data.canSave || this.data.saving) return;
      var d = this.data, that = this;
      this.setData({ saving: true, saveErrorText: '' });
      var payload = {
        id: d.clubId,                 // 多俱乐部:必须带 id,改指定团(后端校验归属)
        name: d.name,
        logo: d.logo,
        cover: d.cover,
        description: d.description,
        clubType: d.clubType,
        activityPrefs: d.activityPrefs.join(','),
        city: d.city,
        address: d.city,
        keywords: d.keywords,
        style: d.style,
        operationConfigUpdated: true,
        prioritySignupEnabled: d.prioritySignupEnabled ? 1 : 0,
        // [2026-08-12 拍板] 成员优惠价停用后**不再提交这个字段** —— 提 null 会把库里存量抹平,
        // 而 club.member_discount_price 是有意保留的恢复退路(服务端改回一行即生效)。不读、也不动。
        memberReservedQuota: d.memberReservedQuota === '' ? 0 : Number(d.memberReservedQuota)
      };
      if (d.joinPolicySupported) payload.joinPolicy = d.joinPolicy;
      app.sendRequest({
        url: '/api/club/update-mine', method: 'POST',
        data: JSON.stringify(payload),
        header: {
          'Content-Type': 'application/json',
          'Authorization': app.getAuthorization()
        },
        success: function (res) {
          if (res.code == '200') {
            that.setData({ saving: false, saveErrorText: '' });
            toast.success('已保存');
            that.triggerEvent('dirtychange', { dirty: false });
            // 保存成功 ⇒ 关掉编辑层回到管理页,并让宿主重拉(原来是 navigateBack 猜页面栈)
            var self = that;
            setTimeout(function () { self.triggerEvent('saved'); self.triggerEvent('back'); }, 800);
          } else {
            that.setData({ saving: false, saveErrorText: res.msg || '请稍后重试' });
          }
        },
        fail: function () {
          that.setData({ saving: false, saveErrorText: '网络异常，请重试' });
        }
      });
    },

    // 三段式第一段:确认。原来是两屏自建 cy-sheet(初始 + 再次确认成员),
    // 现在合成一屏 —— 后果清单里那条「全部成员会被移出」就是原来第二屏在说的事,
    // 用户读到它再点确认,等价于确认了成员后果(所以下面直传 true)。
    dissolveClub() {
      // ⚠️ 从 cy-btn 换成裸 view 后丢了 disabled 的点击拦截(cy-btn 内部 __onTap 会吞掉 tap)。
      //    wxml 上已经按 dissolving || saving 置灰,守卫必须跟上,否则就是
      //    「视觉禁用但仍可点」—— 保存在途时点解散照样弹三段式确认框。
      if (!this.data.isOwner || this.data.dissolving || this.data.saving) return;
      this.setData({ dissolutionErrorText: '' });
      const dc = this.selectComponent && this.selectComponent('#dc');
      // E-15g(2026-09-16):原来取 this.data.form(这个组件没有 form 字段)→ 名字恒 undefined,
      // 三段式确认框回退成「解散「这一项」?」。名字真源就是 data.name。
      if (dc) dc.open('club.dissolve', { name: this.data.name });
    },

    /** 三段式第二段:确认弹窗里点了「解散俱乐部」才真的发请求。 */
    onConfirmDissolve() {
      this.submitDissolve((this._nonOwnerMemberCount || 0) > 0);
    },

    /** 更轻的替代:改为转让主理人 —— 成员和内容都留着(治理页已有这条链路)。 */
    onDissolveAlt() {
      this.triggerEvent('transferowner');
    },

    submitDissolve(memberConsequencesConfirmed) {
      if (this.data.dissolving) return;
      const that = this;
      const dc = this.selectComponent && this.selectComponent('#dc');
      if (dc) dc.busyOn();
      this.setData({ dissolving: true, dissolutionErrorText: '' });
      app.sendRequest({
        url: '/api/club/dissolve', method: 'POST',
        data: jsonBody({
          id: this.data.clubId,
          dissolveConfirmed: true,
          memberConsequencesConfirmed: !!memberConsequencesConfirmed
        }),
        header: jsonHeader(),
        success(res) {
          that.setData({ dissolving: false });
          if (res.code == '200') {
            // 三段式第三段:结果确认卡,由父级在 dissolved 之后决定跳哪
            if (dc) dc.done();
            that.triggerEvent('dirtychange', { dirty: false });
            that.triggerEvent('dissolved', { clubId: that.data.clubId });
            return;
          }
          // 后端仍要求再次确认成员后果 = 前端算的 nonOwnerMemberCount 和库里对不上。
          // 别静默再弹一屏把它糊过去 —— 原样透出,让人看见这个分歧。
          if (res && String(res.msg || '').indexOf('再次确认成员') >= 0) {
            if (dc) dc.failed(res.msg || '成员数量已变化，请刷新后重试');
            return;
          }
          const blockerItems = res && res.data && Array.isArray(res.data.actionItems) ? res.data.actionItems : [];
          if (blockerItems.length) {
            if (dc) dc.close();
            that.setData({
              showDissolutionBlockers: true,
              dissolutionBlockerSection: (res.data && res.data.sectionTitle) || '待处理事项',
              dissolutionBlockerText: '',
              dissolutionBlockerItems: blockerItems
            });
            return;
          }
          if (dc) dc.failed((res && res.msg) || '请稍后重试');
          that.setData({ dissolutionErrorText: (res && res.msg) || '请稍后重试' });
        },
        fail() {
          if (dc) dc.failed('网络异常，请重试');
          that.setData({ dissolving: false, dissolutionErrorText: '网络异常，请重试' });
        }
      });
    },

    closeDissolutionBlockers() {
      this.setData({ showDissolutionBlockers: false, dissolutionBlockerText: '', dissolutionBlockerSection: '', dissolutionBlockerItems: [] });
    },

    closeDissolutionError() {
      this.setData({ dissolutionErrorText: '' });
    },

    // 后端(ApiClubController)给每条阻塞项写死的 url 指向 pages/club/dissolution-blockers,
    // 那页 2026-09-06 已随孤儿页清理删除(它做的事本弹层已内联)。这里按 url 里的 type 就地承接:
    //   deposit    → 弹层内直接重试原路退款(原页唯一的写动作,与 pages/coop/list 同一接口)
    //   settlement → 俱乐部结算页(待收/待付都在那看)
    // 其它 url 原样跳,别把新页面也拦成死链。
    openDissolutionBlockerItem(e) {
      const item = this.data.dissolutionBlockerItems[Number(e.currentTarget.dataset.index)];
      if (!item || !item.url) return;
      const target = resolveDissolutionBlockerTarget(item.url);
      if (target.kind === 'deposit') { this.retryDissolutionDeposit(target.id, item); return; }
      this.setData({ showDissolutionBlockers: false });
      wx.navigateTo({ url: target.url });
    },

    retryDissolutionDeposit(inviteId, item) {
      const that = this;
      if (!inviteId || this._blockerRetrying) return;
      this._blockerRetrying = true;
      this.setData({ dissolutionBlockerText: item && item.actionText === '核对退款结果'
        ? '正在核对退款结果，仅查询原退款单…' : '正在重试保证金退款…' });
      app.sendRequest({
        url: '/api/coop/deposit/refund/retry', method: 'POST',
        data: jsonBody({ inviteId: inviteId }), header: jsonHeader(),
        success(res) {
          that._blockerRetrying = false;
          if (res && res.code == '200') {
            const confirmed = res.data && typeof res.data.refundState === 'string'
              && typeof res.msg === 'string' && res.msg.trim();
            that.setData({
              // 退款接口只报告保证金状态；未重新读取解散条件前不能移除阻断。
              dissolutionBlockerText: (confirmed ? res.msg : '退款结果暂无法确认') + '；未结事项仍保留，请核对后再操作',
            });
            return;
          }
          that.setData({ dissolutionBlockerText: (res && res.msg) || '退款重试失败，请稍后再试' });
        },
        fail() {
          that._blockerRetrying = false;
          that.setData({ dissolutionBlockerText: '退款结果暂无法确认，请先核对，勿重复提交' });
        },
        successStatusAbnormal() {
          that._blockerRetrying = false;
          that.setData({ dissolutionBlockerText: '退款结果暂无法确认，请先核对，勿重复提交' });
        },
      });
    },

    onBack() { this.triggerEvent('back'); }

  },
})

// 解析后端阻塞项 url:/pages/club/dissolution-blockers/index?clubId=1&type=deposit&id=9
function resolveDissolutionBlockerTarget(url) {
  const raw = String(url || '');
  if (raw.indexOf('/pages/club/dissolution-blockers/') !== 0) return { kind: 'nav', url: raw };
  const q = {};
  raw.split('?')[1] && raw.split('?')[1].split('&').forEach((kv) => { const i = kv.indexOf('='); if (i > 0) q[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1)); });
  if (q.type === 'deposit') return { kind: 'deposit', id: q.id || '' };
  return { kind: 'nav', url: '/pages/club/settlement/index?clubId=' + encodeURIComponent(q.clubId || '') };
}
