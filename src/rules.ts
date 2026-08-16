/**
 * Writing-discipline rule engine for dsh-plugin-writing-guard.
 *
 * v0.3.0 architecture (per external review):
 *  - document profiles: rules are scoped to document types (manuscript /
 *    rebuttal / cover_letter / review / notes) so e.g. "as requested by the
 *    reviewer" is a high-severity residue in a manuscript but perfectly
 *    normal in a rebuttal.
 *  - confidence + evidence: severity answers "how bad", confidence answers
 *    "how sure we are"; frequency rules use density (minCount + perK)
 *    instead of absolute counts.
 *  - category split: process_residue / claim_calibration / rhetorical_pattern
 *    / llm_associated / academic_style / formatting — not everything is an
 *    "AI trace".
 *
 * Rule sources (see 09_wiki/writing/写作纪律_防AI痕迹与防御性写作.md):
 *  - Reviewer-shared AI-writing-tell list (OCR of two JPGs)
 *  - 扬长避短提示词 (no self-deprecation, no reviewer bait)
 *  - ESR guide (no revision-process residue, boundaries stated once)
 *  - Kobak et al., Science Advances (2025; >15M biomedical abstracts) for
 *    LLM-associated vocabulary spikes; community word lists.
 *
 * All rules are local regex/statistics — zero network, zero LLM calls.
 */

export type Category =
  | 'process_residue'      // 修改过程残留（revised/as requested/本轮/投稿前）
  | 'claim_calibration'    // 主张校准（防御性写作、自我削弱、过度设限）
  | 'rhetorical_pattern'   // 修辞模式（不是X而是Y、rather than 滥用、三连排比、绝对化）
  | 'llm_associated'       // LLM 关联词汇（delve/tapestry/过渡词堆叠/中文套话）
  | 'academic_style'       // 学术文体（we believe/模糊词/抽象副词）
  | 'formatting'           // 格式（破折号密度、冒号标题）

export type Severity = 'high' | 'medium' | 'low'

export type Confidence = 'high' | 'medium' | 'low'

/** 插件版本（单点定义：state 标记、工具描述、规则速查共用，避免多处硬编码漂移） */
export const PLUGIN_VERSION = '0.7.0'

export type DocumentProfile =
  | 'manuscript'    // 论文正文（含摘要/引言/方法/结果/讨论）
  | 'rebuttal'      // 逐条回复信 / response to reviewers
  | 'cover_letter'  // 投稿信
  | 'review'        // 审稿意见/评审笔记
  | 'notes'         // 一般笔记/草稿
  | 'unknown'

export interface Evidence {
  type: 'literature' | 'style-guide' | 'heuristic' | 'project-specific'
  source?: string
}

/** 密度阈值：count >= minCount AND count/denominator*1000 >= perK 才报警 */
export interface Threshold {
  minCount?: number
  /** 每千单位阈值（denominator 见 unit） */
  perK?: number
  /** 密度分母单位：'word'（默认，英文按词；中文用 Intl.Segmenter 切词）| 'char'（纯字符）| 'sentence'（v0.6 按句） */
  unit?: 'word' | 'char' | 'sentence'
}

/** 语言适应的词/字计数（v0.3.1：不要用英文 whitespace-word 衡量中文） */
export function countLexicalUnits(text: string): { englishWords: number; cjkChars: number } {
  // 中文字符单独计数（无空格），其余按空白切词
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)
  const cjkChars = cjk ? cjk.length : 0
  const nonCjk = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ')
  const m = nonCjk.match(/\S+/g)
  const englishWords = m ? m.length : 0
  return { englishWords, cjkChars }
}

/** 兼容：密度分母用词/字合计（英文按词、中文按字） */
export function countWords(text: string): number {
  const { englishWords, cjkChars } = countLexicalUnits(text)
  return englishWords + cjkChars
}

/** 按规则单位计算密度分母（v0.3.3：language-aware——英文规则用英文词数、中文规则用 CJK 字数，双语文件不再互相稀释） */
function denominatorForRule(text: string, rule: Rule, unit: 'word' | 'char' | 'sentence' | undefined): number {
  if (unit === 'sentence') {
    // v0.6：句子单位（hedge 密度等按句归一）
    return splitSentences(text).length
  }
  if (unit === 'char') {
    // char 单位：优先用 CJK 字数（中文规则），比 text.length 更准（不含英文/标点/Markdown 符号）
    const { cjkChars } = countLexicalUnits(text)
    return cjkChars > 0 ? cjkChars : text.length
  }
  const { englishWords, cjkChars } = countLexicalUnits(text)
  // 语言感知：规则声明单一语言时用对应分母
  if (rule.languages?.length === 1) {
    if (rule.languages[0] === 'en') return englishWords
    if (rule.languages[0] === 'zh') return cjkChars
  }
  return englishWords + cjkChars
}

// ---------------------------------------------------------------------------
// v0.6 sentence-level utilities（零依赖）
// ---------------------------------------------------------------------------

/** 句子切分（中英混合；不切分号——分号是句内分隔）。
 *  半角句号只在后跟大写/中文时切（避免切坏 "Fig. 3"、"et al. (2020)"、"e.g."）；缩写点后跟小写不切。 */
export function splitSentences(text: string): string[] {
  return text
    .split(/[。！？!?]+(?=\s|$|[\u4e00-\u9fffA-Z"'（(])|\.(?=\s+[A-Z\u4e00-\u9fff]|$)/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** 中位数（排序后取中） */
export function medianOf(arr: number[]): number {
  if (arr.length === 0) return 0
  const s = [...arr].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** 标准差（总体） */
export function stdOf(arr: number[]): number {
  if (arr.length === 0) return 0
  const mu = arr.reduce((a, b) => a + b, 0) / arr.length
  return Math.sqrt(arr.reduce((a, b) => a + (b - mu) ** 2, 0) / arr.length)
}

const SIM_STOP = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'and', 'is', 'are', 'was', 'were', 'that', 'this',
  'with', 'for', 'on', 'as', 'by', 'at', 'from', 'it', 'its', 'we', 'our', 'be', 'been',
  'can', 'may', 'have', 'has', 'had', 'not', 'but', 'or', 'which', 'their', 'they', 'them',
  'than', 'these', 'those', 'such', 'into', 'over', 'between', 'while', 'using', 'used',
  'use', 'via', 'per', 'after', 'before', 'due', 'more', 'most', 'however', 'therefore',
  'thus', 'also', 'results', 'result', 'method', 'methods', 'model', 'data', 'paper', 'study',
])

/**
 * v0.6 restatement-loop 相似度 token：英文按词（小写、去停用词），
 * 中文按相邻 2-gram 字符（无空格语言无法按词）。
 */
export function tokenizeForSimilarity(sentence: string): Map<string, number> {
  const freq = new Map<string, number>()
  const bump = (t: string): void => { freq.set(t, (freq.get(t) ?? 0) + 1) }
  const en = sentence.toLowerCase().match(/[a-z][a-z'-]*/g)
  for (const w of en ?? []) {
    if (!SIM_STOP.has(w)) bump(w)
  }
  const cjk = sentence.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []
  for (let i = 0; i + 1 < cjk.length; i++) bump(cjk[i] + cjk[i + 1])
  return freq
}

/** 余弦相似度（两个 token 频率向量） */
export function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (const [k, v] of a) {
    na += v * v
    const w = b.get(k)
    if (w) dot += v * w
  }
  for (const v of b.values()) nb += v * v
  const d = Math.sqrt(na) * Math.sqrt(nb)
  return d === 0 ? 0 : dot / d
}

/** 句子的科研证据实体（数字/百分数/引用/图表编号/大写实体）——restatement 判断"后句是否有新增" */
function evidenceTokens(sentence: string): Set<string> {
  const hits = sentence.match(/\b\d+(?:\.\d+)?%?|\b[A-Z][a-z]{2,}\b|\\cite|\\ref|Table\s*\d|Figure\s*\d/g) ?? []
  return new Set(hits.map((t) => t.toLowerCase()))
}

/** v0.6 作者风格档案（从作者历史论文统计；零 LLM） */
export interface StyleProfile {
  /** 句长中位数（词/字合计） */
  sentenceLengthMedian: number
  /** 句长标准差 */
  sentenceLengthStd: number
  /** 段长中位数（词/字合计） */
  paragraphLengthMedian: number
  /** 破折号密度（/千词） */
  emDashPerK: number
  /** hedge 密度（/千词） */
  hedgePerK: number
  /** 连接词密度（/千词） */
  connectivePerK: number
}

/** 从文本计算风格指标（作者历史或当前稿件皆可） */
export function computeStyleProfile(text: string): StyleProfile {
  const sentences = splitSentences(text)
  const lens = sentences.map((s) => countWords(s))
  const paraLens = text
    .split(/\n{2,}/)
    .map((p) => countWords(p.trim()))
    .filter((n) => n > 0)
  const words = countWords(text)
  const perK = (n: number): number => (words > 0 ? Math.round((n / words) * 1000 * 100) / 100 : 0)
  const hedgeRe = /\b(may|might|could|possibly|potentially|perhaps)\b/gi
  const connRe = /\b(moreover|furthermore|additionally|however|therefore|thus|consequently|in addition)\b/gi
  const emRe = /(——|—|–—)/g
  return {
    sentenceLengthMedian: medianOf(lens),
    sentenceLengthStd: Math.round(stdOf(lens) * 100) / 100,
    paragraphLengthMedian: medianOf(paraLens),
    emDashPerK: perK((text.match(emRe) ?? []).length),
    hedgePerK: perK((text.match(hedgeRe) ?? []).length),
    connectivePerK: perK((text.match(connRe) ?? []).length),
  }
}

// ---------------------------------------------------------------------------
// v0.6 Scholarship Lock：科研实体提取与前后对比（零 LLM，纯确定性）
// ---------------------------------------------------------------------------

export type ScholarshipType =
  | 'number'   // 带单位数字（精度/测量值）
  | 'percent'  // 百分数
  | 'pvalue'   // p 值
  | 'ci'       // 置信区间
  | 'cite'     // \cite{...}
  | 'ref'      // \ref{...}
  | 'figure'   // Figure N
  | 'table'    // Table N
  | 'doi'      // DOI

export interface ScholarshipEntity {
  type: ScholarshipType
  value: string
}

const SCHOLARSHIP_EXTRACTORS: [ScholarshipType, RegExp][] = [
  ['cite', /\\cite\*?\{[^{}]*\}/g],
  ['ref', /\\ref\*?\{[^{}]*\}/g],
  ['figure', /\bFigures?\s*\d+[a-z]?\b/gi],
  ['table', /\bTables?\s*\d+[a-z]?\b/gi],
  ['percent', /\b\d+(?:\.\d+)?\s*%/g],
  ['pvalue', /\bp\s*[<≤=]\s*0?\.?\d+/gi],
  ['ci', /\b\d+(?:\.\d+)?\s*[–—-]\s*\d+(?:\.\d+)?\s*(?:CI|%|m|mm|nm|mL|ml|mg|µg|kg|g|s|ms|h|d|°C|K)\b/g],
  ['doi', /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/gi],
  ['number', /\b\d+(?:\.\d+)?\s*(?:mm|nm|cm|km|kg|g|mg|µg|μg|mL|ml|L|s|ms|h|d|°C|K|Hz|kHz|MHz|V|W|J|mol|M)\b/g],
]

/** 提取文本中的科研实体（Scholarship Lock 的数据源） */
export function extractScholarshipEntities(text: string): ScholarshipEntity[] {
  const out: ScholarshipEntity[] = []
  for (const [type, re] of SCHOLARSHIP_EXTRACTORS) {
    for (const m of text.matchAll(re)) out.push({ type, value: m[0].trim() })
  }
  return out
}

export interface ScholarshipChange {
  type: ScholarshipType
  before: string
  after: string
}

export interface ScholarshipDiff {
  /** 成对变化（同类型同数量时按顺序配对，如 87.3% → 89.1%） */
  changed: ScholarshipChange[]
  /** 消失的实体（citation/ref/图表编号等） */
  removed: ScholarshipEntity[]
  /** 新增的实体 */
  added: ScholarshipEntity[]
}

/**
 * 多重集差异：按出现次数而不是集合去重，避免“两个相同数值中改掉一个”
 * 被漏报（例如 before 有 5 mm、5 mm，after 有 5 mm、6 mm，应报 5 mm → 6 mm）。
 * 返回值保留原顺序，便于数值类实体按顺序配对。
 */
function diffValueLists(beforeValues: string[], afterValues: string[]): { removed: string[]; added: string[] } {
  const bCounts = new Map<string, number>()
  const aCounts = new Map<string, number>()
  for (const v of beforeValues) bCounts.set(v, (bCounts.get(v) ?? 0) + 1)
  for (const v of afterValues) aCounts.set(v, (aCounts.get(v) ?? 0) + 1)

  const removed = beforeValues.filter((v) => {
    const bCount = bCounts.get(v) ?? 0
    const aCount = aCounts.get(v) ?? 0
    if (bCount > aCount) {
      bCounts.set(v, bCount - 1)
      return true
    }
    return false
  })
  const added = afterValues.filter((v) => {
    const aCount = aCounts.get(v) ?? 0
    const bCount = bCounts.get(v) ?? 0
    if (aCount > bCount) {
      aCounts.set(v, aCount - 1)
      return true
    }
    return false
  })
  return { removed, added }
}

/** v0.6 Scholarship Lock：对比修改前后的科研事实（数字/引用/图表编号/DOI） */
export function diffScholarship(before: string, after: string): ScholarshipDiff {
  const changed: ScholarshipChange[] = []
  const removed: ScholarshipEntity[] = []
  const added: ScholarshipEntity[] = []
  const types: ScholarshipType[] = ['cite', 'ref', 'figure', 'table', 'percent', 'pvalue', 'ci', 'doi', 'number']
  for (const t of types) {
    const bv = extractScholarshipEntities(before).filter((e) => e.type === t).map((e) => e.value)
    const av = extractScholarshipEntities(after).filter((e) => e.type === t).map((e) => e.value)
    const { removed: rm, added: ad } = diffValueLists(bv, av)
    // 数值类实体按顺序配对为 changed（如 87.3% → 89.1%）
    if (t === 'number' || t === 'percent' || t === 'pvalue' || t === 'ci') {
      const n = Math.min(rm.length, ad.length)
      for (let i = 0; i < n; i++) changed.push({ type: t, before: rm[i], after: ad[i] })
      for (const v of rm.slice(n)) removed.push({ type: t, value: v })
      for (const v of ad.slice(n)) added.push({ type: t, value: v })
    } else {
      for (const v of rm) removed.push({ type: t, value: v })
      for (const v of ad) added.push({ type: t, value: v })
    }
  }
  return { changed, removed, added }
}

const SCHOLARSHIP_TYPE_LABEL: Record<ScholarshipType, string> = {
  number: '带单位数值', percent: '百分数', pvalue: 'p 值', ci: '置信区间',
  cite: '\\cite 引用', ref: '\\ref 引用', figure: 'Figure 编号', table: 'Table 编号', doi: 'DOI',
}

export interface Rule {
  id: string
  category: Category
  severity: Severity
  confidence: Confidence
  label: string              // 中文名称
  pattern: RegExp            // 命中模式（段落级或全文统计级）
  message: string            // 提示语
  suggestion: string         // 修改建议
  /** 每条规则最多报告的命中数（防止刷屏），默认 3；全文统计级规则忽略 */
  maxHits?: number
  /** 全文统计级密度阈值（设定后该规则不参与段落级扫描） */
  threshold?: Threshold
  /** 适用的文档类型；缺省 = 所有类型；'unknown' 也执行（保守，宁可多报让用户判断） */
  profiles?: DocumentProfile[]
  languages?: ('zh' | 'en')[]
  evidence?: Evidence
  /** 合法使用场景说明（显示在报告中，避免误伤） */
  note?: string
  /**
   * 命中位置局部的上下文判断（v0.3.1：match-local，不再整段排除——防止
   * 同段落内合法用法连带放过真正的残留）：
   *   exclude: 命中词 ±window 内匹配则跳过（文献引用语境、统计证据等）
   *   require: 命中词 ±window 内必须匹配否则跳过（正向证据）
   */
  context?: {
    window: number
    exclude?: RegExp
    require?: RegExp
  }
  /** 密度规则的计数器（v0.3.1：单一数据源）。缺省用 pattern 对全文计数；
   *  只有 colon-title 等真正需要特殊算法的才提供。 */
  counter?: (text: string) => number
  /** v0.4：规则扫描的 segment 类型（缺省 ['prose']——references/code/math/table 默认忽略） */
  segments?: SegmentKind[]
  /** v0.4：section-based 专用规则（如 limitation-dispersal：跨章节分散检测，不走 density/段落扫描） */
  sectionBased?: boolean
  /** section-based 规则的触发阈值：命中章节数 ≥ 该值才报 */
  sectionThreshold?: number
  /** v0.6：restatement-loop 专用规则（段内句子相似度检测，不走 density/段落扫描） */
  restatementLoop?: boolean
  /**
   * v0.7：平均句长规则（全文统计级，按语言分别统计；各语言 ≥3 句才判定）。
   * 超过上限（en 按词、zh 按字）时按语言各报一次。与 overlong-sentence 互补：
   * 那个抓单句极端，这个抓整体均值。
   */
  averageLength?: { enMaxWords: number; zhMaxChars: number }
}

export interface Hit {
  ruleId: string
  category: Category
  severity: Severity
  confidence: Confidence
  label: string
  paragraphIndex: number     // -1 = 全文统计级
  snippet: string
  message: string
  suggestion: string
  note?: string
  /** v0.3.1：证据来源传播到报告（confidence+evidence 要落地到 UX） */
  evidence?: Evidence
  /** 密度信息（全文统计级规则） */
  density?: { count: number; perK: number }
  /** v0.5.2：命中原文（段落级规则填充），用于稳定指纹——同段其他文字编辑不影响指纹 */
  matchText?: string
}

export interface Stats {
  words: number
  englishWords: number       // v0.3.1：拆开，避免"中文按词"的误导
  cjkChars: number
  emDashCount: number
  colonTitleCount: number
  notXbutYCount: number
  ratherThanCount: number
  absolutistCount: number
  ruleOfThreeCount: number
  transitionCount: number
  cnConnectivesCount: number
  paragraphs: number
  chars: number
}

export interface AuditReport {
  ok: boolean
  profile: DocumentProfile
  summary: {
    total: number
    high: number
    medium: number
    low: number
    byCategory: Record<Category, number>
  }
  stats: Stats
  hits: Hit[]
}

export const CATEGORY_LABELS: Record<Category, string> = {
  process_residue: '修改过程残留',
  claim_calibration: '主张校准',
  rhetorical_pattern: '修辞模式',
  llm_associated: 'LLM 关联词',
  academic_style: '学术文体',
  formatting: '格式',
}

// ---------------------------------------------------------------------------
// 规则定义
// ---------------------------------------------------------------------------

const RULES: Rule[] = [
  // ================= process_residue 修改过程残留 =================
  {
    id: 'revised-family',
    category: 'process_residue',
    severity: 'high',
    confidence: 'high',
    label: '正文出现 "revised/revision" 修改过程残留',
    // 排除专有名词/方法名（Revised Cardiac Risk Index、revised simplex method）
    pattern: /\brevis(ed|ion|ions)?\b(?! (Cardiac Risk Index|simplex method|simplex algorithm|simplex))/gi,
    message: '正文中出现了 "revised/revision" 等修改过程语言，这是写给审稿人的元话语；正式论文读者只应看到最终版本。（专有名词如 Revised Cardiac Risk Index、revised simplex method，以及文献引用语境 “Smith proposed a revised model” 除外）',
    suggestion: '改为中性论文语言：the proposed model / the model / the present analysis / the ΔP prediction task，把“修改”动作从正文清除。',
    maxHits: 5,
    profiles: ['manuscript', 'cover_letter', 'unknown'],
    languages: ['en'],
    evidence: { type: 'style-guide', source: '写作纪律页：修改过程残留黑名单' },
    note: '在 rebuttal（回复信）中 "the revised manuscript" 属正常表述，不报警。',
    // v0.3.1：match-local 排除——只检查当前命中 ±80 字符，不再整段排除
    context: {
      window: 80,
      exclude: /(proposed|presented|introduced|described|developed|reported|published|offered) (a |the |an )?revised/i,
    },
  },
  {
    id: 'as-requested',
    category: 'process_residue',
    severity: 'high',
    confidence: 'high',
    label: '审稿回应用语残留',
    pattern: /\b(as requested|as suggested( by|,)|in response to (the )?(reviewer|comment|suggestion|concern)|to address (the |this |these |reviewer )?(concern|comment|issue|question|suggestion))\b/gi,
    message: '检测到“as requested / in response to / to address the comment”等审稿回应用语，属于修改说明语言混入正文。',
    suggestion: '直接陈述做法或结果本身，不引用审稿过程。',
    maxHits: 3,
    profiles: ['manuscript', 'cover_letter', 'unknown'],
    languages: ['en'],
    evidence: { type: 'style-guide' },
    note: 'rebuttal 中此类用语正常；仅论文正文/投稿信报警。',
  },
  {
    id: 'we-have-changed',
    category: 'process_residue',
    severity: 'high',
    confidence: 'high',
    label: '"we have updated/modified" 修改叙述',
    // v0.5.2：支持 "we have now updated" / "we now have updated" 等组合（旧实现可选组只匹配一个词）
    pattern: /\bwe (?:have |now |also ){0,3}(?:updated|modified|corrected|clarified|expanded|rewritten|replaced|revised)\b/gi,
    message: '检测到“we have updated / modified / corrected…”式修改叙述，这是给审稿人的变更说明，不是论文陈述。',
    suggestion: '把句子改写为对最终版本的直接陈述，例如直接描述模型/方法/结果，删除变更动词。',
    maxHits: 3,
    profiles: ['manuscript', 'unknown'],
    languages: ['en'],
    evidence: { type: 'style-guide' },
  },
  {
    id: 'previous-version',
    category: 'process_residue',
    severity: 'medium',
    confidence: 'medium',
    label: '提及旧版本/原稿',
    pattern: /\b(the |our |in the )(previous|original|earlier|first|old) (version|manuscript|draft|submission|model|analysis)\b/gi,
    message: '提到“previous version / original manuscript”等新旧对比，属于修改过程叙述。',
    suggestion: '除非讨论文献中的先前研究，否则删除新旧对比，只写当前结果。',
    maxHits: 3,
    profiles: ['manuscript', 'unknown'],
    languages: ['en'],
    evidence: { type: 'heuristic' },
  },
  {
    id: 'cn-revision-process',
    category: 'process_residue',
    severity: 'high',
    confidence: 'high',
    label: '中文修改过程残留',
    pattern: /(本轮|本次修改|修改稿中|投稿前|待补齐|需作者|请作者|审稿人要求|根据审稿|修订稿|返修稿|初稿中|上一版|原稿中|我们修改了|我们补充了|我们更新了|已按要求)/g,
    message: '检测到“本轮/投稿前/审稿人要求/我们修改了…”等中文修改过程语言。',
    suggestion: '删除或改写为对最终版本的直接科学陈述；确实无法恢复的信息只在方法局限中客观说明一次。',
    maxHits: 4,
    profiles: ['manuscript', 'unknown'],
    languages: ['zh'],
    evidence: { type: 'style-guide', source: 'ESR 指南：稿件层级污染' },
  },

  // ================= claim_calibration 主张校准（防御性写作） =================
  {
    id: 'we-do-not-claim',
    category: 'claim_calibration',
    severity: 'high',
    confidence: 'high',
    label: '"we do not claim" 防御性声明',
    pattern: /\bwe (do not|don'?t|make no|cannot|can'?t) (claim|intend to|attempt to|argue|prove|demonstrate)\b/gi,
    message: '“we do not claim…”是典型的防御性写作：提前堵审稿人的嘴，让论文显得在自我设限。',
    suggestion: '用证据角色、主张强度和适用边界正面表达；例如把“我们不声称X”改为“本文证据支持X的适用边界为…”。',
    maxHits: 3,
    profiles: ['manuscript', 'unknown'],
    languages: ['en'],
    evidence: { type: 'style-guide', source: '扬长避短提示词：不要主动提供负面评价' },
  },
  {
    id: 'cn-defensive-claim',
    category: 'claim_calibration',
    severity: 'high',
    confidence: 'high',
    label: '中文防御性声明',
    pattern: /(我们并不声称|我们不声称|我们并非要证明|本文并非要证明|本文不宣称|我们无意|这并不意味着|这并不代表|必须承认的是|诚然，|无可否认)/g,
    message: '“我们并不声称…/这并不意味着…”属于防御性写作：反复自我免责会让审稿人认为作者在自我设限。',
    suggestion: '同一边界只集中写一次；用证据角色表达（“该结果支持…，但未测量…”），不重复自我免责。',
    maxHits: 4,
    profiles: ['manuscript', 'unknown'],
    languages: ['zh'],
    evidence: { type: 'style-guide' },
    note: '陈述研究局限性是 ICMJE 的正当要求（Discussion 应讨论局限），本规则只针对“反复否认主张”句式，不针对 limitations 段落本身。',
  },
  {
    id: 'self-deprecation',
    category: 'claim_calibration',
    severity: 'medium',
    confidence: 'medium',
    label: '自我削弱词',
    pattern: /(遗憾的[是地]|仍明显落后|效果有限|存在严重不足|仅能初步|只能算|不敢说|远远不够|非常有限|尚显不足)/g,
    message: '检测到自我削弱式表达（“遗憾的是/仍明显落后/效果有限/存在严重不足”）。',
    suggestion: '删除或改写为客观结果陈述；不占优的结果要么不设为比赛项目，要么从目标/约束/场景解释，不要主动示弱。',
    maxHits: 3,
    profiles: ['manuscript', 'unknown'],
    languages: ['zh'],
    evidence: { type: 'style-guide', source: '扬长避短提示词' },
  },
  {
    id: 'it-should-be-noted',
    category: 'claim_calibration',
    severity: 'low',
    confidence: 'medium',
    label: '元评论开场白',
    // v0.3.1：移除 "thank"（"we would like to thank the reviewer" 在 rebuttal 中完全正常）
    pattern: /\b(it (should|must) be (noted|mentioned|pointed out|stressed|emphasized)|it is (worth|important|necessary|essential) (noting|to note|to mention)|we (would )?like to (note|point out|emphasize|stress|mention|highlight))\b/gi,
    message: '“it should be noted / it is worth noting / we would like to…”是元评论开场白，冗余且带辩护味。',
    suggestion: '直接陈述内容本身，删掉开场白。',
    maxHits: 3,
    profiles: ['manuscript', 'unknown'],
    languages: ['en'],
    evidence: { type: 'heuristic' },
  },
  {
    id: 'limitations-across-sections',
    category: 'claim_calibration',
    severity: 'low',
    confidence: 'medium',
    label: '局限性表述跨章节分散',
    // v0.4：section-based 规则——检测"局限类表述散落在 ≥3 个顶层章节"
    // v0.5.1：改名 + 文案降级（算法不做语义等价，不能声称"同一局限"）
    pattern: /(limitation|局限|不足|cannot be (generalized|extended)|not be applied)/gi,
    message: '局限性相关表述出现在 ≥3 个顶层章节，请检查是否存在重复免责；这并不意味着这些表述描述的是同一局限。',
    suggestion: '边界声明集中写：方法定位一处 + 结论边界一处；其余用证据角色表达。注意：在 Discussion 中正当陈述局限（ICMJE 要求）不算问题，重点是避免同一局限在多个章节重复。',
    languages: ['zh', 'en'],
    evidence: { type: 'style-guide', source: 'ESR 指南：边界声明集中写' },
    /** v0.4：section-based 专用规则标记 */
    sectionBased: true,
    sectionThreshold: 3,
  },

  // ================= rhetorical_pattern 修辞模式 =================
  {
    id: 'not-x-but-y-zh',
    category: 'rhetorical_pattern',
    severity: 'medium',
    confidence: 'low',
    label: '“不是X而是Y”对仗句式（中文）',
    pattern: /(真正重要的从来不是|并非[^，。；]{2,30}，而是|不是[^，。；]{2,30}，而是)/g,
    message: '“它不是X，而是Y”是审稿人点名的 AI 写作习惯：先否定普通答案再给“深刻”答案，故意假装深刻。',
    suggestion: '删掉一半“不是X而是Y”；把抽象判断换成数字、动作或场景，用具体内容支撑，而不是靠对仗显得有洞察。',
    maxHits: 4,
    languages: ['zh'],
    evidence: { type: 'heuristic', source: '审稿人截图 OCR' },
  },
  {
    id: 'not-x-but-y-en',
    category: 'rhetorical_pattern',
    severity: 'low',
    confidence: 'low',
    label: '“not X but Y”对仗句式（英文）',
    pattern: /\bnot (just |only |merely |simply )?[a-z][^.!?]{3,60}? but (?!also )[a-z][^.!?]{2,60}\b/gi,
    message: '“not X but Y”对仗是审稿人点名的 AI 写作痕迹（英文版“它不是X而是Y”）。注意：科学写作中必要的概念澄清（如 “a Darcy-derived descriptor rather than intrinsic permeability”）不算问题；本规则为低危提示，人工复核即可。',
    suggestion: '仅在确实需要对比时才保留一次；修辞性对仗改为正面陈述。',
    maxHits: 3,
    languages: ['en'],
    evidence: { type: 'heuristic' },
  },
  {
    id: 'rather-than-heavy',
    category: 'rhetorical_pattern',
    severity: 'medium',
    confidence: 'medium',
    label: '“rather than”过度使用',
    pattern: /\brather than\b/gi,
    threshold: { minCount: 4, perK: 1.0 },
    message: '“rather than”全文密度过高（≥4 次且 ≥1.0/千词），其中往往混有防御性对仗（“…rather than a claim of…”）。',
    suggestion: '逐句复核：概念澄清（如 “a Darcy-derived descriptor rather than intrinsic permeability”）可保留；防御性表述（如 “rather than a claim of uniform dominance”）改为正面陈述。',
    languages: ['en'],
    evidence: { type: 'heuristic' },
  },
  {
    id: 'absolutist-def',
    category: 'rhetorical_pattern',
    severity: 'medium',
    confidence: 'medium',
    label: '绝对化定义句式（中文）',
    pattern: /(其核心在于|其本质在于|其基础在于|其关键在于|唯[^，。；]{0,20}才|[^，。；]{0,15}的核心[^，。；]{0,10}是)/g,
    message: '“其核心/本质/基础/关键在于…”“唯…才…”是 AI 习惯的绝对化定义，仔细推敲会发现观点偏激，审稿人会反感。',
    suggestion: '改为有条件的、可检验的命题，说明在什么条件/尺度/边界下成立。',
    maxHits: 3,
    languages: ['zh'],
    evidence: { type: 'heuristic' },
  },
  {
    id: 'rule-of-three',
    category: 'rhetorical_pattern',
    severity: 'low',
    confidence: 'low',
    label: '三连排比（rule of three）',
    // v0.5.2：忽略大小写（"Clear, Concise, and Compelling" 句首大写也应命中）
    pattern: /\b[a-z]{3,}, [a-z]{3,}, and [a-z]{3,}\b/gi,
    threshold: { minCount: 4, perK: 0.8 },
    message: '“X, Y, and Z”三连排比全文密度过高（≥4 处且 ≥0.8/千词）。LLM 偏爱恰好三组的对称结构（“clear, concise, and compelling”），是社区公认的 AI 结构痕迹。',
    suggestion: '保留确实需要列举的三项；纯修辞性三连改为更自然的表述，长短句混用打破节奏。',
    languages: ['en'],
    evidence: { type: 'heuristic' },
  },

  // ================= llm_associated LLM 关联词 =================
  {
    id: 'llm-verb-noun-overuse',
    category: 'llm_associated',
    severity: 'medium',
    confidence: 'low',
    label: 'LLM 高频动词/名词（delve/tapestry/testament…）',
    pattern: /\b(delve|delve into|tapestry|testament|beacon|cornerstone|embark|meticulous|showcase|boast|seamless|unlock|elevate|foster|harness|navigate|streamline|underscore|pivotal|realm|nuanced|multifaceted|intricate|leverage|utilize|holistic|paradigm|cutting-edge|state-of-the-art)\b/gi,
    threshold: { minCount: 2, perK: 0.4 },
    message: 'LLM 高频词密度信号（Kobak et al., Science Advances 2025，>15M 摘要统计 + 社区词表）：delve/tapestry/testament/leverage/harness 等词在 ChatGPT 发布后出现率骤升。密度低时不必处理；密度高时逐词替换。',
    suggestion: '替换为更具体、更朴素的动词/名词：delve→examine/analyze，tapestry→range/body of work，testament→evidence/reflection，leverage→use/exploit，harness→apply/employ。注意：这些词是概率信号而非证据，出现 1 次不必惊慌，密度高才需处理。',
    languages: ['en'],
    evidence: { type: 'literature', source: 'Kobak et al., Science Advances 2025; Metric37; Diglot' },
    note: '密度规则：单次出现不报警，全文 ≥2 次且 ≥0.4/千词才提示。',
  },
  {
    id: 'llm-transition-overuse',
    category: 'llm_associated',
    severity: 'low',
    confidence: 'low',
    label: 'LLM 高频连接/过渡词（moreover/furthermore/in conclusion…）',
    // v0.7：并入 ko5.6sol 英文禁用过渡词（consequently/thus/hence/accordingly/thereby/to this end/notably/importantly/specifically/this matters/this motivates）——
    // 密度门槛（≥8 次且 ≥1.5/千词）保证正常学术写作（thus/hence 出现 1–2 次）不受影响
    pattern: /\b(moreover|furthermore|additionally|in conclusion|to sum up|in summary|ultimately|consequently|thus|hence|accordingly|thereby|to this end|notably|importantly|specifically|this matters|this motivates|that being said|in today's|in the realm of|when it comes to|a wide range of|plays? a crucial role in|it is worth mentioning|navigating the complexities of)\b/gi,
    threshold: { minCount: 8, perK: 1.5 },
    message: 'LLM 高频过渡词/套话密度过高（≥8 次且 ≥1.5/千词）。moreover/furthermore/in conclusion 等在 LLM 输出中过度使用，机械推进感强。',
    suggestion: '删除大部分过渡词，用内容本身的逻辑推进；段间连接靠论证关系而非连接词堆砌。学术写作中这些词出现 1–2 次正常，密度高才处理。',
    languages: ['en'],
    evidence: { type: 'literature', source: 'Kobak et al. 2025' },
  },
  {
    id: 'cn-ai-connectives',
    category: 'llm_associated',
    severity: 'low',
    confidence: 'low',
    label: '中文 AI 高频连接词',
    // v0.7：并入 ko5.6sol 中文禁用套路词（进一步/由此可见/鉴于/毫无疑问/特别地/有鉴于此/也就是说）——
    // "进一步"在学术写作中常见且多属正当（进一步研究），由密度门槛（≥8 次且 ≥2.0/千字符）把关
    pattern: /(值得注意的是|值得一提的是|不难发现|不难看出|显而易见|众所周知|综上所述|总的来说|与此同时|基于此|在此基础上|进一步|由此可见|鉴于|毫无疑问|特别地|有鉴于此|也就是说|随着[^，。；]{2,20}的发展|在[^，。；]{2,20}的背景下|需要强调的是)/g,
    threshold: { minCount: 8, perK: 2.0, unit: 'char' },
    message: '中文 AI 高频套话密度过高（≥8 次且 ≥2.0/千字符）：“值得注意的是/综上所述/与此同时/随着…的发展”等是 LLM 中文输出的典型连接词。',
    suggestion: '删除大部分套话，让论证内容直接呈现；保留少量用于真实转折即可。',
    languages: ['zh'],
    evidence: { type: 'heuristic' },
  },

  // ================= academic_style 学术文体 =================
  {
    id: 'abstract-filler',
    category: 'academic_style',
    severity: 'low',
    confidence: 'low',
    label: '抽象空泛判断',
    pattern: /\b(remarkably|interestingly|importantly|notably|critically|essentially|fundamentally|in essence|at its core)\b/gi,
    message: '检测到高频抽象副词（remarkably/interestingly/importantly…）。审稿人提醒：AI 生成的东西很泛化，乍看有道理，仔细推敲是“正确而无用的废话”。',
    suggestion: '把抽象判断换成数字、动作或场景；比如不说“significantly improves”，而说“reduces RMSE from 2.1 to 1.3”。',
    maxHits: 4,
    languages: ['en'],
    evidence: { type: 'heuristic' },
  },
  {
    id: 'significantly-context',
    category: 'academic_style',
    severity: 'low',
    confidence: 'low',
    label: '"significantly" 无统计证据',
    pattern: /\bsignificantly\b/gi,
    // v0.3.1：真正实现"附近有统计证据则跳过"（此前文案写了逻辑没实现）；match-local 窗口
    context: {
      window: 120,
      exclude: /(p\s*[<≤=]\s*0?\.?\d|p\s*=\s*0?\.?\d|95%\s*CI|confidence interval|CI\s*[\[(]|OR\s*=\s*[\d.]|HR\s*=\s*[\d.]|β\s*=\s*[\d.]|effect size|Cohen'?s\s*d|statistically significant|significant (difference|association|correlation|increase|decrease|reduction|improvement|effect|change))/i,
    },
    message: '“significantly”出现但需人工复核：若附近 ±120 字符没有效应量/p 值/置信区间等定量证据，则属于空泛判断。',
    suggestion: '统计显著性（significantly different, p < 0.05 / statistically significant）是正当学术用法，ICMJE 要求报告；仅当该词用于修辞性强调且无统计证据时，改为具体数值。',
    maxHits: 4,
    languages: ['en'],
    evidence: { type: 'literature', source: 'ICMJE: statistical vs clinical significance' },
    note: '本规则只提示复核，不直接报警——"significantly different (p<0.05)" 是正常用法。',
  },
  {
    id: 'we-believe',
    category: 'academic_style',
    severity: 'low',
    confidence: 'medium',
    label: '“we believe/think” 弱表态',
    pattern: /\bwe (believe|think|feel|hope|wish|suspect)\b/gi,
    message: '“we believe/think”是弱表态，削弱结论力度。',
    suggestion: '改为证据导向表述：“the results show / the data indicate / this is consistent with…”。',
    maxHits: 3,
    languages: ['en'],
    evidence: { type: 'heuristic' },
  },
  {
    id: 'vague-quantifiers',
    category: 'academic_style',
    severity: 'low',
    confidence: 'low',
    label: '模糊程度词',
    pattern: /\b(somewhat|quite|fairly|a bit|to some extent|to a (certain|large|limited) degree)\b/gi,
    message: '检测到模糊程度词（somewhat/quite/fairly/to some extent），过度限定削弱表述。（注意："rather than" 属正常英文表达，不计入）',
    suggestion: '能给出数值就给出数值；无法量化时保留一个最准确的限定词即可，不要堆叠。',
    maxHits: 3,
    languages: ['en'],
    evidence: { type: 'heuristic' },
  },

  // ================= formatting 格式 =================
  {
    id: 'em-dash-density',
    category: 'formatting',
    severity: 'medium',
    confidence: 'medium',
    label: '破折号密度过高',
    pattern: /(——|—|–—)/g,
    threshold: { minCount: 5, perK: 0.5 },
    message: '破折号全文密度过高（≥5 次且 ≥0.5/千词）。审稿人明确说：“破折号是否全文都是”——铺天盖地的破折号明显不是“人”的话语习惯。',
    suggestion: '删除大部分破折号，改用逗号、分号或拆句；全文保留 1–2 处即可。注意：范围连字符（30–75 °C、fold–seed）不算，只统计长破折号。',
    languages: ['zh', 'en'],
    evidence: { type: 'style-guide', source: '审稿人截图 OCR' },
  },
  {
    id: 'colon-title',
    category: 'formatting',
    severity: 'low',
    confidence: 'low',
    label: '冒号标题滥用',
    pattern: /^[^#\n]{0,60}[:：][^:：\n]{0,60}$/gm,
    threshold: { minCount: 3, perK: 0.6 },
    message: '检测到多个“XXX: XXXXXXX”式标题。审稿人指出：标题冒号前后必须是适合冒号的关系（并列或递进），否则明显是硬凑。',
    suggestion: '检查每个冒号标题：冒号前后是否并列/递进？不是则改题。',
    languages: ['zh', 'en'],
    // v0.4：只扫 heading 段（冒号标题判断只针对标题，正文里的冒号句不算）
    segments: ['heading'],
    evidence: { type: 'heuristic' },
  },

  // ================= v0.6 学术写作质量守卫 =================

  {
    id: 'hedge-density-en',
    category: 'claim_calibration',
    severity: 'medium',
    confidence: 'low',
    label: '防御性限定词密度过高（英文）',
    pattern: /\b(may|might|could|possibly|potentially|perhaps|not necessarily|cannot rule out|should be interpreted with caution|we refrain from|we do not claim)\b/gi,
    // v0.6：按句归一（unit: sentence）——每做结论都附 caveat 的"防御饱和"行为
    threshold: { minCount: 5, perK: 300, unit: 'sentence' },
    message: '防御性限定词（may/might/could/possibly/potentially…）密度过高（≥5 次且 ≥300/千句）：每做一个结论都附 caveat，文章被限定条件淹没。',
    suggestion: '有证据依据的 hedging 是正确学术表达（ICMJE），不要全部删除；重点清理同一条 claim 上的多层限定（见 hedge-stacking）和无需限定的常识结论。Discussion 中可保留正常 hedging；Abstract/Conclusion 应逐句复核。',
    languages: ['en'],
    evidence: { type: 'heuristic' },
    note: '密度规则：单次 hedge 不报警；这是"防御饱和"的整体行为检测，不是反 hedge 工具。',
  },
  {
    id: 'hedge-density-zh',
    category: 'claim_calibration',
    severity: 'medium',
    confidence: 'low',
    label: '防御性限定词密度过高（中文）',
    pattern: /(可能|或许|也许|不一定|不能排除|尚需进一步|有待进一步|需谨慎解读|并不意味着|并不代表|并非一定)/g,
    threshold: { minCount: 5, perK: 300, unit: 'sentence' },
    message: '防御性限定词（可能/或许/也许/不一定…）密度过高（≥5 次且 ≥300/千句）：每个结论都附带 caveat，自我限制淹没内容。',
    suggestion: '同一边界只写一次；有依据的限定保留，重复的自我免责删除。',
    languages: ['zh'],
    evidence: { type: 'heuristic' },
    note: '与"并非要证明"等防御性声明不同，本规则检测的是整体限定密度。',
  },
  {
    id: 'hedge-stacking',
    category: 'claim_calibration',
    severity: 'medium',
    confidence: 'medium',
    label: '限定词堆叠（一条 claim 套多层保险）',
    // 不含 well："may well be" 是正常表达；只报 hedge+hedge 真堆叠
    pattern: /\b(may|might|could|can)\s+(possibly|potentially|perhaps)\s+(suggest|indicate|imply|reflect|represent|be|lead|result)\b|(或许|也许|可能){2}/gi,
    message: '检测到限定词堆叠（"may potentially suggest"、"could possibly indicate"、中文"或许可能"）：一条 claim 套了两三层保险，是典型的防御饱和写法。',
    suggestion: '保留一层最准确的限定，其余删除："may suggest" 就够，不需要 "may potentially suggest"。',
    maxHits: 3,
    languages: ['zh', 'en'],
    evidence: { type: 'heuristic' },
  },
  {
    id: 'overlong-sentence-en',
    category: 'academic_style',
    severity: 'medium',
    confidence: 'high',
    label: '超长句 + 从句堆叠（英文）',
    // v0.6：counter 实现——句子 >35 词且从句标记 ≥3
    pattern: /\b(which|that|while|whereas|although|because|thereby|leading to|resulting in)\b/gi,
    threshold: { minCount: 2, perK: 0 },
    counter: (text: string): number => {
      let n = 0
      for (const s of splitSentences(text)) {
        const words = countLexicalUnits(s).englishWords
        const markers = (s.match(/\b(which|that|while|whereas|although|because|thereby|leading to|resulting in)\b/gi) ?? []).length
        if (words > 35 && markers >= 3) n += 1
      }
      return n
    },
    message: '存在 ≥2 个超长堆叠句（>35 词且 ≥3 个从句标记 which/that/while/because…）：一句话承载了过多独立论点。',
    suggestion: '把长句拆成 2–3 个短句；每个句子只承担一个论点。',
    languages: ['en'],
    evidence: { type: 'heuristic' },
    note: '学术英文长句常见，但">35 词 + ≥3 从句标记"同时满足才报，正常表述不受影响。',
  },
  {
    id: 'overlong-sentence-zh',
    category: 'academic_style',
    severity: 'medium',
    confidence: 'high',
    label: '超长句 + 连接词堆叠（中文）',
    pattern: /(其中|同时|进一步|从而|进而|因此|并且|尤其|这意味着)/g,
    threshold: { minCount: 2, perK: 0 },
    counter: (text: string): number => {
      let n = 0
      for (const s of splitSentences(text)) {
        const chars = countLexicalUnits(s).cjkChars
        const commas = (s.match(/[，；,;]/g) ?? []).length
        const conns = (s.match(/(其中|同时|进一步|从而|进而|因此|并且|尤其|这意味着)/g) ?? []).length
        if (chars > 80 && commas >= 5 && conns >= 3) n += 1
      }
      return n
    },
    message: '存在 ≥2 个超长句（>80 字且 ≥5 个逗号/分号且 ≥3 个逻辑连接词）：一句话塞进多个独立论点。',
    suggestion: '按连接词位置拆句，每句只讲一个论点；"其中/同时/进一步"驱动的长链改为短句。',
    languages: ['zh'],
    evidence: { type: 'heuristic' },
  },
  {
    id: 'connective-overuse',
    category: 'llm_associated',
    severity: 'low',
    confidence: 'low',
    label: '连续句首连接词',
    // v0.6：counter 实现——同一段内连续 ≥3 句以连接词开头
    pattern: /\b(Moreover|Furthermore|Additionally|In addition|However|Therefore|Thus|Consequently|Meanwhile)\b/gi,
    threshold: { minCount: 1, perK: 0 },
    counter: (text: string): number => {
      let n = 0
      for (const para of text.split(/\n{2,}/)) {
        const sents = splitSentences(para).filter((s) => s.length > 0)
        let run = 0
        for (const s of sents) {
          if (/^(Moreover|Furthermore|Additionally|In addition|However|Therefore|Thus|Consequently|Meanwhile)[,\s]/i.test(s)) {
            run += 1
            if (run >= 3) { n += 1; break }
          } else {
            run = 0
          }
        }
      }
      return n
    },
    message: '检测到同一段内连续 ≥3 句以连接词开头（Moreover/Furthermore/Additionally…），机械推进感强。',
    suggestion: '删掉大部分句首连接词，用内容本身的逻辑推进；保留少量用于真实转折。',
    languages: ['en'],
    evidence: { type: 'literature', source: 'Kobak et al. 2025' },
  },
  {
    id: 'claim-evidence-proximity',
    category: 'claim_calibration',
    severity: 'medium',
    confidence: 'low',
    label: '强主张附近缺少证据锚点',
    pattern: /\b(prove[sd]?|proven|established?|confirmed?|guarantee[sd]?|definitively|unequivocally|unambiguously|conclusively|we prove|we establish)\b/gi,
    // v0.6：附近 ±120 字符无证据锚点（数字/%/p 值/CI/图表引用/citation）才提示
    context: {
      window: 120,
      exclude: /\b\d+(?:\.\d+)?\s*%?|p\s*[<≤=]\s*0?\.?\d|\bCI\b|confidence interval|95%|Table\s*\d|Figure\s*\d|\\cite|\[\d+\]/i,
    },
    message: '检测到强主张动词（prove/establish/confirm/guarantee…），但附近 ±120 字符没有证据锚点（数字/百分数/p 值/置信区间/图表引用）。',
    suggestion: '不是说主张错误：请在强主张附近补充具体证据（数字、统计量或引用）；若确无证据支撑，弱化为证据导向表述。',
    maxHits: 3,
    languages: ['en'],
    evidence: { type: 'heuristic' },
    note: '仅提示复核：附近有数据/统计量/图表引用时不报警。',
  },
  {
    id: 'format-unicode-math',
    category: 'formatting',
    severity: 'low',
    confidence: 'low',
    label: 'Unicode 数学符号（建议改用 LaTeX 数学模式）',
    // v0.6：Unicode 下标/上标/希腊字母/数学符号在正文中（LaTeX 工作流常见"露馅"）
    pattern: /[\u2080-\u209c\u00b9\u00b2\u00b3\u2070-\u2079\u00b5\u00d7\u2212\u03b1-\u03c9\u0391-\u03a9]/g,
    message: '检测到 Unicode 下标/上标/希腊字母/数学符号（₁₂₃ ²³ α β × −…）。在 LaTeX 工作流中，这类字符往往是润色/转换时留下的格式杂质。',
    suggestion: '若是 LaTeX 文档，请改用数学模式（$x_{1}$、$\alpha$）；若已确定保留 Unicode（如生物学术语 α diversity），可忽略。',
    maxHits: 4,
    languages: ['zh', 'en'],
    evidence: { type: 'heuristic' },
    note: '低危提示：α diversity 等正当术语不受影响，人工确认即可。',
  },
  {
    id: 'restatement-loop',
    category: 'rhetorical_pattern',
    severity: 'low',
    confidence: 'low',
    label: '重复绕圈（同段句子高相似且无新增证据）',
    pattern: /(.)/,
    // v0.6：restatementLoop 专用——段内句子两两 cosine ≥ 0.72 且后句无新增证据
    restatementLoop: true,
    message: '本段相邻句子具有较高词汇重合（相似度 ≥0.72），且后句未引入新的数据、引用或实体。',
    suggestion: '检查是否在重复解释同一观点：删掉重复圈，只保留信息量最大的那一句；必要时合并为一句。',
    maxHits: 3,
    languages: ['zh', 'en'],
    evidence: { type: 'heuristic' },
    note: '词汇相似不是语义相同的证据——本规则只提示"可能"绕圈，人工复核后决定。',
  },

  // ================= v0.7 ko5.6sol 借鉴：机械感 / 平均句长 / 自黑免责 / 空洞热词 =================
  {
    id: 'cn-modifier-chain',
    category: 'rhetorical_pattern',
    severity: 'medium',
    confidence: 'low',
    label: '多重"的"字修饰链（中文）',
    pattern: /(?:[^，。；、\n:：]{1,8}的){3}[^，。；、\n:：]{1,12}/g,
    message: '检测到连续 ≥3 个"的"字修饰结构（如"基于X的Y的Z的机制"）：多重定语嵌套是 AI 中文写作的典型缠绕句，主谓宾主干被淹没。',
    suggestion: '拆成 2–3 个短句，每句只留一个修饰关系（"基于X的机制，结合Y，用于Z"）；让主谓宾主干显性化。',
    maxHits: 4,
    languages: ['zh'],
    evidence: { type: 'style-guide', source: 'ko5.6sol 文体指南（KO GPT-5.6 SOL 机械感）' },
    note: '两层"的"（如"该方法的预测结果"）不受影响；本规则只报连续 ≥3 层的嵌套链，专业术语链人工复核后决定。',
  },
  {
    id: 'avg-sentence-length',
    category: 'academic_style',
    severity: 'low',
    confidence: 'low',
    label: '平均句长超标（英文 >18 词 / 中文 >25 字）',
    pattern: /(.)/,
    averageLength: { enMaxWords: 18, zhMaxChars: 25 },
    message: '全文平均句长超过参考目标（英文 ≤18 词、中文 ≤25 字）：长句密度整体偏高，阅读负担大。',
    suggestion: '把最长的约 20% 句子拆短，向目标均值靠拢，每句只承担一个论点。注意：这是文体参考而非硬性上限——综述等文体可整体偏长，人工判断后决定是否处理。',
    languages: ['zh', 'en'],
    evidence: { type: 'style-guide', source: 'ko5.6sol 文体指南（英 12–18 词 / 中 15–25 字）' },
    note: '只报超上限；碎片短句（英 <12 词 / 中 <15 字）不报。与 overlong-sentence 互补：那个抓单句极端，这个抓整体均值。',
  },
  {
    id: 'cn-self-defeating',
    category: 'claim_calibration',
    severity: 'high',
    confidence: 'medium',
    label: '自黑式免责套话（摧毁论文价值的表述）',
    pattern: /(完全基于假数据|基于(虚构|伪造)数据|数据纯属虚构|(模型|结果|研究|方法|本文结论)(完全|根本)?毫无意义|结果完全不可靠|结论(完全)?没有意义|没有任何(实际|实用)价值|不足为凭)/g,
    message: '检测到自黑式免责套话（"完全基于假数据/模型毫无意义/结果完全不可靠/不足为凭"）：这类自我打压直接摧毁论文的学术价值，属于 AI 安全护栏被误触发的过度防御。',
    suggestion: '改写为客观边界 + 未来方向（"本研究采用模拟数据开展敏感性分析，下一步可在真实岩心实验中验证"）；区分模拟评估与真实观测（modelled vs observed），既不自我打压也不夸大。',
    maxHits: 3,
    profiles: ['manuscript', 'unknown'],
    languages: ['zh'],
    evidence: { type: 'style-guide', source: 'ko5.6sol 文体指南（KO 过度防御与自黑免责）' },
    note: '正当 limitations（"样本量有限"）不报警；本规则只针对"不可信/无意义/假数据"级自我否定。',
  },
  {
    id: 'llm-buzzword-en',
    category: 'llm_associated',
    severity: 'low',
    confidence: 'low',
    label: '空洞热词密度（英文：robust/crucial/exhibits/tailored…）',
    pattern: /\b(robust|crucial|substantially|exhibits|tailored|interplay|imperative)\b/gi,
    threshold: { minCount: 5, perK: 1.0 },
    message: '空洞热词密度过高（robust/crucial/substantially/exhibits/tailored/interplay/imperative，≥5 次且 ≥1.0/千词）。这些词本身是正常学术词（robust regression 是术语），但 AI 写作中常被用来堆砌形容词替代具体证据。',
    suggestion: '优先替换为具体证据表述：不说 "robust performance"，说 "RMSE decreased from 2.1 to 1.3"；术语用法（robust regression / robustness analysis）保留。',
    languages: ['en'],
    evidence: { type: 'literature', source: 'ko5.6sol 词表（空洞抽象热词）+ Kobak et al. 2025' },
    note: '密度规则：正常论文出现 1–3 次不报警；≥5 次且 ≥1.0/千词才提示整体堆砌。',
  },
  {
    id: 'cn-buzzword-density',
    category: 'llm_associated',
    severity: 'low',
    confidence: 'low',
    label: '抽象名词密度（中文：机制/支撑/动态/耦合/范式…）',
    pattern: /(机制|支撑|动态|稳健性?|范式|拓扑|耦合|协同|维度|全流程|精细化|解耦)/g,
    threshold: { minCount: 10, perK: 3.0, unit: 'char' },
    message: '抽象名词密度异常高（机制/支撑/动态/稳健/范式/耦合/协同/维度…，≥10 次且 ≥3.0/千字）。注意：这些词在专业文献中很多是正当术语（如"耦合机理""动态演化"），只有密度异常高时才提示检查是否在用抽象名词堆砌替代具体陈述。',
    suggestion: '逐句复核：术语用法保留；套话式抽象名词（"多维度的精细化支撑"）改为具体对象、数值或机制描述。',
    languages: ['zh'],
    evidence: { type: 'literature', source: 'ko5.6sol 词表（空洞抽象热词）' },
    note: '领域敏感规则：地学/工程文献中"机制/耦合/动态"出现频繁属正常，阈值按每千字 3 次设高门槛，低于阈值不报。',
  },
]

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 检测文档类型（从文件路径推断）——v0.3.1 收紧：peer-review 只认明确词，综述类归 manuscript */
export function detectDocumentProfile(filePath: string): DocumentProfile {
  const norm = filePath.replace(/\\/g, '/').toLowerCase()
  // v0.5.2：rebuttal 同时认 "revision_response"（返修回复的常见命名）
  if (/rebuttal|response[_ -]?to[_ -]?(reviewers?|revisions?)|revision[_ -]?response|回复审稿|返修回复|逐条回复/.test(norm)) return 'rebuttal'
  if (/cover[_ -]?letter|投稿信/.test(norm)) return 'cover_letter'
  // 明确的审稿材料（v0.3.1：systematic_review / literature_review / scoping_review / review_article 是论文而非审稿意见；
  // v0.5.2：支持 "reviewer2_comments"、"reviewer 2 comments" 这类带编号的常见命名）
  if (/(reviewer[ _\-.]?\d*[ _\-.]?comments?|review[ _\-.]?comments?|peer[_ -]?review|referee[_ -]?report|审稿意见|评审意见)/.test(norm)) return 'review'
  // 综述类论文归 manuscript
  if (/(systematic[_ -]?review|literature[_ -]?review|scoping[_ -]?review|review[_ -]?article|narrative[_ -]?review)/.test(norm)) return 'manuscript'
  // v0.5.2：补英文 revision/revised，与 isPaperFile 的判定词表对齐（revision_notes.md 等修订材料不再掉进 unknown）
  if (/manuscript|paper|thesis|revision|revised|论文|稿件|修订|返修稿/.test(norm)) return 'manuscript'
  // 一般笔记/草稿（v0.3.1：让 notes profile 可被自动检测到；v0.5.2：支持 my_notes / draft_notes 等常见前缀）
  if (/(^|[\/_\-. ])(notes?|draft|草稿|笔记|scratch)([\/_\-. ]|$)/.test(norm)) return 'notes'
  return 'unknown'
}

/** 规则计数（v0.3.1：单一数据源——优先用 rule.counter，否则用 rule.pattern 全局计数） */
function countRuleOccurrences(rule: Rule, text: string): number {
  if (rule.counter) return rule.counter(text)
  // 无 g 标志的正则克隆并加 g
  const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags + 'g')
  const m = text.match(re)
  return m ? m.length : 0
}

/** 按 ruleId 计数（v0.3.1：stats 与规则同一 source of truth，杜绝 drift） */
function countRuleById(id: string, text: string): number {
  const rule = RULES.find((r) => r.id === id)
  return rule ? countRuleOccurrences(rule, text) : 0
}

function ruleMatchesProfile(rule: Rule, profile: DocumentProfile): boolean {
  if (!rule.profiles || rule.profiles.length === 0) return true
  if (rule.profiles.includes(profile)) return true
  // unknown 文档类型：保守执行（宁可多报让用户判断）
  if (profile === 'unknown' && rule.profiles.includes('unknown')) return true
  return false
}

/** 按最小严重度过滤并重算 summary（修正版：high > medium > low） */
export function filterReport(report: AuditReport, minSeverity: Severity): AuditReport {
  const rank: Record<Severity, number> = { low: 1, medium: 2, high: 3 }
  const hits = report.hits.filter((h) => rank[h.severity] >= rank[minSeverity])

  const byCategory = {
    process_residue: 0,
    claim_calibration: 0,
    rhetorical_pattern: 0,
    llm_associated: 0,
    academic_style: 0,
    formatting: 0,
  } as Record<Category, number>
  let high = 0, medium = 0, low = 0
  for (const h of hits) {
    byCategory[h.category] += 1
    if (h.severity === 'high') high += 1
    else if (h.severity === 'medium') medium += 1
    else low += 1
  }

  return {
    ...report,
    ok: hits.length === 0,
    hits,
    summary: { total: hits.length, high, medium, low, byCategory },
  }
}

// ---------------------------------------------------------------------------
// v0.5 incremental lint：指纹与增量 diff（"新增 1 / 解决 4 / 仍存在 8"）
// ---------------------------------------------------------------------------

/**
 * v0.5.2：稳定指纹——aggregate（density/section）规则用 ruleId（每文件每种最多一个）；
 * 段落级用 ruleId + 命中原文（matchText）归一化。
 *
 * 为什么不用命中点 ±60/80 的上下文片段：同一段落内其他位置的编辑会改变片段，
 * 导致同一个未修复的问题被误判为 resolved+added，每次编辑都重新注入（v0.5.1 只修了
 * density 指纹，段落级仍会抖动）。命中原文只在问题真正被修复时消失——语义正好是
 * "该处命中已解决"。代价：两处命中词相同的不同位置共享指纹，修复其一后另一处仍在时
 * 不报 resolved（保守正确，宁可少报不误报）。
 */
export function hitFingerprint(h: Hit): string {
  // aggregate hit（density / section-based）：snippet 含 count/denominator 会随编辑变化，
  // 不能作为指纹（4/3200 → 4/3300 会被误判为 resolved+added）
  if (h.paragraphIndex === -1) {
    return `aggregate::${h.ruleId}`
  }
  const core = (h.matchText ?? '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60)
  return `${h.ruleId}::${core || '?'}`
}

export interface AuditDiff {
  added: Hit[]          // 新出现的问题
  resolved: string[]    // 已解决的指纹（只给摘要，不保留旧 hit 细节）
  remaining: number     // 仍存在的问题数
  previousTotal: number // 上一次问题数
  currentTotal: number  // 当前问题数
}

/** 对比上一次指纹集合与当前 hits，返回增量（自动模式只告诉 agent 新增/解决） */
export function diffAudit(previous: Set<string>, current: Hit[]): AuditDiff {
  const currentFps = new Set(current.map((h) => hitFingerprint(h)))
  const added = current.filter((h) => !previous.has(hitFingerprint(h)))
  const resolved: string[] = []
  for (const fp of previous) {
    if (!currentFps.has(fp)) resolved.push(fp)
  }
  return {
    added,
    resolved,
    remaining: currentFps.size,
    previousTotal: previous.size,
    currentTotal: currentFps.size,
  }
}

/** 序列化/反序列化指纹集合（用于持久化到磁盘） */
export function serializeFingerprints(fps: Set<string>): string[] {
  return [...fps]
}

export function deserializeFingerprints(arr: unknown): Set<string> {
  if (!Array.isArray(arr)) return new Set()
  return new Set(arr.filter((x): x is string => typeof x === 'string'))
}

// ---------------------------------------------------------------------------
// 主审计
// ---------------------------------------------------------------------------

/**
 * v0.4 preprocessing：从"一串 replace"升级为 segment pipeline。
 * 文档被切分为带类型的 Segment，规则声明自己扫描的 segment 类型——
 * LLM 词表只扫 prose，colon-title 只扫 heading，references/code/math/table 默认忽略。
 */
export type SegmentKind = 'prose' | 'heading' | 'reference' | 'code' | 'math' | 'table'

export interface Segment {
  kind: SegmentKind
  /** 清洗后的文本（行内 code/math/URL/LaTeX 已剥离） */
  text: string
  /** v0.5.1：标题级别（Markdown # 数量 / LaTeX section=1 subsection=2...），非 heading 段无此字段 */
  headingLevel?: number
}

export interface DocumentView {
  raw: string
  segments: Segment[]
  /** 兼容字段：所有 prose + heading 段拼接（规则默认扫描范围） */
  prose: string
  headings: string[]
  references: string
}

/** v0.5.1：LaTeX 命令分类——argument 是引用 key 的命令整体删除，不把 key 留进 prose */
const DROP_ARG_COMMANDS = new Set([
  'cite', 'citep', 'citet', 'citep', 'citet', 'citenum', 'ref', 'eqref', 'autoref', 'label',
  'bibliography', 'includegraphics', 'url', 'href', 'index', 'footnote',
])

/** 行内清理：剥离行内 code / LaTeX math / Markdown 链接（保留 anchor）/ URL / LaTeX 命令 */
function cleanInline(t: string): string {
  let s = t
  s = s.replace(/`[^`\n]*`/g, ' ')
  s = s.replace(/\$[^$\n]+\$/g, ' ')
  s = s.replace(/\[([^\]]+)\]\(https?:\/\/[^)]*\)/g, '$1')
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  s = s.replace(/https?:\/\/\S+/g, ' ')
  // v0.5.1：引用/标签类命令整体删除（\cite{smith-revised-2025} → ''，key 不是 prose）
  s = s.replace(new RegExp(`\\\\(?:${[...DROP_ARG_COMMANDS].join('|')})\\*?\\{([^{}]*)\\}`, 'g'), ' ')
  // 格式化命令保留 argument（\textbf{important result} → important result）
  s = s.replace(/\\[a-zA-Z]+\{([^{}]*)\}/g, '$1')
  s = s.replace(/\\[a-zA-Z]+\s*/g, ' ')
  return s
}

const REF_HEADING_RE =
  /(?:^|\n)\s*(?:#{1,6}\s*)?(?:references|bibliography|参考文献)\s*:?\s*(?:\n|$)|\\begin\{thebibliography\}|\\section\*?\{References\}|\\section\*?\{Bibliography\}/i

/** 块级分段器：识别 YAML/code fence/表格/标题/公式块/References/正文 */
export function preprocess(text: string): DocumentView {
  const segments: Segment[] = []
  const lines = text.split(/\r?\n/)
  let i = 0

  const flushProse = (buf: string[]): void => {
    if (buf.length === 0) return
    const raw = buf.join('\n')
    const cleaned = cleanInline(raw)
    // prose 段按空行再拆（保持段落粒度）
    for (const para of cleaned.split(/\n{2,}/)) {
      const p = para.trim()
      if (p.length > 0) segments.push({ kind: 'prose', text: p })
    }
  }

  let buf: string[] = []

  while (i < lines.length) {
    const line = lines[i]
    // References 段：从 References 标题到下一个标题行（v0.5.2：References 之后的
    // Appendix/Supplementary 常以 heading 开头，不再被整段吞进 reference 而漏扫）
    if (REF_HEADING_RE.test('\n' + line + '\n')) {
      flushProse(buf); buf = []
      let end = lines.length
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\s{0,3}(#{1,6})\s+/.test(lines[j]) || /^\s*\\(sub)*section\*?\{/.test(lines[j])) {
          end = j
          break
        }
      }
      segments.push({ kind: 'reference', text: lines.slice(i, end).join('\n') })
      i = end
      continue
    }
    // YAML frontmatter（文件开头）
    if (i === 0 && /^---\s*$/.test(line)) {
      flushProse(buf); buf = []
      const end = lines.findIndex((l, j) => j > i && /^---\s*$/.test(l))
      if (end > 0) {
        segments.push({ kind: 'code', text: lines.slice(i, end + 1).join('\n') })
        i = end + 1
        continue
      }
    }
    // code fence
    if (/^\s*(```|~~~)/.test(line)) {
      flushProse(buf); buf = []
      const fence = line.match(/^\s*(```|~~~)/)![1]
      const end = lines.findIndex((l, j) => j > i && l.trim().startsWith(fence))
      const endIdx = end > 0 ? end : lines.length - 1
      segments.push({ kind: 'code', text: lines.slice(i, endIdx + 1).join('\n') })
      i = endIdx + 1
      continue
    }
    // Markdown 标题（v0.5.1：记录 heading level 供 section hierarchy 使用）
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/)
    if (heading) {
      flushProse(buf); buf = []
      segments.push({ kind: 'heading', text: cleanInline(heading[2].trim()), headingLevel: heading[1].length })
      i += 1
      continue
    }
    // LaTeX section/subsection 标题（v0.5.1：记录 level）
    const latexHeading = line.match(/^\s*\\(sub)*section\*?\{([^}]+)\}/)
    if (latexHeading) {
      flushProse(buf); buf = []
      const level = 1 + (latexHeading[1]?.match(/sub/g)?.length ?? 0)
      segments.push({ kind: 'heading', text: cleanInline(latexHeading[2].trim()), headingLevel: level })
      i += 1
      continue
    }
    // LaTeX 块公式（$$...$$ 单独行 或 equation 环境）
    if (/^\s*\$\$/.test(line) || /^\s*\\begin\{equation/.test(line)) {
      flushProse(buf); buf = []
      // 先检测单行闭合 $$...$$，避免把后续正文全部吞进 math
      const trimmed = line.trim()
      if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 4) {
        segments.push({ kind: 'math', text: line })
        i += 1
        continue
      }
      const start = i
      if (/^\s*\$\$/.test(line)) {
        const end = lines.findIndex((l, j) => j > i && /^\s*\$\$/.test(l))
        const endIdx = end > 0 ? end : lines.length - 1
        segments.push({ kind: 'math', text: lines.slice(start, endIdx + 1).join('\n') })
        i = endIdx + 1
      } else {
        const end = lines.findIndex((l, j) => j > i && /\\end\{equation/.test(l))
        const endIdx = end > 0 ? end : lines.length - 1
        segments.push({ kind: 'math', text: lines.slice(start, endIdx + 1).join('\n') })
        i = endIdx + 1
      }
      continue
    }
    // Markdown 表格（当前行含 | 且下一行是分隔符 |---|）
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|—-]+\|?\s*$/.test(lines[i + 1])) {
      flushProse(buf); buf = []
      const start = i
      while (i < lines.length && /^\s*\|/.test(lines[i])) i += 1
      segments.push({ kind: 'table', text: lines.slice(start, i).join('\n') })
      continue
    }
    // 普通行 → prose 缓冲
    buf.push(line)
    i += 1
  }
  flushProse(buf)

  const headings = segments.filter((s) => s.kind === 'heading').map((s) => s.text)
  const references = segments.filter((s) => s.kind === 'reference').map((s) => s.text).join('\n')
  const prose = segments
    .filter((s) => s.kind === 'prose' || s.kind === 'heading')
    .map((s) => s.text)
    .join('\n\n')

  return { raw: text, segments, prose, headings, references }
}

/** 常见论文章节名（用于 section detection） */
const SECTION_NAMES = [
  'abstract', 'introduction', 'methods', 'methodology', 'materials and methods', 'results',
  'discussion', 'conclusion', 'conclusions', 'limitations', 'related work',
  '摘要', '引言', '方法', '材料与方法', '结果', '讨论', '结论', '局限性', '相关工作',
]

export interface Section {
  name: string
  text: string
}

/**
 * v0.4 section detection：把 heading 段映射到章节，正文按章节归组。
 * v0.5.1：维护 heading hierarchy——Discussion 下的 "Sample size / External validity /
 * Measurement" 子标题不拆成三个 section。
 * v0.5.2：章节基准层级 = 第一个匹配常见章节名的 heading 的层级。Markdown 常见结构
 * "# 论文标题" + "## Introduction/## Methods" 时章节是 level 2；全用 "# Introduction"
 * 时基准为 1。修复了旧实现把 "# 标题" 当章节、所有正文归入其下导致跨章节检测失效的问题。
 */
export function detectSections(view: DocumentView): Section[] {
  let baseLevel = 1
  for (const seg of view.segments) {
    if (seg.kind !== 'heading') continue
    const level = seg.headingLevel ?? 1
    const lower = seg.text.toLowerCase()
    if (SECTION_NAMES.some((s) => lower.includes(s))) {
      baseLevel = level
      break
    }
  }

  const sections: Section[] = []
  let current = 'unknown'
  let buf: string[] = []

  const flush = () => {
    if (buf.length > 0) {
      sections.push({ name: current, text: buf.join('\n') })
      buf = []
    }
  }

  for (const seg of view.segments) {
    if (seg.kind === 'heading') {
      const level = seg.headingLevel ?? 1
      if (level === baseLevel) {
        flush()
        const lower = seg.text.toLowerCase()
        const matched = SECTION_NAMES.find((s) => lower.includes(s))
        current = matched ?? seg.text.slice(0, 40)
      }
      // 子标题（level ≠ 基准）：不新开 section，正文继续归当前顶层章节
    } else if (seg.kind === 'prose') {
      buf.push(seg.text)
    }
  }
  flush()
  return sections
}

export interface AuditOptions {
  profile?: DocumentProfile
  maxParagraphs?: number
  /** 项目内部词表（默认已有通用词；用户可在配置中追加/覆盖） */
  projectResidueTerms?: string[]
  /** v0.4：true 时先预处理再审计（剥离 references/code/math/URL），默认 true */
  preprocess?: boolean
  /** v0.6 Scholarship Lock：修改前文本；提供时对比数字/引用/图表编号等科研实体的变化（HIGH） */
  original?: string
  /** v0.6 Author Style Profile：作者历史风格档案（writing_style_profile 生成）；提供时检测句长分布漂移 */
  styleProfile?: StyleProfile
}

export interface RestatementLoop {
  paraIndex: number
  sim: number
  sentences: [string, string]
}

/**
 * v0.6 重复绕圈检测：段内句子两两 cosine 相似 ≥0.72，且后句未引入新的
 * 证据实体（数字/引用/图表编号/大写实体）→ 疑似同一观点换说法重复解释。
 * 每段最多报 1 对。纯 token 统计，零 LLM。
 */
export function findRestatementLoops(text: string, max: number): RestatementLoop[] {
  const out: RestatementLoop[] = []
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  for (let pi = 0; pi < paragraphs.length && out.length < max; pi++) {
    const sents = splitSentences(paragraphs[pi]).slice(0, 12)
    if (sents.length < 3) continue
    const toks = sents.map(tokenizeForSimilarity)
    const evs = sents.map(evidenceTokens)
    let reported = false
    for (let i = 0; i < sents.length - 1 && !reported; i++) {
      for (let j = i + 1; j < sents.length && !reported; j++) {
        const sim = cosineSimilarity(toks[i], toks[j])
        if (sim >= 0.72) {
          const newEvidence = [...evs[j]].filter((e) => !evs[i].has(e))
          if (newEvidence.length === 0) {
            out.push({ paraIndex: pi, sim, sentences: [sents[i], sents[j]] })
            reported = true
          }
        }
      }
    }
  }
  return out
}

export function auditText(text: string, opts?: AuditOptions): AuditReport {
  const profile = opts?.profile ?? 'unknown'
  const maxParagraphs = opts?.maxParagraphs ?? 400
  // v0.4 preprocessing：默认剥离 references/code/math/URL，规则只扫 prose
  const view: DocumentView =
    opts?.preprocess === false
      ? { raw: text, prose: text, segments: [{ kind: 'prose', text }], headings: [], references: '' }
      : preprocess(text)
  const scanText = view.prose
  const paragraphs = scanText
    .split(/\n{2,}|\r?\n\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .slice(0, maxParagraphs)

  // v0.4：按 segment 类型分组文本（stats 与规则共用同一来源）
  const segTextByKind: Partial<Record<SegmentKind, string>> = {}
  for (const seg of view.segments) {
    const prev = segTextByKind[seg.kind] ?? ''
    segTextByKind[seg.kind] = prev ? prev + '\n\n' + seg.text : seg.text
  }
  const headingText = segTextByKind.heading ?? ''

  const { englishWords, cjkChars } = countLexicalUnits(scanText)
  const words = englishWords + cjkChars
  const stats: Stats = {
    words,
    englishWords,
    cjkChars,
    // v0.3.1：统计与规则同一 source of truth（杜绝 counter 漂移）
    emDashCount: countRuleById('em-dash-density', scanText),
    // v0.4：colon-title 只统计 heading 段（与规则 segments 声明一致）
    colonTitleCount: countRuleById('colon-title', headingText),
    notXbutYCount: countRuleById('not-x-but-y-zh', scanText) + countRuleById('not-x-but-y-en', scanText),
    ratherThanCount: countRuleById('rather-than-heavy', scanText),
    absolutistCount: countRuleById('absolutist-def', scanText),
    ruleOfThreeCount: countRuleById('rule-of-three', scanText),
    transitionCount: countRuleById('llm-transition-overuse', scanText),
    cnConnectivesCount: countRuleById('cn-ai-connectives', scanText),
    paragraphs: paragraphs.length,
    chars: scanText.length,
  }

  const hits: Hit[] = []

  // v0.4：section-based 规则（如 limitation-dispersal）——先做跨章节检测
  const sections = detectSections(view)

  for (const rule of RULES) {
    // 文档类型过滤
    if (!ruleMatchesProfile(rule, profile)) continue
    // 语言过滤：无法可靠检测语言时全部执行（规则本身多为双语正则）

    // v0.4 section-based 规则：统计命中章节数，≥ threshold 才报
    if (rule.sectionBased) {
      const threshold = rule.sectionThreshold ?? 3
      const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags + 'g')
      const hitSections = new Map<string, number>()
      for (const sec of sections) {
        const m = sec.text.match(re)
        if (m && m.length > 0) hitSections.set(sec.name, (hitSections.get(sec.name) ?? 0) + m.length)
      }
      if (hitSections.size >= threshold) {
        const detail = [...hitSections.entries()].map(([n, c]) => `${n}×${c}`).join(', ')
        hits.push({
          ruleId: rule.id,
          category: rule.category,
          severity: rule.severity,
          confidence: rule.confidence,
          label: rule.label,
          paragraphIndex: -1,
          snippet: `（跨章节统计）局限类表述出现在 ${hitSections.size} 个章节：${detail}`,
          message: rule.message,
          suggestion: rule.suggestion,
          note: rule.note,
          evidence: rule.evidence,
        })
      }
      continue
    }

    // v0.6 restatement-loop 规则：段内句子相似度（不依赖固定词表）
    if (rule.restatementLoop) {
      const loops = findRestatementLoops(scanText, rule.maxHits ?? 3)
      for (const l of loops) {
        hits.push({
          ruleId: rule.id,
          category: rule.category,
          severity: rule.severity,
          confidence: rule.confidence,
          label: rule.label,
          paragraphIndex: l.paraIndex,
          snippet: `（相似度 ${(l.sim * 100).toFixed(0)}%）句 A：${l.sentences[0].slice(0, 90)} … 句 B：${l.sentences[1].slice(0, 90)}`,
          message: rule.message,
          suggestion: rule.suggestion,
          note: rule.note,
          evidence: rule.evidence,
          matchText: l.sentences[0].slice(0, 40),
        })
      }
      continue
    }

    // v0.7 averageLength 规则：全文平均句长（按语言分别统计；各语言 ≥3 句才判定）。
    // 与 density/段落扫描不同：判定条件是"均值超上限"，按语言各报一次。
    if (rule.averageLength) {
      const sents = splitSentences(scanText)
      const enLens: number[] = []
      const zhLens: number[] = []
      for (const s of sents) {
        const { englishWords, cjkChars } = countLexicalUnits(s)
        if (englishWords > 0) enLens.push(englishWords)
        if (cjkChars > 0) zhLens.push(cjkChars)
      }
      const avg = (arr: number[]): number => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)
      const { enMaxWords, zhMaxChars } = rule.averageLength
      if (enLens.length >= 3 && avg(enLens) > enMaxWords) {
        const enAvg = avg(enLens)
        hits.push({
          ruleId: rule.id,
          category: rule.category,
          severity: rule.severity,
          confidence: rule.confidence,
          label: rule.label,
          paragraphIndex: -1,
          snippet: `（全文统计）英文平均句长 ${enAvg.toFixed(1)} 词 > 目标 ${enMaxWords} 词（共 ${enLens.length} 句）`,
          message: rule.message,
          suggestion: rule.suggestion,
          note: rule.note,
          evidence: rule.evidence,
          density: { count: Math.round(enAvg * 10) / 10, perK: 0 },
        })
      }
      if (zhLens.length >= 3 && avg(zhLens) > zhMaxChars) {
        const zhAvg = avg(zhLens)
        hits.push({
          ruleId: rule.id,
          category: rule.category,
          severity: rule.severity,
          confidence: rule.confidence,
          label: rule.label,
          paragraphIndex: -1,
          snippet: `（全文统计）中文平均句长 ${zhAvg.toFixed(1)} 字 > 目标 ${zhMaxChars} 字（共 ${zhLens.length} 句）`,
          message: rule.message,
          suggestion: rule.suggestion,
          note: rule.note,
          evidence: rule.evidence,
          density: { count: Math.round(zhAvg * 10) / 10, perK: 0 },
        })
      }
      continue
    }

    // segment 过滤（v0.4）：规则只扫自己声明的类型，缺省 prose
    const ruleSegs = rule.segments ?? ['prose']
    const ruleText = ruleSegs.map((k) => segTextByKind[k] ?? '').filter((s) => s.length > 0).join('\n\n')
    if (!ruleText.trim()) continue

    // 密度规则（全文统计级）——v0.3.3 P0：用 segment 过滤后的文本；v0.4：只统计声明类型
    if (rule.threshold) {
      const count = countRuleOccurrences(rule, ruleText)
      const unit = rule.threshold.unit ?? 'word'
      const denominator = denominatorForRule(ruleText, rule, unit)
      const rate = denominator > 0 ? (count / denominator) * 1000 : 0
      const okCount = rule.threshold.minCount === undefined || count >= rule.threshold.minCount
      const okRate = rule.threshold.perK === undefined || rate >= rule.threshold.perK
      if (okCount && okRate) {
        hits.push({
          ruleId: rule.id,
          category: rule.category,
          severity: rule.severity,
          confidence: rule.confidence,
          label: rule.label,
          paragraphIndex: -1,
          snippet: `（全文统计）${rule.label}：${count} 次 / ${denominator} ${unit === 'char' ? '字符' : '词'}（${rate.toFixed(2)}/千${unit === 'char' ? '字符' : '词'}）`,
          message: rule.message,
          suggestion: rule.suggestion,
          note: rule.note,
          evidence: rule.evidence,
          density: { count, perK: Math.round(rate * 100) / 100 },
        })
      }
      continue
    }

    // 段落级规则：只扫描规则声明的 segment 类型。
    // v0.5.2：用带 g 的克隆正则在同一段落内继续 exec，同段多处命中都报告（受 maxHits 全局上限约束）；
    // 不再修改共享的 rule.pattern.lastIndex。context 排除只跳过当前命中，继续本段后续位置。
    const ruleParagraphs = ruleText
      .split(/\n{2,}|\r?\n\r?\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .slice(0, maxParagraphs)
    const maxHits = rule.maxHits ?? 3
    let found = 0
    const scanRe = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags + 'g')
    for (let i = 0; i < ruleParagraphs.length && found < maxHits; i++) {
      const para = ruleParagraphs[i]
      scanRe.lastIndex = 0
      let m: RegExpExecArray | null
      while (found < maxHits && (m = scanRe.exec(para)) !== null) {
        // 命中位置局部上下文（v0.3.1 match-local）：只看当前 match ±window，不再整段排除
        if (rule.context && m.index !== undefined) {
          const { window: w, exclude, require: requireRe } = rule.context
          const start = Math.max(0, m.index - w)
          const end = Math.min(para.length, m.index + (m[0]?.length ?? 0) + w)
          const windowText = para.slice(start, end)
          if (exclude && exclude.test(windowText)) continue
          if (requireRe && !requireRe.test(windowText)) continue
        }
        found += 1
        const start = Math.max(0, m.index - 60)
        const end = Math.min(para.length, m.index + (m[0]?.length ?? 0) + 80)
        const snippet = (start > 0 ? '…' : '') + para.slice(start, end) + (end < para.length ? '…' : '')
        hits.push({
          ruleId: rule.id,
          category: rule.category,
          severity: rule.severity,
          confidence: rule.confidence,
          label: rule.label,
          paragraphIndex: i,
          snippet,
          message: rule.message,
          suggestion: rule.suggestion,
          note: rule.note,
          evidence: rule.evidence,
          matchText: m[0],
        })
      }
      scanRe.lastIndex = 0
    }
  }

  // 项目内部词表（可配置）：project-specific residue
  const projectTerms = opts?.projectResidueTerms ?? []
  if (projectTerms.length > 0) {
    const esc = projectTerms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    const re = new RegExp(`(?:${esc})`, 'g')
    let found = 0
    for (let i = 0; i < paragraphs.length && found < 5; i++) {
      const para = paragraphs[i]
      const m = re.exec(para)
      if (!m) continue
      found += 1
      const start = Math.max(0, (m.index ?? 0) - 60)
      const end = Math.min(para.length, (m.index ?? 0) + (m[0]?.length ?? 0) + 80)
      hits.push({
        ruleId: 'project-residue',
        category: 'process_residue',
        severity: 'medium',
        confidence: 'medium',
        label: '项目内部词表残留',
        paragraphIndex: i,
        snippet: (start > 0 ? '…' : '') + para.slice(start, end) + (end < para.length ? '…' : ''),
        message: `检测到项目内部词表条目 "${m[0]}"（可通过 writing_audit 的 projectResidueTerms 参数或插件配置维护）。`,
        suggestion: '确认为内部流程词则删除或改写；若不是内部词，请从 projectResidueTerms 移除。',
        evidence: { type: 'project-specific' },
        matchText: m[0],
      })
      re.lastIndex = 0
    }
  }

  // v0.6 Scholarship Lock：对比修改前后的科研实体（数字/引用/图表编号/DOI）。
  // 注意用原始文本（view.raw）——prose 已剥离 \cite 等 LaTeX 命令，无法对比引用。
  if (opts?.original !== undefined && opts.original.trim()) {
    const diff = diffScholarship(opts.original, view.raw)
    const lockTypes = new Set<ScholarshipType>(['cite', 'ref', 'figure', 'table', 'percent', 'pvalue', 'ci'])
    for (const c of diff.changed) {
      hits.push({
        ruleId: 'scholarship-lock',
        category: 'claim_calibration',
        severity: 'high',
        confidence: 'high',
        label: `科研实体被修改（${SCHOLARSHIP_TYPE_LABEL[c.type]}）`,
        paragraphIndex: -1,
        snippet: `${c.before} → ${c.after}`,
        message: '润色操作改变了科研事实（数字/统计量/数值与修改前不一致）。如果这是有意的科学内容修改，请显式确认；如果只是语言润色，请恢复原值。',
        suggestion: `恢复原值（${c.before}），或在回复中显式说明这是有意的科学修改（而非语言润色）。`,
        evidence: { type: 'heuristic' },
        matchText: `scholarship:${c.type}:${c.before}->${c.after}`,
      })
    }
    for (const r of diff.removed) {
      if (!lockTypes.has(r.type)) continue
      hits.push({
        ruleId: 'scholarship-lock',
        category: 'claim_calibration',
        severity: 'high',
        confidence: 'high',
        label: `科研实体消失（${SCHOLARSHIP_TYPE_LABEL[r.type]}）`,
        paragraphIndex: -1,
        snippet: r.value,
        message: `修改后丢失了 ${SCHOLARSHIP_TYPE_LABEL[r.type]}：${r.value}。引用/图表编号不应在润色中被删除。`,
        suggestion: '恢复被删除的引用/编号；如确为有意删除，请显式确认。',
        evidence: { type: 'heuristic' },
        matchText: `scholarship-removed:${r.type}:${r.value}`,
      })
    }
  }

  // v0.6 Author Style Profile：句长分布漂移检测（偏离作者历史写作分布）
  if (opts?.styleProfile) {
    const lens = splitSentences(scanText).map((s) => countWords(s))
    if (lens.length >= 5) {
      const med = medianOf(lens)
      const sp = opts.styleProfile
      const threshold = Math.max(sp.sentenceLengthMedian * 0.5, sp.sentenceLengthStd * 2, 8)
      const dev = Math.abs(med - sp.sentenceLengthMedian)
      if (dev > threshold) {
        hits.push({
          ruleId: 'style-profile-drift',
          category: 'academic_style',
          severity: 'low',
          confidence: 'low',
          label: '句长分布偏离作者历史风格',
          paragraphIndex: -1,
          snippet: `（风格档案对比）当前句长中位数 ${med} 词 vs 作者历史 ${sp.sentenceLengthMedian} 词（偏差 ${dev.toFixed(1)} > 阈值 ${threshold.toFixed(1)}）`,
          message: '当前文本的句长分布明显偏离作者历史写作风格（中位数句长偏差超过阈值）。',
          suggestion: '把超长句拆短（或把碎片句合并），向作者历史分布靠拢；如本文有意采用不同风格（如综述），可忽略。',
          evidence: { type: 'project-specific' },
        })
      }
    }
  }

  const byCategory = {
    process_residue: 0,
    claim_calibration: 0,
    rhetorical_pattern: 0,
    llm_associated: 0,
    academic_style: 0,
    formatting: 0,
  } as Record<Category, number>
  let high = 0, medium = 0, low = 0
  for (const h of hits) {
    byCategory[h.category] += 1
    if (h.severity === 'high') high += 1
    else if (h.severity === 'medium') medium += 1
    else low += 1
  }

  return {
    ok: hits.length === 0,
    profile,
    summary: { total: hits.length, high, medium, low, byCategory },
    stats,
    hits,
  }
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------

export function formatReport(report: AuditReport, opts?: { verbose?: boolean }): string {
  const { summary, stats, hits } = report
  const lines: string[] = []
  const profileTag = report.profile !== 'unknown' ? `（文档类型: ${report.profile}）` : ''
  lines.push(`写作纪律检查报告${profileTag}：${hits.length === 0 ? '✅ 通过' : `发现 ${summary.total} 处问题（高 ${summary.high} / 中 ${summary.medium} / 低 ${summary.low}）`}`)
  lines.push(`- 统计：${stats.paragraphs} 段 / ${stats.chars} 字符（英文 ${stats.englishWords} 词 + 中文 ${stats.cjkChars} 字）；破折号 ${stats.emDashCount}；rather than ${stats.ratherThanCount}；不是X而是Y ${stats.notXbutYCount}；绝对化定义 ${stats.absolutistCount}；三连排比 ${stats.ruleOfThreeCount}；LLM过渡词 ${stats.transitionCount}；中文套话 ${stats.cnConnectivesCount}；冒号标题 ${stats.colonTitleCount}`)
  if (hits.length === 0) return lines.join('\n')

  const cats = Object.entries(summary.byCategory)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${CATEGORY_LABELS[k as Category]} ${n}`)
    .join(' / ')
  lines.push(`- 分类：${cats}`)
  lines.push('')
  const order: Record<Severity, number> = { high: 0, medium: 1, low: 2 }
  const confRank: Record<Confidence, number> = { high: 0, medium: 1, low: 2 }
  const sorted = [...hits].sort(
    (a, b) => order[a.severity] - order[b.severity] || confRank[a.confidence] - confRank[b.confidence] || a.paragraphIndex - b.paragraphIndex,
  )
  for (const h of sorted) {
    const sev = h.severity === 'high' ? '🔴' : h.severity === 'medium' ? '🟠' : '🟡'
    const loc = h.paragraphIndex >= 0 ? `[para ${h.paragraphIndex}]` : '[全文]'
    lines.push(`${sev} [${h.severity.toUpperCase()} · conf ${h.confidence}] ${h.label} ${loc}`)
    lines.push(`    原文：${h.snippet.trim().slice(0, 200)}`)
    if (opts?.verbose) {
      lines.push(`    提示：${h.message}`)
      lines.push(`    建议：${h.suggestion}`)
      if (h.evidence) {
        const src = h.evidence.source ? ` — ${h.evidence.source}` : ''
        lines.push(`    依据：${h.evidence.type}${src}`)
      }
      if (h.note) lines.push(`    备注：${h.note}`)
    }
    lines.push('')
  }
  if (!opts?.verbose) {
    lines.push('（提示：加 verbose=true 可查看每条的建议与备注）')
  }
  return lines.join('\n')
}

/** 输出给 Agent 的纪律速查文本（写作前加载） */
export function rulesBrief(): string {
  return [
    `# 论文写作纪律速查（dsh-plugin-writing-guard v${PLUGIN_VERSION}）`,
    '',
    '## 一、修改过程残留（process residue，仅正文/投稿信）',
    '- 正文不得出现 "revised/revision"、"as requested"、"we have updated"、"previous version" 等修改过程语言',
    '- 中文不得出现：本轮/本次修改/投稿前/待补齐/审稿人要求/我们修改了 等',
    '- 版本号、文件名、SHA、内部流程名词不得进入正文；项目内部词可配置 projectResidueTerms',
    '- 例外：rebuttal（回复信）中 "the revised manuscript / as requested" 属正常表述',
    '',
    '## 二、主张校准（claim calibration）',
    '- 不得使用 "we do not claim"、"本文并非要证明"、"这并不意味着" 等反复自我设限句式',
    '- 自我削弱词（遗憾的是/仍明显落后/效果有限/存在严重不足）删除或改写',
    '- 边界声明集中写（方法定位 1 处 + 结论边界 1 处）；研究局限性在 Discussion 正当陈述（ICMJE 要求），但同一局限不要在多个章节重复',
    '',
    '## 三、修辞模式（rhetorical pattern）',
    '- “不是X而是Y”/“not X but Y”对仗句式尽量删除，换数字、动作、场景',
    '- “rather than”按密度控制：全文 ≥4 次且 ≥1.0/千词时逐句复核；概念澄清可保留',
    '- 绝对化定义（唯…才…/其核心在于/其本质在于）改为有条件的命题',
    '- 三连排比（X, Y, and Z）全文 ≥4 处且 ≥0.8/千词时精简',
    '',
    '## 四、LLM 关联词（llm-associated，概率信号非证据）',
    '- delve/tapestry/testament/leverage/harness/underscore/pivotal/meticulous 等：全文 ≥2 次且 ≥0.4/千词才提示，单次出现不处理',
    '- 过渡词（moreover/furthermore/in conclusion/ultimately）≥8 次且 ≥1.5/千词时删除大部分',
    '- 中文套话（值得注意的是/综上所述/随着…的发展）≥8 次且 ≥2.0/千字符时精简',
    '',
    '## 五、学术文体与格式（academic style / formatting）',
    '- 抽象副词（remarkably/interestingly/importantly）换成具体数值',
    '- "significantly" 只提示复核：统计显著性（p<0.05 等）是正当用法，仅无统计证据的修辞性用法需改',
    '- "we believe/think" 改为 "the results show"；模糊词（somewhat/quite/fairly）少堆叠',
    '- 破折号按密度：全文 ≥5 次且 ≥0.5/千词时删除大部分（范围连字符 30–75 °C 不算）',
    '- 冒号标题必须前后并列或递进',
    '',
    '## 六、v0.6 学术质量守卫（Scholarship Lock / 防御饱和 / 句式）',
    '- Scholarship Lock：润色/改写/去 AI 味时严禁改动数字、百分数、p 值、置信区间、单位、\\cite/\\ref、Figure/Table 编号、DOI；改前先调用 writing_audit(original=原文) 对比',
    '- 防御饱和：may/might/could/possibly/potentially 密度 ≥5 次且 ≥300/千句时清理；一条 claim 套多层保险（may potentially suggest）必须拆到只剩一层；有证据依据的 hedging 保留（ICMJE）',
    '- 超长句堆叠：英文 >35 词且 ≥3 从句标记、中文 >80 字且 ≥5 逗号且 ≥3 连接词——拆句',
    '- 重复绕圈：同段句子高词汇重合且无新增证据时删掉重复圈',
    '- 强主张（prove/establish/confirm/guarantee）附近必须有证据锚点（数字/统计量/图表引用），否则弱化',
    '- 作者风格：用 writing_style_profile 学习作者历史论文，新稿件句长分布偏离时向作者靠拢',
    '- LaTeX 中 Unicode 下标/希腊字母（₁ α）改用数学模式',
    '',
    '## 七、v0.7 局限性与学术自信（ko5.6sol 借鉴）',
    '- 自黑免责零容忍：不得出现"完全基于假数据/模型毫无意义/结果完全不可靠/不足为凭"等自我打压套话（AI 安全护栏误触发的过度防御）',
    '- 局限性改写公式：客观边界 + 未来方向——"本研究采用模拟数据开展敏感性分析" → "下一步可在真实岩心实验中验证"；先区分模拟评估与真实观测，再决定措辞',
    '- 主张动词校准表：modelled/simulated ≠ observed/measured；suggested/indicated < demonstrated/established；we suggest ≠ we show——按证据强度选词，不夸大也不自贬',
    '- 纪律边界（ESR）：不得为了"学术自信"删除真实的证据缺口、失效模式、条件限制——局限是证据透明度的一部分，只改措辞不改事实',
    '- 平均句长参考：英文均值 ≤18 词、中文均值 ≤25 字（ko5.6sol 目标 12–18 词 / 15–25 字）；综述等文体可整体偏长，人工判断',
    '- 中文"的"字链：连续 ≥3 个"的"的修饰嵌套（"基于X的Y的Z的机制"）拆成短句，主谓宾主干显性化',
    '- 空洞热词：英文 robust/crucial/exhibits/tailored/interplay/imperative ≥5 次且 ≥1.0/千词、中文 机制/支撑/动态/耦合/范式 ≥10 次且 ≥3.0/千字时——用具体证据替换（术语用法保留）',
    '',
    '## 八、发布会原则（扬长避短）',
    '- 只围绕优势组织论文；不写工作汇报、不主动示弱、不替审稿人攻击自己',
    '- 打不过的维度不设为比赛项目；不占优的结果从目标/约束/场景解释',
    '- 优势必须明确说出来；结论只强化记忆点',
    '',
    '## 九、提交前自查',
    '- 用 writing_audit 工具对全文扫描（可指定 profile: manuscript/rebuttal/cover_letter）；高危项必须清零，中危项 ≤3 处，低危项可保留但应说明理由',
    '- 润色/改写后：用 writing_audit(original=改前原文) 确认 Scholarship Lock 无 HIGH（科研事实未被改动）',
  ].join('\n')
}
