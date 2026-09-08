import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, useT } from '../store'
import { layoutRectangular, layoutCircular, layoutRadial, LaidNode } from '../lib/layout'
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

type NodeDisplay = 'none' | 'boot'

export default function TreeView({ embedded = false }: { embedded?: boolean }) {
  const tree = useStore((s) => s.tree)
  const newick = useStore((s) => s.newick)
  const setTree = useStore((s) => s.setTree)
  const setView = useStore((s) => s.setView)
  const pushLog = useStore((s) => s.pushLog)
  const t = useT()
  const [mode, setMode] = useState<'rect' | 'circ' | 'radial'>('rect')
  const [tf, setTf] = useState({ x: 60, y: 20, k: 1 })
  // FigTree-style display options
  const [showBoot, setShowBoot] = useState(true)
  const [nodeDisplay, setNodeDisplay] = useState<NodeDisplay>('boot')
  const [showBranchLen, setShowBranchLen] = useState(false)
  const [branchDigits, setBranchDigits] = useState(2)
  const [showScaleBar, setShowScaleBar] = useState(true)
  const [scaleLen, setScaleLen] = useState(0.01)
  const [lineWeight, setLineWeight] = useState(1.4)
  const [tipFontSize, setTipFontSize] = useState(11)
  const [tipItalic, setTipItalic] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [search, setSearch] = useState('')
  const [hover, setHover] = useState<number | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [activePanel, setActivePanel] = useState<string>('appearance')
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
    // fitWidth = canvas wrap 实际宽度 - 侧栏 240 - padding 32，矩形再多减 90
    const fw = wrapW > 200 ? wrapW - (sidebarOpen ? 272 : 32) : undefined
    const lo = mode === 'circ'
      ? layoutCircular(tree, { xScale: 70, fitWidth: fw })
      : mode === 'radial'
      ? layoutRadial(tree, { xScale: 70, fitWidth: fw })
      : layoutRectangular(tree, { xScale: 70, fitWidth: fw })
    return lo
  }, [tree, mode, wrapW, sidebarOpen])

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

  // 分支长度格式化
  const fmtLen = (v: number | undefined) => {
    if (v == null || !isFinite(v)) return ''
    return v.toFixed(branchDigits)
  }

  // 比例尺像素宽度（按 xScale=70 对应 1.0 分支长度）
  const scalePxF = 70 * scaleLen * tf.k

  // FigTree 侧栏面板定义
  const panels = [
    { id: 'appearance', label: t('tree.appearance') },
    { id: 'tipLabels', label: t('tree.tipLabels') },
    { id: 'nodeLabels', label: t('tree.nodeLabels') },
    { id: 'branchLabels', label: t('tree.branchLabels') },
    { id: 'scaleBar', label: t('tree.scaleBar') },
  ]

  return (
    <div className={embedded ? 'tree-view tree-view-embed' : 'view tree-view'}>
      {!embedded && (
        <div className="view-head">
          <div className="view-actions" style={{ marginLeft: 0, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => setView('build')}>{t('tree.back')}</button>
            <button className="btn" onClick={() => setView('sequences')}>{t('tree.dist')}</button>
            <button className="btn" onClick={exportNewick}>{t('tree.newick')}</button>
            <button className="btn" onClick={exportNexus}>{t('tree.nexus')}</button>
            <button className="btn" onClick={exportSvg}>{t('tree.svg')}</button>
            <button className="btn" onClick={exportPng}>{t('tree.png')}</button>
          </div>
          <h2 style={{ marginLeft: 'auto' }}>{t('tree.title')}</h2>
        </div>
      )}

      <div className="tree-toolbar">
        <div className="seg">
          <button className={mode === 'rect' ? 'on' : ''} onClick={() => setMode('rect')}>{t('tree.rect')}</button>
          <button className={mode === 'circ' ? 'on' : ''} onClick={() => setMode('circ')}>{t('tree.circ')}</button>
          <button className={mode === 'radial' ? 'on' : ''} onClick={() => setMode('radial')}>{t('tree.radial')}</button>
        </div>
        <button className="btn tiny" onClick={doMidpoint}>{t('tree.midpoint')}</button>
        <button className="btn tiny" onClick={doLadderize}>{t('tree.ladder')}</button>
        <button className="btn tiny" onClick={reset}>{t('tree.reset')}</button>
        <input
          className="tree-search"
          placeholder={t('tree.searchPh')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn tiny" onClick={() => setSidebarOpen(!sidebarOpen)}>
          {sidebarOpen ? '◀' : '▶'} {t('tree.panel')}
        </button>
        <span className="muted">{t('tree.hint')}</span>
      </div>

      <div className="tree-body" style={{ display: 'flex', minHeight: 400 }}>
        {/* 画布 */}
        <div className="tree-canvas-wrap" ref={wrapRef} style={{ flex: 1, overflow: 'auto' }}>
          <svg
            ref={svgRef}
            className="tree-svg"
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="xMidYMid meet"
            onWheel={onWheel}
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={onUp}
            style={{ width: '100%', height: 'auto', display: 'block', cursor: drag.current ? 'grabbing' : 'grab' }}
          >
            <g transform={`translate(${tf.x},${tf.y}) scale(${tf.k})`}>
              {visibleNodes
                .filter((n) => n.parent)
                .map((n: LaidNode, i) => {
                  const p = n.parent!
                  // FigTree 式分支绘制：
                  //   rect = 直角折线（父节点 x 处垂直到子 y，再水平到子 x）
                  //   circ / radial = 直线连接
                  const d =
                    mode === 'rect'
                      ? `M ${p.x} ${p.y} L ${p.x} ${n.y} L ${n.x} ${n.y}`
                      : `M ${p.x} ${p.y} L ${n.x} ${n.y}`
                  return (
                    <path
                      key={i}
                      d={d}
                      stroke={colors.get(n.node.id) || '#9aa3b2'}
                      strokeWidth={lineWeight}
                      fill="none"
                    />
                  )
                })}
              {/* 分支长度标签 */}
              {showBranchLen && visibleNodes
                .filter((n) => n.parent && n.node.length != null)
                .map((n: LaidNode, i) => {
                  const p = n.parent!
                  // rect：放在水平段中点上方；circ/radial：放在父子中点
                  const mx = (p.x + n.x) / 2
                  const my = mode === 'rect' ? n.y : (p.y + n.y) / 2
                  return (
                    <text
                      key={'bl' + i}
                      x={mx}
                      y={my - 2}
                      fontSize={8}
                      fill="#8a93a6"
                      textAnchor="middle"
                    >
                      {fmtLen(n.node.length)}
                    </text>
                  )
                })}
              {visibleNodes.map((n: LaidNode, i) => {
                const hasChildren = n.node.children && n.node.children.length
                if (hasChildren) {
                  const isCollapsed = collapsed.has(n.node.id)
                  const boot = showBoot && nodeDisplay === 'boot' && n.node.bootstrap != null ? (n.node.bootstrap as number).toFixed(0) : ''
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
                // 叶子标签位置：rect 在右侧；circ/radial 沿径向外推并按方向对齐
                let labelX = n.x + 6
                let labelY = n.y + 3
                let anchor: 'start' | 'middle' | 'end' = 'start'
                if (mode !== 'rect' && n.angle != null) {
                  const dirX = Math.cos(n.angle)
                  const dirY = Math.sin(n.angle)
                  labelX = n.x + 8 * dirX
                  labelY = n.y + 8 * dirY + (Math.abs(dirY) < 0.4 ? 3 : 0)
                  anchor = dirX > 0.15 ? 'start' : dirX < -0.15 ? 'end' : 'middle'
                }
                return (
                  <g key={'l' + i} onMouseEnter={() => setHover(n.node.id)} onMouseLeave={() => setHover(null)}>
                    <circle cx={n.x} cy={n.y} r={hot ? 4 : 2.6} fill={matchLeaf(n.node.name) ? '#ffd479' : c} />
                    <text
                      x={labelX}
                      y={labelY}
                      textAnchor={anchor}
                      className="leaf-label"
                      fontSize={tipFontSize}
                      fontStyle={tipItalic ? 'italic' : 'normal'}
                      fill={hot ? '#fff' : '#cdd3df'}
                    >
                      {n.node.name}
                    </text>
                  </g>
                )
              })}
            </g>
            {/* 比例尺 */}
            {showScaleBar && scalePxF > 0 && (
              <g transform={`translate(20, ${H - 30})`}>
                <line x1={0} y1={0} x2={scalePxF} y2={0} stroke="#cdd3df" strokeWidth={1.5} />
                <line x1={0} y1={-4} x2={0} y2={4} stroke="#cdd3df" strokeWidth={1.5} />
                <line x1={scalePxF} y1={-4} x2={scalePxF} y2={4} stroke="#cdd3df" strokeWidth={1.5} />
                <text x={scalePxF + 6} y={4} fontSize={10} fill="#8a93a6">{scaleLen}</text>
              </g>
            )}
          </svg>
        </div>

        {/* FigTree 风格侧栏 */}
        {sidebarOpen && (
          <div className="tree-sidebar">
            <div className="sidebar-panels">
              {panels.map((p) => (
                <div key={p.id} className="sidebar-section">
                  <button
                    className={`sidebar-head ${activePanel === p.id ? 'open' : ''}`}
                    onClick={() => setActivePanel(activePanel === p.id ? '' : p.id)}
                  >
                    <span className="sidebar-arrow">{activePanel === p.id ? '▾' : '▸'}</span>
                    {p.label}
                  </button>
                  {activePanel === p.id && (
                    <div className="sidebar-body">
                      {p.id === 'appearance' && (
                        <>
                          <label className="sb-row">
                            <span>{t('tree.lineWeight')}</span>
                            <input type="range" min="0.5" max="4" step="0.1" value={lineWeight}
                              onChange={(e) => setLineWeight(Number(e.target.value))} />
                            <span className="mono">{lineWeight.toFixed(1)}</span>
                          </label>
                        </>
                      )}
                      {p.id === 'tipLabels' && (
                        <>
                          <label className="sb-row">
                            <span>{t('tree.tipFontSize')}</span>
                            <input type="range" min="7" max="13" step="0.5" value={tipFontSize}
                              onChange={(e) => setTipFontSize(Number(e.target.value))} />
                            <span className="mono">{tipFontSize}</span>
                          </label>
                          <label className="sb-row chk">
                            <input type="checkbox" checked={tipItalic} onChange={(e) => setTipItalic(e.target.checked)} />
                            {t('tree.tipItalic')}
                          </label>
                        </>
                      )}
                      {p.id === 'nodeLabels' && (
                        <>
                          <label className="sb-row">
                            <span>{t('tree.nodeLabelsSel')}</span>
                            <select className="sel-input" value={nodeDisplay} onChange={(e) => setNodeDisplay(e.target.value as NodeDisplay)}>
                              <option value="boot">{t('tree.nodeBoot')}</option>
                              <option value="none">{t('tree.nodeNone')}</option>
                            </select>
                          </label>
                          <label className="sb-row chk">
                            <input type="checkbox" checked={showBoot && nodeDisplay === 'boot'} onChange={(e) => setShowBoot(e.target.checked)} />
                            {t('tree.showBoot')}
                          </label>
                        </>
                      )}
                      {p.id === 'branchLabels' && (
                        <>
                          <label className="sb-row chk">
                            <input type="checkbox" checked={showBranchLen} onChange={(e) => setShowBranchLen(e.target.checked)} />
                            {t('tree.showBranchLen')}
                          </label>
                          <label className="sb-row">
                            <span>{t('tree.branchDigits')}</span>
                            <input type="number" min="0" max="6" step="1" value={branchDigits}
                              onChange={(e) => setBranchDigits(Number(e.target.value))} style={{ width: 60 }} />
                          </label>
                        </>
                      )}
                      {p.id === 'scaleBar' && (
                        <>
                          <label className="sb-row chk">
                            <input type="checkbox" checked={showScaleBar} onChange={(e) => setShowScaleBar(e.target.checked)} />
                            {t('tree.showScaleBar')}
                          </label>
                          <label className="sb-row">
                            <span>{t('tree.scaleBarLen')}</span>
                            <input type="number" min="0.001" step="0.001" value={scaleLen}
                              onChange={(e) => setScaleLen(Number(e.target.value))} style={{ width: 70 }} />
                          </label>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="sidebar-footer">
              <span className="muted">{t('tree.leaves')} {leaves.length} · {t('tree.internal')} {internalNodes(tree).length}</span>
              {collapsed.size > 0 && <span className="muted"> · {t('tree.collapsed')} {collapsed.size}</span>}
              <div className="legend" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                <span className="muted">{t('tree.clade')}</span>
                {rootChildrenLegend(tree).map((c, i) => (
                  <span key={i} className="legend-item">
                    <span className="sw" style={{ background: PALETTE[i % PALETTE.length] }} />
                    {c}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function rootChildrenLegend(tree: TreeNode): string[] {
  if (!tree.children) return []
  return tree.children.map((c) => leafOrder(c.node)[0]?.name ?? 'clade')
}
