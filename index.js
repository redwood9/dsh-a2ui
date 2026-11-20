/**
 * dsh-a2ui —— DeepSeek Harness 实时生成 UI（host 半边）。
 *
 * 职责：
 *  1. 注册模型工具：render_ui / get_a2ui_guide / read_ui_actions；
 *  2. 提供协议指南（catalog/guide.md + Kuikly catalog JSON）；
 *  3. 通过 webServer 暴露 /dsh-a2ui/api/*：客户端 action 回传入队，供模型拉取。
 *
 * webServer 为可选依赖：不可用时仅失去 HTTP 回传通道（客户端降级为剪贴板），
 * 工具与 UI 渲染链路不受影响。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import { createA2UITools, createActionQueue } from './src/host/tools.js'

export const name = 'dsh-a2ui'
export const inject = ['tools']

export const Config = Schema.object({
  maxActions: Schema.number().default(200).description('Action 回传队列上限（超出丢弃最旧）'),
})

const root = dirname(fileURLToPath(import.meta.url))

function readGuide() {
  const guide = readFileSync(join(root, 'catalog', 'guide.md'), 'utf8')
  const catalog = readFileSync(join(root, 'catalog', 'kuikly_a2ui_catalog.json'), 'utf8')
  return guide + '\n\n---\n\n# Kuikly A2UI Catalog（JSON Schema）\n\n```json\n' + catalog + '\n```\n'
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}) } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

function send(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(body)
}

export function apply(ctx, config) {
  const cfg = config || {}
  const actionQueue = createActionQueue(cfg.maxActions || 200)
  const tools = createA2UITools({ readGuide, actionQueue })
  for (const tool of tools) ctx.tools.register(defineTool(tool))

  const ROUTE = '/dsh-a2ui'

  // webServer 由 web-app / 桌面宿主提供，注册时机晚于本插件 apply，
  // 因此用延迟注入：服务就绪后再挂路由（cordis 的 inject 回调会重放）。
  ctx.inject(['webServer'], (host) => {
    host.effect(() => host.webServer.register({
      kind: 'prefix',
      path: ROUTE + '/api',
      handler: async (req, res) => {
        const method = req.method || 'GET'
        const pathname = String(req.url || '').split('?')[0]
        try {
          if (method === 'GET' && pathname === ROUTE + '/api/health') {
            return send(res, 200, { ok: true, pendingActions: actionQueue.size })
          }
          if (method === 'POST' && pathname === ROUTE + '/api/action') {
            const body = await readBody(req)
            if (!body || typeof body.name !== 'string' || typeof body.surfaceId !== 'string') {
              return send(res, 400, { ok: false, error: '需要 surfaceId 与 name 字段' })
            }
            actionQueue.push({
              surfaceId: body.surfaceId,
              name: body.name,
              context: body.context && typeof body.context === 'object' ? body.context : {},
            })
            return send(res, 200, { ok: true })
          }
          return send(res, 404, { ok: false, error: 'not found' })
        } catch (e) {
          return send(res, 500, { ok: false, error: e && e.message ? e.message : String(e) })
        }
      },
    }), 'dsh-a2ui: ' + ROUTE + '/api')
    console.log('[dsh-a2ui] HTTP API 已挂载 ' + ROUTE + '/api')
  })

  console.log('[dsh-a2ui] 已注册 render_ui / get_a2ui_guide / read_ui_actions')
}
