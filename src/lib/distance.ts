// 替换模型下的两两进化距离矩阵（Built-in 引擎）。
// 支持核酸 10 种模型（p-distance / JC69 / K80 / TN93 / T92 / LogDet / MCL /
// F84 / HKY85 / GTR）与氨基酸 7 种模型（p-distance / Poisson / Equal /
// Dayhoff / JTT / LG / WAG），并提供 Gap 处理（complete / pairwise）、位点间
// 速率离散 Gamma 校正（Yang 1994，K=2/4/8 可选）与不变位点 (+I) 校正。
// 比对后序列应对齐（等长）；gap / 歧义位点按模式处理。

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

// 核酸替换模型（10 种）
export type NucSubstModel =
  | 'pdist' | 'jc69' | 'k80' | 'tn93' | 't92' | 'logdet' | 'mcl'
  | 'f84' | 'hky' | 'gtr'
// 氨基酸替换模型（7 种）
export type AASubstModel =
  | 'pdist' | 'poisson' | 'equal' | 'dayhoff' | 'jtt' | 'lg' | 'wag'
export type SubstModel = NucSubstModel | AASubstModel

// 位点间速率离散 (Yang 1994) 与不变位点 (Lewis 2001)
export interface DistOptions {
  gammaAlpha?: number          // 离散 Gamma 形状参数；<=0 或省略表示不校正
  gammaCats?: number           // 离散 Gamma 类别数（2/4/8/16），默认 4
  pinvEnabled?: boolean        // 是否启用 +I 校正
  pinv?: number                // 不变位点比例（0..0.5），默认 0.1
  gapMode?: 'complete' | 'pairwise'  // complete=全局跳过含 gap 的列；pairwise=按对忽略
}

export type GammaCats = 2 | 4 | 8 | 16

export function isAA(m: SubstModel): boolean {
  return m === 'poisson' || m === 'equal' || m === 'dayhoff' ||
         m === 'jtt' || m === 'lg' || m === 'wag'
}

export function defaultOptions(opts?: DistOptions): Required<Omit<DistOptions, 'pinvEnabled' | 'pinv'>> & { pinvEnabled: boolean; pinv: number } {
  return {
    gammaAlpha: opts?.gammaAlpha && opts.gammaAlpha > 0 ? opts.gammaAlpha : 0,
    gammaCats: opts?.gammaCats && [2, 4, 8, 16].includes(opts.gammaCats) ? opts.gammaCats : 4,
    pinvEnabled: !!opts?.pinvEnabled,
    pinv: opts?.pinv && opts.pinv > 0 && opts.pinv < 1 ? opts.pinv : 0.1,
    gapMode: opts?.gapMode ?? 'complete',
  }
}

// 仅由 ACGTUN.- 组成 -> 核酸；否则视为氨基酸
export function detectSeqType(seqs: string[]): 'nt' | 'aa' {
  for (const s of seqs) {
    if (s && !/^[ACGTUN.+-]+$/i.test(s)) return 'aa'
  }
  return 'nt'
}

const AA_ORDER = ['A','R','N','D','C','Q','E','G','H','I','L','K','M','F','P','S','T','W','Y','V']
const AA_INDEX: Record<string, number> = Object.fromEntries(AA_ORDER.map((a, i) => [a, i]))

import { AA_MATRICES } from './matrices'
import { discreteGammaCorrect, invariableCorrectP, invariableCorrectD, applyGammaApprox } from './dist/gamma'
import { decomposeHKY, estimateKappa, empiricalNucFreq, hkyPairDistance, f84PairDistance, HKYEigen } from './dist/hky'
import { decomposeGTR, estimateGTRRates, gtrPairDistance, GTREigen } from './dist/gtr'
import { decomposeAA, aaEigenPairDistance } from './dist/aa-eigen'

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

// complete 模式：返回列级 mask（任意序列含 gap / 歧义则为 true）。
// 注意：'N' 在核酸里是歧义码，但在氨基酸里是天冬酰胺（Asn），不可当作 gap 屏蔽。
function globalGapMask(seqs: string[], aa: boolean): boolean[] {
  const L = seqs.reduce((m, s) => Math.max(m, s.length), 0)
  const mask = new Array(L).fill(false)
  for (const s of seqs) {
    for (let k = 0; k < s.length; k++) {
      const c = s[k]
      if (c === '-' || c === '.' || !c) { mask[k] = true; continue }
      if (aa) {
        // 氨基酸歧义/终止码：X B Z * ?（N 是正常残基，保留）
        if (c === 'X' || c === 'B' || c === 'Z' || c === '*' || c === '?') mask[k] = true
      } else {
        // 核酸歧义码：N 等
        if (c === 'N' || c === 'X') mask[k] = true
      }
    }
  }
  return mask
}

export function distanceMatrix(
  seqs: string[],
  model: SubstModel,
  opts?: DistOptions,
): number[][] {
  const o = defaultOptions(opts)
  const aa = isAA(model)
  const mask = o.gapMode === 'complete' ? globalGapMask(seqs, aa) : null
  if (aa) return aaDistanceMatrix(seqs, model as AASubstModel, o, mask)
  return nucDistanceMatrix(seqs, model as NucSubstModel, o, mask)
}

// ---------------------------------------------------------------------------
// 核酸距离
// ---------------------------------------------------------------------------

function nucDistanceMatrix(seqs: string[], model: NucSubstModel, o: Required<Omit<DistOptions, 'pinvEnabled' | 'pinv'>> & { pinvEnabled: boolean; pinv: number }, mask: boolean[] | null): number[][] {
  // HKY / GTR 走 eigen 分解路径（每对序列单独算）
  if (model === 'hky' || model === 'gtr') {
    const pi = empiricalNucFreq(seqs)
    let eig: HKYEigen | GTREigen
    if (model === 'hky') {
      const kappa = estimateKappa(seqs, pi, mask)
      eig = decomposeHKY(pi, kappa)
    } else {
      const rates = estimateGTRRates(seqs, pi, mask)
      eig = decomposeGTR(pi, rates)
    }
    const n = seqs.length
    const D: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let d = model === 'hky'
          ? hkyPairDistance(seqs, i, j, eig as HKYEigen, mask)
          : gtrPairDistance(seqs, i, j, eig as GTREigen, mask)
        // +I 校正
        if (o.pinvEnabled) d = invariableCorrectD(d, o.pinv)
        // 离散 Gamma 校正（用 applyGammaApprox 作为 v0.5 旧路径；新 K-class 路径只对接 JC69/K80/TN93 等闭式模型）
        if (o.gammaAlpha > 0) d = applyGammaApprox(d, o.gammaAlpha)
        D[i][j] = D[j][i] = d > 0 ? d : 0
      }
    }
    return D
  }
  const n = seqs.length
  const D: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = nucPairDistance(seqs[i], seqs[j], model, o, mask)
      D[i][j] = D[j][i] = d
    }
  }
  return D
}

// 计算一对核酸序列的距离（含 gamma 校正）
function nucPairDistance(a: string, b: string, model: NucSubstModel, o: Required<Omit<DistOptions, 'pinvEnabled' | 'pinv'>> & { pinvEnabled: boolean; pinv: number }, mask: boolean[] | null): number {
  const L = Math.min(a.length, b.length)
  let tsPur = 0, tsPyr = 0, tvRP = 0, tvPR = 0, eff = 0   // 四类替换计数
  let pA = 0, pG = 0, pC = 0, pT = 0   // 该对估算的碱基频率
  const skip = (x: string, y: string) =>
    x === '-' || y === '-' || x === '.' || y === '.' || x === 'N' || y === 'N' || !x || !y

  for (let k = 0; k < L; k++) {
    let x = a[k].toUpperCase(), y = b[k].toUpperCase()
    if (x === 'U') x = 'T'
    if (y === 'U') y = 'T'
    if (mask ? mask[k] : skip(x, y)) continue
    eff++
    if (x === 'A') pA++; else if (x === 'G') pG++; else if (x === 'C') pC++; else if (x === 'T') pT++
    if (y === 'A') pA++; else if (y === 'G') pG++; else if (y === 'C') pC++; else if (y === 'T') pT++
    if (x !== y) {
      const xa = isPurine(x), xc = isPyrimidine(x)
      const ya = isPurine(y), yc = isPyrimidine(y)
      if (xa && ya) tsPur++            // 嘌呤间转换 A<->G
      else if (xc && yc) tsPyr++       // 嘧啶间转换 C<->T
      else if (xa && yc) tvRP++        // 嘌呤 -> 嘧啶 颠换
      else tvPR++                      // 嘧啶 -> 嘌呤 颠换
    }
  }
  if (eff === 0) return 0
  const pinv = o.pinvEnabled ? o.pinv : 0
  // LogDet（paralinear）直接使用成对联合频率矩阵估计，不依赖 p/q 分解
  if (model === 'logdet') {
    let d = paralinearLogdet(a, b, mask)
    if (o.gammaAlpha > 0) d = applyGammaApprox(d, o.gammaAlpha)
    if (pinv > 0) d = invariableCorrectD(d, pinv)
    return d > 0 ? d : 0
  }
  const pA_f = pA / (2 * eff), pG_f = pG / (2 * eff), pC_f = pC / (2 * eff), pT_f = pT / (2 * eff)
  // TN93 / MCL / F84 需要四类替换比例
  if (model === 'tn93' || model === 'mcl' || model === 'f84') {
    const P1 = tsPur / eff, P2 = tsPyr / eff, Q1 = tvRP / eff, Q2 = tvPR / eff
    let d = tnDistance(P1, P2, Q1, Q2, pA_f, pG_f, pC_f, pT_f)
    if (pinv > 0) d = invariableCorrectD(d, pinv)
    if (o.gammaAlpha > 0) d = applyGammaApprox(d, o.gammaAlpha)
    return d > 0 ? d : 0
  }
  const p = (tsPur + tsPyr) / eff
  const q = (tvRP + tvPR) / eff
  // +I：先把 p 缩放到"可变位点的差异比例"
  const pCorr = pinv > 0 ? invariableCorrectP(p, pinv) : p
  let d: number
  if (o.gammaAlpha > 0 && o.gammaCats > 1) {
    // 离散 Gamma：按 rate_k 缩放 p，调 rawNucDistance 求 K 个距离，平均
    d = discreteGammaCorrect(pCorr, o.gammaAlpha, o.gammaCats, (p) =>
      rawNucDistance(model, p, q, pA_f, pG_f, pC_f, pT_f))
  } else {
    d = rawNucDistance(model, pCorr, q, pA_f, pG_f, pC_f, pT_f)
    if (o.gammaAlpha > 0) d = applyGammaApprox(d, o.gammaAlpha)
  }
  return d > 0 ? d : 0
}

function isPurine(c: string): boolean { return c === 'A' || c === 'G' }
function isPyrimidine(c: string): boolean { return c === 'C' || c === 'T' }

// Tamura-Nei 1993 / Maximum Composite Likelihood (Tamura-Nei 2004) 距离。
// P1,P2 = 嘌呤/嘧啶转换比例；Q1 = 嘌呤->嘧啶颠换比例；Q2 = 嘧啶->嘌呤颠换比例
// a,g,c,t = 经验碱基频率。MCL 在成对距离上退化为 TN93（组合似然在三元组平均时生效）。
function tnDistance(P1: number, P2: number, Q1: number, Q2: number, a: number, g: number, c: number, t: number): number {
  const b = a + g, d = c + t
  if (b <= 0 || d <= 0) return rawNucDistance('k80', P1 + P2, Q1 + Q2, a, g, c, t)
  const A1 = Math.max(1e-12, 1 - 2 * P1 - Q1)
  const A2 = Math.max(1e-12, 1 - 2 * P2 - Q2)
  const B1 = Math.max(1e-12, 1 - 2 * P1 - (b / d) * Q2)
  const B2 = Math.max(1e-12, 1 - 2 * P2 - (d / b) * Q1)
  return -b * Math.log(A1) - d * Math.log(A2) + g * Math.log(B1) + t * Math.log(B2)
}

// 各核酸模型的无校正距离
function rawNucDistance(
  model: NucSubstModel, p: number, q: number,
  pA: number, pG: number, pC: number, pT: number,
): number {
  switch (model) {
    case 'pdist':
      return p + q
    case 'jc69': {
      const t = Math.max(1e-12, 1 - (4 / 3) * (p + q))
      return -0.75 * Math.log(t)
    }
    case 'k80': {
      const t1 = Math.max(1e-12, 1 - 2 * p - q)
      const t2 = Math.max(1e-12, 1 - 2 * q)
      return -0.5 * Math.log(t1) - 0.25 * Math.log(t2)
    }
    case 'tn93': {
      // Tamura-Nei 1993：区分嘌呤/嘧啶转换与两类颠换，使用经验碱基频率
      const ag = pA + pG, ct = pC + pT
      if (ag <= 0 || ct <= 0) return rawNucDistance('k80', p, q, pA, pG, pC, pT)
      const P1 = pA * pG / ag   // A<->G 转换比例
      const P2 = pC * pT / ct   // C<->T 转换比例
      const Q1 = (pA * pT + pG * pC) / ag   // 嘌呤->嘧啶 颠换
      const Q2 = (pC * pG + pT * pA) / ct   // 嘧啶->嘌呤 颠换
      const a1 = Math.max(1e-12, 1 - 2 * P1 - Q1)
      const a2 = Math.max(1e-12, 1 - 2 * P2 - Q2)
      const b1 = Math.max(1e-12, 1 - 2 * P1 - (ag / ct) * Q2)
      const b2 = Math.max(1e-12, 1 - 2 * P2 - (ct / ag) * Q1)
      return -ag * Math.log(a1) - ct * Math.log(a2) + pG * Math.log(b1) + pT * Math.log(b2)
    }
    case 't92': {
      // Tamura 1992：基于 GC 含量的校正
      const gc = pG + pC
      if (gc <= 0 || gc >= 1) return rawNucDistance('k80', p, q, pA, pG, pC, pT)
      const pq = p + q
      const t = Math.max(1e-12, 1 - pq / (2 * gc * (1 - gc)))
      return -2 * gc * (1 - gc) * Math.log(t)
    }
    default:
      return p + q
  }
}

function isTransition(a: string, b: string): boolean {
  const pur = new Set(['A', 'G'])
  const pyr = new Set(['C', 'T'])
  return (pur.has(a) && pur.has(b)) || (pyr.has(a) && pyr.has(b))
}

// ---------------------------------------------------------------------------
// 氨基酸距离
// ---------------------------------------------------------------------------

// 旧版离散 Gamma 近似（系数法）已迁移至 src/lib/dist/gamma.ts 的 applyGammaApprox。

function aaDistanceMatrix(seqs: string[], model: AASubstModel, o: Required<Omit<DistOptions, 'pinvEnabled' | 'pinv'>> & { pinvEnabled: boolean; pinv: number }, mask: boolean[] | null): number[][] {
  // 对 4 个经验矩阵走 eigen 路径（v0.5 提升项）
  if (model === 'dayhoff' || model === 'jtt' || model === 'lg' || model === 'wag') {
    const mat = AA_MATRICES[model]
    if (!mat) {
      // 回退到 composition-corrected Poisson
      return aaDistanceMatrixFallback(seqs, model, o, mask)
    }
    const eig = decomposeAA(mat, model)
    const n = seqs.length
    const D: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
    const pinv = o.pinvEnabled ? o.pinv : 0
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let d = aaEigenPairDistance(seqs, i, j, eig, mask)
        if (pinv > 0) d = invariableCorrectD(d, pinv)
        if (o.gammaAlpha > 0) d = applyGammaApprox(d, o.gammaAlpha)
        D[i][j] = D[j][i] = d > 0 ? d : 0
      }
    }
    return D
  }
  return aaDistanceMatrixFallback(seqs, model, o, mask)
}

// p-distance / Poisson / Equal 等简单模型的回退路径（用 per-pair p，再调 rawAADistance）
function aaDistanceMatrixFallback(seqs: string[], model: AASubstModel, o: Required<Omit<DistOptions, 'pinvEnabled' | 'pinv'>> & { pinvEnabled: boolean; pinv: number }, mask: boolean[] | null): number[][] {
  const n = seqs.length
  const D: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = aaPairDistanceFallback(seqs[i], seqs[j], model, o, mask)
      D[i][j] = D[j][i] = d
    }
  }
  return D
}

function aaPairDistanceFallback(a: string, b: string, model: AASubstModel, o: Required<Omit<DistOptions, 'pinvEnabled' | 'pinv'>> & { pinvEnabled: boolean; pinv: number }, mask: boolean[] | null): number {
  const L = Math.min(a.length, b.length)
  let diff = 0, eff = 0
  const skip = (x: string, y: string) =>
    x === '-' || y === '-' || x === '.' || y === '.' || x === 'X' || y === 'X' || !x || !y

  for (let k = 0; k < L; k++) {
    const x = a[k].toUpperCase(), y = b[k].toUpperCase()
    if (mask ? mask[k] : skip(x, y)) continue
    const ix = AA_INDEX[x], iy = AA_INDEX[y]
    if (ix === undefined || iy === undefined) continue
    eff++
    if (x !== y) diff++
  }
  if (eff === 0) return 0
  const pinv = o.pinvEnabled ? o.pinv : 0
  const pCorr = pinv > 0 ? invariableCorrectP(diff / eff, pinv) : diff / eff
  let d = rawAADistance(model, pCorr)
  if (o.gammaAlpha > 0) d = applyGammaApprox(d, o.gammaAlpha)
  return d > 0 ? d : 0
}

function rawAADistance(model: AASubstModel, p: number): number {
  switch (model) {
    case 'pdist':
      return p
    case 'poisson':
      return -Math.log(Math.max(1e-12, 1 - p))
    case 'equal':
      // Equal Input (Felsenstein 1981): d = -(19/20) ln(1 - (20/19)p)
      return -(19 / 20) * Math.log(Math.max(1e-12, 1 - (20 / 19) * p))
    case 'dayhoff':
    case 'jtt':
    case 'lg':
    case 'wag': {
      // v0.5：使用真实发表的平衡频率向量做组成校正（Poisson 修正），
      // 避免单纯 p-distance 的氨基酸组成偏差；完整速率矩阵距离（特征分解）后续补充。
      const m = AA_MATRICES[model]
      const pi = m ? m.PI : null
      if (!pi) return -Math.log(Math.max(1e-12, 1 - p))
      const sumSq = pi.reduce((s, v) => s + v * v, 0)
      const pe = p / Math.max(1e-12, 1 - sumSq)   // 组成校正后的有效差异比例
      return -Math.log(Math.max(1e-12, 1 - Math.min(pe, 0.9999)))
    }
  }
}

// 4×4 行列式（高斯消元）
function det4(m: number[][]): number {
  const a = m.map((r) => r.slice())
  let det = 1
  for (let c = 0; c < 4; c++) {
    let pivot = c
    for (let r = c + 1; r < 4; r++) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r
    if (Math.abs(a[pivot][c]) < 1e-12) return 0
    if (pivot !== c) {
      const tmp = a[pivot]; a[pivot] = a[c]; a[c] = tmp
      det = -det
    }
    det *= a[c][c]
    for (let r = c + 1; r < 4; r++) {
      const f = a[r][c] / a[c][c]
      for (let k = c; k < 4; k++) a[r][k] -= f * a[c][k]
    }
  }
  return det
}

// LogDet（paralinear）距离：适用于碱基组成差异大、进化距离较远的序列。
// d = -(1/L) ln( det(M) / sqrt(Π p_i · Π q_j) )，M 为联合碱基频率矩阵。
function paralinearLogdet(a: string, b: string, mask: boolean[] | null): number {
  const idx: Record<string, number> = { A: 0, G: 1, C: 2, T: 3 }
  const M: number[][] = Array.from({ length: 4 }, () => new Array(4).fill(0))
  const L = Math.min(a.length, b.length)
  let used = 0
  for (let k = 0; k < L; k++) {
    const x = a[k].toUpperCase(), y = b[k].toUpperCase()
    if (x === 'U') { /* handled below */ }
    const xu = x === 'U' ? 'T' : x
    const yu = y === 'U' ? 'T' : y
    if (mask && mask[k]) continue
    if (!(xu in idx) || !(yu in idx)) continue
    M[idx[xu]][idx[yu]] += 1
    used++
  }
  if (used === 0) return 0
  const p: number[] = []
  const q: number[] = []
  for (let i = 0; i < 4; i++) {
    p[i] = M[i].reduce((s, v) => s + v, 0) / used
    q[i] = M.reduce((s, row) => s + row[i], 0) / used
  }
  const det = det4(M.map((r) => r.map((v) => v / used)))
  let prod = 1
  for (let i = 0; i < 4; i++) prod *= p[i] * q[i]
  const ratio = det / Math.sqrt(prod)
  const d = -Math.log(Math.max(1e-12, ratio)) / used
  return d > 0 ? d : 0
}
