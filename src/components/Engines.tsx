import { useEffect, useState } from 'react'
import { useStore, useT } from '../store'
import {
  ENGINE_DEFS,
  EngineStatus,
  detectEngines,
  openDownloadPage,
  downloadEngine,
  setEnginePath,
  openWorkspaceDialog,
} from '../lib/tauri'

const LANGS = [
  { key: 'en', label: 'English' },
  { key: 'zh', label: '中文' },
]

export default function Engines({ onClose }: { onClose: () => void }) {
  const t = useT()
  const pushLog = useStore((s) => s.pushLog)
  const workspace = useStore((s) => s.workspace)
  const setWorkspace = useStore((s) => s.setWorkspace)
  const lang = useStore((s) => s.lang)
  const setLang = useStore((s) => s.setLang)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const [status, setStatus] = useState<Record<string, EngineStatus> | null>(null)
  const [scanning, setScanning] = useState(false)

  const refresh = async () => {
    setScanning(true)
    const res = await detectEngines()
    setStatus(res)
    setScanning(false)
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const chooseWorkspace = async () => {
    const picked = await openWorkspaceDialog(workspace || undefined)
    if (picked) setWorkspace(picked)
  }

  const onDownload = async (id: string) => {
    const def = ENGINE_DEFS.find((e) => e.id === id)!
    const url = await downloadEngine(def)
    if (url) openDownloadPage(url)
    pushLog(`${def.name}: opened download page`, 'info')
  }

  const onSetPath = async (id: string) => {
    const def = ENGINE_DEFS.find((e) => e.id === id)!
    const p = await setEnginePath(def)
    if (p) {
      setStatus((s) => (s ? { ...s, [id]: { ...s[id], path: p, status: 'installed' } } : s))
      pushLog(`${def.name}: path set to ${p}`, 'ok')
    }
  }

  const detectedCount = status
    ? Object.values(status).filter((s) => s.status === 'installed').length
    : 0

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal engines-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>⚙ {t('eng.settingsTitle')}</h2>
          <button className="btn icon" onClick={onClose} title={t('eng.close')}>
            ✕
          </button>
        </div>

        <div className="eng-settings">
          <div className="eng-set-row">
            <span className="eng-set-label">{t('app.workspace')}</span>
            <button className="btn" onClick={chooseWorkspace} title={t('app.workspacePh')}>
              {workspace ? (workspace.length > 32 ? '…' + workspace.slice(-30) : workspace) : t('app.workspaceDefault')}
            </button>
          </div>
          <div className="eng-set-row">
            <span className="eng-set-label">{t('app.language')}</span>
            <select className="sel-input" value={lang} onChange={(e) => setLang(e.target.value as 'en' | 'zh')}>
              {LANGS.map((l) => (
                <option key={l.key} value={l.key}>{l.label}</option>
              ))}
            </select>
          </div>
          <div className="eng-set-row">
            <span className="eng-set-label">{t('app.theme')}</span>
            <button
              className="btn"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? '☀ ' + t('app.light') : '🌙 ' + t('app.dark')}
            </button>
          </div>
        </div>

        <h3 className="eng-sec">{t('eng.title')}</h3>
        <p className="modal-sub">{t('eng.subtitle')}</p>

        <div className="eng-toolbar">
          <button className="btn" onClick={refresh} disabled={scanning}>
            {scanning ? t('eng.detecting') : `🔍 ${t('eng.detect')}`}
          </button>
          <span className="eng-count">
            {status
              ? detectedCount > 0
                ? t('eng.detected', { n: detectedCount })
                : t('eng.none')
              : ''}
          </span>
        </div>

        <div className="eng-list">
          {ENGINE_DEFS.map((e) => {
            const st = status?.[e.id]
            const installed = st?.status === 'installed'
            return (
              <div key={e.id} className={`eng-row ${installed ? 'ok' : 'miss'}`}>
                <div className="eng-main">
                  <div className="eng-name">
                    {e.name}
                    <span className={`eng-badge ${installed ? 'ok' : 'miss'}`}>
                      {scanning ? '…' : installed ? t('eng.status.installed') : t('eng.status.missing')}
                    </span>
                  </div>
                  <div className="eng-purpose">{e.purpose}</div>
                  {installed && st?.version && (
                    <div className="eng-meta">
                      {t('eng.version')}: {st.version}
                      {st.path ? ` · ${t('eng.path')}: ${st.path}` : ''}
                    </div>
                  )}
                </div>
                <div className="eng-actions">
                  <button className="btn" onClick={() => onDownload(e.id)}>
                    ⬇ {t('eng.download')}
                  </button>
                  <button className="btn" onClick={() => onSetPath(e.id)}>
                    📁 {t('eng.setpath')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="eng-foot">
          <p className="eng-note">ℹ {t('eng.builtinNote')}</p>
          <p className="eng-note">ℹ {t('eng.about')}</p>
          {!status && <p className="eng-note">ℹ {t('eng.browserNote')}</p>}
          <div className="eng-about">
            <h4>{t('eng.aboutTitle')}</h4>
            <p>{t('eng.aboutText')}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
