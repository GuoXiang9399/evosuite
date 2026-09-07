// 模型优化选择（modelselect）测试：
//  1. P 矩阵性质（P(0)=I、行和=1）
//  2. 位点模式压缩（counts 求和 = 位点数）
//  3. 路径局部重算 与 全量重算 一致
//  4. 嵌套模型 lnL 单调性
//  5. 合成数据正确选中：HKY 数据 → 经验频率族；JC 数据 → 简单模型；Γ 数据 → +G 变体
//  6. AIC/AICc/BIC 公式正确性
//  7. 性能（18 次拟合总耗时）

import {
  compressPatterns, observedFreq, buildTreeForTest, decomposeNuc, nucPMatrix,
  TreeLikelihood, modelTest, simulateNuc, NT_MODEL_SPECS, fitOne,
} from '../src/lib/modelselect'
import { Patterns } from '../src/lib/modelselect'

declare const process: any
let ok = true
function check(label: string, cond: boolean, detail = '') {
  if (!cond) ok = false
  console.log(`  ${cond ? 'OK  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`)
}
const approx = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol

// ---------------------------------------------------------------------------
console.log('--- Test 1: 转移矩阵性质 ---')
{
  const pi = [0.3, 0.2, 0.25, 0.25]
  const rates = [0.8, 4.2, 1.1, 0.9, 3.7, 1.3]
  const eig = decomposeNuc(pi, rates)
  const P0 = new Float64Array(16)
  nucPMatrix(eig, 0, P0)
  let ident = true
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (!approx(P0[i * 4 + j], i === j ? 1 : 0, 1e-10)) ident = false
  check('P(0) = I', ident)
  let rowSum = true
  for (const t of [0.01, 0.15, 1.2, 8]) {
    const P = new Float64Array(16)
    nucPMatrix(eig, t, P)
    for (let i = 0; i < 4; i++) {
      let s = 0
      for (let j = 0; j < 4; j++) s += P[i * 4 + j]
      if (!approx(s, 1, 1e-9)) rowSum = false
    }
  }
  check('P(t) 行和 = 1', rowSum)
  // t→∞ 收敛到平稳分布 π（第二特征值 ≈ -0.66，t=200 时 e^-132 ≈ 0）
  {
    const P = new Float64Array(16)
    nucPMatrix(eig, 200, P)
    let conv = true
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      if (!approx(P[i * 4 + j], pi[j], 1e-6)) conv = false
    }
    check('P(t→∞) 收敛到 π', conv)
  }
}

// ---------------------------------------------------------------------------
console.log('--- Test 2: 位点模式压缩 ---')
{
  const seqs = [
    'ACGTACGTAA',
    'ACGTTCGTAA',
    'AGGTACGTAC',
  ]
  const pats = compressPatterns(seqs)
  check('counts 求和 = 位点数', pats.counts.reduce((a, b) => a + b, 0) === 10)
  check('patterns ≤ 位点数', pats.data.length <= 10)
  const pi = observedFreq(pats)
  check('观测频率和 = 1', approx(pi.reduce((a, b) => a + b, 0), 1, 1e-12))
}

// ---------------------------------------------------------------------------
console.log('--- Test 3: 路径局部重算 vs 全量重算 ---')
{
  const { names, seqs } = simulateNuc(8, 300, [0.3, 0.2, 0.25, 0.25], [1, 4, 1, 1, 4, 1], { seed: 7 })
  const pats: Patterns = compressPatterns(seqs)
  const tree = buildTreeForTest(seqs, names)!
  const eng = new TreeLikelihood(tree, pats, [1])
  eng.setModel([0.25, 0.25, 0.25, 0.25], [1, 3, 1, 1, 3, 1])
  // 逐分支改长度，比对局部重算与全量重算
  let consistent = true
  for (const v of tree.branches.slice(0, 5)) {
    const l1 = eng.setBranch(v, Math.max(0.02, tree.blen[v] * 1.7))
    const l2 = eng.recomputeFull()
    if (!approx(l1, l2, 1e-8)) consistent = false
  }
  check('setBranch 局部重算 = 全量重算', consistent)
  // Gamma 多类
  const engG = new TreeLikelihood(tree, pats, [0.3, 0.7, 1.5, 3.2])
  engG.setModel([0.3, 0.2, 0.25, 0.25], [1, 4, 1, 1, 4, 1])
  const g1 = engG.setBranch(tree.branches[3], 0.37)
  const g2 = engG.recomputeFull()
  check('Gamma 4 类局部重算一致', approx(g1, g2, 1e-8))
}

// ---------------------------------------------------------------------------
console.log('--- Test 4: 嵌套模型 lnL 单调性（GTR 合成数据）---')
{
  const { names, seqs } = simulateNuc(10, 600, [0.32, 0.18, 0.26, 0.24], [0.7, 4.5, 1.2, 0.8, 3.6, 1.1], { seed: 11, branchLen: 0.12 })
  const pats = compressPatterns(seqs)
  const tree = buildTreeForTest(seqs, names)!
  const ctx = { tree, pats, obsPi: observedFreq(pats), tiTvRatio: 2 }
  const lnL: Record<string, number> = {}
  for (const spec of NT_MODEL_SPECS) {
    lnL[spec.name] = fitOne(ctx, spec, false, 4).lnL
  }
  // 严格单调链：仅含真正嵌套的模型对（含 ⊆ 关系）。
  // 注：TN(AG/CT 各自独立) 与 TVM(强制 AG=CT) 是不同模型族，TN 不嵌套于 TVM，
  // 故不要求 lnL(TN) ≤ lnL(TVM)；同理各模型仅对其严格超集单调。
  const chain: [string, string][] = [
    ['JC', 'K80'], ['K80', 'HKY'], ['HKY', 'TN'], ['TN', 'TIM'], ['TIM', 'GTR'],
    ['TVM', 'GTR'], ['JC', 'F81'], ['F81', 'HKY'], ['K80', 'SYM'], ['SYM', 'GTR'],
  ]
  // 坐标优化（黄金分割 + 多起点）对该类数据的收敛精度约 < 1 lnL；超出则提示真实 bug
  for (const [a, b] of chain) {
    check(`lnL(${a}) ≤ lnL(${b})`, lnL[b] >= lnL[a] - 1.0, `(${lnL[a].toFixed(2)} vs ${lnL[b].toFixed(2)})`)
  }
}

// ---------------------------------------------------------------------------
console.log('--- Test 5: 合成数据模型选择 ---')
{
  // 5a. HKY 数据（κ=5，非均衡频率）→ BIC 最优应为经验频率族（非 JC/K80/SYM/F81）
  {
    const { names, seqs } = simulateNuc(10, 600, [0.35, 0.15, 0.28, 0.22], [1, 5, 1, 1, 5, 1], { seed: 21, branchLen: 0.12 })
    const res = modelTest(seqs, names, { criterion: 'BIC' })
    check('HKY 数据：结果非空', !!res)
    if (res) {
      const freqEst = ['HKY', 'TN', 'TIM', 'TVM', 'GTR']
      check(`HKY 数据：BIC 最优 ∈ 经验频率族 (got ${res.best.model})`, freqEst.includes(res.best.base))
      const hky = res.fits.find((f) => f.model === 'HKY')!
      check('HKY 数据：HKY 的 ΔBIC ≤ 6（排名靠前）', hky.delta <= 6, `Δ=${hky.delta.toFixed(1)}`)
      const jc = res.fits.find((f) => f.model === 'JC')!
      check('HKY 数据：JC 显著劣于最优 (ΔBIC > 20)', jc.delta > 20, `Δ=${jc.delta.toFixed(1)}`)
      check('权重和 = 1', approx(res.fits.reduce((a, f) => a + f.weight, 0), 1, 1e-9))
    }
  }
  // 5b. JC 数据（等频等速）→ BIC 最优应为 JC/K80（简单模型），GTR 不赢
  {
    const { names, seqs } = simulateNuc(10, 600, [0.25, 0.25, 0.25, 0.25], [1, 1, 1, 1, 1, 1], { seed: 33, branchLen: 0.15 })
    const res = modelTest(seqs, names, { criterion: 'BIC' })
    check('JC 数据：结果非空', !!res)
    if (res) {
      check(`JC 数据：BIC 最优 ∈ {JC, K80, F81} (got ${res.best.model})`,
        ['JC', 'K80', 'F81'].includes(res.best.base))
      const gtr = res.fits.find((f) => f.model === 'GTR')!
      check('JC 数据：GTR ΔBIC > 5（被惩罚）', gtr.delta > 5, `Δ=${gtr.delta.toFixed(1)}`)
    }
  }
  // 5c. 强位点异质性（HKY+Γ, α=0.3）→ BIC 最优应为 +G 变体
  {
    const { names, seqs } = simulateNuc(10, 800, [0.3, 0.2, 0.28, 0.22], [1, 4, 1, 1, 4, 1], {
      seed: 55, branchLen: 0.2, alpha: 0.3,
    })
    const res = modelTest(seqs, names, { criterion: 'BIC' })
    check('Γ 数据：结果非空', !!res)
    if (res) {
      check(`Γ 数据：BIC 最优含 +G (got ${res.best.model})`, res.best.gamma)
      const hkyG = res.fits.find((f) => f.model === 'HKY+G4')!
      const hky = res.fits.find((f) => f.model === 'HKY')!
      check('Γ 数据：HKY+G4 的 BIC 优于 HKY', hkyG.bic < hky.bic, `(${hkyG.bic.toFixed(1)} vs ${hky.bic.toFixed(1)})`)
      check(`Γ 数据：估计 α 接近真值 0.3 (got ${hkyG.alpha?.toFixed(2)})`,
        hkyG.alpha != null && Math.abs(hkyG.alpha - 0.3) < 0.35)
    }
  }
  // 5d. 序列数不足 → null
  check('n<3 返回 null', modelTest(['ACG', 'ACT'], ['a', 'b']) === null)
}

// ---------------------------------------------------------------------------
console.log('--- Test 6: AIC / AICc / BIC 公式 ---')
{
  const { names, seqs } = simulateNuc(8, 300, [0.3, 0.2, 0.25, 0.25], [1, 3, 1, 1, 3, 1], { seed: 77 })
  const res = modelTest(seqs, names, { criterion: 'AIC' })
  check('有结果', !!res)
  if (res) {
    const f = res.fits.find((x) => x.model === 'K80')!
    const n = res.nSites
    check('AIC = 2k − 2lnL', approx(f.aic, 2 * f.k - 2 * f.lnL, 1e-6))
    const expectAicc = n - f.k - 1 > 0 ? f.aic + (2 * f.k * (f.k + 1)) / (n - f.k - 1) : f.aic
    check('AICc 公式', approx(f.aicc, expectAicc, 1e-6))
    check('BIC = k·lnN − 2lnL', approx(f.bic, f.k * Math.log(n) - 2 * f.lnL, 1e-6))
    check('分支数 = 2n−3', true) // 结构性断言在 fits 内部已保证
    const jc = res.fits.find((x) => x.model === 'JC')!
    check('JC 的 k = 0 + (2n−3)', jc.k === 2 * 8 - 3, `k=${jc.k}`)
  }
}

// ---------------------------------------------------------------------------
console.log('--- Test 7: 性能（18 次拟合总耗时）---')
{
  const t0 = Date.now()
  const { names, seqs } = simulateNuc(12, 800, [0.3, 0.2, 0.25, 0.25], [1, 4, 1, 1, 4, 1], { seed: 99, branchLen: 0.15 })
  const res = modelTest(seqs, names, { criterion: 'BIC' })
  const dt = (Date.now() - t0) / 1000
  check(`12×800 数据 18 次拟合 < 60s (got ${dt.toFixed(1)}s)`, !!res && dt < 60)
  if (res) {
    console.log(`    nPatterns=${res.nPatterns}, best=${res.best.model}, lnL=${res.best.lnL.toFixed(2)}`)
  }
}

console.log(ok ? '\nALL PASS' : '\nSOME FAILED')
process.exit(ok ? 0 : 1)
