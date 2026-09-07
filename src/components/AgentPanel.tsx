import { useEffect, useRef, useState } from 'react'
import { useStore, useT } from '../store'
import { parseFasta, SeqRecord } from '../lib/fasta'
import { SAMPLE_FASTA } from '../lib/sample'

interface Msg {
  role: 'agent' | 'user'
  text: string
  actions?: { label: string; view?: 'sequences' | 'build' | 'advanced' | 'report' }[]
}

// 本地规则式助手：基于关键词匹配给出引导（浏览器/桌面均可用，无需后端）。
// 真实部署时可将 onSend 替换为后端 LLM 调用。
function localReply(input: string, ctx: { nSeq: number }): Msg {
  const q = input.toLowerCase()
  const a = (text: string, actions?: Msg['actions']): Msg => ({ role: 'agent', text, actions })
  if (/skyline|天际线/.test(q))
    return a(
      '贝叶斯天际线（Bayesian Skyline）用来估计有效种群规模 Ne 随时间（现在→过去）的变化。在 Advanced Analyze → Skyline 中选择种群动态模型（恒定/指数/天际线）并运行即可。',
      [{ label: '打开 Advanced Analyze', view: 'advanced' }],
    )
  if (/phylod|系统动态|r0|tmrca|再生/.test(q))
    return a(
      '系统动态（Phylodynamics）分析可估算 TMRCA、增长率 r、替换速率、R₀ 与当前 Ne，并绘制合并率 λ 曲线。在 Advanced Analyze → Phylodynamics 标签中运行。',
      [{ label: '打开 Advanced Analyze', view: 'advanced' }],
    )
  if (/beast|内核|引擎/.test(q))
    return a(
      'BEAST1 内核驱动天际线与系统动态分析。桌面端检测到 beast 二进制时运行真实 MCMC，否则使用内置近似曲线（结果标注为 Built-in）。',
    )
  if (/tree|树|build|建树|nj|upgma/.test(q))
    return a(
      '建树可选 NJ / UPGMA / ML，可在 Build 中设置替换模型、bootstrap 与 BEAST1 内核。建树前建议先完成距离矩阵（Distance）。',
      [{ label: '前往建树', view: 'build' }],
    )
  if (/report|报告|导出/.test(q))
    return a(
      'Report 汇总数据概览、方法、系统发育树与序列清单，可导出 Markdown / HTML / FASTA。若已运行 BEAST1，报告会包含天际线与系统动态指标。',
      [{ label: '打开报告', view: 'report' }],
    )
  if (/start|开始|流程|workflow|怎么用|如何/.test(q))
    return a(
      `当前已载入 ${ctx.nSeq} 条序列。推荐流程：序列数据 → 距离矩阵 → 建树 → 高级分析(天际线/系统动态) → 报告。可先从示例数据起步。`,
      [
        { label: '载入示例数据', view: 'sequences' },
        { label: '打开高级分析', view: 'advanced' },
      ],
    )
  if (/hello|hi|你好|嗨|help|帮助/.test(q))
    return a('你好！我是 EvoSuite AI 助手 🤖，可以帮你规划分析流程、解释天际线与系统动态结果、或跳转到对应步骤。试试下面的快捷问题。')
  return a(
    '我可以帮你规划进化与系统动态分析流程。你可以问：如何建树？天际线是什么？R₀ 怎么算？或点下方快捷问题。',
  )
}

export default function AgentPanel() {
  const t = useT()
  const setView = useStore((s) => s.setView)
  const setSequences = useStore((s) => s.setSequences)
  const pushLog = useStore((s) => s.pushLog)
  const nSeq = useStore((s) => s.sequences.length)

  const [msgs, setMsgs] = useState<Msg[]>([
    {
      role: 'agent',
      text:
        '你好！我是 EvoSuite AI 助手 🤖。我可以帮你规划分析流程、解释天际线/系统动态结果，并一键跳转到对应步骤。',
    },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs])

  const send = (text?: string) => {
    const value = (text ?? input).trim()
    if (!value || busy) return
    setBusy(true)
    setInput('')
    const userMsg: Msg = { role: 'user', text: value }
    const reply = localReply(value, { nSeq })
    setMsgs((m) => [...m, userMsg, reply])
    pushLog(t('agent.logAsk', { q: value.slice(0, 24) }), 'info')
    setBusy(false)
  }

  const quick = [
    { q: t('agent.qStart'), run: () => send(t('agent.qStart')) },
    { q: t('agent.qSkyline'), run: () => send(t('agent.qSkyline')) },
    { q: t('agent.qPhylo'), run: () => send(t('agent.qPhylo')) },
    { q: t('agent.qTree'), run: () => send(t('agent.qTree')) },
  ]

  const doLoadSample = () => {
    const recs = parseFasta(SAMPLE_FASTA) as SeqRecord[]
    setSequences(recs)
    pushLog(t('log.sampleLoaded', { n: recs.length }), 'ok')
    setView('sequences')
  }

  const onAction = (act?: Msg['actions'][number]) => {
    if (!act) return
    if (act.view === 'sequences') doLoadSample()
    else if (act.view) setView(act.view)
  }

  return (
    <aside className="agent-panel">
      <div className="agent-head">
        <span className="agent-ava">🤖</span>
        <div>
          <div className="agent-name">{t('agent.name')}</div>
          <div className="agent-sub">{t('agent.sub')}</div>
        </div>
        <span className="agent-dot" title={t('agent.online')} />
      </div>

      <div className="agent-log" ref={scrollRef}>
        {msgs.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            <div className="bubble-text">{m.text}</div>
            {m.actions && (
              <div className="bubble-acts">
                {m.actions.map((a, j) => (
                  <button key={j} className="bubble-act" onClick={() => onAction(a)}>
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="agent-quick">
        {quick.map((q, i) => (
          <button key={i} className="agent-chip" onClick={q.run}>
            {q.q}
          </button>
        ))}
      </div>

      <div className="agent-input">
        <input
          className="sel-input"
          placeholder={t('agent.inputPh')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <button className="btn primary agent-send" onClick={() => send()} disabled={busy || !input.trim()}>
          {t('agent.send')}
        </button>
      </div>
    </aside>
  )
}
