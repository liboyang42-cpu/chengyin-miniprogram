// cy-post-compose —— 新建帖文弹窗(内容照 Figma 379:2484,呈现照 334:3563)
//
// ⚠️ 这是【组件】不是页面。2026-09-03 用户定:「新建帖文是弹窗,草稿就是弹窗叠弹窗」。
// 做成独立路由的话新路由下前一页不渲染,压暗底层是假的;挂在广场页上,压暗露出的
// 才是真的列表。顺带三个好处:行内 composer 展开不用跨页传值(同页同数据,不会丢字)、
// 不必再为「自绘顶栏」向标题体系申请例外、面板顶已在胶囊之下所以不用自己算 navRight。
//
// 发布复用 pages/square/list 内嵌编辑器那一条:POST /api/creativesquare/action,
// 字段 contents,单飞锁 _submitting,空文按 trim 后长度判。**不新造接口、不改口径** ——
// 两处分叉过一次就会出现「列表里能发、这页发不出去」这种没人报错的静默差异。
// 与 list 的唯一差别:这里不传 silentError,让统一请求通道自己弹错误 toast
// (list 那边要把错误渲染进内嵌表单,才需要静默 + 自己接管文案)。
const cyToast = require('../../../../../utils/toast.js');
const app = getApp();
const proEditorDraft = require('../../../../../utils/publish/pro-editor-draft.js');
const publishIntent = require('../../../../../utils/publish/publish-intent.js');
const { chinaParts } = require('../../../../../utils/datetime.js');
const { resolveMenuChrome } = require('../../../../../utils/nav-safe-area.js');
const { pickLocation } = require('../../../../../utils/location/location-manager.js');

const MAX_LEN = 8000;
const MAX_PICS = 6;

function activityIdOf(row) {
  if (!row) return '';
  const id = row.activityId != null ? row.activityId : (row.id != null ? row.id : row.ownerId);
  return id == null || id === '' ? '' : id;
}

function mergeActivityOptions(joined, hosted) {
  const seen = {};
  const out = [];
  function add(item) {
    if (!item || item.activityId == null || item.activityId === '') return;
    const key = String(item.activityId);
    if (seen[key]) return;
    seen[key] = true;
    out.push(item);
  }
  (hosted || []).forEach(add);
  (joined || []).forEach(add);
  return out;
}

function activitiesFromJoined(data) {
  const rows = Array.isArray(data) ? data : ((data && data.rows) || []);
  const out = [];
  rows.forEach(function (row) {
    if (!row) return;
    if (row.ownerType != null && Number(row.ownerType) !== 2) return;
    const act = row.cmsActivity || {};
    const activityId = activityIdOf(act.id != null ? act : row);
    const name = String(act.name || row.activityTitle || row.name || '').trim();
    if (!activityId || !name) return;
    out.push({ activityId: activityId, name: name, dataType: 1, sourceLabel: '我参加的' });
  });
  return out;
}

function activitiesFromHosted(data) {
  const rows = Array.isArray(data) ? data : ((data && data.rows) || []);
  const out = [];
  rows.forEach(function (row) {
    if (!row) return;
    const activityId = activityIdOf(row);
    const name = String(row.name || row.title || '').trim();
    if (!activityId || !name) return;
    out.push({ activityId: activityId, name: name, dataType: 1, sourceLabel: '我主办的' });
  });
  return out;
}

function placeLine(poi) {
  const name = String((poi && poi.name) || '').trim();
  const addr = String((poi && poi.address) || '').trim();
  if (name && addr && name !== addr) return name + ' · ' + addr;
  return name || addr;
}

// 草稿 key 命名空间:借 pro-editor-draft 的 topicId 槽位,而不是 draftUuid 槽位。
// 为什么必须分开:saveDraft 一旦走 draftUuid 分支,就会顺手写 pro_editor_active_<memberId>
// —— 那是 pages/publish/fabu「继续上次新建」用的活动指针,全账号只有一个。
// 本页占了它,fabu 下次恢复会按这个 uuid 读到本页的信封(章节结构完全不同)= 串稿。
// 走 topicId 槽位则完全不碰活动指针,key 落在
//   pro_editor_draft_topic_square_post_<memberId>
// 与 fabu 的 pro_editor_draft_new_* 天然不同前缀。带 memberId 是防同机换号互相覆盖
// (loadDraft 本身也会按 memberId 判 member_mismatch,这里是第二道)。
// 四个调用点(show 观察器 / persist / readDrafts / onPublish)都先判过 memberId,
// 所以这里不再兜 falsy —— 兜了也永远走不到,只会让人以为「没登录也能存草稿」。
function draftIdentity(memberId) {
  return { topicId: 'square_post_' + String(memberId) };
}

// 面板顶 = 微信胶囊底 + 8px 视觉余量(留白值用户 2026-09-03 定)。
//
// ⚠️ 别用 --cy-comp-sheet-max-height 顶这个位置。它是
//   calc(100vh - env(safe-area-inset-top) - 88rpx - 16rpx),
// 只在「刘海机 + env() 真返回 47pt」时才刚好躲开胶囊。env() 返回 0 的场合
//   —— 开发者工具模拟器、以及安卓(状态栏约 24pt、胶囊落在 28~60pt)——
// 算出来的面板顶是 52pt,**正压在胶囊上**。2026-09-03 真机截图实拍到:
// 顶栏右侧「草稿 / 更多」两枚图标被胶囊盖住。
// 所以这里不推算安全区,直接问胶囊自己的坐标(先例:pages/publish/fabu/topic-detail-sheet.wxml)。
// 拿不到坐标才退回那个 token —— 有总比没有强,但别把它当主路径。
// T4 上层比下层再低 22pt(真源样张 25:6867 y=66 → 25:6869 y=88)。
const T4_STACK_OFFSET_PT = 22;

// 面板顶 = 胶囊底 + 全站统一的那 5px。
// ⚠️ **不要在这里另算一套胶囊**。仓库已有 utils/nav-safe-area.js 的 resolveMenuChrome():
// 它把「拿不到胶囊坐标时怎么兜」「为什么是 5px 不是 12px」都论证过了(用户 2026-08-10 定:
// 再高一点右上角就和微信胶囊挨着,手指一偏点到「关闭小程序」,未保存内容一起没)。
// 本文件第一版自己写了 bottom + 8,既是第三份重复实现,间距也和全站不一致。
// 现在由 sheet-top-safe-area-contract ⑤ 钉死:覆盖 --cy-comp-sheet-max-h 的地方
// 必须走这个共用工具,自己另算一套判红。
function sheetTopStyle(extraPt) {
  var g = app.globalData || {};
  var mb = g.menuButtonInfo;
  if (!mb) { try { mb = wx.getMenuButtonBoundingClientRect(); } catch (e) { mb = null; } }
  var win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  var top = resolveMenuChrome(win, mb).sheetTop + (extraPt || 0);
  return '--cy-comp-sheet-max-h: calc(100vh - ' + Math.round(top) + 'px);';
}

Component({
  options: { styleIsolation: 'isolated' },

  properties: {
    show: { type: Boolean, value: false },
    // 行内 composer 里已经写了一半的正文。同页传值,不经 storage ——
    // 经 storage 就会把上一条草稿覆盖掉(草稿只有一个槽位)。
    prefill: { type: String, value: '' },
    // H050 编辑态:传 { id, contents, dataId, dataType } 即改这条帖。
    // 只改正文与关联 —— 图片/地点不提交,后端 R10-06「未提交字段不清空」会原样保留,
    // 所以编辑态不给附件工具(给了也提交不上去,等于骗用户)。
    editPost: { type: Object, value: null },
  },

  data: {
    sheetStyle: '',          // 面板顶让开胶囊,见 sheetTopStyle()
    draftsSheetStyle: '',    // T4 上层(草稿)的位置,比本层再低 22pt
    avatar: '',
    nickname: '',
    content: '',
    contentLen: 0,
    canSubmit: false,
    submitting: false,
    // 编辑态(editPost 非空):标题/提交键换文案,草稿与附件工具收起 —— wxml 直接消费它
    editMode: false,
    draftsShow: false,
    drafts: [],
    picList: [],
    address: '',
    selectedActivity: null,
    activityPickerShow: false,
    activityList: [],
    activityLoading: false,
    activityError: false,
  },

  lifetimes: {
    attached() {
      this._memberId = app.getUserID();
      this._submitting = false;
      this._published = false;
      this.setData({
        avatar: app.getAvatar(),
        nickname: app.getNickname(),
        sheetStyle: sheetTopStyle(0),
        // 草稿(T4 上层)比本层再低一档,位置同样由这里算 —— 只有这里拿得到胶囊坐标。
        draftsSheetStyle: sheetTopStyle(T4_STACK_OFFSET_PT),
      });
    },
    // 组件被卸载(页面退出)时也要把没发出去的正文存下来
    detached() { this.persist(); },
  },

  observers: {
    // 每次拉起都重新取一次正文:优先用行内 composer 带过来的半截,
    // 没有才回 storage 捡草稿。关闭时存一次 —— 组件不卸载,所以不能只靠 detached。
    show(open) {
      if (!open) {
        // ⚠️ 草稿层是本组件的**子弹窗**,不能活得比宿主久。
        //    draftsShow 是内部 data,show 置 false 并不会自动收 ——
        //    不收的话新建帖文关掉后草稿面板会孤零零挂在广场页上(2026-09-03 截图看出来的,
        //    单测和全部门禁一条都没盖到,只有真截图看得见)。
        this.setData({ draftsShow: false, activityPickerShow: false });
        this.persist();
        return;
      }
      // 宿主页常驻不卸载:上一篇发布成功的标记只管那一次关闭,新拉起的这篇要照常关闭即存(3-19)。
      this._published = false;
      const edit = this.data.editPost;
      if (edit && edit.id != null && edit.id !== '') { this.applyEdit(edit); return; }
      this.setData({ editMode: false });
      const carried = String(this.data.prefill || '');
      if (carried.trim()) { this.applyContent(carried); return; }
      if (!this._memberId) return;
      // member_mismatch / revision_conflict 一律当没有草稿:
      // 宁可让用户少恢复一次,也不能把别人的文字塞进他的输入框。
      const res = proEditorDraft.loadDraft(wx, draftIdentity(this._memberId), { memberId: this._memberId });
      const saved = res.status === 'ready' && res.envelope && res.envelope.formData
        ? String(res.envelope.formData.contents || '')
        : '';
      this.applyContent(saved);
    },
  },

  methods: {
    // 关闭即存。已发布成功的不再存(草稿在 onPublish 里已删);编辑态不写草稿槽位
    // ——草稿是「新建」的存档,拿编辑中的正文去盖掉它 = 静默丢用户没发出去的那篇。
    persist() {
      if (this._published || this.data.editMode) return;
      const content = String(this.data.content || '').trim();
      if (!content || !this._memberId) return;
      try {
        proEditorDraft.saveDraft(wx, {
          memberId: this._memberId,
          topicId: draftIdentity(this._memberId).topicId,
          formData: { contents: this.data.content },
        });
      } catch (e) {
        // 存草稿失败(storage 满/被禁)不该在退出路径上再弹一层打断,静默放过。
      }
    },

    // 正文单一入口:输入、草稿恢复、发布后清空都走它,长度/可提交态不会分叉。
    applyContent(value) {
      const text = String(value == null ? '' : value).slice(0, MAX_LEN);
      this.setData({
        content: text,
        contentLen: text.length,
        canSubmit: text.trim().length > 0,
      });
    },

    // 以编辑态打开:正文与关联来自被编辑的帖子;图片/地点/预览图不参与(后端保留原值)。
    // 关联要留着并重发 —— 后端编辑分支对 data_id 无值即清 0,不重发会把关联丢掉。
    applyEdit(edit) {
      this._editId = String(edit.id);
      this._editDataId = edit.dataId == null || edit.dataId === '' ? '' : String(edit.dataId);
      this._editDataType = edit.dataType == null || edit.dataType === '' ? '' : String(edit.dataType);
      this._lng = '';
      this._lat = '';
      this.setData({
        editMode: true,
        draftsShow: false,
        activityPickerShow: false,
        picList: [],
        address: '',
        selectedActivity: null,
      });
      this.applyContent(edit.contents || '');
    },

    onInput(e) {
      this.applyContent(((e || {}).detail || {}).value || '');
    },

    // 关闭的所有权在广场页(show 是它给的),这里只上报。
    onCancel() {
      this.triggerEvent('close');
    },

    // 只有一份草稿(key 固定,见 draftIdentity),所以列表长度恒为 0 或 1。
    // 不做多份草稿:那要在 pro-editor-draft 之外再维护一张 key 索引表,
    // 而稿子只要求「离页存一份、回来能捡回来」。要多份就是另一张卡。
    readDrafts() {
      const memberId = this._memberId;
      if (!memberId) return [];
      const identity = draftIdentity(memberId);
      const res = proEditorDraft.loadDraft(wx, identity, { memberId: memberId });
      const envelope = res.status === 'ready' ? res.envelope : null;
      const contents = envelope && envelope.formData ? String(envelope.formData.contents || '') : '';
      if (!contents) return [];
      // 稿 379:885 的日期文本是「8月30日」—— 不带时分。本页只有一份草稿,
      // 时分对「是哪一条」毫无区分度,加了只是把这一行挤宽。
      const t = chinaParts(envelope.savedAt);
      return [{
        key: identity.topicId,
        avatar: this.data.avatar,
        nickname: this.data.nickname,
        date: t ? `${t.month}月${t.day}日` : '',
        summary: contents,
      }];
    },

    // 读 storage 是同步的(wx.getStorageSync),不存在「读到一半」,所以不传 loading —— 组件默认 false。
    // ⚠️ 后果要说清:cy-post-drafts 的 Loading 分支【当前不可达】,
    //    连带 --cy-color-skeleton-on-sheet 这个 token 的唯一消费者也永远不渲染。
    //    保留它不是摆设:草稿一旦改成走后端(跨设备,施工文档 §6.2 里"以后再加"的那条),
    //    这里传 loading 就能立刻用上,不必届时再补一套骨架。
    //    ★ 但在那之前,别把「Loading 已实现」读成「Loading 已验证」—— 它没被渲染过。
    onOpenDrafts() {
      this.setData({ drafts: this.readDrafts(), draftsShow: true });
    },

    onCloseDrafts() {
      this.setData({ draftsShow: false });
    },

    // e.detail = { index, key, item }。key 就是我们写进去的那个 topicId,拿它回 storage 重读 ——
    // 不用 item.summary 还原:那个字段按组件契约是「摘要」,拿摘要当正文迟早丢字。
    // ⚠️ cy-post-drafts 的 onSelect 是【先 close 再 select】,所以走到这里面板已经在收了。
    //    这意味着任何一条 return 都长成「面板关了、正文没变、什么都没说」——
    //    用户会以为自己点空了,而这恰恰是草稿读不出来(改过号 / 版本冲突)时最该说话的时刻。
    onPickDraft(e) {
      const key = ((e || {}).detail || {}).key;
      const fail = (msg) => cyToast(msg);
      if (!key || !this._memberId) return fail('草稿已不在了');
      const res = proEditorDraft.loadDraft(wx, { topicId: key }, { memberId: this._memberId });
      if (res.status !== 'ready' || !res.envelope || !res.envelope.formData) {
        // status 可能是 member_mismatch / revision_conflict / 空 —— 对用户是同一件事:这条恢复不了。
        return fail('这条草稿打不开了');
      }
      this.applyContent(res.envelope.formData.contents);
      this.setData({ draftsShow: false });
    },

    // 走到这里时删除确认闸已经过完(闸长在 cy-post-drafts 里),页面直接删,别再加一道 modal。
    onDeleteDraft(e) {
      const key = ((e || {}).detail || {}).key;
      const sheet = this.selectComponent && this.selectComponent('#drafts');
      if (!key || !this._memberId) {
        sheet && sheet.deleteFailed('草稿已不在了');
        return;
      }
      // 「回执 ≠ 观测」:removeDraft 返回 true 只说明调用被接受,removeStorageSync 还可能抛。
      // 判成没删,唯一算数的是**回头再读一遍 storage**,看这条 key 还在不在。
      let left;
      try {
        proEditorDraft.removeDraft(wx, { topicId: key }, { memberId: this._memberId });
        left = this.readDrafts();
      } catch (err) {
        sheet && sheet.deleteFailed('删除失败,请重试');
        return;
      }
      this.setData({ drafts: left });
      if (left.some((d) => d.key === key)) {
        sheet && sheet.deleteFailed('删除失败,请重试');   // 删了还在 = 没删掉,别报「已删除」
        return;
      }
      sheet && sheet.deleteDone();
    },

    onPickImage() {
      const that = this;
      const left = MAX_PICS - (that.data.picList || []).length;
      if (left <= 0) {
        cyToast('最多 6 张图片');
        return;
      }
      app.chooseImage(function (res) {
        const next = (that.data.picList || []).concat(res || []).slice(0, MAX_PICS);
        that.setData({ picList: next });
      }, left);
    },

    onClearPic(e) {
      const idx = Number(((e || {}).currentTarget || {}).dataset.inx);
      if (!Number.isFinite(idx)) return;
      const arr = (this.data.picList || []).slice();
      arr.splice(idx, 1);
      this.setData({ picList: arr });
    },

    onPickLocation() {
      const that = this;
      pickLocation({
        onPick(poi) {
          that._lng = poi.longitude;
          that._lat = poi.latitude;
          that.setData({ address: placeLine(poi) });
        }
      });
    },

    onClearLocation() {
      this._lng = '';
      this._lat = '';
      this.setData({ address: '' });
    },

    onOpenActivityPicker() {
      this.setData({ activityPickerShow: true });
      this.loadActivityOptions();
    },

    onCloseActivityPicker() {
      this.setData({ activityPickerShow: false });
    },

    loadActivityOptions() {
      const epoch = (this._actEpoch || 0) + 1;
      this._actEpoch = epoch;
      this.setData({ activityLoading: true, activityError: false });
      const that = this;
      let pending = 2;
      let failed = 0;
      let joined = [];
      let hosted = [];
      const done = function () {
        pending -= 1;
        if (pending > 0 || epoch !== that._actEpoch) return;
        if (failed === 2) {
          that.setData({ activityLoading: false, activityError: true, activityList: [] });
          return;
        }
        that.setData({
          activityLoading: false,
          activityError: false,
          activityList: mergeActivityOptions(joined, hosted),
        });
      };
      app.sendRequest({
        hideLoading: true,
        silentError: true,
        url: '/api/registration/list',
        method: 'POST',
        data: { owner_type: 2, pageNum: 1, pageSize: 50 },
        success(res) {
          if (res && (res.code == 200 || res.code == '200')) joined = activitiesFromJoined(res.data);
          else failed += 1;
          done();
        },
        fail() { failed += 1; done(); },
      });
      app.sendRequest({
        hideLoading: true,
        silentError: true,
        url: '/api/activity/list',
        method: 'POST',
        data: { is_my: 1, pageNum: 1, pageSize: 50 },
        success(res) {
          if (res && (res.code == 200 || res.code == '200')) hosted = activitiesFromHosted(res.data);
          else failed += 1;
          done();
        },
        fail() { failed += 1; done(); },
      });
    },

    onPickActivity(e) {
      const ds = ((e || {}).currentTarget || {}).dataset || {};
      const list = this.data.activityList || [];
      let item = Number.isFinite(Number(ds.index)) ? list[Number(ds.index)] : null;
      if (!item && ds.activityId != null) {
        const id = String(ds.activityId);
        for (let i = 0; i < list.length; i++) {
          if (String(list[i].activityId) === id) { item = list[i]; break; }
        }
      }
      if (!item) return;
      this.setData({ selectedActivity: item, activityPickerShow: false });
    },

    onClearActivity() {
      this.setData({ selectedActivity: null });
    },

    clearAttachments() {
      this._lng = '';
      this._lat = '';
      this.setData({ picList: [], address: '', selectedActivity: null, activityPickerShow: false });
    },

    onPublish() {
      const that = this;
      const content = String(that.data.content || '').trim();
      // 与 canSubmit 同一口径(trim 后非空)。视觉禁用只是 opacity,真正的闸在这里。
      if (!content) {
        cyToast('请输入内容');
        return;
      }
      if (that._submitting) return;
      that._submitting = true;
      that.setData({ submitting: true });

      const activity = that.data.selectedActivity;
      const editing = that.data.editMode && that._editId;
      // 编辑:只发正文 + 关联。图片/地点/预览图不发 = 后端按「null 不碰原值」保留(R10-06);
      // 关联必须重发,后端编辑分支对 data_id 是「无值即清 0」,不发会把旧关联清掉。
      const payload = editing
        ? {
            id: that._editId,
            contents: content,
            data_id: that._editDataId || '',
            data_type: that._editDataId ? (that._editDataType || '1') : '',
          }
        : {
            contents: content,
            pics: (that.data.picList || []).join(';'),
            address: that.data.address || '',
            longitude: that._lng || '',
            latitude: that._lat || '',
            data_id: activity && activity.activityId ? activity.activityId : '',
            data_type: activity && activity.activityId ? (activity.dataType || 1) : '',
          };
      // R10-03:稳定发布意图键只服务「新建」;编辑是幂等的 update,不占意图键。
      let intent = null;
      if (!editing) {
        intent = publishIntent.begin(wx, {
          scope: 'square:compose',
          memberId: that._memberId,
          payload: [payload.contents, payload.pics, payload.address, payload.longitude, payload.latitude, payload.data_id, payload.data_type],
        });
        payload.request_id = intent.key;
        if (intent.previousUnknown) cyToast('上次结果未确认，重试不重复发');
      }

      app.sendRequest({
        hideLoading: true,
        url: '/api/creativesquare/action',
        method: 'POST',
        data: payload,
        success: function (res) {
          if (res.code != '200') {
            if (editing) return;   // 非 200 由统一通道弹 toast,这里不重复
            if (res && res.intentDiscarded === true) {
              // 服务端明确该发布已软删:丢弃意图键,重新发布自然换新键(旧帖不自动复活)
              publishIntent.discard(wx, 'square:compose', that._memberId, intent.key);
            } else {
              publishIntent.settle(wx, 'square:compose', that._memberId, intent.key, 'rejected');
            }
            return;   // 非 200 由统一通道弹 toast,这里不重复
          }
          if (!editing) {
            publishIntent.settle(wx, 'square:compose', that._memberId, intent.key, 'success');
            if (that._memberId) {
              proEditorDraft.removeDraft(wx, draftIdentity(that._memberId), { memberId: that._memberId });
            }
          }
          that._published = true;
          that.applyContent('');
          that.clearAttachments();
          // prefill 是 property,清空归广场页管(onComposePublished 里已清)——
          // 组件自己 setData 一个 wxml 不渲染的字段会被 U4 死数据字段门禁判红,而且它说得对。
          // 不弹「发布成功」toast:success-toast 棘轮是「只减不增」,判据是
          // 「新增一次成功提示 = 又一处『做成了但界面不记得』」。
          // 这里界面是记得的 —— 广场页收到 published 会刷新,
          // 新帖就出现在第一条,那本身就是最好的回执,比一个 1.5 秒就消失的 toast 强。
          that.triggerEvent('published');
          that.triggerEvent('close');
        },
        fail: (err) => {
          if (!editing) {
            // 结果未知:保留同一意图键,重试复用,不再新开一条
            publishIntent.settle(wx, 'square:compose', that._memberId, intent.key, 'unknown');
          }
          cyToast(app.getRequestErrorMessage ? app.getRequestErrorMessage(err, '网络异常，请检查后重试') : '网络异常，请检查后重试');
        },
        complete: function () {
          that._submitting = false;
          that.setData({ submitting: false });
        },
      });
    },
  },
});
