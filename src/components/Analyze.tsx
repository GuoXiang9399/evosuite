import { useState } from 'react'
import { useStore, useT } from '../store'
import { SubstModel } from '../lib/distance'
import { computeDistance } from '../lib/analysis'
import { composition, kaKs } from '../lib/stats'
import { downloadText } from '../lib/tauri'

const BASE_COLOR: Record<string, string> = { A: '#4caf82', G: '#e8b339', C: '#5b9bd5', T: '#d9694e' }

type Tab = 'composition' | 'distance' | 'kaks'

export default function Analyze({ full = false }: { full?: boolean }) {
  const t = useT()
  const sequences = useStore((s) => s.sequences)
  const model = useStore((s) => s.model)
  const setView = useStore((s) => s.setView)
  const pushLog = useStore((s) => s.pushLog)

  const [ka, setKa] = useState(0)
  const [kb, setKb] = useState(1)
  const [dist, setDist] = useState<{ labels: string[]; matrix: number[][] } | null>(null)
  const [active, setActive] = useState<Tab>('distance')

  const compo = composition(sequences)
  const max = dist ? Math.max(...dist.matrix.flat(), 1e-9) : 1

  const runDist = () => {
    const r = computeDistance(sequences, model)
    setDist(r)
    pushLog(t('analyze.distComputed', { model: t('mdl.' + model) }), 'ok')
  }
  const exportCsv = () => {
    if (!dist) return
    const rows = [',' + dist.labels.join(',')]
    dist.matrix.forEach((row, i) => rows.push(dist.labels[i] + ',' + row.map((v) => v.toFixed(4)).join(',')))
    downloadText('distance_matrix.csv', rows.join('\n'))
    pushLog(t('log.exportCsv'), 'ok')
  }

  // 各分析模块面板（供标签页复用）
  const CompositionBlock = (
    <div className="cfg-block">
      <h4>{t('seq.composition')}</h4>
      <div className="compo-compact">
        {compo.map((c) => (
          <div className="compo-crow" key={c.name} title={c.name}>
            <span className="compo-cname mono">{c.name.length > 14 ? c.name.slice(0, 14) + '…' : c.name}</span>
            <span className="compo-cbar">
              {(['A', 'G', 'C', 'T'] as const).map((b) => (
                <span
                  key={b}
                  className="compo-cseg"
                  style={{ width: `${(c.freq[b] * 100).toFixed(1)}%`, background: BASE_COLOR[b] }}
                  title={`${b}: ${(c.freq[b] * 100).toFixed(1)}%`}
                />
              ))}
            </span>
            <span className="compo-cgc">{(c.gc * 100).toFixed(0)}</span>
          </div>
        ))}
      </div>
    </div>
  )

  const DistanceBlock = (
    <div className="cfg-block">
      <h4>{t('analyze.distTitle')}</h4>
      <p className="cfg-note">{t('analyze.distNote')}</p>
      <div className="opt-row">
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

  const KaKsBlock = (
    <div className="cfg-block">
      <h4>{t('seq.kaksTitle')}</h4>
      <p className="cfg-note">{t('seq.kaksNote')}</p>
      <div className="opt-row kaks-row">
        <select className="sel-input" value={ka} onChange={(e) => setKa(Number(e.target.value))}>
          {sequences.map((s, i) => (
            <option key={s.id} value={i}>{s.name}</option>
          ))}
        </select>
        <span className="vs">{t('seq.vs')}</span>
        <select className="sel-input" value={kb} onChange={(e) => setKb(Number(e.target.value))}>
          {sequences.map((s, i) => (
            <option key={s.id} value={i}>{s.name}</option>
          ))}
        </select>
      </div>
      <KaKsPanel a={sequences[ka]?.sequence ?? ''} b={sequences[kb]?.sequence ?? ''} />
    </div>
  )

  const Tabs = (
    <div className="analyze-tabs">
      <button className={`tab-btn ${active === 'composition' ? 'active' : ''}`} onClick={() => setActive('composition')}>
        {t('seq.composition')}
      </button>
      <button className={`tab-btn ${active === 'distance' ? 'active' : ''}`} onClick={() => setActive('distance')}>
        {t('analyze.distTitle')}
      </button>
      <button className={`tab-btn ${active === 'kaks' ? 'active' : ''}`} onClick={() => setActive('kaks')}>
        {t('analyze.kaks')}
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
        {KaKsBlock}
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
        {active === 'distance' && DistanceBlock}
        {active === 'kaks' && KaKsBlock}
      </div>
    </div>
  )
}

function KaKsPanel({ a, b }: { a: string; b: string }) {
  const t = useT()
  if (!a || !b) return null
  const len = Math.min(a.length, b.length)
  if (a.length !== b.length) {
    return <div className="kaks-result err">{t('seq.kaksLenMismatch', { a: a.length, b: b.length })}</div>
  }
  if (len % 3 !== 0) {
    return <div className="kaks-result warn">{t('seq.kaksNotCodon', { len })}</div>
  }
  const r = kaKs(a, b)
  const tone = r.omega > 1 ? 'pos' : r.omega < 1 ? 'neg' : 'neu'
  return (
    <div className="kaks-result">
      <div className="kaks-stats">
        <span>{t('seq.kaksDn')} <b>{r.dN.toFixed(4)}</b></span>
        <span>{t('seq.kaksDs')} <b>{r.dS.toFixed(4)}</b></span>
        <span>{t('seq.kaksOmega')} <b className={tone}>{r.omega.toFixed(4)}</b></span>
        <span>{t('seq.kaksCodons')} <b>{r.codons}</b></span>
        <span>{t('seq.kaksMn')} <b>{r.m}/{r.n}</b></span>
      </div>
      {r.omega > 1 && <div className="kaks-tag pos">{t('seq.kaksPos')}</div>}
      {r.omega < 1 && <div className="kaks-tag neg">{t('seq.kaksNeg')}</div>}
    </div>
  )
}
