// 轻量内置多序列比对（演示/兜底用）：Needleman-Wunsch 全局比对 + 引导树渐进比对。
// 生产环境优先调用外部 MAFFT（见 tauri.ts），此处保证离线端到端可跑通。
import { parseFasta, toFasta, SeqRecord } from './fasta'
import { distanceMatrix } from './distance'
import { neighborJoining } from './tree'
import { leafOrder } from './newick'

const MATCH = 1
const MISMATCH = -1
const GAP = -2

function isDNA(seqs: string[]): boolean {
  const set = new Set('ACGTUN-')
  for (const s of seqs) for (const ch of s) if (ch !== '-' && !set.has(ch)) return false
  return true
}

function sub(a: string, b: string): number {
  if (a === '-' || b === '-') return GAP
  return a === b ? MATCH : MISMATCH
}

// 两序列全局比对（带回溯），返回 [对齐a, 对齐b]
function nwPair(a: string, b: string): [string, string] {
  const n = a.length
  const m = b.length
  const H = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  const T = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0)) // 0=diag,1=up,2=left
  for (let i = 1; i <= n; i++) {
    H[i][0] = i * GAP
    T[i][0] = 1
  }
  for (let j = 1; j <= m; j++) {
    H[0][j] = j * GAP
    T[0][j] = 2
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const d = H[i - 1][j - 1] + sub(a[i - 1], b[j - 1])
      const u = H[i - 1][j] + GAP
      const l = H[i][j - 1] + GAP
      if (d >= u && d >= l) {
        H[i][j] = d
        T[i][j] = 0
      } else if (u >= l) {
        H[i][j] = u
        T[i][j] = 1
      } else {
        H[i][j] = l
        T[i][j] = 2
      }
    }
  }
  let i = n
  let j = m
  let ra = ''
  let rb = ''
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && T[i][j] === 0) {
      ra = a[i - 1] + ra
      rb = b[j - 1] + rb
      i--
      j--
    } else if (i > 0 && T[i][j] === 1) {
      ra = a[i - 1] + ra
      rb = '-' + rb
      i--
    } else {
      ra = '-' + ra
      rb = b[j - 1] + rb
      j--
    }
  }
  return [ra, rb]
}

// 两 profile（多行字符串）比对：列间得分取两两平均
function profileScore(colA: string[], colB: string[]): number {
  let s = 0
  let cnt = 0
  for (const x of colA) {
    for (const y of colB) {
      s += sub(x, y)
      cnt++
    }
  }
  return cnt ? s / cnt : 0
}

// profile-profile 比对：返回合并后的单一 profile（n+m 行，行宽一致）。
// DP 维度为「列数（序列长度）」，列向量 = 各序列在该位点的字符数组。
function nwProfile(A: string[], B: string[]): string[] {
  const n = A[0]?.length || 0
  const m = B[0]?.length || 0
  const H = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  const T = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 1; i <= n; i++) {
    H[i][0] = i * GAP
    T[i][0] = 1
  }
  for (let j = 1; j <= m; j++) {
    H[0][j] = j * GAP
    T[0][j] = 2
  }
  const colA = (i: number) => A.map((row) => row[i - 1])
  const colB = (j: number) => B.map((row) => row[j - 1])
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const d = H[i - 1][j - 1] + profileScore(colA(i), colB(j))
      const u = H[i - 1][j] + GAP
      const l = H[i][j - 1] + GAP
      if (d >= u && d >= l) {
        H[i][j] = d
        T[i][j] = 0
      } else if (u >= l) {
        H[i][j] = u
        T[i][j] = 1
      } else {
        H[i][j] = l
        T[i][j] = 2
      }
    }
  }
  let i = n
  let j = m
  // 回溯从序列末尾走向起点，故先压入数组、结束后再整体反转，得到正向序列
  const result: string[][] = Array(A.length + B.length)
    .fill(0)
    .map(() => [])
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && T[i][j] === 0) {
      for (let r = 0; r < A.length; r++) result[r].push(A[r][i - 1])
      for (let r = 0; r < B.length; r++) result[A.length + r].push(B[r][j - 1])
      i--
      j--
    } else if (i > 0 && T[i][j] === 1) {
      for (let r = 0; r < A.length; r++) result[r].push(A[r][i - 1])
      for (let r = 0; r < B.length; r++) result[A.length + r].push('-')
      i--
    } else {
      for (let r = 0; r < A.length; r++) result[r].push('-')
      for (let r = 0; r < B.length; r++) result[A.length + r].push(B[r][j - 1])
      j--
    }
  }
  return result.map((a) => a.reverse().join(''))
}

// 按引导树（NJ on p-distance）自底向上渐进比对，返回与原始输入顺序一致的比对行
export function multipleSequenceAlign(seqs: string[]): string[] {
  if (seqs.length === 0) return []
  if (seqs.length === 1) return seqs.slice()
  // 引导树
  const names = seqs.map((_, i) => `s${i}`)
  const D = distanceMatrix(seqs, 'pdist')
  const guide = neighborJoining(D, names)

  // 递归：返回该节点对应的合并 profile（各叶子行）
  function build(node: any): string[] {
    if (!node.children || !node.children.length) {
      const idx = parseInt(node.name!.slice(1), 10)
      return [seqs[idx]]
    }
    const childProfiles = node.children.map((c: any) => build(c.node))
    let acc = childProfiles[0]
    for (let k = 1; k < childProfiles.length; k++) {
      acc = nwProfile(acc, childProfiles[k])
    }
    return acc
  }
  const profile = build(guide)
  // profile 行顺序 = guide 树叶子遍历顺序；重排为原始输入顺序
  const leafNodes = leafOrder(guide)
  const rowOfName = new Map<string, string>()
  leafNodes.forEach((lf, r) => rowOfName.set(lf.name!, profile[r]))
  return names.map((nm) => rowOfName.get(nm)!)
}

export function alignFastaRecords(recs: SeqRecord[]): SeqRecord[] {
  const seqs = recs.map((r) => r.sequence)
  const aligned = multipleSequenceAlign(seqs)
  return recs.map((r, i) => ({ ...r, sequence: aligned[i] }))
}

// 供示例/测试
export function demoAlign(text: string): string {
  const recs = parseFasta(text)
  const out = alignFastaRecords(recs)
  return toFasta(out)
}
