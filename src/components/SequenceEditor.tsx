import { useEffect, useRef, useState } from 'react'
import { useStore, useT } from '../store'
import { seqStats } from '../lib/fasta'

const BASE_COLOR: Record<string, string> = {
  A: '#3fa56b',
  G: '#e0a33a',
  C: '#4a90d9',
  T: '#d9694e',
  U: '#d9694e',
  '-': '#9aa3ad',
  '.': '#9aa3ad',
  N: '#8a6fb0',
}

// 允许插入的字符：标准碱基 + 简并/缺口
const ALLOWED = /[ACGTUN\-.]/g

type Sel = { idx: number; from: number; to: number } | null

export default function SequenceEditor() {
  const t = useT()
  const sequences = useStore((s) => s.sequences)
  const updateSequence = useStore((s) => s.updateSequence)
  const removeSequence = useStore((s) => s.removeSequence)
  const insertBases = useStore((s) => s.insertBases)
  const deleteBases = useStore((s) => s.deleteBases)
  const pushLog = useStore((s) => s.pushLog)
  const setView = useStore((s) => s.setView)

  const [editing, setEditing] = useState<{ idx: number; pos: number } | null>(null)
  const [editVal, setEditVal] = useState('')
  const [sel, setSel] = useState<Sel>(null)
  const [insVal, setInsVal] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const movedRef = useRef(false)
  // 拖拽/选区必须用 ref：mousedown 后的 mousemove 会在 React 重渲染之前连续触发，
  // 若读 state 会拿到旧值导致选区无法延伸。
  const dragRef = useRef(false)
  const selRef = useRef<Sel>(null)
  // 记录正在拖拽的碱基行 DOM，供 window 级 mouseup 换算终点列号
  const dragRowRef = useRef<HTMLDivElement | null>(null)
  const maxLen = sequences.reduce((m, s) => Math.max(m, s.sequence.length), 0)

  const applySel = (s: Sel) => {
    selRef.current = s
    setSel(s)
  }

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  // 在 window 上收尾：鼠标移出网格后释放也能正确结束拖拽。
  // 注意：快速拖拽时浏览器会合并 mousemove，且 mouseup 未必能冒泡到行容器，
  // 因此这里用原生事件的 clientX 对终点列号做兜底校正。
  useEffect(() => {
    const up = (e: MouseEvent) => {
      if (!dragRef.current) return
      dragRef.current = false
      const el = dragRowRef.current
      const cur = selRef.current
      dragRowRef.current = null
      if (!el || !cur || maxLen <= 0) return
      const rect = el.getBoundingClientRect()
      const cw = rect.width / maxLen
      if (!cw) return
      const p = Math.max(0, Math.min(maxLen - 1, Math.floor((e.clientX - rect.left) / cw)))
      if (p !== cur.to) {
        movedRef.current = true
        applySel({ ...cur, to: p })
      }
    }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxLen])

  const startEdit = (idx: number, pos: number, cur: string) => {
    setEditing({ idx, pos })
    setEditVal(cur)
  }

  const commit = (idx: number, pos: number, ch: string) => {
    const rec = sequences[idx]
    if (!rec) return
    const seq = rec.sequence
    const next = (seq.slice(0, pos) + ch.toUpperCase() + seq.slice(pos + 1)).slice(0, Math.max(seq.length, pos + 1))
    updateSequence(rec.id, { sequence: next })
    setEditing(null)
  }

  // ---------- 区域选择（拖拽 / Shift+点击）----------
  const onCellDown = (i: number, p: number, e: React.MouseEvent) => {
    const cur = selRef.current
    if (e.shiftKey && cur && cur.idx === i) {
      movedRef.current = true
      applySel({ idx: i, from: Math.min(cur.from, p), to: Math.max(cur.to, p) })
      return
    }
    movedRef.current = false
    setEditing(null)
    dragRef.current = true
    dragRowRef.current = (e.currentTarget as HTMLElement).parentElement as HTMLDivElement
    applySel({ idx: i, from: p, to: p })
  }

  // 容器级 mousemove + 坐标换算定位列号：不依赖每个格子的 mouseenter，
  // 快速拖拽时也不会漏掉中间格子。
  const posFromEvent = (i: number, e: React.MouseEvent<HTMLDivElement>): number | null => {
    const cur = selRef.current
    if (!cur || cur.idx !== i || maxLen <= 0) return null
    const rect = e.currentTarget.getBoundingClientRect()
    const cw = rect.width / maxLen
    if (!cw) return null
    const p = Math.floor((e.clientX - rect.left) / cw)
    return Math.max(0, Math.min(maxLen - 1, p))
  }

  const onRowMouseMove = (i: number) => (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    const cur = selRef.current
    const p = posFromEvent(i, e)
    if (p == null || !cur) return
    if (p !== cur.to) {
      movedRef.current = true
      applySel({ ...cur, to: p })
    }
  }

  // 浏览器会合并快速连续的 mousemove，导致终点丢失；
  // 因此在 mouseup 时再按最终坐标兜底校正一次。
  const onRowMouseUp = (i: number) => (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    const cur = selRef.current
    const p = posFromEvent(i, e)
    dragRef.current = false
    if (p == null || !cur) return
    if (p !== cur.to) {
      movedRef.current = true
      applySel({ ...cur, to: p })
    }
  }

  // 单击（未拖拽）= 进入单碱基编辑；拖拽结束则保留选区并显示工具条
  const onCellClick = (i: number, p: number, ch: string) => {
    if (movedRef.current) {
      movedRef.current = false
      return
    }
    startEdit(i, p, ch)
    applySel(null)
  }

  const inSel = (i: number, p: number) => {
    if (!sel || sel.idx !== i) return false
    const lo = Math.min(sel.from, sel.to)
    const hi = Math.max(sel.from, sel.to)
    return p >= lo && p <= hi
  }

  // 选区跨多个碱基时才算“批量”
  const isRange = !!sel && sel.from !== sel.to

  const doDelete = () => {
    if (!sel) return
    const rec = sequences[sel.idx]
    if (!rec) return
    const lo = Math.min(sel.from, sel.to)
    const hi = Math.max(sel.from, sel.to)
    const n = hi - lo + 1
    deleteBases(rec.id, lo, n)
    pushLog(t('seqEditor.deleted', { n, name: rec.name }), 'ok')
    applySel(null)
  }

  const doInsert = () => {
    if (!sel) return
    const rec = sequences[sel.idx]
    if (!rec) return
    const chars = (insVal.toUpperCase().match(ALLOWED) || []).join('')
    if (!chars) return
    const hi = Math.max(sel.from, sel.to)
    insertBases(rec.id, hi + 1, chars)
    pushLog(t('seqEditor.inserted', { n: chars.length, name: rec.name }), 'ok')
    setInsVal('')
    applySel(null)
  }

  if (!sequences.length) return null

  const selRec = sel ? sequences[sel.idx] : null

  return (
    <div className="cfg-block seq-grid-card">
      <div className="seq-ed-head">
        <h3>🧬 {t('seqEditor.title')}</h3>
        <span className="seq-ed-sub">{t('seqEditor.clickHint')}</span>
      </div>

      {/* 批量编辑工具条（仅在选中一段碱基时出现，不占用行高） */}
      {isRange && selRec && (
        <div className="seq-sel-toolbar">
          <span className="seq-sel-where">
            <b className="mono">{selRec.name}</b>
            {' · '}
            {t('seqEditor.selN', { n: Math.abs(sel!.to - sel!.from) + 1 })}
          </span>
          <button className="btn danger-btn" onClick={doDelete}>
            ✂ {t('seqEditor.delSel')}
          </button>
          <span className="seq-sel-ins">
            <input
              className="sel-input seq-ins-input"
              placeholder={t('seqEditor.insPh')}
              value={insVal}
              onChange={(e) => setInsVal(e.target.value)}
              spellCheck={false}
            />
            <button className="btn" onClick={doInsert} disabled={!insVal.trim()}>
              ＋ {t('seqEditor.insSel')}
            </button>
          </span>
          <button className="btn" onClick={() => applySel(null)}>
            {t('seqEditor.clear')}
          </button>
        </div>
      )}

      <div className="seq-grid-scroll">
        {/* 列头行：# | Name | Len | 位点标尺（v0.1.1：Len 移至 Name 右侧，去除 GC% 列） */}
        <div className="seq-grid-row ruler">
          <div className="seq-idx-cell">#</div>
          <div className="seq-info-cell">{t('seqEditor.colName')}</div>
          <div className="seq-len-cell">{t('seqEditor.colLen')}</div>
          <div className="seq-bases-row">
            {Array.from({ length: maxLen }).map((_, p) => (
              <span key={p} className="ruler-cell">
                {p % 10 === 0 ? p + 1 : ''}
              </span>
            ))}
          </div>
        </div>

        {/* 每条序列一行：行号 | 名称 | 长度 | 碱基（desc/GC 见悬停提示） */}
        {sequences.map((s, i) => {
          const st = seqStats(s)
          return (
            <div className="seq-grid-row" key={s.id ?? i}>
              <div className="seq-idx-cell">{i + 1}</div>
              <div className="seq-info-cell" title={s.desc ? `${s.name} — ${s.desc}` : s.name}>
                <div className="seq-info-line">
                  <span className="seq-info-name">{s.name}</span>
                  <button
                    className="seq-row-del-mini"
                    title={t('seq.remove')}
                    onClick={() => {
                      removeSequence(s.id)
                      pushLog(t('seq.removed'), 'info')
                    }}
                  >
                    🗑
                  </button>
                </div>
              </div>

              <div className="seq-len-cell" title={`${s.name}: ${st.length} bp · GC ${(st.gcContent * 100).toFixed(1)}%`}>
                {st.length}
              </div>

              <div className="seq-bases-row" onMouseMove={onRowMouseMove(i)} onMouseUp={onRowMouseUp(i)}>
                {Array.from({ length: maxLen }).map((_, p) => {
                  const ch = s.sequence[p] ?? ' '
                  const isEdit = editing && editing.idx === i && editing.pos === p
                  if (isEdit) {
                    return (
                      <input
                        key={p}
                        ref={inputRef}
                        className="cell-edit"
                        value={editVal}
                        maxLength={1}
                        onChange={(e) => setEditVal(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commit(i, p, editVal || ch)
                          if (e.key === 'Escape') setEditing(null)
                        }}
                        onBlur={() => commit(i, p, editVal || ch)}
                      />
                    )
                  }
                  return (
                    <span
                      key={p}
                      className={`cell ${ch === ' ' ? 'cell-empty' : ''} ${inSel(i, p) ? 'selected' : ''}`}
                      style={{ color: inSel(i, p) ? 'inherit' : BASE_COLOR[ch] || 'var(--text)' }}
                      onMouseDown={(e) => onCellDown(i, p, e)}
                      onClick={() => onCellClick(i, p, ch === ' ' ? '' : ch)}
                    >
                      {ch === ' ' ? '·' : ch}
                    </span>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
