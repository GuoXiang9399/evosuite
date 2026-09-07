// 矩形树布局：将 TreeNode 映射为带坐标的节点，供 SVG 渲染
import { TreeNode, leafOrder } from './newick'

export interface LaidNode {
  node: TreeNode
  x: number
  y: number
  depth: number
  branchLen: number // 从父节点到本节点的分支长度
  parent?: LaidNode
}

export interface LayoutResult {
  nodes: LaidNode[]
  leaves: LaidNode[]
  width: number
  height: number
  maxX: number
}

export function layoutRectangular(
  root: TreeNode,
  opts?: { step?: number; xScale?: number; fitWidth?: number },
): LayoutResult {
  const step = opts?.step ?? 26
  const baseScale = opts?.xScale ?? 60
  const fitWidth = opts?.fitWidth
  // 先用 1.0 的尺度探一遍，得到最大分支累计长度（根→叶）
  let maxBL = 0
  const probe = (n: TreeNode, acc: number) => {
    if (!n.children || !n.children.length) maxBL = Math.max(maxBL, acc)
    n.children?.forEach((c) => probe(c.node, acc + c.length))
  }
  probe(root, 0)
  const xScale =
    fitWidth && maxBL > 0
      ? Math.min(4000, Math.max(1, (fitWidth - 90) / maxBL))
      : baseScale
  const leaves = leafOrder(root)
  const leafY = new Map<number, number>()
  leaves.forEach((lf, i) => leafY.set(lf.id, i * step + step / 2))
  const pos = new Map<number, LaidNode>()
  let maxX = 0

  // 关键：分支长度来自父->子 wrapper 的 c.length（建树算法与 Newick 解析均存于此），
  // 而非子节点自身可能未定义的 node.length。
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

// 圆形树布局：以根为中心按角度展开叶子
export function layoutCircular(
  root: TreeNode,
  opts?: { innerR?: number; xScale?: number; fitWidth?: number },
): LayoutResult {
  const innerR = opts?.innerR ?? 40
  const baseScale = opts?.xScale ?? 60
  const fitWidth = opts?.fitWidth
  let maxBL = 0
  const probe = (n: TreeNode, acc: number) => {
    if (!n.children || !n.children.length) maxBL = Math.max(maxBL, acc)
    n.children?.forEach((c) => probe(c.node, acc + c.length))
  }
  probe(root, 0)
  const xScale =
    fitWidth && maxBL > 0
      ? Math.min(4000, Math.max(1, (fitWidth - 80) / 2 / maxBL))
      : baseScale
  const leaves = leafOrder(root)
  const n = leaves.length
  const angle = new Map<number, number>()
  leaves.forEach((lf, i) => angle.set(lf.id, (i / n) * 2 * Math.PI))
  const pos = new Map<number, LaidNode>()
  let maxX = 0

  function assign(node: TreeNode, depth: number, branchLen: number, parent?: LaidNode): LaidNode {
    const r = innerR + branchLen * xScale
    maxX = Math.max(maxX, r)
    const a = node.children && node.children.length
      ? avgAngle(node, angle)
      : angle.get(node.id)!
    const x = r * Math.cos(a - Math.PI / 2)
    const y = r * Math.sin(a - Math.PI / 2)
    const ln: LaidNode = { node, x, y, depth, branchLen, parent }
    if (node.children && node.children.length) {
      node.children.forEach((c) => assign(c.node, depth + 1, c.length, ln))
    }
    pos.set(node.id, ln)
    return ln
  }
  function avgAngle(node: TreeNode, m: Map<number, number>): number {
    const ls = leafOrder(node)
    const angs = ls.map((l) => m.get(l.id)!)
    return (angs[0] + angs[angs.length - 1]) / 2
  }
  assign(root, 0, 0)
  const nodes = Array.from(pos.values())
  const D = (maxX + innerR) * 2 + 80
  return { nodes, leaves: leaves.map((l) => pos.get(l.id)!).filter(Boolean) as LaidNode[], width: D, height: D, maxX }
}
