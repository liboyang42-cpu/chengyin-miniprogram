#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const inventory = require('./mini-program-source-inventory')
const allowlist = require('./js-scope-allowlist')

let acorn
try {
  acorn = require('internal/deps/acorn/acorn/dist/acorn')
} catch (_) {
  console.error('JS-SCOPE FAIL: 必须用 node --expose-internals 运行，才能使用 Node 自带 Acorn，避免另加依赖')
  process.exit(2)
}

const RUNTIME_GLOBALS = new Set([
  'App', 'Array', 'ArrayBuffer', 'BigInt', 'Boolean', 'Component', 'DataView', 'Date', 'Error',
  'EvalError', 'Float32Array', 'Float64Array', 'Function', 'Infinity', 'Intl', 'JSON', 'Map',
  // 有符号定型数组原本漏在这张表里(无符号的那几个一直在):录音帧是 16 位有符号 PCM,
  // 取振幅必须用 Int16Array。漏登记的后果是「用了标准全局反而判红」,而不是漏掉真错误。
  'Int8Array', 'Int16Array', 'Int32Array',
  'Math', 'NaN', 'Number', 'Object', 'Page', 'Promise', 'Proxy', 'RangeError', 'ReferenceError',
  'Reflect', 'RegExp', 'Set', 'String', 'Symbol', 'SyntaxError', 'TypeError', 'URIError', 'URL',
  'URLSearchParams', 'Uint8Array', 'Uint8ClampedArray', 'Uint16Array', 'Uint32Array', 'WeakMap',
  'WeakSet', 'WebAssembly', 'Behavior', '__dirname', '__filename', 'clearInterval', 'clearTimeout',
  'console', 'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent', 'escape', 'exports',
  'getApp', 'getCurrentPages', 'isFinite', 'isNaN', 'module', 'parseFloat', 'parseInt', 'require',
  'setInterval', 'setTimeout', 'undefined', 'unescape', 'wx',
])

const CHILD_SKIP_KEYS = new Set(['start', 'end', 'loc', 'range', 'raw'])

class Scope {
  constructor(parent, type) {
    this.parent = parent || null
    this.type = type
    this.bindings = new Set()
  }

  has(name) {
    for (let current = this; current; current = current.parent) {
      if (current.bindings.has(name)) return true
    }
    return false
  }

  functionOwner() {
    let current = this
    while (current.parent && current.type !== 'function' && current.type !== 'program') current = current.parent
    return current
  }
}

function parse(source, filename) {
  return acorn.parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    locations: true,
    allowHashBang: true,
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
  })
}

function childNodes(node) {
  const result = []
  Object.entries(node || {}).forEach(([key, value]) => {
    if (CHILD_SKIP_KEYS.has(key)) return
    if (Array.isArray(value)) {
      value.forEach((item) => { if (item && typeof item.type === 'string') result.push([item, key]) })
    } else if (value && typeof value.type === 'string') result.push([value, key])
  })
  return result
}

function bindingIdentifiers(pattern, output) {
  output = output || []
  if (!pattern) return output
  if (pattern.type === 'Identifier') output.push(pattern)
  else if (pattern.type === 'RestElement') bindingIdentifiers(pattern.argument, output)
  else if (pattern.type === 'AssignmentPattern') bindingIdentifiers(pattern.left, output)
  else if (pattern.type === 'ArrayPattern') pattern.elements.forEach((item) => bindingIdentifiers(item, output))
  else if (pattern.type === 'ObjectPattern') pattern.properties.forEach((property) => {
    if (property.type === 'RestElement') bindingIdentifiers(property.argument, output)
    else bindingIdentifiers(property.value, output)
  })
  return output
}

function buildScopes(ast) {
  const root = new Scope(null, 'program')
  const scopes = new WeakMap()
  const bindingNodes = new WeakSet()

  function addPattern(scope, pattern) {
    bindingIdentifiers(pattern).forEach((identifier) => {
      scope.bindings.add(identifier.name)
      bindingNodes.add(identifier)
    })
  }

  function visitFunction(node, outerScope, declaration) {
    scopes.set(node, outerScope)
    if (declaration && node.id) addPattern(outerScope, node.id)
    const functionScope = new Scope(outerScope, 'function')
    if (node.type !== 'ArrowFunctionExpression') functionScope.bindings.add('arguments')
    if (!declaration && node.id) addPattern(functionScope, node.id)
    node.params.forEach((parameter) => addPattern(functionScope, parameter))
    node.params.forEach((parameter) => visit(parameter, functionScope, node, 'params'))
    visit(node.body, functionScope, node, 'body', true)
  }

  function visit(node, scope, parent, key, functionBody) {
    if (!node) return
    scopes.set(node, scope)

    if (node.type === 'FunctionDeclaration') return visitFunction(node, scope, true)
    if (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      return visitFunction(node, scope, false)
    }
    if (node.type === 'BlockStatement' && !functionBody) {
      const blockScope = new Scope(scope, 'block')
      scopes.set(node, blockScope)
      node.body.forEach((child) => visit(child, blockScope, node, 'body'))
      return
    }
    if (node.type === 'CatchClause') {
      const catchScope = new Scope(scope, 'block')
      scopes.set(node, catchScope)
      addPattern(catchScope, node.param)
      visit(node.param, catchScope, node, 'param')
      visit(node.body, catchScope, node, 'body', true)
      return
    }
    if (node.type === 'ForStatement' || node.type === 'ForInStatement' || node.type === 'ForOfStatement') {
      const loopScope = new Scope(scope, 'block')
      scopes.set(node, loopScope)
      childNodes(node).forEach(([child, childKey]) => visit(child, loopScope, node, childKey))
      return
    }
    if (node.type === 'SwitchStatement') {
      const switchScope = new Scope(scope, 'block')
      scopes.set(node, switchScope)
      childNodes(node).forEach(([child, childKey]) => visit(child, switchScope, node, childKey))
      return
    }
    if (node.type === 'ClassDeclaration') {
      if (node.id) addPattern(scope, node.id)
      const classScope = new Scope(scope, 'block')
      if (node.id) addPattern(classScope, node.id)
      if (node.superClass) visit(node.superClass, scope, node, 'superClass')
      visit(node.body, classScope, node, 'body')
      return
    }
    if (node.type === 'ClassExpression') {
      const classScope = new Scope(scope, 'block')
      if (node.id) addPattern(classScope, node.id)
      if (node.superClass) visit(node.superClass, scope, node, 'superClass')
      visit(node.body, classScope, node, 'body')
      return
    }
    if (node.type === 'VariableDeclaration') {
      const owner = node.kind === 'var' ? scope.functionOwner() : scope
      node.declarations.forEach((declaration) => addPattern(owner, declaration.id))
    }
    if (node.type === 'ImportDeclaration') {
      node.specifiers.forEach((specifier) => addPattern(scope, specifier.local))
    }

    childNodes(node).forEach(([child, childKey]) => visit(child, scope, node, childKey))
  }

  visit(ast, root, null, null)
  return { root, scopes, bindingNodes }
}

function isReferenceIdentifier(node, parent, key, bindingNodes) {
  if (bindingNodes.has(node)) return false
  if (!parent) return true
  if (parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return false
  if ((parent.type === 'Property' || parent.type === 'PropertyDefinition' || parent.type === 'MethodDefinition')
      && key === 'key' && !parent.computed && !(parent.type === 'Property' && parent.shorthand)) return false
  if ((parent.type === 'LabeledStatement' && key === 'label')
      || ((parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') && key === 'label')) return false
  if (parent.type === 'MetaProperty') return false
  if (parent.type === 'ExportSpecifier' && key === 'exported') return false
  return true
}

function validateAllowlist(entries) {
  const errors = []
  entries.forEach((entry, index) => {
    if (!entry || !String(entry.pathPrefix || '').trim() || !Array.isArray(entry.names) || !entry.names.length
        || !String(entry.reason || '').trim() || !String(entry.owner || '').trim()
        || !/^\d{4}-\d{2}-\d{2}$/.test(String(entry.reviewDate || ''))) {
      errors.push(`allowlist[${index}] 必须含 pathPrefix/names/reason/owner/reviewDate`)
    }
  })
  return errors
}

function allowed(relative, name, entries) {
  return entries.some((entry) => relative.startsWith(entry.pathPrefix)
    && (entry.names.includes('*') || entry.names.includes(name)))
}

function unresolvedIdentifiers(source, filename, entries) {
  const ast = parse(source, filename)
  const { scopes, bindingNodes } = buildScopes(ast)
  const relative = path.relative(inventory.XCX_ROOT, filename).split(path.sep).join('/')
  const issues = []

  function visit(node, parent, key) {
    if (node.type === 'Identifier' && isReferenceIdentifier(node, parent, key, bindingNodes)) {
      const scope = scopes.get(node)
      if (!RUNTIME_GLOBALS.has(node.name) && !(scope && scope.has(node.name)) && !allowed(relative, node.name, entries)) {
        issues.push({ kind: 'unresolved-identifier', file: relative, line: node.loc.start.line,
          column: node.loc.start.column + 1, name: node.name })
      }
    }
    childNodes(node).forEach(([child, childKey]) => visit(child, node, childKey))
  }
  visit(ast, null, null)
  return issues
}

function memberPath(node) {
  if (!node) return null
  if (node.type === 'Identifier') return node.name
  if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
    const left = memberPath(node.object)
    return left ? `${left}.${node.property.name}` : null
  }
  return null
}

function objectKeys(expression, objectBindings) {
  if (!expression) return null
  if (expression.type === 'AssignmentExpression') return objectKeys(expression.right, objectBindings)
  if (expression.type === 'Identifier') return objectBindings.get(expression.name) || null
  if (expression.type !== 'ObjectExpression') return null
  const keys = new Set()
  for (const property of expression.properties) {
    if (property.type === 'SpreadElement') {
      const spread = objectKeys(property.argument, objectBindings)
      if (!spread) return null
      spread.forEach((name) => keys.add(name))
    } else if (!property.computed) {
      if (property.key.type === 'Identifier') keys.add(property.key.name)
      else if (property.key.type === 'Literal') keys.add(String(property.key.value))
    } else return null
  }
  return keys
}

function exportedNames(source, filename) {
  const ast = parse(source, filename)
  const objectBindings = new Map()
  const names = new Set()
  // CommonJS 初始真值就是空对象；只有整包被换成无法静态展开的值时才失去完备性。
  let confident = true

  ast.body.forEach((node) => {
    if (node.type !== 'VariableDeclaration') return
    node.declarations.forEach((declaration) => {
      if (declaration.id.type !== 'Identifier') return
      const keys = objectKeys(declaration.init, objectBindings)
      if (keys) objectBindings.set(declaration.id.name, keys)
    })
  })

  function visit(node) {
    if (node.type === 'AssignmentExpression') {
      const target = memberPath(node.left)
      if (target === 'module.exports') {
        const keys = objectKeys(node.right, objectBindings)
        if (keys) {
          confident = true
          names.clear()
          keys.forEach((name) => names.add(name))
        } else {
          confident = false
          names.clear()
        }
      } else if (target && (target.startsWith('module.exports.') || target.startsWith('exports.'))) {
        if (confident) names.add(target.slice(target.lastIndexOf('.') + 1))
      } else if (node.left.type === 'MemberExpression' && node.left.computed
          && ['module.exports', 'exports'].includes(memberPath(node.left.object))) {
        confident = false
        names.clear()
      }
    }
    if (node.type === 'CallExpression' && memberPath(node.callee) === 'Object.assign'
        && node.arguments.length >= 2 && memberPath(node.arguments[0]) === 'module.exports') {
      const keys = objectKeys(node.arguments[1], objectBindings)
      if (keys && confident) {
        keys.forEach((name) => names.add(name))
      }
    }
    childNodes(node).forEach(([child]) => visit(child))
  }
  visit(ast)
  return { confident, names }
}

function resolveRequiredFile(fromFile, request) {
  if (!request.startsWith('.')) return null
  const base = path.resolve(path.dirname(fromFile), request)
  for (const candidate of [base, `${base}.js`, path.join(base, 'index.js')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}

function missingDestructuredExports(source, filename, cache) {
  const ast = parse(source, filename)
  const relative = path.relative(inventory.XCX_ROOT, filename).split(path.sep).join('/')
  const issues = []
  function visit(node) {
    if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern'
        && node.init && node.init.type === 'CallExpression' && node.init.callee.type === 'Identifier'
        && node.init.callee.name === 'require' && node.init.arguments.length === 1
        && node.init.arguments[0].type === 'Literal' && typeof node.init.arguments[0].value === 'string') {
      const target = resolveRequiredFile(filename, node.init.arguments[0].value)
      if (target && target.endsWith('.js')) {
        let exported = cache.get(target)
        if (!exported) {
          exported = exportedNames(fs.readFileSync(target, 'utf8'), target)
          cache.set(target, exported)
        }
        if (exported.confident) {
          node.id.properties.forEach((property) => {
            if (property.type !== 'Property' || property.computed) return
            const name = property.key.type === 'Identifier' ? property.key.name : String(property.key.value)
            if (!exported.names.has(name)) {
              issues.push({ kind: 'missing-destructured-export', file: relative,
                line: property.loc.start.line, column: property.loc.start.column + 1,
                name, target: path.relative(inventory.XCX_ROOT, target).split(path.sep).join('/') })
            }
          })
        }
      }
    }
    childNodes(node).forEach(([child]) => visit(child))
  }
  visit(ast)
  return issues
}

function scanFiles(files, entries) {
  const issues = []
  const exportCache = new Map()
  files.forEach((file) => {
    const relative = path.relative(inventory.XCX_ROOT, file).split(path.sep).join('/')
    if (allowed(relative, '*', entries)) return
    const source = fs.readFileSync(file, 'utf8')
    issues.push(...unresolvedIdentifiers(source, file, entries))
    issues.push(...missingDestructuredExports(source, file, exportCache))
  })
  return issues
}

function selftest() {
  const temp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'xcx-scope-lint-'))
  try {
    const unresolvedFile = path.join(inventory.XCX_ROOT, 'pages/__scope_selftest__/index.js')
    const red = unresolvedIdentifiers('function routeCards(){ return chinaDayStart(Date.now()) }', unresolvedFile, [])
    if (red.length !== 1 || red[0].name !== 'chinaDayStart') throw new Error('未解析标识符负控没有变红')
    const green = unresolvedIdentifiers('const chinaDayStart=()=>0; function routeCards(){ return chinaDayStart(Date.now()) }', unresolvedFile, [])
    if (green.length !== 0) throw new Error('补回声明后未恢复绿色')

    const target = path.join(temp, 'target.js')
    const consumer = path.join(temp, 'consumer.js')
    fs.writeFileSync(target, 'const ok=1; module.exports={ok}\n')
    fs.writeFileSync(consumer, "const {ok, missing}=require('./target.js')\n")
    const missing = missingDestructuredExports(fs.readFileSync(consumer, 'utf8'), consumer, new Map())
    if (missing.length !== 1 || missing[0].name !== 'missing') throw new Error('不存在导出负控没有变红')
    fs.writeFileSync(target, 'const ok=1,missing=2; module.exports={ok,missing}\n')
    const restored = missingDestructuredExports(fs.readFileSync(consumer, 'utf8'), consumer, new Map())
    if (restored.length !== 0) throw new Error('补回导出后未恢复绿色')

    fs.writeFileSync(target, 'exports.ok=1\n')
    const namedExport = missingDestructuredExports(fs.readFileSync(consumer, 'utf8'), consumer, new Map())
    if (namedExport.length !== 1 || namedExport[0].name !== 'missing') {
      throw new Error('exports.name 风格的不存在导出负控没有变红')
    }
    console.log('JS-SCOPE SELFTEST PASS: 未解析标识符与不存在导出均完成红→绿负控')
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}

function main() {
  const allowlistErrors = validateAllowlist(allowlist)
  if (allowlistErrors.length) {
    allowlistErrors.forEach((error) => console.error(`JS-SCOPE FAIL: ${error}`))
    process.exit(1)
  }
  if (process.argv.includes('--selftest')) {
    selftest()
    return
  }
  const files = inventory.productionFiles('.js')
  const issues = scanFiles(files, allowlist)
  if (issues.length) {
    issues.forEach((issue) => {
      const detail = issue.kind === 'unresolved-identifier'
        ? `未解析标识符 ${issue.name}`
        : `解构 ${issue.name}，但 ${issue.target} 未导出该名称`
      console.error(`${issue.file}:${issue.line}:${issue.column} ${detail}`)
    })
    console.error(`JS-SCOPE FAIL: ${issues.length} 个作用域/导出错误`)
    process.exit(1)
  }
  console.log(`JS-SCOPE PASS: ${files.length} 个生产 JS，未解析标识符 0，不存在导出 0`)
}

if (require.main === module) main()

module.exports = { exportedNames, missingDestructuredExports, scanFiles, unresolvedIdentifiers, validateAllowlist }
