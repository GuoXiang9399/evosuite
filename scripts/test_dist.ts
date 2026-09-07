// 数学对账测试：检查内置引擎的距离公式（K80 vs JC69、HKY85 在已知合成数据上的行为）。
// 跑法：cd /workspace/evosuite && npx tsc scripts/test_dist.ts --outDir /tmp/dt --module commonjs --target es2020 --esModuleInterop --skipLibCheck --rootDir . && node /tmp/dt/scripts/test_dist.js

import {
  distanceMatrix,
  NucSubstModel,
  AASubstModel,
} from '../src/lib/distance'
import { decomposeHKY, empiricalNucFreq, estimateKappa, hkyPairDistance } from '../src/lib/dist/hky'
import { decomposeGTR, estimateGTRRates, gtrPairDistance } from '../src/lib/dist/gtr'
import { gammaRateQuantiles } from '../src/lib/dist/gamma'

function approx(a: number, b: number, eps = 1e-3): boolean {
  return Math.abs(a - b) < eps
}

function isSymmetric(M: number[][]): boolean {
  for (let i = 0; i < M.length; i++) {
    for (let j = i + 1; j < M.length; j++) {
      if (!approx(M[i][j], M[j][i])) return false
    }
  }
  return true
}

// 测试 1：5 条已知序列的 K80 vs JC69 vs p-distance 关系
// 当 κ₁ = κ₂ 时 K80 ≈ JC69；当 q ≈ 0 时 K80 ≈ JC69
function test1() {
  const A = 'ACGTACGTACGTACGTACGTACGTACGTACGT'
  const B = 'ACGTACGTACGTACGTACGTACGTACGTACGA'   // 仅末端差异（A→G）
  const C = 'ACGTTCGTACGTACGTACGTACGTACGTACGT'   // 1 个颠换
  const D = 'ACGTAGGTACGTACGTACGTACGTACGTACGT'   // 1 个转换
  const E = 'ACGTACGTACGTACGTACGTACGTACGTACGT'   // 与 A 完全相同
  const seqs = [A, B, C, D, E]

  const models: NucSubstModel[] = ['pdist', 'jc69', 'k80', 'tn93', 'hky', 'gtr']
  console.log('--- Test 1: symmetric + sanity ---')
  for (const m of models) {
    const D = distanceMatrix(seqs, m)
    const ok = isSymmetric(D)
    const dAB = D[0][1].toFixed(4)
    const dAE = D[0][4].toFixed(4)
    console.log(`  ${m.padEnd(6)}: symmetric=${ok}, d(A,B)=${dAB}, d(A,E)=${dAE}`)
  }
}

// 测试 2：HKY 矩阵分解后对称性 + 与 K80 在均匀频率下数值近似
function test2() {
  console.log('--- Test 2: HKY symmetric + eigen ---')
  const seqs = [
    'ACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGT',
    'AGGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGT',
    'ACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGA',
    'CCGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGT',
  ]
  const pi = empiricalNucFreq(seqs)
  console.log('  pi =', pi.map((x) => x.toFixed(4)).join(', '))
  const kappa = estimateKappa(seqs, pi, null)
  console.log('  kappa =', kappa.toFixed(3))
  const eig = decomposeHKY(pi, kappa)
  console.log('  HKY eigenvalues =', eig.values.map((x) => x.toFixed(4)).join(', '))
  console.log('  HKY eigenvalue sum =', eig.values.reduce((s, v) => s + v, 0).toFixed(6), '(should be ~0)')
  // 距离对称
  const D = distanceMatrix(seqs, 'hky')
  console.log('  HKY distance matrix symmetric:', isSymmetric(D))
}

// 测试 3：GTR 与 HKY 在均匀频率下数值近似
function test3() {
  console.log('--- Test 3: GTR symmetric + vs HKY on uniform ---')
  const seqs = [
    'ACGTACGTACGTACGTACGTACGTACGTACGT',
    'AGGTACGTACGTACGTACGTACGTACGTACGT',
    'ACGTACGTACGTACGTACGTACGTACGTACGA',
    'CCGTACGTACGTACGTACGTACGTACGTACGT',
  ]
  const pi = empiricalNucFreq(seqs)
  const rates = estimateGTRRates(seqs, pi, null)
  console.log('  GTR rates =', rates.map((x) => x.toFixed(3)).join(', '))
  const eig = decomposeGTR(pi, rates)
  console.log('  GTR eigenvalues sum =', eig.values.reduce((s, v) => s + v, 0).toFixed(6))
  const Dg = distanceMatrix(seqs, 'gtr')
  console.log('  GTR distance matrix symmetric:', isSymmetric(Dg))
}

// 测试 4：Gamma 类别数 + +I 校正
function test4() {
  console.log('--- Test 4: gammaCats + pinv ---')
  const seqs = [
    'ACGTACGTACGTACGTACGTACGTACGTACGT',
    'AGGTACGTACGTACGTACGTACGTACGTACGT',
    'ACGTACGTACGTACGTACGTACGTACGTACGA',
  ]
  const d1 = distanceMatrix(seqs, 'k80', { gammaAlpha: 0.5, gammaCats: 4 })
  const d2 = distanceMatrix(seqs, 'k80', { gammaAlpha: 0.5, gammaCats: 8 })
  const d3 = distanceMatrix(seqs, 'k80', { gammaAlpha: 0 })
  console.log('  K80 d(0,1) α=0.5 K=4:', d1[0][1].toFixed(4))
  console.log('  K80 d(0,1) α=0.5 K=8:', d2[0][1].toFixed(4))
  console.log('  K80 d(0,1) α=0     :', d3[0][1].toFixed(4))
  const d4 = distanceMatrix(seqs, 'k80', { gammaAlpha: 0, pinvEnabled: true, pinv: 0.1 })
  console.log('  K80 +I=0.1         :', d4[0][1].toFixed(4))
}

// 测试 5：Gamma 分位数（α=1 应给均值约 1）
function test5() {
  console.log('--- Test 5: gamma rate quantiles ---')
  for (const alpha of [0.5, 1, 2, 5]) {
    const q4 = gammaRateQuantiles(4, alpha)
    const q8 = gammaRateQuantiles(8, alpha)
    const m4 = q4.reduce((s, x) => s + x, 0) / q4.length
    const m8 = q8.reduce((s, x) => s + x, 0) / q8.length
    console.log(`  α=${alpha}: K=4 mean=${m4.toFixed(4)}  K=8 mean=${m8.toFixed(4)} (期望 ~1)`)
  }
}

test1()
test2()
test3()
test4()
test5()
