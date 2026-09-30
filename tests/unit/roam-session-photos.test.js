const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  MAX_SESSION_PHOTOS,
  persistPhoto,
  retainRecentPhotos,
  archivedSessionPhotos,
  droppedSavedPhotos,
  evictedSavedPhotos,
} = require('../../utils/roam-session-photos.js')

test('裁剪后的漫游照片保存为可跨重启读取的本地路径', async () => {
  const photo = await persistPhoto({
    saveFile({ tempFilePath, success }) {
      assert.equal(tempFilePath, '/tmp/crop.jpg')
      success({ savedFilePath: 'wxfile://roam/crop.jpg' })
    },
  }, '/tmp/crop.jpg')

  assert.deepEqual(photo, { path: 'wxfile://roam/crop.jpg', persisted: true })
})

test('本地保存失败时保留当前会话可展示的临时照片，但不标记为已归档', async () => {
  const photo = await persistPhoto({
    saveFile({ fail }) { fail() },
  }, '/tmp/crop.jpg')

  assert.deepEqual(photo, { path: '/tmp/crop.jpg', persisted: false })
})

test('会话照片只保留最新八张，淘汰会话只释放未被保留会话引用的已保存文件', () => {
  const photos = Array.from({ length: MAX_SESSION_PHOTOS + 2 }, (_, index) => ({
    path: `wxfile://current/${index}`,
    persisted: true,
  }))
  assert.deepEqual(retainRecentPhotos(photos).map((photo) => photo.path), [
    'wxfile://current/2', 'wxfile://current/3', 'wxfile://current/4', 'wxfile://current/5',
    'wxfile://current/6', 'wxfile://current/7', 'wxfile://current/8', 'wxfile://current/9',
  ])
  assert.deepEqual(droppedSavedPhotos(photos).map((photo) => photo.path), [
    'wxfile://current/0', 'wxfile://current/1',
  ])
  assert.deepEqual(archivedSessionPhotos([
    { path: 'wxfile://session/persisted', persisted: true },
    { path: '/tmp/session-only', persisted: false },
  ]), [{ path: 'wxfile://session/persisted', persisted: true, name: '' }])

  const sessions = Array.from({ length: 50 }, (_, index) => ({
    photos: [{ path: `wxfile://session/${index}`, persisted: true }],
  }))
  const incoming = { photos: [{ path: 'wxfile://session/new', persisted: true }] }

  assert.deepEqual(evictedSavedPhotos(sessions, incoming).map((photo) => photo.path), [
    'wxfile://session/49',
  ])
})
