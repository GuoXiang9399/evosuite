// 序列统计内核：碱基组成、转换/颠换、Ka/Ks 选择压力（Nei-Gojobori 法）
import { SeqRecord } from './fasta'

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

// ===== Ka/Ks（非同义/同义替换率）：Nei-Gojobori 法 =====
// 标准遗传密码表
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

function aaOf(codon: string): string {
  return CODON[codon] ?? 'X'
}

// 单密码子内“非同义/同义”可突变位点数（遍历每个位点 3 种替代碱基）
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

export interface KaKs {
  dN: number
  dS: number
  omega: number // dN/dS，>1 提示正选择
  m: number // 非同义差异数
  n: number // 同义差异数
  N: number // 非同义位点数
  S: number // 同义位点数
  codons: number
}

// 对两条等长、为 3 倍数的核酸序列（已密码子对齐）计算 Ka/Ks
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
    if (/[^ACGT]/.test(ca) || /[^ACGT]/.test(cb)) continue // 含 gap/歧义则跳过该密码子
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
