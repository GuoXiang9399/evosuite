export function SkylineChart({
  times, ne, t, lang,
}: { times: number[]; ne: number[]; t: (k: string) => string; lang: string }) {
  const W = 720, H = 280, padL = 56, padR = 14, padT = 16, padB = 34
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const min = Math.min(...ne), max = Math.max(...ne)
  const span = max - min || 1
  const x = (tt: number) => padL + tt * plotW
  const y = (v: number) => padT + (1 - (v - min) / span) * plotH
  const pts = times.map((tt, i) => [x(tt), y(ne[i])] as [number, number])
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const area = `${path} L${x(1).toFixed(1)},${(padT + plotH).toFixed(1)} L${x(0).toFixed(1)},${(padT + plotH).toFixed(1)} Z`
  const gridY = [0, 0.25, 0.5, 0.75, 1].map((g) => padT + g * plotH)
  return (
    <svg className="skyline-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Bayesian skyline plot">
      {gridY.map((gy, i) => <line key={i} x1={padL} y1={gy} x2={W - padR} y2={gy} className="sky-grid" />)}
      <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} className="sky-axis" />
      <line x1={padL} y1={padT + plotH} x2={padL} y2={padT + plotH} className="sky-axis" />
      <path d={area} className="sky-area" />
      <path d={path} className="sky-line" />
      {gridY.map((gy, i) => {
        const val = max - (i / (gridY.length - 1)) * span
        return <text key={i} x={padL - 6} y={gy + 3} className="sky-tick" textAnchor="end">{Math.round(val)}</text>
      })}
      <text x={padL} y={H - 10} className="sky-tick" textAnchor="start">{lang === 'zh' ? '现在' : 'present'}</text>
      <text x={W - padR} y={H - 10} className="sky-tick" textAnchor="end">{lang === 'zh' ? '过去' : 'past'}</text>
    </svg>
  )
}

export function PhyloCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`phylo-card ${accent ? 'accent' : ''}`}>
      <div className="phylo-val">{value}</div>
      <div className="phylo-lbl">{label}</div>
    </div>
  )
}

export function CoalescentChart({
  times, rate, t, lang,
}: { times: number[]; rate: number[]; t: (k: string) => string; lang: string }) {
  const W = 720, H = 240, padL = 56, padR = 14, padT = 16, padB = 34
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const min = Math.min(...rate), max = Math.max(...rate)
  const span = max - min || 1
  const x = (tt: number) => padL + tt * plotW
  const y = (v: number) => padT + (1 - (v - min) / span) * plotH
  const pts = times.map((tt, i) => [x(tt), y(rate[i])] as [number, number])
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const area = `${path} L${x(1).toFixed(1)},${(padT + plotH).toFixed(1)} L${x(0).toFixed(1)},${(padT + plotH).toFixed(1)} Z`
  const gridY = [0, 0.25, 0.5, 0.75, 1].map((g) => padT + g * plotH)
  return (
    <svg className="skyline-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Coalescent rate over time">
      {gridY.map((gy, i) => <line key={i} x1={padL} y1={gy} x2={W - padR} y2={gy} className="sky-grid" />)}
      <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} className="sky-axis" />
      <line x1={padL} y1={padT + plotH} x2={padL} y2={padT + plotH} className="sky-axis" />
      <path d={area} className="sky-area" />
      <path d={path} className="sky-line" />
      {gridY.map((gy, i) => {
        const val = max - (i / (gridY.length - 1)) * span
        return <text key={i} x={padL - 6} y={gy + 3} className="sky-tick" textAnchor="end">{val.toFixed(3)}</text>
      })}
      <text x={padL} y={H - 10} className="sky-tick" textAnchor="start">{lang === 'zh' ? '现在' : 'present'}</text>
      <text x={W - padR} y={H - 10} className="sky-tick" textAnchor="end">{lang === 'zh' ? '过去' : 'past'}</text>
    </svg>
  )
}