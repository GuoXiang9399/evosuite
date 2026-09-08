import { useEffect, useState } from 'react'
import { useStore, useT, View } from './store'
import Home from './components/Home'
import Sequences from './components/Sequences'
import Align from './components/Align'
import Build from './components/Build'
import AdvancedResult from './components/AdvancedResult'
import TreeView from './components/TreeView'
import Report from './components/Report'
import Analyze from './components/Analyze'
import Engines from './components/Engines'
import { BrandLockup } from './components/Logo'
import { isTauri, getDefaultWorkspace } from './lib/tauri'

// 工作流：序列数据 → 分析(Analyze) → 建树 → 高级结果(Advanced Result) → 报告。
const NAV: { key: View; icon: string }[] = [
  { key: 'home', icon: '' },
  { key: 'sequences', icon: '' },
  { key: 'analyze', icon: '' },
  { key: 'build', icon: '' },
  { key: 'advanced', icon: '' },
  { key: 'tree', icon: '' },
  { key: 'report', icon: '' },
]

const VIEWS: Record<string, JSX.Element> = {
  home: <Home />,
  sequences: <Sequences />,
  align: <Align />,
  analyze: <Analyze full />,
  build: <Build />,
  tree: <TreeView />,
  advanced: <AdvancedResult />,
  report: <Report />,
}

export default function App() {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const workspace = useStore((s) => s.workspace)
  const setWorkspace = useStore((s) => s.setWorkspace)
  const t = useT()
  const tauri = isTauri()
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const [showEngines, setShowEngines] = useState(false)

  // Apply theme to <html> so [data-theme] CSS variables take effect.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const nSeq = useStore((s) => s.sequences.length)
  const aligned = useStore((s) => s.aligned)
  const hasTree = useStore((s) => !!s.tree)
  const hasSkyline = useStore((s) => !!s.skyline)

  // Resolve the default workspace (inside the app's own folder) on first run.
  useEffect(() => {
    if (!workspace) {
      getDefaultWorkspace().then((p) => setWorkspace(p))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const status = (k: View) => {
    if (k === 'sequences') return nSeq ? '✓' : '·'
    if (k === 'build') return hasTree ? '✓' : nSeq ? '·' : '·'
    if (k === 'advanced') return hasSkyline ? '✓' : nSeq ? '·' : '·'
    if (k === 'report') return hasTree ? '✓' : '·'
    return ''
  }

  return (
    <div className="app">
      <div className="topwrap">
        <header className="topbar">
          <div className="brand">
            <BrandLockup markSize={30} wordSize={20} />
            <span className="brand-sub">{t('app.tagline')}</span>
          </div>

          <div className="topbar-right">
            <div className="engine-badge" title={t('app.engineTitle')}>
              <span className={`dot ${tauri ? 'ok' : 'warn'}`} />
              {tauri ? t('app.engineOn') : t('app.engineOff')}
            </div>

            <button className="btn set-btn" onClick={() => setShowEngines(true)} title={t('eng.title')}>
              ⚙ {t('app.set')}
            </button>
          </div>
        </header>

        <nav className="ribbon">
          {NAV.map((n) => (
            <button
              key={n.key}
              className={`nav-btn ${view === n.key ? 'active' : ''}`}
              onClick={() => setView(n.key)}
              title={t('nav.' + n.key)}
            >
              <span className="nav-ico">{n.icon}</span>
              <span className="nav-lbl">{t('nav.' + n.key)}</span>
              {status(n.key) && <span className="nav-status">{status(n.key)}</span>}
            </button>
          ))}
        </nav>
      </div>

      <div className="body">
        <main className="content">{VIEWS[view] ?? <Home />}</main>
      </div>

      {showEngines && <Engines onClose={() => setShowEngines(false)} />}
    </div>
  )
}
