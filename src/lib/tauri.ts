// Tauri 运行时检测与外部引擎调用封装
// 设计原则：在纯浏览器（沙箱预览）下自动降级，不依赖 Tauri 运行时；
// 在 Tauri 桌面应用中则调用 Rust 命令对接 MAFFT / IQ-TREE2 等真实引擎。
import { SeqRecord } from './fasta'

function inTauri(): boolean {
  return typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__
}
export function isTauri(): boolean {
  return inTauri()
}

async function invokeSafe(cmd: string, args?: Record<string, any>): Promise<any> {
  if (!inTauri()) throw new Error('not in tauri runtime')
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke(cmd, args)
}

// ---------- 工作区（workspace）----------

// 默认工作区 = 软件自身文件夹内的 workspace 子目录。
// Tauri 下用 appConfigDir(/app data) 拼接；浏览器下用相对占位符。
export async function getDefaultWorkspace(): Promise<string> {
  if (inTauri()) {
    try {
      const path = await import('@tauri-apps/api/path')
      const dir = await path.appConfigDir()
      return await path.join(dir, 'workspace')
    } catch {
      /* 回退 */
    }
  }
  return 'EvoSuite-workspace'
}

// 打开目录选择对话框，返回用户所选路径（取消则返回 null）。
// 桌面端优先用 dialog 插件；浏览器回退到 <input webkitdirectory>。
export async function openWorkspaceDialog(current?: string): Promise<string | null> {
  if (inTauri()) {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const picked = await open({
        directory: true,
        multiple: false,
        defaultPath: current || undefined,
        title: 'Select EvoSuite workspace folder',
      })
      if (typeof picked === 'string') return picked
      return null
    } catch {
      /* 回退到 HTML */
    }
  }
  // 浏览器回退：隐藏 input 触发原生文件夹选择
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    ;(input as any).webkitdirectory = true
    input.style.display = 'none'
    input.onchange = () => {
      const files = (input as any).files as FileList | null
      const path = files && files.length ? ((files[0] as any).path ?? files[0].webkitRelativePath?.split('/')[0]) : null
      resolve(typeof path === 'string' ? path : null)
      input.remove()
    }
    document.body.appendChild(input)
    input.click()
  })
}

// ---------- 比对 / 建树 ----------

// 比对：调用外部 MAFFT（Rust 命令），返回 FASTA 文本；不可用返回 null
export async function tryAlign(seqs: SeqRecord[]): Promise<string | null> {
  try {
    const out: string = await invokeSafe('align_mafft', {
      sequences: seqs.map((s) => ({ name: s.name, sequence: s.sequence })),
    })
    if (typeof out === 'string' && out.trim().startsWith('>')) return out
  } catch (e) {
    /* 降级 */
  }
  return null
}

// ML 建树：调用外部 IQ-TREE2（Rust 命令），返回 Newick；不可用返回 null
// opts 携带 IQ-TREE2 的全部可调参数（模型修饰符 / 自举 / 线程 / 随机种子 / 外类群）。
// 当前前端仍调用既有 run_iqtree 以正常产出树；其余选项在桌面端 run_iqtree_args 就绪后透传。
export interface MLBuildOpts {
  model: string
  bootstrap: number
  threads: string | number
  seed: number | null
  outgroup: string
}
export async function tryMLBuild(fastaText: string, opts: MLBuildOpts): Promise<string | null> {
  try {
    // TODO(Rust): 真实调用 invoke('run_iqtree_args', { fasta, model, bootstrap, threads, seed, outgroup })
    const out: string = await invokeSafe('run_iqtree', { fasta: fastaText, model: opts.model })
    if (typeof out === 'string' && out.includes('(') && out.includes(';')) return out
  } catch (e) {
    /* 降级 */
  }
  return null
}

// ---------- 内核引擎管理 ----------

export interface EngineDef {
  id: string
  name: string
  version: string
  purpose: string
  // 用于下载页 / 自动检测的命令名
  bin: string
  url: string
}
export interface EngineStatus {
  status: 'installed' | 'missing'
  version: string
  path: string
}

export const ENGINE_DEFS: EngineDef[] = [
  {
    id: 'mafft',
    name: 'MAFFT',
    version: 'v7.5xx',
    purpose: 'Multiple sequence alignment',
    bin: 'mafft',
    url: 'https://mafft.cbrc.jp/alignment/software/',
  },
  {
    id: 'iqtree2',
    name: 'IQ-TREE2',
    version: '2.x',
    purpose: 'Maximum-likelihood tree inference',
    bin: 'iqtree2',
    url: 'http://www.iqtree.org/',
  },
  {
    id: 'raxmlng',
    name: 'RAxML-NG',
    version: '1.x',
    purpose: 'Efficient ML tree inference',
    bin: 'raxml-ng',
    url: 'https://github.com/amkozlov/raxml-ng',
  },
  {
    id: 'mrbayes',
    name: 'MrBayes',
    version: '3.2',
    purpose: 'Bayesian phylogenetic inference',
    bin: 'mb',
    url: 'https://nbisweden.github.io/MrBayes/',
  },
  {
    id: 'beast1',
    name: 'BEAST1',
    version: '1.10.x',
    purpose: 'Bayesian phylogenetics & phylodynamics (MCMC, skyline)',
    bin: 'beast',
    url: 'https://beast.community/',
  },
  {
    id: 'beast2',
    name: 'BEAST2',
    version: '2.x',
    purpose: 'Bayesian phylogenetics with phylodynamics & skyline packages',
    bin: 'beast',
    url: 'https://www.beast2.org/',
  },
]

// 检测已安装的内核。桌面端调用 Rust detect_engines；浏览器返回全 missing。
export async function detectEngines(): Promise<Record<string, EngineStatus>> {
  if (inTauri()) {
    try {
      const res = await invokeSafe('detect_engines')
      if (res && typeof res === 'object') return res as Record<string, EngineStatus>
    } catch {
      /* 回退 */
    }
  }
  const out: Record<string, EngineStatus> = {}
  for (const e of ENGINE_DEFS) out[e.id] = { status: 'missing', version: '', path: '' }
  return out
}

// 打开官方下载页（浏览器与桌面 webview 均可用）。
export function openDownloadPage(url: string) {
  window.open(url, '_blank', 'noopener')
}

// 在桌面端通过 Rust 触发下载/安装辅助；当前返回官方下载链接由前端打开。
export async function downloadEngine(def: EngineDef): Promise<string | null> {
  if (inTauri()) {
    try {
      const info: { url: string } | null = await invokeSafe('download_engine', { id: def.id })
      if (info && info.url) return info.url
    } catch {
      /* 回退到官方页 */
    }
  }
  return def.url
}

// 指定已安装内核的本地路径（桌面端用 dialog 选文件；浏览器给出提示）。
export async function setEnginePath(def: EngineDef): Promise<string | null> {
  if (inTauri()) {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const picked = await open({
        multiple: false,
        filters: [{ name: def.name, extensions: ['*'] }],
        title: `Select ${def.name} executable`,
      })
      if (typeof picked === 'string') return picked
      return null
    } catch {
      /* 回退 */
    }
  }
  return null
}

// ---------- 通用：浏览器/Tauri 下均可用 Blob 下载 ----------
export function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
