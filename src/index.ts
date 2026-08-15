import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  auditText,
  formatReport,
  rulesBrief,
  filterReport,
  detectDocumentProfile,
  type AuditReport,
  type Severity,
  type DocumentProfile,
} from './rules.ts'
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
   * 或位于论文目录（01_manuscript/02_reviews/08_response 等知识库布局）。
   */
  autoAuditOnWrite: boolean
  /** 自动审计的最低严重度（默认 high；high=只提示高危残留/防御性写作） */
  autoAuditMinSeverity: Severity
  /** 每个 agent 每轮最多自动注入次数（防止刷屏，默认 2） */
  maxAutoInjectPerTurn: number
  /** 项目内部词表（追加到默认内部词，命中按 medium 报） */
  projectResidueTerms: string[]
}

/**
 * 默认配置（内部常量，不导出）。
 * 注意：不能 `export const Config = {...}` —— cordis 会把导出的 Config 当
 * standard-schema 校验（调用 `Config["~standard"].validate`），普通对象没有
 * `~standard` 属性会抛 "Cannot read properties of undefined (reading 'validate')"
 * 导致整个插件树加载失败。必须作为内部常量 + apply 默认参数使用。
 */
const DEFAULT_CONFIG: Config = {
  autoBrief: false,
  verboseByDefault: false,
  autoAuditOnWrite: true,
  autoAuditMinSeverity: 'high',
  maxAutoInjectPerTurn: 2,
  projectResidueTerms: [],
}

/** 默认项目内部词表（通用痕迹，不含 priority/SHA-256 等普通学术词） */
const DEFAULT_PROJECT_TERMS = ['source_map', 'reader 锚点', 'iteration_log', 'final_audit', 'blueprint', 'full_corpus']

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
  'manuscript', 'paper', 'thesis', 'revision', 'revised', 'response', 'rebuttal', 'cover',
  '论文', '稿件', '修订', '返修', '回复', '审稿',
]

/** 知识库布局中的论文目录（工作区根下；支持多级路径前缀匹配） */
const PAPER_ROOT_DIRS = [
  '01_manuscript', '02_reviews', '03_evidence', '08_response', '09_wiki/writing',
]

function isPaperFile(filePath: string, cwd?: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  if (!MANUSCRIPT_EXT.has(ext)) return false
  const norm = filePath.replace(/\\/g, '/').toLowerCase()
  if (PAPER_PATH_HINTS.some((h) => norm.includes(h.toLowerCase()))) return true
  if (cwd) {
    const rel = path.relative(cwd, filePath).replace(/\\/g, '/').toLowerCase()
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
      // 前缀匹配（支持 09_wiki/writing 这类多级目录）
      if (PAPER_ROOT_DIRS.some((d) => rel === d || rel.startsWith(d + '/'))) return true
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

export function apply(ctx: Context, config: Partial<Config> = {}): void {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const projectTerms = [...new Set([...DEFAULT_PROJECT_TERMS, ...cfg.projectResidueTerms])]

  ctx.tools.register(defineTool({
    name: 'writing_audit',
    description:
      '对论文/稿件文本执行写作纪律扫描（本地规则，零网络）：检测修改过程残留（revised/本轮/投稿前…）、' +
      '主张校准（we do not claim/本文并非要证明…）、修辞模式（不是X而是Y/rather than/三连排比/绝对化）、' +
      'LLM 关联词（delve/tapestry/过渡词堆叠/中文套话）、学术文体与格式（抽象副词/破折号密度/冒号标题）。' +
      '可指定 profile（manuscript/rebuttal/cover_letter/review/notes）区分文档类型——rebuttal 中 "as requested" 不报警。' +
      '频率类规则按密度（次/千词）计算。输入 text 或 filePath（.txt/.md；.docx 请先经 anydoc 转 Markdown）。',
    parameters: {
      text: { type: 'string', description: '要检查的文本内容（与 filePath 二选一）' },
      filePath: { type: 'string', description: '要检查的文本文件路径（.txt/.md；二选一）' },
      profile: { type: 'string', enum: ['manuscript', 'rebuttal', 'cover_letter', 'review', 'notes', 'unknown'], description: '文档类型（可选；缺省按路径自动检测，纯文本默认 unknown）' },
      verbose: { type: 'boolean', description: 'true 时输出每条问题的提示与修改建议（默认 false，只输出原文摘要）' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      let text = args.text as string | undefined
      let profile: DocumentProfile | undefined
      if (args.profile && args.profile !== 'unknown') {
        profile = args.profile as DocumentProfile
      } else if (args.filePath) {
        profile = detectDocumentProfile(args.filePath)
      }
      if (!text && args.filePath) {
        text = await readTextFile(args.filePath)
      }
      if (!text || !text.trim()) {
        throw new Error('需要提供 text 或 filePath（内容不能为空）')
      }
      const report = auditText(text, { profile, projectResidueTerms: projectTerms })
      const verbose = args.verbose ?? cfg.verboseByDefault
      return formatReport(report, { verbose })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'writing_rules',
    description:
      '返回论文写作纪律速查清单（dsh-plugin-writing-guard v0.3）：修改过程残留、主张校准、修辞模式、LLM 关联词、' +
      '学术文体与格式、发布会原则与自查项（含文档类型 profile 与密度规则说明）。' +
      '写作/修改任何论文段落前可先调用本工具加载纪律，写完后用 writing_audit 复查。' +
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
          const profile = detectDocumentProfile(target)
          report = auditText(await readTextFile(target), { profile, projectResidueTerms: projectTerms })
        } catch {
          return decision // 二进制/不可读文件跳过
        }
        // 修正版过滤：high > medium > low，且重算 summary
        const filtered = filterReport(report, cfg.autoAuditMinSeverity)
        if (filtered.hits.length === 0) return decision

        const nextCount = (state && state.turn === turn ? state.count : 0) + 1
        injectCounts.set(agent.id, { turn, count: nextCount })

        const text = [
          `【dsh-plugin-writing-guard 自动审计】刚写入的论文文件 "${target}"（profile: ${report.profile}）发现 ${filtered.summary.total} 处写作纪律问题（高 ${filtered.summary.high} / 中 ${filtered.summary.medium} / 低 ${filtered.summary.low}）：`,
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

  // ---------- autoBrief：每轮注入纪律速查（默认关闭） ----------

  if (cfg.autoBrief) {
    // 每 agent 每 N 轮注入一次，避免打扰（默认每 5 轮）
    const briefCounts = new Map<string, { turn: number }>()
    const BRIEF_EVERY_TURNS = 5

    ctx.on('agent/disposed', ({ agent }) => {
      briefCounts.delete(agent.id)
    })

    ctx.on('agent/turn-stopping', async ({ agent, turn }) => {
      try {
        const cwd = (agent as { session?: { header?: { cwd?: string } } }).session?.header?.cwd
        // 只在论文工作区注入（知识库布局或路径含论文特征）
        if (!cwd || !/manuscript|paper|论文|稿件|修订|返修|review|审稿/.test(cwd)) return
        const prev = briefCounts.get(agent.id)
        if (prev && turn - prev.turn < BRIEF_EVERY_TURNS) return
        briefCounts.set(agent.id, { turn })
        ;(agent as { inject?: (msg: unknown) => void }).inject?.(createUserMessage({
          content: [{ type: 'text', text: rulesBrief() }],
          source: { kind: 'plugin', plugin: name },
        }))
      } catch (error) {
        ctx.logger.warn(`dsh-plugin-writing-guard: autoBrief failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
  }
}
