import { iqtreeModel } from '../src/store'

const mk = (over: any = {}) => ({
  sequences: [{ sequence: 'ACGTACGTACGTACGTACGTACGTACGTACGTACGTACGT' }],
  mlModelFinder: false,
  engineModelNuc: 'GTR',
  engineModelAA: 'LG',
  rateMod: 'none' as const,
  mlGammaCats: 4,
  mlFreeRateCats: 3,
  ...over,
})

const aaSeqs = () => ({ sequences: [{ sequence: 'ARNDCQEGHILKMFPSTWYVARNDCQEGHILKMFPSTWYV' }] })

let ok = true
function check(label: string, got: string, want: string) {
  const pass = got === want
  if (!pass) ok = false
  console.log(`  ${pass ? 'OK  ' : 'FAIL'} ${label}: got="${got}" want="${want}"`)
}

console.log('--- iqtreeModel 拼接校验 ---')
check('NT GTR none', iqtreeModel(mk()), 'GTR')
check('NT GTR +G4', iqtreeModel(mk({ rateMod: 'G' as const, mlGammaCats: 4 })), 'GTR+G4')
check('NT GTR +G8', iqtreeModel(mk({ rateMod: 'G' as const, mlGammaCats: 8 })), 'GTR+G8')
check('NT GTR +I+G4', iqtreeModel(mk({ rateMod: 'G+I' as const })), 'GTR+I+G4')
check('NT GTR +R3', iqtreeModel(mk({ rateMod: 'R' as const, mlFreeRateCats: 3 })), 'GTR+R3')
check('NT GTR +R10', iqtreeModel(mk({ rateMod: 'R' as const, mlFreeRateCats: 10 })), 'GTR+R10')
check('NT GTR +I', iqtreeModel(mk({ rateMod: 'I' as const })), 'GTR+I')
check('AA LG none', iqtreeModel(mk(aaSeqs())), 'LG')
check('AA WAG +G4', iqtreeModel(mk({ ...aaSeqs(), engineModelAA: 'WAG', rateMod: 'G' as const })), 'WAG+G4')
check('AA Q.plant +I+G4', iqtreeModel(mk({ ...aaSeqs(), engineModelAA: 'Q.plant', rateMod: 'G+I' as const })), 'Q.plant+I+G4')
check('MFP (NT)', iqtreeModel(mk({ mlModelFinder: true })), 'MFP')
check('MFP (AA)', iqtreeModel(mk({ ...aaSeqs(), mlModelFinder: true })), 'MFP')

console.log(`\nRESULT: ${ok ? 'ALL PASS' : 'SOME FAIL'}`)
if (!ok) process.exit(1)
