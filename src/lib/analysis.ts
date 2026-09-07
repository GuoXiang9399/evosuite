// 分析编排：串联 距离矩阵 -> 建树 -> Newick，供 GUI 调用
import { SeqRecord } from './fasta'
import { distanceMatrix, SubstModel, DistOptions } from './distance'
import { neighborJoining, upgma } from './tree'
import { TreeNode, toNewick, resetIds } from './newick'
import { alignFastaRecords } from './align'

export interface DistResult {
  labels: string[]
  matrix: number[][]
}

export function computeDistance(recs: SeqRecord[], model: SubstModel, opts?: DistOptions): DistResult {
  const labels = recs.map((r) => r.name)
  const seqs = recs.map((r) => r.sequence)
  const matrix = distanceMatrix(seqs, model, opts)
  return { labels, matrix }
}

export function buildTree(
  labels: string[],
  D: number[][],
  method: 'NJ' | 'UPGMA',
): { tree: TreeNode; newick: string } {
  resetIds()
  const tree = method === 'UPGMA' ? upgma(D, labels) : neighborJoining(D, labels)
  return { tree, newick: toNewick(tree) }
}

export function alignRecords(recs: SeqRecord[]): SeqRecord[] {
  return alignFastaRecords(recs)
}
