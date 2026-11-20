/**
 * dsh-a2ui · 工具卡视图：render_ui 工具调用的会话内渲染。
 *
 * 实时模型：同一 surfaceId 可被多次 render_ui 调用增量更新。
 * 第一张调用卡为「主卡」，渲染该 Surface 的实时最新状态；
 * 后续调用卡显示增量摘要。所有卡共享模块级 SurfaceStore，
 * 主卡通过订阅 store 实现"后续消息到达 → 已渲染卡片原地更新"。
 * 会话刷新后各卡按日志顺序重放消息，Surface 状态自动重建。
 */

const surfaceRegistry = new Map() // surfaceId -> { store, primaryCardId, cardOrder: [] }
let cardSeq = 0

/**
 * 渲染错误边界：任一组件渲染抛错时，把错误显示在卡片里，
 * 而不是让 React 卸载整块 toolview（那会表现为卡片"一闪而过"后消失）。
 */
const ReactComponentBase = (typeof React !== 'undefined' && React.Component) || class {
  constructor(props) { this.props = props; this.state = {} }
  setState(next) { this.state = { ...this.state, ...next } }
}
class SurfaceBoundary extends ReactComponentBase {
  state = { message: '' }
  static getDerivedStateFromError(error) {
    return { message: error && error.message ? error.message : String(error) }
  }
  render() {
    if (this.state.message) {
      return React.createElement('div', {
        style: { fontSize: '12px', color: '#e5484d', whiteSpace: 'pre-wrap' },
      }, '界面渲染失败：' + this.state.message)
    }
    return this.props.children
  }
}

/** 最外层边界：连 A2UIToolView 自身的 hooks / 数据装配异常也留在卡片内。 */
class A2UIToolViewBoundary extends ReactComponentBase {
  state = { message: '' }
  static getDerivedStateFromError(error) {
    return { message: error && error.message ? error.message : String(error) }
  }
  componentDidCatch(error) {
    if (typeof window !== 'undefined' && window.__A2UI_DEBUG) {
      window.__A2UI_DEBUG.error = 'A2UIToolView: ' + (error && error.message ? error.message : String(error))
      window.__A2UI_DEBUG.errorStack = error && error.stack ? String(error.stack) : null
    }
  }
  render() {
    if (this.state.message) {
      return React.createElement('div', {
        className: 'a2ui-toolview',
        style: { padding: '8px 0', fontSize: '12px', color: '#e5484d', whiteSpace: 'pre-wrap' },
      }, '界面视图加载失败：' + this.state.message)
    }
    return React.createElement(A2UIToolView, this.props)
  }
}

function A2UIToolViewSlot(props) {
  return React.createElement(A2UIToolViewBoundary, props)
}

function surfaceEntry(surfaceId) {
  let e = surfaceRegistry.get(surfaceId)
  if (!e) {
    e = { store: new SurfaceStore(), primaryCardId: null, cardOrder: [] }
    surfaceRegistry.set(surfaceId, e)
  }
  return e
}

function parseToolArgs(block) {
  try {
    const raw = block && block.call && typeof block.call.argsRaw === 'string' ? block.call.argsRaw : ''
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch { return {} }
}

/** 把 action 回传给 host；优先使用不会被页面 fetch 悬挂阻塞的 sendBeacon。 */
function sendActionToHost(action) {
  const body = JSON.stringify(action)
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const accepted = navigator.sendBeacon('/dsh-a2ui/api/action', new Blob([body], { type: 'application/json' }))
      if (accepted) return 'sent'
    }
  } catch { /* 继续尝试 fetch */ }

  // 即使宿主或浏览器异常，也必须在有限时间内结束，不能让按钮永远 pending。
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timeout = setTimeout(() => controller && controller.abort(), 4000)
  return fetch('/dsh-a2ui/api/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: controller ? controller.signal : undefined,
  }).then(r => {
    if (!r.ok) throw new Error('HTTP ' + r.status)
    return 'sent'
  }).catch(() => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText('[A2UI Action] ' + body)
        return 'copied'
      }
    } catch { /* ignore */ }
    return 'failed'
  }).finally(() => clearTimeout(timeout))
}

function sameSurfaceCalls(left, right) {
  return left.length === right.length && left.every((item, index) =>
    item.surfaceId === right[index].surfaceId && item.title === right[index].title
      && item.messages.length === right[index].messages.length)
}

/**
 * 已完成轮次的常驻卡片：turnTail 位于工具过程区之外，不会被标准模式折叠。
 * 进行中的轮次仍由 tool.call.toolview 实时渲染，避免同屏出现两份卡片。
 */
function A2UITurnTail({ turn, useChat }) {
  const calls = useChat((snapshot) => {
    if (turn.status === 'open') return []
    const keys = snapshot.locations.getTurn(turn.turn) || []
    const bySurface = new Map()
    for (const key of keys) {
      const node = snapshot.nodes.get(key)
      const root = node && node.kind === 'tool-call' ? node.data.root : null
      if (!root || (root.name !== 'render_ui' && root.call?.name !== 'render_ui')) continue
      const args = parseToolArgs(root.call ? root : { call: root })
      if (typeof args.surfaceId !== 'string' || !args.surfaceId) continue
      const previous = bySurface.get(args.surfaceId)
      bySurface.set(args.surfaceId, {
        surfaceId: args.surfaceId,
        title: typeof args.title === 'string' && args.title ? args.title : previous?.title || '实时界面',
        messages: [...(previous?.messages || []), ...(Array.isArray(args.messages) ? args.messages : [])],
      })
    }
    return [...bySurface.values()]
  }, sameSurfaceCalls)
  return React.createElement(React.Fragment, null, calls.map(({ surfaceId, title, messages }) =>
    React.createElement(A2UIToolView, {
      key: surfaceId,
      primary: true,
      block: {
        kind: 'tool-result',
        call: { argsRaw: JSON.stringify({ surfaceId, title, messages }) },
      },
    })))
}

function A2UIToolView(props) {
  const { block } = props
  const h = React.createElement
  const isResult = !!block && block.kind === 'tool-result'
  const failed = isResult && !!block.isError
  const args = parseToolArgs(block)
  const surfaceId = typeof args.surfaceId === 'string' && args.surfaceId ? args.surfaceId : 'main'
  const messages = Array.isArray(args.messages) ? args.messages : []

  const [cardId] = React.useState(() => 'a2ui-card-' + (++cardSeq))
  const [, setVersion] = React.useState(0)
  const [applyError, setApplyError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const appliedRef = React.useRef(false)
  const entry = surfaceEntry(surfaceId)

  // 卡片注册 / 注销（主卡移交）。turnTail 是独立展示副本，不参与主卡选举。
  React.useEffect(() => {
    if (props.primary === true) return undefined
    if (!entry.cardOrder.includes(cardId)) entry.cardOrder.push(cardId)
    if (!entry.primaryCardId) entry.primaryCardId = cardId
    entry.store.bump()
    return () => {
      const idx = entry.cardOrder.indexOf(cardId)
      if (idx >= 0) entry.cardOrder.splice(idx, 1)
      if (entry.primaryCardId === cardId) {
        entry.primaryCardId = entry.cardOrder[0] || null
        entry.store.bump()
      }
    }
  }, [cardId, surfaceId, props.primary])

  // 订阅 Surface 更新（主卡重渲）。
  React.useEffect(() => entry.store.subscribe(() => setVersion(v => v + 1)), [surfaceId])

  // 应用本次调用的协议消息（每卡仅一次）。
  // 不要求已进入 result 阶段：chat 行重建时宿主可能先给回 start 阶段 block，
  // 只要这次调用带了 messages 就先落库，卡片才不会因阶段回退而变空。
  React.useEffect(() => {
    if (failed || appliedRef.current || messages.length === 0) return
    appliedRef.current = true
    try {
      for (const env of messages) entry.store.apply(env)
    } catch (e) {
      setApplyError(e && e.message ? e.message : String(e))
    }
  }, [failed])

  const isPrimary = props.primary === true || entry.primaryCardId === null || entry.primaryCardId === cardId
  const title = typeof args.title === 'string' && args.title ? args.title : '实时界面'

  const ctx = {
    onAction: action => {
      const showStatus = status => setNotice(status === 'sent'
        ? '已回传 Agent：' + action.name
        : status === 'copied'
          ? '回传通道不可用，Action 已复制到剪贴板，请粘贴发送给 Agent'
          : '回传失败：' + action.name)
      setNotice('正在回传 Agent：' + action.name)
      const result = sendActionToHost(action)
      // sendBeacon 是否接受同步可知；直接更新，避免宿主页面的 Promise 调度延迟反馈。
      if (typeof result === 'string') showStatus(result)
      else result.then(showStatus)
    },
  }

  const head = h('div', {
    style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', marginBottom: isResult ? '8px' : 0 },
  }, [
    h('span', { key: 'i' }, '🧩'),
    h('span', { key: 't', style: { fontWeight: 600 } }, title),
    h('span', { key: 's', style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #8a8f99)' } }, '#' + surfaceId),
    !isResult && h('span', {
      key: 'd',
      style: { width: '6px', height: '6px', borderRadius: '50%', background: 'var(--dsw-alias-brand-primary, #4176e6)' },
    }),
  ])

  // 渲染优先级：失败 > 协议错误 > 已有 Surface 就直接画（不管处于哪个阶段）> 等待。
  // 关键：store 里已经有 Surface 时必须出图，否则宿主重建 chat 行、或阶段从
  // result 退回 start 时，卡片会被替换成一行「等待…」，看起来像一闪而过。
  const surface = entry.store.getSurface(surfaceId)
  const body = []
  if (failed) {
    body.push(h('div', { key: 'err', style: { fontSize: '12px', color: '#e5484d', whiteSpace: 'pre-wrap' } }, 'render_ui 调用失败'))
  } else if (applyError) {
    body.push(h('div', { key: 'aerr', style: { fontSize: '12px', color: '#e5484d', whiteSpace: 'pre-wrap' } }, '协议消息应用失败：' + applyError))
  } else if (!surface) {
    body.push(h('div', { key: 'wait', style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #8a8f99)' } },
      '等待模型下发 UI 消息…'))
  } else if (!isPrimary) {
    body.push(h('div', { key: 'delta', style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #8a8f99)' } },
      '已增量更新实时界面 #' + surfaceId + '（+' + messages.length + ' 条消息），内容见上方主卡片。'))
  } else {
    let tree = null
    let renderError = ''
    // renderSurface 在当前组件的 render 阶段执行；必须在这里捕获，
    // 否则错误会越过下方 SurfaceBoundary，由宿主 slot 直接清成空白。
    try {
      tree = renderSurface(entry.store, surface, ctx)
    } catch (e) {
      renderError = e && e.message ? e.message : String(e)
      if (typeof window !== 'undefined' && window.__A2UI_DEBUG) {
        window.__A2UI_DEBUG.error = 'renderSurface: ' + renderError
        window.__A2UI_DEBUG.errorStack = e && e.stack ? String(e.stack) : null
      }
    }
    if (renderError) {
      body.push(h('div', { key: 'rerr', style: { fontSize: '12px', color: '#e5484d', whiteSpace: 'pre-wrap' } },
        '界面渲染失败：' + renderError))
    } else {
      body.push(tree
        ? h(SurfaceBoundary, { key: 'surface' }, h('div', { className: 'a2ui-surface', style: { padding: '4px 0' } }, tree))
        : h('div', { key: 'empty', style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #8a8f99)' } },
          'Surface 已创建，等待 root 组件…'))
    }
    body.push(h('div', { key: 'hint', style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #8a8f99)', marginTop: '6px' } },
      '界面由 AI 实时生成 · 点击按钮等交互将回传 Agent'))
  }
  if (notice) {
    body.push(h('div', { key: 'notice', style: { fontSize: '12px', color: 'var(--dsw-alias-brand-primary, #4176e6)', marginTop: '6px' } }, notice))
  }

  return h('div', { className: 'a2ui-toolview', style: { padding: '2px 0', maxWidth: '100%' } }, [head, ...body])
}
