import { useState } from 'react'
import { useStore, useT } from '../store'
import { SkylineChart, PhyloCard, CoalescentChart } from './AdvancedCharts'

type Tab = 'skyline' | 'phylo'

export default function AdvancedResult() {
  const t = useT()
  const lang = useStore((s) => s.lang)
  const sequences = useStore((s) => s.sequences)
  const skyline = useStore((s) => s.skyline)
  const phylodynamics = useStore((s) => s.phylodynamics)
  const engine = useStore((s) => s.engine)
  const setView = useStore((s) => s.setView)
  const [tab, setTab] = useState<Tab>('skyline')

  const hasResult = !!skyline || !!phylodynamics
  const pill = (on: boolean) => `tab-btn ${on ? 'active' : ''}`

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
      ) : !hasResult ? (
        <div className="empty">
          {lang === 'zh'
            ? '尚无贝叶斯结果。请到「建树分析」中选择 BEAST1/BEAST2 并运行天际线或系统动态。'
            : 'No Bayesian result yet. Switch to Build Tree, choose BEAST1 / BEAST2 and run skyline or phylodynamics.'}
        </div>
      ) : (
        <>
          <div className="analyze-tabs">
            <button className={pill(tab === 'skyline')} onClick={() => setTab('skyline')}>
              {t('adv.tabSkyline')}
            </button>
            <button className={pill(tab === 'phylo')} onClick={() => setTab('phylo')}>
              {t('adv.tabPhylo')}
            </button>
          </div>

          {tab === 'skyline' && (
            <div className="adv-result-pane">
              {!skyline ? (
                <div className="muted">{t('adv.empty')}</div>
              ) : (
                <>
                  <div className="adv-result-head">
                    <span className="adv-badge">{skyline.fromEngine ? `⚡ ${t('adv.fromEngine')}` : `🧮 ${t('adv.fallback')}`}</span>
                    <span className="muted">{t('adv.model')}: {t('adv.m.' + (skyline.model as any))}</span>
                    <span className="muted">· {engine}</span>
                  </div>
                  <SkylineChart times={skyline.times} ne={skyline.ne} t={t} lang={lang} />
                  <div className="adv-axis-note">
                    <span>{t('adv.neLabel')}</span>
                    <span>{t('adv.timeLabel')}</span>
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'phylo' && (
            <div className="adv-result-pane">
              {!phylodynamics ? (
                <div className="muted">{t('adv.empty')}</div>
              ) : (
                <>
                  <div className="adv-result-head">
                    <span className="adv-badge">{phylodynamics.fromEngine ? `⚡ ${t('adv.fromEngine')}` : `🧮 ${t('adv.fallback')}`}</span>
                    <span className="muted">· {engine}</span>
                  </div>
                  <div className="phylo-cards">
                    <PhyloCard label={t('adv.tmrca')} value={phylodynamics.tmrca.toFixed(3)} />
                    <PhyloCard label={t('adv.growth')} value={(phylodynamics.growthRate >= 0 ? '+' : '') + phylodynamics.growthRate.toFixed(2)} />
                    <PhyloCard label={t('adv.rate')} value={phylodynamics.rate.toFixed(4)} />
                    <PhyloCard label={t('adv.R0')} value={phylodynamics.R0.toFixed(2)} accent />
                    <PhyloCard label={t('adv.ne0')} value={Math.round(phylodynamics.Ne0).toString()} />
                  </div>
                  <CoalescentChart times={phylodynamics.times} rate={phylodynamics.coalescentRate} t={t} lang={lang} />
                  <div className="adv-axis-note">
                    <span>{t('adv.rateLabel')}</span>
                    <span>{t('adv.timeLabel')}</span>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}