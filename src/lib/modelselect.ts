// 核苷酸置换模型的似然拟合与优化选择（内置 ModelFinder / jModelTest 同类程序）。
//
// 在固定的 NJ 拓扑上，对每个候选模型（JC/F81/K80/HKY/TN/TIM/TVM/SYM/GTR，
// 可选 +G{K} 离散 Gamma 变体）做最大似然拟合：
//   1. 位点模式压缩（unique patterns + counts）
//   2. Felsenstein pruning 计算树似然（含 per-node 数值 scaling）
//   3. 坐标优化：模型速率参数（对数空间黄金分割）+ 分支长度（路径局部重算）+ Gamma α
//   4. 信息准则评分：AIC / AICc / BIC + Akaike 权重，排名选出最优模型
//
// 模型速率约束与 IQ-TREE 官方 6 位速率码（A-C, A-G, A-T, C-G, C-T, G-T）一致：
//   JC   000000 等速率+等频率 (df 0)      F81  000000 等速率+经验频率 (df 3)
//   K80  010010 A-G=C-T +等频率 (df 1)    HKY  010010 A-G=C-T +经验频率 (df 4)
//   TN   010020 两类转换独立+颠换相等 (df 5)
//   TIM  AC=GT, AT=CG, A-G/C-T 独立 (df 6)
//   TVM  A-G=C-T, 四类颠换独立 (df 7)
//   SYM  012345 全独立+等频率 (df 5)      GTR  012345 全独立+经验频率 (df 8)
//
// 转移矩阵：Q_ij = r_ij·π_j，速率归一化使期望替换率 μ = Σ_{i<j} 2·r_ij·π_i·π_j = 1
// （分支长度 = 每位点期望替换数，与 IQ-TREE 同量纲）。
// P(t) = D_√π⁻¹ · exp(S t) · D_√π，S = D_√π Q D_√π 实对称（Jacobi 特征分解）。

import { eigenSymmetric } from './dist/eigen'
import { distanceMatrix } from './distance'
import { neighborJoining } from './tree'
import { TreeNode, toNewick } from './newick'

// ---------------------------------------------------------------------------
// 离散 Gamma 速率（PAML / Yang 1994 标准实现：等概率分位区间的条件期望，均值精确 = 1）
// ---------------------------------------------------------------------------

// 正则化不完全 gamma 函数 P(a, x)（级数 + 连分式；同 dist/gamma.ts 算法）
function gammaPfn(a: number, x: number): number {
  if (x <= 0) return 0
  if (x < a + 1) {
    let term = 1 / a
    let sum = term
    for (let n = 1; n < 300; n++) {
      term *= x / (a + n)
      sum += term
      if (Math.abs(term) < Math.abs(sum) * 1e-15) break
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGammaFn(a))
  }
  const FPMIN = 1e-300
  let b = x + 1 - a
  let c = 1 / FPMIN
  let d = 1 / b
  let h = d
  for (let i = 1; i < 300; i++) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = b + an / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 1e-15) break
  }
  return 1 - h * Math.exp(-x + a * Math.log(x) - logGammaFn(a))
}

function logGammaFn(x: number): number {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ]
  let y = x, tmp = x + 5.5
  tmp -= (x + 0.5) * Math.log(tmp)
  let ser = 1.000000000190015
  for (let j = 0; j < 6; j++) { ser += cof[j] / ++y }
  return -tmp + Math.log(2.5066282746310005 * ser / x)
}

function gammaInvPfn(a: number, q: number): number {
  if (q <= 0) return 0
  if (q >= 1) return 200
  let lo = 0, hi = a * 80 + 40
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2
    if (gammaPfn(a, mid) < q) lo = mid
    else hi = mid
    if (hi - lo < 1e-12) break
  }
  return (lo + hi) / 2
}

/**
 * K 类离散 Gamma 速率（均值 = 1）：
 * rate_k = K·[P(α+1, x_{k+1}) − P(α+1, x_k)]，x_k = P^{-1}(α, k/K) 等概率分位边界。
 * 这是 PAML 的 rate_k = mean of Γ(α,1/α) 在第 k 个等概率区间的条件期望。
 */
export function discreteGammaRates(K: number, alpha: number): number[] {
  if (!(alpha > 0) || !isFinite(alpha) || K <= 1) return new Array(K).fill(1)
  const rates: number[] = []
  let prev = 0
  for (let k = 1; k <= K; k++) {
    const xb = k === K ? Infinity : gammaInvPfn(alpha, k / K)
    const pHi = xb === Infinity ? 1 : gammaPfn(alpha + 1, xb)
    const pLo = k === 1 ? 0 : gammaPfn(alpha + 1, prev)
    rates.push(Math.max(1e-12, K * (pHi - pLo)))
    prev = xb
  }
  return rates
}

// ---------------------------------------------------------------------------
// 类型与模型规格
// ---------------------------------------------------------------------------

export type ModelCriterion = 'AIC' | 'AICc' | 'BIC'

const BASE_CODE: Record<string, number> = { A: 0, C: 1, G: 2, T: 3, U: 3 }
const CHARS = ['A', 'C', 'G', 'T']

export interface ModelSpec {
  name: string
  equalFreq: boolean     // true → π = 0.25 固定；false → 观测频率（+F，IQ-TREE 默认）
  rateParams: number     // 自由速率参数个数（归一化后）
  modelDf: number        // 模型自由度（速率 + 频率），与 IQ-TREE 官方 df 一致
  // θ → 6 速率 [A-C, A-G, A-T, C-G, C-T, G-T]（未归一化，对称可逆）
  buildRates: (theta: number[]) => number[]
}

const r6 = (ac: number, ag: number, at: number, cg: number, ct: number, gt: number) => [ac, ag, at, cg, ct, gt]

export const NT_MODEL_SPECS: ModelSpec[] = [
  { name: 'JC',  equalFreq: true,  rateParams: 0, modelDf: 0, buildRates: () => r6(1, 1, 1, 1, 1, 1) },
  { name: 'F81', equalFreq: false, rateParams: 0, modelDf: 3, buildRates: () => r6(1, 1, 1, 1, 1, 1) },
  { name: 'K80', equalFreq: true,  rateParams: 1, modelDf: 1, buildRates: (t) => r6(1, t[0], 1, 1, t[0], 1) },
  { name: 'HKY', equalFreq: false, rateParams: 1, modelDf: 4, buildRates: (t) => r6(1, t[0], 1, 1, t[0], 1) },
  { name: 'TN',  equalFreq: false, rateParams: 2, modelDf: 5, buildRates: (t) => r6(1, t[0], 1, 1, t[1], 1) },
  // TIM：transitions (A-G, C-T) 独立；transversions AC=GT、AT=CG；基准 AT=CG=1
  { name: 'TIM', equalFreq: false, rateParams: 3, modelDf: 6, buildRates: (t) => r6(t[0], t[1], 1, 1, t[2], t[0]) },
  // TVM：transitions A-G=C-T；transversions 四类独立；基准 GT=1
  { name: 'TVM', equalFreq: false, rateParams: 4, modelDf: 7, buildRates: (t) => r6(t[0], t[1], t[2], t[3], t[1], 1) },
  { name: 'SYM', equalFreq: true,  rateParams: 5, modelDf: 5, buildRates: (t) => r6(t[0], t[1], t[2], t[3], t[4], 1) },
  { name: 'GTR', equalFreq: false, rateParams: 5, modelDf: 8, buildRates: (t) => r6(t[0], t[1], t[2], t[3], t[4], 1) },
]

export interface Patterns {
  data: Int8Array[]   // 每条 pattern：各序列状态（0-3=ACGT，-1=歧义/gap）
  counts: number[]
  nSites: number      // Σ counts
}

export interface ModelFitResult {
  model: string       // 如 'HKY' / 'HKY+G4'
  base: string
  gamma: boolean
  lnL: number
  modelDf: number     // 模型自由度（速率+频率，+G 时含 α）
  k: number           // 总参数 = modelDf + 分支数 (2n-3)
  aic: number
  aicc: number
  bic: number
  delta: number       // 按当前准则相对最优
  weight: number      // Akaike/BIC 权重
  pi: number[]
  rates: number[]     // 6 个速率（归一化后）
  alpha: number | null
  blen: number[]      // 优化后的分支长度（按节点索引）
}

export interface ModelTestResult {
  fits: ModelFitResult[]   // 按准则升序
  best: ModelFitResult
  criterion: ModelCriterion
  nSeqs: number
  nSites: number
  nPatterns: number
  treeNewick: string       // 使用的固定 NJ 拓扑
  fromEngine: false        // 内置实现标记（桌面端 IQ-TREE2 结果由 tauri.ts 单独封装）
}

export interface ModelTestOptions {
  criterion?: ModelCriterion
  withGamma?: boolean     // 是否同时拟合 +G4 变体（默认 true）
  gammaCats?: number      // Gamma 类别数（默认 4）
}

// ---------------------------------------------------------------------------
// 位点模式压缩
// ---------------------------------------------------------------------------

export function compressPatterns(seqs: string[]): Patterns {
  const n = seqs.length
  const L = seqs.reduce((m, s) => Math.min(m, s.length), Infinity)
  const map = new Map<string, { pat: Int8Array; count: number }>()
  for (let k = 0; k < L; k++) {
    const pat = new Int8Array(n)
    let kb = ''
    for (let i = 0; i < n; i++) {
      const c = (seqs[i][k] || '-').toUpperCase()
      const s = BASE_CODE[c] !== undefined ? BASE_CODE[c] : -1
      pat[i] = s
      kb += String.fromCharCode(65 + s + 1)  // -1→'A', 0→'B', 1→'C'...
    }
    const hit = map.get(kb)
    if (hit) hit.count++
    else map.set(kb, { pat, count: 1 })
  }
  const data: Int8Array[] = []
  const counts: number[] = []
  let nSites = 0
  for (const v of map.values()) {
    data.push(v.pat)
    counts.push(v.count)
    nSites += v.count
  }
  return { data, counts, nSites }
}

// 观测碱基频率（非歧义状态计数）
export function observedFreq(pats: Patterns): number[] {
  const f = [0, 0, 0, 0]
  for (let p = 0; p < pats.data.length; p++) {
    const pat = pats.data[p]
    const c = pats.counts[p]
    for (let i = 0; i < pat.length; i++) {
      if (pat[i] >= 0) f[pat[i]] += c
    }
  }
  const tot = f[0] + f[1] + f[2] + f[3]
  if (tot <= 0) return [0.25, 0.25, 0.25, 0.25]
  return f.map((v) => v / tot)
}

// ---------------------------------------------------------------------------
// 树：NJ 拓扑（JC69 距离）扁平化为无根数组结构
// ---------------------------------------------------------------------------

export interface FlatTree {
  n: number             // 叶数（= 序列数）
  size: number          // 总节点数
  root: number
  children: number[][]  // children[v]（叶为空数组；内部节点 2-3 个孩子）
  parent: Int32Array
  blen: Float64Array    // blen[v] = v→parent 分支长度（root 无效）
  leafSeq: Int32Array   // 叶节点 v → 序列索引；内部节点 -1
  leaves: number[]      // 叶节点列表
  order: number[]       // 内部节点后序遍历
  branches: number[]    // 分支节点列表（非根全部节点，共 2n-3 条）
  newick: string
}

// 把 NJ 的虚拟根（度 2）拆开：左孩子 A 作为无根树的计算根，
// 右孩子 B 挂到 A 下，分支长度 lenA+lenB —— 得到严格的 2n-3 条分支。
function flattenNJ(njRoot: TreeNode, nameToIdx: Map<string, number>, n: number): FlatTree | null {
  interface FNode { kids: number[]; blen: number; parent: number; seq: number }
  const nodes: FNode[] = []
  const add = (t: TreeNode, parent: number, plen: number): number => {
    const id = nodes.length
    nodes.push({ kids: [], blen: plen, parent, seq: -1 })
    if (t.children && t.children.length) {
      for (const c of t.children) nodes[id].kids.push(add(c.node, id, c.length))
    } else {
      nodes[id].seq = nameToIdx.get(t.name ?? '') ?? -1
    }
    return id
  }
  if (!njRoot.children || njRoot.children.length < 2) return null
  let A = njRoot.children[0]
  let B = njRoot.children[1]
  // 新根必须是内部节点（n>=3 时 NJ 根的两个孩子至少一个是内部节点）
  if (!(A.node.children && A.node.children.length) && B.node.children && B.node.children.length) {
    const tmp = A; A = B; B = tmp
  }
  if (!(A.node.children && A.node.children.length)) return null
  const rootId = add(A.node, -1, 0)
  const bid = add(B.node, rootId, Math.max(1e-9, A.length + B.length))
  nodes[rootId].kids.push(bid)

  const size = nodes.length
  const children: number[][] = nodes.map((x) => x.kids)
  const parent = new Int32Array(size)
  const blen = new Float64Array(size)
  const leafSeq = new Int32Array(size).fill(-1)
  const leaves: number[] = []
  nodes.forEach((x, i) => {
    parent[i] = x.parent
    blen[i] = Math.max(1e-9, x.blen)
    leafSeq[i] = x.seq
    if (!x.kids.length) leaves.push(i)
  })
  const order: number[] = []
  const post = (v: number) => {
    for (const c of children[v]) post(c)
    if (children[v].length) order.push(v)
  }
  post(rootId)
  const branches: number[] = []
  for (let v = 0; v < size; v++) if (v !== rootId) branches.push(v)
  return { n, size, root: rootId, children, parent, blen, leafSeq, leaves, order, branches, newick: '' }
}

export function buildTreeForTest(seqs: string[], names: string[]): FlatTree | null {
  const n = seqs.length
  if (n < 3) return null
  const D = distanceMatrix(seqs, 'jc69', { gapMode: 'pairwise' })
  const nj = neighborJoining(D, names)
  const nameToIdx = new Map(names.map((x, i) => [x, i]))
  const ft = flattenNJ(nj, nameToIdx, n)
  if (ft) ft.newick = toNewick(nj)
  return ft
}

// ---------------------------------------------------------------------------
// 转移矩阵：对称化 + 特征分解
// ---------------------------------------------------------------------------

interface NucEig {
  lam: number[]      // 特征值（升序）
  V: number[][]      // V[i][k]：第 k 个特征向量的第 i 分量
  sq: number[]       // √π
}

// 速率对索引：k ↔ (i,j)，i<j。0:AC 1:AG 2:AT 3:CG 4:CT 5:GT
const RATE_PAIR: [number, number][] = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]]

// rates6 = [AC, AG, AT, CG, CT, GT]（任意正尺度）。归一化 μ=Σ 2·r_ij·π_i·π_j = 1
// 对称化 S = D√π·Q·D√π⁻¹：S_ij = r_ij·√πi·√πj（i≠j），S_ii = Q_ii = −Σ_{j≠i} r_ij·π_j。
// 注意 S_ii ≠ −Σ S_ij（相似变换不保行和；0 特征向量为 √π）。
export function decomposeNuc(pi: number[], rates: number[]): NucEig {
  let mu = 0
  for (let k = 0; k < 6; k++) mu += 2 * rates[k] * pi[RATE_PAIR[k][0]] * pi[RATE_PAIR[k][1]]
  const norm = mu > 1e-300 ? 1 / mu : 1
  const sq = pi.map((v) => Math.sqrt(Math.max(1e-12, v)))
  const S: number[][] = Array.from({ length: 4 }, () => new Array(4).fill(0))
  for (let k = 0; k < 6; k++) {
    const [i, j] = RATE_PAIR[k]
    const s = rates[k] * norm * sq[i] * sq[j]
    S[i][j] = s
    S[j][i] = s
  }
  for (let i = 0; i < 4; i++) {
    let qdiag = 0
    for (let k = 0; k < 6; k++) {
      const [a, b] = RATE_PAIR[k]
      if (a === i) qdiag += rates[k] * norm * pi[b]
      if (b === i) qdiag += rates[k] * norm * pi[a]
    }
    S[i][i] = -qdiag
  }
  const eig = eigenSymmetric(S)
  return { lam: eig.values, V: eig.vectors, sq }
}

// P_ij(t) = (√π_j/√π_i) Σ_k V[i][k] V[j][k] e^{λ_k t}；写入 out（16 项，行主序）
export function nucPMatrix(eig: NucEig, t: number, out: Float64Array, off = 0): void {
  const e0 = Math.exp(eig.lam[0] * t), e1 = Math.exp(eig.lam[1] * t)
  const e2 = Math.exp(eig.lam[2] * t), e3 = Math.exp(eig.lam[3] * t)
  const e = [e0, e1, e2, e3]
  const { V, sq } = eig
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += V[i][k] * V[j][k] * e[k]
      out[off + i * 4 + j] = (sq[j] / sq[i]) * s
    }
  }
}

// ---------------------------------------------------------------------------
// Felsenstein pruning 引擎（支持 K 个速率类 = 离散 Gamma；路径局部重算）
// ---------------------------------------------------------------------------

const SCALE_LO = 1e-8
const SCALE_HI = 1e8

export class TreeLikelihood {
  private tree: FlatTree
  private pats: Patterns
  private P: number        // pattern 数
  private K: number        // 速率类数
  private classRate: number[]
  private eig: NucEig | null = null
  private pm: Float64Array     // K × size × 16 转移矩阵
  private L: Float64Array      // K × P × size × 4 条件似然
  private logS: Float64Array   // K × P：root 链累计尺度（= Σ_v logSnode[v]）
  private logSnode: Float64Array // K × P × size：每节点自身的尺度（可重入撤销）
  private pi: number[]
  private scratch = new Float64Array(4)
  private clsScratch: Float64Array

  constructor(tree: FlatTree, pats: Patterns, classRate: number[] = [1]) {
    this.tree = tree
    this.pats = pats
    this.P = pats.data.length
    this.K = classRate.length
    this.classRate = classRate.slice()
    this.pm = new Float64Array(this.K * tree.size * 16)
    this.L = new Float64Array(this.K * this.P * tree.size * 4)
    this.logS = new Float64Array(this.K * this.P)
    this.logSnode = new Float64Array(this.K * this.P * tree.size)
    this.pi = [0.25, 0.25, 0.25, 0.25]
    this.clsScratch = new Float64Array(this.K)
  }

  // 设置模型（π + 6 速率）并全量重算；返回总 lnL
  setModel(pi: number[], rates: number[]): number {
    this.pi = pi.slice()
    this.eig = decomposeNuc(pi, rates)
    this.full()
    return this.totalLnL()
  }

  // 公开：全量重算（供测试校验路径局部重算的一致性）
  recomputeFull(): number {
    if (!this.eig) throw new Error('model not set')
    this.full()
    return this.totalLnL()
  }

  // 更换 Gamma 速率类（均值 1），全量重算
  setClassRates(rates: number[]): number {
    this.classRate = rates.slice()
    if (this.eig) this.full()
    return this.totalLnL()
  }

  // 修改分支长度（路径局部重算），返回总 lnL
  setBranch(v: number, t: number): number {
    this.tree.blen[v] = t
    const pOffBase = this.tree.size * 16
    for (let c = 0; c < this.K; c++) {
      nucPMatrix(this.eig!, t * this.classRate[c], this.pm, c * pOffBase + v * 16)
    }
    this.recomputePath(v)
    return this.totalLnL()
  }

  totalLnL(): number {
    const { tree } = this
    const rootOff = tree.root * 4
    const cls = this.clsScratch
    let total = 0
    const logK = Math.log(this.K)
    for (let p = 0; p < this.P; p++) {
      let mx = -Infinity
      for (let c = 0; c < this.K; c++) {
        const base = (c * this.P + p) * tree.size * 4
        let s = 0
        for (let i = 0; i < 4; i++) s += this.pi[i] * this.L[base + rootOff + i]
        const v = this.logS[c * this.P + p] + Math.log(Math.max(1e-300, s)) - logK
        cls[c] = v
        if (v > mx) mx = v
      }
      let acc = 0
      for (let c = 0; c < this.K; c++) acc += Math.exp(cls[c] - mx)
      total += (mx + Math.log(Math.max(1e-300, acc))) * this.pats.counts[p]
    }
    return total
  }

  // 全量：重建所有 P 矩阵 + 所有节点 L
  private full(): void {
    const { tree } = this
    const pOffBase = tree.size * 16
    for (let c = 0; c < this.K; c++) {
      for (const v of tree.branches) {
        nucPMatrix(this.eig!, tree.blen[v] * this.classRate[c], this.pm, c * pOffBase + v * 16)
      }
    }
    for (let i = 0; i < this.logS.length; i++) this.logS[i] = 0
    for (let i = 0; i < this.logSnode.length; i++) this.logSnode[i] = 0
    // 叶状态（所有类共用叶状态值，但各类有独立存储）
    for (let p = 0; p < this.P; p++) {
      const pat = this.pats.data[p]
      for (const v of tree.leaves) {
        const s = pat[tree.leafSeq[v]]
        for (let c = 0; c < this.K; c++) {
          const base = (c * this.P + p) * tree.size * 4 + v * 4
          for (let i = 0; i < 4; i++) this.L[base + i] = s < 0 ? 1 : (i === s ? 1 : 0)
        }
      }
    }
    for (let c = 0; c < this.K; c++) {
      for (let p = 0; p < this.P; p++) {
        for (const v of tree.order) this.recomputeNode(c, p, v)
      }
    }
  }

  private recomputeNode(c: number, p: number, v: number): void {
    const { tree } = this
    const base = (c * this.P + p) * tree.size * 4
    const lv = base + v * 4
    for (let i = 0; i < 4; i++) this.L[lv + i] = 1
    const pOff = c * tree.size * 16
    for (const kid of tree.children[v]) {
      const lk = base + kid * 4
      const pk = pOff + kid * 16
      for (let i = 0; i < 4; i++) {
        let s = 0
        for (let j = 0; j < 4; j++) s += this.pm[pk + i * 4 + j] * this.L[lk + j]
        this.scratch[i] = s
      }
      for (let i = 0; i < 4; i++) this.L[lv + i] *= this.scratch[i]
    }
    // 数值 scaling（可重入：撤销旧 scale 贡献，记录新值；logS ≡ Σ_v logSnode[v]）
    let m = 0
    for (let i = 0; i < 4; i++) { const a = Math.abs(this.L[lv + i]); if (a > m) m = a }
    const so = (c * this.P + p) * tree.size + v
    let add = 0
    if (m > 0 && (m < SCALE_LO || m > SCALE_HI)) {
      for (let i = 0; i < 4; i++) this.L[lv + i] /= m
      add = Math.log(m)
    }
    this.logS[c * this.P + p] += add - this.logSnode[so]
    this.logSnode[so] = add
  }

  // 分支 v→parent 的 P 变化后：重算 parent..root 链上的节点
  private recomputePath(v: number): void {
    const { tree } = this
    const chain: number[] = []
    let u = tree.parent[v]
    while (u >= 0) { chain.push(u); u = tree.parent[u] }
    for (let c = 0; c < this.K; c++) {
      for (let p = 0; p < this.P; p++) {
        for (const node of chain) this.recomputeNode(c, p, node)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 优化器（黄金分割，最大化）
// ---------------------------------------------------------------------------

function goldenMax(lo: number, hi: number, f: (x: number) => number, iters = 18): { x: number; fx: number } {
  const invphi = (Math.sqrt(5) - 1) / 2
  let a = lo, b = hi
  if (!(b > a)) { const x = a; return { x, fx: f(x) } }
  let c = b - invphi * (b - a)
  let d = a + invphi * (b - a)
  let fc = f(c), fd = f(d)
  for (let i = 0; i < iters && b - a > 1e-7; i++) {
    if (fc > fd) {
      b = d; d = c; fd = fc
      c = b - invphi * (b - a)
      fc = f(c)
    } else {
      a = c; c = d; fc = fd
      d = a + invphi * (b - a)
      fd = f(d)
    }
  }
  return fc > fd ? { x: c, fx: fc } : { x: d, fx: fd }
}

// ---------------------------------------------------------------------------
// 单模型拟合
// ---------------------------------------------------------------------------

interface FitContext {
  tree: FlatTree
  pats: Patterns
  obsPi: number[]
  tiTvRatio: number   // 观测转换/颠换比（κ 初值）
}

// 全对比较粗估 ti/tv 比
function observeTiTv(pats: Patterns): number {
  let ti = 0, tv = 0
  for (let p = 0; p < pats.data.length; p++) {
    const d = pats.data[p]
    const c = pats.counts[p]
    for (let i = 0; i < d.length; i++) {
      for (let j = i + 1; j < d.length; j++) {
        const x = d[i], y = d[j]
        if (x < 0 || y < 0 || x === y) continue
        const isTi = x + y === 2 /* A-G */ || x + y === 4 /* C-T */
        if (isTi) ti += c; else tv += c
      }
    }
  }
  if (tv < 1) return ti > 0 ? 2 : 1
  return Math.min(20, Math.max(0.2, ti / tv))
}

export interface FitOutcome {
  lnL: number
  theta: number[]
  pi: number[]
  rates: number[]
  alpha: number | null
}

export function fitOne(
  ctx: FitContext,
  spec: ModelSpec,
  gamma: boolean,
  gammaCats: number,
): FitOutcome {
  const { tree, pats, obsPi } = ctx
  const pi = spec.equalFreq ? [0.25, 0.25, 0.25, 0.25] : obsPi.slice()
  // 语义化热启动：按参数是否作用于转换位点 (AG=idx1, CT=idx4) 用观测 ti/tv 比初始化，
  // 颠换用 1。避免跨模型按位置链式传递 theta 时的语义错位导致局部最优。
  const base = spec.buildRates(new Array(spec.rateParams).fill(1))
  const semanticSeed = new Array(spec.rateParams)
  for (let i = 0; i < spec.rateParams; i++) {
    const tp = new Array(spec.rateParams).fill(1)
    tp[i] = 2
    const rt = spec.buildRates(tp)
    const touchTrans = Math.abs(rt[1] - base[1]) > 1e-9 || Math.abs(rt[4] - base[4]) > 1e-9
    semanticSeed[i] = touchTrans ? ctx.tiTvRatio : 1
  }
  // 多起点：高自由度模型（≥3 速率参数）坐标搜索易陷局部最优，跑多个起点取最好
  const inits: number[][] = [semanticSeed]
  if (spec.rateParams >= 3) {
    inits.push(new Array(spec.rateParams).fill(1))
    inits.push(new Array(spec.rateParams).fill(ctx.tiTvRatio))
  }
  const blenSnap = tree.blen.slice()
  let best: FitOutcome | null = null
  for (const init of inits) {
    tree.blen.set(blenSnap)
    const out = optimizeFrom(ctx, spec, gamma, gammaCats, pi, init)
    if (!best || out.lnL > best.lnL) best = out
  }
  return best!
}

// 从给定初始 theta 做坐标优化（速率参数 + 分支长度 + α），返回拟合结果
function optimizeFrom(
  ctx: FitContext,
  spec: ModelSpec,
  gamma: boolean,
  gammaCats: number,
  pi: number[],
  theta: number[],
): FitOutcome {
  const { tree, pats } = ctx
  const classRate = gamma ? discreteGammaRates(gammaCats, 1.0) : [1]
  const eng = new TreeLikelihood(tree, pats, classRate)
  eng.setModel(pi, spec.buildRates(theta))

  // ---- 坐标优化：速率参数（对数空间）+ 分支长度 + α ----
  const RATE_LO = Math.log(0.02), RATE_HI = Math.log(100)
  const rounds = 3
  let alpha = gamma ? 1.0 : null
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < spec.rateParams; i++) {
      const idx = i
      const f = (lx: number): number => {
        const th = theta.slice()
        th[idx] = Math.exp(lx)
        return eng.setModel(pi, spec.buildRates(th))
      }
      const cur = Math.log(Math.max(1e-6, theta[idx]))
      const r = goldenMax(Math.max(RATE_LO, cur - 3), Math.min(RATE_HI, cur + 3), f, 16)
      theta[idx] = Math.exp(r.x)
      eng.setModel(pi, spec.buildRates(theta))
    }
    // 分支长度（每条分支黄金分割，路径局部重算）
    for (const v of tree.branches) {
      const t0 = tree.blen[v]
      const f = (t: number): number => eng.setBranch(v, t)
      const r = goldenMax(Math.max(1e-8, t0 * 0.1), Math.min(5, t0 * 10 + 0.05), f, 16)
      eng.setBranch(v, r.x)
    }
    if (gamma) {
      const f = (la: number): number => eng.setClassRates(discreteGammaRates(gammaCats, Math.exp(la)))
      const cur = Math.log(alpha!)
      const r = goldenMax(Math.max(Math.log(0.05), cur - 2), Math.min(Math.log(60), cur + 2), f, 14)
      alpha = Math.exp(r.x)
      eng.setClassRates(discreteGammaRates(gammaCats, alpha))
    }
  }
  const rates = spec.buildRates(theta)
  // 归一化速率用于报告（与 decomposeNuc 相同口径）
  let mu = 0
  for (let k = 0; k < 6; k++) mu += 2 * rates[k] * pi[RATE_PAIR[k][0]] * pi[RATE_PAIR[k][1]]
  const norm = mu > 1e-300 ? 1 / mu : 1
  return { lnL: eng.totalLnL(), theta, pi, rates: rates.map((x) => x * norm), alpha }
}

// ---------------------------------------------------------------------------
// 主入口：模型优化选择
// ---------------------------------------------------------------------------

export function modelTest(
  seqs: string[],
  names: string[],
  opts?: ModelTestOptions,
): ModelTestResult | null {
  const n = seqs.length
  if (n < 3) return null
  const criterion: ModelCriterion = opts?.criterion ?? 'BIC'
  const withGamma = opts?.withGamma !== false
  const gammaCats = opts?.gammaCats ?? 4

  const pats = compressPatterns(seqs)
  if (!pats.data.length) return null
  const tree = buildTreeForTest(seqs, names)
  if (!tree) return null

  const ctx: FitContext = {
    tree,
    pats,
    obsPi: observedFreq(pats),
    tiTvRatio: observeTiTv(pats),
  }

  // 拟合顺序：按复杂度升序（JC→GTR），+G 变体紧随其 base（热启动）
  interface Variant { spec: ModelSpec; gamma: boolean }
  const variants: { spec: ModelSpec; gamma: boolean }[] = []
  for (const spec of NT_MODEL_SPECS) {
    variants.push({ spec, gamma: false })
    if (withGamma) variants.push({ spec, gamma: true })
  }

  const fits: ModelFitResult[] = []
  const nBranches = tree.branches.length  // 2n-3
  for (const v of variants) {
    // 每个模型用自身语义化热启动 + 多起点（见 fitOne）
    const res = fitOne(ctx, v.spec, v.gamma, gammaCats)
    const modelDf = v.spec.modelDf + (v.gamma ? 1 : 0)
    const k = modelDf + nBranches
    const N = pats.nSites
    const aic = 2 * k - 2 * res.lnL
    const aicc = N - k - 1 > 0 ? aic + (2 * k * (k + 1)) / (N - k - 1) : aic
    const bic = k * Math.log(Math.max(1, N)) - 2 * res.lnL
    fits.push({
      model: v.spec.name + (v.gamma ? `+G${gammaCats}` : ''),
      base: v.spec.name,
      gamma: v.gamma,
      lnL: res.lnL,
      modelDf,
      k,
      aic,
      aicc,
      bic,
      delta: 0,
      weight: 0,
      pi: res.pi,
      rates: res.rates,
      alpha: res.alpha,
      blen: Array.from(tree.blen),
    })
  }

  // 排序 + 权重
  const score = (f: ModelFitResult) => (criterion === 'AIC' ? f.aic : criterion === 'AICc' ? f.aicc : f.bic)
  fits.sort((a, b) => score(a) - score(b))
  const min = score(fits[0])
  let wSum = 0
  for (const f of fits) {
    f.delta = score(f) - min
    f.weight = Math.exp(-f.delta / 2)
    wSum += f.weight
  }
  for (const f of fits) f.weight /= wSum

  return {
    fits,
    best: fits[0],
    criterion,
    nSeqs: n,
    nSites: pats.nSites,
    nPatterns: pats.data.length,
    treeNewick: tree.newick,
    fromEngine: false,
  }
}

// ---------------------------------------------------------------------------
// 序列模拟（测试 / 示例数据）：沿平衡二叉树按 P(t) 进化抽样
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface SimOptions {
  branchLen?: number      // 每条分支长度（期望替换数/位点），默认 0.1
  alpha?: number | null   // 位点异质性（离散 Gamma）；null/省略 = 无
  gammaCats?: number
  seed?: number
}

export function simulateNuc(
  nSeqs: number,
  L: number,
  pi: number[],
  rates: number[],   // [AC, AG, AT, CG, CT, GT]（任意尺度，内部归一化）
  opts?: SimOptions,
): { names: string[]; seqs: string[] } {
  const rng = mulberry32(opts?.seed ?? 42)
  const branchLen = opts?.branchLen ?? 0.1
  const eig = decomposeNuc(pi, rates)
  const alpha = opts?.alpha ?? null
  const K = alpha ? opts?.gammaCats ?? 4 : 1
  const classRates = alpha ? discreteGammaRates(K, alpha) : [1]

  // 满二叉树（叶按 DFS 顺序映射序列）
  interface SimNode { kids: number[] }  // kid = -1 表示叶占位
  const nodes: SimNode[] = []
  const mk = (): number => { nodes.push({ kids: [] }); return nodes.length - 1 }
  const grow = (nLeaves: number): number => {
    const id = mk()
    if (nLeaves <= 2) {
      nodes[id].kids = nLeaves === 2 ? [-1, -1] : [-1]
      return id
    }
    const half = Math.ceil(nLeaves / 2)
    nodes[id].kids = [grow(half), grow(nLeaves - half)]
    return id
  }
  const rootSim = grow(nSeqs)

  const seqs: string[] = Array.from({ length: nSeqs }, () => '')
  let leafCounter = 0
  const pm = new Float64Array(16)
  // 离散 Gamma：每个位点一个速率，沿整棵树恒定（标准 Γ 模型假设）
  const siteRates = new Float64Array(L)
  for (let k = 0; k < L; k++) siteRates[k] = classRates[Math.floor(rng() * K)]

  const dfs = (node: number, parentStates: Int32Array): void => {
    for (const kid of nodes[node].kids) {
      const childStates = new Int32Array(L)
      for (let k = 0; k < L; k++) {
        const t = branchLen * siteRates[k]
        nucPMatrix(eig, t, pm)
        const row = parentStates[k] * 4
        const u = rng()
        let acc = 0, st = 3
        for (let j = 0; j < 4; j++) {
          acc += pm[row + j]
          if (u < acc) { st = j; break }
        }
        childStates[k] = st
      }
      if (kid === -1) {
        const seqIdx = leafCounter++
        seqs[seqIdx] = Array.from(childStates, (s) => CHARS[s]).join('')
      } else {
        dfs(kid, childStates)
      }
    }
  }

  // 根状态 ~ π
  const rootStates = new Int32Array(L)
  for (let k = 0; k < L; k++) {
    const u = rng()
    let acc = 0, st = 3
    for (let i = 0; i < 4; i++) { acc += pi[i]; if (u < acc) { st = i; break } }
    rootStates[k] = st
  }
  dfs(rootSim, rootStates)

  const names = Array.from({ length: nSeqs }, (_, i) => `sim_${i + 1}`)
  return { names, seqs }
}
