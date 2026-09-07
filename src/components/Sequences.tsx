import { useState } from 'react'
import { useStore, useT } from '../store'
import { parseFasta, SeqRecord, toFasta, hasGaps } from '../lib/fasta'
import { downloadText } from '../lib/tauri'
import { SAMPLE_FASTA } from '../lib/sample'
import { alignFastaRecords } from '../lib/align'
import { tryAlign } from '../lib/tauri'
import SequenceEditor from './SequenceEditor'

const BASE_COLOR: Record<string, string> = { A: '#4caf82', G: '#e8b339', C: '#5b9bd5', T: '#d9694e' }

export default function Sequences() {
  const sequences = useStore((s) => s.sequences)
  const setSequences = useStore((s) => s.setSequences)
  const addSequence = useStore((s) => s.addSequence)
  const setAlignment = useStore((s) => s.setAlignment)
  const setView = useStore((s) => s.setView)
  const pushLog = useStore((s) => s.pushLog)
  const t = useT()
  const [paste, setPaste] = useState('')
  const [err, setErr] = useState('')
  const [showPaste, setShowPaste] = useState(false)
  const [busyMSA, setBusyMSA] = useState(false)

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const text = await f.text()
    ingest(text, f.name)
    e.target.value = ''
  }

  const ingest = (text: string, src = t('seq.srcPaste')) => {
    setErr('')
    try {
      const recs = parseFasta(text)
      if (!recs.length) {
        setErr(t('seq.errNone'))
        return
      }
      setSequences(recs)
      pushLog(t('log.imported', { n: recs.length, src }), 'ok')
    } catch (e: any) {
      setErr(t('seq.parseFail') + e.message)
    }
  }

  const doPaste = () => {
    if (!paste.trim()) {
      setErr(t('seq.pasteFirst'))
      return
    }
    ingest(paste, t('seq.srcPaste'))
  }

  const loadSample = () => {
    setPaste(SAMPLE_FASTA)
    ingest(SAMPLE_FASTA, t('seq.srcSample'))
  }

  const exportFasta = () => {
    downloadText('sequences.fasta', toFasta(sequences))
    pushLog(t('log.exportedFasta'), 'ok')
  }

  // 多序列比对（MSA）
  const runMSA = async (external: boolean) => {
    if (!sequences.length) return
    setBusyMSA(true)
    pushLog(external ? t('log.mafftTry') : t('log.alignStart'))
    if (external) {
      const res = await tryAlign(sequences)
      if (res) {
        const parsed = parseOut(res, sequences)
        setSequences(parsed)
        setAlignment(parsed.map((r) => r.sequence), true)
        pushLog(t('log.mafftOk'), 'ok')
        setBusyMSA(false)
        return
      }
      pushLog(t('log.mafftFallback'), 'warn')
    }
    const out = alignFastaRecords(sequences)
    setSequences(out)
    setAlignment(out.map((r) => r.sequence), true)
    pushLog(t('log.alignDone', { n: out.length, len: out[0].sequence.length }), 'ok')
    setBusyMSA(false)
  }

  const minLen = sequences.length ? Math.min(...sequences.map((s) => s.sequence.length)) : 0
  const maxLen = sequences.length ? Math.max(...sequences.map((s) => s.sequence.length)) : 0
  const aligned =
    sequences.length > 1 &&
    sequences.every((s) => s.sequence.length === sequences[0].sequence.length) &&
    sequences.some((s) => hasGaps(s.sequence))

  return (
    <div className="view">
      <div className="view-head">
        <h2>{t('seq.title')}</h2>
        <div className="view-actions">
          <button className="btn" onClick={exportFasta} disabled={!sequences.length}>
            {t('seq.exportFasta')}
          </button>
        </div>
      </div>

      {/* 工具按钮行：Open / Load / MSA / 分段（与 MSA 并排） */}
      <div className="seq-toolbar">
        <label className="btn file-btn">
          {t('seq.openFile')}
          <input type="file" accept=".fasta,.fa,.fas,.txt" onChange={onFile} hidden />
        </label>
        <button className="btn" onClick={loadSample}>
          {t('seq.fillSample')}
        </button>
        <button className="btn primary" onClick={() => runMSA(true)} disabled={busyMSA || !sequences.length}>
          {busyMSA ? t('seq.busy') : `🔗 ${t('seq.msa')}`}
        </button>
        <button className="btn" disabled title={t('seq.segSoon')}>
          ✂ {t('seq.segment')}
        </button>
        <button className="btn" onClick={() => setShowPaste((v) => !v)}>
          {t('seq.paste')}
        </button>
        <button className="btn" onClick={addSequence} disabled={!sequences.length}>
          ＋ {t('seq.addSeq')}
        </button>
        <span className="import-tip">
          {sequences.length
            ? `${t('seq.total')} ${sequences.length} · ${minLen}–${maxLen} bp · ${
                aligned ? t('seq.aligned') : t('seq.notAligned')
              }`
            : t('seq.support')}
        </span>
      </div>

      {showPaste && (
        <div className="import-row">
          <textarea
            className="paste-area"
            placeholder={t('seq.pastePlaceholder')}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            spellCheck={false}
          />
          <div className="import-row">
            <button className="btn" onClick={doPaste}>
              {t('seq.parsePaste')}
            </button>
            {err && <span className="err">{err}</span>}
          </div>
        </div>
      )}

      {sequences.length > 0 && (
        <div className="seq-core">
          {/* 核心：Sequence Alignment Editor（含左侧序列信息列） */}
          <SequenceEditor />
        </div>
      )}
    </div>
  )
}

function parseOut(text: string, base: SeqRecord[]): SeqRecord[] {
  const recs: SeqRecord[] = []
  let cur: SeqRecord | null = null
  let buf = ''
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('>')) {
      if (cur) {
        cur.sequence = buf.replace(/\s+/g, '').toUpperCase()
        recs.push(cur)
      }
      const header = line.slice(1).trim()
      const id = header.split(/\s+/)[0]
      const match = base.find((b) => b.name === id) || base[recs.length]
      cur = { ...(match || base[recs.length]), id, name: id, sequence: '' }
      buf = ''
    } else buf += line
  }
  if (cur) {
    cur.sequence = buf.replace(/\s+/g, '').toUpperCase()
    recs.push(cur)
  }
  return recs.length ? recs : base
}
