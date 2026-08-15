import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { auditText, formatReport, rulesBrief, type AuditReport } from './rules.ts'
import fs from 'node:fs/promises'
import path from 'node:path'

export const name = 'dsh-plugin-writing-guard'

export const inject = ['tools']

export interface Config {
  /** 写作纪律速查是否在每轮自动注入（默认 false，避免打扰） */
  autoBrief: boolean
  /** audit 时是否默认 verbose（输出每条建议） */
  verboseByDefault: boolean
  /**
   * 论文文件写入后是否自动审计并注入结果（默认 true）。
   * 监听 write/edit 目标文件：.md/.tex/.txt 且路径含论文特征（manuscript/paper/论文/修订/revision/response/回复/rebuttal）
   * 或工作区根包含论文特征目录（01_manuscript/02_reviews/08_response 等知识库布局）。
   */
  autoAuditOnWrite: boolean
  /** 自动审计的最低严重度（默认 high；high=只提示高危残留/防御性写作） */
  autoAuditMinSeverity: 'high' | 'medium' | 'low'
  /** 每个 agent 每轮最多自动注入次数（防止刷屏，默认 2） */
  maxAutoInjectPerTurn: number
}

export const Config: Config = {
  autoBrief: false,
  verboseByDefault: false,
  autoAuditOnWrite: true,
  autoAuditMinSeverity: 'high',
  maxAutoInjectPerTurn: 2,
}

/** 从文件读取文本（.txt/.md/.markdown 直接读；.docx 请先经 anydoc 转 Markdown） */
async function readTextFile(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.docx' || ext === '.doc' || ext === '.pdf') {
    throw new Error(`"${filePath}" 是二进制文档，请先调用 anydoc 工具转换为 Markdown，再对转换结果执行 writing_audit`)
  }
  return fs.readFile(filePath, 'utf8')
}

// ---------- 论文文件识别 ----------

const MANUSCRIPT_EXT = new Set(['.md', '.markdown', '.tex', '.txt'])

/** 论文特征路径段（相对路径任意层级命中即视为论文文件） */
const PAPER_PATH_HINTS = [
  'manuscript', 'paper', 'thesis', 'review', 'revision', 'revised', 'response', 'rebuttal', 'cover',
  '论文', '稿件', '修订', '返修', '回复', '审稿',
]

/** 知识库布局中的论文目录（工作区根下） */
const PAPER_ROOT_DIRS = new Set([
  '01_manuscript', '02_reviews', '03_evidence', '08_response', '09_wiki/writing',
])

function isPaperFile(filePath: string, cwd?: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  if (!MANUSCRIPT_EXT.has(ext)) return false
  const norm = filePath.replace(/\\/g, '/').toLowerCase()
  if (PAPER_PATH_HINTS.some((h) => norm.includes(h.toLowerCase()))) return true
  if (cwd) {
    const rel = path.relative(cwd, filePath).replace(/\\/g, '/').toLowerCase()
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
      const firstSeg = rel.split('/')[0]
      if (firstSeg && [...PAPER_ROOT_DIRS].some((d) => d.toLowerCase() === firstSeg)) return true
    }
  }
  return false
}

/** 提取 write/edit 的目标文件路径 */
function targetPathOf(exec: { name?: string; arguments?: unknown }): string | null {
  const name = exec.name
  if (name !== 'write' && name !== 'edit') return null
  const args = exec.arguments as { file_path?: string; filePath?: string } | null | undefined
  const p = args?.file_path ?? args?.filePath
  return typeof p === 'string' && p ? p : null
}

/** 按严重度过滤 hits，返回摘要文本 */
function summarizeHits(report: AuditReport, minSeverity: 'high' | 'medium' | 'low'): AuditReport {
  const order: Record<string, number> = { high: 0, medium: 1, low: 2 }
  const threshold = order[minSeverity]
  return {
    ...report,
    hits: report.hits.filter((h) => order[h.severity] >= threshold),
  }
}

export function apply(ctx: Context, config: Config = Config): void {
  const cfg = { ...Config, ...config }

  ctx.tools.register(defineTool({
    name: 'writing_audit',
    description:
      '对论文/稿件文本执行写作纪律扫描（本地规则，零网络）：检测修改过程语句残留（revised/本轮/投稿前…）、' +
      '防御性写作（we do not claim/本文并非要证明…）、AI 痕迹句式（破折号密度/不是X而是Y/rather than 滥用/绝对化定义/冒号标题/抽象副词/LLM高频词 delve-tapestry-testament/三连排比/过渡词）' +
      '与一般文体问题。输入 text（正文内容）或 filePath（.txt/.md；.docx 请先经 anydoc 转 Markdown）。' +
      '返回按严重度排序的违规清单与全文统计；写作或修改完稿后应运行一次。',
    parameters: {
      text: { type: 'string', description: '要检查的文本内容（与 filePath 二选一）' },
      filePath: { type: 'string', description: '要检查的文本文件路径（.txt/.md；二选一）' },
      verbose: { type: 'boolean', description: 'true 时输出每条问题的提示与修改建议（默认 false，只输出原文摘要）' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      let text = args.text as string | undefined
      if (!text && args.filePath) {
        text = await readTextFile(args.filePath)
      }
      if (!text || !text.trim()) {
        throw new Error('需要提供 text 或 filePath（内容不能为空）')
      }
      const report = auditText(text)
      const verbose = args.verbose ?? cfg.verboseByDefault
      return formatReport(report, { verbose })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'writing_rules',
    description:
      '返回论文写作纪律速查清单（dsh-plugin-writing-guard）：修改过程残留、防御性写作、AI 痕迹句式（审稿人识别重点，' +
      '含 LLM 高频词表）、发布会原则与自查项。写作/修改任何论文段落前可先调用本工具加载纪律，写完后用 writing_audit 复查。' +
      '插件也会在论文文件被写入后自动审计（autoAuditOnWrite）。',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    isConcurrencySafe: () => true,
    async execute() {
      return rulesBrief()
    },
  }))

  // ---------- 自动审计：论文文件写入后自动检查并注入结果 ----------

  if (cfg.autoAuditOnWrite) {
    // 每个 agent 每轮注入计数（turn 维度重置）
    const injectCounts = new Map<string, { turn: number; count: number }>()

    ctx.on('agent/disposed', ({ agent }) => {
      injectCounts.delete(agent.id)
    })

    ctx.on('tools/post-execute', async (exec, _result, next) => {
      // 先放行原始结果，拿到决策
      const decision = await next()
      try {
        const target = targetPathOf(exec)
        if (!target) return decision
        const agent = (exec as { agent?: { id?: string } }).agent
        if (!agent || typeof agent.id !== 'string') return decision

        // 每轮注入次数限制
        const turn = (exec as { turn?: number }).turn ?? -1
        const state = injectCounts.get(agent.id)
        if (state && state.turn === turn && state.count >= cfg.maxAutoInjectPerTurn) return decision

        // 只审计论文类文件
        if (!isPaperFile(target, (agent as { session?: { header?: { cwd?: string } } }).session?.header?.cwd)) return decision

        let report: AuditReport
        try {
          report = auditText(await readTextFile(target))
        } catch {
          return decision // 二进制/不可读文件跳过
        }
        const filtered = summarizeHits(report, cfg.autoAuditMinSeverity)
        if (filtered.hits.length === 0) return decision

        const nextCount = (state && state.turn === turn ? state.count : 0) + 1
        injectCounts.set(agent.id, { turn, count: nextCount })

        const text = [
          `【dsh-plugin-writing-guard 自动审计】刚写入的论文文件 "${target}" 发现 ${filtered.summary.total} 处写作纪律问题（高 ${filtered.summary.high} / 中 ${filtered.summary.medium} / 低 ${filtered.summary.low}）：`,
          '',
          formatReport(filtered, { verbose: false }),
          '',
          '请按上述建议在下一轮修正这些表述（重点是高危项：修改过程残留与防御性写作），修改后可再次调用 writing_audit 复查。',
        ].join('\n')

        const notice = createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'plugin', plugin: name },
        })

        // 把自动审计结果作为下一条请求的附加上下文（不阻塞本次调用）
        return {
          ...decision,
          additionalContexts: [...(decision.additionalContexts ?? []), notice],
        }
      } catch (error) {
        ctx.logger.warn(`dsh-plugin-writing-guard: auto audit failed: ${error instanceof Error ? error.message : String(error)}`)
        return decision
      }
    })
  }
}
