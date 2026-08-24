/**
 * Writing Guard — Delivery Integrity Layer (DELIVERY)
 *
 * Fourth detection layer alongside STYLE / EVIDENCE / JOURNAL.
 * Detects Context-to-Artifact Leakage (CAL): rejected alternatives,
 * revision process residue, and provenance leakage in final deliverables.
 *
 * Core principles:
 *  - Pure engine, zero network, zero LLM, deterministic, pure functions
 *  - Surface-aware: what is legitimate in a rebuttal may be leakage in a commit
 *  - Must NOT break: scientific null findings, safety statements, legal/compliance,
 *    real API deletions, real migrations, reviewer responses
 *
 * Priority: Scientific / Safety / Baseline Truth > Delivery Cleanliness > Style
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type DeliverySurface =
  | 'title'
  | 'heading'
  | 'filename'
  | 'comment'
  | 'test_name'
  | 'commit'
  | 'pr'
  | 'release'
  | 'handoff'
  | 'unknown'

export type DeliveryFindingKind =
  | 'REJECTED_ALTERNATIVE_LEAKAGE'
  | 'REVISION_PROCESS_LEAKAGE'
  | 'PROVENANCE_LEAKAGE'
  | 'UNJUSTIFIED_NEGATIVE_REFERENCE'
  | 'DELIVERY_CANDIDATE'

export interface DeliveryFinding {
  kind: DeliveryFindingKind
  severity: 'high' | 'medium' | 'low'
  confidence: 'high' | 'medium' | 'low'
  evidence: string[]
  reason: string
  suggestion: string
  surface: DeliverySurface
  matchedTerm?: string
  snippet?: string
}

export interface DeliveryAuditOptions {
  text: string
  surface?: DeliverySurface
  /** Authoritative baseline content (e.g. previous commit, current repo state) */
  baseline?: string
  /** Observed final state (e.g. code after edit) */
  finalState?: string
  /** Terms from rejected context (e.g. "Toast", "方案A") */
  rejectedTerms?: string[]
  /** Claims from rejected context (e.g. "We should use Redux") */
  rejectedClaims?: string[]
}

export interface DeliveryAuditReport {
  findings: DeliveryFinding[]
  summary: {
    total: number
    high: number
    medium: number
    low: number
    byKind: Record<DeliveryFindingKind, number>
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Unicode NFKC + case fold + strip all punctuation / whitespace / separators.
 * Covers ASCII, fullwidth (FF00-FF0F range), CJK punctuation, and general Punctuation blocks.
 */
export function normalizeTerm(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    // eslint-disable-next-line no-misleading-character-class
    .replace(/[\s\p{P}\p{S}\p{Z}]/gu, '')
}

/** Extract a short snippet around a match index */
function snippetAround(text: string, idx: number, radius = 40): string {
  const start = Math.max(0, idx - radius)
  const end = Math.min(text.length, idx + radius)
  let s = text.slice(start, end)
  if (start > 0) s = '…' + s
  if (end < text.length) s = s + '…'
  return s.trim()
}

// ─── Protection predicates ──────────────────────────────────────────────────

/**
 * Patterns that indicate legitimate negation / null findings / safety / science.
 * When a negative-reference match falls inside one of these, we suppress
 * UNJUSTIFIED_NEGATIVE_REFERENCE and DELIVERY_CANDIDATE to protect scientific
 * and safety language.
 */
const PROTECTED_NEGATION_EN = [
  /\bno\s+(?:significant|statistically\s+significant)\s+(?:difference|effect|change|association|correlation|relationship)\b/i,
  /\b(?:does\s+not|did\s+not)\s+(?:differ|change|increase|decrease|improve|affect|correlate)\b/i,
  /\bnot\s+(?:significant|detectable|observable|measurable|statistically)\b/i,
  /\bfailed\s+to\s+(?:detect|observe|find|identify|show|demonstrate)\b/i,
  /\bcontains?\s+no\s+\w+/i,
  /\bfree\s+of\b/i,
  /\bwithout\s+(?:causing|leading\s+to|resulting\s+in|any\s+(?:significant|detectable))\b/i,
  /\bno\s+adverse\b/i,
  /\bno\s+(?:known|reported|documented)\s+(?:adverse|serious|major)\b/i,
  /\bdoes\s+not\s+contain\b/i,
  /\bnon[_-]?inferior(?:ity)?\b/i,
]

const PROTECTED_NEGATION_ZH = [
  /无显著[差异变化影响]/,
  /未[观发检]现/,
  /不[存具]备/,
  /不含/,
  /不含[有任]/,
  /无不良/,
  /无[任何已知]/,
  /无证据[表显]明/,
]

/** Scientific null finding / safety statement → suppress */
function isProtectedNegation(text: string): boolean {
  return (
    PROTECTED_NEGATION_EN.some((r) => r.test(text)) ||
    PROTECTED_NEGATION_ZH.some((r) => r.test(text))
  )
}

/**
 * Patterns indicating real deletion / migration that requires baseline truth.
 * These are used when checking "Remove X" style statements.
 */
const REAL_ACTION_EN = [
  /\b(?:remove[d]?|delet(?:ed|e|ing)|drop(?:ped|ping)?|replac(?:ed|ing)|migrat(?:ed|ing)|updat(?:ed|ing)|switch(?:ed|ing)?)\s+(?:the\s+|our\s+|a\s+)?/i,
  /\bwithout\s+(?:the\s+|our\s+|a\s+)?/i,
  /\bno\s+long(?:er|er)\s+(?:uses?|supports?|includes?|requires?|contains?|relies?)\b/i,
]

const REAL_ACTION_ZH = [
  /删除/,
  /移除/,
  /替[换代]/,
  /迁移/,
  /不再使用/,
  /不再采用/,
  /不再支持/,
  /升级到/,
  /改为/,
]

// ─── Process Residue Detection (surface-aware) ──────────────────────────────

const PROCESS_RESIDUE_EN: RegExp[] = [
  /\bas\s+requested\b/i,
  /\bwe\s+removed\b/i,
  /\bwe\s+deleted\b/i,
  /\bwe\s+replaced\b/i,
  /\bwe\s+changed\b/i,
  /\bwe\s+updated\b/i,
  /\bwe\s+switched\b/i,
  /\bno\s+long(?:er)\b/i,
  /\brevised\s+version\b/i,
  /\bfinal\s+version\b/i,
  /\bupdated\s+version\b/i,
  /\bin\s+the\s+(?:updated|revised|new|final)\s+version\b/i,
  /\bafter\s+(?:the\s+|this\s+)?(?:change|revision|update|fix|correction|discussion)\b/i,
  /\bper\s+(?:the\s+)?(?:reviewer|feedback|request|suggestion|comment)\b/i,
  /\bper\s+review(?:er)?\s+(?:feedback|request|suggestion|comment)s?\b/i,
  /\bbased\s+on\s+(?:the\s+)?(?:feedback|discussion|review|suggestion)s?\b/i,
  /\bwe\s+(?:now|previously)\b/i,
  /\bpreviously\s+(?:used|had|included|relied)\b/i,
  /\bformerly\s+known\s+as\b/i,
  /\bthis\s+(?:was|has\s+been)\s+(?:replaced|removed|updated|changed|fixed)\b/i,
  /\bchanged\s+from\s+\w+\s+to\b/i,
  /\bmoved\s+from\s+\S+\s+to\b/i,
  /\bmigrated\s+from\b/i,
]

/** Filename/test_name specific patterns: standalone "revised"/"updated"/"final" is residue */
const PROCESS_RESIDUE_FILENAME_EN: RegExp[] = [
  /\brevised\b/i,
  /\bupdated\b/i,
  /\bfinal\b/i,
  /\bnew\b/i,
  /\bold\b/i,
  /\bbackup\b/i,
  /\bcopy\b/i,
]

const PROCESS_RESIDUE_ZH: RegExp[] = [
  /根据要求/,
  /已经删除/,
  /已删除/,
  /不再采用/,
  /修订后/,
  /修改后/,
  /按要求/,
  /经讨论后/,
  /经过讨论/,
  /更新后/,
  /调整后/,
  /优化后/,
  /我们已/,
  /此前使用/,
  /原(?:来|先)使用/,
  /之前使用/,
  /由.*改为/,
  /从.*迁移到/,
  /之前采用/,
]

/**
 * Surfaces where process residue is almost always illegitimate.
 * In these, exposing internal chat revision process is CAL.
 */
const STRICT_SURFACES: Set<DeliverySurface> = new Set([
  'title',
  'filename',
  'heading',
  'test_name',
  'commit',
  'pr',
  'release',
])

/**
 * Surfaces where process residue MAY be legitimate:
 * - comment: could be a code comment explaining a design decision ("replaced X with Y per discussion")
 * - handoff: handoff docs often include rationale
 * - rebuttal: reviewer response legitimately references revision process
 * - unknown: cautious, report as low
 */
function processResidueSeverity(
  surface: DeliverySurface,
): 'high' | 'medium' | 'low' {
  if (surface === 'title' || surface === 'filename') return 'high'
  if (surface === 'heading' || surface === 'test_name') return 'high'
  if (surface === 'commit' || surface === 'pr' || surface === 'release') return 'medium'
  if (surface === 'comment' || surface === 'handoff') return 'low'
  return 'low' // unknown
}

// ─── Rejected Alternative Detection ─────────────────────────────────────────

function checkRejectedAlternative(
  text: string,
  rejectedTerms: string[],
  surface: DeliverySurface,
): DeliveryFinding[] {
  const findings: DeliveryFinding[] = []
  const normalizedText = normalizeTerm(text)

  // If the text is a protected negation (scientific null, safety statement),
  // suppressed rejected alternative leakage — the term appears in a legitimate
  // scientific/safety context, not as CAL.
  if (isProtectedNegation(text)) return findings

  for (const term of rejectedTerms) {
    const normalized = normalizeTerm(term)
    if (!normalized) continue

    const idx = normalizedText.indexOf(normalized)
    if (idx === -1) continue

    // Exact normalized hit → high confidence
    findings.push({
      kind: 'REJECTED_ALTERNATIVE_LEAKAGE',
      severity: surface === 'title' || surface === 'filename' ? 'high' : 'medium',
      confidence: 'high',
      evidence: [
        `Text contains rejected term "${term}" (normalized: "${normalized}")`,
        `Surface: ${surface}`,
      ],
      reason:
        `The term "${term}" was explicitly rejected in the working context but appears in the final ${surface}. ` +
        `This is Context-to-Artifact Leakage (CAL): the rejected alternative should not appear in deliverables.`,
      suggestion:
        `Remove or rephrase to avoid referencing the rejected alternative "${term}". ` +
        `If the term is necessary for context, ensure the phrasing makes clear it was rejected.`,
      surface,
      matchedTerm: term,
      snippet: snippetAround(text, idx),
    })
  }

  return findings
}

// ─── Baseline Reality Check ─────────────────────────────────────────────────

/**
 * Extract "action + subject" patterns from text and check against baseline.
 * If baseline doesn't contain the subject, it's likely CAL.
 */
const ACTION_SUBJECT_PATTERNS_EN: Array<{ action: RegExp; subjectGroup: number }> = [
  // "Remove the deprecated API" → subject = "the deprecated API"
  { action: /\b(?:remove[d]?|delet(?:ed|e|ing)|drop(?:ped|ping)?)\s+(.{3,60}?)(?:\.|,|;|\s+(?:from|in|to|for|that|and|which|by)\b|$)/i, subjectGroup: 1 },
  // "Replace X with Y" → subject = "X"
  { action: /\b(?:replac(?:ed|ing))\s+(.{3,60}?)\s+with\b/i, subjectGroup: 1 },
  // "Without the old feature" → subject = "the old feature"
  { action: /\bwithout\s+(the\s+|our\s+|a\s+)?(.{3,60}?)(?:\.|,|;|\s+(?:from|in|to|for|that|and|which|by)\b|$)/i, subjectGroup: 2 },
  // "No longer uses/contains X" → subject = "X"
  { action: /\bno\s+longer\s+(?:uses?|supports?|includes?|requires?|contains?|relies?)\s+(.{3,60}?)(?:\.|,|;|$)/i, subjectGroup: 1 },
]

const ACTION_SUBJECT_PATTERNS_ZH: Array<{ action: RegExp; subjectGroup: number }> = [
  // "删除 X" → subject = "X"
  { action: /删除了?\s*(.{2,30}?)(?:[。,;]|$)/, subjectGroup: 1 },
  // "移除 X" → subject = "X"
  { action: /移除了?\s*(.{2,30}?)(?:[。,;]|$)/, subjectGroup: 1 },
  // "替换 X 为 Y" → subject = "X"
  { action: /替[换代]了?\s*(.{2,30}?)\s*(?:为|成)/, subjectGroup: 1 },
  // "不再使用 X" → subject = "X"
  { action: /不再(?:使用|采用|支持)\s*(.{2,30}?)(?:[。,;]|$)/, subjectGroup: 1 },
  // "改为 X" — no subject to check (replacing something unspecified)
]

/**
 * Strip leading articles, determiners, and common adjectives from a subject
 * to get the core noun for baseline matching.
 */
function coreSubject(raw: string): string {
  return raw
    .replace(/^(?:the|our|a|an|this|that|these|those|its|my|your|our)\s+/i, '')
    .replace(/^(?:deprecated|legacy|old|new|original|existing|current|prior)\s+/i, '')
    .trim()
}

/**
 * Check if a substring exists in the baseline text (normalized match).
 * Tries both the full subject and the core subject (without leading articles/adjectives).
 */
function existsInBaseline(subject: string, baseline?: string): boolean {
  if (!baseline) return false
  const full = normalizeTerm(subject)
  if (full.length < 2) return false // too short to match reliably
  const normBaseline = normalizeTerm(baseline)
  if (normBaseline.includes(full)) return true

  // Try core subject (strip leading articles/adjectives)
  const core = normalizeTerm(coreSubject(subject))
  if (core.length >= 2 && normBaseline.includes(core)) return true

  return false
}

/**
 * Check if text contains any "action + subject" patterns where the subject
 * does NOT exist in baseline. This indicates CAL.
 */
function checkBaselineReality(
  text: string,
  baseline: string | undefined,
  finalState: string | undefined,
  surface: DeliverySurface,
): DeliveryFinding[] {
  if (!baseline) return [] // no baseline → can't check → no findings

  const findings: DeliveryFinding[] = []
  const patterns = [...ACTION_SUBJECT_PATTERNS_EN, ...ACTION_SUBJECT_PATTERNS_ZH]

  for (const { action, subjectGroup } of patterns) {
    const m = action.exec(text)
    if (!m) continue

    const subject = m[subjectGroup]?.trim()
    if (!subject || subject.length < 2) continue

    const inBaseline = existsInBaseline(subject, baseline)
    const inFinal = existsInBaseline(subject, finalState)

    // baseline has subject, final doesn't → possibly real deletion → don't flag
    if (inBaseline && !inFinal) continue

    // baseline doesn't have subject, and it's only in rejected context → CAL
    if (!inBaseline) {
      findings.push({
        kind: 'UNJUSTIFIED_NEGATIVE_REFERENCE',
        severity: surface === 'title' || surface === 'commit' ? 'medium' : 'low',
        confidence: 'medium',
        evidence: [
          `Action pattern "${m[0].trim()}" references "${subject}"`,
          `Subject "${subject}" not found in baseline content`,
        ],
        reason:
          `The text describes removing/replacing "${subject}", but this term does not exist in the baseline. ` +
          `If it only exists in the rejected working context, this is Context-to-Artifact Leakage.`,
        suggestion:
          `Verify whether "${subject}" was ever actually present in the deliverable. ` +
          `If not, rewrite to describe what was ADDED rather than what was REMOVED.`,
        surface,
        matchedTerm: subject,
        snippet: snippetAround(text, m.index ?? 0),
      })
    }
  }

  return findings
}

// ─── Provenance Leakage Detection ───────────────────────────────────────────

/**
 * Patterns indicating provenance leakage: text that exposes the process
 * of how something was decided or created, rather than what was done.
 */
const PROVENANCE_PATTERNS_EN: RegExp[] = [
  /\bbased\s+on\s+our\s+discussion\b/i,
  /\bas\s+we\s+discussed\b/i,
  /\bfollowing\s+(?:the\s+)?(?:our\s+)?conversation\b/i,
  /\bper\s+(?:your|the)\s+(?:earlier\s+)?(?:instruction|request|suggestion|feedback)\b/i,
  /\bchat(?:ting)?\s+(?:history|context|log)\b/i,
  /\bin\s+(?:the\s+)?(?:our\s+)?(?:chat|conversation|discussion|thread)\b/i,
  /\byou\s+(?:originally|initially|previously)\s+(?:asked|requested|wanted|suggested)\b/i,
  /\bwe\s+(?:originally|initially|previously)\s+(?:discussed|considered|tried|decided)\b/i,
  /\bafter\s+(?:chatting|discussing|trying)\b/i,
  /\bthis\s+(?:came\s+from|originated\s+from|was\s+from)\s+(?:the\s+)?(?:chat|discussion|conversation)\b/i,
]

const PROVENANCE_PATTERNS_ZH: RegExp[] = [
  /根据讨论/,
  /根据聊天记录/,
  /我们讨论过/,
  /你之前说/,
  /你说的/,
  /之前讨论的/,
  /根据对话/,
  /聊天中提到/,
  /我们原[来先].*讨论/,
]

/**
 * Surfaces where provenance leakage is more severe.
 */
function provenanceSeverity(surface: DeliverySurface): 'high' | 'medium' | 'low' {
  if (surface === 'title' || surface === 'filename' || surface === 'heading') return 'high'
  if (surface === 'commit' || surface === 'test_name') return 'medium'
  if (surface === 'comment' || surface === 'handoff') return 'low'
  return 'low'
}

function checkProvenanceLeakage(
  text: string,
  surface: DeliverySurface,
): DeliveryFinding[] {
  const findings: DeliveryFinding[] = []
  const patterns = [...PROVENANCE_PATTERNS_EN, ...PROVENANCE_PATTERNS_ZH]

  for (const pattern of patterns) {
    const m = pattern.exec(text)
    if (!m) continue

    findings.push({
      kind: 'PROVENANCE_LEAKAGE',
      severity: provenanceSeverity(surface),
      confidence: 'medium',
      evidence: [
        `Pattern "${m[0]}" exposes provenance / working context`,
        `Surface: ${surface}`,
      ],
      reason:
        `The text exposes the collaborative process ("${m[0]}") rather than the outcome. ` +
        `In a ${surface}, this leaks internal context into the deliverable.`,
      suggestion:
        `Rewrite to describe the decision or outcome without referencing the discussion process. ` +
        `E.g. "Added X" instead of "Based on our discussion, added X".`,
      surface,
      snippet: snippetAround(text, m.index ?? 0),
    })
  }

  return findings
}

// ─── Main Audit Function ────────────────────────────────────────────────────

/**
 * Audit a deliverable text for Context-to-Artifact Leakage (CAL).
 *
 * @param opts - Audit options including text, surface, baseline, and rejected context
 * @returns Audit report with findings and summary
 */
export function auditDelivery(opts: DeliveryAuditOptions): DeliveryAuditReport {
  const {
    text,
    surface = 'unknown',
    baseline,
    finalState,
    rejectedTerms = [],
    rejectedClaims = [],
  } = opts

  if (!text || !text.trim()) {
    return emptyReport()
  }

  const allFindings: DeliveryFinding[] = []

  // 1. Rejected alternative leakage (exact normalized match)
  const allRejected = [...rejectedTerms, ...rejectedClaims]
  if (allRejected.length > 0) {
    allFindings.push(...checkRejectedAlternative(text, allRejected, surface))
  }

  // 2. Process residue detection (surface-aware)
  allFindings.push(...checkProcessResidue(text, surface))

  // 3. Baseline reality check (CAL core)
  allFindings.push(...checkBaselineReality(text, baseline, finalState, surface))

  // 4. Provenance leakage
  allFindings.push(...checkProvenanceLeakage(text, surface))

  // Build summary
  const summary: DeliveryAuditReport['summary'] = {
    total: allFindings.length,
    high: 0,
    medium: 0,
    low: 0,
    byKind: {
      REJECTED_ALTERNATIVE_LEAKAGE: 0,
      REVISION_PROCESS_LEAKAGE: 0,
      PROVENANCE_LEAKAGE: 0,
      UNJUSTIFIED_NEGATIVE_REFERENCE: 0,
      DELIVERY_CANDIDATE: 0,
    },
  }

  for (const f of allFindings) {
    summary[f.severity]++
    summary.byKind[f.kind]++
  }

  return { findings: allFindings, summary }
}

// ─── Process Residue (internal, surface-aware) ──────────────────────────────

function checkProcessResidue(
  text: string,
  surface: DeliverySurface,
): DeliveryFinding[] {
  const findings: DeliveryFinding[] = []
  const patterns = [...PROCESS_RESIDUE_EN, ...PROCESS_RESIDUE_ZH]

  // In rebuttal, process residue is generally legitimate
  // Note: "rebuttal" is not a DeliverySurface per the spec.
  // Users writing rebuttals should use surface='unknown' or 'handoff'.
  // Process residue in handoff is already low severity.

  // For filename/test_name, use stricter patterns (standalone "revised" etc. is residue)
  if (surface === 'filename' || surface === 'test_name') {
    patterns.push(...PROCESS_RESIDUE_FILENAME_EN)
  }

  for (const pattern of patterns) {
    const m = pattern.exec(text)
    if (!m) continue

    const matched = m[0]
    const sev = processResidueSeverity(surface)

    // Check if this is protected (scientific / safety context)
    // Extract surrounding context for protection check
    const start = Math.max(0, (m.index ?? 0) - 30)
    const end = Math.min(text.length, (m.index ?? 0) + matched.length + 30)
    const context = text.slice(start, end)

    if (isProtectedNegation(context)) continue

    findings.push({
      kind: 'REVISION_PROCESS_LEAKAGE',
      severity: sev,
      confidence: surface === 'title' || surface === 'filename' ? 'high' : 'medium',
      evidence: [
        `Process residue pattern "${matched}" found in ${surface}`,
      ],
      reason:
        `The phrase "${matched}" exposes the revision/editing process. ` +
        (STRICT_SURFACES.has(surface)
          ? `In a ${surface}, internal process references should not appear in final deliverables.`
          : `Consider whether this reference to the editing process is appropriate here.`),
      suggestion:
        surface === 'commit'
          ? `Rewrite commit message to describe what was DONE, not what was CHANGED FROM. E.g. "Add inline validation" instead of "Replace Toast with inline validation".`
          : surface === 'title'
            ? `Rewrite title to describe the outcome, not the process. E.g. "Inline Validation" instead of "Revised Version".`
            : `Consider rephrasing to describe the outcome rather than the process.`,
      surface,
      matchedTerm: matched,
      snippet: snippetAround(text, m.index ?? 0),
    })
  }

  return findings
}

// ─── Report Formatting ──────────────────────────────────────────────────────

const KIND_LABELS: Record<DeliveryFindingKind, string> = {
  REJECTED_ALTERNATIVE_LEAKAGE: 'Rejected Alternative Leakage',
  REVISION_PROCESS_LEAKAGE: 'Revision Process Leakage',
  PROVENANCE_LEAKAGE: 'Provenance Leakage',
  UNJUSTIFIED_NEGATIVE_REFERENCE: 'Unjustified Negative Reference',
  DELIVERY_CANDIDATE: 'Delivery Candidate',
}

const SURFACE_LABELS: Record<DeliverySurface, string> = {
  title: 'Title',
  heading: 'Heading',
  filename: 'Filename',
  comment: 'Code Comment',
  test_name: 'Test Name',
  commit: 'Commit Message',
  pr: 'Pull Request',
  release: 'Release Notes',
  handoff: 'Handoff Document',
  unknown: 'Unknown Surface',
}

/**
 * Format a DeliveryAuditReport as a human-readable string.
 */
export function formatDeliveryReport(
  report: DeliveryAuditReport,
  opts?: { verbose?: boolean },
): string {
  const lines: string[] = []

  lines.push(`【Delivery Integrity Audit】${report.summary.total} finding(s)`)
  lines.push(
    `  🔴 High: ${report.summary.high}  🟠 Medium: ${report.summary.medium}  🟡 Low: ${report.summary.low}`,
  )

  if (report.summary.total === 0) {
    lines.push('  ✅ No delivery integrity issues detected.')
    return lines.join('\n')
  }

  // By kind breakdown
  const kindEntries = Object.entries(report.summary.byKind) as Array<
    [DeliveryFindingKind, number]
  >
  const kindParts = kindEntries
    .filter(([, c]) => c > 0)
    .map(([k, c]) => `${KIND_LABELS[k]}: ${c}`)
  if (kindParts.length > 0) {
    lines.push(`  By kind: ${kindParts.join(' | ')}`)
  }

  lines.push('')

  for (let i = 0; i < report.findings.length; i++) {
    const f = report.findings[i]
    const sevIcon = f.severity === 'high' ? '🔴' : f.severity === 'medium' ? '🟠' : '🟡'
    const confLabel = `[${f.severity.toUpperCase()} · conf ${f.confidence} · ${f.kind}]`

    lines.push(`${sevIcon} ${i + 1}. ${KIND_LABELS[f.kind]} ${confLabel}`)
    lines.push(`   Surface: ${SURFACE_LABELS[f.surface] ?? f.surface}`)
    lines.push(`   Reason: ${f.reason}`)
    if (f.matchedTerm) {
      lines.push(`   Matched: "${f.matchedTerm}"`)
    }
    if (f.snippet) {
      lines.push(`   Snippet: ${f.snippet}`)
    }
    if (opts?.verbose) {
      lines.push(`   Evidence: ${f.evidence.join('; ')}`)
      lines.push(`   Suggestion: ${f.suggestion}`)
    }
    lines.push('')
  }

  if (!opts?.verbose) {
    lines.push('Use verbose=true for evidence and suggestions on each finding.')
  }

  return lines.join('\n')
}

// ─── Internal utilities ─────────────────────────────────────────────────────

function emptyReport(): DeliveryAuditReport {
  return {
    findings: [],
    summary: {
      total: 0,
      high: 0,
      medium: 0,
      low: 0,
      byKind: {
        REJECTED_ALTERNATIVE_LEAKAGE: 0,
        REVISION_PROCESS_LEAKAGE: 0,
        PROVENANCE_LEAKAGE: 0,
        UNJUSTIFIED_NEGATIVE_REFERENCE: 0,
        DELIVERY_CANDIDATE: 0,
      },
    },
  }
}
