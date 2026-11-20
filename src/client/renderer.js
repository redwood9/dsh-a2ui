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
