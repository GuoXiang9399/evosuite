import { useStore, useT } from '../store'
import { leafCount, internalNodes } from '../lib/newick'
import { downloadText } from '../lib/tauri'
import { toFasta } from '../lib/fasta'
import LogPanel from './LogPanel'

export default function Report() {
  const workspace = useStore((s) => s.workspace)
  const sequences = useStore((s) => s.sequences)
  const aligned = useStore((s) => s.aligned)
  const model = useStore((s) => s.model)
  const engine = useStore((s) => s.engine)
  const newick = useStore((s) => s.newick)
  const tree = useStore((s) => s.tree)
  const pushLog = useStore((s) => s.pushLog)
  const skyline = useStore((s) => s.skyline)
  const phylodynamics = useStore((s) => s.phylodynamics)
  const t = useT()

  const hasTree = !!tree
  const projectLabel = workspace ? `${workspace}` : t('report.fallback')
  const fileBase = workspace ? workspace.replace(/[\\/:]/g, '_').split(/[\\/]/).pop()! : 'evosuite'
  const markdown = buildMarkdown()

  const exportMd = () => {
    downloadText(`${fileBase}_report.md`, markdown)
    pushLog(t('log.exportMd'), 'ok')
  }
  const exportHtml = () => {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${projectLabel}</title>
<style>body{font-family:system-ui,Arial;background:#fafafa;color:#222;max-width:860px;margin:32px auto;padding:0 20px}
h1{border-bottom:2px solid #4caf82;padding-bottom:8px}h2{margin-top:28px;color:#2b6}code{background:#eee;padding:1px 5px;border-radius:4px}
pre{background:#0f1216;color:#e6e6e6;padding:14px;border-radius:8px;overflow:auto}table{border-collapse:collapse;width:100%}
td,th{border:1px solid #ddd;padding:6px 10px;text-align:left}</style></head>
<body>${mdToHtml(markdown)}</body></html>`
    downloadText(`${fileBase}_report.html`, html)
    pushLog(t('log.exportHtml'), 'ok')
  }
  const exportFasta = () => {
    downloadText(`${fileBase}.fasta`, toFasta(sequences))
    pushLog(t('log.exportAlignFasta'), 'ok')
  }

  function buildMarkdown(): string {
    const lines: string[] = []
    lines.push(t('report.mdTitle', { name: projectLabel }))
    lines.push('')
    lines.push('> ' + t('report.mdGenBy'))
    lines.push('')
    lines.push(t('report.mdSec1'))
    lines.push(t('report.seqCount', { n: sequences.length }))
    lines.push(t('report.alignState', { state: aligned ? t('report.alignYes') : t('report.alignNo') }))
    if (sequences.length) {
      lines.push(t('report.seqLenRange', {
        min: Math.min(...sequences.map((s) => s.sequence.length)),
        max: Math.max(...sequences.map((s) => s.sequence.length)),
      }))
    }
    lines.push('')
    lines.push(t('report.mdSec2'))
    lines.push(t('report.model', { m: t('mdl.' + model) }))
    lines.push(t('report.method', { method: t('engineLabel.' + engine) }))
    if (engine === 'beast1') {
      lines.push(
        skyline
          ? `Skyline: ${t('adv.m.' + (skyline.model as any))} · ${t('adv.groupsVal', { n: skyline.groups })}${skyline.fromEngine ? ` (${t('adv.fromEngine')})` : ''}`
          : t('adv.empty'),
      )
      if (phylodynamics) {
        lines.push(
          `Phylodynamics: TMRCA=${phylodynamics.tmrca.toFixed(3)} · r=${phylodynamics.growthRate.toFixed(2)} · rate=${phylodynamics.rate.toFixed(4)} · R₀=${phylodynamics.R0.toFixed(2)} · Ne=${Math.round(phylodynamics.Ne0)}${phylodynamics.fromEngine ? ` (${t('adv.fromEngine')})` : ''}`,
        )
      }
    }
    lines.push(t('report.engine', { e: hasTree ? t('report.engineYes') : t('report.engineNo') }))
    lines.push('')
    if (hasTree) {
      lines.push(t('report.mdSec3'))
      lines.push(t('report.leaves', { n: leafCount(tree!) }))
      lines.push(t('report.internals', { n: internalNodes(tree!).length }))
      lines.push('')
      lines.push(t('report.mdNewick'))
      lines.push('```')
      lines.push(newick)
      lines.push('```')
    }
    lines.push('')
    lines.push(t('report.mdSec4'))
    lines.push(`| ${t('report.thNo')} | ${t('report.thName')} | ${t('report.thLen')} |`)
    lines.push('|---|------|------|')
    sequences.forEach((s, i) => lines.push(`| ${i + 1} | ${s.name} | ${s.sequence.length} |`))
    lines.push('')
    lines.push('---')
    lines.push(t('report.generated', { time: new Date().toLocaleString() }))
    return lines.join('\n')
  }

  if (!sequences.length) {
    return (
      <div className="view">
        <div className="view-head"><h2>{t('report.title')}</h2></div>
        <div className="empty">{t('report.empty')}</div>
        <LogPanel />
      </div>
    )
  }

  return (
    <div className="view">
      <div className="view-head">
        <h2>{t('report.title')}</h2>
        <div className="view-actions">
          <button className="btn" onClick={exportFasta}>{t('report.fasta')}</button>
          <button className="btn" onClick={exportMd}>{t('report.md')}</button>
          <button className="btn primary" onClick={exportHtml}>{t('report.html')}</button>
        </div>
      </div>
      <div className="report-preview">
        <pre>{markdown}</pre>
      </div>
      <LogPanel />
    </div>
  )
}

function mdToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const blocks = md.split(/\n\n+/)
  return blocks
    .map((b) => {
      if (b.startsWith('```')) {
        const code = b.replace(/```\w*\n?/g, '').replace(/```/g, '')
        return `<pre>${esc(code)}</pre>`
      }
      if (b.startsWith('# ')) return `<h1>${esc(b.slice(2))}</h1>`
      if (b.startsWith('## ')) return `<h2>${esc(b.slice(3))}</h2>`
      if (b.startsWith('> ')) return `<blockquote>${esc(b.slice(2))}</blockquote>`
      if (b.startsWith('|')) {
        const rows = b.trim().split('\n').filter((r) => !/^\|[-:\s|]+\|$/.test(r))
        const cells = (r: string) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
        const head = cells(rows[0])
        let tb = '<table><thead><tr>' + head.map((c) => `<th>${esc(c)}</th>`).join('') + '</tr></thead><tbody>'
        rows.slice(1).forEach((r) => {
          tb += '<tr>' + cells(r).map((c) => `<td>${esc(c)}</td>`).join('') + '</tr>'
        })
        return tb + '</tbody></table>'
      }
      const items = b.split('\n').filter((l) => l.startsWith('- '))
      if (items.length) return '<ul>' + items.map((l) => `<li>${esc(l.slice(2))}</li>`).join('') + '</ul>'
      return `<p>${esc(b.replace(/\n/g, ' '))}</p>`
    })
    .join('\n')
}
