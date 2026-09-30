const MAX_SESSION_PHOTOS = 8
const MAX_SAVED_SESSIONS = 50

function normalizePhoto(photo) {
  if (typeof photo === 'string') return { path: photo, persisted: false }
  if (!photo || !photo.path) return null
  return {
    path: String(photo.path),
    persisted: photo.persisted === true,
    name: photo.name || '',
  }
}

function retainRecentPhotos(photos, limit) {
  const max = limit || MAX_SESSION_PHOTOS
  return (photos || []).map(normalizePhoto).filter(Boolean).slice(-max)
}

function droppedSavedPhotos(photos, limit) {
  const keptPaths = new Set(retainRecentPhotos(photos, limit)
    .filter((photo) => photo.persisted)
    .map((photo) => photo.path))
  return (photos || []).map(normalizePhoto).filter((photo) => photo && photo.persisted && !keptPaths.has(photo.path))
}

function archivedSessionPhotos(photos) {
  return retainRecentPhotos(photos).filter((photo) => photo.persisted)
}

function persistPhoto(wxApi, tempFilePath) {
  return new Promise((resolve) => {
    if (!tempFilePath || !wxApi || typeof wxApi.saveFile !== 'function') {
      resolve({ path: tempFilePath || '', persisted: false })
      return
    }
    wxApi.saveFile({
      tempFilePath,
      success(res) {
        const savedFilePath = res && res.savedFilePath
        resolve(savedFilePath
          ? { path: savedFilePath, persisted: true }
          : { path: tempFilePath, persisted: false })
      },
      fail() {
        resolve({ path: tempFilePath, persisted: false })
      },
    })
  })
}

function evictedSavedPhotos(existingSessions, incomingSession, limit) {
  const max = limit || MAX_SAVED_SESSIONS
  const sessions = [incomingSession].concat(existingSessions || [])
  const kept = new Set()
  sessions.slice(0, max).forEach((session) => {
    retainRecentPhotos(session && session.photos).forEach((photo) => {
      if (photo.persisted) kept.add(photo.path)
    })
  })
  return sessions.slice(max).flatMap((session) => retainRecentPhotos(session && session.photos))
    .filter((photo) => photo.persisted && !kept.has(photo.path))
}

function releaseSavedPhotos(wxApi, photos) {
  if (!wxApi || typeof wxApi.removeSavedFile !== 'function') return
  const released = {}
  retainRecentPhotos(photos, Number.MAX_SAFE_INTEGER).forEach((photo) => {
    if (!photo.persisted || released[photo.path]) return
    released[photo.path] = true
    wxApi.removeSavedFile({ filePath: photo.path })
  })
}

module.exports = {
  MAX_SESSION_PHOTOS,
  MAX_SAVED_SESSIONS,
  persistPhoto,
  retainRecentPhotos,
  archivedSessionPhotos,
  droppedSavedPhotos,
  evictedSavedPhotos,
  releaseSavedPhotos,
}
