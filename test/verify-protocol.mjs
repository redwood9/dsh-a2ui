/**
 * 协议状态机与 styles 映射单元测试（Node 直接运行，零依赖）。
 */
import assert from 'node:assert/strict'
import {
  getPointer, setPointer, resolveValue, validateEnvelope,
  SurfaceStore, evaluateFunction,
} from '../src/shared/protocol.js'
import { mapStyles } from '../src/shared/styles.js'

let n = 0
function ok(name, fn) { fn(); n++; console.log('  ✓ ' + name) }

console.log('verify-protocol')

ok('JSON Pointer get/set（嵌套 + 数组 + 转义 + 整体替换）', () => {
  const obj = { a: { b: [{ c: 1 }] }, 'x/y': 2 }
  assert.equal(getPointer(obj, '/a/b/0/c'), 1)
  assert.equal(getPointer(obj, '/x~1y'), 2)
  assert.equal(getPointer(obj, ''), obj)
  setPointer(obj, '/a/b/0/c', 9)
  assert.equal(obj.a.b[0].c, 9)
  setPointer(obj, '/a/d/0', 'v') // 自动建数组
  assert.deepEqual(obj.a.d, ['v'])
  assert.deepEqual(setPointer({}, '/', { fresh: true }), { fresh: true })
})

ok('validateEnvelope 拦截非法消息', () => {
  assert.equal(validateEnvelope({ createSurface: { surfaceId: 's' } }), null)
  assert.match(validateEnvelope({}), /必须且只能/)
  assert.match(validateEnvelope({ createSurface: { surfaceId: 's' }, deleteSurface: { surfaceId: 's' } }), /必须且只能/)
  assert.match(validateEnvelope({ updateComponents: { surfaceId: 's', components: [{}] } }), /id 与 component/)
  assert.match(validateEnvelope({ updateDataModel: {} }), /surfaceId/)
})

ok('SurfaceStore 全生命周期（create→components→data→delete）', () => {
  const store = new SurfaceStore()
  let bumps = 0
  store.subscribe(() => bumps++)
  store.apply({ version: 'v0.9', createSurface: { surfaceId: 's', catalogId: 'kuikly_a2ui_catalog.json' } })
  store.apply({ updateComponents: { surfaceId: 's', components: [
    { id: 'root', component: 'Column', children: ['t'] },
    { id: 't', component: 'Text', text: { path: '/msg' } },
  ] } })
  store.apply({ updateDataModel: { surfaceId: 's', path: '/msg', value: '你好' } })
  const s = store.getSurface('s')
  assert.equal(s.components.size, 2)
  assert.equal(resolveValue(s.components.get('t').text, s), '你好')
  assert.equal(bumps, 3)
  store.apply({ deleteSurface: { surfaceId: 's' } })
  assert.equal(store.getSurface('s'), undefined)
})

ok('模板 ChildList 作用域绑定', () => {
  const store = new SurfaceStore()
  store.apply({ createSurface: { surfaceId: 's' } })
  store.apply({ updateComponents: { surfaceId: 's', components: [
    { id: 'root', component: 'List', children: { path: '/items', componentId: 'tpl' } },
    { id: 'tpl', component: 'Text', text: { path: '/name' } },
  ] } })
  store.apply({ updateDataModel: { surfaceId: 's', path: '/items', value: [{ name: '甲' }, { name: '乙' }] } })
  const s = store.getSurface('s')
  const items = store.resolveChildren(s.components.get('root').children, s, null)
  assert.equal(items.length, 2)
  assert.equal(items[1].scope, '/items/1')
  assert.equal(resolveValue(s.components.get('tpl').text, s, items[1].scope), '乙')
})

const surf = { dataModel: { n: 12345.678, price: 1299, qty: 1, zero: 0, name: '世界', date: '2026-11-17T08:30:00', email: 'a@b.com' } }

ok('内置函数：格式化系列', () => {
  assert.equal(evaluateFunction('formatNumber', { value: { path: '/n' }, decimals: 2 }, surf), '12,345.68')
  assert.equal(evaluateFunction('formatNumber', { value: { path: '/n' }, grouping: false }, surf), '12345.678')
  assert.equal(evaluateFunction('formatCurrency', { value: { path: '/price' }, currency: 'CNY' }, surf), '¥1,299.00')
  assert.equal(evaluateFunction('formatString', { value: '你好 ${/name}！' }, surf), '你好 世界！')
  assert.equal(evaluateFunction('formatDate', { value: { path: '/date' }, format: 'yyyy-MM-dd' }, surf), '2026-11-17')
  assert.equal(evaluateFunction('pluralize', { value: { path: '/qty' }, one: '件', other: '件（多）' }, surf), '件')
  assert.equal(evaluateFunction('pluralize', { value: { path: '/zero' }, zero: '无', one: '件', other: '多' }, surf), '无')
})

ok('内置函数：校验与逻辑系列', () => {
  assert.equal(evaluateFunction('required', { value: { path: '/name' } }, surf), true)
  assert.equal(evaluateFunction('required', { value: '' }, surf), false)
  assert.equal(evaluateFunction('email', { value: { path: '/email' } }, surf), true)
  assert.equal(evaluateFunction('email', { value: 'bad' }, surf), false)
  assert.equal(evaluateFunction('regex', { value: 'abc123', pattern: '^[a-z]+\\d+$' }, surf), true)
  assert.equal(evaluateFunction('length', { value: 'abcd', min: 2, max: 4 }, surf), true)
  assert.equal(evaluateFunction('length', { value: 'a', min: 2 }, surf), false)
  assert.equal(evaluateFunction('numeric', { value: '5', min: 1, max: 10 }, surf), true)
  assert.equal(evaluateFunction('numeric', { value: 'x' }, surf), false)
  assert.equal(evaluateFunction('and', { values: [true, { path: '/qty' }] }, surf), true)
  assert.equal(evaluateFunction('or', { values: [false, ''] }, surf), false)
  assert.equal(evaluateFunction('not', { value: false }, surf), true)
})

ok('resolveValue 递归求值（action context 形态）', () => {
  const out = resolveValue({ sku: 'A1', qty: { path: '/qty' }, list: [{ path: '/name' }] }, surf)
  assert.deepEqual(out, { sku: 'A1', qty: 1, list: ['世界'] })
})

ok('mapStyles：尺寸 / 渐变 / 阴影 / 变换', () => {
  const st = mapStyles('Card', {
    width: 320, padding: 16, borderRadius: 12,
    backgroundLinearGradient: { direction: 'to-right', colorStops: [{ color: '#000', stop: 0 }, { color: '#fff', stop: 1 }] },
    boxShadow: { offsetX: 0, offsetY: 2, radius: 8, color: '#33000000' },
    transform: { rotate: 45, translate: [0.1, 0.2] },
  })
  assert.equal(st.width, '320px')
  assert.equal(st.background, 'linear-gradient(to right, #000 0%, #fff 100%)')
  assert.equal(st.boxShadow, '0px 2px 8px #33000000')
  assert.equal(st.transform, 'rotate(45deg) translate(10%, 20%)')
})

ok('mapStyles：Kuikly shorthand 兼容 + Text 白名单', () => {
  const g = mapStyles('Card', { backgroundLinearGradient: 'linear-gradient(1, #3A6DF0 0.0, #7A3FD8 1.0)' })
  assert.equal(g.background, 'linear-gradient(to bottom, #3A6DF0 0%, #7A3FD8 100%)')
  const t = mapStyles('Text', { color: '#f00', fontSize: 14, numberOfLines: 2 })
  assert.equal(t.color, '#f00')
  assert.equal(t.WebkitLineClamp, 2)
  const notText = mapStyles('Card', { color: '#f00', fontSize: 14 })
  assert.equal(notText, undefined) // 非 Text 的文本字段被白名单丢弃
})

console.log('verify-protocol: ' + n + ' 项全部通过')
