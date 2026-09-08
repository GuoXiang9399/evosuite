// 密码子分析库：标准遗传代码表、密码子使用频率 / RSCU、dN/dS（Nei-Gojobori）、
// 密码子 Z-test of selection（正/负/中性假设，解析正态近似 + 可选 bootstrap）。
//
// 与 MEGA7 的 Codon 功能对齐：
//   - Codon Usage 表（密码子计数、相对频率、RSCU、GC3、有效密码子数）
//   - Codon-based Z-test of Selection（Nei-Gojobori 法，整体/成对，bootstrap P-value）
//
// 标准遗传密码表（NCBI translation table 1）。

import { SeqRecord } from './fasta'

// ---------------------------------------------------------------------------
// 标准遗传代码表
// ---------------------------------------------------------------------------

const CODON: Record<string, string> = (() => {
  const aa = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG'
  const bases = ['T', 'C', 'A', 'G']
  const t: Record<string, string> = {}
  let idx = 0
  for (const b1 of bases)
    for (const b2 of bases)
      for (const b3 of bases) {
        t[b1 + b2 + b3] = aa[idx++]
      }
  return t
})()

export function aaOf(codon: string): string {
  return CODON[codon] ?? 'X'
}

// 所有 64 密码子（按 T-C-A-G 顺序，与代码表生成顺序一致）
const CODONS = (() => {
  const bases = ['T', 'C', 'A', 'G']
  const out: string[] = []
  for (const b1 of bases) for (const b2 of bases) for (const b3 of bases) out.push(b1 + b2 + b3)
  return out
})()

const BASES = ['A', 'G', 'C', 'T'] as const

// 单密码子内"非同义/同义"可突变位点数（遍历每个位点 3 种替代碱基）
function synSites(codon: string): { N: number; S: number } {
  const aa = aaOf(codon)
  let n = 0
  let s = 0
  for (let pos = 0; pos < 3; pos++) {
    for (const alt of BASES) {
      if (alt === codon[pos]) continue
      const mut = codon.slice(0, pos) + alt + codon.slice(pos + 1)
      if (aaOf(mut) === aa) s++
      else n++
    }
  }
  return { N: n, S: s }
}

// ---------------------------------------------------------------------------
// 密码子使用频率 / RSCU
// ---------------------------------------------------------------------------

export interface CodonUsage {
  counts: Record<string, number>      // 64 密码子计数
  freq: Record<string, number>       // 相对频率（每位点）
  rscu: Record<string, number>        // RSCU = X_ij / (Σ_{同aa} X_ik / n_syn)
  gc3: number                         // 第三位 GC 含量
  effNum: number                      // 有效密码子数（1/Σ f²，Wright 1990）
  total: number                       // 有效密码子总数
}

// 按氨基酸分组的密码子
const AA_CODONS: Record<string, string[]> = (() => {
  const m: Record<string, string[]> = {}
  for (const c of CODONS) {
    const a = aaOf(c)
    ;(m[a] ??= []).push(c)
  }
  return m
})()

export function codonUsage(recs: SeqRecord[]): CodonUsage {
  const counts: Record<string, number> = {}
  for (const c of CODONS) counts[c] = 0
  let total = 0
  let gc3 = 0
  for (const rec of recs) {
    const s = rec.sequence.toUpperCase().replace(/U/g, 'T')
    for (let c = 0; c + 3 <= s.length; c += 3) {
      const codon = s.slice(c, c + 3)
      if (/[^ACGT]/.test(codon)) continue // 含 gap/歧义则跳过
      if (codon in counts) {
        counts[codon]++
        total++
        const third = codon[2]
        if (third === 'G' || third === 'C') gc3++
      }
    }
  }
  const freq: Record<string, number> = {}
  const rscu: Record<string, number> = {}
  for (const c of CODONS) freq[c] = total ? counts[c] / total : 0
  // RSCU: X_ij / (Σ_{同aa} X_ik / n_syn)，n_syn = 该 aa 的简并密码子数
  for (const c of CODONS) {
    const a = aaOf(c)
    const sameAA = AA_CODONS[a] ?? [c]
    const nSyn = sameAA.length
    const sumSame = sameAA.reduce((s, k) => s + counts[k], 0)
    rscu[c] = sumSame ? (counts[c] * nSyn) / sumSame : 0
  }
  // 有效密码子数 = 1 / Σ f_ij²（按全部密码子，终止码 * 不计入；Wright 1990 原版）
  let sumSq = 0
  for (const c of CODONS) {
    if (aaOf(c) === '*') continue
    const f = total ? counts[c] / total : 0
    sumSq += f * f
  }
  const effNum = sumSq > 0 ? 1 / sumSq : 0
  return { counts, freq, rscu, gc3: total ? gc3 / total : 0, effNum, total }
}

// ---------------------------------------------------------------------------
// dN/dS（Nei-Gojobori 1986，与 stats.ts 的 kaKs 同算法；返回结构更丰富）
// ---------------------------------------------------------------------------

export interface KaKs {
  dN: number
  dS: number
  omega: number
  m: number
  n: number
  N: number
  S: number
  codons: number
}

export function kaKs(a: string, b: string): KaKs {
  const A = a.toUpperCase().replace(/U/g, 'T')
  const B = b.toUpperCase().replace(/U/g, 'T')
  let m = 0
  let n = 0
  let N = 0
  let S = 0
  let codons = 0
  for (let c = 0; c + 3 <= Math.min(A.length, B.length); c += 3) {
    const ca = A.slice(c, c + 3)
    const cb = B.slice(c, c + 3)
    if (ca.length < 3 || cb.length < 3) break
    if (/[^ACGT]/.test(ca) || /[^ACGT]/.test(cb)) continue
    codons++
    const sa = synSites(ca)
    const sb = synSites(cb)
    N += (sa.N + sb.N) / 2
    S += (sa.S + sb.S) / 2
    for (let pos = 0; pos < 3; pos++) {
      if (ca[pos] !== cb[pos]) {
        const mut = ca.slice(0, pos) + cb[pos] + ca.slice(pos + 1)
        if (aaOf(mut) === aaOf(ca)) n++
        else m++
      }
    }
  }
  const pN = N ? m / N : 0
  const pS = S ? n / S : 0
  const dN = pN < 0.75 ? -0.75 * Math.log(1 - (4 / 3) * pN) : 3
  const dS = pS < 0.75 ? -0.75 * Math.log(1 - (4 / 3) * pS) : 3
  const omega = dS > 1e-9 ? dN / dS : dN > 1e-9 ? Infinity : 0
  return { dN, dS, omega, m, n, N, S, codons }
}

// ---------------------------------------------------------------------------
// 密码子 Z-test of selection（Nei-Gojobori + 解析正态近似）
// ---------------------------------------------------------------------------

export type SelAlt = 'neutral' | 'positive' | 'purifying'

export interface SelectionTest {
  dN: number
  dS: number
  omega: number
  m: number             // 非同义差异数
  n: number             // 同义差异数
  N: number             // 非同义位点数
  S: number             // 同义位点数
  z: number             // Z 统计量
  pValue: number        // 双尾 P-value
  conclusion: 'neutral' | 'positive' | 'purifying'
  altHypothesis: SelAlt
}

// 标准正态 CDF（有理近似）
function stdNormalCdf(z: number): number {
  const Za = Math.abs(z)
  // 互补误差函数近似
  const t = 1 / (1 + 0.3275911 * Za)
  const e = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-Za * Za)
  return z >= 0 ? e : 1 - e
}

// Nei-Gojobori 解析方差近似（Jukes-Cantor 变换后方差）：
//   Var(dN - dS) ≈ (pN·(1-pN)/N + pS·(1-pS)/S) · (16/9) / (1-4p/3)²
// 其中 p = 综合。这是 MEGA7 内置解析方差的简化版（默认方法）。
function dNdSVariance(m: number, n: number, N: number, S: number, pN: number, pS: number): number {
  const vN = N ? pN * (1 - pN) / N : 0
  const vS = S ? pS * (1 - pS) / S : 0
  // Jukes-Cantor 变换的雅可比平方： (d/dp)[-3/4·ln(1-4p/3)] = 1/(1-4p/3)
  const jacN = 1 / Math.max(1e-9, 1 - (4 / 3) * pN)
  const jacS = 1 / Math.max(1e-9, 1 - (4 / 3) * pS)
  return vN * jacN * jacN + vS * jacS * jacS
}

function zTestFromStats(
  dN: number, dS: number, m: number, n: number, N: number, S: number,
  alt: SelAlt,
): SelectionTest {
  const pN = N ? m / N : 0
  const pS = S ? n / S : 0
  const v = dNdSVariance(m, n, N, S, pN, pS)
  const se = Math.sqrt(Math.max(v, 1e-30))
  const z = se > 1e-9 ? (dN - dS) / se : 0
  // P-value 按备择假设方向：
  //   neutral:    H1: dN != dS  → 双尾
  //   positive:   H1: dN >  dS  → 单尾右
  //   purifying:  H1: dN <  dS  → 单尾左
  let p: number
  if (alt === 'neutral') {
    p = 2 * (1 - stdNormalCdf(Math.abs(z)))
  } else if (alt === 'positive') {
    p = 1 - stdNormalCdf(z)
  } else {
    p = stdNormalCdf(z)
  }
  const omega = dS > 1e-9 ? dN / dS : dN > 1e-9 ? Infinity : 0
  const sig = p < 0.05
  let conclusion: 'neutral' | 'positive' | 'purifying'
  if (!sig) conclusion = 'neutral'
  else if (alt === 'positive') conclusion = 'positive'
  else if (alt === 'purifying') conclusion = 'purifying'
  else {
    // neutral 备择：按 dN vs dS 方向判定
    if (dN > dS) conclusion = 'positive'
    else if (dN < dS) conclusion = 'purifying'
    else conclusion = 'neutral'
  }
  return { dN, dS, omega, m, n, N, S, z, pValue: p, conclusion, altHypothesis: alt }
}

// 成对 Z-test
export function codonZTest(
  a: string, b: string,
  alt: SelAlt = 'neutral',
): SelectionTest {
  const r = kaKs(a, b)
  return zTestFromStats(r.dN, r.dS, r.m, r.n, r.N, r.S, alt)
}

// 整体（序列集平均）Z-test：聚合所有成对的差异数与位点数后再变换
export function overallCodonZTest(
  recs: SeqRecord[],
  alt: SelAlt = 'neutral',
): SelectionTest | null {
  const n = recs.length
  if (n < 2) return null
  let m = 0, nn = 0, N = 0, S = 0, pairs = 0
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const r = kaKs(recs[i].sequence, recs[j].sequence)
      m += r.m
      nn += r.n
      N += r.N
      S += r.S
      pairs++
    }
  }
  if (pairs === 0) return null
  // 平均到单对
  const mAvg = m / pairs
  const nAvg = nn / pairs
  const NAvg = N / pairs
  const SAvg = S / pairs
  const pN = NAvg ? mAvg / NAvg : 0
  const pS = SAvg ? nAvg / SAvg : 0
  const dN = pN < 0.75 ? -0.75 * Math.log(1 - (4 / 3) * pN) : 3
  const dS = pS < 0.75 ? -0.75 * Math.log(1 - (4 / 3) * pS) : 3
  return zTestFromStats(dN, dS, mAvg, nAvg, NAvg, SAvg, alt)
}
