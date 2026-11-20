/**
 * dsh-a2ui · host 工具定义（纯工厂，不依赖 @deepseek-ai/dsh-tools，便于单测）。
 * index.js 负责用 defineTool 包装并注册。
 */
import { validateEnvelope } from '../shared/protocol.js'

export const TOOL_NAMES = {
  render: 'render_ui',
  guide: 'get_a2ui_guide',
  actions: 'read_ui_actions',
}

/** 有界 Action 队列：客户端 POST 入队，模型 read_ui_actions 拉取。 */
export function createActionQueue(maxActions = 200) {
  const queue = []
  return {
    push(action) {
      queue.push({ ...action, receivedAt: new Date().toISOString() })
      if (queue.length > maxActions) queue.splice(0, queue.length - maxActions)
      return queue.length
    },
    drain(surfaceId, clear = true) {
      const matched = queue.filter(a => !surfaceId || a.surfaceId === surfaceId)
      if (clear) {
        for (let i = queue.length - 1; i >= 0; i--) {
          if (!surfaceId || queue[i].surfaceId === surfaceId) queue.splice(i, 1)
        }
      }
      return matched
    },
    get size() { return queue.length },
  }
}

/**
 * @param {object} deps
 * @param {() => string} deps.readGuide 读取协议指南（guide.md + catalog）。
 * @param {ReturnType<typeof createActionQueue>} deps.actionQueue
 */
export function createA2UITools(deps) {
  const renderUi = {
    name: TOOL_NAMES.render,
    description:
      '在对话中实时生成 / 增量更新可交互 UI 卡片（A2UI v0.9 协议，Kuikly catalog 超集）。'
      + '首次使用前必须调用 get_a2ui_guide 获取协议与组件目录。'
      + '工作流：createSurface 创建画布 → updateComponents 下发组件（root 为根）→ updateDataModel 写数据；'
      + '同一 surfaceId 可多次调用实现流式增量渲染，已展示的卡片会原地更新。'
      + '用户交互（按钮等 action）通过 read_ui_actions 拉取。',
    parameters: {
      surfaceId: {
        type: 'string', required: true,
        description: '画布 ID。同一 ID 的多次调用构成增量更新流；不同卡片使用不同 ID。',
      },
      title: { type: 'string', description: '卡片标题（展示用，可选）。' },
      messages: {
        type: 'array', required: true,
        description:
          'A2UI envelope 数组，逐条应用。每条为对象且恰含 createSurface / updateComponents / updateDataModel / deleteSurface 之一，'
          + '内部 surfaceId 必须与参数 surfaceId 一致。例如 '
          + '[{"version":"v0.9","createSurface":{"surfaceId":"weather","catalogId":"kuikly_a2ui_catalog.json"}},'
          + '{"version":"v0.9","updateComponents":{"surfaceId":"weather","components":[{"id":"root","component":"Card","child":"col"}]}}]。',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const { surfaceId, messages } = args
      if (!Array.isArray(messages) || messages.length === 0) {
        throw new Error('messages 必须是非空数组；若只需创建画布，请传一条 createSurface。')
      }
      if (messages.length > 200) throw new Error('单次调用最多 200 条 envelope，请分批调用。')
      const types = []
      for (let i = 0; i < messages.length; i++) {
        const env = messages[i]
        const err = validateEnvelope(env)
        if (err) throw new Error('messages[' + i + '] 无效：' + err)
        const key = ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface'].find(k => env[k] != null)
        if (env[key].surfaceId !== surfaceId) {
          throw new Error('messages[' + i + '] 的 surfaceId（' + env[key].surfaceId + '）与参数 surfaceId（' + surfaceId + '）不一致。')
        }
        types.push(key)
      }
      return JSON.stringify({
        surfaceId,
        accepted: messages.length,
        messageTypes: types,
        hint: 'UI 已在客户端渲染 / 更新。用户 action 通过 read_ui_actions 获取。',
      })
    },
  }

  const getGuide = {
    name: TOOL_NAMES.guide,
    description: '获取 A2UI 协议指南：消息格式、18 个标准组件、数据绑定、内置函数、styles 扩展、action 回传与完整示例。使用 render_ui 前必读。',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute() {
      return deps.readGuide()
    },
  }

  const readActions = {
    name: TOOL_NAMES.actions,
    description:
      '拉取用户在 A2UI 卡片上的操作（按钮点击等 action 事件，含已求值的 context）。'
      + '默认读取后清空队列；需要继续交互时，根据 action 内容再次调用 render_ui 更新界面。',
    parameters: {
      surfaceId: { type: 'string', description: '只读取指定画布的 action；缺省读取全部。' },
      clear: { type: 'boolean', description: '读取后是否清空（默认 true）。' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const clear = args.clear !== false
      const actions = deps.actionQueue.drain(args.surfaceId, clear)
      return JSON.stringify({ count: actions.length, actions })
    },
  }

  return [renderUi, getGuide, readActions]
}
