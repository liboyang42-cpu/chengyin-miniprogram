#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const XCX_ROOT = path.resolve(__dirname, '..')
const EXCLUDED_DIRECTORIES = new Set(['node_modules', 'miniprogram_npm', 'tests', 'scripts'])

function walkProductionFiles(directory, extension, files) {
  files = files || []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || EXCLUDED_DIRECTORIES.has(entry.name)) continue
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) walkProductionFiles(absolute, extension, files)
    else if (entry.isFile() && entry.name.endsWith(extension)) files.push(absolute)
  }
  return files
}

function productionFiles(extension) {
  return walkProductionFiles(XCX_ROOT, extension, []).sort()
}

function registeredSubpackageRoots(appJson) {
  const app = appJson || JSON.parse(fs.readFileSync(path.join(XCX_ROOT, 'app.json'), 'utf8'))
  return (app.subPackages || app.subpackages || []).map((item) => item.root)
}

function uncoveredRegisteredSubpackages(files, appJson) {
  const relativeFiles = files.map((file) => path.relative(XCX_ROOT, file).split(path.sep).join('/'))
  return registeredSubpackageRoots(appJson).filter((root) => {
    const normalized = root.replace(/\/+$/, '')
    return !relativeFiles.some((file) => file === normalized || file.startsWith(`${normalized}/`))
  })
}

module.exports = {
  XCX_ROOT,
  productionFiles,
  registeredSubpackageRoots,
  uncoveredRegisteredSubpackages,
}
