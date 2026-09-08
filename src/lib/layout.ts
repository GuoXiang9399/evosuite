// 树布局引擎（FigTree 式三种分叉模式）：
//   rectangular — 有根矩形：叶子均匀分布 y 轴，分支为直角折线（垂直+水平）
//   circular    — 有根极坐标：叶子均匀分布 2π，半径=距根累计长度，分支为直线
//   radial      — 无根放射：子树按叶子数分配角度扇区，节点沿扇区平分线伸展
import { TreeNode, leafOrder } from './newick'

export interface LaidNode {
  node: TreeNode
  x: number
  y: number
  depth: number
  branchLen: number // 从父节点到本节点的分支长度
  parent?: LaidNode
  angle?: number    // circular/radial 布局的极角（弧度；圆形布局从顶部 -π/2 起）
  r?: number        // 距布局原点（根/中心）的半径
}

export interface LayoutResult {
  nodes: LaidNode[]
  leaves: LaidNode[]
  width: number
  height: number
  maxX: number
}

// 根→叶最大累计分支长度（fitWidth 缩放探测）
function maxRootDist(root: TreeNode): number {
  let maxBL = 0
  const probe = (n: TreeNode, acc: number) => {
    if (!n.children || !n.children.length) maxBL = Math.max(maxBL, acc)
    n.children?.forEach((c) => probe(c.node, acc + c.length))
  }
  probe(root, 0)
  return maxBL
}

// 向量平均角度：正确处理跨 0/2π 边界（算术平均会把跨边界角度算反）
function meanAngle(angles: number[]): number {
  let sx = 0
  let sy = 0
  for (const a of angles) {
    sx += Math.cos(a)
    sy += Math.sin(a)
  }
  const m = Math.atan2(sy, sx)
  return m < 0 ? m + 2 * Math.PI : m
}

// ---------------------------------------------------------------------------
// 矩形布局（FigTree rooted rectangular）
// ---------------------------------------------------------------------------

export function layoutRectangular(
  root: TreeNode,
  opts?: { step?: number; xScale?: number; fitWidth?: number },
): LayoutResult {
  const step = opts?.step ?? 26
  const baseScale = opts?.xScale ?? 60
  const fitWidth = opts?.fitWidth
  const maxBL = maxRootDist(root)
  const xScale =
    fitWidth && maxBL > 0
      ? Math.min(4000, Math.max(1, (fitWidth - 90) / maxBL))
      : baseScale
  const leaves = leafOrder(root)
  const leafY = new Map<number, number>()
  leaves.forEach((lf, i) => leafY.set(lf.id, i * step + step / 2))
  const pos = new Map<number, LaidNode>()
  let maxX = 0

  function assign(node: TreeNode, depth: number, branchLen: number, parent?: LaidNode): LaidNode {
    const x = parent ? parent.x + branchLen * xScale : 0
    maxX = Math.max(maxX, x)
    const ln: LaidNode = { node, x, y: 0, depth, branchLen, parent }
    if (node.children && node.children.length) {
      const kids = node.children.map((c) => assign(c.node, depth + 1, c.length, ln))
      ln.y = (kids[0].y + kids[kids.length - 1].y) / 2
    } else {
      ln.y = leafY.get(node.id) ?? depth * step
    }
    pos.set(node.id, ln)
    return ln
  }

  assign(root, 0, 0)
  const nodes = Array.from(pos.values())
  const height = leaves.length * step + step
  const width = maxX + 90
  return {
    nodes,
    leaves: leaves.map((l) => pos.get(l.id)!).filter(Boolean) as LaidNode[],
    width,
    height,
    maxX,
  }
}

// ---------------------------------------------------------------------------
// 圆形布局（FigTree rooted polar / circular）
// 修复：半径 = 距根累计分支长度（原实现误用单条分支长度）；
//       布局完成后整体平移到画布中心，避免负坐标被 viewBox 裁剪。
// ---------------------------------------------------------------------------

export function layoutCircular(
  root: TreeNode,
  opts?: { innerR?: number; xScale?: number; fitWidth?: number },
): LayoutResult {
  const innerR = opts?.innerR ?? 40
  const baseScale = opts?.xScale ?? 60
  const fitWidth = opts?.fitWidth
  const maxBL = maxRootDist(root)
  const xScale =
    fitWidth && maxBL > 0
      ? Math.min(4000, Math.max(1, (fitWidth / 2 - 60) / maxBL))
      : baseScale
  const leaves = leafOrder(root)
  const n = leaves.length
  const angle = new Map<number, number>()
  // 从顶部（-π/2）开始，SVG y 向下 → 顺时针展开
  leaves.forEach((lf, i) => angle.set(lf.id, -Math.PI / 2 + (i / n) * 2 * Math.PI))
  const pos = new Map<number, LaidNode>()
  let maxR = 0

  function assign(node: TreeNode, depth: number, branchLen: number, parent?: LaidNode): LaidNode {
    // 关键修复：半径沿父节点累计，而非 innerR + 单条分支长度
    const r = (parent ? parent.r! : 0) + branchLen * xScale
    maxR = Math.max(maxR, r)
    // 内部节点角度 = 子叶角度的向量平均（跨边界安全）
    const a = node.children && node.children.length
      ? meanAngle(leafOrder(node).map((l) => angle.get(l.id)!))
      : angle.get(node.id)!
    // 先在以根为原点的极坐标下计算，最后统一平移
    const ln: LaidNode = {
      node,
      x: r * Math.cos(a),
      y: r * Math.sin(a),
      depth,
      branchLen,
      parent,
      angle: a,
      r,
    }
    if (node.children && node.children.length) {
      node.children.forEach((c) => assign(c.node, depth + 1, c.length, ln))
    }
    pos.set(node.id, ln)
    return ln
  }

  assign(root, 0, 0)
  // 平移到画布中心，保证负坐标可见
  const cx = maxR + innerR + 50
  const cy = maxR + innerR + 50
  const nodes = Array.from(pos.values())
  for (const ln of nodes) {
    ln.x += cx
    ln.y += cy
  }
  const D = (maxR + innerR + 50) * 2
  return {
    nodes,
    leaves: leaves.map((l) => pos.get(l.id)!).filter(Boolean) as LaidNode[],
    width: D,
    height: D,
    maxX: maxR + innerR,
  }
}

// ---------------------------------------------------------------------------
// 放射布局（FigTree unrooted / radial）
// 子树按叶子数占满整个 2π；节点位于其扇区平分线方向、距父节点一条分支长度。
// ---------------------------------------------------------------------------

export function layoutRadial(
  root: TreeNode,
  opts?: { xScale?: number; fitWidth?: number },
): LayoutResult {
  const baseScale = opts?.xScale ?? 60
  const fitWidth = opts?.fitWidth

  const leafCountMap = new Map<number, number>()
  function leafCount(n: TreeNode): number {
    if (!n.children || !n.children.length) return 1
    const c = n.children.reduce((s, ch) => s + leafCount(ch.node), 0)
    leafCountMap.set(n.id, c)
    return c
  }
  const total = leafCount(root)

  // 根到最远叶的路径长（估计整体伸展，用于 fitWidth）
  const maxBL = maxRootDist(root)
  const xScale =
    fitWidth && maxBL > 0
      ? Math.min(4000, Math.max(1, (fitWidth / 2 - 60) / maxBL))
      : baseScale

  const pos = new Map<number, LaidNode>()
  let minX = 0
  let maxX = 0
  let minY = 0
  let maxY = 0

  // thetaStart/thetaEnd：本节点子树占用的角度扇区
  function assign(
    node: TreeNode, depth: number, branchLen: number, parent: LaidNode | undefined,
    px: number, py: number, thetaStart: number, thetaEnd: number,
  ): LaidNode {
    const theta = (thetaStart + thetaEnd) / 2
    const x = px + Math.cos(theta) * branchLen * xScale
    const y = py + Math.sin(theta) * branchLen * xScale
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
    const ln: LaidNode = { node, x, y, depth, branchLen, parent, angle: theta }
    if (node.children && node.children.length) {
      const span = thetaEnd - thetaStart
      let cur = thetaStart
      for (const c of node.children) {
        const lc = leafCountMap.get(c.node.id) ?? 1
        const w = (lc / total) * span
        assign(c.node, depth + 1, c.length, ln, x, y, cur, cur + w)
        cur += w
      }
    }
    pos.set(node.id, ln)
    return ln
  }

  // 根在原点，扇区从顶部 -π/2 起占满 2π
  assign(root, 0, 0, undefined, 0, 0, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI)

  // 包围盒平移到画布
  const pad = 50
  const offX = pad - minX
  const offY = pad - minY
  const nodes = Array.from(pos.values())
  for (const ln of nodes) {
    ln.x += offX
    ln.y += offY
  }
  const width = maxX - minX + pad * 2
  const height = maxY - minY + pad * 2
  return {
    nodes,
    leaves: leafOrder(root).map((l) => pos.get(l.id)!).filter(Boolean) as LaidNode[],
    width,
    height,
    maxX: width,
  }
}
