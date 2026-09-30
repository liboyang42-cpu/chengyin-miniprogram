function canUseDemoRoamPois(app) {
  return !!(app
    && typeof app.isDevEnv === 'function'
    && app.isDevEnv()
    && app.globalData
    && app.globalData.features
    && app.globalData.features.roamDemoPois === true)
}

function selectDemoRoamPois(app, demoPois) {
  return canUseDemoRoamPois(app) && Array.isArray(demoPois) ? demoPois : []
}

module.exports = { canUseDemoRoamPois, selectDemoRoamPois }
