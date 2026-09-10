import { useEffect, useState } from 'react'
import { useStore, useT } from '../store'
import { leafCount, internalNodes } from '../lib/newick'
import { downloadText, listWorkspaceFiles, readWorkspaceFile, saveWorkspaceFile, WorkspaceFile } from '../lib/tauri'
import { toFasta } from '../lib/fasta'
import LogPanel from './LogPanel'

// 结果文件大小人性化显示
function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

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
  const [files, setFiles] = useState<WorkspaceFile[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)

  const hasTree = !!tree
  const projectLabel = workspace ? `${workspace}` : t('report.fallback')
  const fileBase = workspace ? workspace.replace(/[\\/:]/g, '_').split(/[\\/]/).pop()! : 'evosuite'
  const markdown = buildMarkdown()

  // 拉取工作文件夹结果文件列表（挂载 / 切换工作区 / 手动刷新时）
  const refreshFiles = async () => {
    setLoadingFiles(true)
    const list = await listWorkspaceFiles(workspace || undefined)
    setFiles(list.slice().reverse()) // 最新在前
    setLoadingFiles(false)
  }
  useEffect(() => {
    refreshFiles()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace])

  // 点击结果文件：读取内容并导出下载（桌面端即工作区原件的副本）
  const onOpenFile = async (name: string) => {
    const text = await readWorkspaceFile(name, workspace || undefined)
    if (text != null) {
      downloadText(name, text)
      pushLog(t('log.exportFile', { name }), 'ok')
    } else {
      pushLog(t('log.exportFileFail', { name }), 'warn')
    }
  }

  const exportMd = async () => {
    downloadText(`${fileBase}_report.md`, markdown)
    const p = await saveWorkspaceFile('report.md', markdown, workspace)
    if (p) pushLog(t('log.saveFile', { name: 'report.md' }), 'ok')
    pushLog(t('log.exportMd'), 'ok')
    refreshFiles()
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
  const exportFasta = async () => {
    downloadText(`${fileBase}.fasta`, toFasta(sequences))
    const p = await saveWorkspaceFile('sequences.fasta', toFasta(sequences), workspace)
    if (p) pushLog(t('log.saveFile', { name: 'sequences.fasta' }), 'ok')
    pushLog(t('log.exportAlignFasta'), 'ok')
    refreshFiles()
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

  // 结果文件列表区（上）：工作文件夹中的生成文件（树 / 表 / 报告）
  const filesPanel = (
    <div className="ws-files">
      <div className="ws-files-head">
        <h3>📁 {t('report.filesTitle')}</h3>
        <button className="btn tiny" onClick={refreshFiles} disabled={loadingFiles}>
          {loadingFiles ? '…' : `⟳ ${t('report.refresh')}`}
        </button>
      </div>
      <p className="cfg-note" title={workspace}>{t('report.filesSub')}{workspace ? ` — ${workspace.length > 60 ? '…' + workspace.slice(-58) : workspace}` : ''}</p>
      {files.length === 0 ? (
        <div className="ws-files-empty">{t('report.noFiles')}</div>
      ) : (
        <table className="dist-mini ws-files-table">
          <thead>
            <tr>
              <th>{t('report.thFile')}</th>
              <th>{t('report.thSize')}</th>
              <th>{t('report.thModified')}</th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.name} onClick={() => onOpenFile(f.name)} title={t('report.openFile')}>
                <td className="ws-file-name">{fileIcon(f.name)} {f.name}</td>
                <td>{fmtSize(f.size)}</td>
                <td>{f.modified}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )

  if (!sequences.length) {
    return (
      <div className="view">
        <div className="view-head"><h2>{t('report.title')}</h2></div>
        <div className="empty">{t('report.empty')}</div>
        {filesPanel}
        <div className="report-split">
          <LogPanel />
          <div className="report-preview"><pre>{t('report.empty')}</pre></div>
        </div>
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

      {/* 上：工作文件夹结果文件 */}
      {filesPanel}

      {/* 左：RUN Log ｜ 右：Report 预览 */}
      <div className="report-split">
        <LogPanel />
        <div className="report-preview">
          <pre>{markdown}</pre>
        </div>
      </div>
    </div>
  )
}

// 按扩展名给出文件图标
function fileIcon(name: string): string {
  if (/\.nwk$/i.test(name)) return '🌳'
  if (/\.tsv$/i.test(name)) return '📊'
  if (/\.md$/i.test(name)) return '📄'
  if (/\.fasta$/i.test(name) || /\.fa$/i.test(name)) return '🧬'
  return '📄'
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
