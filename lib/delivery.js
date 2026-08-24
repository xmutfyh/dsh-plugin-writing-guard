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
// ─── Helpers ────────────────────────────────────────────────────────────────
/**
 * Unicode NFKC + case fold + strip all punctuation / whitespace / separators.
 * Covers ASCII, fullwidth (FF00-FF0F range), CJK punctuation, and general Punctuation blocks.
 */
export function normalizeTerm(s) {
    return s
        .normalize('NFKC')
        .toLowerCase()
        // eslint-disable-next-line no-misleading-character-class
        .replace(/[\s\p{P}\p{S}\p{Z}]/gu, '');
}
/**
 * Space-preserving normalization for matching. NFKC + case-fold; punctuation/
 * whitespace/separators collapse to a single space (not stripped) so that word
 * boundaries are preserved.  Returns the normalized string and a map from
 * normalized-index → original-index for accurate snippet extraction.
 *
 * Boundary checking against the normalized text (adjacent char must NOT be
 * [a-z0-9]) prevents substring FPs ("toast" inside "toasted", "cat" inside
 * "catalog").
 */
function normForMatch(s) {
    const str = s.normalize('NFKC');
    const norm = [];
    const map = [];
    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        // eslint-disable-next-line no-misleading-character-class
        if (/^[\s\p{P}\p{S}\p{Z}]$/u.test(ch)) {
            if (norm.length > 0 && norm[norm.length - 1] !== ' ') {
                norm.push(' ');
                map.push(i);
            }
        }
        else {
            norm.push(ch.toLowerCase());
            map.push(i);
        }
    }
    const joined = norm.join('');
    return {
        norm: joined,
        toOrig: (ni) => (ni < map.length ? map[ni] : Math.max(0, str.length - 1)),
    };
}
/**
 * Convert a space-preserving normalized term into a search regex string.
 * Spaces become \s (whitespace), other characters are escaped.
 */
function termNormToRegex(termNorm) {
    let re = '';
    for (const ch of termNorm) {
        if (ch === ' ')
            re += '\\s';
        // eslint-disable-next-line no-misleading-character-class
        else if (/^[a-z0-9\u4e00-\u9fff]$/u.test(ch))
            re += ch;
        else
            re += '\\' + ch;
    }
    return re;
}
/**
 * Generic negative / stop words that must never, on their own, constitute
 * evidence of a rejected term.  Covers EN (no/not/without/remove/replace/
 * delete/drop) and ZH (不/没有/删除/不再/移除/取消/替换/替代/去除/去掉).
 * Multi-word phrases are omitted; the guard checks single normalized tokens.
 */
const GENERIC_NEGATIVE_TERMS = new Set([
    'no', 'not', 'none', 'without',
    'remove', 'removes', 'removed', 'removing',
    'replace', 'replaces', 'replaced', 'replacing',
    'delete', 'deletes', 'deleted', 'deleting',
    'drop', 'drops', 'dropped', 'dropping',
    '不', '没', '没有', '无', '不再',
    '删除', '移除', '取消', '替换', '替代', '去除', '去掉',
]);
/** Extract a short snippet around a match index */
function snippetAround(text, idx, radius = 40) {
    const start = Math.max(0, idx - radius);
    const end = Math.min(text.length, idx + radius);
    let s = text.slice(start, end);
    if (start > 0)
        s = '…' + s;
    if (end < text.length)
        s = s + '…';
    return s.trim();
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
    // scientific / epistemic protection (v1.7.0)
    /\b(?:do|did|does)\s+not\s+(?:establish|imply|indicate|suggest|demonstrate|support|show)\b/i,
    /\b(?:cannot|can\s+not)\s+(?:establish|conclude|confirm|claim|determine|rule\s+out)\b/i,
    /\b(?:must|shall)\s+not\s+be\b/i,
    /\b(?:will|would)\s+not\s+(?:retry|repeat)\b/i,
];
const PROTECTED_NEGATION_ZH = [
    /无显著[差异变化影响]/,
    /未[观发检]现/,
    /不[存具]备/,
    /不含/,
    /不含[有任]/,
    /无不良/,
    /无[任何已知]/,
    /无证据[表显]明/,
    // scientific / compliance protection (v1.7.0)
    /(?:未|不)(?:证明|表明|显示|证实|建立)/,
    /不构成/,
    /不表示/,
    /(?:不得|不能|不可)(?:重试|重复)/,
];
/** Scientific null finding / safety statement → suppress */
function isProtectedNegation(text) {
    return (PROTECTED_NEGATION_EN.some((r) => r.test(text)) ||
        PROTECTED_NEGATION_ZH.some((r) => r.test(text)));
}
/**
 * Patterns indicating real deletion / migration that requires baseline truth.
 * These are used when checking "Remove X" style statements.
 */
const REAL_ACTION_EN = [
    /\b(?:remove[d]?|delet(?:ed|e|ing)|drop(?:ped|ping)?|replac(?:ed|ing)|migrat(?:ed|ing)|updat(?:ed|ing)|switch(?:ed|ing)?)\s+(?:the\s+|our\s+|a\s+)?/i,
    /\bwithout\s+(?:the\s+|our\s+|a\s+)?/i,
    /\bno\s+long(?:er|er)\s+(?:uses?|supports?|includes?|requires?|contains?|relies?)\b/i,
];
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
    /取消/, // v1.7.0 — "取消抽奖环节"
];
// ─── Process Residue Detection (surface-aware) ──────────────────────────────
const PROCESS_RESIDUE_EN = [
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
];
/** Filename/test_name specific patterns: standalone "revised"/"updated"/"final" is residue */
const PROCESS_RESIDUE_FILENAME_EN = [
    /\brevised\b/i,
    /\bupdated\b/i,
    /\bfinal\b/i,
    /\bnew\b/i,
    /\bold\b/i,
    /\bbackup\b/i,
    /\bcopy\b/i,
];
const PROCESS_RESIDUE_ZH = [
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
];
/**
 * Surfaces where process residue is almost always illegitimate.
 * In these, exposing internal chat revision process is CAL.
 */
const STRICT_SURFACES = new Set([
    'title',
    'filename',
    'heading',
    'test_name',
    'commit',
    'pr',
    'release',
]);
/**
 * Surfaces where process residue MAY be legitimate:
 * - comment: could be a code comment explaining a design decision ("replaced X with Y per discussion")
 * - handoff: handoff docs often include rationale
 * - rebuttal: reviewer response legitimately references revision process
 * - unknown: cautious, report as low
 */
function processResidueSeverity(surface) {
    if (surface === 'title' || surface === 'filename')
        return 'high';
    if (surface === 'heading' || surface === 'test_name')
        return 'high';
    if (surface === 'commit' || surface === 'pr' || surface === 'release')
        return 'medium';
    if (surface === 'comment' || surface === 'handoff')
        return 'low';
    return 'low'; // unknown
}
// ─── Rejected Alternative Detection ─────────────────────────────────────────
function checkRejectedAlternative(text, rejectedTerms, surface) {
    const findings = [];
    if (!text || rejectedTerms.length === 0)
        return findings;
    const { norm: normText, toOrig } = normForMatch(text);
    const seen = new Set(); // dedupe by normalized term (spaces stripped)
    for (const term of rejectedTerms) {
        const normTerm = normForMatch(term).norm;
        if (!normTerm)
            continue;
        // Stopword guard: standalone negatives can never be evidence on their own
        if (GENERIC_NEGATIVE_TERMS.has(normTerm))
            continue;
        const dedupeKey = normalizeTerm(term); // spaces stripped for deduplication
        // Search for the term using a regex with \s for spaces, then enforce
        // character boundaries so that "toast" does not match inside "toasted"
        // and "cat" does not match inside "catalog".
        const re = new RegExp(termNormToRegex(normTerm), 'gi');
        let foundMatch = false;
        // eslint-disable-next-line no-continue
        for (const m of normText.matchAll(re)) {
            const idx = m.index ?? 0;
            const end = idx + m[0].length;
            // Boundary check: adjacent characters must NOT be [a-z0-9] (ASCII word chars)
            const prev = idx === 0 ? '' : normText[idx - 1];
            const next = end < normText.length ? normText[end] : '';
            if (/[a-z0-9]/.test(prev) || /[a-z0-9]/.test(next))
                continue;
            // Per-match protection: check if this specific occurrence sits inside
            // a legitimate scientific / safety / compliance context.
            const ctxStart = Math.max(0, idx - 40);
            const ctxEnd = Math.min(normText.length, end + 40);
            const context = normText.slice(ctxStart, ctxEnd);
            if (isProtectedNegation(context))
                continue;
            if (seen.has(dedupeKey))
                break; // already reported this term
            seen.add(dedupeKey);
            findings.push({
                kind: 'REJECTED_ALTERNATIVE_LEAKAGE',
                severity: surface === 'title' || surface === 'filename' ? 'high' : 'medium',
                confidence: 'high',
                evidence: [
                    `Text contains rejected term "${term}"`,
                    `Surface: ${surface}`,
                ],
                reason: `The term "${term}" was explicitly rejected in the working context but appears in the final ${surface}. ` +
                    `This is Context-to-Artifact Leakage (CAL): the rejected alternative should not appear in deliverables.`,
                suggestion: `Remove or rephrase to avoid referencing the rejected alternative "${term}". ` +
                    `If the term is necessary for context, ensure the phrasing makes clear it was rejected.`,
                surface,
                matchedTerm: term,
                snippet: snippetAround(text, toOrig(idx)),
            });
            foundMatch = true;
            break; // one finding per term
        }
        if (!foundMatch)
            continue;
    }
    return findings;
}
// ─── Baseline Reality Check ─────────────────────────────────────────────────
/**
 * Extract "action + subject" patterns from text and check against baseline.
 * If baseline doesn't contain the subject, it's likely CAL.
 */
const ACTION_SUBJECT_PATTERNS_EN = [
    // "Remove the deprecated API" → subject = "the deprecated API"
    { action: /\b(?:remove[d]?|delet(?:ed|e|ing)|drop(?:ped|ping)?)\s+(.{3,60}?)(?:\.|,|;|\s+(?:from|in|to|for|that|and|which|by)\b|$)/i, subjectGroup: 1 },
    // "Replace X with Y" → subject = "X"
    { action: /\b(?:replac(?:ed|ing))\s+(.{3,60}?)\s+with\b/i, subjectGroup: 1 },
    // "Without the old feature" → subject = "the old feature"
    { action: /\bwithout\s+(the\s+|our\s+|a\s+)?(.{3,60}?)(?:\.|,|;|\s+(?:from|in|to|for|that|and|which|by)\b|$)/i, subjectGroup: 2 },
    // "No longer uses/contains X" → subject = "X"
    { action: /\bno\s+longer\s+(?:uses?|supports?|includes?|requires?|contains?|relies?)\s+(.{3,60}?)(?:\.|,|;|$)/i, subjectGroup: 1 },
];
const ACTION_SUBJECT_PATTERNS_ZH = [
    // "删除 X" → subject = "X"
    { action: /删除了?\s*(.{2,30}?)(?:[。,;]|$)/, subjectGroup: 1 },
    // "移除 X" → subject = "X"
    { action: /移除了?\s*(.{2,30}?)(?:[。,;]|$)/, subjectGroup: 1 },
    // "替换 X 为 Y" → subject = "X"
    { action: /替[换代]了?\s*(.{2,30}?)\s*(?:为|成)/, subjectGroup: 1 },
    // "不再使用 X" → subject = "X"
    { action: /不再(?:使用|采用|支持)\s*(.{2,30}?)(?:[。,;]|$)/, subjectGroup: 1 },
    // "取消 X" → subject = "X"  (v1.7.0 — "取消抽奖环节，改为现场互动")
    { action: /取消[了]?\s*(.{2,30}?)(?:[。,;]|$)/, subjectGroup: 1 },
    // "改为 X" — no subject to check (replacing something unspecified)
];
/**
 * Strip leading articles, determiners, and common adjectives from a subject
 * to get the core noun for baseline matching.
 */
function coreSubject(raw) {
    return raw
        .replace(/^(?:the|our|a|an|this|that|these|those|its|my|your|our)\s+/i, '')
        .replace(/^(?:deprecated|legacy|old|new|original|existing|current|prior)\s+/i, '')
        .trim();
}
/**
 * Extract significant tokens from a subject: ASCII words (≥3 chars) and
 * CJK bigrams.  Used for token-level baseline matching (v1.7.0) so that
 * "Toast errors" matches a baseline containing "Toast notifications".
 */
function subjectTokens(subject) {
    const str = subject.normalize('NFKC').toLowerCase();
    const tokens = [];
    for (const m of str.matchAll(/[a-z0-9][a-z0-9_]*/g)) {
        if (m[0].length >= 3)
            tokens.push(m[0]);
    }
    for (const run of str.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
        for (let i = 0; i + 1 < run[0].length; i++) {
            tokens.push(run[0].slice(i, i + 2));
        }
    }
    return tokens;
}
/**
 * Check if a substring exists in the baseline text (normalized match).
 * Tries full subject → core subject → token-level (v1.7.0).
 * Token level prevents real-migration false positives where the full
 * subject spans across words differently (e.g. "Toast errors" ↔
 * "Toast notifications").
 */
function existsInBaseline(subject, baseline) {
    if (!baseline)
        return false;
    const full = normalizeTerm(subject);
    if (full.length < 2)
        return false; // too short to match reliably
    const normBaseline = normalizeTerm(baseline);
    if (normBaseline.includes(full))
        return true;
    // Try core subject (strip leading articles/adjectives)
    const core = normalizeTerm(coreSubject(subject));
    if (core.length >= 2 && normBaseline.includes(core))
        return true;
    // Token level (v1.7.0): if any significant token from the subject appears
    // in the baseline, the reference is likely real (e.g. "Toast errors" ↔
    // "Toast notifications" both share the token "toast").
    for (const tok of subjectTokens(subject)) {
        if (normBaseline.includes(tok))
            return true;
    }
    return false;
}
/**
 * Check if text contains any "action + subject" patterns where the subject
 * does NOT exist in baseline. This indicates CAL.
 */
function checkBaselineReality(text, baseline, finalState, surface, hasRejectionContext) {
    // No baseline available: emit a low-confidence DELIVERY_CANDIDATE when
    // there is no rejection context (spec: never fabricate facts; lower
    // confidence when baseline is unavailable).
    if (!baseline) {
        if (hasRejectionContext)
            return [];
        const patterns = [...ACTION_SUBJECT_PATTERNS_EN, ...ACTION_SUBJECT_PATTERNS_ZH];
        for (const { action, subjectGroup } of patterns) {
            const m = action.exec(text);
            if (!m)
                continue;
            const subject = m[subjectGroup]?.trim();
            if (!subject || subject.length < 2)
                continue;
            // If the subject exists in the observed final state, the reference
            // is grounded — suppress the candidate.
            if (existsInBaseline(subject, finalState))
                continue;
            return [
                {
                    kind: 'DELIVERY_CANDIDATE',
                    severity: 'low',
                    confidence: 'low',
                    evidence: [
                        `Action pattern "${m[0].trim()}" references "${subject}"`,
                        `No baseline provided — cannot verify "${subject}" against the authoritative state`,
                    ],
                    reason: `The text describes removing/replacing "${subject}", but no baseline was supplied. ` +
                        `Whether this is a real deletion or Context-to-Artifact Leakage cannot be determined automatically.`,
                    suggestion: `Provide the baseline (authoritative state) so the tool can verify whether "${subject}" existed, ` +
                        `or manually confirm the reference before publishing.`,
                    surface,
                    matchedTerm: subject,
                    snippet: snippetAround(text, m.index ?? 0),
                },
            ];
        }
        return [];
    }
    const findings = [];
    const patterns = [...ACTION_SUBJECT_PATTERNS_EN, ...ACTION_SUBJECT_PATTERNS_ZH];
    for (const { action, subjectGroup } of patterns) {
        const m = action.exec(text);
        if (!m)
            continue;
        const subject = m[subjectGroup]?.trim();
        if (!subject || subject.length < 2)
            continue;
        const inBaseline = existsInBaseline(subject, baseline);
        const inFinal = existsInBaseline(subject, finalState);
        // baseline has subject, final doesn't → possibly real deletion → don't flag
        if (inBaseline && !inFinal)
            continue;
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
                reason: `The text describes removing/replacing "${subject}", but this term does not exist in the baseline. ` +
                    `If it only exists in the rejected working context, this is Context-to-Artifact Leakage.`,
                suggestion: `Verify whether "${subject}" was ever actually present in the deliverable. ` +
                    `If not, rewrite to describe what was ADDED rather than what was REMOVED.`,
                surface,
                matchedTerm: subject,
                snippet: snippetAround(text, m.index ?? 0),
            });
        }
    }
    return findings;
}
// ─── Provenance Leakage Detection ───────────────────────────────────────────
/**
 * Patterns indicating provenance leakage: text that exposes the process
 * of how something was decided or created, rather than what was done.
 */
const PROVENANCE_PATTERNS_EN = [
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
];
const PROVENANCE_PATTERNS_ZH = [
    /根据讨论/,
    /根据聊天记录/,
    /我们讨论过/,
    /你之前说/,
    /你说的/,
    /之前讨论的/,
    /根据对话/,
    /聊天中提到/,
    /我们原[来先].*讨论/,
];
/**
 * Surfaces where provenance leakage is more severe.
 */
function provenanceSeverity(surface) {
    if (surface === 'title' || surface === 'filename' || surface === 'heading')
        return 'high';
    if (surface === 'commit' || surface === 'test_name')
        return 'medium';
    if (surface === 'comment' || surface === 'handoff')
        return 'low';
    return 'low';
}
function checkProvenanceLeakage(text, surface) {
    const findings = [];
    const patterns = [...PROVENANCE_PATTERNS_EN, ...PROVENANCE_PATTERNS_ZH];
    for (const pattern of patterns) {
        const m = pattern.exec(text);
        if (!m)
            continue;
        findings.push({
            kind: 'PROVENANCE_LEAKAGE',
            severity: provenanceSeverity(surface),
            confidence: 'medium',
            evidence: [
                `Pattern "${m[0]}" exposes provenance / working context`,
                `Surface: ${surface}`,
            ],
            reason: `The text exposes the collaborative process ("${m[0]}") rather than the outcome. ` +
                `In a ${surface}, this leaks internal context into the deliverable.`,
            suggestion: `Rewrite to describe the decision or outcome without referencing the discussion process. ` +
                `E.g. "Added X" instead of "Based on our discussion, added X".`,
            surface,
            snippet: snippetAround(text, m.index ?? 0),
        });
    }
    return findings;
}
// ─── Defensive Hedge (revision-process residue on rejected claims, v1.7.0) ──
/**
 * Hedging phrases that reference rejected claims ("we do not claim X").
 * Legitimate scientific hedging ("does not establish causality") is NOT a
 * hedge — it is protected by PROTECTED_NEGATION and does not fire here.
 * The hedge only counts as residue when a rejected term/claim appears
 * verbatim in the text.
 */
const HEDGE_PATTERNS_EN = [
    /\b(?:do|did|does)\s+not\s+(?:claim|assert|argue|conclude)\b/i,
    /\b(?:are|is|was|were)\s+not\s+(?:claiming|asserting|arguing)\b/i,
];
const HEDGE_PATTERNS_ZH = [
    /不(?:声称|宣称|主张|认为)/,
    /未(?:声称|宣称|断言)/,
];
function checkDefensiveHedge(text, rejectedTerms, surface) {
    const findings = [];
    if (!text || rejectedTerms.length === 0)
        return findings;
    const { norm: normText } = normForMatch(text);
    // Check if a rejected term/claim actually appears in the text (with
    // boundary checking, same logic as checkRejectedAlternative).
    let rejectedPresent = false;
    let rejectedHit = '';
    for (const term of rejectedTerms) {
        const normTerm = normForMatch(term).norm;
        if (!normTerm || GENERIC_NEGATIVE_TERMS.has(normTerm))
            continue;
        const re = new RegExp(termNormToRegex(normTerm), 'gi');
        for (const m of normText.matchAll(re)) {
            const idx = m.index ?? 0;
            const end = idx + m[0].length;
            const prev = idx === 0 ? '' : normText[idx - 1];
            const next = end < normText.length ? normText[end] : '';
            if (/[a-z0-9]/.test(prev) || /[a-z0-9]/.test(next))
                continue;
            rejectedPresent = true;
            rejectedHit = term;
            break;
        }
        if (rejectedPresent)
            break;
    }
    if (!rejectedPresent)
        return findings;
    // Look for a defensive hedge pattern near the rejected-term occurrence
    for (const pattern of [...HEDGE_PATTERNS_EN, ...HEDGE_PATTERNS_ZH]) {
        const m = pattern.exec(text);
        if (!m)
            continue;
        // Check context: if the hedge itself sits inside a protected scientific/
        // safety / compliance context, suppress — it's legitimate language.
        const mIdx = m.index ?? 0;
        const start = Math.max(0, mIdx - 40);
        const end = Math.min(text.length, mIdx + m[0].length + 40);
        if (isProtectedNegation(text.slice(start, end)))
            continue;
        findings.push({
            kind: 'REVISION_PROCESS_LEAKAGE',
            severity: surface === 'title' || surface === 'commit' ? 'medium' : 'low',
            confidence: 'medium',
            evidence: [
                `Defensive hedge "${m[0].trim()}" references rejected context`,
                `Rejected term "${rejectedHit}" appears in the text`,
            ],
            reason: `The hedge "${m[0].trim()}" exists only because "${rejectedHit}" was a working-context claim. ` +
                `Referencing it in the final deliverable is revision-process residue.`,
            suggestion: `Do NOT delete the underlying scientific statement (e.g. the association result) — that is the core content. ` +
                `Only reconsider whether the defensive hedge itself ("we do not claim…") is necessary in the final deliverable; ` +
                `if the rejected claim never existed in earlier drafts, the hedge can be dropped without losing scientific meaning.`,
            surface,
            matchedTerm: m[0].trim(),
            snippet: snippetAround(text, mIdx),
        });
        break; // one hedge finding
    }
    return findings;
}
// ─── Main Audit Function ────────────────────────────────────────────────────
/**
 * Audit a deliverable text for Context-to-Artifact Leakage (CAL).
 *
 * @param opts - Audit options including text, surface, baseline, and rejected context
 * @returns Audit report with findings and summary
 */
export function auditDelivery(opts) {
    const { text, surface = 'unknown', baseline, finalState, rejectedTerms = [], rejectedClaims = [], } = opts;
    if (!text || !text.trim()) {
        return emptyReport();
    }
    const allFindings = [];
    // 1. Rejected alternative leakage (exact normalized match)
    const allRejected = [...rejectedTerms, ...rejectedClaims];
    if (allRejected.length > 0) {
        allFindings.push(...checkRejectedAlternative(text, allRejected, surface));
    }
    // 2. Process residue detection (surface-aware)
    allFindings.push(...checkProcessResidue(text, surface));
    // 3. Baseline reality check (CAL core)
    allFindings.push(...checkBaselineReality(text, baseline, finalState, surface, allRejected.length > 0));
    // 4. Provenance leakage
    allFindings.push(...checkProvenanceLeakage(text, surface));
    // 5. Defensive hedge on rejected claims (revision-process residue, v1.7.0)
    if (allRejected.length > 0) {
        allFindings.push(...checkDefensiveHedge(text, allRejected, surface));
    }
    // Build summary
    const summary = {
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
    };
    for (const f of allFindings) {
        summary[f.severity]++;
        summary.byKind[f.kind]++;
    }
    return { findings: allFindings, summary };
}
// ─── Process Residue (internal, surface-aware) ──────────────────────────────
function checkProcessResidue(text, surface) {
    const findings = [];
    const patterns = [...PROCESS_RESIDUE_EN, ...PROCESS_RESIDUE_ZH];
    // In rebuttal, process residue is generally legitimate
    // Note: "rebuttal" is not a DeliverySurface per the spec.
    // Users writing rebuttals should use surface='unknown' or 'handoff'.
    // Process residue in handoff is already low severity.
    // For filename/test_name, use stricter patterns (standalone "revised" etc. is residue)
    if (surface === 'filename' || surface === 'test_name') {
        patterns.push(...PROCESS_RESIDUE_FILENAME_EN);
    }
    for (const pattern of patterns) {
        const m = pattern.exec(text);
        if (!m)
            continue;
        const matched = m[0];
        const sev = processResidueSeverity(surface);
        // Check if this is protected (scientific / safety context)
        // Extract surrounding context for protection check
        const start = Math.max(0, (m.index ?? 0) - 30);
        const end = Math.min(text.length, (m.index ?? 0) + matched.length + 30);
        const context = text.slice(start, end);
        if (isProtectedNegation(context))
            continue;
        findings.push({
            kind: 'REVISION_PROCESS_LEAKAGE',
            severity: sev,
            confidence: surface === 'title' || surface === 'filename' ? 'high' : 'medium',
            evidence: [
                `Process residue pattern "${matched}" found in ${surface}`,
            ],
            reason: `The phrase "${matched}" exposes the revision/editing process. ` +
                (STRICT_SURFACES.has(surface)
                    ? `In a ${surface}, internal process references should not appear in final deliverables.`
                    : `Consider whether this reference to the editing process is appropriate here.`),
            suggestion: surface === 'commit'
                ? `Rewrite commit message to describe what was DONE, not what was CHANGED FROM. E.g. "Add inline validation" instead of "Replace Toast with inline validation".`
                : surface === 'title'
                    ? `Rewrite title to describe the outcome, not the process. E.g. "Inline Validation" instead of "Revised Version".`
                    : `Consider rephrasing to describe the outcome rather than the process.`,
            surface,
            matchedTerm: matched,
            snippet: snippetAround(text, m.index ?? 0),
        });
    }
    return findings;
}
// ─── Report Formatting ──────────────────────────────────────────────────────
const KIND_LABELS = {
    REJECTED_ALTERNATIVE_LEAKAGE: 'Rejected Alternative Leakage',
    REVISION_PROCESS_LEAKAGE: 'Revision Process Leakage',
    PROVENANCE_LEAKAGE: 'Provenance Leakage',
    UNJUSTIFIED_NEGATIVE_REFERENCE: 'Unjustified Negative Reference',
    DELIVERY_CANDIDATE: 'Delivery Candidate',
};
const SURFACE_LABELS = {
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
};
/**
 * Format a DeliveryAuditReport as a human-readable string.
 */
export function formatDeliveryReport(report, opts) {
    const lines = [];
    lines.push(`【Delivery Integrity Audit】${report.summary.total} finding(s)`);
    lines.push(`  🔴 High: ${report.summary.high}  🟠 Medium: ${report.summary.medium}  🟡 Low: ${report.summary.low}`);
    if (report.summary.total === 0) {
        lines.push('  ✅ No delivery integrity issues detected.');
        return lines.join('\n');
    }
    // By kind breakdown
    const kindEntries = Object.entries(report.summary.byKind);
    const kindParts = kindEntries
        .filter(([, c]) => c > 0)
        .map(([k, c]) => `${KIND_LABELS[k]}: ${c}`);
    if (kindParts.length > 0) {
        lines.push(`  By kind: ${kindParts.join(' | ')}`);
    }
    lines.push('');
    for (let i = 0; i < report.findings.length; i++) {
        const f = report.findings[i];
        const sevIcon = f.severity === 'high' ? '🔴' : f.severity === 'medium' ? '🟠' : '🟡';
        const confLabel = `[${f.severity.toUpperCase()} · conf ${f.confidence} · ${f.kind}]`;
        lines.push(`${sevIcon} ${i + 1}. ${KIND_LABELS[f.kind]} ${confLabel}`);
        lines.push(`   Surface: ${SURFACE_LABELS[f.surface] ?? f.surface}`);
        lines.push(`   Reason: ${f.reason}`);
        if (f.matchedTerm) {
            lines.push(`   Matched: "${f.matchedTerm}"`);
        }
        if (f.snippet) {
            lines.push(`   Snippet: ${f.snippet}`);
        }
        if (opts?.verbose) {
            lines.push(`   Evidence: ${f.evidence.join('; ')}`);
            lines.push(`   Suggestion: ${f.suggestion}`);
        }
        lines.push('');
    }
    if (!opts?.verbose) {
        lines.push('Use verbose=true for evidence and suggestions on each finding.');
    }
    return lines.join('\n');
}
// ─── Internal utilities ─────────────────────────────────────────────────────
function emptyReport() {
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
    };
}
