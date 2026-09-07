import { create } from 'zustand'
import { SeqRecord } from './lib/fasta'
import { TreeNode } from './lib/newick'
import { SubstModel, detectSeqType } from './lib/distance'
import { SkylineResult, PhylodynamicsResult } from './lib/beast'
import { getT, Lang } from './i18n'

const STORE_LANG = 'evosuite.lang'
const STORE_WS = 'evosuite.workspace'
const STORE_THEME = 'evosuite.theme'
const initialLang: Lang = (() => {
  try {
    const v = localStorage.getItem(STORE_LANG)
    return v === 'en' || v === 'zh' ? v : 'en'
  } catch {
    return 'en'
  }
})()
// Empty workspace means "not yet set" — resolved to the default (inside the app
// folder) by the App on mount. Persisting the resolved value avoids surprises.
const initialWorkspace: string = (() => {
  try {
    return localStorage.getItem(STORE_WS) ?? ''
  } catch {
    return ''
  }
})()
const initialTheme: 'light' | 'dark' = (() => {
  try {
    const v = localStorage.getItem(STORE_THEME)
    return v === 'dark' || v === 'light' ? v : 'light'
  } catch {
    return 'light'
  }
})()

export type View =
  | 'home'
  | 'sequences'
  | 'analyze'
  | 'align'
  | 'build'
  | 'tree'
  | 'distance'
  | 'advanced'
  | 'report'

export type EngineId = 'builtin' | 'iqtree2' | 'raxmlng' | 'mrbayes' | 'beast1' | 'beast2'

export interface LogEntry {
  t: string
  msg: string
  kind?: 'info' | 'warn' | 'ok' | 'err'
}

interface EvoState {
  view: View
  setView: (v: View) => void
  lang: Lang
  setLang: (l: Lang) => void
  theme: 'light' | 'dark'
  setTheme: (t: 'light' | 'dark') => void
  workspace: string
  setWorkspace: (s: string) => void

  sequences: SeqRecord[]
  setSequences: (s: SeqRecord[]) => void
  updateSequence: (id: string, patch: Partial<SeqRecord>) => void
  addSequence: () => void
  removeSequence: (id: string) => void
  // 碱基级批量编辑：在 pos 处插入字符串 / 从 pos 起删除 count 个碱基
  insertBases: (id: string, pos: number, chars: string) => void
  deleteBases: (id: string, pos: number, count: number) => void

  aligned: boolean
  alignment: string[] | null
  setAlignment: (a: string[] | null, aligned: boolean) => void

  model: SubstModel
  setModel: (m: SubstModel) => void
  method: 'NJ' | 'UPGMA'
  setMethod: (m: 'NJ' | 'UPGMA') => void

  // 引擎选择（需求4）：先选引擎，再选参数
  engine: EngineId
  setEngine: (e: EngineId) => void
  // 外部引擎（ML / 贝叶斯）使用的替换模型：核酸与氨基酸分开维护（IQ-TREE2 模型名）
  engineModelNuc: string
  setEngineModelNuc: (m: string) => void
  engineModelAA: string
  setEngineModelAA: (m: string) => void
  // IQ-TREE2：ModelFinder 自动选模（-m MFP），开启时忽略下方模型/速率选择
  mlModelFinder: boolean
  setMlModelFinder: (b: boolean) => void

  // 内置引擎：Gap 处理模式
  gapMode: 'complete' | 'pairwise'
  setGapMode: (m: 'complete' | 'pairwise') => void
  // 内置引擎：位点间速率异质性（uniform / 离散 Gamma）
  rasMode: 'uniform' | 'gamma'
  setRasMode: (m: 'uniform' | 'gamma') => void
  gammaAlpha: number
  setGammaAlpha: (a: number) => void
  // 内置引擎：离散 Gamma 类别数（Yang 1994）
  gammaCats: 2 | 4 | 8 | 16
  setGammaCats: (k: 2 | 4 | 8 | 16) => void
  // 内置引擎：不变位点比例 +I（Lewis 2001）
  pinvEnabled: boolean
  setPinvEnabled: (b: boolean) => void
  pinv: number
  setPinv: (n: number) => void

  bootstrapReps: number
  setBootstrapReps: (n: number) => void

  // IQ-TREE2：速率修饰符（+I / +G4 / +I+G4 / +R3）
  rateMod: 'none' | 'I' | 'G' | 'G+I' | 'R'
  setRateMod: (m: 'none' | 'I' | 'G' | 'G+I' | 'R') => void
  // IQ-TREE2：自举重复数
  mlBootstrap: number
  setMlBootstrap: (n: number) => void
  // IQ-TREE2：线程数（'AUTO' 或具体整数）
  mlThreads: 'AUTO' | number
  setMlThreads: (t: 'AUTO' | number) => void
  mlSeed: number | null
  setMlSeed: (s: number | null) => void
  mlOutgroup: string
  setMlOutgroup: (s: string) => void
  // IQ-TREE2：Gamma 类别数（用于 +G{N} 与 +I+G{N}）
  mlGammaCats: 2 | 4 | 8 | 16
  setMlGammaCats: (k: 2 | 4 | 8 | 16) => void
  // IQ-TREE2：FreeRate 类别数（用于 +R{N}）
  mlFreeRateCats: 2 | 3 | 4 | 5 | 6 | 10
  setMlFreeRateCats: (k: 2 | 3 | 4 | 5 | 6 | 10) => void

  // BEAST1 高级分析参数（天际线 / 种群动态）
  skylineParams: { model: 'constant' | 'exponential' | 'skyline'; groups: number; chain: number }
  setSkylineParams: (p: { model: 'constant' | 'exponential' | 'skyline'; groups: number; chain: number }) => void
  skyline: SkylineResult | null
  setSkyline: (s: SkylineResult | null) => void

  // 系统动态（phylodynamics）分析结果与参数
  phyloParams: { model: 'constant' | 'exponential' | 'skyline'; groups: number; genTime: number }
  setPhyloParams: (p: { model: 'constant' | 'exponential' | 'skyline'; groups: number; genTime: number }) => void
  phylodynamics: import('./lib/beast').PhylodynamicsResult | null
  setPhylodynamics: (p: import('./lib/beast').PhylodynamicsResult | null) => void

  labels: string[]
  distMat: number[][] | null
  setDist: (labels: string[], m: number[][]) => void

  tree: TreeNode | null
  newick: string
  setTree: (t: TreeNode, nwk: string) => void

  note: string
  setNote: (s: string) => void

  log: LogEntry[]
  pushLog: (msg: string, kind?: LogEntry['kind']) => void
  clearLog: () => void
}

export const useStore = create<EvoState>((set) => ({
  view: 'home',
  setView: (v) => set({ view: v }),
  lang: initialLang,
  setLang: (l) => {
    try {
      localStorage.setItem(STORE_LANG, l)
    } catch {
      /* ignore */
    }
    set({ lang: l })
  },
  theme: initialTheme,
  setTheme: (th) => {
    try {
      localStorage.setItem(STORE_THEME, th)
    } catch {
      /* ignore */
    }
    set({ theme: th })
  },
  workspace: initialWorkspace,
  setWorkspace: (s) => {
    try {
      if (s) localStorage.setItem(STORE_WS, s)
      else localStorage.removeItem(STORE_WS)
    } catch {
      /* ignore */
    }
    set({ workspace: s })
  },

  sequences: [],
  setSequences: (s) => set({ sequences: s, alignment: null, aligned: false, tree: null, newick: '', distMat: null, labels: [], skyline: null, phylodynamics: null }),
  updateSequence: (id, patch) =>
    set((st) => ({
      sequences: st.sequences.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    })),
  addSequence: () =>
    set((st) => {
      const n = st.sequences.length + 1
      const rec: SeqRecord = { id: `seq_${Date.now()}_${n}`, name: `new_seq_${n}`, sequence: 'ACGT' }
      return { sequences: [...st.sequences, rec] }
    }),
  removeSequence: (id) => set((st) => ({ sequences: st.sequences.filter((s) => s.id !== id) })),
  insertBases: (id, pos, chars) =>
    set((st) => ({
      sequences: st.sequences.map((s) =>
        s.id === id
          ? { ...s, sequence: s.sequence.slice(0, pos) + chars + s.sequence.slice(pos) }
          : s,
      ),
    })),
  deleteBases: (id, pos, count) =>
    set((st) => ({
      sequences: st.sequences.map((s) =>
        s.id === id
          ? { ...s, sequence: s.sequence.slice(0, pos) + s.sequence.slice(pos + count) }
          : s,
      ),
    })),

  aligned: false,
  alignment: null,
  setAlignment: (a, aligned) => set({ alignment: a, aligned }),

  model: 'k80',
  setModel: (m) => set({ model: m }),
  method: 'NJ',
  setMethod: (m) => set({ method: m }),

  engine: 'builtin',
  setEngine: (e) => set({ engine: e }),
  engineModelNuc: 'GTR',
  setEngineModelNuc: (m) => set({ engineModelNuc: m }),
  engineModelAA: 'LG',
  setEngineModelAA: (m) => set({ engineModelAA: m }),
  mlModelFinder: false,
  setMlModelFinder: (b) => set({ mlModelFinder: b }),

  gapMode: 'complete',
  setGapMode: (m) => set({ gapMode: m }),
  rasMode: 'uniform',
  setRasMode: (m) => set({ rasMode: m }),
  gammaAlpha: 1.0,
  setGammaAlpha: (a) => set({ gammaAlpha: a }),
  gammaCats: 4,
  setGammaCats: (k) => set({ gammaCats: k }),
  pinvEnabled: false,
  setPinvEnabled: (b) => set({ pinvEnabled: b }),
  pinv: 0.1,
  setPinv: (n) => set({ pinv: n }),

  bootstrapReps: 100,
  setBootstrapReps: (n) => set({ bootstrapReps: n }),

  rateMod: 'none',
  setRateMod: (m) => set({ rateMod: m }),
  mlBootstrap: 1000,
  setMlBootstrap: (n) => set({ mlBootstrap: n }),
  mlThreads: 'AUTO',
  setMlThreads: (t) => set({ mlThreads: t }),
  mlSeed: null,
  setMlSeed: (s) => set({ mlSeed: s }),
  mlOutgroup: '',
  setMlOutgroup: (s) => set({ mlOutgroup: s }),
  mlGammaCats: 4,
  setMlGammaCats: (k) => set({ mlGammaCats: k }),
  mlFreeRateCats: 3,
  setMlFreeRateCats: (k) => set({ mlFreeRateCats: k }),

  skylineParams: { model: 'skyline', groups: 5, chain: 10000000 },
  setSkylineParams: (p) => set({ skylineParams: p }),
  skyline: null,
  setSkyline: (s) => set({ skyline: s }),

  // 系统动态（phylodynamics）
  phyloParams: { model: 'skyline', groups: 5, genTime: 1 },
  setPhyloParams: (p) => set({ phyloParams: p }),
  phylodynamics: null as PhylodynamicsResult | null,
  setPhylodynamics: (p) => set({ phylodynamics: p }),

  labels: [],
  distMat: null,
  setDist: (labels, m) => set({ labels, distMat: m }),

  tree: null,
  newick: '',
  setTree: (t, nwk) => set({ tree: t, newick: nwk }),

  note: '',
  setNote: (s) => set({ note: s }),

  log: [],
  pushLog: (msg, kind) =>
    set((s) => ({ log: [...s.log, { t: new Date().toLocaleTimeString(), msg, kind }] })),
  clearLog: () => set({ log: [] }),
}))

// Translator hook: returns a `t(key, vars?)` bound to the current language.
export function useT() {
  const lang = useStore((s) => s.lang)
  return getT(lang)
}

// ---------------------------------------------------------------------------
// IQ-TREE2 模型字符串拼接：把引擎基础模型（GTR / HKY / JC69 ...）与速率修饰符
// 组合成 IQ-TREE2 接受的模型名，如 GTR+G4、HKY+I+G4、LG+R3。
//   默认：none→''，I→'+I'，G→'+G4'，G+I→'+I+G4'，R→'+R3'
//   rateSuffix(opts) 让 UI 可调 Gamma 类别数（+G{N}）与 FreeRate 类别数（+R{N}）。
// ---------------------------------------------------------------------------

/** 旧版静态映射（保留兼容：用于测试或旧代码）。 */
export const RATE_SUFFIX: Record<'none' | 'I' | 'G' | 'G+I' | 'R', string> = {
  none: '',
  I: '+I',
  G: '+G4',
  'G+I': '+I+G4',
  R: '+R3',
}

/** 新版：根据 options 动态生成 IQ-TREE2 后缀（+I / +G{N} / +I+G{N} / +R{N}）。 */
export function rateSuffix(opts: {
  rateMod: 'none' | 'I' | 'G' | 'G+I' | 'R'
  gammaCats?: 2 | 4 | 8 | 16
  freeRateCats?: 2 | 3 | 4 | 5 | 6 | 10
}): string {
  const gcat = opts.gammaCats ?? 4
  const rcat = opts.freeRateCats ?? 3
  switch (opts.rateMod) {
    case 'none': return ''
    case 'I':    return '+I'
    case 'G':    return `+G${gcat}`
    case 'G+I':  return `+I+G${gcat}`
    case 'R':    return `+R${rcat}`
  }
}

export function iqtreeModel(s: EvoState): string {
  if (s.mlModelFinder) return 'MFP'
  const aa = detectSeqType(s.sequences.map((x) => x.sequence)) === 'aa'
  const base = aa ? s.engineModelAA : s.engineModelNuc
  return base + rateSuffix({
    rateMod: s.rateMod,
    gammaCats: s.mlGammaCats,
    freeRateCats: s.mlFreeRateCats,
  })
}
