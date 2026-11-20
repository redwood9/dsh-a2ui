/**
 * dsh-a2ui · 零依赖 client bundle 构建脚本。
 * 按依赖顺序拼接共享/客户端模块，剥离 ESM 语法后包进 DSH ModuleLoader 工厂。
 * 用法：node scripts/build-client.mjs（产物 client.js 随包提交，用户无需构建）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const FILES = [
  'src/shared/protocol.js',
  'src/shared/styles.js',
  'src/client/renderer.js',
  'src/client/view.js',
  'src/client/main.js',
]

function stripEsm(code) {
  return code
    .split('\n')
    .filter(line => !/^\s*import\s/.test(line))
    .map(line => line
      .replace(/^export\s+function\s/, 'function ')
      .replace(/^export\s+class\s/, 'class ')
      .replace(/^export\s+const\s/, 'const ')
      .replace(/^export\s+let\s/, 'let '))
    .filter(line => !/^export\s*[{}]/.test(line))
    .join('\n')
}

const parts = FILES.map(f => {
  const code = readFileSync(join(root, f), 'utf8')
  return '// ===== ' + f + ' =====\n' + stripEsm(code)
})

const bundle = `/**
 * dsh-a2ui —— DeepSeek Harness 实时生成 UI（client 半边）。
 * 由 scripts/build-client.mjs 生成，请勿直接编辑；源文件见 src/。
 * 注册 id 必须等于 loader entry 名（dsh-a2ui）。
 */
window.__A2UI_DEBUG = { loaded: true, materialized: false, reactOk: false, applied: false, hasSlots: null, registered: false, error: null }
window.__ModuleLoader__.load({
  id: 'dsh-a2ui',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    window.__A2UI_DEBUG.materialized = true
    let React
    try {
      React = require('react')
      window.__A2UI_DEBUG.reactOk = true
    } catch (e) {
      window.__A2UI_DEBUG.error = 'require(react): ' + (e && e.message ? e.message : String(e))
      throw e
    }

${parts.join('\n\n')}

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})
`

writeFileSync(join(root, 'client.js'), bundle)
console.log('[dsh-a2ui] client.js 已生成（' + bundle.length + ' bytes）')
