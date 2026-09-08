import { useStore, useT } from '../store'
import { parseFasta, SeqRecord } from '../lib/fasta'
import { isTauri } from '../lib/tauri'
import { SAMPLE_FASTA } from '../lib/sample'

const STEPS = [
  { icon: '🧬', key: 'home.step1' },
  { icon: '📊', key: 'home.step2' },
  { icon: '🌳', key: 'home.step3' },
  { icon: '🧮', key: 'home.step4' },
  { icon: '📝', key: 'home.step5' },
]

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
      {/* Hero 区域：大标题 + 副标题 + 主按钮 */}
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

      {/* 工作流卡片：5 步从序列到报告 */}
      <section className="home-workflow">
        <h2 className="home-section-title">{t('home.workflowTitle')}</h2>
        <div className="home-workflow-grid">
          {STEPS.map((s, i) => (
            <div className="home-step" key={s.key}>
              <span className="home-step-num">{i + 1}</span>
              <span className="home-step-icon">{s.icon}</span>
              <span className="home-step-label">{t(s.key)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}