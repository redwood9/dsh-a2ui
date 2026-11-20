/**
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

// ===== src/shared/protocol.js =====
/**
 * dsh-a2ui · A2UI v0.9 协议状态机（与 KuiklyUI-A2UI 对齐）。
 *
 * 纯 JS、零依赖，host（Node）/ client（浏览器 bundle）/ 测试共用。
 *
 * 协议要点（v0.9，Kuikly catalog 超集）：
 *  - 四种 envelope：createSurface / updateComponents / updateDataModel / deleteSurface
 *  - 组件为平坦邻接表：Map<id, component>，root 为根，渲染期组树
 *  - 数据绑定：{"path": "/xxx"}；函数调用：{"call": "...", "args": {...}}
 *  - ChildList 模板：children: {path, componentId}，模板内 path 以列表项为作用域
 */

// ---------------------------------------------------------------- JSON Pointer

function getPointer(obj, pointer) {
  if (pointer === '' || pointer === '/' || pointer == null) return obj
  const parts = String(pointer).replace(/^\//, '').split('/')
  let cur = obj
  for (const raw of parts) {
    if (cur == null) return undefined
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    cur = cur[key]
  }
  return cur
}

function setPointer(obj, pointer, value) {
  if (pointer === '' || pointer === '/' || pointer == null) return value
  const parts = String(pointer).replace(/^\//, '').split('/')
    .map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'))
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]
    if (cur[key] == null || typeof cur[key] !== 'object') {
      cur[key] = /^\d+$/.test(parts[i + 1]) ? [] : {}
    }
    cur = cur[key]
  }
  cur[parts[parts.length - 1]] = value
  return obj
}

/** 模板作用域拼接：scope="/items/0"，path="/name" → "/items/0/name"。 */
function scopePath(scope, path) {
  if (!scope) return path
  if (!path || path === '/' || path === '') return scope
  return scope + (String(path).startsWith('/') ? path : '/' + path)
}

// ---------------------------------------------------------------- 内置函数（签名对齐 Kuikly A2UIProtocolAdapter）

function toBool(v) {
  if (v == null) return false
  if (typeof v === 'string') return v !== '' && v.toLowerCase() !== 'false'
  return !!v
}

function addThousands(numStr) {
  const [int, frac] = String(numStr).split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return frac != null ? grouped + '.' + frac : grouped
}

function formatDouble(num, decimals) {
  return Number(num).toFixed(decimals)
}

function formatDateString(dateStr, format) {
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  const pad = n => String(n).padStart(2, '0')
  const tokens = {
    yyyy: String(d.getFullYear()),
    MM: pad(d.getMonth() + 1),
    dd: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
  }
  // 先替换长 token，避免 "MM" 被 "M" 抢先；单字母 token 最后处理。
  return String(format)
    .replace(/yyyy|MM|dd|HH|mm|ss|M|d|H|m|s/g, t => {
      if (tokens[t] != null) return tokens[t]
      const map = {
        M: String(d.getMonth() + 1), d: String(d.getDate()),
        H: String(d.getHours()), m: String(d.getMinutes()), s: String(d.getSeconds()),
      }
      return map[t] != null ? map[t] : t
    })
}

/**
 * formatString 模板：value 为含 ${/path} 占位的字符串。
 * 与 Kuikly resolveFormatStringTemplate 的占位语法一致。
 */
function resolveFormatTemplate(template, surface, scope) {
  return String(template).replace(/\$\{([^}]+)\}/g, (_, expr) => {
    const p = expr.trim()
    if (p.startsWith('/')) {
      const v = getPointer(surface.dataModel, scopePath(scope, p))
      return v == null ? '' : String(v)
    }
    return ''
  })
}

function evaluateFunction(call, args, surface, scope) {
  const a = args || {}
  const val = key => resolveValue(a[key], surface, scope)
  switch (call) {
    case 'required': {
      const v = val('value')
      if (v == null) return false
      if (typeof v === 'string') return v.trim() !== ''
      return toBool(v)
    }
    case 'regex': {
      const v = val('value')
      const pattern = val('pattern')
      if (v == null || pattern == null) return false
      try { return new RegExp(String(pattern)).test(String(v)) } catch { return false }
    }
    case 'email': {
      const v = val('value')
      return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
    }
    case 'length': {
      const v = val('value')
      if (v == null) return false
      const len = String(v).length
      const min = a.min != null ? Number(a.min) : null
      const max = a.max != null ? Number(a.max) : null
      if (min != null && len < min) return false
      if (max != null && len > max) return false
      return true
    }
    case 'numeric': {
      const v = val('value')
      const num = typeof v === 'number' ? v : (typeof v === 'string' && v !== '' ? Number(v) : NaN)
      if (!isFinite(num)) return false
      const min = a.min != null ? Number(a.min) : null
      const max = a.max != null ? Number(a.max) : null
      if (min != null && num < min) return false
      if (max != null && num > max) return false
      return true
    }
    case 'and': return (a.values || []).every(v => toBool(resolveValue(v, surface, scope)))
    case 'or': return (a.values || []).some(v => toBool(resolveValue(v, surface, scope)))
    case 'not': {
      const v = a.value != null ? a.value : (Array.isArray(a.values) ? a.values[0] : undefined)
      return !toBool(resolveValue(v, surface, scope))
    }
    case 'formatString': {
      const tpl = val('value')
      return tpl == null ? '' : resolveFormatTemplate(tpl, surface, scope)
    }
    case 'formatNumber': {
      const raw = val('value')
      if (raw == null) return ''
      const num = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''))
      if (!isFinite(num)) return String(raw)
      const decimals = a.decimals != null ? Number(a.decimals)
        : (a.precision != null ? Number(a.precision) : null)
      const grouping = a.grouping != null ? toBool(val('grouping')) : true
      let out = decimals != null ? formatDouble(num, decimals)
        : (Number.isInteger(num) ? String(num) : String(num))
      return grouping ? addThousands(out) : out
    }
    case 'formatCurrency': {
      const raw = val('value')
      if (raw == null) return ''
      const num = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''))
      if (!isFinite(num)) return String(raw)
      const currency = String(val('currency') || 'USD').toUpperCase()
      const symbol = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥' }[currency] || currency
      return symbol + addThousands(formatDouble(num, 2))
    }
    case 'formatDate': {
      const v = val('value')
      const format = val('format')
      if (v == null || format == null || String(v) === '') return ''
      return formatDateString(String(v), String(format))
    }
    case 'pluralize': {
      const raw = val('value')
      const count = typeof raw === 'number' ? Math.trunc(raw) : (parseInt(raw, 10) || 0)
      const zero = val('zero'), one = val('one'), other = val('other')
      if (count === 0 && zero != null) return String(zero)
      if (count === 1 && one != null) return String(one)
      return other != null ? String(other) : ''
    }
    default:
      return undefined
  }
}

// ---------------------------------------------------------------- 绑定求值

function isBinding(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v)
    && (typeof v.path === 'string' || typeof v.call === 'string')
    && Object.keys(v).every(k => k === 'path' || k === 'call' || k === 'args' || k === 'returnType' || k === 'literal')
}

function resolveValue(value, surface, scope) {
  if (value == null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(v => resolveValue(v, surface, scope))
  if (typeof value.path === 'string' && value.call == null) {
    return getPointer(surface.dataModel, scopePath(scope, value.path))
  }
  if (typeof value.call === 'string') {
    return evaluateFunction(value.call, value.args, surface, scope)
  }
  const out = {}
  for (const k of Object.keys(value)) out[k] = resolveValue(value[k], surface, scope)
  return out
}

// ---------------------------------------------------------------- SurfaceStore

const ENVELOPE_KEYS = ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface']

/** 校验一条 envelope，返回错误消息或 null。host 工具与 client 共用。 */
function validateEnvelope(env) {
  if (env == null || typeof env !== 'object' || Array.isArray(env)) return 'envelope 必须是对象'
  const keys = ENVELOPE_KEYS.filter(k => env[k] != null)
  if (keys.length !== 1) return 'envelope 必须且只能包含 ' + ENVELOPE_KEYS.join('/') + ' 之一'
  const body = env[keys[0]]
  if (body == null || typeof body !== 'object') return keys[0] + ' 必须是对象'
  if (typeof body.surfaceId !== 'string' || body.surfaceId === '') return keys[0] + '.surfaceId 必须是非空字符串'
  if (keys[0] === 'updateComponents' && !Array.isArray(body.components)) return 'updateComponents.components 必须是数组'
  if (keys[0] === 'updateComponents') {
    for (const c of body.components) {
      if (c == null || typeof c.id !== 'string' || typeof c.component !== 'string') {
        return '每个组件必须包含字符串 id 与 component'
      }
    }
  }
  return null
}

class SurfaceStore {
  constructor() {
    this.surfaces = new Map()
    this.listeners = new Set()
    this.version = 0
  }

  subscribe(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  bump() {
    this.version++
    for (const fn of [...this.listeners]) {
      try { fn(this.version) } catch { /* 监听者异常不影响其它 */ }
    }
  }

  getSurface(id) {
    return this.surfaces.get(id)
  }

  ensureSurface(id) {
    let s = this.surfaces.get(id)
    if (!s) {
      s = { id, catalogId: null, components: new Map(), dataModel: {}, sendDataModel: false }
      this.surfaces.set(id, s)
    }
    return s
  }

  /** 应用一条 envelope，返回 {surfaceId, type}。 */
  apply(env) {
    const err = validateEnvelope(env)
    if (err) throw new Error(err)
    const type = ENVELOPE_KEYS.find(k => env[k] != null)
    const body = env[type]
    const id = body.surfaceId
    switch (type) {
      case 'createSurface': {
        const s = this.ensureSurface(id)
        s.catalogId = body.catalogId || s.catalogId
        s.sendDataModel = !!body.sendDataModel
        if (body.dataModel != null) s.dataModel = body.dataModel
        if (Array.isArray(body.components)) this.mergeComponents(s, body.components)
        break
      }
      case 'updateComponents':
        this.mergeComponents(this.ensureSurface(id), body.components)
        break
      case 'updateDataModel': {
        const s = this.ensureSurface(id)
        s.dataModel = setPointer(s.dataModel, body.path, body.value)
        break
      }
      case 'deleteSurface':
        this.surfaces.delete(id)
        break
    }
    this.bump()
    return { surfaceId: id, type }
  }

  mergeComponents(surface, components) {
    for (const c of components) surface.components.set(c.id, c)
  }

  /**
   * 解析 children 为渲染项列表。
   * 返回 [{id, scope}]：静态项 scope=null；模板项 id=模板组件 id，scope=列表项路径。
   */
  resolveChildren(children, surface, scope) {
    if (children == null) return []
    if (Array.isArray(children)) return children.map(id => ({ id, scope }))
    if (typeof children === 'object' && typeof children.componentId === 'string' && typeof children.path === 'string') {
      const list = getPointer(surface.dataModel, scopePath(scope, children.path))
      if (!Array.isArray(list)) return []
      const base = scopePath(scope, children.path)
      return list.map((_, i) => ({ id: children.componentId, scope: base + '/' + i }))
    }
    return []
  }
}


// ===== src/shared/styles.js =====
/**
 * dsh-a2ui · Kuikly `styles` 扩展 → CSS 映射。
 *
 * 输入为 Kuikly catalog（kuikly_a2ui_catalog.json）定义的可选 styles 属性包，
 * 输出 React style 对象。数值尺寸单位按 Kuikly dp/pt 1:1 映射为 px。
 * 值在传入前应已 resolveValue（绑定求值）；未识别字段静默忽略。
 */

const PX_KEYS = new Set([
  'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
  'padding', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
  'borderRadius', 'borderWidth', 'top', 'left', 'bottom', 'right',
  'fontSize', 'letterSpacing', 'firstLineHeadIndent', 'flexBasis',
])

const DIRECT_KEYS = {
  flexGrow: 'flexGrow', flexShrink: 'flexShrink', alignSelf: 'alignSelf',
  borderColor: 'borderColor', borderStyle: 'borderStyle',
  opacity: 'opacity', overflow: 'overflow', zIndex: 'zIndex',
  fontWeight: 'fontWeight', fontStyle: 'fontStyle', fontFamily: 'fontFamily',
  textAlign: 'textAlign', textDecoration: 'textDecoration',
}

const GRADIENT_DIRS = {
  'to-top': 'to top', 'to-bottom': 'to bottom', 'to-left': 'to left', 'to-right': 'to right',
  0: 'to top', 1: 'to bottom', 2: 'to left', 3: 'to right',
}

const TEXT_PX_KEYS = new Set(['fontSize', 'letterSpacing', 'firstLineHeadIndent'])

function px(v) {
  return typeof v === 'number' ? v + 'px' : v
}

function gradientCss(v) {
  if (typeof v === 'string') {
    // Kuikly shorthand: linear-gradient(<dir_int>, color stop, ...)
    const m = /^linear-gradient\(\s*(\d)\s*,([\s\S]+)\)$/.exec(v.trim())
    if (m) {
      const dir = GRADIENT_DIRS[Number(m[1])] || 'to bottom'
      const stops = m[2].split(',').map(s => {
        const p = s.trim().split(/\s+/)
        if (p.length === 2 && !isNaN(Number(p[1]))) return p[0] + ' ' + (Number(p[1]) * 100) + '%'
        return s.trim()
      }).join(', ')
      return `linear-gradient(${dir}, ${stops})`
    }
    return v
  }
  if (v && typeof v === 'object') {
    const dir = GRADIENT_DIRS[v.direction] || 'to bottom'
    const stops = Array.isArray(v.colorStops) ? v.colorStops.map(s =>
      `${s.color} ${Math.round((Number(s.stop) || 0) * 100)}%`).join(', ') : ''
    return stops ? `linear-gradient(${dir}, ${stops})` : null
  }
  return null
}

function boxShadowCss(v) {
  if (typeof v === 'string') {
    // KR shorthand: "offsetX offsetY radius color [fill]"
    const p = v.trim().split(/\s+/)
    if (p.length >= 4) {
      return `${p[4] === '1' ? 'inset ' : ''}${px(Number(p[0]))} ${px(Number(p[1]))} ${px(Number(p[2]))} ${p[3]}`
    }
    return v
  }
  if (v && typeof v === 'object') {
    const x = px(Number(v.offsetX) || 0), y = px(Number(v.offsetY) || 0)
    const r = px(Number(v.radius) || 0), color = v.color || 'rgba(0,0,0,0.2)'
    return `${v.fill ? 'inset ' : ''}${x} ${y} ${r} ${color}`
  }
  return null
}

function transformCss(v) {
  // 返回 { transform, transformOrigin }；translate/pivot 为自身尺寸分数，与 CSS 百分比语义一致。
  if (!v || typeof v !== 'object') return typeof v === 'string' ? { transform: v } : {}
  const parts = []
  const out = {}
  if (v.rotate != null) parts.push(`rotate(${Number(v.rotate) || 0}deg)`)
  if (v.scale != null) {
    if (Array.isArray(v.scale)) parts.push(`scale(${Number(v.scale[0]) || 1}, ${Number(v.scale[1]) || 1})`)
    else parts.push(`scale(${Number(v.scale) || 1})`)
  }
  if (v.translate != null) {
    const t = Array.isArray(v.translate) ? { x: v.translate[0], y: v.translate[1] } : v.translate
    parts.push(`translate(${(Number(t.x) || 0) * 100}%, ${(Number(t.y) || 0) * 100}%)`)
  }
  if (v.skew != null && Array.isArray(v.skew)) {
    parts.push(`skew(${Number(v.skew[0]) || 0}deg, ${Number(v.skew[1]) || 0}deg)`)
  }
  if (v.anchor != null) {
    const a = Array.isArray(v.anchor) ? { x: v.anchor[0], y: v.anchor[1] } : v.anchor
    out.transformOrigin = `${(Number(a.x) || 0) * 100}% ${(Number(a.y) || 0) * 100}%`
  }
  if (parts.length) out.transform = parts.join(' ')
  return out
}

function textShadowCss(v) {
  if (!v || typeof v !== 'object') return null
  return `${px(Number(v.offsetX) || 0)} ${px(Number(v.offsetY) || 0)} ${px(Number(v.radius) || 0)} ${v.color || '#000'}`
}

/**
 * 展开 styles 为 React style 对象。
 * @param {string} componentName 仅 Text 接受文本专属字段（与 Kuikly 白名单一致）。
 * @param {object} styles 已求值的 styles 包。
 */
function mapStyles(componentName, styles) {
  if (!styles || typeof styles !== 'object') return undefined
  const out = {}
  const isText = componentName === 'Text'
  for (const key of Object.keys(styles)) {
    const v = styles[key]
    if (v == null) continue
    if (PX_KEYS.has(key)) {
      if (TEXT_PX_KEYS.has(key) && !isText) continue // 文本字段仅 Text 可用（与 Kuikly 白名单一致）
      if (key === 'flexBasis' && typeof v !== 'number') continue
      out[key] = px(v)
      continue
    }
    if (DIRECT_KEYS[key]) { out[DIRECT_KEYS[key]] = v; continue }
    switch (key) {
      case 'flex': out.flex = typeof v === 'number' ? `${v} ${v} 0%` : v; break
      case 'backgroundColor': out.background = v; break
      case 'backgroundLinearGradient': {
        const css = gradientCss(v)
        if (css) out.background = css
        break
      }
      case 'boxShadow': {
        const css = boxShadowCss(v)
        if (css) out.boxShadow = css
        break
      }
      case 'transform': Object.assign(out, transformCss(v)); break
      case 'positionType': out.position = v === 'absolute' ? 'absolute' : 'relative'; break
      case 'visibility': out.visibility = v === 'gone' ? 'hidden' : v; break
      case 'lineHeight': if (isText) out.lineHeight = typeof v === 'number' ? v + 'px' : v; break
      case 'lineSpacing': if (isText) out.lineHeight = `calc(1.4em + ${px(Number(v) || 0)})`; break
      case 'color': if (isText) out.color = v; break
      case 'numberOfLines':
        if (isText) {
          out.display = '-webkit-box'
          out.WebkitBoxOrient = 'vertical'
          out.WebkitLineClamp = Number(v) || 1
          out.overflow = 'hidden'
        }
        break
      case 'firstLineHeadIndent': if (isText) out.textIndent = px(v); break
      case 'textShadow': {
        if (!isText) break
        const css = textShadowCss(v)
        if (css) out.textShadow = css
        break
      }
      default: break // 未识别字段静默忽略（与 Kuikly 白名单丢弃语义一致）
    }
  }
  return Object.keys(out).length ? out : undefined
}


// ===== src/client/renderer.js =====
/**
 * dsh-a2ui · A2UI v0.9 标准组件 React 渲染器（18 组件，对齐 Kuikly catalog）。
 *
 * 本文件被拼接进 client bundle，`React` 由 bundle 头部注入（require('react')）；
 * 测试环境通过 globalThis.React 注入。
 *
 * 渲染约定：
 *  - 组件树由平坦 components Map + id 引用组成，root 为根；
 *  - 所有属性值先经 resolveValue 求值（{"path"} / {"call"} 绑定）；
 *  - 输入组件写回 dataModel（value 为 {"path"} 绑定时），随后 store.bump() 触发重渲；
 *  - action.event 通过 ctx.onAction 回传；{"call":"openUrl"} 本地打开。
 */

const ICON_GLYPHS = {
  add: '＋', plus: '＋', close: '✕', check: '✓', done: '✓', search: '⌕',
  star: '★', starOutline: '☆', heart: '♥', favorite: '♥', home: '⌂',
  settings: '⚙', delete: '🗑', edit: '✎', share: '↗', download: '⬇',
  upload: '⬆', arrowBack: '←', arrowForward: '→', chevronRight: '›',
  chevronLeft: '‹', calendar: '📅', clock: '🕒', location: '📍',
  phone: '📞', mail: '✉', info: 'ℹ', warning: '⚠', error: '⛔',
  flight: '✈', shoppingCart: '🛒', weather: '⛅', user: '👤',
}

const TEXT_VARIANTS = {
  h1: { fontSize: '24px', fontWeight: 700, lineHeight: 1.35 },
  h2: { fontSize: '20px', fontWeight: 650, lineHeight: 1.35 },
  h3: { fontSize: '17px', fontWeight: 600, lineHeight: 1.4 },
  h4: { fontSize: '15px', fontWeight: 600, lineHeight: 1.4 },
  h5: { fontSize: '13px', fontWeight: 600, lineHeight: 1.4 },
  caption: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #8a8f99)' },
  body: { fontSize: '13px', lineHeight: 1.6 },
}

const JUSTIFY = {
  start: 'flex-start', center: 'center', end: 'flex-end',
  spaceBetween: 'space-between', spaceAround: 'space-around', spaceEvenly: 'space-evenly',
}
const ALIGN = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch', baseline: 'baseline' }

/** 写回 dataModel：binding 须为 {"path": "..."}，scope 为模板作用域。 */
function writeBack(store, surface, binding, value, scope) {
  if (!binding || typeof binding !== 'object' || typeof binding.path !== 'string') return
  const path = scope ? scope + binding.path : binding.path
  surface.dataModel = setPointer(surface.dataModel, path, value)
  store.bump()
}

/** 执行 action：event 回传 host；openUrl 本地打开。 */
function runAction(store, surface, action, scope, ctx) {
  if (!action || typeof action !== 'object') return
  if (action.event && typeof action.event.name === 'string') {
    const context = resolveValue(action.event.context || {}, surface, scope)
    ctx.onAction({ surfaceId: surface.id, name: action.event.name, context })
    return
  }
  if (typeof action.call === 'string') {
    if (action.call === 'openUrl') {
      const url = resolveValue((action.args || {}).url, surface, scope)
      if (typeof url === 'string' && url) window.open(url, '_blank', 'noopener')
      return
    }
    // 其它本地函数按 action 事件回传，由 Agent 决定后续。
    ctx.onAction({ surfaceId: surface.id, name: action.call, context: resolveValue(action.args || {}, surface, scope) })
  }
}

function flexChildren(store, surface, c, scope, ctx, extraStyle) {
  const items = store.resolveChildren(c.children, surface, scope)
  return items.map((item, i) => renderNode(store, surface, item, ctx, i))
}

/**
 * 每个 A2UI 节点都是独立的 React 组件实例。
 * 关键：TextField / Tabs / Modal 等含 hooks 的子组件必须拥有自己的组件实例，
 * 否则它们的 hooks 会挂到外层工具卡上，消息流增量更新导致组件树结构变化时
 * hooks 数量/顺序改变，React 抛 "Rendered more hooks than during the previous
 * render" 并卸载整棵树（卡片一闪而过的根因）。
 */
function A2UINode(props) {
  const { store, surface, id, scope, ctx } = props
  const c = surface.components.get(id)
  if (!c) return null
  return renderComponent(store, surface, c, scope, ctx)
}

/** 单组件渲染分发。item={id, scope}。key 含组件类型：同 id 换类型时强制重挂载。 */
function renderNode(store, surface, item, ctx, index) {
  const c = surface.components.get(item.id)
  if (!c) return null
  const key = (item.scope || '') + ':' + item.id + ':' + c.component + ':' + (index != null ? index : 0)
  return React.createElement(A2UINode, {
    key, store, surface, id: item.id, scope: item.scope, ctx,
  })
}

/**
 * 组件分发：先落到一个稳定的 React 组件实例，再在实例内部渲染。
 *
 * 必要性：TextField / Tabs / Modal 等组件内部要调 React hooks，而本文件原本
 * 让 renderComponent 作为普通函数在父组件（A2UIToolView）体内执行 —— 此时
 * hooks 记在父组件上，组件树一变（增量更新、输入组件出现/消失）hook 顺序
 * 就变，React 抛 "Rendered more hooks than during the previous render" 并卸载
 * 整棵卡片。把渲染装进 A2UIComponent，hooks 归属到每个节点自己的实例。
 */
function renderComponent(store, surface, c, scope, ctx) {
  return React.createElement(A2UIComponent, { store, surface, c, scope, ctx })
}

function A2UIComponent({ store, surface, c, scope, ctx }) {
  const type = c.component
  const rv = v => resolveValue(v, surface, scope)
  const custom = mapStyles(type, rv(c.styles))
  const childrenOf = childId => childId
    ? renderNode(store, surface, { id: rv(childId) || childId, scope }, ctx, 0)
    : null

  switch (type) {
    case 'Text': {
      const variant = c.variant || 'body'
      const text = rv(c.text)
      return React.createElement('div', {
        className: 'a2ui-text a2ui-text-' + variant,
        style: { ...TEXT_VARIANTS[variant] || TEXT_VARIANTS.body, whiteSpace: 'pre-wrap', wordBreak: 'break-word', ...custom },
      }, text == null ? '' : String(text))
    }
    case 'Image': {
      const fit = { cover: 'cover', contain: 'contain', fill: 'fill', none: 'none', scaleDown: 'scale-down' }[c.fit] || 'cover'
      const variantStyle = c.variant === 'avatar' ? { borderRadius: '50%' } : {}
      return React.createElement('img', {
        className: 'a2ui-image', src: rv(c.url) || '', alt: rv(c.description) || '',
        style: { maxWidth: '100%', objectFit: fit, borderRadius: '8px', ...variantStyle, ...custom },
      })
    }
    case 'Icon': {
      const name = typeof c.name === 'string' ? c.name : (c.name && c.name.icon) || ''
      return React.createElement('span', {
        className: 'a2ui-icon', role: 'img', 'aria-label': name,
        style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', ...custom },
      }, ICON_GLYPHS[name] || '•')
    }
    case 'Divider':
      return React.createElement('hr', {
        className: 'a2ui-divider',
        style: c.axis === 'vertical'
          ? { border: 'none', borderLeft: '1px solid var(--dsw-alias-border-l1, #e3e6eb)', alignSelf: 'stretch', width: 0, margin: '0 8px', ...custom }
          : { border: 'none', borderTop: '1px solid var(--dsw-alias-border-l1, #e3e6eb)', margin: '8px 0', ...custom },
      })
    case 'Card':
      return React.createElement('div', {
        className: 'a2ui-card',
        style: {
          border: '1px solid var(--dsw-alias-border-l1, #e3e6eb)', borderRadius: '12px',
          background: 'var(--dsw-alias-bg-layer-1, #fff)', padding: '14px', ...custom,
        },
      }, childrenOf(c.child))
    case 'Column':
    case 'Row': {
      const isRow = type === 'Row'
      const direction = type === 'List' ? (c.direction === 'horizontal' ? 'row' : 'column') : (isRow ? 'row' : 'column')
      return React.createElement('div', {
        className: 'a2ui-' + type.toLowerCase(),
        style: {
          display: 'flex', flexDirection: direction, gap: '8px',
          flexWrap: isRow ? 'wrap' : undefined,
          justifyContent: JUSTIFY[c.justify] || 'flex-start',
          alignItems: ALIGN[c.align] || (isRow ? 'center' : 'stretch'),
          ...custom,
        },
      }, flexChildren(store, surface, c, scope, ctx))
    }
    case 'List':
      return React.createElement('div', {
        className: 'a2ui-list',
        style: {
          display: 'flex', flexDirection: c.direction === 'horizontal' ? 'row' : 'column',
          gap: '8px', alignItems: ALIGN[c.align] || 'stretch',
          overflowX: c.direction === 'horizontal' ? 'auto' : undefined,
          ...custom,
        },
      }, flexChildren(store, surface, c, scope, ctx))
    case 'Button': {
      const variant = c.variant || 'default'
      const base = {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
        borderRadius: '8px', padding: '8px 16px', fontSize: '13px', cursor: 'pointer',
        border: '1px solid var(--dsw-alias-border-l1, #e3e6eb)',
        background: 'var(--dsw-alias-bg-layer-2, #f4f5f7)',
        color: 'var(--dsw-alias-label-primary, #1f2329)', width: 'fit-content',
      }
      if (variant === 'primary') Object.assign(base, {
        background: 'var(--dsw-alias-button-primary-fill, #4176e6)', borderColor: 'var(--dsw-alias-button-primary-fill, #4176e6)',
        color: 'var(--dsw-alias-label-primary-foreground, #fff)',
      })
      if (variant === 'borderless') Object.assign(base, {
        background: 'transparent', borderColor: 'transparent', padding: '4px 6px',
        color: 'var(--dsw-alias-brand-primary, #4176e6)',
      })
      return React.createElement('button', {
        type: 'button', className: 'a2ui-button a2ui-button-' + variant,
        style: { ...base, ...custom },
        onClick: () => runAction(store, surface, c.action, scope, ctx),
      }, childrenOf(c.child))
    }
    case 'TextField': {
      const label = rv(c.label)
      const value = rv(c.value)
      const isNumber = c.variant === 'number'
      const isMultiline = c.variant === 'multiline'
      const [error, setError] = React.useState('')
      const onChange = e => {
        const raw = e.target.value
        const v = isNumber ? (raw === '' ? '' : Number(raw)) : raw
        writeBack(store, surface, c.value, v, scope)
        if (c.validationRegexp) {
          try { setError(raw === '' || new RegExp(c.validationRegexp).test(raw) ? '' : '格式不正确') } catch { setError('') }
        } else setError('')
      }
      const inputStyle = {
        background: 'var(--dsw-alias-bg-layer-2, #f4f5f7)', color: 'var(--dsw-alias-label-primary, #1f2329)',
        border: '1px solid ' + (error ? '#e5484d' : 'var(--dsw-alias-border-l1, #e3e6eb)'),
        borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', width: '100%', boxSizing: 'border-box',
      }
      return React.createElement('label', { className: 'a2ui-field', style: { display: 'flex', flexDirection: 'column', gap: '5px', ...custom } }, [
        label != null && React.createElement('span', { key: 'l', style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #8a8f99)' } }, String(label)),
        isMultiline
          ? React.createElement('textarea', { key: 'i', rows: 3, value: value == null ? '' : String(value), onChange, style: { ...inputStyle, resize: 'vertical' } })
          : React.createElement('input', { key: 'i', type: isNumber ? 'number' : 'text', value: value == null ? '' : String(value), onChange, style: inputStyle }),
        error && React.createElement('span', { key: 'e', style: { fontSize: '12px', color: '#e5484d' } }, error),
      ].filter(Boolean))
    }
    case 'CheckBox': {
      const checked = !!rv(c.value)
      return React.createElement('label', {
        className: 'a2ui-checkbox',
        style: { display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer', width: 'fit-content', ...custom },
      }, [
        React.createElement('input', {
          key: 'i', type: 'checkbox', checked,
          onChange: e => writeBack(store, surface, c.value, e.target.checked, scope),
        }),
        React.createElement('span', { key: 'l' }, String(rv(c.label) ?? '')),
      ])
    }
    case 'Slider': {
      const min = Number(c.min ?? 0), max = Number(c.max ?? 100)
      const value = Number(rv(c.value) ?? min)
      return React.createElement('label', { className: 'a2ui-slider', style: { display: 'flex', flexDirection: 'column', gap: '5px', ...custom } }, [
        c.label != null && React.createElement('span', { key: 'l', style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #8a8f99)' } },
          String(rv(c.label)) + '：' + value),
        React.createElement('input', {
          key: 'i', type: 'range', min, max, value,
          onChange: e => writeBack(store, surface, c.value, Number(e.target.value), scope),
        }),
      ].filter(Boolean))
    }
    case 'ChoicePicker': {
      const options = rv(c.options) || []
      const single = c.variant !== 'multiple'
      const current = rv(c.value)
      const selected = single ? current : (Array.isArray(current) ? current : [])
      const chips = c.displayStyle === 'chips'
      const pick = v => {
        if (single) writeBack(store, surface, c.value, v, scope)
        else {
          const next = selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]
          writeBack(store, surface, c.value, next, scope)
        }
      }
      const isOn = v => single ? selected === v : selected.includes(v)
      return React.createElement('div', { className: 'a2ui-choice', style: { display: 'flex', flexDirection: 'column', gap: '6px', ...custom } }, [
        c.label != null && React.createElement('span', { key: 'l', style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #8a8f99)' } }, String(rv(c.label))),
        React.createElement('div', { key: 'o', style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
          options.map((opt, i) => chips
            ? React.createElement('button', {
              key: i, type: 'button', onClick: () => pick(opt.value),
              style: {
                borderRadius: '999px', padding: '5px 12px', fontSize: '12px', cursor: 'pointer',
                border: '1px solid ' + (isOn(opt.value) ? 'var(--dsw-alias-brand-primary, #4176e6)' : 'var(--dsw-alias-border-l1, #e3e6eb)'),
                background: isOn(opt.value) ? 'var(--dsw-alias-brand-primary, #4176e6)' : 'transparent',
                color: isOn(opt.value) ? '#fff' : 'var(--dsw-alias-label-primary, #1f2329)',
              },
            }, String(opt.label))
            : React.createElement('label', { key: i, style: { display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '13px', cursor: 'pointer' } }, [
              React.createElement('input', { key: 'i', type: single ? 'radio' : 'checkbox', checked: isOn(opt.value), onChange: () => pick(opt.value) }),
              React.createElement('span', { key: 't' }, String(opt.label)),
            ]))),
      ].filter(Boolean))
    }
    case 'Tabs': {
      const tabs = Array.isArray(c.tabs) ? c.tabs : []
      const [active, setActive] = React.useState(0)
      const safe = Math.min(active, Math.max(0, tabs.length - 1))
      return React.createElement('div', { className: 'a2ui-tabs', style: custom }, [
        React.createElement('div', {
          key: 'bar',
          style: { display: 'flex', gap: '4px', borderBottom: '1px solid var(--dsw-alias-border-l1, #e3e6eb)', marginBottom: '8px' },
        }, tabs.map((t, i) => React.createElement('button', {
          key: i, type: 'button', onClick: () => setActive(i),
          style: {
            border: 'none', background: 'transparent', padding: '7px 12px', fontSize: '13px', cursor: 'pointer',
            color: i === safe ? 'var(--dsw-alias-brand-primary, #4176e6)' : 'var(--dsw-alias-label-secondary, #8a8f99)',
            borderBottom: i === safe ? '2px solid var(--dsw-alias-brand-primary, #4176e6)' : '2px solid transparent',
          },
        }, String(rv(t.title) ?? t.title ?? ('Tab ' + (i + 1)))))),
        tabs[safe] && React.createElement('div', { key: 'body' },
          renderNode(store, surface, { id: tabs[safe].child, scope }, ctx, safe)),
      ])
    }
    case 'Modal': {
      const [open, setOpen] = React.useState(false)
      React.useEffect(() => {
        if (!open || typeof document === 'undefined') return undefined
        const onKey = e => { if (e.key === 'Escape') setOpen(false) }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [open])
      return React.createElement(React.Fragment, null, [
        React.createElement('span', { key: 't', onClick: () => setOpen(true), style: { display: 'inline-block', cursor: 'pointer' } },
          childrenOf(c.trigger)),
        open && React.createElement('div', {
          key: 'm', className: 'a2ui-modal-mask',
          style: { position: 'fixed', inset: 0, zIndex: 2147483000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
          onClick: () => setOpen(false),
        }, React.createElement('div', {
          style: { background: 'var(--dsw-alias-bg-layer-1, #fff)', borderRadius: '14px', padding: '18px', maxWidth: '90vw', maxHeight: '85vh', overflow: 'auto', minWidth: '280px' },
          onClick: e => e.stopPropagation(),
        }, childrenOf(c.content))),
      ])
    }
    case 'DateTimeInput': {
      const type = c.enableDate === false ? 'time' : (c.enableTime ? 'datetime-local' : 'date')
      const value = rv(c.value)
      return React.createElement('label', { className: 'a2ui-datetime', style: { display: 'flex', flexDirection: 'column', gap: '5px', ...custom } }, [
        c.label != null && React.createElement('span', { key: 'l', style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #8a8f99)' } }, String(rv(c.label))),
        React.createElement('input', {
          key: 'i', type, value: value == null ? '' : String(value),
          min: c.min != null ? String(rv(c.min)) : undefined,
          max: c.max != null ? String(rv(c.max)) : undefined,
          onChange: e => writeBack(store, surface, c.value, e.target.value, scope),
          style: { border: '1px solid var(--dsw-alias-border-l1, #e3e6eb)', borderRadius: '8px', padding: '7px 10px', fontSize: '13px' },
        }),
      ].filter(Boolean))
    }
    case 'Video':
      return React.createElement('video', {
        className: 'a2ui-video', src: rv(c.url) || '', controls: true, playsInline: true,
        style: { maxWidth: '100%', borderRadius: '8px', ...custom },
      })
    case 'AudioPlayer':
      return React.createElement('div', { className: 'a2ui-audio', style: custom }, [
        c.description != null && React.createElement('div', { key: 'd', style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #8a8f99)', marginBottom: '4px' } }, String(rv(c.description))),
        React.createElement('audio', { key: 'a', src: rv(c.url) || '', controls: true, style: { width: '100%' } }),
      ].filter(Boolean))
    default:
      return React.createElement('div', {
        className: 'a2ui-unknown',
        style: { fontSize: '12px', color: '#b25e09', padding: '6px 8px', border: '1px dashed #d9a05b', borderRadius: '6px' },
      }, '不支持的组件：' + type)
  }
}

/** 渲染整个 Surface（root 子树）。 */
function renderSurface(store, surface, ctx) {
  if (!surface || !surface.components.has('root')) return null
  return renderNode(store, surface, { id: 'root', scope: null }, ctx, 0)
}


// ===== src/client/view.js =====
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


// ===== src/client/main.js =====
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


    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})
