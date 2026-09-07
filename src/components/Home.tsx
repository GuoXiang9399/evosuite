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
      <div className="home-direct">
        <div className="home-direct-head">
          <h1>{t('home.title')}</h1>
          <p>{t('home.intro')}</p>
        </div>
        <div className="home-direct-actions">
          <button className="btn primary" onClick={loadSample}>
            {t('home.loadSample')}
          </button>
          <button className="btn" onClick={() => setView('sequences')}>
            {t('home.importMine')}
          </button>
        </div>
        {!isTauri() && (
          <div className="note">{t('home.previewNote')}</div>
        )}
      </div>
    </div>
  )
}