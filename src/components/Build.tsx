import { useState, useMemo, useEffect } from 'react'
import { useStore, useT, EngineId, iqtreeModel } from '../store'
import { SubstModel, isAA, detectSeqType } from '../lib/distance'
import { computeDistance, buildTree } from '../lib/analysis'
import { buildTreeWithBootstrap } from '../lib/bootstrap'
import { toFasta } from '../lib/fasta'
import { tryMLBuild } from '../lib/tauri'
import { leafCount, internalNodes, parseNewickSafe, TreeNode } from '../lib/newick'
import { computeSkyline, tryBeast, computePhylodynamics, tryBeastPhylodynamics } from '../lib/beast'

// 内置引擎：核酸 10 种 + 氨基酸 7 种（随序列类型自动切换）
const NUC_MODEL_KEYS: SubstModel[] = ['pdist', 'jc69', 'k80', 'f84', 'hky', 'gtr', 'tn93', 't92', 'logdet', 'mcl']
const AA_MODEL_KEYS: SubstModel[] = ['pdist', 'poisson', 'equal', 'dayhoff', 'jtt', 'lg', 'wag']
// 外部引擎（IQ-TREE2 等）使用的模型名，与内置模型不同名；核酸 / 氨基酸分别维护
const IQ_NUC_MODELS = ['JC', 'F81', 'K80', 'HKY', 'T92', 'TN', 'TIM', 'TVM', 'SYM', 'GTR']
const IQ_AA_MODELS = [
  'Poisson', 'LG', 'WAG', 'JTT', 'Dayhoff', 'JTTDCMut',
  'mtMAM', 'mtREV', 'cpREV', 'rtREV', 'FLU', 'HIVb', 'Blosum62',
  'Q.yeast', 'Q.bird', 'Q.insect', 'Q.mammal', 'Q.plant',
]
const REP_SETS = [0, 100, 500, 1000]
const GAP_SETS: ('complete' | 'pairwise')[] = ['complete', 'pairwise']
const RAS_SETS: ('uniform' | 'gamma')[] = ['uniform', 'gamma']
const RATE_SETS: ('none' | 'I' | 'G' | 'G+I' | 'R')[] = ['none', 'I', 'G', 'G+I', 'R']
const ML_BOOT_SETS = [0, 100, 500, 1000, 5000]
const THREAD_SETS: ('AUTO' | number)[] = ['AUTO', 1, 2, 4, 8]
// 内置引擎：离散 Gamma 类别数（Yang 1994）
const GAMMA_CATS_BUILTIN: (2 | 4 | 8 | 16)[] = [2, 4, 8, 16]

const ENGINES: { id: EngineId; kind: 'builtin' | 'ml' | 'bayes' }[] = [
  { id: 'builtin', kind: 'builtin' },
  { id: 'iqtree2', kind: 'ml' },
  { id: 'raxmlng', kind: 'ml' },
  { id: 'mrbayes', kind: 'bayes' },
  { id: 'beast1', kind: 'bayes' },
  { id: 'beast2', kind: 'bayes' },
]

// 外部引擎（IQ-TREE2 / RAxML-NG / MrBayes）使用的核苷酸模型字符串，
// 在浏览器回退(builtin NJ)时映射回内置 SubstModel，保证建树逻辑可复用。
function toSubstModel(m: string): SubstModel {
  const u = m.toUpperCase()
  if (u.includes('K80') || u.includes('KIMURA')) return 'k80'
  if (u.includes('JC')) return 'jc69'
  if (u.includes('LOGDET')) return 'logdet'
  return 'pdist'
}

export default function Build() {
  const sequences = useStore((s) => s.sequences)
  const engine = useStore((s) => s.engine)
  const setEngine = useStore((s) => s.setEngine)
  const engineModelNuc = useStore((s) => s.engineModelNuc)
  const setEngineModelNuc = useStore((s) => s.setEngineModelNuc)
  const engineModelAA = useStore((s) => s.engineModelAA)
  const setEngineModelAA = useStore((s) => s.setEngineModelAA)
  const mlModelFinder = useStore((s) => s.mlModelFinder)
  const setMlModelFinder = useStore((s) => s.setMlModelFinder)
  const model = useStore((s) => s.model)
  const setModel = useStore((s) => s.setModel)
  const method = useStore((s) => s.method)
  const setMethod = useStore((s) => s.setMethod)
  const setTree = useStore((s) => s.setTree)
  const tree = useStore((s) => s.tree)
  const newick = useStore((s) => s.newick)
  const setView = useStore((s) => s.setView)
  const pushLog = useStore((s) => s.pushLog)
  const lang = useStore((s) => s.lang)
  const bootstrapReps = useStore((s) => s.bootstrapReps)
  const setBootstrapReps = useStore((s) => s.setBootstrapReps)
  const gapMode = useStore((s) => s.gapMode)
  const setGapMode = useStore((s) => s.setGapMode)
  const rasMode = useStore((s) => s.rasMode)
  const setRasMode = useStore((s) => s.setRasMode)
  const gammaAlpha = useStore((s) => s.gammaAlpha)
  const setGammaAlpha = useStore((s) => s.setGammaAlpha)
  const gammaCats = useStore((s) => s.gammaCats)
  const setGammaCats = useStore((s) => s.setGammaCats)
  const pinvEnabled = useStore((s) => s.pinvEnabled)
  const setPinvEnabled = useStore((s) => s.setPinvEnabled)
  const pinv = useStore((s) => s.pinv)
  const setPinv = useStore((s) => s.setPinv)
  const rateMod = useStore((s) => s.rateMod)
  const setRateMod = useStore((s) => s.setRateMod)
  const mlBootstrap = useStore((s) => s.mlBootstrap)
  const setMlBootstrap = useStore((s) => s.setMlBootstrap)
  const mlThreads = useStore((s) => s.mlThreads)
  const setMlThreads = useStore((s) => s.setMlThreads)
  const mlSeed = useStore((s) => s.mlSeed)
  const setMlSeed = useStore((s) => s.setMlSeed)
  const mlOutgroup = useStore((s) => s.mlOutgroup)
  const setMlOutgroup = useStore((s) => s.setMlOutgroup)
  const mlGammaCats = useStore((s) => s.mlGammaCats)
  const setMlGammaCats = useStore((s) => s.setMlGammaCats)
  const mlFreeRateCats = useStore((s) => s.mlFreeRateCats)
  const setMlFreeRateCats = useStore((s) => s.setMlFreeRateCats)
  const t = useT()
  const [busy, setBusy] = useState(false)

  // 序列类型自动检测：核酸 -> 7 核酸模型；氨基酸 -> 7 氨基酸模型
  const seqType = useMemo(() => detectSeqType(sequences.map((s) => s.sequence)), [sequences])
  const modelKeys = seqType === 'aa' ? AA_MODEL_KEYS : NUC_MODEL_KEYS
  // IQ-TREE2 等外部引擎：核酸 / 氨基酸两套模型名，随序列类型切换
  const iqModels = seqType === 'aa' ? IQ_AA_MODELS : IQ_NUC_MODELS
  const iqModel = seqType === 'aa' ? engineModelAA : engineModelNuc
  const setIqModel = (m: string) => (seqType === 'aa' ? setEngineModelAA(m) : setEngineModelNuc(m))
  const iqFallbackModel = mlModelFinder
    ? seqType === 'aa' ? 'poisson' : 'k80'
    : toSubstModel(iqModel)

  // 模型必须与序列类型匹配：氨基酸序列改用 AA 模型，反之用核酸模型（避免退化树）
  useEffect(() => {
    if (seqType === 'aa' && !isAA(model)) setModel('pdist')
    else if (seqType === 'nt' && isAA(model)) setModel('k80')
  }, [seqType, model, setModel])

  if (!sequences.length) {
    return (
      <div className="view">
        <div className="view-head"><h2>{t('build.title')}</h2></div>
        <div className="empty">{t('build.empty')}</div>
      </div>
    )
  }

  const engLabel = t('engineLabel.' + engine)
  const engKind = ENGINES.find((e) => e.id === engine)?.kind ?? 'builtin'
  const isBayes = engine === 'beast1' || engine === 'beast2' || engine === 'mrbayes'
  const isBeast = engine === 'beast1' || engine === 'beast2'

  const run = async () => {
    setBusy(true)
    const reps = bootstrapReps > 0 ? bootstrapReps : 0
    const repsStr = reps > 0 ? (lang === 'en' ? `, reps=${reps}` : `，重复=${reps} 次`) : ''
    const modelLabel = engine === 'builtin'
      ? t('mdl.' + (seqType === 'aa' && !isAA(model) ? 'pdist' : model))
      : (mlModelFinder ? 'MFP' : iqModel)
    pushLog(t('log.buildStart', { model: modelLabel, method: engLabel, reps: repsStr }))
    await new Promise((r) => setTimeout(r, 10))

    let tree!: TreeNode
    let newick = ''

    if (engine === 'builtin') {
      // 确保模型与序列类型匹配（氨基酸序列需用 AA 模型，反之用核酸模型）
      const effModel = seqType === 'aa' && !isAA(model) ? 'pdist' : model
      const opts = {
        gammaAlpha: rasMode === 'gamma' ? gammaAlpha : 0,
        gammaCats,
        pinvEnabled,
        pinv,
        gapMode,
      }
      const { labels, matrix } = computeDistance(sequences, effModel, opts)
      if (reps > 0) {
        const res = buildTreeWithBootstrap(sequences, effModel, method, reps, opts)
        tree = res.tree
        newick = res.newick
      } else {
        const r = buildTree(labels, matrix, method)
        tree = r.tree
        newick = r.newick
      }
    } else if (engine === 'beast1' || engine === 'beast2') {
      // 贝叶斯：浏览器下以 NJ 拓扑作可视化近似；真实 MCMC 与天际线由「高级结果」给出
      const { labels, matrix } = computeDistance(sequences, iqFallbackModel)
      const r = buildTree(labels, matrix, 'NJ')
      tree = r.tree
      newick = r.newick
      pushLog(t('build.bayesNote'))
    } else if (engine === 'iqtree2') {
      // IQ-TREE2：拼接模型修饰符并透传全部参数（当前仍走内置 run_iqtree 产出树）
      const modelStr = iqtreeModel(useStore.getState())
      // 即使浏览器预览回退到 NJ，也把将要执行的 IQ-TREE2 命令参数记录下来以便核对
      pushLog(t('log.mlModel', { model: modelStr, boot: mlBootstrap, th: mlThreads, og: mlOutgroup || '—' }))
      const nwk = await tryMLBuild(toFasta(sequences), {
        model: modelStr,
        bootstrap: mlBootstrap,
        threads: mlThreads,
        seed: mlSeed,
        outgroup: mlOutgroup,
      })
      if (nwk) {
        tree = parseNewickSafe(nwk)
        newick = nwk
      } else {
        const { labels, matrix } = computeDistance(sequences, iqFallbackModel)
        const r = buildTree(labels, matrix, 'NJ')
        tree = r.tree
        newick = r.newick
        pushLog(t('build.fallback', { eng: engLabel }), 'warn')
      }
    } else {
      // RAxML-NG / MrBayes：优先调用外部引擎，不可用回退到内置 NJ
      const nwk = await tryMLBuild(toFasta(sequences), {
        model: iqModel,
        bootstrap: bootstrapReps,
        threads: 'AUTO',
        seed: null,
        outgroup: '',
      })
      if (nwk) {
        tree = parseNewickSafe(nwk)
        newick = nwk
      } else {
        const { labels, matrix } = computeDistance(sequences, iqFallbackModel)
        const r = buildTree(labels, matrix, 'NJ')
        tree = r.tree
        newick = r.newick
        pushLog(t('build.fallback', { eng: engLabel }), 'warn')
      }
    }

    setTree(tree, newick)
    const sup = internalNodes(tree).filter((n) => n.bootstrap != null).length
    const supStr = reps > 0 && engine === 'builtin' ? t('log.buildReps', { n: sup }) : ''
    pushLog(t('log.buildDone', { leaves: leafCount(tree), internal: internalNodes(tree).length, sup: supStr }), 'ok')
    setBusy(false)
  }

  const nLeaves = tree ? leafCount(tree) : 0
  const pill = (on: boolean) => `tab-btn ${on ? 'active' : ''}`

  return (
    <div className="view">
      <div className="view-head">
        <h2>{t('build.title')}</h2>
        <div className="view-actions">
          <button className="btn" onClick={() => setView('sequences')}>{t('build.back')}</button>
          <button className="btn primary" onClick={run} disabled={busy || !sequences.length}>
            {busy ? t('build.busy') : t('build.run')}
          </button>
        </div>
      </div>

      <div className="build-cols">
        <div className="build-left">
          {/* 推理引擎：无卡片直接布局（与 Seq Analyze 同构的平行按钮设计），点击切换下方参数 */}
          <div className="build-section">
            <h2 className="build-section-title">{t('build.engineTitle')}</h2>
            <p className="cfg-note">{t('build.engineSub')}</p>

            <div className="analyze-tabs">
              <button className={pill(engine === 'builtin')} onClick={() => setEngine('builtin')}>
                {t('engineLabel.builtin')}
              </button>
              <button className={pill(engine === 'iqtree2')} onClick={() => setEngine('iqtree2')}>
                {t('engineLabel.iqtree2')}
              </button>
              <button className={pill(engine === 'raxmlng')} onClick={() => setEngine('raxmlng')}>
                {t('engineLabel.raxmlng')}
              </button>
              <button className={pill(engine === 'mrbayes')} onClick={() => setEngine('mrbayes')}>
                {t('engineLabel.mrbayes')}
              </button>
              <button className={pill(engine === 'beast1')} onClick={() => setEngine('beast1')}>
                {t('engineLabel.beast1')}
              </button>
              <button className={pill(engine === 'beast2')} onClick={() => setEngine('beast2')}>
                {t('engineLabel.beast2')}
              </button>
            </div>

            <p className="cfg-note" style={{ marginTop: 10 }}>{t('engineDesc.' + (engine === 'beast2' ? 'beast2' : engKind))}</p>
          </div>

          {/* 参数：随引擎变化，统一 pill 按钮样式 */}
          {engine === 'builtin' ? (
            <>
              <div className="cfg-block">
                <h3>{t('build.modelTitle')}</h3>
                <div className="build-pill-row">
                  {modelKeys.map((m) => (
                    <button key={m} className={pill(model === m)} onClick={() => setModel(m)}>
                      {t('mdl.' + m)}
                    </button>
                  ))}
                </div>
                <p className="cfg-note" style={{ marginTop: 10 }}>{t('mdl.' + model + '.desc')}</p>
              </div>
              <div className="cfg-block">
                <h3>{t('build.gapTitle')}</h3>
                <div className="build-pill-row">
                  {GAP_SETS.map((g) => (
                    <button key={g} className={pill(gapMode === g)} onClick={() => setGapMode(g)}>
                      {t('build.gap' + (g === 'complete' ? 'Complete' : 'Pairwise'))}
                    </button>
                  ))}
                </div>
                <p className="cfg-note" style={{ marginTop: 10 }}>
                  {t('build.gap' + (gapMode === 'complete' ? 'Complete' : 'Pairwise') + '.desc')}
                </p>
              </div>
              <div className="cfg-block">
                <h3>{t('build.rateTitle')}</h3>
                <div className="build-pill-row">
                  {RAS_SETS.map((r) => (
                    <button key={r} className={pill(rasMode === r)} onClick={() => setRasMode(r)}>
                      {t('build.rate' + (r === 'uniform' ? 'Uniform' : 'Gamma'))}
                    </button>
                  ))}
                </div>
                {rasMode === 'gamma' && (
                  <div className="adv-inline" style={{ marginTop: 10 }}>
                    <label className="adv-field-label">{t('build.gammaAlpha')}</label>
                    <input
                      className="sel-input adv-num"
                      type="number"
                      min={0.1}
                      max={10}
                      step={0.1}
                      value={gammaAlpha}
                      onChange={(e) => setGammaAlpha(Math.max(0.1, Number(e.target.value) || 1))}
                    />
                    <label className="adv-field-label">{t('build.gammaCats')}</label>
                    <div className="build-pill-row">
                      {GAMMA_CATS_BUILTIN.map((k) => (
                        <button key={k} className={pill(gammaCats === k)} onClick={() => setGammaCats(k)}>
                          {k}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {/* +I 不变位点（Lewis 2001）—— 仅当启用了 Gamma 或显式开启时显示 */}
                <div className="adv-inline" style={{ marginTop: 10 }}>
                  <label className="adv-field-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={pinvEnabled}
                      onChange={(e) => setPinvEnabled(e.target.checked)}
                    />
                    {t('build.invSites')}
                  </label>
                  {pinvEnabled && (
                    <input
                      className="sel-input adv-num"
                      type="number"
                      min={0}
                      max={0.5}
                      step={0.01}
                      value={pinv}
                      onChange={(e) => setPinv(Math.max(0, Math.min(0.5, Number(e.target.value) || 0.1)))}
                    />
                  )}
                </div>
              </div>
              <div className="cfg-block">
                <h3>{t('build.methodTitle')}</h3>
                <div className="build-pill-row">
                  {(['NJ', 'UPGMA'] as const).map((m) => (
                    <button key={m} className={pill(method === m)} onClick={() => setMethod(m)}>
                      {t('method.' + m)}
                    </button>
                  ))}
                </div>
                <p className="cfg-note" style={{ marginTop: 10 }}>{t('method.' + method + '.desc')}</p>
              </div>
              <div className="cfg-block">
                <h3>{t('build.bootTitle')}</h3>
                <p className="cfg-note">{t('build.bootNote')}</p>
                <div className="build-pill-row">
                  {REP_SETS.map((r) => (
                    <button key={r} className={pill(bootstrapReps === r)} onClick={() => setBootstrapReps(r)}>
                      {r === 0 ? t('build.optNone') : t('build.optReps', { n: r })}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="cfg-block">
                <label className="adv-check">
                  <input
                    type="checkbox"
                    checked={mlModelFinder}
                    onChange={(e) => setMlModelFinder(e.target.checked)}
                  />
                  {t('build.mlModelFinder')}
                </label>
                <p className="cfg-note">{t('build.mlModelFinderDesc')}</p>
              </div>
              <div className="cfg-block">
                <h3>{t('build.modelIQ')}</h3>
                <p className="cfg-note">{seqType === 'aa' ? t('build.modelIQAA') : t('build.modelIQNuc')}</p>
                <select
                  className="sel-input"
                  value={iqModel}
                  disabled={mlModelFinder}
                  onChange={(e) => setIqModel(e.target.value)}
                >
                  {iqModels.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              {isBayes ? (
                <>
                  <div className="cfg-block">
                    <p className="cfg-note">{t('build.bayesNote')}</p>
                  </div>
                  {isBeast && (
                    <div className="cfg-block">
                      <h3>{t('build.beastPanel')}</h3>
                      <p className="cfg-note">{t('build.beastPanelSub')}</p>
                      <BeastInline engine={engine} />
                    </div>
                  )}
                </>
              ) : engine === 'iqtree2' ? (
                <>
                  <div className="cfg-block">
                    <h3>{t('build.mlRateTitle')}</h3>
                    <p className="cfg-note">{t('build.bootNote')}</p>
                    <div className="build-pill-row">
                      {RATE_SETS.map((r) => (
                        <button key={r} className={pill(rateMod === r)} disabled={mlModelFinder} onClick={() => setRateMod(r)}>
                          {r === 'none' ? t('build.optNone') : r}
                        </button>
                      ))}
                    </div>
                    {(rateMod === 'G' || rateMod === 'G+I') && (
                      <div className="adv-inline" style={{ marginTop: 10 }}>
                        <label className="adv-field-label">{t('build.gammaCats')}</label>
                        <div className="build-pill-row">
                          {GAMMA_CATS_BUILTIN.map((k) => (
                            <button key={k} className={pill(mlGammaCats === k)} onClick={() => setMlGammaCats(k)}>
                              {k}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {rateMod === 'R' && (
                      <div className="adv-inline" style={{ marginTop: 10 }}>
                        <label className="adv-field-label">{t('build.freeRateCats')}</label>
                        <div className="build-pill-row">
                          {([2, 3, 4, 5, 6, 10] as const).map((k) => (
                            <button
                              key={k}
                              className={pill(mlFreeRateCats === k)}
                              onClick={() => setMlFreeRateCats(k)}
                            >
                              {k}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="cfg-block">
                    <h3>{t('build.mlBootTitle')}</h3>
                    <div className="build-pill-row">
                      {ML_BOOT_SETS.map((r) => (
                        <button key={r} className={pill(mlBootstrap === r)} onClick={() => setMlBootstrap(r)}>
                          {r === 0 ? t('build.optNone') : t('build.optReps', { n: r })}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="cfg-block">
                    <h3>{t('build.mlThreads')}</h3>
                    <div className="build-pill-row">
                      {THREAD_SETS.map((th) => (
                        <button
                          key={String(th)}
                          className={pill(mlThreads === th)}
                          onClick={() => setMlThreads(th)}
                        >
                          {th === 'AUTO' ? t('build.mlThreadsAuto') : String(th)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="cfg-block">
                    <h3>{t('build.mlOutgroup')}</h3>
                    <input
                      className="sel-input"
                      list="leaf-names"
                      placeholder={t('build.mlOutgroupPh')}
                      value={mlOutgroup}
                      onChange={(e) => setMlOutgroup(e.target.value)}
                    />
                    <datalist id="leaf-names">
                      {sequences.map((s) => (
                        <option key={s.id} value={s.name} />
                      ))}
                    </datalist>
                    <p className="cfg-note" style={{ marginTop: 8 }}>
                      {t('build.mlSeed')}
                    </p>
                    <input
                      className="sel-input adv-num"
                      type="number"
                      placeholder={t('build.mlSeedPh')}
                      value={mlSeed ?? ''}
                      onChange={(e) => setMlSeed(e.target.value ? Number(e.target.value) : null)}
                    />
                  </div>
                </>
              ) : (
                <div className="cfg-block">
                  <h3>{t('build.bootTitle')}</h3>
                  <p className="cfg-note">{t('build.bootNote')}</p>
                  <div className="build-pill-row">
                    {REP_SETS.map((r) => (
                      <button key={r} className={pill(bootstrapReps === r)} onClick={() => setBootstrapReps(r)}>
                        {r === 0 ? t('build.optNone') : t('build.optReps', { n: r })}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {tree && (
            <div className="result-box">
              <h3>{t('build.resultTitle')}</h3>
              <div className="mini-stats">
                <span>{t('build.leaf')} <b>{nLeaves}</b></span>
                <span>{t('build.internal')} <b>{internalNodes(tree).length}</b></span>
                <span>{t('build.method')} <b>{engLabel}</b></span>
              </div>
              <pre className="newick">{newick}</pre>
              <div className="view-actions">
                <button className="btn primary" onClick={() => setView('tree')}>{t('build.viewTree')}</button>
                <button className="btn" onClick={() => setView('report')}>{t('build.genReport')}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// 内联 Beast 引擎的天际线 / 系统动态参数面板（先前在 AdvancedAnalysis 中）
function BeastInline({ engine }: { engine: EngineId }) {
  const t = useT()
  const sequences = useStore((s) => s.sequences)
  const params = useStore((s) => s.skylineParams)
  const setParams = useStore((s) => s.setSkylineParams)
  const setSkyline = useStore((s) => s.setSkyline)
  const phyloParams = useStore((s) => s.phyloParams)
  const setPhyloParams = useStore((s) => s.setPhyloParams)
  const setPhylodynamics = useStore((s) => s.setPhylodynamics)
  const pushLog = useStore((s) => s.pushLog)
  const [tab, setTab] = useState<'skyline' | 'phylo'>('skyline')
  const [busy, setBusy] = useState(false)
  const MODELS = ['constant', 'exponential', 'skyline'] as const
  const pill = (on: boolean) => `tab-btn ${on ? 'active' : ''}`

  const runSkyline = async () => {
    if (!sequences.length) return
    setBusy(true)
    const fasta = toFasta(sequences)
    let res = await tryBeast(fasta, params, engine)
    if (!res) res = computeSkyline(sequences, params)
    setSkyline(res)
    pushLog(`${t('adv.result')} (${engine})`, 'ok')
    setBusy(false)
  }
  const runPhylo = async () => {
    if (!sequences.length) return
    setBusy(true)
    const fasta = toFasta(sequences)
    let res = await tryBeastPhylodynamics(fasta, phyloParams, engine)
    if (!res) res = computePhylodynamics(sequences, phyloParams)
    setPhylodynamics(res)
    pushLog(`${t('adv.phyloResult')} (${engine})`, 'ok')
    setBusy(false)
  }

  if (!sequences.length) {
    return <p className="cfg-note">{t('adv.empty')}</p>
  }

  return (
    <>
      <div className="analyze-tabs">
        <button className={pill(tab === 'skyline')} onClick={() => setTab('skyline')}>{t('adv.tabSkyline')}</button>
        <button className={pill(tab === 'phylo')} onClick={() => setTab('phylo')}>{t('adv.tabPhylo')}</button>
      </div>
      {tab === 'skyline' && (
        <div className="adv-inline">
          <label className="adv-field-label">{t('adv.model')}</label>
          <div className="build-pill-row">
            {MODELS.map((m) => (
              <button key={m} className={pill(params.model === m)} onClick={() => setParams({ ...params, model: m })}>
                {t('adv.m.' + m)}
              </button>
            ))}
          </div>
          <label className="adv-field-label">{t('adv.groups')}</label>
          <input
            className="sel-input adv-num"
            type="number"
            min={2}
            max={20}
            value={params.groups}
            onChange={(e) => setParams({ ...params, groups: Math.max(2, Math.min(20, Number(e.target.value) || 2)) })}
          />
          <label className="adv-field-label">{t('adv.chain')}</label>
          <select className="sel-input" value={params.chain} onChange={(e) => setParams({ ...params, chain: Number(e.target.value) })}>
            <option value={1000000}>1,000,000</option>
            <option value={10000000}>10,000,000</option>
            <option value={50000000}>50,000,000</option>
            <option value={100000000}>100,000,000</option>
          </select>
          <button className="btn primary adv-run" onClick={runSkyline} disabled={busy}>
            {busy ? t('adv.busy') : `▶ ${t('adv.run')}`}
          </button>
        </div>
      )}
      {tab === 'phylo' && (
        <div className="adv-inline">
          <label className="adv-field-label">{t('adv.model')}</label>
          <div className="build-pill-row">
            {MODELS.map((m) => (
              <button key={m} className={pill(phyloParams.model === m)} onClick={() => setPhyloParams({ ...phyloParams, model: m })}>
                {t('adv.m.' + m)}
              </button>
            ))}
          </div>
          <label className="adv-field-label">{t('adv.groups')}</label>
          <input
            className="sel-input adv-num"
            type="number"
            min={2}
            max={20}
            value={phyloParams.groups}
            onChange={(e) => setPhyloParams({ ...phyloParams, groups: Math.max(2, Math.min(20, Number(e.target.value) || 2)) })}
          />
          <label className="adv-field-label">{t('adv.genTime')}</label>
          <input
            className="sel-input adv-num"
            type="number"
            min={0.1}
            max={50}
            step={0.1}
            value={phyloParams.genTime}
            onChange={(e) => setPhyloParams({ ...phyloParams, genTime: Math.max(0.1, Number(e.target.value) || 1) })}
          />
          <button className="btn primary adv-run" onClick={runPhylo} disabled={busy}>
            {busy ? t('adv.busy') : `▶ ${t('adv.runPhylo')}`}
          </button>
        </div>
      )}
    </>
  )
}
