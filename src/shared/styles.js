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
export function mapStyles(componentName, styles) {
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
