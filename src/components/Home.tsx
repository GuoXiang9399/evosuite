import { useStore, useT } from '../store'
import { parseFasta, SeqRecord } from '../lib/fasta'
import { isTauri } from '../lib/tauri'
import { SAMPLE_FASTA } from '../lib/sample'

export default function Home() {
  const setView = useStore((s) => s.setView)
  const setSequences = useStore((s) => s.setSequences)
  const pushLog = useStore((s) => s.pushLog)
  const t = useT()

  const loadSample = () => {
    const recs = parseFasta(SAMPLE_FASTA) as SeqRecord[]
    setSequences(recs)
    pushLog(t('log.sampleLoaded', { n: recs.length }), 'ok')
    setView('sequences')
  }

  return (
    <div className="home">
      {/* 直接文字展示（v0.1.1：去除卡片与底部工作流小卡片） */}
      <section className="home-hero">
        <h1 className="home-title">{t('home.title')}</h1>
        <p className="home-subtitle">{t('home.intro')}</p>
        <div className="home-actions">
          <button className="btn primary home-cta" onClick={loadSample}>
            {t('home.loadSample')}
          </button>
          <button className="btn home-cta-secondary" onClick={() => setView('sequences')}>
            {t('home.importMine')}
          </button>
        </div>
        {!isTauri() && <div className="note home-preview-note">{t('home.previewNote')}</div>}
      </section>
    </div>
  )
}
