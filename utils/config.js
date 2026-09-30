// 全局配置文件
const API_BASE_URL = 'https://api.example.invalid/prod-api';
const TRUSTED_ASSET_HOSTS = ['api.example.invalid'];

function normalizeApiBaseUrl(value) {
  var url = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^/?#]+(?:[/?#]|$)/i.test(url)) return '';
  return url;
}

function resolveRuntimeConfig(envVersion, externalConfig) {
  envVersion = String(envVersion || '').toLowerCase();
  if (envVersion === 'release') {
    return {
      environment: 'release',
      envVersion: 'release',
      apiBaseUrl: API_BASE_URL,
      assetBaseUrl: API_BASE_URL + '/profile/',
      configured: true,
    };
  }

  var environment = envVersion === 'trial' ? 'staging' : 'develop';
  var configuredUrl = externalConfig && externalConfig.apiEnvironments
    ? normalizeApiBaseUrl(externalConfig.apiEnvironments[environment])
    : '';
  // 2026-08-25 用户裁决:撤掉 develop / trial 的 fail-closed。原来没配测试服就把 apiBaseUrl 置空,
  // 结果开发者工具与体验版一条数据都拉不出来(每个页面都停在「加载失败」)。
  // 现在没配就回落生产。⚠️ 代价是明确的:开发版/体验版的写请求(下单、核销、退款)会真落生产库。
  // 2026-09-15 用户拍板删除运行时生产写闸(X01),不再有「非 release 拦写请求」这一层。
  // ext.json 里显式配了测试服就仍然优先用测试服。
  var apiBaseUrl = configuredUrl || API_BASE_URL;
  return {
    environment: environment,
    envVersion: envVersion === 'trial' || envVersion === 'develop' ? envVersion : 'unknown',
    apiBaseUrl: apiBaseUrl,
    assetBaseUrl: apiBaseUrl + '/profile/',
    configured: true,
  };
}

function resolveFromWx(wxApi) {
  var envVersion = 'unknown';
  var externalConfig = {};
  try { envVersion = wxApi.getAccountInfoSync().miniProgram.envVersion; } catch (e) {}
  try { externalConfig = wxApi.getExtConfigSync() || {}; } catch (e) {}
  return resolveRuntimeConfig(envVersion, externalConfig);
}

function trustedHttpsUrl(value) {
  var match = String(value || '').match(/^https:\/\/([^/?#]+)(?:[/?#]|$)/i);
  return !!match && TRUSTED_ASSET_HOSTS.indexOf(match[1].toLowerCase()) >= 0;
}

const config = {
  apiBaseUrl: API_BASE_URL,
  // 静态资源基础URL
  baseImgUrl: API_BASE_URL + '/profile/',
  trustedAssetHosts: TRUSTED_ASSET_HOSTS.slice(),
  isTrustedAssetUrl: trustedHttpsUrl,
  resolveRuntimeConfig: resolveRuntimeConfig,
  resolveFromWx: resolveFromWx,
};

module.exports = config;
