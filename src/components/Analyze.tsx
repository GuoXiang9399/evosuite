import { useState } from 'react'
import { useStore, useT } from '../store'
import { SubstModel, isAA } from '../lib/distance'
import { computeDistance } from '../lib/analysis'
import { composition, diversity } from '../lib/stats'
import { codonUsage, codonZTest, overallCodonZTest, type SelAlt } from '../lib/codon'
import { modelTest, type ModelTestResult, type ModelCriterion } from '../lib/modelselect'
import { downloadText } from '../lib/tauri'

const BASE_COLOR: Record<string, string> = { A: '#4caf82', G: '#e8b339', C: '#5b9bd5', T: '#d9694e' }

type Tab = 'composition' | 'models' | 'distance' | 'diversity' | 'codon'

// 核酸模型选项（Distance 面板用）
const NT_MODELS: { id: SubstModel; label: string }[] = [
  { id: 'pdist', label: 'p-distance' },
  { id: 'jc69', label: 'JC69' },
  { id: 'k80', label: 'K80' },
  { id: 'tn93', label: 'TN93' },
  { id: 't92', label: 'T92' },
  { id: 'logdet', label: 'LogDet' },
  { id: 'mcl', label: 'MCL' },
  { id: 'f84', label: 'F84' },
  { id: 'hky', label: 'HKY85' },
  { id: 'gtr', label: 'GTR' },
]

export default function Analyze({ full = false }: { full?: boolean }) {
  const t = useT()
  const sequences = useStore((s) => s.sequences)
  const model = useStore((s) => s.model)
  const setModel = useStore((s) => s.setModel)
  const setView = useStore((s) => s.setView)
  const pushLog = useStore((s) => s.pushLog)

  // Distance 局部选项（独立于 Build 的 store 设置）
  const [distModel, setDistModel] = useState<SubstModel>(model)
  const [gammaAlpha, setGammaAlpha] = useState(0)
  const [pinvEnabled, setPinvEnabled] = useState(false)
  const [pinv, setPinv] = useState(0.1)
  const [gapMode, setGapMode] = useState<'complete' | 'pairwise'>('complete')
  const [dist, setDist] = useState<{ labels: string[]; matrix: number[][] } | null>(null)

  // Models 局部状态
  const [criterion, setCriterion] = useState<ModelCriterion>('BIC')
  const [withGamma, setWithGamma] = useState(true)
  const [modelResult, setModelResult] = useState<ModelTestResult | null>(null)
  const [modelRunning, setModelRunning] = useState(false)

  const [active, setActive] = useState<Tab>('distance')

  const compo = composition(sequences)
  const max = dist ? Math.max(...dist.matrix.flat(), 1e-9) : 1

  const runDist = () => {
    const r = computeDistance(sequences, distModel, {
      gammaAlpha: gammaAlpha > 0 ? gammaAlpha : undefined,
      gammaCats: 4,
      pinvEnabled,
      pinv,
      gapMode,
    })
    setDist(r)
    pushLog(t('analyze.distComputed', { model: distModel }), 'ok')
  }

  const exportCsv = () => {
    if (!dist) return
    const rows = [',' + dist.labels.join(',')]
    dist.matrix.forEach((row, i) => rows.push(dist.labels[i] + ',' + row.map((v) => v.toFixed(4)).join(',')))
    downloadText('distance_matrix.csv', rows.join('\n'))
    pushLog(t('log.exportCsv'), 'ok')
  }

  const runModelTest = () => {
    if (sequences.length < 3) { pushLog(t('analyze.models.need3Seqs'), 'warn'); return }
    setModelRunning(true)
    setModelResult(null)
    // 异步运行：让 UI 先渲染 spinner
    setTimeout(() => {
      const seqs = sequences.map((s) => s.sequence)
      const names = sequences.map((s) => s.name)
      const r = modelTest(seqs, names, { criterion, withGamma })
      setModelResult(r)
      setModelRunning(false)
      if (r) pushLog(`${t('analyze.models.bestModel', { model: r.best.model })}`, 'ok')
      else pushLog(t('analyze.models.need3Seqs'), 'warn')
    }, 50)
  }

  const applyBestModel = () => {
    if (!modelResult) return
    const best = modelResult.best
    // 映射 IQ-TREE 风格模型名到 store.model 用的 NucSubstModel
    const baseMap: Record<string, SubstModel> = {
      JC: 'jc69', F81: 'jc69', K80: 'k80', HKY: 'hky', TN: 'tn93',
      TIM: 'tn93', TVM: 'gtr', SYM: 'gtr', GTR: 'gtr',
    }
    const mapped = baseMap[best.base] ?? 'gtr'
    setModel(mapped)
    pushLog(t('analyze.models.applied', { model: best.model }), 'ok')
  }

  // ===== 各分析模块面板 =====

  const CompositionBlock = (
    <div className="cfg-block">
      <h4>{t('seq.composition')}</h4>
      {/* 左表右图并排：行高由 .compo-side 统一控制为 21px，让表行 / 图行严格对齐 */}
      <div className="compo-split">
        {/* 左侧：堆叠柱状图（每条序列一行 + Mean 行，与表格行一一对应） */}
        <div className="compo-side compo-chart">
          <CompoStack compo={compo} t={t} />
        </div>
        {/* 右侧：# | Name | A | G | C | T | Len | GC%（精确计数） */}
        <div className="compo-side">
          {compo.length > 0 && (
            <table className="dist-mini compo-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('analyze.compo.colName')}</th>
                  {(['A', 'G', 'C', 'T'] as const).map((b) => (
                    <th key={b} style={{ color: BASE_COLOR[b] }}>{b}</th>
                  ))}
                  <th>{t('analyze.compo.colLen')}</th>
                  <th>{t('analyze.compo.colGc')}</th>
                </tr>
              </thead>
              <tbody>
                {compo.map((c, i) => (
                  <tr key={c.name}>
                    <td>{i + 1}</td>
                    <td className="mono" style={{ textAlign: 'left' }}>{c.name}</td>
                    {(['A', 'G', 'C', 'T'] as const).map((b) => (
                      <td key={b} title={`${b}: ${(c.freq[b] * 100).toFixed(1)}%`}>
                        {c.counts[b]}
                      </td>
                    ))}
                    <td>{c.length}</td>
                    <td>{(c.gc * 100).toFixed(1)}%</td>
                  </tr>
                ))}
                {compo.length > 1 && (() => {
                  const n = compo.length
                  const avg = (sel: (c: typeof compo[0]) => number) => compo.reduce((s, c) => s + sel(c), 0) / n
                  return (
                    <tr style={{ fontWeight: 600, background: 'var(--bg-2)' }}>
                      <td></td>
                      <td style={{ textAlign: 'left' }}>{t('analyze.compo.mean')}</td>
                      {(['A', 'G', 'C', 'T'] as const).map((b) => (
                        <td key={b}>{avg((c) => c.freq[b] * 100).toFixed(1)}%</td>
                      ))}
                      <td>{avg((c) => c.length).toFixed(0)}</td>
                      <td>{avg((c) => c.gc * 100).toFixed(1)}%</td>
                    </tr>
                  )
                })()}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )

  const ModelsBlock = (
    <div className="cfg-block">
      <h4>{t('analyze.models.title')}</h4>
      <p className="cfg-note">{t('analyze.models.note')}</p>
      <div className="opt-row">
        <label className="cfg-inline">
          {t('analyze.models.criterion')}
          <select className="sel-input" value={criterion} onChange={(e) => setCriterion(e.target.value as ModelCriterion)}>
            <option value="BIC">BIC</option>
            <option value="AICc">AICc</option>
            <option value="AIC">AIC</option>
          </select>
        </label>
        <label className="cfg-inline">
          <input type="checkbox" checked={withGamma} onChange={(e) => setWithGamma(e.target.checked)} />
          {t('analyze.models.withGamma')}
        </label>
        <button className="btn primary" onClick={runModelTest} disabled={modelRunning || sequences.length < 3}>
          {modelRunning ? t('analyze.models.running') : t('analyze.models.run')}
        </button>
        {modelResult && (
          <button className="btn" onClick={applyBestModel}>{t('analyze.models.applyBest')}</button>
        )}
      </div>
      {modelRunning && (
        <div className="cfg-spinner">{t('analyze.models.running')}</div>
      )}
      {modelResult && !modelRunning && (
        <ModelRankTable result={modelResult} criterion={criterion} t={t} />
      )}
    </div>
  )

  const DistanceBlock = (
    <div className="cfg-block">
      <h4>{t('analyze.distTitle')}</h4>
      <p className="cfg-note">{t('analyze.distNote')}</p>
      <div className="opt-row" style={{ alignItems: 'flex-end' }}>
        <label className="cfg-inline">
          {t('analyze.dist.model')}
          <select className="sel-input" value={distModel} onChange={(e) => setDistModel(e.target.value as SubstModel)}>
            {NT_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        <label className="cfg-inline">
          {t('analyze.dist.gamma')}
          <input className="num-input" type="number" min="0" step="0.1" value={gammaAlpha}
            onChange={(e) => setGammaAlpha(Number(e.target.value))} style={{ width: 70 }} />
        </label>
        <label className="cfg-inline">
          <input type="checkbox" checked={pinvEnabled} onChange={(e) => setPinvEnabled(e.target.checked)} />
          {t('analyze.dist.pinv')}
          <input className="num-input" type="number" min="0" max="0.95" step="0.05" value={pinv}
            onChange={(e) => setPinv(Number(e.target.value))} disabled={!pinvEnabled} style={{ width: 60 }} />
        </label>
        <label className="cfg-inline">
          {t('analyze.dist.gapMode')}
          <select className="sel-input" value={gapMode} onChange={(e) => setGapMode(e.target.value as 'complete' | 'pairwise')}>
            <option value="complete">{t('analyze.dist.gapComplete')}</option>
            <option value="pairwise">{t('analyze.dist.gapPairwise')}</option>
          </select>
        </label>
        <button className="btn" onClick={runDist} disabled={!sequences.length}>
          {t('analyze.compute')}
        </button>
        <button className="btn" onClick={exportCsv} disabled={!dist}>
          {t('analyze.exportCsv')}
        </button>
      </div>
      {dist && (
        <div className="dist-mini-wrap">
          <table className="dist-mini">
            <thead>
              <tr>
                <th></th>
                {dist.labels.map((l) => (
                  <th key={l} className="mono">{l.length > 3 ? l.slice(0, 3) : l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dist.matrix.map((row, i) => (
                <tr key={i}>
                  <th className="rowhead mono">{dist.labels[i].length > 3 ? dist.labels[i].slice(0, 3) : dist.labels[i]}</th>
                  {row.map((v, j) => (
                    <td
                      key={j}
                      style={{
                        background: i === j ? '#22262f' : `rgba(91,155,213,${0.12 + (v / max) * 0.6})`,
                        color: v / max > 0.55 ? '#fff' : 'inherit',
                      }}
                    >
                      {v.toFixed(2)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )

  const DiversityBlock = <DiversityPanel />
  const CodonBlock = <CodonPanel />

  const Tabs = (
    <div className="analyze-tabs">
      <button className={`tab-btn ${active === 'composition' ? 'active' : ''}`} onClick={() => setActive('composition')}>
        {t('analyze.tab.composition')}
      </button>
      <button className={`tab-btn ${active === 'models' ? 'active' : ''}`} onClick={() => setActive('models')}>
        {t('analyze.tab.models')}
      </button>
      <button className={`tab-btn ${active === 'distance' ? 'active' : ''}`} onClick={() => setActive('distance')}>
        {t('analyze.tab.distance')}
      </button>
      <button className={`tab-btn ${active === 'diversity' ? 'active' : ''}`} onClick={() => setActive('diversity')}>
        {t('analyze.tab.diversity')}
      </button>
      <button className={`tab-btn ${active === 'codon' ? 'active' : ''}`} onClick={() => setActive('codon')}>
        {t('analyze.tab.codon')}
      </button>
    </div>
  )

  // 侧栏模式（保留原堆叠布局，当前未在主流程使用）
  if (!full) {
    return (
      <aside className="analyze-panel">
        <div className="adv-head"><h3>📊 {t('analyze.title')}</h3></div>
        {CompositionBlock}
        {DistanceBlock}
        {DiversityBlock}
        {CodonBlock}
      </aside>
    )
  }

  return (
    <div className="view">
      <div className="view-head">
        <h2>{t('analyze.title')}</h2>
        <div className="view-actions">
          <button className="btn" onClick={() => setView('sequences')}>{t('analyze.back')}</button>
        </div>
      </div>
      {Tabs}
      <div className="analyze-content">
        {active === 'composition' && CompositionBlock}
        {active === 'models' && ModelsBlock}
        {active === 'distance' && DistanceBlock}
        {active === 'diversity' && DiversityBlock}
        {active === 'codon' && CodonBlock}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Model Rank Table（Models 面板）
// ---------------------------------------------------------------------------

function ModelRankTable({ result, criterion, t }: { result: ModelTestResult; criterion: ModelCriterion; t: (k: string, v?: any) => string }) {
  const scoreOf = (f: typeof result.fits[0]) =>
    criterion === 'AIC' ? f.aic : criterion === 'AICc' ? f.aicc : f.bic
  return (
    <div className="dist-mini-wrap" style={{ marginTop: 12 }}>
      <div style={{ marginBottom: 8 }}>
        <b>{t('analyze.models.bestModel', { model: result.best.model })}</b>
        <span style={{ marginLeft: 12, color: 'var(--text-faint)', fontSize: 12 }}>
          n={result.nSeqs}, sites={result.nSites}, patterns={result.nPatterns}
        </span>
      </div>
      <table className="dist-mini">
        <thead>
          <tr>
            <th>#</th>
            <th>{t('analyze.models.colModel')}</th>
            <th>{t('analyze.models.colLnL')}</th>
            <th>{t('analyze.models.colBIC')}</th>
            <th>{t('analyze.models.colAICc')}</th>
            <th>{t('analyze.models.colAIC')}</th>
            <th>{t('analyze.models.colK')}</th>
            <th>{t('analyze.models.colWeight')}</th>
            <th>{t('analyze.models.colAlpha')}</th>
          </tr>
        </thead>
        <tbody>
          {result.fits.map((f, i) => {
            const isBest = i === 0
            return (
              <tr key={f.model} style={isBest ? { background: 'rgba(76,175,130,0.18)', fontWeight: 600 } : {}}>
                <td>{i + 1}</td>
                <td className="mono">{f.model}</td>
                <td>{f.lnL.toFixed(2)}</td>
                <td>{f.bic.toFixed(2)}</td>
                <td>{f.aicc.toFixed(2)}</td>
                <td>{f.aic.toFixed(2)}</td>
                <td>{f.k}</td>
                <td>{(f.weight * 100).toFixed(1)}%</td>
                <td>{f.alpha !== null ? f.alpha.toFixed(3) : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Diversity Panel
// ---------------------------------------------------------------------------

function DiversityPanel() {
  const t = useT()
  const sequences = useStore((s) => s.sequences)
  const pushLog = useStore((s) => s.pushLog)
  const [result, setResult] = useState<ReturnType<typeof diversity> | null>(null)

  const runDiversity = () => {
    const d = diversity(sequences)
    setResult(d)
    if (d) {
      pushLog(`${t('analyze.diversity.title')}: π=${d.pi.toFixed(5)} Tajima's D=${d.tajimaD.toFixed(4)} P=${d.tajimaPval < 0.001 ? '<0.001' : d.tajimaPval.toFixed(4)}`, 'ok')
    } else {
      pushLog(t('analyze.models.need3Seqs'), 'warn')
    }
  }

  if (!result) {
    return (
      <div className="cfg-block">
        <h4>{t('analyze.diversity.title')}</h4>
        <p className="cfg-note">{t('analyze.diversity.note')}</p>
        <div className="opt-row">
          <button className="btn primary" onClick={runDiversity} disabled={sequences.length < 2}>
            {t('analyze.models.run')}
          </button>
        </div>
      </div>
    )
  }
  const d = result
  const interp = d.tajimaD > 0.5 ? t('analyze.diversity.interpPos')
    : d.tajimaD < -0.5 ? t('analyze.diversity.interpNeg')
    : t('analyze.diversity.interpNeu')
  const rows: [string, string][] = [
    [t('analyze.diversity.colN'), String(d.n)],
    [t('analyze.diversity.colL'), String(d.L)],
    [t('analyze.diversity.colS'), String(d.S)],
    [t('analyze.diversity.colEta'), String(d.eta)],
    [t('analyze.diversity.colPi'), d.pi.toFixed(5)],
    [t('analyze.diversity.colThetaW'), d.thetaW.toFixed(5)],
    [t('analyze.diversity.colK'), d.k.toFixed(3)],
    [t('analyze.diversity.colHap'), String(d.haplotypes)],
    [t('analyze.diversity.colHd'), d.hd.toFixed(4) + ' ± ' + Math.sqrt(Math.max(d.hdVar, 0)).toFixed(4)],
    [t('analyze.diversity.colTajimaD'), d.tajimaD.toFixed(4) + ' (Var=' + d.tajimaD2.toFixed(3) + ')'],
    [t('analyze.diversity.colPval'), d.tajimaPval < 0.001 ? '< 0.001' : d.tajimaPval.toFixed(4)],
  ]
  return (
    <div className="cfg-block">
      <h4>{t('analyze.diversity.title')}</h4>
      <p className="cfg-note">{t('analyze.diversity.note')}</p>
      <div className="opt-row" style={{ marginBottom: 12 }}>
        <button className="btn" onClick={runDiversity} disabled={sequences.length < 2}>
          {t('analyze.models.run')}
        </button>
      </div>
      <table className="dist-mini" style={{ marginTop: 10 }}>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th className="rowhead" style={{ textAlign: 'left', minWidth: 140 }}>{k}</th>
              <td className="mono" style={{ textAlign: 'right' }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--bg-2)', borderRadius: 4, fontSize: 12.5 }}>
        {interp}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Codon Panel（密码子使用 + Z-test）
// ---------------------------------------------------------------------------

function CodonPanel() {
  const t = useT()
  const sequences = useStore((s) => s.sequences)
  const pushLog = useStore((s) => s.pushLog)
  const [alt, setAlt] = useState<SelAlt>('neutral')
  const [mode, setMode] = useState<'pairwise' | 'overall'>('overall')
  const [ka, setKa] = useState(0)
  const [kb, setKb] = useState(1)
  const [usage, setUsage] = useState<ReturnType<typeof codonUsage> | null>(null)
  const [result, setResult] = useState<ReturnType<typeof codonZTest> | ReturnType<typeof overallCodonZTest> | null>(null)

  // 密码子使用统计：Run 按钮触发后才计算（与 Models/Distance/Diversity 交互一致）
  const top = usage
    ? Object.entries(usage.counts)
        .filter(([, c]) => c > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
    : []

  const runUsage = () => {
    const u = codonUsage(sequences)
    setUsage(u)
    if (u.total > 0) {
      pushLog(`${t('analyze.codon.usageTitle')}: ${u.total} codons · GC3=${(u.gc3 * 100).toFixed(1)}% · ENC=${u.effNum.toFixed(2)}`, 'ok')
    } else {
      pushLog(t('analyze.codon.needCodon'), 'warn')
    }
  }

  const runZTest = () => {
    let r: typeof result
    if (mode === 'pairwise') {
      const a = sequences[ka]?.sequence ?? ''
      const b = sequences[kb]?.sequence ?? ''
      r = codonZTest(a, b, alt)
    } else {
      r = overallCodonZTest(sequences, alt)
    }
    setResult(r)
    if (r) {
      pushLog(`${t('analyze.codon.zTestTitle')}: dN=${r.dN.toFixed(4)} dS=${r.dS.toFixed(4)} ω=${r.omega.toFixed(3)} P=${r.pValue.toFixed(4)}`, 'ok')
    } else {
      pushLog(t('analyze.codon.needCodon'), 'warn')
    }
  }

  const conc = result?.conclusion
  const concKey = conc === 'positive' ? 'analyze.codon.concPositive'
    : conc === 'purifying' ? 'analyze.codon.concPurifying'
    : 'analyze.codon.concNeutral'

  return (
    <div className="cfg-block">
      <h4>{t('analyze.codon.title')}</h4>
      <p className="cfg-note">{t('analyze.codon.note')}</p>

      {/* 密码子使用统计：标题行 + Run 按钮 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{t('analyze.codon.usageTitle')}</div>
        <button className="btn primary" onClick={runUsage} disabled={!sequences.length}>
          {t('analyze.codon.runUsage')}
        </button>
        {usage && usage.total > 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            {t('analyze.codon.gc3')}: <b>{(usage.gc3 * 100).toFixed(1)}%</b>
            {'  ·  '}
            {t('analyze.codon.effNum')}: <b>{usage.effNum.toFixed(2)}</b>
            {'  ·  '}
            {t('analyze.codon.total')}: <b>{usage.total}</b>
          </span>
        )}
      </div>

      {/* 左表右图：密码子使用表 | RSCU 偏好条形图 */}
      {usage && top.length > 0 ? (
        <div className="codon-split">
          <div className="codon-split-side">
            <table className="dist-mini codon-table">
              <thead>
                <tr>
                  <th>{t('analyze.codon.colCodon')}</th>
                  <th>{t('analyze.codon.colAA')}</th>
                  <th>{t('analyze.codon.colCount')}</th>
                  <th>{t('analyze.codon.colFreq')}</th>
                  <th>{t('analyze.codon.colRSCU')}</th>
                </tr>
              </thead>
              <tbody>
                {top.map(([codon, cnt]) => (
                  <tr key={codon}>
                    <td className="mono">{codon}</td>
                    <td className="mono">{aaShort(codon)}</td>
                    <td>{cnt}</td>
                    <td>{(usage.freq[codon] * 100).toFixed(2)}%</td>
                    <td>{usage.rscu[codon].toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="codon-split-side codon-chart-side">
            <RscuChart usage={usage} top={top} />
          </div>
        </div>
      ) : (
        <div className="cfg-note" style={{ marginTop: 8 }}>{t('analyze.codon.runFirst')}</div>
      )}

      {/* Z-test 面板 */}
      <div style={{ marginTop: 16, padding: '12px 0', borderTop: '1px solid var(--border)' }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{t('analyze.codon.zTestTitle')}</div>
        <div className="opt-row" style={{ alignItems: 'flex-end' }}>
          <label className="cfg-inline">
            {t('analyze.codon.altHypothesis')}
            <select className="sel-input" value={alt} onChange={(e) => setAlt(e.target.value as SelAlt)}>
              <option value="neutral">{t('analyze.codon.altNeutral')}</option>
              <option value="positive">{t('analyze.codon.altPositive')}</option>
              <option value="purifying">{t('analyze.codon.altPurifying')}</option>
            </select>
          </label>
          <label className="cfg-inline">
            {t('analyze.codon.mode')}
            <select className="sel-input" value={mode} onChange={(e) => setMode(e.target.value as 'pairwise' | 'overall')}>
              <option value="overall">{t('analyze.codon.modeOverall')}</option>
              <option value="pairwise">{t('analyze.codon.modePairwise')}</option>
            </select>
          </label>
          {mode === 'pairwise' && (
            <>
              <select className="sel-input" value={ka} onChange={(e) => setKa(Number(e.target.value))}>
                {sequences.map((s, i) => <option key={s.id} value={i}>{s.name}</option>)}
              </select>
              <span className="vs">{t('seq.vs')}</span>
              <select className="sel-input" value={kb} onChange={(e) => setKb(Number(e.target.value))}>
                {sequences.map((s, i) => <option key={s.id} value={i}>{s.name}</option>)}
              </select>
            </>
          )}
          <button className="btn primary" onClick={runZTest} disabled={!sequences.length}>
            {t('analyze.codon.runTest')}
          </button>
        </div>
        {result && (
          <div style={{ marginTop: 10 }}>
            <table className="dist-mini">
              <thead>
                <tr>
                  <th>{t('analyze.codon.colDn')}</th>
                  <th>{t('analyze.codon.colDs')}</th>
                  <th>{t('analyze.codon.colOmega')}</th>
                  <th>{t('analyze.codon.colZ')}</th>
                  <th>{t('analyze.codon.colPval')}</th>
                  <th>{t('analyze.codon.colConclusion')}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{result.dN.toFixed(4)}</td>
                  <td>{result.dS.toFixed(4)}</td>
                  <td>{isFinite(result.omega) ? result.omega.toFixed(3) : '∞'}</td>
                  <td>{result.z.toFixed(4)}</td>
                  <td>{result.pValue < 0.001 ? '< 0.001' : result.pValue.toFixed(4)}</td>
                  <td className={conc === 'positive' ? 'pos' : conc === 'purifying' ? 'neg' : ''}>
                    {t(concKey)}
                  </td>
                </tr>
              </tbody>
            </table>
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-faint)' }}>
              {t('analyze.codon.sigNote')}
            </div>
            {/* dN/dS 对比图 + ω 刻度条 */}
            <DnDsChart result={result} t={t} />
          </div>
        )}
      </div>
    </div>
  )
}

// 密码子 -> 氨基酸简写（单字母）
function aaShort(codon: string): string {
  // 复用 codon.ts 的 aaOf 逻辑（避免循环依赖，内联代码表）
  const aa = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG'
  const bases = ['T', 'C', 'A', 'G']
  let idx = -1
  for (let i = 0; i < 64; i++) {
    const b1 = bases[Math.floor(i / 16)]
    const b2 = bases[Math.floor((i % 16) / 4)]
    const b3 = bases[i % 4]
    if (b1 + b2 + b3 === codon) { idx = i; break }
  }
  return idx >= 0 ? aa[idx] : '?'
}

// ---------------------------------------------------------------------------
// RSCU 偏好条形图（水平条；RSCU>1 偏好=绿，<1 回避=蓝灰；参考线 RSCU=1）
// v0.1.1：与左侧表格逐行严格对齐 —— rowH/thead 高度均 21px，无标题偏移。
// ---------------------------------------------------------------------------

function RscuChart({ usage, top }: {
  usage: ReturnType<typeof codonUsage>
  top: [string, number][]
}) {
  const W = 520
  const labelW = 52
  const valW = 44
  // 行高与 .codon-table 行高严格一致（height 21px，box-sizing border-box）
  const rowH = 21
  const padT = 21 // 对齐表格 thead 行高
  const H = padT + top.length * rowH + 24
  const plotW = W - labelW - valW - 8
  const maxR = Math.max(1.5, ...top.map(([c]) => usage.rscu[c] || 0))
  const xOf = (v: number) => labelW + (v / maxR) * plotW
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: 'block' }} role="img">
      {/* 参考线 RSCU=1（标签画在表头高度区内） */}
      <line x1={xOf(1)} y1={padT - 2} x2={xOf(1)} y2={padT + top.length * rowH + 1}
        stroke="#ffd479" strokeWidth={1} strokeDasharray="3 3" />
      <text x={xOf(1)} y={padT - 5} fontSize={9} fill="#ffd479" textAnchor="middle">RSCU=1</text>
      {/* x 轴刻度 */}
      {[0, 0.5, 1, 1.5, 2, 3, 4].filter((v) => v <= maxR).map((v) => (
        <g key={v}>
          <line x1={xOf(v)} y1={padT + top.length * rowH + 1} x2={xOf(v)} y2={padT + top.length * rowH + 4} stroke="#5a6170" strokeWidth={0.8} />
          <text x={xOf(v)} y={padT + top.length * rowH + 14} fontSize={8.5} fill="#8a93a6" textAnchor="middle">{v}</text>
        </g>
      ))}
      {top.map(([codon], i) => {
        const rscu = usage.rscu[codon] || 0
        const y = padT + i * rowH
        const prefer = rscu >= 1
        const bw = Math.max(1, xOf(rscu) - labelW)
        return (
          <g key={codon}>
            <text x={labelW - 6} y={y + rowH / 2 + 2.5} fontSize={9} fill="var(--text-dim, #aeb6c4)"
              textAnchor="end" fontFamily="var(--mono, monospace)">{codon}</text>
            <rect x={labelW} y={y + 2} width={bw} height={rowH - 4} rx={1.5}
              fill={prefer ? '#4caf82' : '#5b9bd5'} opacity={0.85} />
            <text x={labelW + bw + 5} y={y + rowH / 2 + 2.5} fontSize={8.5} fill="#8a93a6"
              fontFamily="var(--mono, monospace)">{rscu.toFixed(2)}</text>
          </g>
        )
      })}
      {/* 图例 */}
      <g transform={`translate(${labelW}, ${H - 6})`}>
        <rect x={0} y={-7} width={9} height={9} rx={1.5} fill="#4caf82" opacity={0.85} />
        <text x={13} y={0.5} fontSize={8.5} fill="#8a93a6">RSCU ≥ 1 (preferred)</text>
        <rect x={120} y={-7} width={9} height={9} rx={1.5} fill="#5b9bd5" opacity={0.85} />
        <text x={133} y={0.5} fontSize={8.5} fill="#8a93a6">RSCU &lt; 1 (avoided)</text>
      </g>
    </svg>
  )
}

// ---------------------------------------------------------------------------
// dN/dS 对比图：左双柱（dN 红 / dS 蓝）+ 右 ω 刻度条（0-1 纯化 / 1+ 正选择）
// ---------------------------------------------------------------------------

function DnDsChart({ result, t }: {
  result: { dN: number; dS: number; omega: number; pValue: number }
  t: (k: string) => string
}) {
  const W = 520
  const H = 170
  const barPadT = 26
  const barH = H - barPadT - 40
  const maxV = Math.max(result.dN, result.dS, 0.02) * 1.15
  const yOf = (v: number) => barPadT + (1 - v / maxV) * barH
  // 左柱区
  const barX1 = 30
  const barW = 42
  // 右 ω 刻度条
  const gaugeX = 190
  const gaugeW = 300
  const gaugeY = barPadT + 30
  const gaugeH = 18
  const om = isFinite(result.omega) ? result.omega : 2.0
  const maxOm = Math.max(2, om * 1.15)
  const omX = (v: number) => gaugeX + (Math.min(v, maxOm) / maxOm) * gaugeW
  const sig = result.pValue < 0.05
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 4 }}>{t('analyze.codon.chartDnDs')}</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: 'block' }} role="img">
        {/* y 轴 */}
        <line x1={barX1 - 6} y1={barPadT} x2={barX1 - 6} y2={barPadT + barH} stroke="#5a6170" strokeWidth={0.8} />
        {[0, 0.5, 1].map((g) => {
          const v = maxV * g
          return (
            <g key={g}>
              <line x1={barX1 - 8} y1={yOf(v)} x2={barX1 - 4} y2={yOf(v)} stroke="#5a6170" strokeWidth={0.8} />
              <text x={barX1 - 11} y={yOf(v) + 3} fontSize={8.5} fill="#8a93a6" textAnchor="end" fontFamily="var(--mono, monospace)">{v.toFixed(3)}</text>
            </g>
          )
        })}
        {/* dN 柱 */}
        <rect x={barX1} y={yOf(result.dN)} width={barW} height={Math.max(1, barPadT + barH - yOf(result.dN))} fill="#d9694e" rx={1.5} />
        <text x={barX1 + barW / 2} y={yOf(result.dN) - 4} fontSize={9} fill="#d9694e" textAnchor="middle" fontFamily="var(--mono, monospace)">{result.dN.toFixed(4)}</text>
        <text x={barX1 + barW / 2} y={barPadT + barH + 12} fontSize={9.5} fill="var(--text-dim, #aeb6c4)" textAnchor="middle">dN</text>
        {/* dS 柱 */}
        <rect x={barX1 + barW + 18} y={yOf(result.dS)} width={barW} height={Math.max(1, barPadT + barH - yOf(result.dS))} fill="#5b9bd5" rx={1.5} />
        <text x={barX1 + barW + 18 + barW / 2} y={yOf(result.dS) - 4} fontSize={9} fill="#5b9bd5" textAnchor="middle" fontFamily="var(--mono, monospace)">{result.dS.toFixed(4)}</text>
        <text x={barX1 + barW + 18 + barW / 2} y={barPadT + barH + 12} fontSize={9.5} fill="var(--text-dim, #aeb6c4)" textAnchor="middle">dS</text>
        {/* ω 刻度条 */}
        <text x={gaugeX} y={gaugeY - 8} fontSize={9.5} fill="var(--text-dim, #aeb6c4)">ω = dN/dS</text>
        {/* 纯化区 0..1 */}
        <rect x={gaugeX} y={gaugeY} width={omX(1) - gaugeX} height={gaugeH} fill="#5b9bd5" opacity={0.28} rx={2} />
        {/* 正选择区 1..max */}
        <rect x={omX(1)} y={gaugeY} width={gaugeX + gaugeW - omX(1)} height={gaugeH} fill="#d9694e" opacity={0.28} rx={2} />
        {/* 中性虚线 ω=1 */}
        <line x1={omX(1)} y1={gaugeY - 4} x2={omX(1)} y2={gaugeY + gaugeH + 4} stroke="#ffd479" strokeWidth={1.2} strokeDasharray="3 2" />
        <text x={omX(1)} y={gaugeY + gaugeH + 14} fontSize={8.5} fill="#ffd479" textAnchor="middle">1.0</text>
        {/* 当前 ω 标记 */}
        <circle cx={omX(om)} cy={gaugeY + gaugeH / 2} r={sig ? 6 : 5}
          fill={om < 1 ? '#5b9bd5' : om > 1 ? '#d9694e' : '#ffd479'}
          stroke={sig ? '#fff' : 'none'} strokeWidth={1.2} />
        <text x={omX(om)} y={gaugeY - 8} fontSize={10} fontWeight={sig ? 700 : 500}
          fill={om < 1 ? '#5b9bd5' : om > 1 ? '#d9694e' : '#ffd479'} textAnchor="middle"
          fontFamily="var(--mono, monospace)">{isFinite(result.omega) ? om.toFixed(3) : '∞'}</text>
        {/* 区标签 */}
        <text x={gaugeX + 6} y={gaugeY + gaugeH - 5} fontSize={8.5} fill="#8a93a6">{t('analyze.codon.zonePurifying')}</text>
        <text x={gaugeX + gaugeW - 6} y={gaugeY + gaugeH - 5} fontSize={8.5} fill="#8a93a6" textAnchor="end">{t('analyze.codon.zonePositive')}</text>
        {/* 刻度 0 与 max */}
        <text x={gaugeX} y={gaugeY + gaugeH + 14} fontSize={8.5} fill="#8a93a6" textAnchor="middle">0</text>
        <text x={gaugeX + gaugeW} y={gaugeY + gaugeH + 14} fontSize={8.5} fill="#8a93a6" textAnchor="end">{maxOm.toFixed(1)}</text>
      </svg>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Composition 左图右表：堆叠水平条（每条序列一行 + Mean 行，与右侧表行逐一对齐）
// v0.1.1：行高/表头高均 21px，与 .compo-table 严格一致。
// ---------------------------------------------------------------------------

function CompoStack({ compo, t }: {
  compo: ReturnType<typeof composition>
  t: (k: string, v?: any) => string
}) {
  const rowH = 21   // 与 .compo-table 行高严格一致
  const labelW = 70
  const valW = 38
  const barH = 12
  const padT = 21   // 对齐表格 thead 行高
  const W = 320
  const hasMean = compo.length > 1
  const nRows = compo.length + (hasMean ? 1 : 0)
  const H = padT + nRows * rowH + 6
  const plotW = W - labelW - valW - 8

  // Mean 行（与右表 Mean 行同口径）
  const meanFreq: Record<string, number> = {}
  let meanGc = 0
  if (hasMean) {
    const n = compo.length
    for (const b of ['A', 'G', 'C', 'T'] as const) {
      meanFreq[b] = compo.reduce((s, c) => s + c.freq[b], 0) / n
    }
    meanGc = compo.reduce((s, c) => s + c.gc, 0) / n
  }

  const renderRow = (key: string, label: string, freq: Record<string, number>, gc: number, isMean: boolean) => {
    const y = padT + rowIdx * rowH
    const ny = y + (rowH - barH) / 2
    let x = labelW
    const segs = (['A', 'G', 'C', 'T'] as const).map((b) => {
      const w = freq[b] * plotW
      const seg = <rect key={b} x={x} y={ny} width={w} height={barH}
        fill={BASE_COLOR[b]} opacity={0.92} />
      x += w
      return seg
    })
    return (
      <g key={key}>
        <text x={labelW - 4} y={y + rowH / 2 + 3} fontSize={9}
          fill={isMean ? 'var(--text, #14243B)' : 'var(--text-dim, #aeb6c4)'}
          fontWeight={isMean ? 600 : 400}
          textAnchor="end" fontFamily="var(--mono, monospace)">
          {label.length > 9 ? label.slice(0, 9) + '…' : label}
        </text>
        {segs}
        <rect x={labelW} y={ny} width={plotW} height={barH} fill="none"
          stroke="color-mix(in srgb, var(--border) 80%, transparent)" strokeWidth={0.4} rx={1.5} />
        <text x={W - valW + 4} y={y + rowH / 2 + 3} fontSize={9} fill="var(--text-dim, #aeb6c4)"
          textAnchor="end" fontFamily="var(--mono, monospace)">
          {(gc * 100).toFixed(0)}%
        </text>
      </g>
    )
  }

  let rowIdx = 0
  const rows: JSX.Element[] = []
  for (const c of compo) {
    rows.push(renderRow(c.name, c.name, c.freq, c.gc, false))
    rowIdx++
  }
  if (hasMean) {
    rows.push(renderRow('__mean__', t('analyze.compo.mean'), meanFreq, meanGc, true))
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: 'block' }} role="img"
      aria-label="Base composition stacked bar chart">
      {/* 列头（画在表头高度区内） */}
      <text x={labelW - 4} y={padT - 6} fontSize={9} fill="var(--text-faint, #aeb6c4)" textAnchor="end">
        {(['A', 'G', 'C', 'T'] as const).join(' ')}
      </text>
      <text x={W - valW + 4} y={padT - 6} fontSize={9} fill="var(--text-faint, #aeb6c4)" textAnchor="end">GC%</text>
      {rows}
    </svg>
  )
}
