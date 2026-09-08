// 序列统计内核：碱基组成、转换/颠换、多样性（π/Tajima's D/Hd/θw）、选择压力。
// Ka/Ks 与密码子分析已迁移到 codon.ts（本文件 re-export 保持向后兼容）。
import { SeqRecord } from './fasta'
import { kaKs as _kaKs, KaKs } from './codon'

// 向后兼容：kaKs 与 KaKs 类型从 codon.ts 再导出
export { _kaKs as kaKs }
export type { KaKs }

const BASES = ['A', 'G', 'C', 'T'] as const

export interface Composition {
  name: string
  length: number
  gaps: number
  counts: Record<string, number>
  freq: Record<string, number>
  gc: number
  at: number
}

// 每条序列的碱基组成（忽略 gap 与歧义位点）
export function composition(recs: SeqRecord[]): Composition[] {
  return recs.map((r) => {
    const counts: Record<string, number> = { A: 0, G: 0, C: 0, T: 0 }
    let gaps = 0
    for (const ch of r.sequence) {
      const c = ch === 'U' ? 'T' : ch
      if (c === '-' || c === '.' || c === 'N') {
        if (c === '-' || c === '.') gaps++
        continue
      }
      if (c in counts) counts[c]++
    }
    const sum = counts.A + counts.G + counts.C + counts.T
    const freq: Record<string, number> = {}
    BASES.forEach((b) => (freq[b] = sum ? counts[b] / sum : 0))
    return {
      name: r.name,
      length: r.sequence.length,
      gaps,
      counts,
      freq,
      gc: sum ? (counts.G + counts.C) / sum : 0,
      at: sum ? (counts.A + counts.T) / sum : 0,
    }
  })
}

export interface TiTv {
  i: number
  j: number
  ti: number
  tv: number
  ratio: number // 转换/颠换比（Tv=0 时无定义）
  p: number // 差异位点比例
}

// 两两转换/颠换统计
export function pairwiseTiTv(recs: SeqRecord[]): TiTv[] {
  const pur = new Set(['A', 'G'])
  const pyr = new Set(['C', 'T'])
  const out: TiTv[] = []
  for (let i = 0; i < recs.length; i++) {
    for (let j = i + 1; j < recs.length; j++) {
      const a = recs[i].sequence
      const b = recs[j].sequence
      let ti = 0
      let tv = 0
      let eff = 0
      for (let k = 0; k < Math.min(a.length, b.length); k++) {
        let x = a[k]
        let y = b[k]
        if (x === 'U') x = 'T'
        if (y === 'U') y = 'T'
        if (!'ACGT'.includes(x) || !'ACGT'.includes(y)) continue
        eff++
        if (x !== y) {
          if ((pur.has(x) && pur.has(y)) || (pyr.has(x) && pyr.has(y))) ti++
          else tv++
        }
      }
      out.push({
        i,
        j,
        ti,
        tv,
        ratio: tv ? ti / tv : ti ? Infinity : 0,
        p: eff ? (ti + tv) / eff : 0,
      })
    }
  }
  return out
}

// ===== 多样性估计器：π / θw / Tajima's D / 单倍型多样性 Hd =====
// 与 MEGA7 的 Diversity 模块对齐。

export interface Diversity {
  n: number                 // 序列数
  L: number                 // 有效位点数（complete 模式跳过全 gap/N 列）
  S: number                 // 分离位点数（segregating sites）
  eta: number               // 总突变数（所有位点差异事件总数）
  pi: number                // 核酸多样性 π（平均成对差异/位点）
  thetaW: number            // Watterson θw = S / a_n（每位点）
  k: number                 // 平均成对核苷酸差异数（总，非每位点）
  tajimaD: number           // Tajima's D
  tajimaPval: number        // Tajima's D 双尾 P-value（近似正态）
  tajimaD2: number          // Tajima's D 方差（Var(d)，Tajima 1989）
  haplotypes: number        // 单倍型数（去重后的唯一序列数）
  hd: number                // 单倍型多样性
  hdVar: number             // Hd 方差（Nei & Tajima 1981）
}

// 标准正态 CDF
function stdNormalCdf(z: number): number {
  const Za = Math.abs(z)
  const t = 1 / (1 + 0.3275911 * Za)
  const e = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-Za * Za)
  return z >= 0 ? e : 1 - e
}

export function diversity(recs: SeqRecord[]): Diversity | null {
  const n = recs.length
  if (n < 2) return null
  const seqs = recs.map((r) => r.sequence.toUpperCase().replace(/U/g, 'T'))
  const L0 = seqs.reduce((m, s) => Math.min(m, s.length), Infinity)
  if (L0 === 0) return null

  // 列级有效 mask（跳过含 gap/N/歧义的列）
  const validCol = new Uint8Array(L0)
  let L = 0
  for (let k = 0; k < L0; k++) {
    let ok = true
    for (let i = 0; i < n; i++) {
      const c = seqs[i][k]
      if (!'ACGT'.includes(c)) { ok = false; break }
    }
    if (ok) { validCol[k] = 1; L++ }
  }
  if (L === 0) return null

  // 提取有效位点序列
  const effSeqs = seqs.map((s) => {
    let out = ''
    for (let k = 0; k < L0; k++) if (validCol[k]) out += s[k]
    return out
  })

  // S（分离位点）与 eta（总突变数）
  let S = 0
  let eta = 0
  for (let k = 0; k < L; k++) {
    const seen = new Set<string>()
    let diff = 0
    for (let i = 0; i < n; i++) {
      seen.add(effSeqs[i][k])
    }
    if (seen.size > 1) { S++; diff = seen.size - 1 }
    eta += diff
  }

  // π 与 k：对所有 (i,j) 对平均 p-distance
  let sumP = 0
  let pairs = 0
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let diff = 0
      for (let k = 0; k < L; k++) {
        if (effSeqs[i][k] !== effSeqs[j][k]) diff++
      }
      sumP += diff
      pairs++
    }
  }
  const k_avg = pairs ? sumP / pairs : 0          // 平均成对差异数（总）
  const pi = pairs ? sumP / (pairs * L) : 0        // 每位点

  // Watterson θw = S / a_n（每位点）
  let a_n = 0
  for (let i = 1; i <= n - 1; i++) a_n += 1 / i
  const thetaW = a_n > 0 ? S / a_n / L : 0          // 每位点

  // Tajima's D（Tajima 1989）
  //   D = (k_avg - S/a_n) / √(Var(d))
  //   Var(d) = (e1·S + e2·S·(S-1))，e1 e2 为 Tajima 系数
  const a1 = a_n
  let b1 = 0
  for (let i = 1; i <= n - 1; i++) b1 += 1 / (i * i)
  const c1 = b1 - 1 / a1
  const a2 = (n * (n + 1)) / (2 * (n - 1)) - 1 / a1
  const e1 = c1 / a1
  const e2 = a2 / (a1 * a1 + a2)
  const dVar = e1 * S + e2 * S * (S - 1)
  const dSd = Math.sqrt(Math.max(dVar, 0))
  const tajimaD = dSd > 0 ? (k_avg - S / a1) / dSd : 0
  const tajimaPval = 2 * (1 - stdNormalCdf(Math.abs(tajimaD)))

  // 单倍型多样性（Nei & Tajima 1981）
  const hapSet = new Map<string, number>()
  for (const s of effSeqs) hapSet.set(s, (hapSet.get(s) ?? 0) + 1)
  const h = hapSet.size
  let sumPi2 = 0
  for (const [, cnt] of hapSet) {
    const fi = cnt / n
    sumPi2 += fi * fi
  }
  const hd = (n / (n - 1)) * (1 - sumPi2)
  // Hd 方差（Nei & Tajima 1981 标准近似）
  //   Var(Hd) = [2/(n(n-1))] · [(1-Σp_i²)]² + [2/(n³)]·[2(n-1)/(n-1)·(1-Σp_i²) - 6·(1-Σp_i²)²]
  // 简化记 P = 1 - Σp_i²（小样本稳定近似，避免负值）
  const P = 1 - sumPi2
  const hdVar = (2 / (n * (n - 1))) * P * P +
    (2 / (n * n * n)) * ((2 * (n - 1) / (n - 1)) * P - 6 * P * P)

  return {
    n, L, S, eta, pi, thetaW, k: k_avg,
    tajimaD, tajimaPval, tajimaD2: dVar,
    haplotypes: h, hd, hdVar,
  }
}

