/**
 * host 半边真模块测试：
 *  - createA2UITools 工具工厂（execute 成功 / 校验失败路径）；
 *  - index.js 真实 apply()：stub @deepseek-ai/dsh-tools 与 @deepseek-ai/schemastery
 *    （测试自动在 node_modules 下生成 stub，不打补丁源码），断言工具注册与 HTTP API。
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { EventEmitter } from 'node:events'
import { createA2UITools, createActionQueue } from '../src/host/tools.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
let n = 0
const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name) }
const okAsync = async (name, fn) => { await fn(); n++; console.log('  ✓ ' + name) }

console.log('verify-host')

const validMessages = sid => [
  { version: 'v0.9', createSurface: { surfaceId: sid, catalogId: 'kuikly_a2ui_catalog.json' } },
  { version: 'v0.9', updateComponents: { surfaceId: sid, components: [{ id: 'root', component: 'Text', text: 'hi' }] } },
]

await okAsync('render_ui：合法调用返回规范 JSON', async () => {
  const tools = createA2UITools({ readGuide: () => 'GUIDE', actionQueue: createActionQueue() })
  const out = JSON.parse(await tools[0].execute({ surfaceId: 's', messages: validMessages('s') }))
  assert.equal(out.accepted, 2)
  assert.deepEqual(out.messageTypes, ['createSurface', 'updateComponents'])
})

await okAsync('render_ui：空 messages / 非法 envelope / surfaceId 不一致均抛错', async () => {
  const tools = createA2UITools({ readGuide: () => '', actionQueue: createActionQueue() })
  await assert.rejects(() => tools[0].execute({ surfaceId: 's', messages: [] }), /非空数组/)
  await assert.rejects(() => tools[0].execute({ surfaceId: 's', messages: [{}] }), /messages\[0\] 无效/)
  await assert.rejects(() => tools[0].execute({ surfaceId: 's', messages: validMessages('other') }), /不一致/)
})

await okAsync('get_a2ui_guide 返回指南文本', async () => {
  const tools = createA2UITools({ readGuide: () => 'GUIDE-TEXT', actionQueue: createActionQueue() })
  assert.equal(await tools[1].execute({}), 'GUIDE-TEXT')
})

await okAsync('read_ui_actions：过滤 / 清空 / 保留', async () => {
  const queue = createActionQueue()
  queue.push({ surfaceId: 'a', name: 'buy', context: { qty: 2 } })
  queue.push({ surfaceId: 'b', name: 'submit', context: {} })
  const tools = createA2UITools({ readGuide: () => '', actionQueue: queue })
  const onlyA = JSON.parse(await tools[2].execute({ surfaceId: 'a', clear: false }))
  assert.equal(onlyA.count, 1)
  assert.equal(onlyA.actions[0].name, 'buy')
  assert.equal(queue.size, 2) // clear=false 保留
  const all = JSON.parse(await tools[2].execute({}))
  assert.equal(all.count, 2)
  assert.equal(queue.size, 0) // 默认清空
})

ok('createActionQueue 超出上限丢弃最旧', () => {
  const q = createActionQueue(3)
  for (let i = 0; i < 5; i++) q.push({ surfaceId: 's', name: 'e' + i })
  assert.equal(q.size, 3)
  assert.equal(q.drain()[0].name, 'e2')
})

// ---- index.js 真模块加载（stub 官方依赖） ----
function ensureStub(pkg, files) {
  const dir = join(root, 'node_modules', pkg)
  if (existsSync(join(dir, 'index.js'))) return
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: pkg, version: '0.0.0-test-stub', type: 'module', main: 'index.js' }))
  for (const [file, code] of Object.entries(files)) writeFileSync(join(dir, file), code)
}
ensureStub('@deepseek-ai/dsh-tools', { 'index.js': 'export const defineTool = d => d\n' })
ensureStub('@deepseek-ai/schemastery', {
  'index.js': 'const chain = { default: () => chain, description: () => chain }\nexport default { object: o => o, number: () => chain }\n',
})

const { apply, inject, name } = await import('../index.js')

await okAsync('index.js apply：注册三个工具 + HTTP action 回传', async () => {
  const registered = []
  let httpHandler = null
  const webServer = { register: ({ handler }) => { httpHandler = handler } }
  const ctx = {
    tools: { register: d => registered.push(d) },
    get: key => (key === 'webServer' ? webServer : undefined),
    // 真宿主是 cordis：webServer 在 apply 之后才注册，插件用延迟注入挂路由。
    inject: (services, cb) => {
      assert.deepEqual(services, ['webServer'])
      cb({ webServer, effect: fn => fn() })
    },
  }
  apply(ctx, { maxActions: 10 })
  assert.equal(name, 'dsh-a2ui')
  assert.deepEqual(inject, ['tools'])
  assert.deepEqual(registered.map(t => t.name), ['render_ui', 'get_a2ui_guide', 'read_ui_actions'])
  assert.equal(typeof httpHandler, 'function')

  // 模拟 POST /dsh-a2ui/api/action
  const req = new EventEmitter()
  req.method = 'POST'
  req.url = '/dsh-a2ui/api/action'
  const res = {
    status: 0, body: '',
    writeHead(s) { this.status = s },
    end(b) { this.body = b },
  }
  const done = httpHandler(req, res)
  req.emit('data', Buffer.from(JSON.stringify({ surfaceId: 'order', name: 'buy', context: { qty: 3 } })))
  req.emit('end')
  await done
  assert.equal(res.status, 200)

  const readActions = registered.find(t => t.name === 'read_ui_actions')
  const actions = JSON.parse(await readActions.execute({}))
  assert.equal(actions.count, 1)
  assert.equal(actions.actions[0].context.qty, 3)

  // guide 真实读取文件
  const guide = await registered.find(t => t.name === 'get_a2ui_guide').execute({})
  assert.match(guide, /A2UI 实时界面生成指南/)
  assert.match(guide, /Kuikly A2UI Catalog/)
})

console.log('verify-host: ' + n + ' 项全部通过')
