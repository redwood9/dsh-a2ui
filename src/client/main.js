/**
 * dsh-a2ui · client 入口：注册 render_ui 工具的专属视图。
 * 与宿主契约：tool.call.toolview 为 keyed slot，命中 render_ui 后官方
 * 通用卡 fallback 不再生效，A2UIToolView 自行覆盖 运行中 / 失败 / 结果 全状态。
 */

function apply(ctx) {
  window.__A2UI_DEBUG.applied = true
  const slots = ctx.get('slots')
  window.__A2UI_DEBUG.hasSlots = slots !== undefined
  if (slots === undefined) return
  window.__A2UI_DEBUG.hasErrorListener = typeof slots.onEntryError === 'function'
  if (typeof slots.onEntryError === 'function') {
    slots.onEntryError((key, entry, error) => {
      if (key !== 'tool.call.toolview') return
      window.__A2UI_DEBUG.error = 'host: ' + (error && error.message ? error.message : String(error))
      window.__A2UI_DEBUG.errorStack = error && error.stack ? String(error.stack) : null
    })
  }
  slots.inject('tool.call.toolview', () => slots.register({
    name: 'tool.call.toolview',
    key: 'render_ui',
  }, A2UIToolViewSlot))
  slots.inject('conversation.chat.turnTail', () => {
    window.__A2UI_DEBUG.hasTurnTail = true
    return slots.register({
      name: 'conversation.chat.turnTail',
      id: 'dsh-a2ui',
    }, A2UITurnTail)
  })
  window.__A2UI_DEBUG.registered = true
}
