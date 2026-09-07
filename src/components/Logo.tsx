// EvoSuite 官方视觉标识：环状系统发育树图形标记 + 字标 (Evo + Suite)。
// 几何取自品牌规范：外径 r=56，三级半径 r=10/24/40，4 折旋转复制；
// 32 个末端节点落外环（深蓝/亮蓝双色交替），1 个方形外群节点。
// 颜色通过 currentColor 与 --tip-a / --tip-b 控制，随主题切换。

function MarkDefs() {
  return (
    <defs>
      <g id="evo-mark" fill="none" stroke="currentColor" strokeLinecap="round">
        <circle cx="64" cy="64" r="56" strokeWidth={1.5} />
        <g id="evo-q64" strokeWidth={2}>
          <path d="M 73.57 61.10 A 10 10 0 0 0 68.71 55.18" />
          <path d="M 73.57 61.10 L 86.97 57.03" />
          <path d="M 68.71 55.18 L 75.31 42.83" />
          <path d="M 87.88 61.65 A 24 24 0 0 0 85.17 52.69" />
          <path d="M 79.23 45.43 A 24 24 0 0 0 70.97 41.03" />
          <path d="M 87.88 61.65 L 103.81 60.08" />
          <path d="M 85.17 52.69 L 99.28 45.14" />
          <path d="M 79.23 45.43 L 89.38 33.05" />
          <path d="M 70.97 41.03 L 75.61 25.72" />
          <path d="M 104 64 A 40 40 0 0 0 103.23 56.20" />
          <path d="M 100.96 48.69 A 40 40 0 0 0 97.26 41.78" />
          <path d="M 92.28 35.72 A 40 40 0 0 0 86.22 30.74" />
          <path d="M 79.31 27.04 A 40 40 0 0 0 71.80 24.77" />
          <path d="M 104 64 L 120 64" />
          <path d="M 103.23 56.20 L 118.92 53.07" />
          <path d="M 100.96 48.69 L 115.74 42.57" />
          <path d="M 97.26 41.78 L 110.56 32.89" />
          <path d="M 92.28 35.72 L 103.60 24.40" />
          <path d="M 86.22 30.74 L 95.11 17.44" />
          <path d="M 79.31 27.04 L 85.43 12.26" />
          <path d="M 71.80 24.77 L 74.92 9.08" />
        </g>
        <use href="#evo-q64" transform="rotate(90 64 64)" />
        <use href="#evo-q64" transform="rotate(180 64 64)" />
        <use href="#evo-q64" transform="rotate(270 64 64)" />
        <g id="evo-tips64" fill="var(--tip-a, currentColor)" stroke="none">
          <circle cx="118.92" cy="53.07" r="2.3" />
          <circle cx="115.74" cy="42.57" r="2.3" />
          <circle cx="110.56" cy="32.89" r="2.3" />
          <circle cx="103.60" cy="24.40" r="2.3" />
          <circle cx="95.11" cy="17.44" r="2.3" />
          <circle cx="85.43" cy="12.26" r="2.3" />
          <circle cx="74.92" cy="9.08" r="2.3" />
        </g>
        <use href="#evo-tips64" fill="var(--tip-b, currentColor)" transform="rotate(90 64 64)" />
        <use href="#evo-tips64" transform="rotate(180 64 64)" />
        <use href="#evo-tips64" fill="var(--tip-b, currentColor)" transform="rotate(270 64 64)" />
        <circle cx="8" cy="64" r="2.3" fill="var(--tip-a, currentColor)" stroke="none" />
        <circle cx="64" cy="8" r="2.3" fill="var(--tip-b, currentColor)" stroke="none" />
        <circle cx="64" cy="120" r="2.3" fill="var(--tip-b, currentColor)" stroke="none" />
        <rect x="117.6" y="61.6" width="4.8" height="4.8" fill="currentColor" stroke="none" />
      </g>
    </defs>
  )
}

export function LogoMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      className={`evo-mark ${className}`}
      width={size}
      height={size}
      viewBox="0 0 128 128"
      role="img"
      aria-label="EvoSuite 图形标记"
    >
      <MarkDefs />
      <use href="#evo-mark" />
    </svg>
  )
}

export function Wordmark({
  size = 22,
  className = '',
}: {
  size?: number
  className?: string
}) {
  return (
    <span className={`evo-wordmark ${className}`} style={{ fontSize: size }}>
      <span className="evo">Evo</span>
      <span className="suite">Suite</span>
    </span>
  )
}

// 顶栏组合：图形标记 + 字标（科研蓝 Evo + 墨蓝 Suite）
export function BrandLockup({ markSize = 30, wordSize = 22 }: { markSize?: number; wordSize?: number }) {
  return (
    <span className="brand-lockup">
      <LogoMark size={markSize} />
      <Wordmark size={wordSize} />
    </span>
  )
}
