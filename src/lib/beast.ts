// BEAST1 内核接入：贝叶斯天际线(Bayesian Skyline)与种群动态(phylodynamics)。
// 设计原则同 MAFFT/IQ-TREE2：桌面端调用真实 beast 二进制；浏览器/未安装时回退到内置近似曲线。
import { SeqRecord } from './fasta'

export interface SkylineParams {
  model: 'constant' | 'exponential' | 'skyline'
  groups: number
  chain: number
}

/* ------------------------------------------------------------------ *
 *  BEAST1/2 BEAUti 分类参数（v0.1.1）
 *  与 Rust 端 BeastRunParams 一一对应：
 *    treePrior  树先验   : yule | bd | constant | exponential | skyline
 *    clock      分子钟   : strict | relaxed_ln | relaxed_exp
 *    subst      位点替换 : hky | gtr | jc（氨基酸数据由 Rust 端自动改用 JTT）
 *    gammaCats  离散 Gamma 类别数（0 = 不建模）
 *    pinv       不变位点比例（pinvEnabled=false 时 Rust 端视为关闭）
 *    chain      MCMC 链长
 * ------------------------------------------------------------------ */
export interface Beast1Params {
  treePrior: 'yule' | 'bd' | 'constant' | 'exponential' | 'skyline'
  clock: 'strict' | 'relaxed_ln' | 'relaxed_exp'
  subst: 'hky' | 'gtr' | 'jc'
  gammaCats: 0 | 2 | 4 | 8
  pinvEnabled: boolean
  pinv: number
  chain: number
}

// 组装 invoke('run_beast'…) 的 params 对象（字段名与 Rust serde rename 对齐）。
export function toBeastRunParams(b1: Beast1Params, groups: number, genTime: number, engine: string) {
  return {
    treePrior: b1.treePrior,
    clock: b1.clock,
    subst: b1.subst,
    gammaCats: b1.gammaCats,
    pinv: b1.pinvEnabled ? b1.pinv : -1,
    groups,
    chain: b1.chain,
    genTime,
    engine,
  }
}

export interface SkylineResult {
  model: string
  groups: number
  // 时间轴（0=现在 → 1=过去，归一化）与对应有效种群规模 Ne，等长数组，用于阶梯绘制
  times: number[]
  ne: number[]
  fromEngine: boolean
  generatedAt: string
  note?: string
}

// 确定性伪随机（避免每次重算抖动过大，但随序列数/段位变化）
function hash(a: number, b: number): number {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453
  return x - Math.floor(x)
}

// 内置贝叶斯天际线近似：真实 BEAST1 会在桌面端以 MCMC 推断后验天际线，
// 此处用基于序列数与合并理论(coalescent)的启发式分段曲线做演示。
export function computeSkyline(recs: SeqRecord[], params: SkylineParams): SkylineResult {
  const n = Math.max(recs.length, 2)
  const base = n * 1.5 // 以序列数为尺度的有效种群规模基线
  const G = Math.max(2, Math.round(params.groups))
  const times: number[] = []
  const ne: number[] = []
  // 时间轴：从「现在」(0) 向「过去」(1) 取 G 段
  for (let i = 0; i < G; i++) {
    const t0 = i / G
    const t1 = (i + 1) / G
    times.push(t0, t1)
    let v: number
    if (params.model === 'constant') {
      v = base
    } else if (params.model === 'exponential') {
      const mid = (t0 + t1) / 2
      v = base * Math.exp(mid * 1.2)
    } else {
      // 分段常数：从近到远先升后降（扩张/瓶颈），叠加轻微噪声，贴近真实天际线形态
      const mid = (t0 + t1) / 2
      const trend = base * (0.7 + 1.3 * Math.sin(mid * Math.PI * 0.8 + 0.4))
      const noise = 1 + (hash(n, i) - 0.5) * 0.25
      v = Math.max(0.2, trend * noise)
    }
    ne.push(v, v)
  }
  return {
    model: params.model,
    groups: G,
    times,
    ne,
    fromEngine: false,
    generatedAt: new Date().toISOString(),
    note: 'Built-in skyline approximation',
  }
}

// 调用外部 BEAST1（Rust 命令），返回天际线结果；不可用返回 null（前端回退内置）。
// v0.1.1：beast1Params（BEAUti 分类参数）透传给 Rust，生成完整 BEAST XML。
export async function tryBeast(
  fastaText: string,
  params: SkylineParams,
  engine: string = 'beast1',
  beast1?: Beast1Params,
): Promise<SkylineResult | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    if (!(window as any).__TAURI_INTERNALS__) throw new Error('not in tauri runtime')
    const out: any = await invoke('run_beast', {
      fasta: fastaText,
      model: params.model,
      groups: params.groups,
      chain: beast1 ? beast1.chain : params.chain,
      engine,
      params: beast1
        ? toBeastRunParams(beast1, params.groups, 1, engine)
        : null,
    })
    if (out && Array.isArray(out.times) && Array.isArray(out.ne)) {
      return {
        model: out.model ?? params.model,
        groups: out.groups ?? params.groups,
        times: out.times,
        ne: out.ne,
        fromEngine: true,
        generatedAt: new Date().toISOString(),
      }
    }
  } catch {
    /* 回退到内置近似 */
  }
  return null
}

/* ------------------------------------------------------------------ *
 *  Phylodynamics（系统动态/种群动态）分析
 *  在贝叶斯天际线之上，估算传播/合并速率、增长率、TMRCA 与 R0 等
 *  流行病学与演化指标。同样提供 RK（真实 BEAST1）与内置近似两条路径。
 * ------------------------------------------------------------------ */

export interface PhylodynamicsParams {
  model: 'constant' | 'exponential' | 'skyline'
  groups: number
  genTime: number // 世代时间（用于 R0 计算的年/单位时间）
}

export interface PhylodynamicsResult {
  // 关键指标
  tmrca: number // 最近共同祖先时间（单位时间）
  growthRate: number // 指数增长率 r（每单位时间）
  rate: number // 平均演化速率（差异/时间）
  R0: number // 基本再生数（启发式）
  Ne0: number // 当前有效种群规模
  // 合并率/增长率 时间曲线（0=现在→1=过去，与天际线同口径），用于绘图
  times: number[]
  coalescentRate: number[]
  fromEngine: boolean
  generatedAt: string
  note?: string
}

// 估算平均成对序列差异（p-distance），用于演化速率
function avgPdist(recs: SeqRecord[]): number {
  if (recs.length < 2) return 0.02
  const minLen = Math.min(...recs.map((r) => r.sequence.length))
  if (minLen === 0) return 0.02
  let total = 0
  let pairs = 0
  for (let i = 0; i < recs.length; i++) {
    for (let j = i + 1; j < recs.length; j++) {
      const a = recs[i].sequence
      const b = recs[j].sequence
      let diff = 0
      for (let k = 0; k < minLen; k++) if (a[k] !== b[k]) diff++
      total += diff / minLen
      pairs++
    }
  }
  return pairs ? total / pairs : 0.02
}

// 内置 phylodynamics 近似：基于合并理论 + 成对差异启发式。
export function computePhylodynamics(
  recs: SeqRecord[],
  params: PhylodynamicsParams,
  skyline?: SkylineResult,
): PhylodynamicsResult {
  const n = Math.max(recs.length, 2)
  const G = Math.max(2, Math.round(params.groups))
  const pd = avgPdist(recs)
  // TMRCA：用合并理论尺度（n 个样本共 n-1 个合并事件）配合平均成对差异
  const tmrca = (pd * n) / Math.max(0.01, 1.2)
  const Ne0 = skyline ? skyline.ne[skyline.ne.length - 1] : n * 1.5
  // 增长率：exponential/skyline 给出正向扩张，constant 接近 0
  const growthRate =
    params.model === 'constant' ? 0.0 : params.model === 'exponential' ? 0.45 : 0.28
  // 平均演化速率（差异 / TMRCA）
  const rate = tmrca > 0 ? pd / tmrca : 0.01
  // R0 启发式：指数增长下 R0 ≈ exp(r · g)，g 为世代时间
  const R0 = Math.max(1, Math.exp(growthRate * Math.max(0.1, params.genTime)))

  // 合并率曲线（与天际线同时间轴）：lambda = 1/(Ne·T)，随 Ne 变化
  const times: number[] = []
  const coalescentRate: number[] = []
  for (let i = 0; i < G; i++) {
    const t0 = i / G
    const t1 = (i + 1) / G
    const mid = (t0 + t1) / 2
    // 与 skyline 形态一致：近到远先升后降
    const neV = skyline
      ? skyline.ne[Math.min(skyline.ne.length - 1, Math.round(mid * (skyline.ne.length - 1)))]
      : Ne0 * (0.7 + 1.3 * Math.sin(mid * Math.PI * 0.8 + 0.4))
    const lam = 1 / Math.max(0.5, neV)
    times.push(t0, t1)
    coalescentRate.push(lam, lam)
  }

  return {
    tmrca,
    growthRate,
    rate,
    R0,
    Ne0,
    times,
    coalescentRate,
    fromEngine: false,
    generatedAt: new Date().toISOString(),
    note: 'Built-in phylodynamics approximation',
  }
}

// 调用外部 BEAST1 进行系统动态分析；不可用时返回 null（前端回退内置）。
// v0.1.1：beast1Params（BEAUti 分类参数）透传给 Rust。
export async function tryBeastPhylodynamics(
  fastaText: string,
  params: PhylodynamicsParams,
  engine: string = 'beast1',
  beast1?: Beast1Params,
): Promise<PhylodynamicsResult | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    if (!(window as any).__TAURI_INTERNALS__) throw new Error('not in tauri runtime')
    const out: any = await invoke('run_beast_phylodynamics', {
      fasta: fastaText,
      model: params.model,
      groups: params.groups,
      genTime: params.genTime,
      engine,
      params: beast1
        ? toBeastRunParams(beast1, params.groups, params.genTime, engine)
        : null,
    })
    if (out && typeof out.tmrca === 'number') {
      return {
        tmrca: out.tmrca,
        growthRate: out.growthRate ?? 0,
        rate: out.rate ?? 0,
        R0: out.R0 ?? 1,
        Ne0: out.Ne0 ?? 0,
        times: Array.isArray(out.times) ? out.times : [],
        coalescentRate: Array.isArray(out.coalescentRate) ? out.coalescentRate : [],
        fromEngine: true,
        generatedAt: new Date().toISOString(),
      }
    }
  } catch {
    /* 回退到内置近似 */
  }
  return null
}
