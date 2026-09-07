// AA 完整特征分解对账测试。
// 跑法：cd /workspace/evosuite &&
//   npx tsc scripts/test_aa.ts --outDir /tmp/dt --module commonjs --target es2020 --esModuleInterop --skipLibCheck --rootDir . &&
//   node /tmp/dt/scripts/test_aa.js

import { distanceMatrix } from '../src/lib/distance'
import { decomposeAA, aaEigenPairDistance, aaPMatrix } from '../src/lib/dist/aa-eigen'
import { AA_MATRICES } from '../src/lib/matrices'

function isSymmetric(M: number[][]): boolean {
  for (let i = 0; i < M.length; i++) {
    for (let j = i + 1; j < M.length; j++) {
      if (Math.abs(M[i][j] - M[j][i]) > 1e-9) return false
    }
  }
  return true
}

// 测试 1：decomposeAA 的 M_s 对称、rate 归一化（−Σ πᵢQᵢᵢ = 1，d=期望替换数）
function test1() {
  console.log('--- Test 1: decomposeAA 对称 + rate 归一化 ---')
  let allOk = true
  for (const name of ['dayhoff', 'jtt', 'wag', 'lg']) {
    const mat = AA_MATRICES[name]
    if (!mat) continue
    const eig = decomposeAA(mat, name)
    // 重建 M_s = V D Vᵀ，验证 −Σ πᵢ M_ii ≈ 1
    const N2 = 20
    let rate = 0
    for (let i = 0; i < N2; i++) {
      let mii = 0
      for (let k = 0; k < N2; k++) mii += eig.V[i][k] * eig.V[i][k] * eig.D[k]
      rate += mat.PI[i] * (-mii)
    }
    const ok = Math.abs(rate - 1) < 1e-4
    if (!ok) allOk = false
    console.log(`  ${name.padEnd(8)}: -ΣπᵢQᵢᵢ=${rate.toFixed(6)} (期望 1) ${ok ? 'OK' : 'FAIL'}`)
  }
  return allOk
}

// 测试 2：P(t) 是合法转移矩阵（行和=1，因 P_ij=Pr(j|i)）：P(0)=I；各行和=1；P_ii 随 t 递减
function test2() {
  console.log('--- Test 2: P(t) 校验 (P(0)=I, 行和=1, P_ii 递减) ---')
  const eig = decomposeAA(AA_MATRICES.jtt!, 'jtt')
  const P0 = aaPMatrix(eig, 0)
  let idOk = true
  for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) {
    const want = i === j ? 1 : 0
    if (Math.abs(P0[i][j] - want) > 1e-9) idOk = false
  }
  const P1 = aaPMatrix(eig, 1.0)
  let rowSumOk = true
  for (let i = 0; i < 20; i++) {
    let s = 0
    for (let j = 0; j < 20; j++) s += P1[i][j]
    if (Math.abs(s - 1) > 1e-6) rowSumOk = false
  }
  // P_ii(t=0)=1 应 >= P_ii(t=1)
  let diagDec = true
  for (let i = 0; i < 20; i++) if (P1[i][i] > P0[i][i] + 1e-9) diagDec = false
  console.log(`  P(0)=I: ${idOk ? 'OK' : 'FAIL'}`)
  console.log(`  行和=1 @t=1: ${rowSumOk ? 'OK' : 'FAIL'}`)
  console.log(`  P_ii 随 t 递减: ${diagDec ? 'OK' : 'FAIL'}`)
  return idOk && rowSumOk && diagDec
}

// 测试 3：d(X, X) = 0
function test3() {
  console.log('--- Test 3: d(X, X) = 0 ---')
  let ok = true
  const seqs = ['ARNDCQEGHILKMFPSTWYV', 'ARNDCQEGHILKMFPSTWYV']
  for (const name of ['dayhoff', 'jtt', 'wag', 'lg']) {
    const D = distanceMatrix(seqs, name as any)
    const d = D[0][1]
    if (Math.abs(d) > 1e-6) ok = false
    console.log(`  ${name}: d=${d.toFixed(6)} ${Math.abs(d) <= 1e-6 ? 'OK' : 'FAIL'}`)
  }
  return ok
}

// 测试 4：发散序列给出小正数且对称的距离
function test4() {
  console.log('--- Test 4: 5 条相似序列，距离>0 且对称 ---')
  const seqs = [
    'ARNDCQEGHILKMFPSTWYV',
    'ARNDCQEGHILKMFPSTWYV',
    'GRNDCQEGHILKMFPSTWYV',   // pos0 A->G
    'ARNDCQEGHILKMFPSTWYI',   // pos19 V->I
    'ARNDCQEGHILKMFPSTWFV',   // pos18 Y->F
  ]
  let ok = true
  for (const name of ['dayhoff', 'jtt', 'wag', 'lg']) {
    const D = distanceMatrix(seqs, name as any)
    const sym = isSymmetric(D)
    const d02 = D[0][2], d03 = D[0][3], d04 = D[0][4]
    const pos = d02 > 0 && d03 > 0 && d04 > 0
    if (!sym || !pos) ok = false
    console.log(`  ${name.padEnd(8)}: sym=${sym} d(0,2)=${d02.toFixed(4)} d(0,3)=${d03.toFixed(4)} d(0,4)=${d04.toFixed(4)} ${sym && pos ? 'OK' : 'FAIL'}`)
  }
  return ok
}

// 测试 5：较长序列下，距离随差异位点数单调递增（合理性）
function test5() {
  console.log('--- Test 5: d 随差异位点单调递增 ---')
  const ref = 'ARNDCQEGHILKMFPSTWYVARNDCQEGHILKMFPSTWYV'  // 40 aa
  const subs: Array<[number, string]> = [
    [2, 'G'],   // pos2 N->G
    [6, 'K'],   // pos6 E->K
    [10, 'V'],  // pos10 L->V
    [20, 'D'],  // pos20 N->D
  ]
  // 累积变异：第 k 个变异含前 k 处替换
  const variants: string[] = [ref]
  let acc = ref
  for (const [pos, aa] of subs) {
    acc = acc.slice(0, pos) + aa + acc.slice(pos + 1)
    variants.push(acc)
  }
  const seqs = variants
  let ok = true
  for (const name of ['dayhoff', 'jtt', 'wag', 'lg']) {
    const D = distanceMatrix(seqs, name as any)
    const d1 = D[0][1], d2 = D[0][2], d3 = D[0][3], d4 = D[0][4]
    const mono = d1 >= 0 && d2 > d1 + 1e-4 && d3 >= d2 + 1e-4 && d4 >= d3 + 1e-4
    const sane = d4 < 5
    if (!mono || !sane) ok = false
    console.log(`  ${name.padEnd(8)}: d1=${d1.toFixed(4)} d2=${d2.toFixed(4)} d3=${d3.toFixed(4)} d4=${d4.toFixed(4)} ${mono && sane ? 'OK' : 'FAIL'}`)
  }
  return ok
}

// 测试 6：cache 命中
function test6() {
  console.log('--- Test 6: cache hit ---')
  const mat = AA_MATRICES.dayhoff!
  const t0 = process.hrtime.bigint()
  const e1 = decomposeAA(mat, 'dayhoff')
  const t1 = process.hrtime.bigint()
  const e2 = decomposeAA(mat, 'dayhoff')
  const t2 = process.hrtime.bigint()
  const same = e1 === e2
  console.log(`  1st: ${Number(t1 - t0) / 1e6}ms, 2nd: ${Number(t2 - t1) / 1e6}ms, sameRef=${same}`)
  return same
}

const r1 = test1()
const r2 = test2()
const r3 = test3()
const r4 = test4()
const r5 = test5()
const r6 = test6()
console.log('======================================')
console.log(`RESULT: ${r1 && r2 && r3 && r4 && r5 && r6 ? 'ALL PASS' : 'SOME FAIL'}`)
