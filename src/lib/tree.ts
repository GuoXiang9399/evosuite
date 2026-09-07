// 建树算法：邻接法 (Neighbor-Joining, Saitou-Nei) 与 UPGMA
import { TreeNode, nextId } from './newick'

// 邻接法，返回有根树（最后两个根节点合并到虚拟根）
export function neighborJoining(Din: number[][], labels: string[]): TreeNode {
  const n = labels.length
  if (n === 1) return { id: nextId(), name: labels[0] }
  if (n === 2) {
    return {
      id: nextId(),
      children: [
        { node: { id: nextId(), name: labels[0] }, length: Din[0][1] / 2 },
        { node: { id: nextId(), name: labels[1] }, length: Din[0][1] / 2 },
      ],
    }
  }

  let active: TreeNode[] = labels.map((name) => ({ id: nextId(), name }))
  let dist: number[][] = Din.map((r) => r.slice())

  while (active.length > 2) {
    const k = active.length
    const rowSum = dist.map((r) => r.reduce((a, b) => a + b, 0))
    let bi = -1
    let bj = -1
    let bv = Infinity
    for (let i = 0; i < k; i++) {
      for (let j = i + 1; j < k; j++) {
        const q = (k - 2) * dist[i][j] - rowSum[i] - rowSum[j]
        if (q < bv) {
          bv = q
          bi = i
          bj = j
        }
      }
    }
    const dij = dist[bi][bj]
    let limbI = 0.5 * dij + (rowSum[bi] - rowSum[bj]) / (2 * (k - 2))
    let limbJ = dij - limbI
    if (!isFinite(limbI) || limbI < 0) limbI = 0
    if (!isFinite(limbJ) || limbJ < 0) limbJ = 0

    const u: TreeNode = {
      id: nextId(),
      children: [
        { node: active[bi], length: limbI },
        { node: active[bj], length: limbJ },
      ],
    }

    const keep: number[] = []
    for (let r = 0; r < k; r++) if (r !== bi && r !== bj) keep.push(r)

    const newDist: number[][] = []
    for (const r of keep) {
      const nr: number[] = []
      for (const c of keep) nr.push(dist[r][c])
      newDist.push(nr)
    }
    const newRow: number[] = []
    for (const r of keep) newRow.push(0.5 * (dist[bi][r] + dist[bj][r] - dij))
    newRow.push(0) // 新节点自距离
    newDist.push(newRow)
    for (let r = 0; r < newDist.length - 1; r++) newDist[r].push(newRow[r])

    const newActive: TreeNode[] = []
    for (const r of keep) newActive.push(active[r])
    newActive.push(u)
    active = newActive
    dist = newDist
  }

  return {
    id: nextId(),
    children: [
      { node: active[0], length: dist[0][1] / 2 },
      { node: active[1], length: dist[0][1] / 2 },
    ],
  }
}

// UPGMA 聚类，返回有根树（分支长度按簇高度）
export function upgma(Din: number[][], labels: string[]): TreeNode {
  const n = labels.length
  let active: { node: TreeNode; size: number }[] = labels.map((name) => ({
    node: { id: nextId(), name, height: 0 },
    size: 1,
  }))
  let dist: number[][] = Din.map((r) => r.slice())

  while (active.length > 1) {
    const k = active.length
    let bi = -1
    let bj = -1
    let bv = Infinity
    for (let i = 0; i < k; i++) {
      for (let j = i + 1; j < k; j++) {
        if (dist[i][j] < bv) {
          bv = dist[i][j]
          bi = i
          bj = j
        }
      }
    }
    const h = dist[bi][bj] / 2
    const u: TreeNode = {
      id: nextId(),
      height: h,
      children: [
        { node: active[bi].node, length: Math.max(0, h - (active[bi].node.height || 0)) },
        { node: active[bj].node, length: Math.max(0, h - (active[bj].node.height || 0)) },
      ],
    }

    const keep: number[] = []
    for (let r = 0; r < k; r++) if (r !== bi && r !== bj) keep.push(r)
    const newDist: number[][] = []
    for (const r of keep) {
      const nr: number[] = []
      for (const c of keep) nr.push(dist[r][c])
      newDist.push(nr)
    }
    const newRow: number[] = []
    for (const r of keep) {
      newRow.push((active[r].size * dist[r][bi] + active[bj].size * dist[bj][r]) / (active[r].size + active[bj].size))
    }
    newRow.push(0) // 新簇自距离
    newDist.push(newRow)
    for (let r = 0; r < newDist.length - 1; r++) newDist[r].push(newRow[r])

    const newActive: { node: TreeNode; size: number }[] = []
    for (const r of keep) newActive.push(active[r])
    newActive.push({ node: u, size: active[bi].size + active[bj].size })
    active = newActive
    dist = newDist
  }
  return active[0].node
}
