const REDUCED_MOTION_KEY = 'play_reduced_motion'
const LEGACY_REDUCED_MOTION_KEY = 'roam_reduced_motion'

function resolveStorage(storage) {
  if (storage) return storage
  return typeof wx !== 'undefined' ? wx : null
}

function readReducedMotion(storage) {
  const target = resolveStorage(storage)
  if (!target || typeof target.getStorageSync !== 'function') return false
  try {
    const current = target.getStorageSync(REDUCED_MOTION_KEY)
    if (current === true || current === false) return current
    return target.getStorageSync(LEGACY_REDUCED_MOTION_KEY) === true
  } catch (e) {
    return false
  }
}

function writeReducedMotion(storage, value) {
  const enabled = value === true
  const target = resolveStorage(storage)
  if (!target || typeof target.setStorageSync !== 'function') return enabled
  try {
    target.setStorageSync(REDUCED_MOTION_KEY, enabled)
    target.setStorageSync(LEGACY_REDUCED_MOTION_KEY, enabled)
  } catch (e) {}
  return enabled
}

module.exports = {
  REDUCED_MOTION_KEY,
  LEGACY_REDUCED_MOTION_KEY,
  readReducedMotion,
  writeReducedMotion,
}
