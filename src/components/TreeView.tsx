import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, useT } from '../store'
import { layoutRectangular, layoutCircular, LaidNode } from '../lib/layout'
import { TreeNode, leafOrder, internalNodes, toNewick, midpointRoot, ladderize } from '../lib/newick'
import { downloadText } from '../lib/tauri'

const PALETTE = ['#4caf82', '#5b9bd5', '#e8b339', '#d9694e', '#9b6dd6', '#46c0c0', '#d98cc0', '#7aa66b']

// Assign clade colors by top-level branch (root's direct children).
function cladeColors(root: TreeNode): Map<number, string> {
  const map = new Map<number, string>()
  if (!root.children) return map
  root.children.forEach((c, i) => {
    const color = PALETTE[i % PALETTE.length]
    const stack: TreeNode[] = [c.node]
    while (stack.length) {
      const n = stack.pop()!
      map.set(n.id, color)
      n.children?.forEach((ch) => stack.push(ch.node))
    }
  })
  return map
}

export default function TreeView({ embedded = false }: { embedded?: boolean }) {
  const tree = useStore((s) => s.tree)
  const newick = useStore((s) => s.newick)
  const setTree = useStore((s) => s.setTree)
  const setView = useStore((s) => s.setView)
  const pushLog = useStore((s) => s.pushLog)
  const t = useT()
  const [mode, setMode] = useState<'rect' | 'circ'>('rect')
  const [tf, setTf] = useState({ x: 60, y: 20, k: 1 })
  const [showBoot, setShowBoot] = useState(true)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [search, setSearch] = useState('')
  const [hover, setHover] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const [wrapW, setWrapW] = useState(0)

  useEffect(() => {
    setCollapsed(new Set())
    setTf({ x: 60, y: 20, k: 1 })
  }, [tree])

  useEffect(() => {
    if (!wrapRef.current) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width || 0
      setWrapW(w)
    })
    ro.observe(wrapRef.current)
    setWrapW(wrapRef.current.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])

  const layout = useMemo(() => {
    if (!tree) return null
    const fw = wrapW > 200 ? wrapW : undefined
    const lo = mode === 'circ'
      ? layoutCircular(tree, { xScale: 70, fitWidth: fw })
      : layoutRectangular(tree, { xScale: 70, fitWidth: fw })
    return lo
  }, [tree, mode, wrapW])

  const colors = useMemo(() => (tree ? cladeColors(tree) : new Map<number, string>()), [tree])

  const isHidden = (n: LaidNode) => {
    let p = n.parent
    while (p) {
      if (collapsed.has(p.node.id)) return true
      p = p.parent
    }
    return false
  }
  const visibleNodes = useMemo(
    () => (layout ? layout.nodes.filter((n) => !isHidden(n)) : []),
    [layout, collapsed],
  )

  const q = search.trim().toLowerCase()
  const matchLeaf = (name?: string) => !!name && !!q && name.toLowerCase().includes(q)

  if (!tree || !layout) {
    return (
      <div className="view">
        <div className="view-head"><h2>{t('tree.title')}</h2></div>
        <div className="empty">{t('tree.empty')}</div>
      </div>
    )
  }

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const rect = svgRef.current!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    setTf((tf) => {
      const k = Math.min(6, Math.max(0.2, tf.k * factor))
      const x = mx - ((mx - tf.x) * k) / tf.k
      const y = my - ((my - tf.y) * k) / tf.k
      return { x, y, k }
    })
  }
  const onDown = (e: React.MouseEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, tx: tf.x, ty: tf.y }
  }
  const onMove = (e: React.MouseEvent) => {
    if (!drag.current) return
    setTf((tf) => ({ ...tf, x: drag.current!.tx + (e.clientX - drag.current!.x), y: drag.current!.ty + (e.clientY - drag.current!.y) }))
  }
  const onUp = () => { drag.current = null }

  const reset = () => setTf({ x: 60, y: 20, k: 1 })

  const toggleCollapse = (id: number) => {
    setCollapsed((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const doMidpoint = () => {
    if (!tree) return
    const r = midpointRoot(tree)
    setTree(r, toNewick(r))
    pushLog(t('log.midpoint'), 'ok')
  }
  const doLadderize = () => {
    if (!tree) return
    ladderize(tree)
    pushLog(t('log.ladder'), 'ok')
  }

  const exportSvg = () => {
    const svg = svgRef.current!
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('width', String(layout.width))
    clone.setAttribute('height', String(layout.height))
    const data = new XMLSerializer().serializeToString(clone)
    downloadText('tree.svg', '<?xml version="1.0"?>\n' + data)
    pushLog(t('log.exportSvg'), 'ok')
  }
  const exportPng = () => {
    const svg = svgRef.current!
    const data = new XMLSerializer().serializeToString(svg)
    const img = new Image()
    const svg64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(data)))
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(800, layout.width * tf.k)
      canvas.height = Math.max(600, layout.height * tf.k)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#0f1216'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((b) => {
        if (b) {
          const url = URL.createObjectURL(b)
          const a = document.createElement('a')
          a.href = url
          a.download = 'tree.png'
          a.click()
          pushLog(t('log.exportPng'), 'ok')
        }
      })
    }
    img.src = svg64
  }
  const exportNewick = () => {
    downloadText('tree.nwk', newick)
    pushLog(t('log.exportNewick'), 'ok')
  }
  const exportNexus = () => {
    const nexus = `#NEXUS\nBEGIN TREES;\n  TREE EvoSuite = ${newick}\nEND;\n`
    downloadText('tree.nex', nexus)
    pushLog(t('log.exportNexus'), 'ok')
  }

  const leaves = leafOrder(tree)
  const W = layout.width
  const H = layout.height

  return (
    <div className={embedded ? 'tree-view tree-view-embed' : 'view tree-view'}>
      {!embedded && (
        <div className="view-head">
          <h2>{t('tree.title')}</h2>
          <div className="view-actions">
            <button className="btn" onClick={() => setView('build')}>{t('tree.back')}</button>
            <button className="btn" onClick={() => setView('sequences')}>{t('tree.dist')}</button>
            <button className="btn" onClick={exportNewick}>{t('tree.newick')}</button>
            <button className="btn" onClick={exportNexus}>{t('tree.nexus')}</button>
            <button className="btn" onClick={exportSvg}>{t('tree.svg')}</button>
            <button className="btn" onClick={exportPng}>{t('tree.png')}</button>
          </div>
        </div>
      )}

      <div className="tree-toolbar">
        <div className="seg">
          <button className={mode === 'rect' ? 'on' : ''} onClick={() => setMode('rect')}>{t('tree.rect')}</button>
          <button className={mode === 'circ' ? 'on' : ''} onClick={() => setMode('circ')}>{t('tree.circ')}</button>
        </div>
        <label className="chk">
          <input type="checkbox" checked={showBoot} onChange={(e) => setShowBoot(e.target.checked)} /> {t('tree.showBoot')}
        </label>
        <button className="btn tiny" onClick={doMidpoint}>{t('tree.midpoint')}</button>
        <button className="btn tiny" onClick={doLadderize}>{t('tree.ladder')}</button>
        <button className="btn tiny" onClick={reset}>{t('tree.reset')}</button>
        <input
          className="tree-search"
          placeholder={t('tree.searchPh')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="muted">{t('tree.hint')}</span>
      </div>

      <div className="tree-canvas-wrap" ref={wrapRef}>
        <svg
          ref={svgRef}
          className="tree-svg"
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          onWheel={onWheel}
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
          onMouseLeave={onUp}
          style={{ cursor: drag.current ? 'grabbing' : 'grab' }}
        >
          <g transform={`translate(${tf.x},${tf.y}) scale(${tf.k})`}>
            {visibleNodes
              .filter((n) => n.parent)
              .map((n: LaidNode, i) => {
                const p = n.parent!
                const d =
                  mode === 'circ'
                    ? `M ${p.x} ${p.y} L ${n.x} ${n.y}`
                    : `M ${p.x} ${p.y} L ${n.x} ${p.y} L ${n.x} ${n.y}`
                const boot = n.node.bootstrap != null ? n.node.bootstrap : null
                const sw = boot != null ? 1 + Math.min(3, (boot as number) / 100 * 3) : 1.4
                return (
                  <path
                    key={i}
                    d={d}
                    stroke={colors.get(n.node.id) || '#9aa3b2'}
                    strokeWidth={sw}
                    fill="none"
                  />
                )
              })}
            {visibleNodes.map((n: LaidNode, i) => {
              const hasChildren = n.node.children && n.node.children.length
              if (hasChildren) {
                const isCollapsed = collapsed.has(n.node.id)
                const boot = showBoot && n.node.bootstrap != null ? (n.node.bootstrap as number).toFixed(0) : ''
                return (
                  <g key={'b' + i} style={{ cursor: 'pointer' }} onClick={() => toggleCollapse(n.node.id)}>
                    <circle cx={n.x} cy={n.y} r={isCollapsed ? 4 : 2.4} fill={isCollapsed ? '#fff' : '#c8cedb'} />
                    {boot && (
                      <text x={n.x} y={n.y - 5} className="boot-label" fontSize={9} fill="#ffd479">
                        {boot}
                      </text>
                    )}
                    {isCollapsed && (
                      <text x={n.x + 6} y={n.y + 3} className="leaf-label" fontSize={10} fill="#cdd3df">
                        {t('tree.fold')}
                      </text>
                    )}
                  </g>
                )
              }
              const c = colors.get(n.node.id) || '#cdd3df'
              const hot = hover === n.node.id || matchLeaf(n.node.name)
              return (
                <g key={'l' + i} onMouseEnter={() => setHover(n.node.id)} onMouseLeave={() => setHover(null)}>
                  <circle cx={n.x} cy={n.y} r={hot ? 4 : 2.6} fill={matchLeaf(n.node.name) ? '#ffd479' : c} />
                  <text
                    x={mode === 'circ' ? n.x + 6 * Math.sign(n.x || 1) : n.x + 6}
                    y={n.y + 3}
                    className="leaf-label"
                    fontSize={11}
                    fill={hot ? '#fff' : '#cdd3df'}
                  >
                    {n.node.name}
                  </text>
                </g>
              )
            })}
          </g>
        </svg>
      </div>

      <div className="legend">
        <span className="muted">{t('tree.clade')}</span>
        {Array.from(colors.entries()).length > 0 &&
          rootChildrenLegend(tree).map((c, i) => (
            <span key={i} className="legend-item">
              <span className="sw" style={{ background: PALETTE[i % PALETTE.length] }} />
              {c}
            </span>
          ))}
        <span className="muted" style={{ marginLeft: 'auto' }}>
          {t('tree.leaves')} {leaves.length} · {t('tree.internal')} {internalNodes(tree).length}
          {collapsed.size > 0 ? ` · ${t('tree.collapsed')} ${collapsed.size}` : ''}
        </span>
      </div>
    </div>
  )
}

function rootChildrenLegend(tree: TreeNode): string[] {
  if (!tree.children) return []
  return tree.children.map((c) => leafOrder(c.node)[0]?.name ?? 'clade')
}
