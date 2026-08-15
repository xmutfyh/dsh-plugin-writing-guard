// -*- coding: utf-8 -*-
/**
 * writing-guard 回归测试：真实语料 TP/TN 检查（无需测试框架，node 直接跑）。
 * 目标：每条核心规则至少有一个 true-positive 和一个 true-negative 断言。
 * 运行：node tests/run-tests.mjs
 */
import { auditText, detectDocumentProfile, filterReport } from '../lib/rules.js'

let pass = 0
let fail = 0
const failures = []

function check(name, cond, detail = '') {
  if (cond) {
    pass += 1
    console.log(`  ✅ ${name}`)
  } else {
    fail += 1
    failures.push(`${name} ${detail}`)
    console.log(`  ❌ ${name} ${detail}`)
  }
}

function hasRule(report, ruleId) {
  return report.hits.some((h) => h.ruleId === ruleId)
}

console.log('=== 1. 修改过程残留（manuscript profile）===')

{
  const tp = auditText(
    'The revised model uses the ΔP regression objective only. As requested by the reviewer, we have updated the methods.',
    { profile: 'manuscript' },
  )
  check('revised-family TP', hasRule(tp, 'revised-family'))
  check('as-requested TP (manuscript)', hasRule(tp, 'as-requested'))
  check('we-have-changed TP', hasRule(tp, 'we-have-changed'))

  // TN：rebuttal 里完全正常
  const tn = auditText(
    'Response to Reviewer 1: As requested, we have revised the manuscript. We have updated Table 3 and added the experiment.',
    { profile: 'rebuttal' },
  )
  check('residue TN (rebuttal profile, 0 hits)', tn.summary.total === 0, `got ${tn.summary.total}`)

  // TN：学术正常词
  const tn2 = auditText(
    'We evaluated the Revised Cardiac Risk Index. The revised simplex method was used to solve the LP. Smith (2019) proposed a revised model for permeability.',
    { profile: 'manuscript' },
  )
  check('revised-family TN (Revised Cardiac Risk Index / simplex / Smith)', !hasRule(tn2, 'revised-family'), JSON.stringify(tn2.hits.map((h) => h.snippet).slice(0, 2)))
}

console.log('=== 2. 文档类型检测 ===')
{
  check('rebuttal detect', detectDocumentProfile('response_to_reviewers.md') === 'rebuttal')
  check('cover_letter detect', detectDocumentProfile('CoverLetter.docx') === 'cover_letter')
  check('manuscript detect', detectDocumentProfile('manuscript_revised.md') === 'manuscript')
  check('notes detect (v0.3.1: notes 不再半死)', detectDocumentProfile('notes.txt') === 'notes')
  // GPT v0.3.1：综述类应判 manuscript，不判 review
  check('systematic_review → manuscript', detectDocumentProfile('systematic_review.md') === 'manuscript')
  check('literature_review → manuscript', detectDocumentProfile('literature_review.md') === 'manuscript')
  check('review_article → manuscript', detectDocumentProfile('review_article.md') === 'manuscript')
  check('reviewer_comments → review', detectDocumentProfile('reviewer_comments.md') === 'review')
  check('peer_review → review', detectDocumentProfile('peer_review_notes.md') === 'review')
  check('审稿意见 → review', detectDocumentProfile('审稿意见.md') === 'review')
}

console.log('=== 3. 防御性写作 / 主张校准 ===')
{
  const tp = auditText(
    'We do not claim that our method is superior. 本文并非要证明该方法全面优于现有方法。遗憾的是，效果有限。',
    { profile: 'manuscript' },
  )
  check('we-do-not-claim TP', hasRule(tp, 'we-do-not-claim'))
  check('cn-defensive-claim TP', hasRule(tp, 'cn-defensive-claim'))
  check('self-deprecation TP', hasRule(tp, 'self-deprecation'))

  // TN：正当 limitations（ICMJE 要求）
  const tn = auditText(
    'This study has several limitations. First, the sample size is limited. Second, only one lab was used. These limitations should be considered when interpreting the results.',
    { profile: 'manuscript' },
  )
  check('limitations TN (ICMJE-appropriate, no defensive hits)', !hasRule(tn, 'cn-defensive-claim') && !hasRule(tn, 'we-do-not-claim'), JSON.stringify(tn.hits.map((h) => h.ruleId)))
}

console.log('=== 4. 修辞模式 ===')
{
  const tp = auditText(
    '真正重要的从来不是网络结构，而是数据质量。其核心在于端到端学习。',
    { profile: 'manuscript' },
  )
  check('not-x-but-y-zh TP', hasRule(tp, 'not-x-but-y-zh'))
  check('absolutist-def TP', hasRule(tp, 'absolutist-def'))
}

console.log('=== 5. LLM 关联词（密度规则）===')
{
  // 密度不足：1 次不报警
  const sparse = auditText(
    'We delve into the details of the method in the next section. The rest of the paper proceeds as follows.',
    { profile: 'manuscript' },
  )
  check('llm-word TN (1 occurrence, below density)', !hasRule(sparse, 'llm-verb-noun-overuse'), JSON.stringify(sparse.hits.map((h) => h.ruleId)))

  // 密度足够：多次报警
  const dense = auditText(
    'We delve into the tapestry of mechanisms. This is a testament to the power of leverage. We harness the cornerstone of the paradigm. The realm of our work showcases a seamless integration of state-of-the-art methods.',
    { profile: 'manuscript' },
  )
  check('llm-word TP (density threshold reached)', hasRule(dense, 'llm-verb-noun-overuse'), JSON.stringify(dense.hits.map((h) => h.snippet)))
}

console.log('=== 6. filterReport 方向（high > medium > low）===')
{
  const r = auditText(
    'The revised model uses ΔP. 本文并非要证明。真正重要的从来不是X而是Y。somewhat quite fairly.',
    { profile: 'manuscript' },
  )
  const fHigh = filterReport(r, 'high')
  const fLow = filterReport(r, 'low')
  check('filter high keeps only high', fHigh.summary.high === fHigh.summary.total && fHigh.summary.low === 0, `high=${fHigh.summary.high} total=${fHigh.summary.total} low=${fHigh.summary.low}`)
  check('filter low keeps everything', fLow.summary.total === r.summary.total, `filtered=${fLow.summary.total} original=${r.summary.total}`)
  check('filter recomputes summary', fHigh.summary.total === fHigh.hits.length, `summary.total=${fHigh.summary.total} hits=${fHigh.hits.length}`)
}

console.log('=== 7. 项目内部词表 ===')
{
  const r = auditText(
    'The source_map was updated. priority is a normal word. SHA-256 is a standard hash.',
    { profile: 'manuscript', projectResidueTerms: ['source_map'] },
  )
  check('project-residue TP (source_map)', hasRule(r, 'project-residue'))
  check('priority/SHA-256 not flagged as process residue', r.summary.byCategory.process_residue <= 1, `process_residue=${r.summary.byCategory.process_residue}`)
}

console.log('=== 8. 破折号密度（范围连字符不算）===')
{
  const ok = auditText(
    'T = 30–75 °C, V = 0.5–2.0 mL/min, fold–seed cells, gas–liquid interface.',
    { profile: 'manuscript' },
  )
  check('en-dash range TN (no em-dash flagged)', !hasRule(ok, 'em-dash-density'))

  const bad = auditText(
    'This is a dash — and another — and a third — and a fourth — and a fifth one — in one paragraph.',
    { profile: 'manuscript' },
  )
  check('em-dash TP (5+ dashes)', hasRule(bad, 'em-dash-density'))
}

console.log('=== 9. 抽象副词与 significantly 复核 ===')
{
  // v0.3.1：附近有统计证据（p<0.05）的 significantly 不报；无证据的报
  const r = auditText(
    'The model significantly reduces the error without any statistical evidence provided. Remarkably, the method works.',
    { profile: 'manuscript' },
  )
  check('abstract-filler TP (remarkably)', hasRule(r, 'abstract-filler'))
  check('significantly-context TP (no p-value nearby)', hasRule(r, 'significantly-context'))

  // GPT v0.3.1：significantly + p 值 → 跳过
  const tn = auditText(
    'The treatment group showed significantly different outcomes (p < 0.001, 95% CI [0.12, 0.34]). The effect size was Cohen\'s d = 0.8.',
    { profile: 'manuscript' },
  )
  check('significantly-context TN (p-value/CI/effect size nearby)', !hasRule(tn, 'significantly-context'), JSON.stringify(tn.hits.map((h) => h.ruleId)))
}

console.log('=== 10. v0.3.1 中文 density（按词计，不用字符当词）===')
{
  // 中文长句：countWords 应按字计数（CJK 逐字），密度分母不再是 1
  const zh = auditText(
    '值得注意的是，综上所述，与此同时，随着深度学习的发展，不难发现该方法具有重要意义。',
    { profile: 'manuscript' },
  )
  // 5 个套话 / 约 40 字 = 远低于 2.0/千字符阈值 → 不报
  check('cn-ai-connectives TN (density below char threshold)', !hasRule(zh, 'cn-ai-connectives'), JSON.stringify(zh.hits.map((h) => h.ruleId)))

  // 大量重复中文套话 → 报
  const zhDense = auditText(
    '值得注意的是，众所周知，综上所述，不难发现，与此同时，基于此，随着技术的发展，在当前的背景下，需要强调的是，值得一提的是。',
    { profile: 'manuscript' },
  )
  check('cn-ai-connectives TP (density above char threshold)', hasRule(zhDense, 'cn-ai-connectives'), JSON.stringify(zhDense.hits.map((h) => h.snippet)))
}

console.log('=== 11. v0.3.1 rebuttal 中 thank 不报 ===')
{
  const r = auditText(
    'We would like to thank the reviewer for this helpful comment. We have addressed all concerns in the revised manuscript.',
    { profile: 'rebuttal' },
  )
  check('it-should-be-noted TN (thank in rebuttal)', !hasRule(r, 'it-should-be-noted'), JSON.stringify(r.hits.map((h) => h.ruleId)))
}

console.log('=== 12. v0.3.1 evidence 传播到 Hit ===')
{
  const r = auditText(
    'The revised model uses ΔP.',
    { profile: 'manuscript' },
  )
  const hit = r.hits.find((h) => h.ruleId === 'revised-family')
  check('evidence propagated to hit', !!hit?.evidence && hit.evidence.type === 'style-guide', JSON.stringify(hit?.evidence))
}

console.log('')
console.log(`结果：${pass} 通过 / ${fail} 失败`)
if (fail > 0) {
  console.log('失败明细：')
  for (const f of failures) console.log('  -', f)
  process.exit(1)
}
console.log('ALL TESTS PASSED')
