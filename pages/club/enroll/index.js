// 城瘾 · 俱乐部报名名册(主理人/管理员视角)
// 列出俱乐部各团的报名人数;点开看每个票种的报名者名单。管理员只读;清退退款仅主理人。
// 数据:/api/club/topics(各团 signupCount) + /api/club/topic-registrations(票种 + 报名者名单)
// 注:成团(自动散团引擎)已于 2026-07-15 下线 —— 本页不再展示成团态/进度/门槛,只报人数与名单。
const modal = require('../../../utils/modal.js');
const toast = require('../../../utils/toast.js');
const app = getApp();
const { isRecord, isRecordList, bizFailureMessage } = require('../../../utils/response-shape.js');
const { readReducedMotion } = require('../../../utils/motion-preference.js');

function dateOf(s) { return (s && typeof s === 'string') ? s.slice(0, 10) : ''; }
function jsonBody(data) { return JSON.stringify(data || {}); }
function jsonHeader() { return { 'Content-Type': 'application/json' }; }
function teamStatusText(status) {
  if (status === 1) return '已成团';
  if (status === 2) return '已散团';
  return '募集中';
}

// 这四个判据 2026-09-09 抽进 utils/owner-action-guard.js —— 退款入口挪到核销详情后
// 有了第二个消费方,复制一份过去迟早分叉。
const {
  permissionFailureCode, isPermissionFailure, identityKey,
} = require('../utils/owner-action-guard.js');

Page({
  data: {
    statusBarHeight: getApp().globalData.statusBarHeight,
    navBarHeight: getApp().globalData.navBarHeight,
    reducedMotion: false,
    clubId: null,
    clubName: '',
    teams: [],     // [{id,name,signupCount,dateText,_open,_detailState,tickets:[]}]
    teamsState: 'loading', // loading | ready | business-error | network-error
    refreshing: false,
    staleError: '',
    staleErrorKind: 'data',
    permissionState: 'loading', // loading | ready | denied | business-error | network-error
    permissionError: '',
    permissionDeniedTitle: '没有权限查看报名名册',
    permissionDeniedSub: '仅主理人或管理员可查看报名名册',
  },

  onLoad(options) {
    this._identityKey = identityKey();
    // E-07(2026-09-16):topic-detail 的「核销台账」带了 topicId,原来这里不消费 ⇒ 打开的是全俱乐部名册。
    // 预聚焦 = 到达时自动展开该团并拉它的名单(不隐藏其他团,避免看起来像丢了数据)。
    const focusTopicId = Number(options && options.topicId);
    this._focusTopicId = Number.isInteger(focusTopicId) && focusTopicId > 0 ? focusTopicId : null;
    this.setData({
      clubId: options.clubId || null,
      clubName: options.clubName ? decodeURIComponent(options.clubName) : '',
    });
    if (this.data.clubId) this.checkPermission();
    else this.resolveClub();
  },

  onShow() {
    const reducedMotion = readReducedMotion();
    if (this.data.reducedMotion !== reducedMotion) this.setData({ reducedMotion });
    const currentIdentity = identityKey();
    if (this._identityKey === undefined) {
      this._identityKey = currentIdentity;
      return;
    }
    if (currentIdentity === this._identityKey) {
      // E-08:身份没变,但刚从核销详情回来(可能清了人、退了款)—— 重拉名册。
      if (this._refreshOnShow) {
        this._refreshOnShow = false;
        if (this.data.permissionState === 'ready') this.loadTeams();
      }
      return;
    }
    this._identityKey = currentIdentity;
    this._permissionEpoch = (this._permissionEpoch || 0) + 1;
    this._teamsEpoch = (this._teamsEpoch || 0) + 1;
    this._detailEpoch = Object.create(null);
    this.setData({
      teams: [],
      teamsState: 'loading',
      refreshing: false,
      staleError: '',
      permissionState: 'loading',
      permissionError: '',
            });
    if (this.data.clubId) this.checkPermission();
    else this.resolveClub();
  },

  onUnload() {
    this._permissionEpoch = (this._permissionEpoch || 0) + 1;
    this._teamsEpoch = (this._teamsEpoch || 0) + 1;
    this._detailEpoch = Object.create(null);
  },

  onPullDownRefresh() {
    if (this.data.permissionState === 'ready') this.loadTeams();
    else {
      wx.stopPullDownRefresh();
      this.retryPermission();
    }
  },

  // 无 clubId 时取我的第一个俱乐部(owned 即 owner)
  goBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 });
      return;
    }
    if (this.data.clubId) {
      wx.redirectTo({ url: '/pages/club/detail/index?id=' + this.data.clubId });
      return;
    }
    wx.switchTab({ url: '/pages/talent/list/index' });
  },
  beginPermissionCheck() {
    const epoch = (this._permissionEpoch || 0) + 1;
    this._permissionEpoch = epoch;
    this._teamsEpoch = (this._teamsEpoch || 0) + 1;
    this._detailEpoch = Object.create(null);
    this.setData({
      teams: [],
      teamsState: 'loading',
      refreshing: false,
      staleError: '',
      permissionState: 'loading',
      permissionError: '',
            });
    return epoch;
  },
  failPermission(epoch, state, message) {
    if (epoch !== this._permissionEpoch) return;
    this.setData({
      permissionState: state,
      permissionError: message,
    });
  },
  denyPermission(epoch, title, sub) {
    if (epoch !== this._permissionEpoch) return;
    this.setData({
      permissionState: 'denied',
      permissionDeniedTitle: title,
      permissionDeniedSub: sub,
      permissionError: '',
    });
  },
  allowPermission(epoch) {
    if (epoch !== this._permissionEpoch) return;
    this.setData({
      permissionState: 'ready',
      permissionError: '',
    });
    this.loadTeams();
  },
  ownedFromResponse(res) {
    if (!res || res.code != '200' || !isRecord(res.data)) return null;
    const rawOwned = res.data.owned;
    if (isRecordList(rawOwned)) {
      return rawOwned.every(function (item) { return item.id != null && item.id !== ''; }) ? rawOwned : null;
    }
    if (isRecord(rawOwned) && rawOwned.id != null && rawOwned.id !== '') return [rawOwned];
    return null;
  },
  settlePermissionReadFailure(epoch, value, statusCode, networkFallback) {
    if (epoch !== this._permissionEpoch) return;
    const code = permissionFailureCode(value, statusCode);
    const message = String(value && (value.msg || value.message)
      || (code === 403 ? '仅主理人或管理员可查看报名名册' : '暂时无法确认查看权限'));
    if (isPermissionFailure(value, statusCode)) {
      if (code === 403) this.denyPermission(epoch, '没有权限查看报名名册', message);
      else this.failPermission(epoch, 'business-error', message);
      return;
    }
    this.failPermission(epoch, networkFallback ? 'network-error' : 'business-error', message);
  },
  retryPermission() {
    if (this.data.clubId) this.checkPermission();
    else this.resolveClub();
  },
  resolveClub() {
    const epoch = this.beginPermissionCheck();
    const that = this;
    app.sendRequest({
      hideLoading: true, url: '/api/club/my', method: 'POST',
      autoErrorToast: false, // 失败由整页 auto-back fail 半屏讲原因,不再叠 toast
      success(res) {
        if (epoch !== that._permissionEpoch) return;
        const owned = that.ownedFromResponse(res);
        if (!owned) {
          that.failPermission(epoch, 'business-error', bizFailureMessage(res, '俱乐部权限数据暂时不可用'));
          return;
        }
        if (owned.length) {
          that.setData({ clubId: owned[0].id, clubName: owned[0].name || '' });
          that.allowPermission(epoch);
        } else {
          that.denyPermission(epoch, '还没有可管理的俱乐部', '成为俱乐部主理人后，可在这里查看报名名册');
        }
      },
      successStatusAbnormal(res, statusCode) {
        that.settlePermissionReadFailure(epoch, res, statusCode, false);
      },
      fail(value, statusCode) {
        that.settlePermissionReadFailure(epoch, value, statusCode, true);
      },
    });
  },

  // 权限校验与 /api/club/topic-registrations 保持同一口径:主理人或管理员可看名册
  // (2026-08-26 后端已放开管理员只读)。退款权不在前端猜:初值按 isOwner,
  checkPermission() {
    const epoch = this.beginPermissionCheck();
    const that = this;
    app.sendRequest({
      hideLoading: true, url: '/api/club/detail', method: 'POST',
      autoErrorToast: false, // 失败由整页 auto-back fail 半屏讲原因,不再叠 toast
      data: jsonBody({ id: that.data.clubId }), header: jsonHeader(),
      success(res) {
        if (epoch !== that._permissionEpoch) return;
        if (!res || res.code != '200' || !isRecord(res.data)) {
          that.failPermission(epoch, 'business-error', bizFailureMessage(res, '俱乐部权限数据暂时不可用'));
          return;
        }
        const club = res.data;
        if (club.viewerIdentityUnavailable) {
          that.failPermission(epoch, 'business-error', '俱乐部权限数据暂时不可用');
          return;
        }
        if (club.isOwner || club.viewerIsAdmin) {
          that.allowPermission(epoch);
          return;
        }
        that.denyPermission(epoch, '没有权限查看报名名册', '仅主理人或管理员可查看报名名册');
      },
      successStatusAbnormal(res, statusCode) {
        that.settlePermissionReadFailure(epoch, res, statusCode, false);
      },
      fail(value, statusCode) {
        that.settlePermissionReadFailure(epoch, value, statusCode, true);
      },
    });
  },

  handleOwnerReadPermissionFailure(value, statusCode) {
    if (!isPermissionFailure(value, statusCode)) return false;
    const code = permissionFailureCode(value, statusCode);
    const message = String(value && (value.msg || value.message)
      || (code === 403 ? '仅主理人或管理员可查看报名名册' : '登录状态已变化，请重新检查查看权限'));
    this.clearOwnerSnapshot(code === 403 ? 'denied' : 'business-error', message);
    return true;
  },

  loadTeams() {
    const epoch = (this._teamsEpoch || 0) + 1;
    this._teamsEpoch = epoch;
    const that = this;
    const hadSnapshot = this.data.teamsState === 'ready';
    const oldTeams = this.data.teams || [];
    this.setData({
      teamsState: hadSnapshot ? 'ready' : 'loading',
      refreshing: hadSnapshot,
      staleError: '',
    });
    app.sendRequest({
      complete() { wx.stopPullDownRefresh(); },
      hideLoading: true, url: '/api/club/topics', method: 'POST', data: jsonBody({ id: that.data.clubId }), header: jsonHeader(),
      success(res) {
        if (epoch !== that._teamsEpoch) return;
        if (res.code != '200' || !isRecordList(res.data)) {
          if (that.handleOwnerReadPermissionFailure(res)) return;
          if (hadSnapshot) {
            that.setData({ refreshing: false, staleErrorKind: 'data', staleError: bizFailureMessage(res, '报名名册更新失败，当前展示上次内容') });
          } else {
            that.setData({ teams: [], teamsState: 'business-error', refreshing: false });
          }
          return;
        }
        const rows = res.data;
        const teams = rows.map(function (t) {
          const previous = oldTeams.find(function (item) { return String(item.id) === String(t.id); });
          return {
            id: t.id, name: t.name, imgUrl: t.imgUrl,
            signupCount: t.signupCount || 0,
            dateText: dateOf(t.startDate),
            _open: previous ? !!previous._open : false,
            _detailState: previous && previous._detailState === 'ready' ? 'ready' : 'idle',
            tickets: previous && previous._detailState === 'ready' ? previous.tickets : [],
            summary: previous && previous._detailState === 'ready' ? previous.summary : null,
          };
        });
        // E-07:从某个主题进来时,到达即展开那一团(名字在卡上,位置不藏)
        const focusId = that._focusTopicId;
        if (focusId != null) {
          const focusIndex = teams.findIndex(function (t) { return String(t.id) === String(focusId); });
          if (focusIndex >= 0 && teams[focusIndex]._detailState !== 'ready') {
            teams[focusIndex]._open = true;
            that.setData({ teams: teams, teamsState: 'ready', refreshing: false, staleError: '' });
            that.loadTeamDetail(focusIndex, teams[focusIndex].id);
            return;
          }
        }
        that.setData({ teams: teams, teamsState: 'ready', refreshing: false, staleError: '' });
      },
      successStatusAbnormal(res, statusCode) {
        if (epoch !== that._teamsEpoch) return;
        if (that.handleOwnerReadPermissionFailure(res, statusCode)) return;
        if (hadSnapshot) {
          that.setData({ refreshing: false, staleErrorKind: 'data', staleError: '报名名册更新失败，当前展示上次内容' });
        } else {
          that.setData({ teams: [], teamsState: 'business-error', refreshing: false });
        }
      },
      fail(value, statusCode) {
        if (epoch !== that._teamsEpoch) return;
        if (that.handleOwnerReadPermissionFailure(value, statusCode)) return;
        if (hadSnapshot) {
          that.setData({ refreshing: false, staleErrorKind: 'network', staleError: '报名名册更新失败，请检查网络后重试' });
        } else {
          that.setData({ teams: [], teamsState: 'network-error', refreshing: false });
        }
      },
    });
  },

  retryLoadTeams() { this.loadTeams(); },

  toggleTeam(e) {
    const idx = e.currentTarget.dataset.index;
    const team = this.data.teams[idx];
    if (!team) return;
    const open = !team._open;
    this.setData({ ['teams[' + idx + ']._open']: open });
    if (open && team._detailState !== 'ready' && team._detailState !== 'loading') this.loadTeamDetail(idx, team.id);
  },

  loadTeamDetail(idx, topicId) {
    this._detailEpoch = this._detailEpoch || Object.create(null);
    const detailKey = String(topicId);
    const epoch = (this._detailEpoch[detailKey] || 0) + 1;
    this._detailEpoch[detailKey] = epoch;
    const that = this;
    this.setData({ ['teams[' + idx + ']._detailState']: 'loading' });
    // 名册走主理人/管理员鉴权专用接口(不再用公开 info-to-user,避免报名者明细泄露)
    app.sendRequest({
      hideLoading: true, url: '/api/club/topic-registrations', method: 'POST',
      // 后端 @RequestBody:必须 JSON,裸对象会走 urlencoded → 415 名册打不开
      data: jsonBody({ clubId: that.data.clubId, topicId: topicId }), header: jsonHeader(),
      success(res) {
        if (!that._detailEpoch || epoch !== that._detailEpoch[detailKey]) return;
        if (res.code != '200' || !isRecord(res.data)
            || !isRecordList(res.data.omsTicketList)
            || !res.data.omsTicketList.every(function (ticket) {
              return ticket.cmsRegistrationList == null || isRecordList(ticket.cmsRegistrationList);
            })) {
          if (that.handleOwnerReadPermissionFailure(res)) return;
          const targetIndex = that.findTeamIndex(topicId);
          if (targetIndex < 0) return;
          that.setData({ ['teams[' + targetIndex + ']._detailState']: 'business-error' });
          return;
        }
        const targetIndex = that.findTeamIndex(topicId);
        if (targetIndex < 0) return;
        const tickets = res.data.omsTicketList.map(function (tk) {
          const regs = tk.cmsRegistrationList || [];
          return {
            name: tk.name,
            mode: tk.mode,
            totalInventory: tk.totalInventory,
            signups: regs.length,
            regs: regs.map(function (r) {
              return {
                id: r.id,                       // 报名ID(退款用)
                avatar: r.avatar,
                nickname: r.nickname,
                memberId: r.memberId,
                // 可退:已支付(2)且未核销(verificationStatus!=1)
                refundable: r.paymentStatus == 2 && r.verificationStatus != 1,
                // 核销态原来只用来算「能不能退款」,名册上看不出谁到场了 —— 那正是核销台账要回答的。
                // ⚠️ 后端没下发 verificationStatus 时给「—」:
                //    「不知道核销没有」和「没核销」在带队现场是两个不同的判断。
                checkinText: r.verificationStatus == null ? '—'
                  : (r.verificationStatus == 1 ? '已核销' : '待核销'),
                checkinKind: r.verificationStatus == null ? 'unknown'
                  : (r.verificationStatus == 1 ? 'done' : 'pending'),
              };
            }),
            signupDeadlineText: tk.signupDeadline ? String(tk.signupDeadline).slice(0, 16).replace('T', ' ') : '',
            teamStatusText: teamStatusText(tk.teamStatus),
            paidCount: regs.length,
            refundableCount: regs.filter(function (r) {
              return r.paymentStatus == 2 && r.verificationStatus != 1;
            }).length,
          };
        });
        const summary = tickets.reduce(function (acc, tk) {
          acc.paidCount += tk.paidCount;
          acc.refundableCount += tk.refundableCount;
          if (!acc.signupDeadlineText && tk.signupDeadlineText) acc.signupDeadlineText = tk.signupDeadlineText;
          if (tk.teamStatusText === '已成团') acc.teamStatusText = tk.teamStatusText;
          else if (tk.teamStatusText === '已散团' && acc.teamStatusText !== '已成团') acc.teamStatusText = tk.teamStatusText;
          return acc;
        }, { paidCount: 0, refundableCount: 0, signupDeadlineText: '', teamStatusText: '募集中' });
        const teams = (that.data.teams || []).slice();
        teams[targetIndex] = Object.assign({}, teams[targetIndex], {
          tickets: tickets,
          summary: summary,
          _detailState: 'ready',
        });
        // 2026-09-09:退款挪到核销详情页,这里原来那段「未知回执落地后回读本团、
        // 按结果给可重试提示」也随之搬走 —— 名册已经不再是退款的发起点。
        that.setData({ teams: teams });
      },
      successStatusAbnormal(res, statusCode) {
        if (!that._detailEpoch || epoch !== that._detailEpoch[detailKey]) return;
        if (that.handleOwnerReadPermissionFailure(res, statusCode)) return;
        const targetIndex = that.findTeamIndex(topicId);
        if (targetIndex < 0) return;
        that.setData({ ['teams[' + targetIndex + ']._detailState']: 'business-error' });
      },
      fail(value, statusCode) {
        if (!that._detailEpoch || epoch !== that._detailEpoch[detailKey]) return;
        if (that.handleOwnerReadPermissionFailure(value, statusCode)) return;
        const targetIndex = that.findTeamIndex(topicId);
        if (targetIndex < 0) return;
        that.setData({ ['teams[' + targetIndex + ']._detailState']: 'network-error' });
      },
    });
  },

  retryTeamDetail(e) {
    const ds = e.currentTarget.dataset;
    this.loadTeamDetail(ds.index, ds.topicId);
  },

  // Figma K3:名册上只有「已核销/待核销」四个字,票种、实付、门店、操作人这些
  // 只有凭证页装得下 —— 点这一格进去看这条报名单的完整核销事实。
  goCheckinDetail(e) {
    const regId = e.currentTarget.dataset.regid;
    if (regId == null || regId === '' || !this.data.clubId) return;
    // E-08(2026-09-16):核销详情里可能清退退款,返回时必须重拉名册 —— 否则可退款人数、
    // 「已核销」标记停在退款前。用一次性标记而不是无条件 onShow 重拉(避免每次返回都打接口)。
    this._refreshOnShow = true;
    wx.navigateTo({ url: '/pages/club/checkin-detail/index?clubId=' + this.data.clubId + '&registrationId=' + regId });
  },

  findTeamIndex(topicId) {
    return (this.data.teams || []).findIndex(function (team) {
      return String(team.id) === String(topicId);
    });
  },

  goUserInfo(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: '/pages/userinfo/userinfo?userId=' + id });
  },

  // 2026-09-09:退款入口按用户裁决从名册行内挪到了核销详情底部,
  // 这里整套退款机器(single-flight epoch、未知回执落盘与回读、按团重定位)
  // 随之搬走。搬去的位置只有一条报名单,不需要按团重定位那两段。
  clearOwnerSnapshot(state, message) {
    this._permissionEpoch = (this._permissionEpoch || 0) + 1;
    this._teamsEpoch = (this._teamsEpoch || 0) + 1;
    this._detailEpoch = Object.create(null);
    const denied = state === 'denied';
    this.setData({
      teams: [],
      teamsState: 'loading',
      refreshing: false,
      staleError: '',
      permissionState: state,
      permissionError: denied ? '' : message,
      permissionDeniedTitle: denied ? '没有权限查看报名名册' : this.data.permissionDeniedTitle,
      permissionDeniedSub: denied ? (message || '仅主理人或管理员可查看报名名册') : this.data.permissionDeniedSub,
    });
  },


});
