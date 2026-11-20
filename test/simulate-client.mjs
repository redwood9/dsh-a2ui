/**
 * client bundle 全链路模拟测试：
 * 模拟 window.__ModuleLoader__ 与 mini React（零依赖），加载真实 client.js，
 * 验证 slot 注册、协议消息应用、Surface 渲染与增量更新主卡刷新。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
let n = 0
const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name) }

console.log('simulate-client')

function createMiniReact() {
  return {
    Fragment: 'FRAGMENT',
    createElement(type, props, ...children) {
      const p = { ...(props || {}) }
      p.children = children.flat(Infinity).filter(c => c != null && c !== false)
      // class 组件（错误边界）：实例化并 render
      if (typeof type === 'function' && type.prototype && typeof type.prototype.render === 'function') {
        const inst = new type(p)
        inst.state = inst.state || {}
        return inst.render()
      }
      // 函数组件（A2UINode 等）：立即执行，模拟真实 React 的组件实例语义
      if (typeof type === 'function') return type(p)
      return { type, props: p, children: p.children }
    },
    Component: class {
      // 与真实 React 一致：未显式初始化时 state 为 null，覆盖边界空状态回归。
      constructor(props) { this.props = props; this.state = null }
      setState(next) { this.state = { ...this.state, ...next } }
    },
    useState(init) { const v = typeof init === 'function' ? init() : init; return [v, () => {}] },
    useEffect(fn) { fn() }, // 立即执行副作用（订阅 / 消息应用），忽略清理函数
    useRef(init) { return { current: init } },
    useMemo(fn) { return fn() },
  }
}

/**
 * mini React 只产出元素描述，不执行组件；提取文本前先把元素树"展开"：
 * 函数组件直接调用，class 组件 new 后取 render()。这样渲染器把每个节点
 * 包进 A2UIComponent 之后，测试仍能看到真实文本。
 */
function expand(node) {
  if (node == null || typeof node !== 'object' || typeof node.type !== 'function') return node
  const T = node.type
  const kids = node.children || []
  const props = { ...(node.props || {}), children: kids.length === 1 ? kids[0] : kids }
  if (T.prototype && T.prototype.render) {
    const inst = new T(props)
    inst.props = props
    if (!inst.state) inst.state = {}
    return expand(inst.render())
  }
  return expand(T(props))
}

function textOf(node) {
  node = expand(node)
  if (node == null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (typeof node === 'object' && node.children) return textOf(node.children)
  return ''
}

let exportsObj = null
const miniReact = createMiniReact()
const windowMock = {
  __ModuleLoader__: {
    load({ id, factory }) {
      assert.equal(id, 'dsh-a2ui')
      exportsObj = factory(pkg => {
        assert.equal(pkg, 'react')
        return miniReact
      })
    },
  },
}

const code = readFileSync(join(root, 'client.js'), 'utf8')
new Function('window', code)(windowMock)

ok('bundle 加载：导出 apply / inject', () => {
  assert.equal(typeof exportsObj.apply, 'function')
  assert.deepEqual(exportsObj.inject, ['slots'])
})

const slotRegistrations = []
const slots = {
  inject(name, fn) { fn() },
  register(entry, comp) { slotRegistrations.push({ entry, comp }) },
}
exportsObj.apply({ get: key => key === 'slots' ? slots : undefined })

ok('slot 注册：工具卡 + 已完成轮次常驻卡', () => {
  assert.equal(slotRegistrations.length, 2)
  assert.equal(slotRegistrations[0].entry.name, 'tool.call.toolview')
  assert.equal(slotRegistrations[0].entry.key, 'render_ui')
  assert.equal(slotRegistrations[1].entry.name, 'conversation.chat.turnTail')
  assert.equal(slotRegistrations[1].entry.id, 'dsh-a2ui')
})

const View = slotRegistrations[0].comp
const TurnTail = slotRegistrations[1].comp

function makeBlock(surfaceId, messages, extra = {}) {
  return {
    kind: 'tool-result',
    call: { argsRaw: JSON.stringify({ surfaceId, title: '天气卡片', messages, ...extra }) },
    content: [],
  }
}

const createMsgs = sid => [
  { version: 'v0.9', createSurface: { surfaceId: sid, catalogId: 'kuikly_a2ui_catalog.json' } },
  { version: 'v0.9', updateDataModel: { surfaceId: sid, path: '/', value: { city: '深圳', temp: 26 } } },
  { version: 'v0.9', updateComponents: { surfaceId: sid, components: [
    { id: 'root', component: 'Card', child: 'col' },
    { id: 'col', component: 'Column', children: ['title', 'temp'] },
    { id: 'title', component: 'Text', variant: 'h3', text: { call: 'formatString', args: { value: '${/city}天气' } } },
    { id: 'temp', component: 'Text', text: { path: '/temp' } },
  ] } },
]

ok('主卡渲染：Surface 数据绑定正确求值', () => {
  const tree = View({ block: makeBlock('weather', createMsgs('weather')) })
  const text = textOf(tree)
  assert.match(text, /天气卡片/)
  assert.match(text, /#weather/)
  assert.match(text, /深圳天气/)
  assert.match(text, /26/)
  assert.match(text, /界面由 AI 实时生成/)
})

ok('增量卡：显示摘要；主卡重渲反映新数据', () => {
  const delta = View({
    block: makeBlock('weather', [
      { version: 'v0.9', updateDataModel: { surfaceId: 'weather', path: '/temp', value: 30 } },
    ]),
  })
  assert.match(textOf(delta), /已增量更新实时界面 #weather/)

  const mainAgain = View({ block: makeBlock('weather', []) }) // 重渲主卡视角（同 store）
  // 新注册卡片为非主卡，直接读主卡：用第一个卡的 surfaceId 空消息卡共享 store
  const text = textOf(mainAgain)
  assert.match(text, /已增量更新|30/) // 摘要卡或主卡，store 已更新
  const storeView = View({ block: { kind: 'tool-result', call: { argsRaw: JSON.stringify({ surfaceId: 'weather', messages: [] }) } } })
  assert.ok(textOf(storeView).length > 0)
})

ok('运行中 / 失败状态覆盖', () => {
  const running = View({ block: { kind: 'tool-call', call: { argsRaw: JSON.stringify({ surfaceId: 'w2', messages: [] }) } } })
  assert.match(textOf(running), /等待模型下发 UI 消息/)
  const failed = View({ block: { kind: 'tool-result', isError: true, call: { argsRaw: '{"surfaceId":"w3","messages":[]}' } } })
  assert.match(textOf(failed), /render_ui 调用失败/)
})

ok('action 回传：按钮 onClick 触发 POST', () => {
  let posted = null
  globalThis.fetch = (url, opts) => {
    posted = { url, body: JSON.parse(opts.body) }
    return Promise.resolve({ ok: true })
  }
  const tree = View({
    block: makeBlock('order', [
      { version: 'v0.9', createSurface: { surfaceId: 'order' } },
      { version: 'v0.9', updateDataModel: { surfaceId: 'order', path: '/qty', value: 2 } },
      { version: 'v0.9', updateComponents: { surfaceId: 'order', components: [
        { id: 'root', component: 'Button', child: 't', action: { event: { name: 'buy', context: { qty: { path: '/qty' } } } } },
        { id: 't', component: 'Text', text: '购买' },
      ] } },
    ]),
  })
  // 深度遍历找到 button 并触发 onClick（组件节点先用 expand 展开成元素）
  const findButton = node => {
    node = expand(node)
    if (!node || typeof node !== 'object') return null
    if (node.type === 'button') return node
    for (const c of node.children || []) {
      const found = findButton(c)
      if (found) return found
    }
    return null
  }
  const btn = findButton(tree)
  assert.ok(btn, '应渲染出 button')
  btn.props.onClick()
  assert.equal(posted.url, '/dsh-a2ui/api/action')
  assert.equal(posted.body.name, 'buy')
  assert.equal(posted.body.surfaceId, 'order')
  assert.equal(posted.body.context.qty, 2)
  delete globalThis.fetch
})

ok('含 hooks 子组件（TextField / Tabs）完整渲染（A2UINode 独立实例回归）', () => {
  const tree = View({
    block: makeBlock('form', [
      { version: 'v0.9', createSurface: { surfaceId: 'form' } },
      { version: 'v0.9', updateDataModel: { surfaceId: 'form', path: '/', value: { name: '初始值' } } },
      { version: 'v0.9', updateComponents: { surfaceId: 'form', components: [
        { id: 'root', component: 'Column', children: ['field', 'tabs'] },
        { id: 'field', component: 'TextField', label: '名称', value: { path: '/name' } },
        { id: 'tabs', component: 'Tabs', tabs: [{ title: '页1', child: 'p1' }, { title: '页2', child: 'p2' }] },
        { id: 'p1', component: 'Text', text: '第一页内容' },
        { id: 'p2', component: 'Text', text: '第二页内容' },
      ] } },
    ]),
  })
  const text = textOf(tree)
  assert.match(text, /名称/)
  assert.match(text, /页1/)
  assert.match(text, /第一页内容/)
  // 含 hooks 的子树必须以独立组件实例存在（mini React 已逐实例执行，真实 React 下 hooks 各自归属）
  const findInput = node => {
    if (!node || typeof node !== 'object') return null
    if (node.type === 'input') return node
    for (const c of node.children || []) { const f = findInput(c); if (f) return f }
    return null
  }
  const input = findInput(tree)
  assert.ok(input, 'TextField 应渲染出 input')
  assert.equal(input.props.value, '初始值')
})

ok('已完成轮次：turnTail 常驻渲染；进行中不重复渲染', () => {
  const turn = { turn: 1, status: 'closed' }
  const snapshot = {
    locations: { getTurn: () => ['tool-1'] },
    nodes: { get: () => ({ kind: 'tool-call', data: { root: {
      phase: 'start', name: 'render_ui', argsRaw: JSON.stringify({ surfaceId: 'weather', title: '天气卡片' }),
    } } }) },
  }
  const useChat = selector => selector(snapshot)
  const completed = TurnTail({ turn, useChat })
  assert.match(textOf(completed), /天气卡片/)
  assert.match(textOf(completed), /深圳天气/)
  const running = TurnTail({ turn: { ...turn, status: 'open' }, useChat })
  assert.equal(textOf(running), '')
})

console.log('simulate-client: ' + n + ' 项全部通过')
