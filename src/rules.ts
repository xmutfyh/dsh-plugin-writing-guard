/**
 * Writing-discipline rule engine for dsh-plugin-writing-guard.
 *
 * Rule sources (see 09_wiki/writing/写作纪律_防AI痕迹与防御性写作.md):
 *  - Reviewer-shared AI-writing-tell list (OCR of two JPGs): em-dash density,
 *    "not X but Y" / "它不是X而是Y" contrast formulas, absolutist definitions
 *    ("唯…才…", "其核心/本质/关键就在于…"), colon abuse, abstract filler.
 *  - 扬长避短提示词: no self-deprecation, no reviewer bait, no defensive
 *    "we do not claim…", no losing comparisons.
 *  - ESR guide: no revision-process residue ("revised", "本轮", "投稿前"…),
 *    boundaries stated once, evidence roles instead of disclaimers.
 *
 * All rules are local regex/statistics — zero network, zero LLM calls.
 */

export type Category =
  | 'revision_residue'   // 修改过程语句残留
  | 'defensive'          // 防御性写作
  | 'ai_pattern'         // AI 痕迹句式
  | 'style'              // 一般文体问题（低严重度）

export type Severity = 'high' | 'medium' | 'low'

export interface Rule {
  id: string
  category: Category
  severity: Severity
  label: string              // 中文名称
  pattern: RegExp            // 命中模式
  message: string            // 提示语
  suggestion: string         // 修改建议
  /** 每条规则最多报告的命中数（防止刷屏），默认 3 */
  maxHits?: number
  /** 按全文统计的规则：全文级命中计数，超过阈值才报警（此类规则不参与段落级扫描） */
  countThreshold?: number
}

export interface Hit {
  ruleId: string
  category: Category
  severity: Severity
  label: string
  paragraphIndex: number
  snippet: string            // 命中上下文
  message: string
  suggestion: string
}

export interface Stats {
  emDashCount: number        // 破折号 —— / —
  colonTitleCount: number    // 冒号标题（短行内含冒号）
  notXbutYCount: number      // “不是X而是Y” / “not X but Y”
  ratherThanCount: number    // rather than 计数
  absolutistCount: number    // 绝对化定义
  ruleOfThreeCount: number   // 三连排比
  transitionCount: number    // LLM 高频过渡词
  cnConnectivesCount: number // 中文 AI 套话
  paragraphs: number
  chars: number
}

export interface AuditReport {
  ok: boolean
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

// ---------------------------------------------------------------------------
// 规则定义
// ---------------------------------------------------------------------------

const RULES: Rule[] = [
  // ================= 修改过程语句残留 =================
  {
    id: 'revised-family',
    category: 'revision_residue',
    severity: 'high',
    label: '正文出现 "revised/revision" 修改过程残留',
    pattern: /\brevis(ed|ion|ions)?\b/gi,
    message: '正文中出现了 "revised/revision" 等修改过程语言，这是写给审稿人的元话语，正式论文读者只应看到最终版本。',
    suggestion: '改为中性论文语言：the proposed model / the model / the present analysis / the ΔP prediction task，把“修改”动作从正文清除。',
    maxHits: 5,
  },
  {
    id: 'as-requested',
    category: 'revision_residue',
    severity: 'high',
    label: '审稿回应用语残留',
    pattern: /\b(as requested|as suggested( by|,)|in response to (the )?(reviewer|comment|suggestion|concern)|to address (the |this |these |reviewer )?(concern|comment|issue|question|suggestion))\b/gi,
    message: '检测到“as requested / in response to / to address the comment”等审稿回应用语，属于修改说明语言混入正文。',
    suggestion: '直接陈述做法或结果本身，不引用审稿过程。',
    maxHits: 3,
  },
  {
    id: 'we-have-changed',
    category: 'revision_residue',
    severity: 'high',
    label: '"we have updated/modified" 修改叙述',
    pattern: /\bwe (have |now |also )?(updated|modified|corrected|clarified|expanded|rewritten|replaced|revised)\b/gi,
    message: '检测到“we have updated / modified / corrected…”式修改叙述，这是给审稿人的变更说明，不是论文陈述。',
    suggestion: '把句子改写为对最终版本的直接陈述，例如直接描述模型/方法/结果，删除变更动词。',
    maxHits: 3,
  },
  {
    id: 'previous-version',
    category: 'revision_residue',
    severity: 'medium',
    label: '提及旧版本/原稿',
    pattern: /\b(the |our |in the )(previous|original|earlier|first|old) (version|manuscript|draft|submission|model|analysis)\b/gi,
    message: '提到“previous version / original manuscript”等新旧对比，属于修改过程叙述。',
    suggestion: '除非讨论文献中的先前研究，否则删除新旧对比，只写当前结果。',
    maxHits: 3,
  },
  {
    id: 'cn-revision-process',
    category: 'revision_residue',
    severity: 'high',
    label: '中文修改过程残留',
    pattern: /(本轮|本次修改|修改稿中|投稿前|待补齐|需作者|请作者|审稿人要求|根据审稿|修订稿|返修稿|初稿中|上一版|原稿中|我们修改了|我们补充了|我们更新了|我们重新排版|已按要求)/g,
    message: '检测到“本轮/投稿前/审稿人要求/我们修改了…”等中文修改过程语言。',
    suggestion: '删除或改写为对最终版本的直接科学陈述；确实无法恢复的信息只在方法局限中客观说明一次。',
    maxHits: 4,
  },
  {
    id: 'process-nouns',
    category: 'revision_residue',
    severity: 'medium',
    label: '内部流程名词残留',
    pattern: /\b(source_map|priority|SHA-?256|reader 锚点|full_corpus|V\d{2}|blueprint|iteration_log|final_audit)\b/g,
    message: '检测到内部流程/文件名/版本号等管理信息残留。',
    suggestion: '删除或移入内部档案，不进入投稿文件。',
    maxHits: 3,
  },

  // ================= 防御性写作 =================
  {
    id: 'we-do-not-claim',
    category: 'defensive',
    severity: 'high',
    label: '"we do not claim" 防御性声明',
    pattern: /\bwe (do not|don'?t|make no|cannot|can'?t) (claim|intend to|attempt to|argue|prove|demonstrate)\b/gi,
    message: '“we do not claim…”是典型的防御性写作：提前堵审稿人的嘴，让论文显得在自我设限。',
    suggestion: '用证据角色、主张强度和适用边界正面表达；例如把“我们不声称X”改为“本文证据支持X的适用边界为…”。',
    maxHits: 3,
  },
  {
    id: 'cn-defensive-claim',
    category: 'defensive',
    severity: 'high',
    label: '中文防御性声明',
    pattern: /(我们并不声称|我们不声称|我们并非要证明|本文并非要证明|本文不宣称|我们无意|这并不意味着|这并不代表|需要指出的是，本研究存在一定局限性|本研究的局限性在于|必须承认的是|诚然，|无可否认)/g,
    message: '“我们并不声称…/这并不意味着…/本研究存在一定局限性…”属于防御性写作，审稿人会视为自我设限。',
    suggestion: '同一边界只集中写一次；用证据角色表达（“该结果支持…，但未测量…”），不重复自我免责。',
    maxHits: 4,
  },
  {
    id: 'self-deprecation',
    category: 'defensive',
    severity: 'medium',
    label: '自我削弱词',
    pattern: /(遗憾的[是地]|仍明显落后|效果有限|存在严重不足|仅能初步|只能算|不敢说|远远不够|非常有限|尚显不足)/g,
    message: '检测到自我削弱式表达（“遗憾的是/仍明显落后/效果有限/存在严重不足”）。',
    suggestion: '删除或改写为客观结果陈述；不占优的结果要么不设为比赛项目，要么从目标/约束/场景解释，不要主动示弱。',
    maxHits: 3,
  },
  {
    id: 'it-should-be-noted',
    category: 'defensive',
    severity: 'low',
    label: '元评论开场白',
    pattern: /\b(it (should|must) be (noted|mentioned|pointed out|stressed|emphasized)|it is (worth|important|necessary|essential) (noting|to note|to mention)|we (would )?like to (note|point out|emphasize|stress|mention|highlight|thank))\b/gi,
    message: '“it should be noted / it is worth noting / we would like to…”是元评论开场白，冗余且带辩护味。',
    suggestion: '直接陈述内容本身，删掉开场白。',
    maxHits: 3,
  },

  // ================= AI 痕迹句式 =================
  {
    id: 'not-x-but-y-zh',
    category: 'ai_pattern',
    severity: 'medium',
    label: '“不是X而是Y”对仗句式（中文）',
    pattern: /(真正重要的从来不是|并非[^，。；]{2,30}，而是|不是[^，。；]{2,30}，而是)/g,
    message: '“它不是X，而是Y”是审稿人点名的 AI 写作习惯：先否定普通答案再给“深刻”答案，故意假装深刻。',
    suggestion: '删掉一半“不是X而是Y”；把抽象判断换成数字、动作或场景，用具体内容支撑，而不是靠对仗显得有洞察。',
    maxHits: 4,
  },
  {
    id: 'not-x-but-y-en',
    category: 'ai_pattern',
    severity: 'low',
    label: '“not X but Y”对仗句式（英文）',
    pattern: /\bnot (just |only |merely |simply )?[a-z][^.!?]{3,60}? but (?!also )[a-z][^.!?]{2,60}\b/gi,
    message: '“not X but Y”对仗是审稿人点名的 AI 写作痕迹（英文版“它不是X而是Y”）。注意：科学写作中必要的概念澄清（如 “a Darcy-derived descriptor rather than intrinsic permeability”）不算问题；本规则为低危提示，人工复核即可。',
    suggestion: '仅在确实需要对比时才保留一次；修辞性对仗改为正面陈述。',
    maxHits: 3,
  },
  {
    id: 'rather-than-heavy',
    category: 'ai_pattern',
    severity: 'medium',
    label: '“rather than”过度使用',
    pattern: /\brather than\b/gi,
    countThreshold: 4,
    message: '全文“rather than”使用过多（≥4 次），其中往往混有防御性对仗（“…rather than a claim of…”）。',
    suggestion: '逐句复核：概念澄清（如 “a Darcy-derived descriptor rather than intrinsic permeability”）可保留；防御性表述（如 “rather than a claim of uniform dominance”）改为正面陈述。',
  },
  {
    id: 'em-dash-density',
    category: 'ai_pattern',
    severity: 'medium',
    label: '破折号密度过高',
    pattern: /(——|—|–—)/g,
    countThreshold: 6,
    message: '破折号全文出现 ≥6 次。审稿人明确说：“破折号是否全文都是”——铺天盖地的破折号明显不是“人”的话语习惯。',
    suggestion: '删除大部分破折号，改用逗号、分号或拆句；全文保留 1–2 处即可。注意：范围连字符（30–75 °C、fold–seed）不算，只统计长破折号。',
  },
  {
    id: 'absolutist-def',
    category: 'ai_pattern',
    severity: 'medium',
    label: '绝对化定义句式（中文）',
    pattern: /(其核心在于|其本质在于|其基础在于|其关键在于|唯[^，。；]{0,20}才|[^，。；]{0,15}的核心[^，。；]{0,10}是)/g,
    message: '“其核心/本质/基础/关键在于…”“唯…才…”是 AI 习惯的绝对化定义，仔细推敲会发现观点偏激，审稿人会反感。',
    suggestion: '改为有条件的、可检验的命题，说明在什么条件/尺度/边界下成立。',
    maxHits: 3,
  },
  {
    id: 'colon-title',
    category: 'ai_pattern',
    severity: 'low',
    label: '冒号标题滥用',
    pattern: /^[^#\n]{0,60}[:：][^:：\n]{0,60}$/gm,
    countThreshold: 3,
    message: '检测到多个“XXX: XXXXXXX”式标题。审稿人指出：标题冒号前后必须是适合冒号的关系（并列或递进），否则明显是硬凑。',
    suggestion: '检查每个冒号标题：冒号前后是否并列/递进？不是则改题。',
  },
  {
    id: 'abstract-filler',
    category: 'ai_pattern',
    severity: 'low',
    label: '抽象空泛判断',
    pattern: /\b(significantly|remarkably|interestingly|importantly|notably|critically|essentially|fundamentally|in essence|at its core)\b/gi,
    message: '检测到高频抽象副词（significantly/remarkably/interestingly/importantly…）。审稿人提醒：AI 生成的东西很泛化，乍看有道理，仔细推敲是“正确而无用的废话”。',
    suggestion: '把抽象判断换成数字、动作或场景；比如不说“significantly improves”，而说“reduces RMSE from 2.1 to 1.3”。',
    maxHits: 4,
  },
  {
    id: 'llm-verb-noun-overuse',
    category: 'ai_pattern',
    severity: 'medium',
    label: 'LLM 高频动词/名词（delve/tapestry/testament…）',
    pattern: /\b(delve|delve into|tapestry|testament|beacon|cornerstone|embark|meticulous|showcase|boast|seamless|unlock|elevate|foster|harness|navigate|streamline|underscore|pivotal|realm|nuanced|multifaceted|intricate|leverage|utilize|holistic|paradigm|cutting-edge|state-of-the-art)\b/gi,
    message: '检测到 LLM 写作风格高频词（Kobak et al. Science Advances 2024 对 1400 万摘要的统计 + 社区词表）：delve/tapestry/testament/leverage/harness 等词在 ChatGPT 发布后出现率骤升，是审稿人识别 AI 写作的“民间信号”。',
    suggestion: '替换为更具体、更朴素的动词/名词：delve→examine/analyze，tapestry→range/body of work，testament→evidence/reflection，leverage→use/exploit，harness→apply/employ。注意：这些词是概率信号而非证据，出现 1 次不必惊慌，密度高才需处理。',
    maxHits: 4,
  },
  {
    id: 'llm-transition-overuse',
    category: 'ai_pattern',
    severity: 'low',
    label: 'LLM 高频连接/过渡词（moreover/furthermore/in conclusion…）',
    pattern: /\b(moreover|furthermore|additionally|in conclusion|to sum up|in summary|ultimately|that being said|in today's|in the realm of|when it comes to|a wide range of|plays? a crucial role in|it is worth mentioning|navigating the complexities of)\b/gi,
    countThreshold: 8,
    message: '全文 LLM 高频过渡词/套话过多（≥8 次）。moreover/furthermore/in conclusion 等在 LLM 输出中过度使用，机械推进感强。',
    suggestion: '删除大部分过渡词，用内容本身的逻辑推进；段间连接靠论证关系而非连接词堆砌。学术写作中这些词出现 1–2 次正常，密度高才处理。',
  },
  {
    id: 'rule-of-three',
    category: 'ai_pattern',
    severity: 'low',
    label: '三连排比（rule of three）',
    pattern: /\b[a-z]{3,}, [a-z]{3,}, and [a-z]{3,}\b/g,
    countThreshold: 4,
    message: '检测到过多“X, Y, and Z”三连排比（≥4 处）。LLM 偏爱恰好三组的对称结构（“clear, concise, and compelling”），是社区公认的 AI 结构痕迹。',
    suggestion: '保留确实需要列举的三项；纯修辞性三连改为更自然的表述，长短句混用打破节奏。',
  },
  {
    id: 'cn-ai-connectives',
    category: 'ai_pattern',
    severity: 'low',
    label: '中文 AI 高频连接词',
    pattern: /(值得注意的是|值得一提的是|不难发现|不难看出|显而易见|众所周知|综上所述|总的来说|与此同时|基于此|在此基础上|随着[^，。；]{2,20}的发展|在[^，。；]{2,20}的背景下|需要强调的是)/g,
    countThreshold: 8,
    message: '中文 AI 高频套话过多（≥8 次）：“值得注意的是/综上所述/与此同时/随着…的发展”等是 LLM 中文输出的典型连接词。',
    suggestion: '删除大部分套话，让论证内容直接呈现；保留少量用于真实转折即可。',
  },

  // ================= 一般文体（低严重度） =================
  {
    id: 'we-believe',
    category: 'style',
    severity: 'low',
    label: '“we believe/think” 弱表态',
    pattern: /\bwe (believe|think|feel|hope|wish|suspect)\b/gi,
    message: '“we believe/think”是弱表态，削弱结论力度。',
    suggestion: '改为证据导向表述：“the results show / the data indicate / this is consistent with…”。',
    maxHits: 3,
  },
  {
    id: 'vague-quantifiers',
    category: 'style',
    severity: 'low',
    label: '模糊程度词',
    pattern: /\b(somewhat|quite|fairly|a bit|to some extent|to a (certain|large|limited) degree)\b/gi,
    message: '检测到模糊程度词（somewhat/quite/fairly/to some extent），过度限定削弱表述。（注意："rather than" 属正常英文表达，不计入）',
    suggestion: '能给出数值就给出数值；无法量化时保留一个最准确的限定词即可，不要堆叠。',
    maxHits: 3,
  },
]

// 排除“范围连字符”后统计真正的长破折号
function countEmDashes(text: string): number {
  const matches = text.match(/——|—|–—/g)
  return matches ? matches.length : 0
}

function countRatherThan(text: string): number {
  const matches = text.match(/\brather than\b/gi)
  return matches ? matches.length : 0
}

function countColonTitles(text: string): number {
  const lines = text.split(/\r?\n/)
  let n = 0
  for (const line of lines) {
    const s = line.trim()
    if (s.length >= 5 && s.length <= 80 && /[:：]/.test(s) && !s.endsWith('.') && !s.endsWith('。')) {
      // 标题特征：短行、含冒号、不是完整句子结尾
      n += 1
    }
  }
  return n
}

function countNotXbutY(text: string): number {
  const zh = text.match(/(真正重要的从来不是|并非[^，。；]{2,30}，而是|不是[^，。；]{2,30}，而是)/g) || []
  const en = text.match(/\bnot (just |only |merely )?[a-z][^.!?]{3,60}? but (?!also )[a-z][^.!?]{2,60}\b/gi) || []
  return zh.length + en.length
}

function countAbsolutist(text: string): number {
  const matches = text.match(/(其核心在于|其本质在于|其基础在于|其关键在于|唯[^，。；]{0,20}才)/g)
  return matches ? matches.length : 0
}

function countRuleOfThree(text: string): number {
  const matches = text.match(/\b[a-z]{3,}, [a-z]{3,}, and [a-z]{3,}\b/g)
  return matches ? matches.length : 0
}

function countLlTransition(text: string): number {
  const matches = text.match(/\b(moreover|furthermore|additionally|in conclusion|to sum up|in summary|ultimately|that being said)\b/gi)
  return matches ? matches.length : 0
}

function countCnConnectives(text: string): number {
  const matches = text.match(/(值得注意的是|值得一提的是|不难发现|不难看出|显而易见|众所周知|综上所述|总的来说|与此同时|基于此|在此基础上|随着[^，。；]{2,20}的发展|在[^，。；]{2,20}的背景下|需要强调的是)/g)
  return matches ? matches.length : 0
}

export function auditText(text: string, opts?: { maxParagraphs?: number }): AuditReport {
  const maxParagraphs = opts?.maxParagraphs ?? 400
  const paragraphs = text
    .split(/\n{2,}|\r?\n\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .slice(0, maxParagraphs)

  const stats: Stats = {
    emDashCount: countEmDashes(text),
    colonTitleCount: countColonTitles(text),
    notXbutYCount: countNotXbutY(text),
    ratherThanCount: countRatherThan(text),
    absolutistCount: countAbsolutist(text),
    ruleOfThreeCount: countRuleOfThree(text),
    transitionCount: countLlTransition(text),
    cnConnectivesCount: countCnConnectives(text),
    paragraphs: paragraphs.length,
    chars: text.length,
  }

  const hits: Hit[] = []

  for (const rule of RULES) {
    // 全文级阈值规则
    if (rule.countThreshold !== undefined) {
      let count = 0
      if (rule.id === 'em-dash-density') count = stats.emDashCount
      else if (rule.id === 'rather-than-heavy') count = stats.ratherThanCount
      else if (rule.id === 'colon-title') count = stats.colonTitleCount
      else if (rule.id === 'llm-transition-overuse') count = stats.transitionCount
      else if (rule.id === 'rule-of-three') count = stats.ruleOfThreeCount
      else if (rule.id === 'cn-ai-connectives') count = stats.cnConnectivesCount
      if (count >= rule.countThreshold) {
        hits.push({
          ruleId: rule.id,
          category: rule.category,
          severity: rule.severity,
          label: rule.label,
          paragraphIndex: -1,
          snippet: `（全文统计）${rule.label}：${count} 次`,
          message: rule.message,
          suggestion: rule.suggestion,
        })
      }
      continue
    }

    // 段落级规则
    const maxHits = rule.maxHits ?? 3
    let found = 0
    for (let i = 0; i < paragraphs.length && found < maxHits; i++) {
      const para = paragraphs[i]
      const m = rule.pattern.exec(para)
      if (!m) continue
      found += 1
      const start = Math.max(0, (m.index ?? 0) - 60)
      const end = Math.min(para.length, (m.index ?? 0) + (m[0]?.length ?? 0) + 80)
      const snippet = (start > 0 ? '…' : '') + para.slice(start, end) + (end < para.length ? '…' : '')
      hits.push({
        ruleId: rule.id,
        category: rule.category,
        severity: rule.severity,
        label: rule.label,
        paragraphIndex: i,
        snippet,
        message: rule.message,
        suggestion: rule.suggestion,
      })
      rule.pattern.lastIndex = 0
    }
  }

  const byCategory: Record<Category, number> = {
    revision_residue: 0,
    defensive: 0,
    ai_pattern: 0,
    style: 0,
  }
  let high = 0, medium = 0, low = 0
  for (const h of hits) {
    byCategory[h.category] += 1
    if (h.severity === 'high') high += 1
    else if (h.severity === 'medium') medium += 1
    else low += 1
  }

  return {
    ok: hits.length === 0,
    summary: { total: hits.length, high, medium, low, byCategory },
    stats,
    hits,
  }
}

/** 输出给 Agent 的纪律速查文本（写作前加载） */
export function rulesBrief(): string {
  return [
    '# 论文写作纪律速查（dsh-plugin-writing-guard）',
    '',
    '## 一、修改过程语句残留（正文禁用）',
    '- 不得出现 "revised/revision"、"as requested"、"we have added/updated"、"previous version" 等修改过程语言',
    '- 中文不得出现：本轮/本次修改/投稿前/待补齐/审稿人要求/我们修改了 等',
    '- 版本号、文件名、SHA、内部流程名词不得进入正文',
    '',
    '## 二、防御性写作（禁用）',
    '- 不得使用 "we do not claim"、"本文并非要证明"、"这并不意味着"、"本研究存在一定局限性" 等自我设限句式',
    '- 不得自我削弱（遗憾的是/仍明显落后/效果有限/存在严重不足）',
    '- 边界声明集中写，全文最多两处；其余用证据角色表达',
    '',
    '## 三、AI 痕迹句式（审稿人重点识别）',
    '- 破折号全文 ≤2 处（铺天盖地的破折号不是“人”的话语习惯）',
    '- “不是X而是Y”/“not X but Y”对仗句式尽量删除，换数字、动作、场景',
    '- “rather than”全文 ≤3 次；概念澄清可保留，防御性对仗改写',
    '- 绝对化定义（唯…才…/其核心在于/其本质在于）改为有条件的命题',
    '- 冒号标题必须前后并列或递进；抽象副词（significantly/importantly）换成具体数值',
    '- LLM 高频词（delve/tapestry/testament/leverage/harness/underscore/pivotal/meticulous 等）密度高时替换为朴素动词',
    '- LLM 过渡词（moreover/furthermore/in conclusion/ultimately/that being said）全文 ≤7 次',
    '- 三连排比（X, Y, and Z）全文 ≤3 处；中文套话（值得注意的是/综上所述/随着…的发展）≤7 次',
    '',
    '## 四、发布会原则（扬长避短）',
    '- 只围绕优势组织论文；不写工作汇报、不主动示弱、不替审稿人攻击自己',
    '- 打不过的维度不设为比赛项目；不占优的结果从目标/约束/场景解释',
    '- 优势必须明确说出来；结论只强化记忆点',
    '',
    '## 五、提交前自查',
    '- 用 writing_audit 工具对全文扫描；高危项必须清零，中危项 ≤3 处，低危项可保留但应说明理由',
  ].join('\n')
}

export function formatReport(report: AuditReport, opts?: { verbose?: boolean }): string {
  const { summary, stats, hits } = report
  const lines: string[] = []
  lines.push(`写作纪律检查报告：${hits.length === 0 ? '✅ 通过' : `发现 ${summary.total} 处问题（高 ${summary.high} / 中 ${summary.medium} / 低 ${summary.low}）`}`)
  lines.push(`- 统计：${stats.paragraphs} 段 / ${stats.chars} 字符；破折号 ${stats.emDashCount}；rather than ${stats.ratherThanCount}；不是X而是Y ${stats.notXbutYCount}；绝对化定义 ${stats.absolutistCount}；三连排比 ${stats.ruleOfThreeCount}；LLM过渡词 ${stats.transitionCount}；中文套话 ${stats.cnConnectivesCount}；冒号标题 ${stats.colonTitleCount}`)
  if (hits.length === 0) return lines.join('\n')

  lines.push(`- 分类：修改残留 ${summary.byCategory.revision_residue} / 防御性 ${summary.byCategory.defensive} / AI痕迹 ${summary.byCategory.ai_pattern} / 文体 ${summary.byCategory.style}`)
  lines.push('')
  const order: Record<Severity, number> = { high: 0, medium: 1, low: 2 }
  const sorted = [...hits].sort((a, b) => order[a.severity] - order[b.severity] || a.paragraphIndex - b.paragraphIndex)
  for (const h of sorted) {
    const sev = h.severity === 'high' ? '🔴' : h.severity === 'medium' ? '🟠' : '🟡'
    const loc = h.paragraphIndex >= 0 ? `[para ${h.paragraphIndex}]` : '[全文]'
    lines.push(`${sev} [${h.severity.toUpperCase()}] ${h.label} ${loc}`)
    lines.push(`    原文：${h.snippet.trim().slice(0, 200)}`)
    if (opts?.verbose) {
      lines.push(`    提示：${h.message}`)
      lines.push(`    建议：${h.suggestion}`)
    }
    lines.push('')
  }
  if (!opts?.verbose) {
    lines.push('（提示：加 verbose=true 可查看每条的建议）')
  }
  return lines.join('\n')
}
