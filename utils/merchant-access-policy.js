const PERMISSIONS = Object.freeze({
  BASIC_READ: 'merchant:basic:read',
  PROFILE_WRITE: 'merchant:profile:write',
  PROJECT_MANAGE: 'merchant:project:manage',
  VERIFY: 'merchant:verify',
  VERIFY_RECORD_READ: 'merchant:verify:record:read',
  ORDER_READ: 'merchant:order:read',
  CRM_READ: 'merchant:crm:read',
  CRM_SENSITIVE_READ: 'merchant:crm:sensitive:read',
  CRM_SEGMENT: 'merchant:crm:segment',
  CRM_EXPORT: 'merchant:crm:export',
  FINANCE_READ: 'merchant:finance:read',
  AFTERCARE_READ: 'merchant:aftercare:read',
  AFTERCARE_RESPOND: 'merchant:aftercare:respond',
  MARKETING_READ: 'merchant:marketing:read',
  MARKETING_WRITE: 'merchant:marketing:write',
  COUPON_MANAGE: 'merchant:coupon:manage',
  COOP_MANAGE: 'merchant:coop:manage',
  OPERATOR_MANAGE: 'merchant:operator:manage',
});

const KNOWN_PERMISSIONS = new Set(Object.keys(PERMISSIONS).map((key) => PERMISSIONS[key]));
const ROLE_LABELS = Object.freeze({
  MERCHANT_OWNER: '店主',
  MERCHANT_MANAGER: '店长',
  MERCHANT_CHECKIN: '核销员',
  MERCHANT_MARKETING: '运营',
  MERCHANT_FINANCE: '财务',
});

function inactiveMerchant(source) {
  if (!validMerchant(source)) return null;
  return {
    id: source.id,
    name: typeof source.name === 'string' ? source.name : '',
    logo: typeof source.logo === 'string' ? source.logo : '',
    status: source.status,
    accountStatus: source.accountStatus,
  };
}

function inactiveAccess(raw) {
  const source = raw || {};
  const applicationState = ['PENDING', 'REJECTED', 'DISABLED'].indexOf(source.applicationState) >= 0
    && source.roleCode === 'MERCHANT_OWNER' && validMerchant(source.merchant)
    ? source.applicationState : 'NONE';
  return {
    active: false,
    merchant: applicationState === 'NONE' ? null : inactiveMerchant(source.merchant),
    roleCode: applicationState === 'NONE' ? '' : 'MERCHANT_OWNER',
    roleName: applicationState === 'NONE' ? '' : ROLE_LABELS.MERCHANT_OWNER,
    applicationState,
    permissions: [],
    canReadBasic: false,
    canWriteProfile: false,
    canManageProjects: false,
    canVerify: false,
    canReadVerifyRecords: false,
    canReadOrders: false,
    canReadCrm: false,
    canReadCrmSensitive: false,
    canSegmentCrm: false,
    canExportCrm: false,
    canReadFinance: false,
    canReadAftercare: false,
    canRespondAftercare: false,
    canReadMarketing: false,
    canWriteMarketing: false,
    canManageCoupons: false,
    canManageCoop: false,
    canManageOperators: false,
  };
}

function invalidAccess() {
  return Object.assign(inactiveAccess(), { invalid: true });
}

function hasPermission(access, permission) {
  return !!(access && access.active === true
    && KNOWN_PERMISSIONS.has(permission)
    && Array.isArray(access.permissions)
    && access.permissions.indexOf(permission) >= 0);
}

function validMerchant(merchant) {
  if (!merchant || typeof merchant !== 'object' || Array.isArray(merchant)) return false;
  if (typeof merchant.id === 'number') return Number.isSafeInteger(merchant.id) && merchant.id > 0;
  return typeof merchant.id === 'string' && /^[1-9]\d*$/.test(merchant.id);
}

/**
 * access/me 的唯一前端投影。active、主体、固定角色、权限数组必须同时可信；
 * 任一层脏数据都关闭，而不是沿用旧全局 role/userType 放行。
 */
function normalizeMerchantAccess(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalidAccess();
  const source = raw;
  if (source.active !== true) {
    if (source.applicationState === 'NONE') return inactiveAccess(source);
    if (['PENDING', 'REJECTED', 'DISABLED'].indexOf(source.applicationState) >= 0
        && source.roleCode === 'MERCHANT_OWNER' && validMerchant(source.merchant)) {
      return inactiveAccess(source);
    }
    return invalidAccess();
  }
  if (!validMerchant(source.merchant) || !Object.prototype.hasOwnProperty.call(ROLE_LABELS, source.roleCode)) {
    return invalidAccess();
  }
  const permissions = Array.isArray(source.permissions)
    ? Array.from(new Set(source.permissions.filter((item) => typeof item === 'string' && KNOWN_PERMISSIONS.has(item))))
    : [];
  const access = {
    active: true,
    merchant: {
      id: source.merchant.id,
      name: typeof source.merchant.name === 'string' ? source.merchant.name : '',
      logo: typeof source.merchant.logo === 'string' ? source.merchant.logo : '',
    },
    roleCode: source.roleCode,
    roleName: ROLE_LABELS[source.roleCode],
    permissions,
  };
  return Object.assign(access, {
    canReadBasic: hasPermission(access, PERMISSIONS.BASIC_READ),
    canWriteProfile: hasPermission(access, PERMISSIONS.PROFILE_WRITE),
    canManageProjects: hasPermission(access, PERMISSIONS.PROJECT_MANAGE),
    canVerify: hasPermission(access, PERMISSIONS.VERIFY),
    canReadVerifyRecords: hasPermission(access, PERMISSIONS.VERIFY_RECORD_READ),
    canReadOrders: hasPermission(access, PERMISSIONS.ORDER_READ),
    canReadCrm: hasPermission(access, PERMISSIONS.CRM_READ),
    canReadCrmSensitive: hasPermission(access, PERMISSIONS.CRM_SENSITIVE_READ),
    canSegmentCrm: hasPermission(access, PERMISSIONS.CRM_SEGMENT),
    canExportCrm: hasPermission(access, PERMISSIONS.CRM_EXPORT),
    canReadFinance: hasPermission(access, PERMISSIONS.FINANCE_READ),
    canReadAftercare: hasPermission(access, PERMISSIONS.AFTERCARE_READ),
    canRespondAftercare: hasPermission(access, PERMISSIONS.AFTERCARE_RESPOND),
    canReadMarketing: hasPermission(access, PERMISSIONS.MARKETING_READ),
    canWriteMarketing: hasPermission(access, PERMISSIONS.MARKETING_WRITE),
    canManageCoupons: hasPermission(access, PERMISSIONS.COUPON_MANAGE),
    canManageCoop: hasPermission(access, PERMISSIONS.COOP_MANAGE),
    canManageOperators: hasPermission(access, PERMISSIONS.OPERATOR_MANAGE),
  });
}

function roleName(roleCode) {
  return Object.prototype.hasOwnProperty.call(ROLE_LABELS, roleCode) ? ROLE_LABELS[roleCode] : '未知岗位';
}

module.exports = {
  PERMISSIONS,
  ROLE_LABELS,
  inactiveAccess,
  hasPermission,
  normalizeMerchantAccess,
  roleName,
};
