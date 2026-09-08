import { useState } from 'react'
import { useStore, useT, EngineId } from '../store'
import { toFasta } from '../lib/fasta'
import {
  SkylineChart, PhyloCard, CoalescentChart,
} from './AdvancedCharts'
import {
  computeSkyline, tryBeast, SkylineResult,
  computePhylodynamics, tryBeastPhylodynamics, PhylodynamicsResult,
} from '../lib/beast'

type Tab = 'skyline' | 'phylo'

// 高级结果按引擎设计：每个引擎独立保留一份 skyline / phylo 结果，避免 BEAST1/BEAST2 互相覆盖
interface EngineResults {
  skyline?: SkylineResult
  phylo?: PhylodynamicsResult
}
const RESULTS_INIT: EngineResults = {}

export default function AdvancedResult() {
  const t = useT()
  const lang = useStore((s) => s.lang)
  const sequences = useStore((s) => s.sequences)
  const skylineParams = useStore((s) => s.skylineParams)
  const setSkylineParams = useStore((s) => s.setSkylineParams)
  const phyloParams = useStore((s) => s.phyloParams)
  const setPhyloParams = useStore((s) => s.setPhyloParams)
  const setView = useStore((s) => s.setView)
  const pushLog = useStore((s) => s.pushLog)
  const [tab, setTab] = useState<Tab>('skyline')
  // 当前选中的引擎：默认跟随 store.engine；运行结果按引擎 key 独立保存
  const [selectedEngine, setSelectedEngine] = useState<EngineId>(useStore.getState().engine)
  // 每引擎独立结果集：{builtin: {...}, beast1: {...}, beast2: {...}}
  const [results, setResults] = useState<Record<string, EngineResults>>({})
  const [busy, setBusy] = useState(false)
  const [logOpen, setLogOpen] = useState(false)

  const current = results[selectedEngine] || RESULTS_INIT
  const pill = (on: boolean) => `tab-btn ${on ? 'active' : ''}`

  const ENGINES: { id: EngineId; key: 'beast1' | 'beast2' | 'builtin' }[] = [
    { id: 'beast1', key: 'beast1' },
    { id: 'beast2', key: 'beast2' },
    { id: 'builtin', key: 'builtin' },
  ]

  const setResult = (key: 'skyline' | 'phylo', value: any) => {
    setResults((prev) => ({
      ...prev,
      [selectedEngine]: { ...(prev[selectedEngine] || {}), [key]: value },
    }))
  }

  const runSkyline = async () => {
    if (!sequences.length) return
    setBusy(true)
    const fasta = toFasta(sequences)
    let res: SkylineResult | null = null
    if (selectedEngine === 'beast1' || selectedEngine === 'beast2') {
      res = await tryBeast(fasta, skylineParams, selectedEngine)
    }
    if (!res) res = computeSkyline(sequences, skylineParams)
    setResult('skyline', res)
    pushLog(
      res.fromEngine
        ? `${t('adv.result')} · ${selectedEngine} (${t('adv.fromEngine')})`
        : `${t('adv.result')} · ${t('adv.fallback')}`,
      'ok'
    )
    setBusy(false)
  }

  const runPhylo = async () => {
    if (!sequences.length) return
    setBusy(true)
    const fasta = toFasta(sequences)
    let res: PhylodynamicsResult | null = null
    if (selectedEngine === 'beast1' || selectedEngine === 'beast2') {
      res = await tryBeastPhylodynamics(fasta, phyloParams, selectedEngine)
    }
    if (!res) res = computePhylodynamics(sequences, phyloParams, current.skyline)
    setResult('phylo', res)
    pushLog(
      res.fromEngine
        ? `${t('adv.phyloResult')} · ${selectedEngine} (${t('adv.fromEngine')})`
        : `${t('adv.phyloResult')} · ${t('adv.fallback')}`,
      'ok'
    )
    setBusy(false)
  }

  return (
    <div className="view">
      <div className="view-head">
        <h2>{t('adv.title')}</h2>
        <div className="view-actions">
          <button className="btn" onClick={() => setView('build')}>{t('adv.back')}</button>
        </div>
      </div>

      {!sequences.length ? (
        <div className="empty">{t('adv.empty')}</div>
      ) : (
        <>
          {/* 引擎选择：最顶部，按引擎独立管理结果（与 Build Tree 同构） */}
          <div className="cfg-block">
            <h3>{t('adv.engineTitle')}</h3>
            <p className="cfg-note">{t('adv.engineSub')}</p>
            <div className="analyze-tabs">
              {ENGINES.map((e) => (
                <button
                  key={e.id}
                  className={pill(selectedEngine === e.id)}
                  onClick={() => setSelectedEngine(e.id)}
                >
                  {t('engineLabel.' + e.id)}
                </button>
              ))}
            </div>
            <p className="cfg-note" style={{ marginTop: 10 }}>
              {t('engineDesc.' + (selectedEngine === 'beast1' || selectedEngine === 'beast2' ? selectedEngine : 'bayes'))}
            </p>
          </div>

          {/* 结果 / Skyline / Phylo 切换 */}
          <div className="analyze-tabs">
            <button className={pill(tab === 'skyline')} onClick={() => setTab('skyline')}>
              {t('adv.tabSkyline')}
            </button>
            <button className={pill(tab === 'phylo')} onClick={() => setTab('phylo')}>
              {t('adv.tabPhylo')}
            </button>
            <span className="tab-spacer" />
            <button
              className="btn tiny"
              onClick={() => setLogOpen(!logOpen)}
              disabled={!current.skyline && !current.phylo}
            >
              {logOpen ? '▾' : '▸'} {t('adv.mcmcLog')}
            </button>
          </div>

          {/* MCMC log 区：折叠展示。真实引擎时显示 treeModel.rootHeight / skyline.N 摘要；内置近似时显示生成参数 */}
          {logOpen && (current.skyline || current.phylo) && (
            <div className="cfg-block adv-log">
              <h3>{t('adv.mcmcLogTitle')}</h3>
              {current.skyline && (
                <div className="adv-log-row">
                  <span className="adv-log-key">skyline.N</span>
                  <span className="mono">[{current.skyline.ne.slice(0, 6).map((v) => v.toFixed(2)).join(', ')}{current.skyline.ne.length > 6 ? ', …' : ''}]</span>
                </div>
              )}
              {current.phylo && (
                <>
                  <div className="adv-log-row">
                    <span className="adv-log-key">treeModel.rootHeight</span>
                    <span className="mono">{current.phylo.tmrca.toFixed(4)}</span>
                  </div>
                  <div className="adv-log-row">
                    <span className="adv-log-key">R0</span>
                    <span className="mono">{current.phylo.R0.toFixed(2)}</span>
                  </div>
                </>
              )}
              <div className="adv-log-row">
                <span className="adv-log-key">generatedAt</span>
                <span className="mono">{(current.skyline?.generatedAt ?? current.phylo?.generatedAt ?? '').slice(0, 19)}</span>
              </div>
              <div className="adv-log-row">
                <span className="adv-log-key">source</span>
                <span className="mono">
                  {(current.skyline?.fromEngine || current.phylo?.fromEngine) ? t('adv.fromEngine') : t('adv.fallback')}
                </span>
              </div>
            </div>
          )}

          {tab === 'skyline' && (
            <div className="adv-result-pane">
              {/* 参数 + Run 按钮 */}
              <div className="adv-inline">
                <label className="adv-field-label">{t('adv.model')}</label>
                <div className="build-pill-row">
                  {(['constant', 'exponential', 'skyline'] as const).map((m) => (
                    <button
                      key={m}
                      className={pill(skylineParams.model === m)}
                      onClick={() => setSkylineParams({ ...skylineParams, model: m })}
                    >
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
                  value={skylineParams.groups}
                  onChange={(e) => setSkylineParams({ ...skylineParams, groups: Math.max(2, Math.min(20, Number(e.target.value) || 2)) })}
                />
                <label className="adv-field-label">{t('adv.chain')}</label>
                <select
                  className="sel-input"
                  value={skylineParams.chain}
                  onChange={(e) => setSkylineParams({ ...skylineParams, chain: Number(e.target.value) })}
                >
                  <option value={1000000}>1,000,000</option>
                  <option value={10000000}>10,000,000</option>
                  <option value={50000000}>50,000,000</option>
                  <option value={100000000}>100,000,000</option>
                </select>
                <button className="btn primary adv-run" onClick={runSkyline} disabled={busy}>
                  {busy ? t('adv.busy') : `▶ ${t('adv.run')}`}
                </button>
              </div>

              {current.skyline ? (
                <>
                  <div className="adv-result-head">
                    <span className="adv-badge">
                      {current.skyline.fromEngine ? `⚡ ${t('adv.fromEngine')}` : `🧮 ${t('adv.fallback')}`}
                    </span>
                    <span className="muted">{t('adv.model')}: {t('adv.m.' + (current.skyline.model as any))}</span>
                    <span className="muted">· {t('engineLabel.' + selectedEngine)}</span>
                  </div>
                  <SkylineChart times={current.skyline.times} ne={current.skyline.ne} t={t} lang={lang} />
                  <div className="adv-axis-note">
                    <span>{t('adv.neLabel')}</span>
                    <span>{t('adv.timeLabel')}</span>
                  </div>
                </>
              ) : (
                <div className="muted" style={{ marginTop: 12 }}>{t('adv.empty')}</div>
              )}
            </div>
          )}

          {tab === 'phylo' && (
            <div className="adv-result-pane">
              <div className="adv-inline">
                <label className="adv-field-label">{t('adv.model')}</label>
                <div className="build-pill-row">
                  {(['constant', 'exponential', 'skyline'] as const).map((m) => (
                    <button
                      key={m}
                      className={pill(phyloParams.model === m)}
                      onClick={() => setPhyloParams({ ...phyloParams, model: m })}
                    >
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

              {current.phylo ? (
                <>
                  <div className="adv-result-head">
                    <span className="adv-badge">
                      {current.phylo.fromEngine ? `⚡ ${t('adv.fromEngine')}` : `🧮 ${t('adv.fallback')}`}
                    </span>
                    <span className="muted">· {t('engineLabel.' + selectedEngine)}</span>
                  </div>
                  <div className="phylo-cards">
                    <PhyloCard label={t('adv.tmrca')} value={current.phylo.tmrca.toFixed(3)} />
                    <PhyloCard label={t('adv.growth')} value={(current.phylo.growthRate >= 0 ? '+' : '') + current.phylo.growthRate.toFixed(2)} />
                    <PhyloCard label={t('adv.rate')} value={current.phylo.rate.toFixed(4)} />
                    <PhyloCard label={t('adv.R0')} value={current.phylo.R0.toFixed(2)} accent />
                    <PhyloCard label={t('adv.ne0')} value={Math.round(current.phylo.Ne0).toString()} />
                  </div>
                  <CoalescentChart times={current.phylo.times} rate={current.phylo.coalescentRate} t={t} lang={lang} />
                  <div className="adv-axis-note">
                    <span>{t('adv.rateLabel')}</span>
                    <span>{t('adv.timeLabel')}</span>
                  </div>
                </>
              ) : (
                <div className="muted" style={{ marginTop: 12 }}>{t('adv.empty')}</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
