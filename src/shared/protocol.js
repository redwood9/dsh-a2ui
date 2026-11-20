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

export function getPointer(obj, pointer) {
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

export function setPointer(obj, pointer, value) {
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

export function evaluateFunction(call, args, surface, scope) {
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

export function isBinding(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v)
    && (typeof v.path === 'string' || typeof v.call === 'string')
    && Object.keys(v).every(k => k === 'path' || k === 'call' || k === 'args' || k === 'returnType' || k === 'literal')
}

export function resolveValue(value, surface, scope) {
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

export const ENVELOPE_KEYS = ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface']

/** 校验一条 envelope，返回错误消息或 null。host 工具与 client 共用。 */
export function validateEnvelope(env) {
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

export class SurfaceStore {
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
