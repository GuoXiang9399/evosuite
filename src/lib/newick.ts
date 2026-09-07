// 系统发育树节点结构与 Newick 解析/序列化

export interface TreeNode {
  id: number
  name?: string
  length?: number // 到父节点的分支长度
  height?: number // UPGMA 用：节点高度
  bootstrap?: number // 内部节点支持值
  children?: { node: TreeNode; length: number }[]
}

let _id = 1
export function nextId(): number {
  return _id++
}
export function resetIds() {
  _id = 1
}

function round(x: number): string {
  if (!isFinite(x)) return '0'
  return (Math.round(x * 1e6) / 1e6).toString()
}

export function toNewick(node: TreeNode): string {
  const ser = (n: TreeNode): string => {
    if (n.children && n.children.length) {
      const inner = n.children.map((c) => ser(c.node)).join(',')
      let s = '(' + inner + ')'
      if (n.name) s += n.name
      if (n.bootstrap != null) s += ':' + round(n.bootstrap)
      if (n.length != null) s += ':' + round(n.length)
      return s
    }
    let s = n.name || ''
    if (n.length != null) s += ':' + round(n.length)
    return s
  }
  return ser(node) + ';'
}

export function parseNewick(text: string): TreeNode {
  const s = text.trim()
  let pos = 0
  const ws = () => {
    while (pos < s.length && /\s/.test(s[pos])) pos++
  }
  const parseNode = (): TreeNode => {
    ws()
    const node: TreeNode = { id: nextId() }
    if (s[pos] === '(') {
      pos++
      node.children = []
      node.children.push({ node: parseNode(), length: 0 })
      ws()
      while (s[pos] === ',') {
        pos++
        node.children.push({ node: parseNode(), length: 0 })
        ws()
      }
      if (s[pos] === ')') pos++
      // 内部节点标签（常为支持值）
      let name = ''
      while (pos < s.length && s[pos] !== ':' && s[pos] !== ',' && s[pos] !== ')' && s[pos] !== ';') {
        name += s[pos]
        pos++
      }
      if (name) node.bootstrap = parseFloat(name)
      if (s[pos] === ':') {
        pos++
        let v = ''
        while (pos < s.length && /[0-9eE.+-]/.test(s[pos])) {
          v += s[pos]
          pos++
        }
        node.length = parseFloat(v)
      }
      // 把刚解析的子节点长度回填
      if (node.children) {
        // 子节点长度已在 parseNode 尾部解析（叶/内部各自处理）
      }
    } else {
      let name = ''
      while (pos < s.length && s[pos] !== ':' && s[pos] !== ',' && s[pos] !== ')' && s[pos] !== ';') {
        name += s[pos]
        pos++
      }
      node.name = name || undefined
      if (s[pos] === ':') {
        pos++
        let v = ''
        while (pos < s.length && /[0-9eE.+-]/.test(s[pos])) {
          v += s[pos]
          pos++
        }
        node.length = parseFloat(v)
      }
    }
    return node
  }
  // 解析子节点后回填 length 到 children 包装
  const root = parseNode()
  return root
}

// 修正：parseNode 中 children 的 length 在子节点解析时已设，但父级未回填到 wrapper。
// 用后处理确保 children[].length 来自子节点自身 length。
function fixChildren(n: TreeNode) {
  if (n.children) {
    n.children = n.children.map((c) => ({ node: c.node, length: c.node.length ?? 0 }))
    n.children.forEach((c) => fixChildren(c.node))
  }
}
export function parseNewickSafe(text: string): TreeNode {
  const t = parseNewick(text)
  fixChildren(t)
  return t
}

export function leafOrder(node: TreeNode): TreeNode[] {
  if (!node.children || !node.children.length) return [node]
  const out: TreeNode[] = []
  node.children.forEach((c) => out.push(...leafOrder(c.node)))
  return out
}

export function leafCount(node: TreeNode): number {
  if (!node.children || !node.children.length) return 1
  return node.children.reduce((a, c) => a + leafCount(c.node), 0)
}

// 收集内部节点（含支持值的用于显示）
export function internalNodes(node: TreeNode): TreeNode[] {
  if (!node.children || !node.children.length) return []
  const out: TreeNode[] = [node]
  node.children.forEach((c) => out.push(...internalNodes(c.node)))
  return out
}

// 梯形化：递归地把子节点按叶子数从多到少排列（纯展示用）
export function ladderize(root: TreeNode): TreeNode {
  const reorder = (n: TreeNode) => {
    if (n.children && n.children.length) {
      n.children.forEach((c) => reorder(c.node))
      n.children.sort((a, b) => leafCount(b.node) - leafCount(a.node))
    }
  }
  reorder(root)
  return root
}

// 中点根化：把根放在“最长两叶子路径”的中点（无根树常用），保留原节点 id 以支持值标注不丢失
export function midpointRoot(root: TreeNode): TreeNode {
  const adj = new Map<number, { to: number; len: number }[]>()
  const byId = new Map<number, TreeNode>()
  const addEdge = (a: number, b: number, len: number) => {
    if (!adj.has(a)) adj.set(a, [])
    if (!adj.has(b)) adj.set(b, [])
    adj.get(a)!.push({ to: b, len })
    adj.get(b)!.push({ to: a, len })
  }
  const collect = (n: TreeNode, parent?: number, plen = 0) => {
    byId.set(n.id, n)
    if (parent != null) addEdge(parent, n.id, plen)
    n.children?.forEach((c) => collect(c.node, n.id, c.length))
  }
  collect(root)

  const distFrom = (s: number) => {
    const d = new Map<number, number>()
    d.set(s, 0)
    const q = [s]
    while (q.length) {
      const x = q.shift()!
      for (const e of adj.get(x)!) if (!d.has(e.to)) {
        d.set(e.to, d.get(x)! + e.len)
        q.push(e.to)
      }
    }
    return d
  }

  const leaves = leafOrder(root)
  let u = leaves[0].id
  let best = -1
  const d0 = distFrom(u)
  for (const lf of leaves) if ((d0.get(lf.id) ?? -1) > best) { best = d0.get(lf.id)!; u = lf.id }
  const d1 = distFrom(u)
  let v = u
  let best2 = -1
  for (const lf of leaves) if ((d1.get(lf.id) ?? -1) > best2) { best2 = d1.get(lf.id)!; v = lf.id }

  // 还原 u->v 路径
  const prev = new Map<number, number>()
  const prevLen = new Map<number, number>()
  const q = [u]
  const seen = new Set([u])
  while (q.length) {
    const x = q.shift()!
    for (const e of adj.get(x)!) if (!seen.has(e.to)) {
      seen.add(e.to)
      prev.set(e.to, x)
      prevLen.set(e.to, e.len)
      q.push(e.to)
    }
  }
  const path: number[] = []
  let cur = v
  while (cur !== u) { path.push(cur); cur = prev.get(cur)! }
  path.push(u)
  path.reverse()

  const half = best2 / 2
  let cum = 0
  let split = 0
  for (let i = 0; i < path.length - 1; i++) {
    const len = prevLen.get(path[i + 1])!
    if (cum + len >= half) { split = i; break }
    cum += len
  }
  const A = path[split]
  const B = path[split + 1]
  const L = prevLen.get(B)!
  const L1 = half - cum
  const L2 = L - L1

  // 以 node 为根、剪掉朝 fromNeighbor 的边，重建子树（复用原 id）
  const subtree = (nodeId: number, fromNeighbor: number): TreeNode => {
    const n = byId.get(nodeId)!
    const kids: { node: TreeNode; length: number }[] = []
    for (const e of adj.get(nodeId)!) {
      if (e.to === fromNeighbor) continue
      kids.push({ node: subtree(e.to, nodeId), length: e.len })
    }
    return {
      id: n.id,
      name: n.name,
      length: n.length,
      height: n.height,
      bootstrap: n.bootstrap,
      children: kids.length ? kids : undefined,
    }
  }

  return {
    id: nextId(),
    children: [
      { node: subtree(A, B), length: Math.max(0, L1) },
      { node: subtree(B, A), length: Math.max(0, L2) },
    ],
  }
}
