// FASTA 解析与序列化

export interface SeqRecord {
  id: string
  name: string
  desc?: string
  sequence: string
}

export function parseFasta(text: string): SeqRecord[] {
  const recs: SeqRecord[] = []
  const lines = text.split(/\r?\n/)
  let cur: SeqRecord | null = null
  let buf = ''
  for (const line of lines) {
    if (line.startsWith('>')) {
      if (cur) {
        cur.sequence = buf.replace(/\s+/g, '').toUpperCase()
        recs.push(cur)
      }
      const header = line.slice(1).trim()
      const parts = header.split(/\s+/)
      const id = parts[0] || `seq${recs.length + 1}`
      cur = { id, name: id, desc: parts.slice(1).join(' '), sequence: '' }
      buf = ''
    } else {
      buf += line
    }
  }
  if (cur) {
    cur.sequence = buf.replace(/\s+/g, '').toUpperCase()
    recs.push(cur)
  }
  return recs
}

function wrap(s: string, w = 60): string {
  const out: string[] = []
  for (let i = 0; i < s.length; i += w) out.push(s.slice(i, i + w))
  return out.join('\n')
}

export function toFasta(recs: SeqRecord[]): string {
  return recs
    .map((r) => `>${r.name}${r.desc ? ' ' + r.desc : ''}\n${wrap(r.sequence)}`)
    .join('\n')
}

export function cleanSeq(seq: string): string {
  return seq.replace(/[^A-Za-z-]/g, '').toUpperCase()
}

export function hasGaps(seq: string): boolean {
  return /[-.]/.test(seq)
}

// 简单序列统计
export function seqStats(rec: SeqRecord) {
  const s = rec.sequence
  const counts: Record<string, number> = {}
  let gaps = 0
  for (const c of s) {
    if (c === '-' || c === '.') gaps++
    else counts[c] = (counts[c] || 0) + 1
  }
  const gc = (counts['G'] || 0) + (counts['C'] || 0)
  return { length: s.length, gaps, gcContent: s.length ? gc / s.length : 0, counts }
}
