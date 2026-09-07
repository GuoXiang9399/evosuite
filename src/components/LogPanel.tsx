import { useStore, useT } from '../store'

export default function LogPanel() {
  const log = useStore((s) => s.log)
  const clearLog = useStore((s) => s.clearLog)
  const t = useT()

  return (
    <aside className="logpanel">
      <div className="log-head">
        <span>{t('log.title')}</span>
        <button className="btn tiny" onClick={clearLog}>{t('log.clear')}</button>
      </div>
      <div className="log-body">
        {log.length === 0 && <div className="log-empty">{t('log.empty')}</div>}
        {log.slice().reverse().map((e, i) => (
          <div key={i} className={`log-line ${e.kind || ''}`}>
            <span className="log-t">{e.t}</span>
            <span className="log-m">{e.msg}</span>
          </div>
        ))}
      </div>
    </aside>
  )
}
