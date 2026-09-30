const toast = require('../../../utils/toast.js');
const { chinaParts } = require('../../../utils/datetime.js');
const app = getApp();
const merchantTheme = require('../../../utils/merchant-theme.js');
const { isRecord, isRecordList, isBizOk } = require('../../../utils/response-shape.js');
const {
  inactiveAccess,
  normalizeMerchantAccess,
  roleName,
} = require('../../../utils/merchant-access-policy.js');
const { ensureSession } = require('../utils/session/ensure-session.js');

function requestId(prefix) {
  return [prefix, Date.now(), Math.random().toString(36).slice(2, 12)].join('-');
}

function isAuthenticationFailure(res, status) {
  const candidates = [status, res && res.statusCode, res && res.code];
  for (let index = 0; index < candidates.length; index += 1) {
    const code = String(candidates[index] == null ? '' : candidates[index]);
    if (code === '401' || code === '2') return true;
  }
  return false;
}

const REQUEST_INTENT_STORAGE_KEY = 'merchant_operator_request_intents_v1';
const REQUEST_INTENT_TTL_MS = 24 * 60 * 60 * 1000;
const INVITE_HANDOFF_KEY = 'merchantTeamInviteHandoffV1';
const INVITE_HANDOFF_TTL_MS = 10 * 60 * 1000;
// 与后端 MerchantRoleCode.operatorRoles 对齐(含店长),/operators/roles 会把它们全下发给岗位选择器。
const OPERATOR_ROLES = ['MERCHANT_MANAGER', 'MERCHANT_CHECKIN', 'MERCHANT_MARKETING', 'MERCHANT_FINANCE'];
const OPERATOR_STATUSES = ['ACTIVE', 'REVOKED'];
const INVITE_STATUSES = ['PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED'];

function requestIntentKey(merchantId, roleCode) {
  return `${merchantId}:${roleCode}`;
}

function requestIntentStorageKey() {
  const memberId = app.getUserID && app.getUserID();
  return memberId === null || memberId === undefined || memberId === ''
    ? '' : REQUEST_INTENT_STORAGE_KEY + ':m' + memberId;
}

function readRequestIntents() {
  try {
    wx.removeStorageSync(REQUEST_INTENT_STORAGE_KEY);
    const key = requestIntentStorageKey();
    const value = key ? wx.getStorageSync(key) : null;
    return isRecord(value) ? value : {};
  } catch (error) {
    return {};
  }
}

function writeRequestIntents(intents) {
  try {
    const key = requestIntentStorageKey();
    if (!key) return;
    if (Object.keys(intents).length) wx.setStorageSync(key, intents);
    else wx.removeStorageSync(key);
  } catch (error) {
    // Storage is only crash recovery; the in-memory request id remains authoritative for this page instance.
  }
}

function loadRequestIntent(key) {
  const intents = readRequestIntents();
  const intent = intents[key];
  const valid = isRecord(intent)
    && typeof intent.requestId === 'string'
    && /^[A-Za-z0-9._:-]{1,64}$/.test(intent.requestId)
    && Number(intent.expiresAt) > Date.now();
  if (valid) return intent.requestId;
  if (Object.prototype.hasOwnProperty.call(intents, key)) {
    delete intents[key];
    writeRequestIntents(intents);
  }
  return '';
}

function saveRequestIntent(key, value) {
  const intents = readRequestIntents();
  intents[key] = { requestId: value, expiresAt: Date.now() + REQUEST_INTENT_TTL_MS };
  writeRequestIntents(intents);
}

function clearRequestIntent(key) {
  const intents = readRequestIntents();
  if (!Object.prototype.hasOwnProperty.call(intents, key)) return;
  delete intents[key];
  writeRequestIntents(intents);
}

function teamMutationIntentKey(action, merchantId, targetId, version, payload) {
  return `team:${action}:${merchantId}:${targetId}:${version}:${payload}`;
}

function stableMutationRequestId(intentKey, prefix) {
  const value = loadRequestIntent(intentKey) || requestId(prefix);
  saveRequestIntent(intentKey, value);
  return value;
}

function isExplicitClientError(res) {
  const code = Number(res && res.code);
  return code >= 400 && code < 500;
}

function isOperatorMutationReceipt(row, targetId, minimumVersion, requiredStatus) {
  return isRecord(row)
    && isStrictPositiveId(row.id)
    && Number(row.id) === Number(targetId)
    && OPERATOR_ROLES.includes(row.roleCode)
    && OPERATOR_STATUSES.includes(row.status)
    && (!requiredStatus || row.status === requiredStatus)
    && isStrictVersion(row.version)
    && Number(row.version) >= Number(minimumVersion);
}

function isInviteMutationReceipt(row, targetId, minimumVersion, requiredStatus) {
  return isRecord(row)
    && isStrictPositiveId(row.id)
    && Number(row.id) === Number(targetId)
    && OPERATOR_ROLES.includes(row.roleCode)
    && INVITE_STATUSES.includes(row.status)
    && (!requiredStatus || row.status === requiredStatus)
    && isStrictVersion(row.version)
    && Number(row.version) >= Number(minimumVersion);
}

function validInviteToken(value) {
  const token = typeof value === 'string' ? value.trim() : '';
  return token.length >= 16 && token.length <= 256 ? token : '';
}

function saveInviteHandoff(token) {
  const value = validInviteToken(token);
  if (!value) return;
  if (!app.globalData || typeof app.globalData !== 'object') app.globalData = {};
  app.globalData[INVITE_HANDOFF_KEY] = { value, expiresAt: Date.now() + INVITE_HANDOFF_TTL_MS };
}

function clearInviteHandoff() {
  if (app.globalData && typeof app.globalData === 'object') delete app.globalData[INVITE_HANDOFF_KEY];
}

function loadInviteHandoff() {
  const handoff = app.globalData && app.globalData[INVITE_HANDOFF_KEY];
  const value = isRecord(handoff) && Number(handoff.expiresAt) > Date.now()
    ? validInviteToken(handoff.value) : '';
  if (!value) clearInviteHandoff();
  return value;
}

// 后端 LocalDateTime 下发 ISO「2026-09-30T12:00:00」;旧写法 replace(-,/) 会把它弄成非法串 ⇒ 恒显示「—」。
function formatDate(value) {
  const p = chinaParts(value);
  if (!p) return '—';
  const pad = (n) => (n < 10 ? `0${n}` : String(n));
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hours)}:${pad(p.minutes)}`;
}

function shapeOperator(row) {
  const source = row;
  if (!isStrictPositiveId(source && source.id)
      || !OPERATOR_ROLES.includes(source.roleCode)
      || !OPERATOR_STATUSES.includes(source.status)
      || !isStrictVersion(source.version)
      || !isValidDate(source.acceptedAt)
      || !nullableString(source.nickname)
      || !nullableString(source.avatar)) return null;
  return {
    id: source.id,
    nickname: typeof source.nickname === 'string' && source.nickname.trim() ? source.nickname.trim() : '未设置昵称',
    avatar: typeof source.avatar === 'string' ? source.avatar : '',
    roleCode: source.roleCode || '',
    roleName: roleName(source.roleCode),
    status: source.status || '',
    acceptedAtText: formatDate(source.acceptedAt),
    version: Number.isInteger(Number(source.version)) ? Number(source.version) : null,
  };
}

function shapeInvite(row) {
  const source = row;
  if (!isStrictPositiveId(source && source.id)
      || !OPERATOR_ROLES.includes(source.roleCode)
      || !INVITE_STATUSES.includes(source.status)
      || !isStrictVersion(source.version)
      || !isValidDate(source.expiresAt)) return null;
  const displayRoleName = roleName(source.roleCode);
  return {
    id: source.id,
    roleCode: source.roleCode || '',
    roleName: displayRoleName,
    roleInitial: displayRoleName.slice(0, 1),
    status: source.status || '',
    expiresAtText: formatDate(source.expiresAt),
    version: Number.isInteger(Number(source.version)) ? Number(source.version) : null,
  };
}

function isStrictPositiveId(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isStrictVersion(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isValidDate(value) {
  return (typeof value === 'string' || typeof value === 'number')
    && String(value).trim() !== '' && Number.isFinite(new Date(value).getTime());
}

function nullableString(value) {
  return value === null || value === undefined || typeof value === 'string';
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    accessState: 'loading',
    accessError: '',
    access: inactiveAccess(),
    teamState: 'idle',
    teamError: '',
    operators: [],
    pendingInvites: [],
    roles: [],
    roleError: '',
    hasIncomingInvite: false,
    accepting: false,
    acceptResult: '',
    roleSheet: { show: false, mode: '', operator: null },
    submitting: false,
    createdInvite: null,
    canShareCreatedInvite: false,
    storeDetailsExpanded: false,
  },

  onLoad(options) {
    const gd = app.globalData || {};
    const sys = wx.getSystemInfoSync();
    const routeToken = validInviteToken(options && options.invite);
    this._incomingInviteToken = routeToken || loadInviteHandoff();
    if (routeToken) saveInviteHandoff(routeToken);
    this._inviteRequestIds = Object.create(null);
    this._acceptInviteRequestId = '';
    this.setData({
      statusBarHeight: gd.statusBarHeight || sys.statusBarHeight || 20,
      navBarHeight: gd.navBarHeight || 44,
      hasIncomingInvite: !!this._incomingInviteToken,
    });
  },

  onShow() {
    merchantTheme.merchantPageShow();
    this.enterTeam(false);
  },

  // 入口:未登录先静默登录,成功自动继续;失败只留页内错误态(retryAccess 重试)。
  enterTeam(authRetryUsed) {
    this._authRetryUsed = authRetryUsed === true;
    if (app.getUserID()) {
      this.loadAccess();
      return;
    }
    this.setData({ accessState: 'loading', accessError: '' });
    const that = this;
    ensureSession(app).then(function (ok) {
      if (that._inviteRequestIds === null) return; // 已卸载
      if (!ok || !app.getUserID()) {
        that.setData({ accessState: 'error', accessError: '登录失败，请重试' });
        return;
      }
      that.enterTeam(that._authRetryUsed);
    });
  },

  // 401:静默重登一次后自动重载;重登失败落页内错误态,不整屏「去登录」。
  recoverSession() {
    if (this._authRetryUsed) {
      this.setData({ accessState: 'error', accessError: '登录已失效，请重新登录' });
      return;
    }
    this._authRetryUsed = true;
    const that = this;
    ensureSession(app).then(function (ok) {
      if (that._inviteRequestIds === null) return; // 已卸载
      if (!ok || !app.getUserID()) {
        that.setData({ accessState: 'error', accessError: '登录失败，请重试' });
        return;
      }
      that.loadAccess();
    });
  },

  onHide() { merchantTheme.merchantPageRestore(); },

  onUnload() {
    merchantTheme.merchantPageRestore();
    this._incomingInviteToken = '';
    this._createdInviteToken = '';
    this._inviteRequestIds = null;
    this._acceptInviteRequestId = '';
    this._loadVersion = (this._loadVersion || 0) + 1;
  },

  loadAccess() {
    if (!app.getUserID()) {
      // 会话还没落地:静默登录,失败由 enterTeam 落页内错误态。
      this.enterTeam(this._authRetryUsed === true);
      return;
    }
    const version = (this._loadVersion || 0) + 1;
    this._loadVersion = version;
    this.setData({ accessState: 'loading', accessError: '' });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/merchant/access/me',
      method: 'POST',
      success: (res) => {
        if (version !== this._loadVersion) return;
        if (isAuthenticationFailure(res)) {
          this.recoverSession();
          return;
        }
        if (!(res && (res.code === 200 || res.code === '200') && isRecord(res.data))) {
          this.setData({ accessState: 'error', accessError: isBizOk(res) ? '经营身份加载失败' : app.getRequestErrorMessage(res, '经营身份加载失败') });
          return;
        }
        const access = normalizeMerchantAccess(res.data);
        if (!access.active && !this._incomingInviteToken) {
          // 没有经营团队身份的账号本没有这一页(玩家没有入口);深链误入静默回会员中心。
          wx.switchTab({ url: '/pages/member/index/index' });
          return;
        }
        this.setData({
          access,
          accessState: access.active ? 'ready' : 'invite',
          accessError: '',
        });
        if (access.canManageOperators) {
          this.loadRoles();
          this.loadTeam();
        } else {
          this.setData({ teamState: 'idle', operators: [], pendingInvites: [] });
        }
      },
      fail: (res, status) => {
        if (version !== this._loadVersion) return;
        if (isAuthenticationFailure(res, status)) {
          this.recoverSession();
          return;
        }
        this.setData({ accessState: 'error', accessError: '网络连接失败，请稍后重试' });
      },
    });
  },

  retryAccess() { this.enterTeam(false); },
  // R9-22:工作台不在原生 tabBar 里,switchTab 必然 switchTab:fail。商家页统一 reLaunch
  // (同 components/tabBar 与 relation/index 的「返回工作台」),并让工作台成为根页。
  goWorkbench() { wx.reLaunch({ url: '/pages/merchant/index/index' }); },
  toggleStoreDetails() { this.setData({ storeDetailsExpanded: !this.data.storeDetailsExpanded }); },

  loadRoles() {
    const requestToken = (this._rolesRequestToken || 0) + 1;
    this._rolesRequestToken = requestToken;
    const loadVersion = this._loadVersion || 0;
    const isLatest = () => requestToken === this._rolesRequestToken
      && loadVersion === (this._loadVersion || 0);
    this.setData({ roleError: '' });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/merchant/operators/roles',
      method: 'POST',
      success: (res) => {
        if (!isLatest()) return;
        if (res && (res.code === 200 || res.code === '200') && isRecordList(res.data)) {
          this.setData({
            roles: res.data
              .filter((item) => isRecord(item) && typeof item.roleCode === 'string')
              .map((item) => ({
                roleCode: item.roleCode,
                name: typeof item.name === 'string' ? item.name : roleName(item.roleCode),
                permissionText: this.rolePermissionText(item.permissions),
              })),
            roleError: '',
          });
          return;
        }
        this.setData({ roleError: app.getRequestErrorMessage(res, '岗位列表加载失败') });
      },
      fail: () => {
        if (isLatest()) this.setData({ roleError: '网络连接失败，岗位列表未更新' });
      },
    });
  },

  rolePermissionText(permissions) {
    const list = Array.isArray(permissions) ? permissions : [];
    const labels = [];
    if (list.includes('merchant:project:manage')) labels.push('项目');
    if (list.includes('merchant:verify')) labels.push('核销');
    if (list.includes('merchant:crm:read')) labels.push('客户');
    if (list.includes('merchant:marketing:write')) labels.push('营销');
    if (list.includes('merchant:finance:read')) labels.push('财务');
    return labels.length ? labels.join('、') : '基础经营信息';
  },

  loadTeam() {
    this.setData({ teamState: 'loading', teamError: '' });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/merchant/operators/list',
      method: 'POST',
      success: (res) => {
        const data = res && res.data;
        if (!(res && (res.code === 200 || res.code === '200') && isRecord(data)
            && isRecordList(data.operators) && isRecordList(data.invites))) {
          this.setData({ teamState: 'error', teamError: app.getRequestErrorMessage(res, '团队名单加载失败') });
          return;
        }
        const operators = data.operators.map(shapeOperator);
        const invites = data.invites.map(shapeInvite);
        if (operators.some(item => item === null) || invites.some(item => item === null)) {
          this.setData({ teamState: 'error', teamError: '团队名单数据格式异常，请稍后重试' });
          return;
        }
        this.setData({
          teamState: 'ready',
          teamError: '',
          operators: operators.filter(item => item.status === 'ACTIVE'),
          pendingInvites: invites.filter(item => item.status === 'PENDING'),
        });
      },
      fail: () => this.setData({ teamState: 'error', teamError: '网络连接失败，请稍后重试' }),
    });
  },

  retryTeam() { this.loadTeam(); },

  openInviteRoleSheet() {
    if (!this.data.access.canManageOperators || this.data.submitting) return;
    if (!this.data.roles.length) {
      toast('岗位列表还没加载好，请稍后再试');
      this.loadRoles();
      return;
    }
    this.setData({ roleSheet: { show: true, mode: 'invite', operator: null } });
  },

  openOperatorRoleSheet(event) {
    const id = Number(event.currentTarget.dataset.id);
    const operator = this.data.operators.find((item) => Number(item.id) === id);
    if (!operator || !this.data.roles.length || this.data.submitting) return;
    this.setData({ roleSheet: { show: true, mode: 'operator', operator } });
  },

  closeRoleSheet() { this.setData({ roleSheet: { show: false, mode: '', operator: null } }); },

  onRolePick(event) {
    const roleCode = event.currentTarget.dataset.role;
    const role = this.data.roles.find((item) => item.roleCode === roleCode);
    if (!role || this.data.submitting) return;
    if (this.data.roleSheet.mode === 'operator' && this.data.roleSheet.operator) {
      this.updateOperatorRole(this.data.roleSheet.operator, roleCode);
      return;
    }
    this.createInvite(roleCode);
  },

  createInvite(roleCode) {
    const merchantId = Number(this.data.access && this.data.access.merchant && this.data.access.merchant.id);
    if (!Number.isInteger(merchantId) || merchantId <= 0) {
      toast('经营身份无效，请刷新后重试');
      return;
    }
    this.setData({ submitting: true });
    if (!this._inviteRequestIds) this._inviteRequestIds = Object.create(null);
    const intentKey = requestIntentKey(merchantId, roleCode);
    const reqId = this._inviteRequestIds[intentKey]
      || loadRequestIntent(intentKey)
      || requestId('merchant-invite');
    this._inviteRequestIds[intentKey] = reqId;
    saveRequestIntent(intentKey, reqId);
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/merchant/operators/invite',
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ roleCode, requestId: reqId }),
      success: (res) => {
        const data = res && res.data;
        if (!(res && (res.code === 200 || res.code === '200') && isRecord(data) && isRecord(data.invite))) {
          const code = Number(res && res.code);
          if (code >= 400 && code < 500) {
            delete this._inviteRequestIds[intentKey];
            clearRequestIntent(intentKey);
          }
          toast(app.getRequestErrorMessage(res, '邀请创建失败'));
          return;
        }
        delete this._inviteRequestIds[intentKey];
        clearRequestIntent(intentKey);
        const rawToken = typeof data.token === 'string' ? data.token.trim() : '';
        this._createdInviteToken = rawToken.length >= 16 ? rawToken : '';
        this.setData({
          roleSheet: { show: false, mode: '', operator: null },
          createdInvite: {
            id: data.invite.id,
            roleName: roleName(data.invite.roleCode),
            expiresAtText: formatDate(data.invite.expiresAt),
          },
          canShareCreatedInvite: !!this._createdInviteToken,
        });
        if (!this._createdInviteToken) {
          toast('分享凭证只显示一次，请撤销后重建');
        }
        this.loadTeam();
      },
      fail: () => toast('网络连接失败，请稍后重试'),
      complete: () => this.setData({ submitting: false }),
    });
  },

  updateOperatorRole(operator, roleCode) {
    if (operator.version === null || operator.roleCode === roleCode) {
      this.closeRoleSheet();
      return;
    }
    const merchantId = Number(this.data.access && this.data.access.merchant && this.data.access.merchant.id);
    if (!Number.isInteger(merchantId) || merchantId <= 0) {
      toast('经营身份无效，请刷新后重试');
      return;
    }
    const intentKey = teamMutationIntentKey(
      'role', merchantId, operator.id, operator.version, roleCode,
    );
    const reqId = stableMutationRequestId(intentKey, 'merchant-role');
    this.setData({ submitting: true });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/merchant/operators/role',
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: JSON.stringify({
        operatorId: operator.id,
        roleCode,
        version: operator.version,
        requestId: reqId,
      }),
      success: (res) => {
        const serverOk = res && (res.code === 200 || res.code === '200');
        const receipt = res && res.data;
        const exact = serverOk
          && isOperatorMutationReceipt(receipt, operator.id, operator.version + 1, 'ACTIVE')
          && receipt.roleCode === roleCode
          && Number(receipt.version) === Number(operator.version) + 1
          && receipt.mutationState === 'EXACT_RESULT';
        const later = serverOk
          && isOperatorMutationReceipt(receipt, operator.id, operator.version + 2)
          && receipt.mutationState === 'LATER_AUTHORITATIVE';
        if (later) {
          clearRequestIntent(intentKey);
          this.closeRoleSheet();
          toast('岗位后续已变化，已刷新最新名单');
          this.loadTeam();
          return;
        }
        if (!exact) {
          if (isExplicitClientError(res)) clearRequestIntent(intentKey);
          toast(app.getRequestErrorMessage(res, '岗位修改失败'));
          return;
        }
        clearRequestIntent(intentKey);
        this.closeRoleSheet();
        toast.success('岗位已更新');
        this.loadTeam();
      },
      fail: () => toast('网络连接失败，请稍后重试'),
      complete: () => this.setData({ submitting: false }),
    });
  },

  askRemoveOperator(event) {
    const id = Number(event.currentTarget.dataset.id);
    const target = this.data.operators.find((item) => Number(item.id) === id);
    if (!target) return;
    // 三段式第一段:文案改由 utils/danger-actions.js 统一给(原来只有一句话,不列后果)
    this._dangerConfirm = { show: false, type: 'operator', target, title: '', content: '' };
    const dc = this.selectComponent && this.selectComponent('#dc');
    if (dc) dc.open('merchant.operator.remove', { name: target.nickname });
  },

  askRevokeInvite(event) {
    const id = Number(event.currentTarget.dataset.id);
    const target = this.data.pendingInvites.find((item) => Number(item.id) === id);
    if (!target) return;
    this._dangerConfirm = { show: false, type: 'invite', target, title: '', content: '' };
    const dc = this.selectComponent && this.selectComponent('#dc');
    if (dc) dc.open('merchant.invite.revoke', {});
  },

  cancelDanger() {
    this._dangerConfirm = { show: false, type: '', target: null, title: '', content: '' };
  },

  /** 三段式第二段:确认弹窗里点了危险键才真的发请求。 */
  confirmDanger() {
    const confirm = this._dangerConfirm || {};
    const target = confirm && confirm.target;
    if (!target || target.version === null || this.data.submitting) return;
    const dc = this.selectComponent && this.selectComponent('#dc');
    if (dc) dc.busyOn();
    const isOperator = confirm.type === 'operator';
    const merchantId = Number(this.data.access && this.data.access.merchant && this.data.access.merchant.id);
    if (!Number.isInteger(merchantId) || merchantId <= 0) {
      toast('经营身份无效，请刷新后重试');
      return;
    }
    const reason = isOperator ? '店主在经营团队页移除成员' : '店主在经营团队页撤销邀请';
    const action = isOperator ? 'remove' : 'revoke-invite';
    const intentKey = teamMutationIntentKey(
      action, merchantId, target.id, target.version, reason,
    );
    const reqId = stableMutationRequestId(
      intentKey, isOperator ? 'merchant-remove' : 'merchant-revoke-invite',
    );
    this.setData({ submitting: true });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: isOperator ? '/api/merchant/operators/remove' : '/api/merchant/operators/invite/revoke',
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: JSON.stringify(isOperator ? {
        operatorId: target.id,
        version: target.version,
        reason,
        requestId: reqId,
      } : {
        inviteId: target.id,
        version: target.version,
        reason,
        requestId: reqId,
      }),
      success: (res) => {
        const serverOk = res && (res.code === 200 || res.code === '200');
        const receipt = res && res.data;
        const receiptOk = isOperator
          ? isOperatorMutationReceipt(receipt, target.id, target.version + 1, 'REVOKED')
          : isInviteMutationReceipt(receipt, target.id, target.version + 1, 'REVOKED');
        const exact = serverOk && receiptOk
          && Number(receipt.version) === Number(target.version) + 1
          && receipt.mutationState === 'EXACT_RESULT';
        const laterReceipt = isOperator
          ? isOperatorMutationReceipt(receipt, target.id, target.version + 2)
          : isInviteMutationReceipt(receipt, target.id, target.version + 2);
        const later = serverOk && laterReceipt
          && receipt.mutationState === 'LATER_AUTHORITATIVE';
        if (later) {
          clearRequestIntent(intentKey);
          this.reportDanger(false, '目标状态后续已变化，已刷新最新名单');
          this.cancelDanger();
          this.loadTeam();
          return;
        }
        if (!exact) {
          if (isExplicitClientError(res)) clearRequestIntent(intentKey);
          this.reportDanger(false, app.getRequestErrorMessage(res, isOperator ? '成员移除失败' : '邀请撤销失败'));
          return;
        }
        clearRequestIntent(intentKey);
        this.cancelDanger();
        if (!isOperator && this.data.createdInvite && Number(this.data.createdInvite.id) === Number(target.id)) {
          this._createdInviteToken = '';
          this.setData({ createdInvite: null, canShareCreatedInvite: false });
        }
        // 三段式第三段:结果确认卡
        this.reportDanger(true);
        this.loadTeam();
      },
      fail: () => this.reportDanger(false, '网络连接失败，请稍后重试'),
      complete: () => this.setData({ submitting: false }),
    });
  },

  /** 把执行结果回给确认组件:成功→结果卡,失败→原地重试。 */
  reportDanger(ok, text) {
    const dc = this.selectComponent && this.selectComponent('#dc');
    if (!dc) { toast(ok ? '已完成' : (text || '操作失败')); return; }
    if (ok) dc.done();
    else dc.failed(text || '操作失败');
  },

  acceptIncomingInvite() {
    if (!this._incomingInviteToken || this.data.accepting) return;
    this.setData({ accepting: true, acceptResult: '' });
    const reqId = this._acceptInviteRequestId || requestId('merchant-accept');
    this._acceptInviteRequestId = reqId;
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/merchant/operators/invite/accept',
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ token: this._incomingInviteToken, requestId: reqId }),
      success: (res) => {
        if (!(res && (res.code === 200 || res.code === '200'))) {
          const code = Number(res && res.code);
          if (code >= 400 && code < 500) {
            this._acceptInviteRequestId = '';
            this._incomingInviteToken = '';
            clearInviteHandoff();
            this.setData({ hasIncomingInvite: false });
          }
          this.setData({ acceptResult: app.getRequestErrorMessage(res, '邀请无效或已失效') });
          return;
        }
        this._acceptInviteRequestId = '';
        this._incomingInviteToken = '';
        clearInviteHandoff();
        this.setData({ hasIncomingInvite: false, acceptResult: '已加入经营团队' });
        toast.success('已加入团队');
        this.loadAccess();
      },
      fail: () => {
        this.setData({ acceptResult: '网络连接失败，请稍后重试' });
        toast('邀请处理失败');
      },
      complete: () => this.setData({ accepting: false }),
    });
  },

  onShareAppMessage() {
    if (this._createdInviteToken && this.data.createdInvite) {
      return {
        title: `邀请你加入${this.data.access.merchant.name || '门店'}经营团队`,
        path: `/pages/merchant/team/index?invite=${encodeURIComponent(this._createdInviteToken)}`,
      };
    }
    return { title: '经营团队', path: '/pages/merchant/team/index' };
  },
});
