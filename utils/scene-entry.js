'use strict'

const toast = require('./toast.js');
const { getScene } = require('./scene-registry.js')

function pageUrl(scene) {
  const query = Object.entries(scene.params || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&')
  if (!query) return scene.route
  return `${scene.route}${scene.route.includes('?') ? '&' : '?'}${query}`
}

function openScene(id, params = {}) {
  if (!id) return
  let scene
  try {
    scene = getScene(id, params)
  } catch (_) {
    toast('场景暂时打不开')
    return
  }
  wx.navigateTo({
    url: pageUrl(scene),
    fail() {
      toast('场景暂时打不开')
    },
  })
}

module.exports = { openScene }
