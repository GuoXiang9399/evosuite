// 自举(Bootstrap)支持值：对比对列重抽样，统计各内部节点对应分支（bipartition）的出现频率。
// 这是 MEGA 等系统发育软件的标志性功能，用于评估树的分支可靠性。
import { SeqRecord } from './fasta'
import { SubstModel, distanceMatrix, DistOptions } from './distance'
import { neighborJoining, upgma } from './tree'
import { TreeNode, internalNodes, toNewick } from './newick'
import { computeDistance, buildTree } from './analysis'

function leafSet(node: TreeNode): Set<string> {
  const s = new Set<string>()
  const st: TreeNode[] = [node]
  while (st.length) {
    const n = st.pop()!
    if (n.children && n.children.length) n.children.forEach((c) => st.push(c.node))
    else if (n.name) s.add(n.name)
  }
  return s
}

// 用叶子名集合（排序后拼接）作为分支的唯一签名，跨不同树拓扑比对时也能匹配
function sig(ls: Set<string>): string {
  return [...ls].sort().join('|')
}

export function bootstrapSupport(
  refTree: TreeNode,
  recs: SeqRecord[],
  model: SubstModel,
  method: 'NJ' | 'UPGMA',
  reps: number,
  opts?: DistOptions,
): Map<number, number> {
  const labels = recs.map((r) => r.name)
  const seqs = recs.map((r) => r.sequence)
  const n = seqs.length
  if (n < 4 || reps <= 0) return new Map()
  const L = seqs[0]?.length || 0
  if (!L) return new Map()

  const refInt = internalNodes(refTree)
  const fullSet = leafSet(refTree)
  const fullSig = sig(fullSet)
  const refSigs = refInt.map((nd) => sig(leafSet(nd)))
  // 以原始树的内部节点签名为键初始化计数（根的“全体叶子”分支不计）
  const countBySig = new Map<string, number>()
  refSigs.forEach((s) => {
    if (s !== fullSig) countBySig.set(s, 0)
  })

  for (let r = 0; r < reps; r++) {
    // 列重抽样（有放回）
    const cols: number[] = []
    for (let i = 0; i < L; i++) cols.push((Math.random() * L) | 0)
    const seqR = seqs.map((s) => {
      let o = ''
      for (const c of cols) o += s[c]
      return o
    })
    const D = distanceMatrix(seqR, model, opts)
    const t = method === 'UPGMA' ? upgma(D, labels) : neighborJoining(D, labels)
    const seen = new Set<string>()
    for (const nd of internalNodes(t)) {
      const ls = leafSet(nd)
      if (ls.size >= n) continue
      const k = sig(ls)
      if (countBySig.has(k) && !seen.has(k)) {
        countBySig.set(k, (countBySig.get(k) || 0) + 1)
        seen.add(k)
      }
    }
  }

  const support = new Map<number, number>()
  refInt.forEach((nd, i) => {
    const k = refSigs[i]
    if (countBySig.has(k)) support.set(nd.id, Math.round(((countBySig.get(k) || 0) / reps) * 1000) / 10)
  })
  return support
}

// 将支持值写回树节点（内部节点 .bootstrap 字段）
export function annotateBootstrap(tree: TreeNode, support: Map<number, number>): TreeNode {
  const walk = (n: TreeNode) => {
    if (support.has(n.id)) n.bootstrap = support.get(n.id)
    n.children?.forEach((c) => walk(c.node))
  }
  walk(tree)
  return tree
}

// 端到端：建树 + 自举，返回带支持值的树与 Newick
export function buildTreeWithBootstrap(
  recs: SeqRecord[],
  model: SubstModel,
  method: 'NJ' | 'UPGMA',
  reps: number,
  opts?: DistOptions,
): { tree: TreeNode; newick: string; support?: Map<number, number> } {
  const { labels, matrix } = computeDistance(recs, model, opts)
  const { tree } = buildTree(labels, matrix, method)
  let support: Map<number, number> | undefined
  if (reps > 0 && recs.length >= 4) {
    support = bootstrapSupport(tree, recs, model, method, reps, opts)
    annotateBootstrap(tree, support)
  }
  return { tree, newick: toNewick(tree), support }
}
