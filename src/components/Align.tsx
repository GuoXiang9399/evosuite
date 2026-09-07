import { useState } from 'react'
import { useStore, useT } from '../store'
import { SeqRecord, toFasta } from '../lib/fasta'
import { alignFastaRecords } from '../lib/align'
import { tryAlign } from '../lib/tauri'
import { downloadText } from '../lib/tauri'

const COLORS: Record<string, string> = {
  A: '#4caf82',
  G: '#e8b339',
  C: '#5b9bd5',
  T: '#d9694e',
  U: '#d9694e',
  '-': '#3a3f4b',
  N: '#888',
}

// 比对只是序列处理的一种手段，作为面板嵌入「序列数据」视图。
export function AlignmentPanel({ onDone }: { onDone?: () => void }) {
  const sequences = useStore((s) => s.sequences)
  const setView = useStore((s) => s.setView)
  const setAlignment = useStore((s) => s.setAlignment)
  const setSequences = useStore((s) => s.setSequences)
  const alignment = useStore((s) => s.alignment)
  const aligned = useStore((s) => s.aligned)
  const pushLog = useStore((s) => s.pushLog)
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [showAlign, setShowAlign] = useState(false)

  const runBuiltin = async () => {
    setBusy(true)
    pushLog(t('log.alignStart'))
    await new Promise((r) => setTimeout(r, 10))
    const out = alignFastaRecords(sequences)
    setSequences(out)
    setAlignment(out.map((r) => r.sequence), true)
    pushLog(t('log.alignDone', { n: out.length, len: out[0].sequence.length }), 'ok')
    setBusy(false)
    onDone?.()
  }

  const runExternal = async () => {
    setBusy(true)
    pushLog(t('log.mafftTry'))
    const fasta = toFasta(sequences)
    const res = await tryAlign(sequences)
    if (res) {
      const parsed = parseOut(res, sequences)
      setSequences(parsed)
      setAlignment(parsed.map((r) => r.sequence), true)
      pushLog(t('log.mafftOk'), 'ok')
      setBusy(false)
      onDone?.()
    } else {
      pushLog(t('log.mafftFallback'), 'warn')
      setBusy(false)
      runBuiltin()
    }
  }

  const avgLen = sequences.length
    ? Math.round(sequences.reduce((a, s) => a + s.sequence.length, 0) / sequences.length)
    : 0

  return (
    <div className="cfg-block align-panel">
      <h3>
        🔗 {t('align.title')}
        <span className="cfg-note" style={{ marginLeft: 10 }}>
          {t('align.insideSeq')}
        </span>
      </h3>

      <div className="callout" style={{ marginTop: 0 }}>
        {t('align.strategy')}
      </div>

      <div className="mp-options">
        <button className="btn" onClick={runExternal} disabled={busy}>
          {t('align.extMafft')}
        </button>
        <button className="btn" onClick={runBuiltin} disabled={busy}>
          {t('align.builtin')}
        </button>
      </div>

      <div className="seq-count">{t('align.curCount', { n: sequences.length, avg: avgLen })}</div>

      {aligned && alignment && (
        <div className="cfg-block" style={{ marginTop: 12 }}>
          <h3>
            {t('align.result')}
            <button className="btn tiny" style={{ marginLeft: 12 }} onClick={() => setShowAlign((v) => !v)}>
              {showAlign ? t('align.hide') : t('align.show')}
            </button>
          </h3>
          {showAlign && <ConservationAlignment names={sequences.map((s) => s.name)} rows={alignment} />}
        </div>
      )}
    </div>
  )
}

// 兼容保留：作为独立路由时仍可渲染（当前工作流已并入序列视图）。
export default function Align() {
  const setView = useStore((s) => s.setView)
  const t = useT()
  return (
    <div className="view">
      <div className="view-head">
        <h2>{t('align.title')}</h2>
        <div className="view-actions">
          <button className="btn" onClick={() => setView('sequences')}>{t('align.back')}</button>
        </div>
      </div>
      <AlignmentPanel onDone={() => setView('build')} />
    </div>
  )
}

// Conservation-colored alignment viewer: greener = more conserved; bases colored by type.
function ConservationAlignment({ names, rows }: { names: string[]; rows: string[] }) {
  const t = useT()
  const L = rows[0]?.length || 0
  const cons: number[] = []
  for (let c = 0; c < L; c++) {
    const count: Record<string, number> = {}
    let tot = 0
    for (const r of rows) {
      const ch = r[c]
      if (ch === '-' || ch === '.' || !ch) continue
      count[ch] = (count[ch] || 0) + 1
      tot++
    }
    let mx = 0
    for (const k in count) mx = Math.max(mx, count[k])
    cons.push(tot ? mx / tot : 0)
  }
  const shade = (v: number) => {
    const a = Math.round(v * 0.5)
    return `rgba(76,175,130,${a})`
  }
  return (
    <div className="aln-viewer">
      {rows.map((row, ri) => (
        <div className="aln-line" key={ri}>
          <span className="aln-name mono">{names[ri]?.length > 14 ? names[ri].slice(0, 14) + '…' : names[ri]}</span>
          <span className="aln-seq">
            {row.split('').map((ch, ci) => (
              <span
                key={ci}
                className="aln-cell"
                style={{ color: COLORS[ch] || '#ccc', background: cons[ci] > 0.6 ? shade(cons[ci]) : 'transparent' }}
              >
                {ch}
              </span>
            ))}
          </span>
        </div>
      ))}
      <div className="aln-legend muted">{t('align.legend')}</div>
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
