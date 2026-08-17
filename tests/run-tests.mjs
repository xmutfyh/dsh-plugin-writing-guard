// -*- coding: utf-8 -*-
/**
 * writing-guard 回归测试：真实语料 TP/TN 检查（无需测试框架，node 直接跑）。
 * 目标：每条核心规则至少有一个 true-positive 和一个 true-negative 断言。
 * 运行：node tests/run-tests.mjs
 */
import { auditText, detectDocumentProfile, filterReport, hitFingerprint, diffAudit, serializeFingerprints, deserializeFingerprints, diffScholarship, computeStyleProfile, computeJournalProfile, computeJournalProfileFromDocuments, auditJournalFit, splitSentences, cosineSimilarity, tokenizeForSimilarity, extractEpistemicMarkers, diffEpistemic, alignSentences, formatReport, extractClaimSpans, simTier, analyzeParagraphRhythm, analyzeSentenceRhythm, scaffoldSignature, findRepeatedScaffolds, findPunctuationOverloads, findCoinedFrameworks, findGenericClaims, parseBibText, checkCitationIntegrity } from '../lib/rules.js'
import { isPaperFile, baselineByteSize, pruneBaselines } from '../lib/index.js'
import fs from 'node:fs'
import path from 'node:path'

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

console.log('=== 10. v0.3.1 中文 density（按字符计，拆 minCount/density 双 gate）===')
{
  // gate 1 — minCount TN：密度极高，但次数 < 8（GPT：原测试注释写错，实际只验证了 minCount gate）
  const few = auditText(
    '值得注意的是，众所周知，综上所述，不难发现，与此同时。',
    { profile: 'manuscript' },
  )
  check('cn-ai-connectives minCount TN (5 hits < 8, density high)', !hasRule(few, 'cn-ai-connectives'), JSON.stringify(few.hits.map((h) => h.ruleId)))

  // gate 2 — density TN：次数 >= 8，但文本足够长使 perK < 2.0/千字符
  // 8 次套话分散在 ~5000 字填充文本里（8/5000*1000 = 1.6 < 2）
  const filler = Array(200).fill('该方法在实验条件下表现出良好的性能与稳定性，结果支持后续工程应用。').join('')
  const sparseText = '值得注意的是，众所周知，综上所述，不难发现，与此同时，基于此，随着技术的发展，在当前的背景下。' + filler
  const sparse = auditText(sparseText, { profile: 'manuscript' })
  check('cn-ai-connectives density TN (count>=8 but perK<2)', !hasRule(sparse, 'cn-ai-connectives'), JSON.stringify(sparse.hits.map((h) => h.ruleId)))

  // TP：两个条件同时满足
  const dense = auditText(
    '值得注意的是，众所周知，综上所述，不难发现，与此同时，基于此，随着技术的发展，在当前的背景下，需要强调的是，值得一提的是，总的来说。',
    { profile: 'manuscript' },
  )
  check('cn-ai-connectives TP (count>=8 AND perK>=2)', hasRule(dense, 'cn-ai-connectives'), JSON.stringify(dense.hits.map((h) => h.snippet)))
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

console.log('=== 13. v0.4 preprocessing：references/code/math/URL 不污染 ===')
{
  // References 里的 "revised" 不应报；代码块里的词不应计入 density
  const doc = [
    '# Title',
    '',
    'The model is evaluated in this study.',
    '',
    '```python',
    'revised = True  # code fence should be stripped',
    '```',
    '',
    'See https://example.com/revised-guide for details.',
    '',
    'References',
    '1. Smith J. A revised approach to drying. 2020.',
    '2. Lee K. Revision of the model. 2021.',
  ].join('\n')
  const r = auditText(doc, { profile: 'manuscript' })
  check('preprocess: no revised-family hit from code/URL/references', !hasRule(r, 'revised-family'), JSON.stringify(r.hits.map((h) => h.snippet).slice(0, 3)))
  check('preprocess: prose words exclude references', r.stats.englishWords < 20, `words=${r.stats.englishWords}`)
}

console.log('=== 14. stats 与规则同源（transition 计数包含扩展短语）===')
{
  // llm-transition-overuse pattern 含 "in today's / when it comes to / a wide range of"，
  // 旧 countLlTransition 只数 moreover 等 8 个 → stats 应匹配新 pattern
  const doc = [
    'Moreover, the method works.',
    'When it comes to scaling, the approach is robust.',
    'In today\'s context, the results matter.',
    'A wide range of applications exist.',
    'It is worth mentioning that the cost is low.',
    'In conclusion, we summarize. Furthermore, we extend. Additionally, we verify.',
  ].join('\n')
  const r = auditText(doc, { profile: 'manuscript' })
  // 8 个以上过渡词：pattern 计数应 >= 8（旧实现只数 3 个）
  check('stats.transitionCount uses rule pattern (>=8)', r.stats.transitionCount >= 8, `transitionCount=${r.stats.transitionCount}`)
}

console.log('=== 15. v0.3.3 P0：density 规则也用 preprocessing 后的 prose ===')
{
  // GPT P0：density 分支曾用 raw text——code fence/References 里的 delve/moreover/破折号不应触发 density 规则
  const doc = [
    'Normal manuscript prose.',
    '',
    '```',
    'delve delve delve delve delve delve',
    'moreover moreover moreover moreover moreover moreover moreover moreover',
    '— — — — — —',
    '```',
    '',
    'References',
    'Smith. A delve into drying. Moreover, the model. — dash.',
  ].join('\n')
  const r = auditText(doc, { profile: 'manuscript' })
  check('preprocess excludes non-prose from density rules (llm-verb-noun)', !hasRule(r, 'llm-verb-noun-overuse'), JSON.stringify(r.hits.map((h) => h.ruleId)))
  check('preprocess excludes non-prose from density rules (em-dash)', !hasRule(r, 'em-dash-density'), JSON.stringify(r.hits.map((h) => h.ruleId)))
}

console.log('=== 16. v0.3.3 language-aware denominator（双语文件不互相稀释）===')
{
  // 英文规则用英文词数做分母：1000 英文词 + 大量中文，delve 3 次 → 3/1000*1000=3.0 ≥0.4 报警
  const en = auditText(
    'We delve into the tapestry of the method. This is a testament to our approach. The realm of this work is broad.' +
      ' 中文填充' + '的'.repeat(2000),
    { profile: 'manuscript' },
  )
  check('en rule denominator = englishWords only (not diluted by zh)', hasRule(en, 'llm-verb-noun-overuse'), JSON.stringify(en.hits.map((h) => h.ruleId)))

  // 中文规则用 CJK 字数做分母：8 个套话 + 2000 字 → 8/2000*1000=4.0 ≥2.0 报警
  const zh = auditText(
    '值得注意的是，众所周知，综上所述，不难发现，与此同时，基于此，随着技术的发展，在当前的背景下。' + '中'.repeat(2000),
    { profile: 'manuscript' },
  )
  check('zh rule denominator = cjkChars (per 千字)', hasRule(zh, 'cn-ai-connectives'), JSON.stringify(zh.hits.map((h) => h.ruleId)))
}

console.log('=== 17. v0.3.3 References 检测扩展（# References / \section / thebibliography）===')
{
  const md = [
    'The method is described.',
    '',
    '# References',
    '1. Smith. The revised approach. 2020.',
  ].join('\n')
  const r1 = auditText(md, { profile: 'manuscript' })
  check('# References heading truncated', !hasRule(r1, 'revised-family'), JSON.stringify(r1.hits.map((h) => h.ruleId)))

  const tex = [
    'The method is described.',
    '',
    '\\section{References}',
    'Smith. The revised approach. 2020.',
  ].join('\n')
  const r2 = auditText(tex, { profile: 'manuscript' })
  check('\\section{References} truncated', !hasRule(r2, 'revised-family'), JSON.stringify(r2.hits.map((h) => h.ruleId)))

  const bib = [
    'The method is described.',
    '',
    '\\begin{thebibliography}',
    'Smith. The revised approach. 2020.',
    '\\end{thebibliography}',
  ].join('\n')
  const r3 = auditText(bib, { profile: 'manuscript' })
  check('\\begin{thebibliography} truncated', !hasRule(r3, 'revised-family'), JSON.stringify(r3.hits.map((h) => h.ruleId)))
}

console.log('=== 18. v0.3.3 Markdown link：保留 anchor text、URL 不进分母 ===')
{
  const doc = [
    'Our method [is described here](https://example.com/revised-guide) and works well.',
  ].join('\n')
  const r = auditText(doc, { profile: 'manuscript' })
  // anchor text 保留 → "described here" 应计入 prose；URL 中的 "revised" 不应命中
  check('markdown link URL stripped (no revised hit from URL)', !hasRule(r, 'revised-family'), JSON.stringify(r.hits.map((h) => h.ruleId)))
  check('markdown link anchor words counted in prose', r.stats.englishWords >= 7, `words=${r.stats.englishWords}`)
}

console.log('=== 19. v0.4 segment pipeline：规则只扫声明的 segment 类型 ===')
{
  const doc = [
    '# Introduction',
    '',
    'The model is described in this paper.',
    '',
    '# Methods: Overview and Setup',
    'We use the proposed approach.',
    '',
    '# Results and Discussion',
    'The outcome is significant.',
  ].join('\n')
  const r = auditText(doc, { profile: 'manuscript' })
  // colon-title 只扫 heading：'# Methods: Overview and Setup' 是冒号标题 → 1 个 heading 含冒号
  // 但 minCount=3 阈值不满足 → 不报；验证 stats.colonTitleCount 只计 heading
  check('colon-title stats counts headings only', r.stats.colonTitleCount === 1, `colonTitleCount=${r.stats.colonTitleCount}`)
  // 正文中的冒号句不应被 colon-title 统计
  const doc2 = [
    '# Title',
    '',
    'The method: it works well in practice. Another colon: still prose.',
  ].join('\n')
  const r2 = auditText(doc2, { profile: 'manuscript' })
  check('colon-title ignores prose colons', r2.stats.colonTitleCount === 0, `colonTitleCount=${r2.stats.colonTitleCount}`)
}

console.log('=== 20. v0.4 section detection + limitations-across-sections 跨章节 ===')
{
  // 局限分散在 ≥3 章节 → 报
  const doc = [
    '# Introduction',
    'The limitations of prior work are known.',
    '# Methods',
    'This method has limitations in generalization.',
    '# Results',
    'Results show limited applicability.',
    '# Discussion',
    'The study has several limitations as discussed.',
  ].join('\n')
  const r = auditText(doc, { profile: 'manuscript' })
  check('limitations-across-sections TP (>=3 sections)', hasRule(r, 'limitations-across-sections'), JSON.stringify(r.hits.map((h) => h.ruleId)))

  // 局限只在 Discussion → 不报（ICMJE 正当）
  const ok = auditText(
    [
      '# Introduction',
      'Prior work is reviewed.',
      '# Discussion',
      'This study has several limitations. First, sample size. Second, single lab. These limitations should be considered.',
    ].join('\n'),
    { profile: 'manuscript' },
  )
  check('limitations-across-sections TN (discussion only, ICMJE-appropriate)', !hasRule(ok, 'limitations-across-sections'), JSON.stringify(ok.hits.map((h) => h.ruleId)))
}

console.log('=== 21. v0.4 segment 类型：code/math/table 不进入 prose ===')
{
  const doc = [
    'The method works.',
    '',
    '| col1 | col2 |',
    '|------|------|',
    '| a    | b    |',
    '',
    '$$E = mc^2$$',
    '',
    '```python',
    'x = 1',
    '```',
  ].join('\n')
  const r = auditText(doc, { profile: 'manuscript' })
  // table/math/code 不产生 prose 命中；统计只含 'The method works.'
  check('table/math/code excluded from prose words', r.stats.englishWords <= 5, `words=${r.stats.englishWords}`)
  check('table/math/code no false hits', r.summary.total === 0, JSON.stringify(r.hits.map((h) => h.ruleId)))
}

console.log('=== 22. v0.5 incremental lint：指纹 + 增量 diff ===')
{
  // 指纹稳定：同一条问题在不同段落位置（编辑导致行号变化）指纹一致
  const a = auditText('The revised model uses ΔP.', { profile: 'manuscript' })
  const b = auditText('Intro text.\n\nThe revised model uses ΔP.', { profile: 'manuscript' })
  const fa = a.hits.find((h) => h.ruleId === 'revised-family')
  const fb = b.hits.find((h) => h.ruleId === 'revised-family')
  check('fingerprint stable across paragraph shifts', fa && fb && hitFingerprint(fa) === hitFingerprint(fb), `a=${fa && hitFingerprint(fa)} b=${fb && hitFingerprint(fb)}`)

  // diff：修复一项 → added 1 / resolved 1 / remaining 1
  // （文本避免希腊字母 Δ——v0.6 format-unicode-math 会额外命中，干扰计数断言）
  const v1 = auditText('The revised model uses the new objective. This study has limitations in generalization.', { profile: 'manuscript' })
  const prev = new Set(v1.hits.map((h) => hitFingerprint(h)))
  const v2 = auditText('The model uses the new objective. We do not claim superiority. This study has limitations in generalization.', { profile: 'manuscript' })
  const diff = diffAudit(prev, v2.hits)
  check('diff: added detected', diff.added.some((h) => h.ruleId === 'we-do-not-claim'), JSON.stringify(diff.added.map((h) => h.ruleId)))
  check('diff: resolved counted', diff.resolved.length === 1, `resolved=${diff.resolved.length}`)
  check('diff: remaining correct', diff.remaining === 1, `remaining=${diff.remaining}`)

  // 无变化 → 0/0（不注入）
  const diff0 = diffAudit(prev, v1.hits)
  check('diff: no-change is empty', diff0.added.length === 0 && diff0.resolved.length === 0)

  // 序列化往返
  const ser = serializeFingerprints(prev)
  const de = deserializeFingerprints(ser)
  check('serialize/deserialize roundtrip', de.size === prev.size && [...de].every((x) => prev.has(x)))
  check('deserialize rejects non-array', deserializeFingerprints('nope').size === 0)
}

console.log('=== 23. v0.5.1 P0：单行 $$...$$ 不吞正文 ===')
{
  // GPT：$$E = mc^2$$ 单行闭合后，后续正文必须仍被扫描
  const doc = [
    '$$E = mc^2$$',
    '',
    'The revised manuscript now includes additional experiments.',
  ].join('\n')
  const r = auditText(doc, { profile: 'manuscript' })
  check('single-line $$ closed, following prose still scanned', hasRule(r, 'revised-family'), JSON.stringify(r.hits.map((h) => h.ruleId)))
}

console.log('=== 24. v0.5.1 P0：density fingerprint 稳定（不随分母变化）===')
{
  // density hit 指纹 = aggregate::ruleId：加一段正常文字改变分母后，指纹不变
  const v1 = auditText(
    'We delve into the tapestry. This is a testament. The realm is broad. The work is a cornerstone of the paradigm. The approach leverages the method. The model harnesses the data. The result showcases the value. The study navigates the field.',
    { profile: 'manuscript' },
  )
  const fp1 = new Set(v1.hits.map((h) => hitFingerprint(h)))
  const v2 = auditText(
    'We delve into the tapestry. This is a testament. The realm is broad. The work is a cornerstone of the paradigm. The approach leverages the method. The model harnesses the data. The result showcases the value. The study navigates the field.' +
      ' Additional normal methods text that increases the denominator without adding new issues. The experiment was repeated three times with consistent results. All measurements were recorded and analyzed.',
    { profile: 'manuscript' },
  )
  const fp2 = new Set(v2.hits.map((h) => hitFingerprint(h)))
  // 分母变化不产生 resolved+added（指纹应完全一致）
  check('density fingerprint stable across denominator change', fp1.size === fp2.size && [...fp1].every((x) => fp2.has(x)),
    `fp1=${[...fp1].join('|')} fp2=${[...fp2].join('|')}`)
}

console.log('=== 25. v0.5.1 heading hierarchy：Discussion 子标题不拆成多个 section ===')
{
  const doc = [
    '# Discussion',
    '',
    '## Sample size',
    'This limitation affects precision.',
    '',
    '## External validity',
    'Another limitation is scope.',
    '',
    '## Measurement',
    'A limitation in measurement exists.',
  ].join('\n')
  const r = auditText(doc, { profile: 'manuscript' })
  // 全部属于 Discussion 一个顶层章节 → 不报（GPT：这正是 README 说不该报警的合理写法）
  check('subheadings stay under top-level section (no false positive)', !hasRule(r, 'limitations-across-sections'), JSON.stringify(r.hits.map((h) => h.ruleId)))
}

console.log('=== 26. v0.5.1 LaTeX 引用命令整体删除（\cite 的 key 不进 prose）===')
{
  const doc = [
    'The method \\cite{smith-revised-2025} and \\ref{revised-model} are described. \\textbf{important result} is shown.',
  ].join('\n')
  const r = auditText(doc, { profile: 'manuscript' })
  // \cite{smith-revised-2025} 里的 "revised" 是 citation key，不应命中；\textbf 的内容保留
  check('latex cite/ref keys stripped (no revised hit)', !hasRule(r, 'revised-family'), JSON.stringify(r.hits.map((h) => h.ruleId)))
  check('latex textbf content kept (important result)', /important result/.test(r.stats.englishWords > 0 ? 'x' : '') || r.stats.englishWords >= 8, `words=${r.stats.englishWords}`)
}

console.log('=== 27. v0.5.2 isPaperFile 词边界（newspaper/synthesis/coverage/paperwork 不再误判）===')
{
  const cwd = 'C:/workspace/proj'
  for (const p of ['C:/workspace/proj/newspaper-notes.md', 'C:/workspace/proj/notes/synthesis-draft.md', 'C:/workspace/proj/doc/coverage-report.md', 'C:/workspace/proj/readme/paperwork.md']) {
    check(`isPaperFile TN: ${p.split('/').pop()}`, !isPaperFile(p, cwd), p)
  }
  for (const p of ['C:/workspace/proj/manuscript/main.md', 'C:/workspace/proj/01_manuscript/ms.tex', 'C:/workspace/proj/notes/revision_notes.md', 'C:/workspace/proj/response_letter.md', 'C:/workspace/proj/修订稿.md', 'C:/workspace/proj/reviewer2_comments.md']) {
    check(`isPaperFile TP: ${p.split('/').pop()}`, isPaperFile(p, cwd), p)
  }
  // 知识库目录前缀匹配（cwd 相对路径）
  check('isPaperFile TP: root-dir prefix (01_manuscript/)', isPaperFile('01_manuscript/draft.md', cwd))
  check('isPaperFile TN: root-dir not matching', !isPaperFile('10_notes/draft.md', cwd))
}

console.log('=== 28. v0.5.2 profile 检测扩展（reviewer2 / my_notes / revision 对齐）===')
{
  check('reviewer2_comments → review', detectDocumentProfile('reviewer2_comments.md') === 'review')
  check('reviewer 2 comments → review', detectDocumentProfile('Reviewer 2 comments.md') === 'review')
  check('my_notes → notes', detectDocumentProfile('my_notes.md') === 'notes')
  check('draft_notes → notes', detectDocumentProfile('draft_notes.md') === 'notes')
  check('revision_notes → manuscript（与 isPaperFile 对齐，不再 unknown）', detectDocumentProfile('revision_notes.md') === 'manuscript')
  check('revision_response → rebuttal', detectDocumentProfile('revision_response.md') === 'rebuttal')
  check('Supplementary_revision_notes → manuscript', detectDocumentProfile('Supplementary_revision_notes.md') === 'manuscript')
  // 原有判定不回退
  check('regression: response_to_reviewers → rebuttal', detectDocumentProfile('response_to_reviewers.md') === 'rebuttal')
  check('regression: systematic_review → manuscript', detectDocumentProfile('systematic_review.md') === 'manuscript')
  check('regression: notes.txt → notes', detectDocumentProfile('notes.txt') === 'notes')
}

console.log('=== 29. v0.5.2 we-have-changed 组合时态 ===')
{
  const r = auditText('We have now updated the methods section entirely. We now have also corrected the abstract.', { profile: 'manuscript' })
  check('"we have now updated" TP', hasRule(r, 'we-have-changed'), JSON.stringify(r.hits.map((h) => h.ruleId)))
  check('two hits in one paragraph both reported', r.hits.filter((h) => h.ruleId === 'we-have-changed').length === 2, JSON.stringify(r.hits.map((h) => h.snippet)))
}

console.log('=== 30. v0.5.2 rule-of-three 大小写不敏感 ===')
{
  const r = auditText('The method is Clear, Concise, and Compelling in its presentation. The style is precise, direct, and vivid overall.', { profile: 'manuscript' })
  // 2 处 < minCount 4 → 不报（阈值规则），但 stats 应计数；用 4 处验证 TP
  const dense = auditText(
    'The method is Clear, Concise, and Compelling in its presentation. The style is precise, direct, and vivid overall. ' +
    'The results are robust, reproducible, and generalizable. The writing is terse, exact, and unadorned.',
    { profile: 'manuscript' },
  )
  check('rule-of-three TP with leading capitals (4+ hits)', hasRule(dense, 'rule-of-three'), JSON.stringify(dense.hits.map((h) => h.snippet)))
  check('rule-of-three counts capitalized lists in stats', r.stats.ruleOfThreeCount >= 2, `count=${r.stats.ruleOfThreeCount}`)
}

console.log('=== 31. v0.5.2 指纹稳定：同段其他文字编辑不产生假 resolved+added ===')
{
  const v1 = auditText('The revised model uses the ΔP regression objective only, and the results are presented in the next section.', { profile: 'manuscript' })
  const v2 = auditText('The revised model uses the ΔP regression objective only, and the results are NOW presented in the following section of the paper.', { profile: 'manuscript' })
  const fp1 = v1.hits.filter((h) => h.ruleId === 'revised-family').map(hitFingerprint)
  const fp2 = v2.hits.filter((h) => h.ruleId === 'revised-family').map(hitFingerprint)
  check('fingerprint unchanged by same-paragraph edits elsewhere', fp1.length === 1 && fp2.length === 1 && fp1[0] === fp2[0], `a=${fp1[0]} b=${fp2[0]}`)
  // v0.6：用全部指纹对比（含 format-unicode 等新规则），同段编辑不应产生任何假 diff
  const diff = diffAudit(new Set(v1.hits.map((h) => hitFingerprint(h))), v2.hits)
  check('diff: no false resolved+added on same-paragraph edit', diff.added.length === 0 && diff.resolved.length === 0, `added=${diff.added.length} resolved=${diff.resolved.length}`)

  // 真正修复后：指纹消失 → resolved（Δ 仍在，format-unicode 指纹不变，不算假解决）
  const fixed = auditText('The model uses the ΔP regression objective only, and the results are presented in the next section.', { profile: 'manuscript' })
  const diff2 = diffAudit(new Set(v1.hits.map((h) => hitFingerprint(h))), fixed.hits)
  check('diff: real fix still resolves', diff2.resolved.length === 1, `resolved=${diff2.resolved.length}`)
}

console.log('=== 32. v0.5.2 同段多处命中全部报告（maxHits 全局上限内）===')
{
  const r = auditText('The revised model is good. The revised method is better. The revised approach is best.', { profile: 'manuscript' })
  const n = r.hits.filter((h) => h.ruleId === 'revised-family').length
  check('3 occurrences in one paragraph → 3 hits', n === 3, `n=${n}`)
  // 指纹各不相同? 相同命中词 → 共享指纹（保守去重），但 hit 都保留
  const fps = new Set(r.hits.filter((h) => h.ruleId === 'revised-family').map(hitFingerprint))
  check('shared fingerprint for identical match text (by design)', fps.size === 1, `fps=${[...fps]}`)
}

console.log('=== 33. v0.5.2 section 基准层级：# 标题 + ## 章节 也能跨章节检测 ===')
{
  // 常见 Markdown 结构：# 论文标题 + ## Introduction/Methods/Results（局限分散 3 章）
  const doc = [
    '# A Study of X',
    'Abstract prose without limitation words.',
    '## Introduction',
    'The limitations of prior work are known.',
    '## Methods',
    'This method has limitations in generalization.',
    '## Results',
    'Results show limited applicability.',
  ].join('\n')
  const r = auditText(doc, { profile: 'manuscript' })
  check('limitations-across-sections TP with # title + ## sections', hasRule(r, 'limitations-across-sections'), JSON.stringify(r.hits.map((h) => h.ruleId)))

  // 反向：## 为章节时，# 下的 H1 不应拆散 section（回归测试 25 的语义保持）
  const ok = auditText(
    ['# Paper', '## Discussion', '### Sample size', 'This limitation affects precision.', '### External validity', 'Another limitation is scope.'].join('\n'),
    { profile: 'manuscript' },
  )
  check('H3 under H2 under H1 stays one section (no false positive)', !hasRule(ok, 'limitations-across-sections'), JSON.stringify(ok.hits.map((h) => h.ruleId)))
}

console.log('=== 34. v0.5.2 References 后的 Appendix 不再被吞 ===')
{
  const doc = [
    'The model is evaluated in this study.',
    '',
    '# References',
    '1. Smith J. A revised approach to drying. 2020.',
    '',
    '## Appendix',
    'The revised model is described in detail here.',
  ].join('\n')
  const r = auditText(doc, { profile: 'manuscript' })
  check('appendix prose after References still scanned (revised hit)', hasRule(r, 'revised-family'), JSON.stringify(r.hits.map((h) => h.snippet)))
  check('references entry itself still excluded', r.hits.filter((h) => h.snippet.includes('A revised approach to drying')).length === 0, JSON.stringify(r.hits.map((h) => h.snippet)))
}

console.log('=== 35. v0.5.2 project-residue 指纹稳定（术语替换才 resolved）===')
{
  const v1 = auditText('The source_map was updated in the pipeline.', { profile: 'manuscript', projectResidueTerms: ['source_map'] })
  const fp1 = v1.hits.filter((h) => h.ruleId === 'project-residue').map(hitFingerprint)
  const v2 = auditText('The source_map was updated in the revised pipeline.', { profile: 'manuscript', projectResidueTerms: ['source_map'] })
  const fp2 = v2.hits.filter((h) => h.ruleId === 'project-residue').map(hitFingerprint)
  check('project-residue fingerprint stable across unrelated edits', fp1.length === 1 && fp2.length === 1 && fp1[0] === fp2[0], `a=${fp1[0]} b=${fp2[0]}`)
  const v3 = auditText('The mapping table was updated in the pipeline.', { profile: 'manuscript', projectResidueTerms: ['source_map'] })
  check('project-residue resolved when term removed', diffAudit(new Set(fp1), v3.hits).resolved.length === 1)
}

console.log('=== 36. v0.6 Scholarship Lock：科研实体前后对比 ===')
{
  // 数字被改：87.3% → 89.1%
  const before = 'Our method reaches an accuracy of 87.3% on the benchmark. See \\cite{smith2024} and Figure 3 for details.'
  const after = 'Our method reaches an accuracy of 89.1% on the benchmark. See \\cite{smith2024} and Figure 3 for details.'
  const r = auditText(after, { profile: 'manuscript', original: before })
  const lock = r.hits.filter((h) => h.ruleId === 'scholarship-lock')
  check('scholarship-lock TP (percent changed)', lock.some((h) => h.snippet.includes('87.3%') && h.snippet.includes('89.1%')), JSON.stringify(lock.map((h) => h.snippet)))
  check('scholarship-lock severity high', lock.length > 0 && lock.every((h) => h.severity === 'high'))

  // 引用消失：\cite 被删
  const after2 = 'Our method reaches an accuracy of 87.3% on the benchmark. See Figure 3 for details.'
  const r2 = auditText(after2, { profile: 'manuscript', original: before })
  check('scholarship-lock TP (cite removed)', r2.hits.some((h) => h.ruleId === 'scholarship-lock' && h.label.includes('消失') && h.snippet.includes('smith2024')), JSON.stringify(r2.hits.filter((h) => h.ruleId === 'scholarship-lock').map((h) => h.snippet)))

  // 无变化 → 不报
  const r3 = auditText(before, { profile: 'manuscript', original: before })
  check('scholarship-lock TN (no change)', !r3.hits.some((h) => h.ruleId === 'scholarship-lock'))

  // 纯语言润色（不动数字/引用）→ 不报
  const polished = 'Our method attains an accuracy of 87.3% on the benchmark. See \\cite{smith2024} and Figure 3 for details.'
  const r4 = auditText(polished, { profile: 'manuscript', original: before })
  check('scholarship-lock TN (pure wording change)', !r4.hits.some((h) => h.ruleId === 'scholarship-lock'))
}

console.log('=== 37. v0.6 防御饱和：hedge 密度 + 限定词堆叠 ===')
{
  // 密度 TP：每句都挂 caveat
  const dense = auditText(
    'This result may suggest a trend. The effect could possibly be small. These findings might indicate a mechanism. We cannot rule out alternative explanations. The data may potentially reflect noise. The pattern could perhaps be spurious.',
    { profile: 'manuscript' },
  )
  check('hedge-density-en TP (5+ hedges, >=300/千句)', hasRule(dense, 'hedge-density-en'), JSON.stringify(dense.hits.map((h) => h.ruleId)))

  // 密度 TN：少量正常 hedge
  const sparse = auditText('The results may suggest an association, but further work is needed. The mechanism remains unclear.', { profile: 'manuscript' })
  check('hedge-density-en TN (1 hedge)', !hasRule(sparse, 'hedge-density-en'))

  // hedge-stacking TP
  const stack = auditText('These results may potentially suggest that the model generalizes. This could possibly indicate overfitting.', { profile: 'manuscript' })
  check('hedge-stacking TP (may potentially suggest)', hasRule(stack, 'hedge-stacking'), JSON.stringify(stack.hits.map((h) => h.ruleId)))

  // hedge-stacking TN：正常 "may well be"
  const ok = auditText('This may well be the reason for the observed pattern.', { profile: 'manuscript' })
  check('hedge-stacking TN (may well be)', !hasRule(ok, 'hedge-stacking'), JSON.stringify(ok.hits.map((h) => h.ruleId)))
}

console.log('=== 38. v0.6 超长句 + 从句堆叠（英文）===')
{
  const long = auditText(
    'The proposed framework integrates a transformer encoder that processes long sequences, which are augmented with positional embeddings that encode relative distances, while the decoder attends to the memory states that are produced by the encoder, because attention alone cannot capture all dependencies that span the entire input sequence, thereby requiring the additional mechanism that we introduce in this section that addresses the limitation. ' +
    'The second contribution concerns the training objective, which combines a masked language modeling loss with a contrastive component that aligns representations across domains, and we demonstrate that this hybrid objective improves transfer performance on all downstream tasks that we evaluate, because the alignment term provides a regularizing signal that stabilizes training.',
    { profile: 'manuscript' },
  )
  check('overlong-sentence-en TP (>35 words + >=3 clause markers, 2 sentences)', hasRule(long, 'overlong-sentence-en'), JSON.stringify(long.hits.map((h) => h.snippet)))

  const normal = auditText('We evaluate the model on three benchmarks and compare it against recent baselines. The results are summarized in Table 2 and discussed in the next section.', { profile: 'manuscript' })
  check('overlong-sentence-en TN (normal sentences)', !hasRule(normal, 'overlong-sentence-en'), JSON.stringify(normal.hits.map((h) => h.ruleId)))
}

console.log('=== 39. v0.6 超长句（中文）===')
{
  const longZh = auditText(
    '该方法在多个数据集上进行了充分的实验验证，其中每个数据集都包含不同的样本规模与分布特征，同时我们还进一步对比了多种基线方法，从而全面评估了模型的泛化能力，因此我们认为该方案具有良好的实际应用价值，并且可以推广到更广泛的场景中，这意味着该方法具备较强的鲁棒性。' +
    '另一方面我们考察了训练效率，其中批大小与学习率都经过细致的调参，同时我们进一步分析了收敛曲线，从而确认了优化过程的稳定性，因此可以认为训练方案是可靠的，并且适合大规模部署，这意味着工程风险较低。',
    { profile: 'manuscript' },
  )
  check('overlong-sentence-zh TP (2 long sentences)', hasRule(longZh, 'overlong-sentence-zh'), JSON.stringify(longZh.hits.map((h) => h.snippet)))
}

console.log('=== 40. v0.6 重复绕圈（restatement loop）===')
{
  const loop = auditText(
    'The method performs well on this task. Our approach performs well on this task. The proposed model performs well on this task. We report runtime overhead.',
    { profile: 'manuscript' },
  )
  check('restatement-loop TP (3 high-overlap sentences, no new evidence)', hasRule(loop, 'restatement-loop'), JSON.stringify(loop.hits.map((h) => h.snippet.slice(0, 80))))

  const distinct = auditText(
    'The method outperforms the baseline by 12%. The runtime is 3.2 seconds. The implementation is open source.',
    { profile: 'manuscript' },
  )
  check('restatement-loop TN (each sentence adds evidence)', !hasRule(distinct, 'restatement-loop'), JSON.stringify(distinct.hits.map((h) => h.snippet.slice(0, 60))))
}

console.log('=== 41. v0.6 Author Style Profile：句长漂移 ===')
{
  // 作者历史：中长句风格（median ~10-12）
  const profile = computeStyleProfile(
    'This result supports the main hypothesis of our study. The data were collected across three independent laboratories. We compared the proposed method with two standard baselines. The analysis controls for the demographic variables of interest. Our findings remain consistent under all robustness checks. The limitations section discusses potential sources of bias. We expect this approach to generalize to related tasks. The supplementary material contains all implementation details.',
  )
  // 当前稿件：全部超长句（median 显著偏离）
  const draft = auditText(
    'The proposed framework integrates a transformer encoder that processes long sequences, which are augmented with positional embeddings that encode relative distances, while the decoder attends to the memory states that are produced by the encoder, because attention alone cannot capture all dependencies that span the entire input sequence, thereby requiring the additional mechanism that we introduce in this section that addresses the limitation. ' +
    'The second contribution concerns the training objective, which combines a masked language modeling loss with a contrastive component that aligns representations across domains, and we demonstrate that this hybrid objective improves transfer performance on all downstream tasks that we evaluate, because the alignment term provides a regularizing signal that stabilizes training. ' +
    'Finally we present an extensive ablation study that isolates each design choice, showing that the encoder depth and the positional scheme contribute most of the observed gains, while the remaining components add only marginal value, and we argue that this decomposition clarifies which parts of the architecture are actually necessary. ' +
    'The code is available online. The data are public.',
    { profile: 'manuscript', styleProfile: profile },
  )
  check('style-profile-drift TP (long sentences vs author profile)', hasRule(draft, 'style-profile-drift'), JSON.stringify(draft.hits.map((h) => h.snippet.slice(0, 90))))
  check('profile median computed', profile.sentenceLengthMedian > 0 && profile.sentenceLengthStd >= 0)

  // 与自身风格一致 → 不报
  const same = auditText('This result supports the main hypothesis of our study. The data were collected across three independent laboratories. We compared the proposed method with two standard baselines.', { profile: 'manuscript', styleProfile: profile })
  check('style-profile-drift TN (same style)', !hasRule(same, 'style-profile-drift'), JSON.stringify(same.hits.map((h) => h.ruleId)))
}

console.log('=== 42. v0.6 Unicode 数学符号（LaTeX 格式完整性）===')
{
  const r = auditText('The coefficient α₁ = 0.85 with β₂ = 0.12 was estimated. We then compute x₁ + x₂.', { profile: 'manuscript' })
  check('format-unicode-math TP (subscripts + greek)', hasRule(r, 'format-unicode-math'), JSON.stringify(r.hits.map((h) => h.snippet)))
  const ok = auditText('We use standard text without special symbols in this paragraph.', { profile: 'manuscript' })
  check('format-unicode-math TN', !hasRule(ok, 'format-unicode-math'))
}

console.log('=== 43. v0.6 强主张缺证据锚点 ===')
{
  const r = auditText('Our experiments prove that the framework is superior in all settings.', { profile: 'manuscript' })
  check('claim-evidence-proximity TP (strong claim, no anchor)', hasRule(r, 'claim-evidence-proximity'), JSON.stringify(r.hits.map((h) => h.snippet)))

  const anchored = auditText('Our experiments prove that the framework is superior in all settings (p < 0.001, Table 3).', { profile: 'manuscript' })
  check('claim-evidence-proximity TN (p-value nearby)', !hasRule(anchored, 'claim-evidence-proximity'), JSON.stringify(anchored.hits.map((h) => h.ruleId)))
}

console.log('=== 44. v0.6 连续句首连接词 ===')
{
  const r = auditText('Moreover, the model converges faster. Furthermore, it needs less data. Additionally, it is more robust. In conclusion, we recommend it.', { profile: 'manuscript' })
  check('connective-overuse TP (3 consecutive sentence-initial connectives)', hasRule(r, 'connective-overuse'), JSON.stringify(r.hits.map((h) => h.ruleId)))
  const ok = auditText('The model converges faster. Furthermore, the loss decreases. We also observe better robustness.', { profile: 'manuscript' })
  check('connective-overuse TN (not consecutive)', !hasRule(ok, 'connective-overuse'), JSON.stringify(ok.hits.map((h) => h.ruleId)))
}

console.log('=== 45. v0.6 工具函数：句子切分 / 相似度 / profile ===')
{
  const sents = splitSentences('First sentence here. Second one follows! Third ends with a question?')
  check('splitSentences basic', sents.length === 3, JSON.stringify(sents))
  const zh = splitSentences('这是第一句。这是第二句！这是第三句？')
  check('splitSentences zh', zh.length === 3, JSON.stringify(zh))

  const sim = cosineSimilarity(tokenizeForSimilarity('The model improves the accuracy'), tokenizeForSimilarity('The model improves the accuracy'))
  check('cosine identical ~= 1', sim > 0.999, `sim=${sim}`)
  const sim2 = cosineSimilarity(tokenizeForSimilarity('The model improves the accuracy'), tokenizeForSimilarity('The results are unrelated to temperature'))
  check('cosine unrelated < 0.72', sim2 < 0.72, `sim=${sim2}`)

  const prof = computeStyleProfile('Alpha sentence. Beta sentence. Gamma sentence. Delta sentence. Epsilon sentence.')
  check('computeStyleProfile median=2', prof.sentenceLengthMedian === 2, `median=${prof.sentenceLengthMedian}`)

  const d = diffScholarship('accuracy 87.3% and p < 0.05 and \\cite{a} and Table 1', 'accuracy 89.1% and p < 0.05 and \\cite{a} and Table 1')
  check('diffScholarship pairs percent change', d.changed.some((c) => c.type === 'percent' && c.before === '87.3%' && c.after === '89.1%'), JSON.stringify(d.changed))

  const dup = diffScholarship('lengths 5 mm and 5 mm', 'lengths 5 mm and 6 mm')
  check('diffScholarship pairs duplicate-number change', dup.changed.some((c) => c.type === 'number' && c.before === '5 mm' && c.after === '6 mm'), JSON.stringify(dup.changed))

  const dupRemoved = diffScholarship('\\cite{a} and \\cite{a}', '\\cite{a}')
  check('diffScholarship reports duplicate citation removal', dupRemoved.removed.some((r) => r.type === 'cite' && r.value === '\\cite{a}'), JSON.stringify(dupRemoved.removed))
}

console.log('=== 46. v0.7 中文"的"字修饰链（ko5.6sol 借鉴）===')
{
  const tp = auditText(
    '这种基于渗透率模型的预测结果的误差来源的解析，需要结合实验条件进一步分析。',
    { profile: 'manuscript' },
  )
  check('cn-modifier-chain TP (3-layer 的-chain)', hasRule(tp, 'cn-modifier-chain'), JSON.stringify(tp.hits.map((h) => h.snippet)))

  const tn = auditText('该方法的预测结果是可靠的，误差在可接受范围内。', { profile: 'manuscript' })
  check('cn-modifier-chain TN (2-layer only)', !hasRule(tn, 'cn-modifier-chain'), JSON.stringify(tn.hits.map((h) => h.ruleId)))
}

console.log('=== 47. v0.7 平均句长（英 ≤18 词 / 中 ≤25 字）===')
{
  const longEn = auditText(
    'The proposed workflow restricts the analysis to the validated subset of measurements obtained under fully controlled experimental conditions with constant temperature. ' +
    'Furthermore, the resulting predictions are systematically compared against the reference dataset using rigorous error metrics and statistical tests. ' +
    'We observe that the additional complexity introduced by the higher-order correction terms does not translate into measurable improvements.',
    { profile: 'manuscript' },
  )
  check('avg-sentence-length TP (en avg > 18 words)', hasRule(longEn, 'avg-sentence-length'), JSON.stringify(longEn.hits.map((h) => h.snippet)))

  const shortEn = auditText('The method works well. We tested three cases. The results agree. Errors are small.', { profile: 'manuscript' })
  check('avg-sentence-length TN (en short)', !hasRule(shortEn, 'avg-sentence-length'), JSON.stringify(shortEn.hits.map((h) => h.ruleId)))

  const longZh = auditText(
    '该方法基于多孔介质中的盐析机理建立预测模型，并通过微流控实验验证其在不同注入条件下的适用性与可靠性。该框架结合图像分割与物理约束，对裂缝网络中的沉积分布进行逐帧定量表征。实验结果表明，该模型在低流量工况下的预测误差显著小于传统经验公式给出的估计。',
    { profile: 'manuscript' },
  )
  check('avg-sentence-length TP (zh avg > 25 chars)', hasRule(longZh, 'avg-sentence-length'), JSON.stringify(longZh.hits.map((h) => h.snippet)))
}

console.log('=== 48. v0.7 自黑式免责套话 ===')
{
  const tp = auditText(
    '本研究完全基于假数据，该模型毫无意义，结果完全不可靠，不足为凭。',
    { profile: 'manuscript' },
  )
  check('cn-self-defeating TP (假数据/毫无意义/不足为凭)', hasRule(tp, 'cn-self-defeating'), JSON.stringify(tp.hits.map((h) => h.snippet)))

  // TN：模拟数据是正当表述；诚实 limitations（"不完全可靠"）不报警
  const ok = auditText(
    '本研究基于模拟数据开展敏感性分析；由于样本量有限，结果可能不完全可靠，仍需进一步验证。',
    { profile: 'manuscript' },
  )
  check('cn-self-defeating TN (simulated data / honest limitation)', !hasRule(ok, 'cn-self-defeating'), JSON.stringify(ok.hits.map((h) => h.ruleId)))
}

console.log('=== 49. v0.7 空洞热词密度（密度门控，术语不误伤）===')
{
  const en = auditText(
    'The robust method is crucial for the robust performance. Our robust framework exhibits robust behavior, and a tailored approach is imperative. The robust results substantially improve the robust baseline.',
    { profile: 'manuscript' },
  )
  check('llm-buzzword-en TP (5+ robust-family)', hasRule(en, 'llm-buzzword-en'), JSON.stringify(en.hits.map((h) => h.snippet)))

  const enSparse = auditText('The robust regression was fitted to the data. Robustness analysis confirmed stability.', { profile: 'manuscript' })
  check('llm-buzzword-en TN (term usage, low count)', !hasRule(enSparse, 'llm-buzzword-en'), JSON.stringify(enSparse.hits.map((h) => h.ruleId)))

  const zh = auditText(
    '该机制的动态演化与耦合协同范式，支撑了多维度的精细化解耦与稳健的拓扑重构。机制、耦合与动态的协同，是范式升级的维度支撑；拓扑与解耦的全流程，需要精细化机制协同。',
    { profile: 'manuscript' },
  )
  check('cn-buzzword-density TP (10+ abstract nouns)', hasRule(zh, 'cn-buzzword-density'), JSON.stringify(zh.hits.map((h) => h.snippet)))

  const zhSparse = auditText('该耦合机制对裂缝中的动态盐析过程具有支撑作用。', { profile: 'manuscript' })
  check('cn-buzzword-density TN (domain terms, low count)', !hasRule(zhSparse, 'cn-buzzword-density'), JSON.stringify(zhSparse.hits.map((h) => h.ruleId)))
}

console.log('=== 50. v0.7 词表并入（ko5.6sol 过渡词，密度门控不变）===')
{
  const en = auditText(
    'Consequently, the results differ. Thus, we conclude that the effect persists. Hence, the model fails on this subset. Additionally, more data is needed. Moreover, we repeated the runs. Therefore, the outcome changed. Accordingly, we updated the protocol. To this end, we revised the code. Notably, the trend remains stable.',
    { profile: 'manuscript' },
  )
  check('llm-transition-overuse TP (consequently/thus/hence merged)', hasRule(en, 'llm-transition-overuse'), JSON.stringify(en.hits.map((h) => h.snippet)))

  const zh = auditText(
    '由此可见，进一步的研究表明，毫无疑问，该方法的优势是显著的。特别地，有鉴于此，也就是说，我们需要重新审视这一问题。综上所述，与此同时，基于此，我们提出了新的框架。',
    { profile: 'manuscript' },
  )
  check('cn-ai-connectives TP (进一步/由此可见 merged)', hasRule(zh, 'cn-ai-connectives'), JSON.stringify(zh.hits.map((h) => h.snippet)))
}

console.log('=== 51. v0.8 Epistemic Lock：主张强度漂移（mutation benchmark）===')
{
  // 单元：ladder 提取
  const m1 = extractEpistemicMarkers('X was associated with Y.')
  check('claim ladder: associated → level 1', m1.claimLevel === 1, `level=${m1.claimLevel}`)
  const m2 = extractEpistemicMarkers('X caused Y.')
  check('claim ladder: caused → level 5', m2.claimLevel === 5, `level=${m2.claimLevel}`)
  const m3 = extractEpistemicMarkers('X was associated with reduced mortality.')
  check('claim ladder: associated-with-descriptor stays level 1', m3.claimLevel === 1, `level=${m3.claimLevel}`)
  const m4 = extractEpistemicMarkers('No significant association was observed.')
  check('negation/null markers extracted', m4.negation && m4.nullResult)

  // 数字没动、结论变了：associated → caused
  const up = auditText('The intervention caused lower mortality.', { profile: 'manuscript', original: 'The intervention was associated with lower mortality.' })
  check('claim-drift TP (association→causation)', hasRule(up, 'claim-drift'), JSON.stringify(up.hits.map((h) => h.snippet)))
  check('claim-drift findingKind=invariant', up.hits.find((h) => h.ruleId === 'claim-drift')?.findingKind === 'invariant')

  // 变弱同样是科学变化（polishing 不得改变 science，无论方向）
  const down = auditText('The intervention may be associated with lower mortality.', { profile: 'manuscript', original: 'The intervention reduced mortality.' })
  check('claim-drift TP (downward weakening)', hasRule(down, 'claim-drift'), JSON.stringify(down.hits.map((h) => h.snippet)))

  // TN：同层润色（描述性分词互换不升级）
  const same = auditText('The intervention was associated with reduced mortality.', { profile: 'manuscript', original: 'The intervention was associated with lower mortality.' })
  check('claim-drift TN (same level, descriptor swap)', !hasRule(same, 'claim-drift'), JSON.stringify(same.hits.map((h) => h.ruleId)))

  // 句对齐工具
  const pairs = alignSentences(['Alpha beta gamma delta.'], ['Alpha beta gamma delta and more.'])
  check('alignSentences finds pair', pairs.length === 1 && pairs[0].sim > 0.5, JSON.stringify(pairs))
}

console.log('=== 52. v0.8 否定 / 零结果 / scope 守恒 ===')
{
  const neg = auditText('A significant association was observed between the variables.', { profile: 'manuscript', original: 'No significant association was observed between the variables.' })
  check('negation-drift TP (negation removed)', hasRule(neg, 'negation-drift'), JSON.stringify(neg.hits.map((h) => h.snippet)))

  const nullR = auditText('The treatment improved recovery rates in the cohort.', { profile: 'manuscript', original: 'The treatment did not improve recovery rates in the cohort.' })
  check('negation-drift TP (null result removed)', hasRule(nullR, 'negation-drift'), JSON.stringify(nullR.hits.map((h) => h.ruleId)))

  const scope = auditText('The effect was small.', { profile: 'manuscript', original: 'Among participants in this study, the effect was small.' })
  check('scope-drift TP (scope boundary removed)', hasRule(scope, 'scope-drift'), JSON.stringify(scope.hits.map((h) => h.snippet)))

  const keep = auditText('Among participants in this study, the effect was small and consistent.', { profile: 'manuscript', original: 'Among participants in this study, the effect was small.' })
  check('scope-drift TN (scope preserved)', !hasRule(keep, 'scope-drift'), JSON.stringify(keep.hits.map((h) => h.ruleId)))

  // 中文 scope 标记
  const zhScope = auditText('盐析速率显著降低。', { profile: 'manuscript', original: '在本实验中，盐析速率显著降低。' })
  check('scope-drift TP (zh scope removed)', hasRule(zhScope, 'scope-drift'), JSON.stringify(zhScope.hits.map((h) => h.snippet)))
}

console.log('=== 53. v0.8 findingKind 分类 + 科学完整性回归报告 ===')
{
  const r = auditText(
    'The revised model uses the ΔP objective. We do not claim that the association is causal. 本研究完全基于假数据。',
    { profile: 'manuscript' },
  )
  const kindOf = (id) => r.hits.find((h) => h.ruleId === id)?.findingKind
  check('revised-family → violation', kindOf('revised-family') === 'violation', JSON.stringify(r.hits.map((h) => [h.ruleId, h.findingKind])))
  check('we-do-not-claim → candidate', kindOf('we-do-not-claim') === 'candidate')
  check('cn-self-defeating → violation', kindOf('cn-self-defeating') === 'violation')

  const inv = auditText('The intervention caused lower mortality.', { profile: 'manuscript', original: 'The intervention was associated with lower mortality.' })
  check('claim-drift → invariant', inv.hits.find((h) => h.ruleId === 'claim-drift')?.findingKind === 'invariant')

  // 完整性回归摘要 + 报告块（0 命中也显示）
  const int = auditText('The accuracy improved to 92.1%.', { profile: 'manuscript', original: 'The accuracy improved to 89.1%.' })
  check('integrity.numericChanged > 0', (int.integrity?.numericChanged ?? 0) > 0, JSON.stringify(int.integrity))
  const txt = formatReport(int)
  check('formatReport shows integrity regression block', txt.includes('科学完整性回归'), txt.slice(0, 400))

  const ok = auditText('The accuracy improved to 89.1%.', { profile: 'manuscript', original: 'The accuracy improved to 89.1%.' })
  check('integrity all-preserved (0 drift, 0 hits)', (ok.integrity?.numericChanged ?? 99) === 0 && ok.summary.total === 0, JSON.stringify(ok.integrity))
}

console.log('=== 54. v0.9 双轴模型 + 子句级多主张（ClaimSpan）===')
{
  // 因果力 / 证据力拆分："confirmed an association" 不是因果 L5
  const spans = extractClaimSpans('The analysis confirmed an association between X and Y.')
  check('two-axis: confirmed-an-association = causal 1 + evidential 6', spans.length === 1 && spans[0].causalLevel === 1 && spans[0].evidentialLevel === 6, JSON.stringify(spans))

  // 多主张句：整句 max level 曾掩盖 Y 的漂移（v0.8 结构性漏报）
  const multi = auditText(
    'X caused A, while Y caused B.',
    { profile: 'manuscript', original: 'X caused A, while Y may be associated with B.' },
  )
  check('multi-claim drift TP (Y: association→causation in clause 2)', hasRule(multi, 'claim-drift'), JSON.stringify(multi.hits.map((h) => h.snippet)))

  // 证据力漂移：suggested → confirmed
  const evi = auditText(
    'The analysis confirmed an association between X and Y.',
    { profile: 'manuscript', original: 'The analysis suggested an association between X and Y.' },
  )
  const eviHit = evi.hits.find((h) => h.ruleId === 'claim-drift')
  check('evidential drift TP (suggested→confirmed, axis=evidential)', hasRule(evi, 'claim-drift') && eviHit?.label.includes('证据力'), JSON.stringify(eviHit?.snippet))

  // hedge 移除 = 证据力抬高（-1 → 0）
  const hedge = auditText(
    'X is associated with Y.',
    { profile: 'manuscript', original: 'X may be associated with Y.' },
  )
  check('hedge removal TP (may → none, evidential drift)', hasRule(hedge, 'claim-drift'), JSON.stringify(hedge.hits.map((h) => h.snippet)))

  // 子句切分工具
  const clauses = extractClaimSpans('X caused A, while Y may be associated with B.')
  check('extractClaimSpans splits clauses', clauses.length === 2 && clauses[0].causalLevel === 5 && clauses[1].causalLevel === 1, JSON.stringify(clauses.map((c) => [c.clause, c.causalLevel])))
}

console.log('=== 55. v0.9 对齐相似度分档（0.70/0.55/0.45）===')
{
  check('simTier 0.80 → high/invariant', simTier(0.8).confidence === 'high' && simTier(0.8).kind === 'invariant' && simTier(0.8).severity === 'high')
  check('simTier 0.60 → medium/invariant', simTier(0.6).confidence === 'medium' && simTier(0.6).kind === 'invariant')
  check('simTier 0.45 → low/candidate', simTier(0.45).confidence === 'low' && simTier(0.45).kind === 'candidate' && simTier(0.45).severity === 'medium')

  // 低相似度安全：整句重写（cosine < 0.45）不产生假漂移
  const rewritten = auditText(
    'Our findings prove the intervention works in practice.',
    { profile: 'manuscript', original: 'The experiment demonstrated a clear improvement across all tested conditions.' },
  )
  check('low-sim rewrite → no false claim-drift', !hasRule(rewritten, 'claim-drift'), JSON.stringify(rewritten.hits.map((h) => h.ruleId)))
}

console.log('=== 56. v0.9 基线 UTF-8 字节核算 + 淘汰 ===')
{
  // 中文 3 字节/字（content.length 会算成 1）
  check('baselineByteSize zh = 3 bytes/char', baselineByteSize('中') === 3, `bytes=${baselineByteSize('中')}`)
  check('baselineByteSize en = 1 byte/char', baselineByteSize('abc') === 3, `bytes=${baselineByteSize('abc')}`)

  // 淘汰：总量超限时删除最旧
  const map = new Map([
    ['a.md', { content: 'x'.repeat(1000), ts: 1 }],
    ['b.md', { content: 'y'.repeat(1000), ts: 2 }],
    ['c.md', { content: 'z'.repeat(1000), ts: 3 }],
  ])
  // 注入一个小总量上限场景无法直接改常量；改为验证 prune 对文件数上限（20）的行为：
  const many = new Map()
  for (let i = 0; i < 25; i++) many.set(`f${i}.md`, { content: 'abc', ts: i })
  pruneBaselines(many)
  check('pruneBaselines caps at 20 files', many.size === 20, `size=${many.size}`)
  check('pruneBaselines evicts oldest first', !many.has('f0.md') && many.has('f24.md'))
}

console.log('=== 57. v0.9.1 establish+基建名词（建立≠证明）上下文排除 ===')
{
  // 实测发现：pore-scale 论文 "a baseline (M1) is established without images" 误报——
  // "establish a baseline/protocol/framework" 是"建立"，不是"证明"
  const baseline = auditText(
    'First, a temperature--flow-rate--progress baseline (M1) is established without images. Second, a causal image-only baseline (M2) is used.',
    { profile: 'manuscript' },
  )
  check('claim-evidence-proximity TN (establish a baseline)', !hasRule(baseline, 'claim-evidence-proximity'), JSON.stringify(baseline.hits.map((h) => h.snippet)))

  const protocol = auditText('A standardized measurement protocol was established for all experiments.', { profile: 'manuscript' })
  check('claim-evidence-proximity TN (establish a protocol)', !hasRule(protocol, 'claim-evidence-proximity'), JSON.stringify(protocol.hits.map((h) => h.ruleId)))

  // 真正的强主张仍然报警："It is well established that" 是证明性主张
  const strong = auditText('It is well established that X causes Y.', { profile: 'manuscript' })
  check('claim-evidence-proximity TP (well established claim)', hasRule(strong, 'claim-evidence-proximity'), JSON.stringify(strong.hits.map((h) => h.snippet)))
}

console.log('=== 58. v0.9.2 子句级相似度门槛（错位配对不误报）===')
{
  // 实测发现：修订重排子句时，位置配对会把引文子句↔正文子句配成一对，制造假漂移。
  // 子句词面相似度 < 0.3 视为"不是同一主张的两个版本"，跳过 span 级漂移。
  const reordered = auditText(
    'Digital rock representations are widely used, and learning-based studies have shown that permeability can be predicted from pore images.',
    { profile: 'manuscript', original: 'Learning-based studies have shown that permeability can be predicted from pore images, and digital rock representations are widely used.' },
  )
  check('clause-reorder TN (no false drift from positional mispair)', !hasRule(reordered, 'claim-drift'), JSON.stringify(reordered.hits.map((h) => h.snippet)))

  // 真漂移仍然检出（词面相似子句）
  const real = auditText(
    'X caused A, while Y caused B.',
    { profile: 'manuscript', original: 'X caused A, while Y may be associated with B.' },
  )
  check('clause-reorder TP (real drift still fires)', hasRule(real, 'claim-drift'), JSON.stringify(real.hits.map((h) => h.snippet)))
}

console.log('=== 59. v0.9.2 Markdown 引用块不破坏句子切分 ===')
{
  // 实测发现：pandoc 转换的引用块 "pore image.\n>\n> As shown in Figure 4(a)..." 中
  // 句号后跟 '>' 挡住切分前瞻，两句被合并成一句 → 子句配对错位 → 假漂移
  const q = auditText(
    'The input is a causal eight-frame sequence of preprocessed pore images.',
    { profile: 'manuscript', original: 'The input is a preprocessed single-frame pore image.\n>\n> As shown in Figure 4(a), the model first extracts multi-scale morphological features.' },
  )
  check('blockquote sentence boundary preserved (no false drift)', !hasRule(q, 'claim-drift'), JSON.stringify(q.hits.map((h) => h.snippet)))

  const sents = splitSentences('First sentence.\n>\n> Second sentence begins here. Third one.')
  check('splitSentences splits across blockquote markers', sents.length === 3, JSON.stringify(sents))
}

console.log('=== 60. v0.9.3 证据力角色排除（Figure shows / establish baseline ≠ epistemic）===')
{
  // "Figure 4 shows the model architecture" 是展示性描述，不是 epistemic claim
  const fig = auditText(
    'Figure 4 presents the model architecture.',
    { profile: 'manuscript', original: 'Figure 4 shows the model architecture.' },
  )
  check('evidential role TN (Figure shows → presents)', !hasRule(fig, 'claim-drift'), JSON.stringify(fig.hits.map((h) => h.snippet)))

  // "establish a baseline" 是程序性建立
  const bl = auditText(
    'A baseline was defined for each fold.',
    { profile: 'manuscript', original: 'A baseline was established for each fold.' },
  )
  check('evidential role TN (establish a baseline)', !hasRule(bl, 'claim-drift'), JSON.stringify(bl.hits.map((h) => h.snippet)))

  // "confirm receipt" 是程序性确认
  const cfg = auditText(
    'The system confirmed the configuration.',
    { profile: 'manuscript', original: 'The system confirmed the setup.' },
  )
  check('evidential role TN (confirm configuration)', !hasRule(cfg, 'claim-drift'), JSON.stringify(cfg.hits.map((h) => h.snippet)))

  // 真正的证据力漂移仍报：results show → results indicate
  const evi = auditText(
    'The results indicate that X causes Y.',
    { profile: 'manuscript', original: 'The results show that X causes Y.' },
  )
  check('evidential role TP (results show → indicate)', hasRule(evi, 'claim-drift'), JSON.stringify(evi.hits.map((h) => h.snippet)))

  // "It is well established that" 仍是 epistemic
  const well = auditText(
    'It is well established that X causes Y.',
    { profile: 'manuscript', original: 'It is widely believed that X causes Y.' },
  )
  check('evidential role TP (well established claim)', hasRule(well, 'claim-drift'), JSON.stringify(well.hits.map((h) => h.snippet)))
}

console.log('=== 61. v0.9.3 hedge 独立字段（may suggest ≠ suggest）===')
{
  // 动词层相同（1→1），但 hedge 移除 —— 以前检测不到
  const h1 = auditText(
    'The findings suggest X.',
    { profile: 'manuscript', original: 'The findings may suggest X.' },
  )
  check('hedge removal TP (may suggest → suggest)', hasRule(h1, 'claim-drift'), JSON.stringify(h1.hits.map((h) => h.snippet)))

  // hedge 保留 + 动词升级：may suggest → may indicate（1→2）
  const h2 = auditText(
    'The findings may indicate X.',
    { profile: 'manuscript', original: 'The findings may suggest X.' },
  )
  check('evidential verb drift with hedge kept (suggest→indicate)', hasRule(h2, 'claim-drift'), JSON.stringify(h2.hits.map((h) => h.snippet)))

  // 引入 hedge 也报（削弱）
  const h3 = auditText(
    'The findings may suggest X.',
    { profile: 'manuscript', original: 'The findings suggest X.' },
  )
  check('hedge introduction TP (suggest → may suggest)', hasRule(h3, 'claim-drift'), JSON.stringify(h3.hits.map((h) => h.snippet)))
}

console.log('=== 62. v0.9.3 句子级 marker multiset（多主张句不再被布尔掩盖）===')
{
  // 旧逻辑：前半句 "not associated" 保留 → negation=true→true 漏报；multiset 按完整 marker 计数 → "did not" 消失被检出
  const multi = auditText(
    'X was not associated with Y, and Z improved.',
    { profile: 'manuscript', original: 'X was not associated with Y, and Z did not improve.' },
  )
  check('null-result multiset TP (Z did not improve removed)', hasRule(multi, 'negation-drift'), JSON.stringify(multi.hits.map((h) => h.snippet)))

  // scope 部分消失：两个 marker 中 "under these conditions" 没了
  const scope = auditText(
    'In this cohort, X was associated with Y.',
    { profile: 'manuscript', original: 'In this cohort, under these conditions, X was associated with Y.' },
  )
  check('scope multiset TP (under these conditions removed)', hasRule(scope, 'scope-drift'), JSON.stringify(scope.hits.map((h) => h.snippet)))
}

console.log('=== 63. v0.9.3 版本差距过大降级保护（ESR 实测发现）===')
{
  // 全文重写级别差异：行级双锁跳过，只报一条 version-gap（不再输出 171 条噪音）
  const before = 'The first study examined drying kinetics in a porous micromodel under three temperatures. The second study focused on salt precipitation and its effect on permeability evolution. A third line of work considered capillary-driven transport in heterogeneous structures.'
  const after = 'This review synthesizes evidence on fracture self-sealing in caprocks during CO2 geological storage. We organize the literature into four functional levels of sealing recovery. The central question concerns when healing becomes functional closure across scales.'
  const r = auditText(after, { profile: 'manuscript', original: before })
  check('version-gap hit fired', hasRule(r, 'version-gap'), JSON.stringify(r.hits.map((h) => h.ruleId)))
  check('version-gap: no scholarship-lock noise', !hasRule(r, 'scholarship-lock'), JSON.stringify(r.hits.map((h) => h.ruleId)))
  check('version-gap: no claim-drift noise', !hasRule(r, 'claim-drift'), JSON.stringify(r.hits.map((h) => h.ruleId)))

  // 局部修订（高对齐率）不受影响
  const local = auditText(
    'The intervention caused lower mortality.',
    { profile: 'manuscript', original: 'The intervention was associated with lower mortality.' },
  )
  check('version-gap: local revision still locked', !hasRule(local, 'version-gap') && hasRule(local, 'claim-drift'))
}

console.log('=== 64. v1.0 证据状态守恒（Evidence-Status Lock）===')
{
  // "participants reported improvement" → "participants improved"：报告状态消失
  const r1 = auditText(
    'Participants improved after the intervention.',
    { profile: 'manuscript', original: 'Participants reported improvement after the intervention.' },
  )
  check('evidence-status TP (reported removed)', hasRule(r1, 'evidence-status-drift'), JSON.stringify(r1.hits.map((h) => h.snippet)))

  // 状态替换：observed → estimated（模型/观测混淆）
  const r2 = auditText(
    'The estimated rate was 2.1 m/h under these conditions.',
    { profile: 'manuscript', original: 'The observed rate was 2.1 m/h under these conditions.' },
  )
  check('evidence-status TP (observed → estimated)', hasRule(r2, 'evidence-status-drift'), JSON.stringify(r2.hits.map((h) => h.snippet)))

  // 状态引入
  const r3 = auditText(
    'The modelled results suggest a decline.',
    { profile: 'manuscript', original: 'The results suggest a decline.' },
  )
  check('evidence-status TP (modelled introduced)', hasRule(r3, 'evidence-status-drift'), JSON.stringify(r3.hits.map((h) => h.snippet)))

  // TN：状态保持
  const tn = auditText(
    'The measured pressure drop decreased with temperature in this study.',
    { profile: 'manuscript', original: 'The measured pressure drop decreased with temperature in this study.' },
  )
  check('evidence-status TN (unchanged)', !hasRule(tn, 'evidence-status-drift'), JSON.stringify(tn.hits.map((h) => h.ruleId)))

  // integrity 摘要包含证据状态
  const int = auditText(
    'Participants improved after the intervention.',
    { profile: 'manuscript', original: 'Participants reported improvement after the intervention.' },
  )
  check('integrity.evidenceStatusDrift > 0', (int.integrity?.evidenceStatusDrift ?? 0) > 0, JSON.stringify(int.integrity))
}

console.log('=== 65. v1.1 claim-bound markers（标记交换不再被 multiset 掩盖）===')
{
  // 分析核心案例：否定标记在子句间交换——句子级 multiset 两边都是 did not ×1
  const swap = auditText(
    'X improved, but Y did not improve.',
    { profile: 'manuscript', original: 'X did not improve, but Y improved.' },
  )
  check('claim-bound TP (negation swapped between clauses)', hasRule(swap, 'negation-drift'), JSON.stringify(swap.hits.map((h) => h.snippet)))

  // 证据状态交换：observed/estimated 互换
  const esSwap = auditText(
    'X was estimated, while Y was observed.',
    { profile: 'manuscript', original: 'X was observed, while Y was estimated.' },
  )
  check('claim-bound TP (evidence status swapped)', hasRule(esSwap, 'evidence-status-drift'), JSON.stringify(esSwap.hits.map((h) => h.snippet)))
}

console.log('=== 66. v1.1 marker canonicalization（大小写/英美拼写不误报）===')
{
  const caseT = auditText(
    'The observed rate was 2.1 m/h.',
    { profile: 'manuscript', original: 'The Observed rate was 2.1 m/h.' },
  )
  check('canonical TN (Observed → observed)', !hasRule(caseT, 'evidence-status-drift'), JSON.stringify(caseT.hits.map((h) => h.snippet)))

  const spell = auditText(
    'The modeled results suggest a decline.',
    { profile: 'manuscript', original: 'The modelled results suggest a decline.' },
  )
  check('canonical TN (modelled → modeled)', !hasRule(spell, 'evidence-status-drift'), JSON.stringify(spell.hits.map((h) => h.snippet)))
}

console.log('=== 67. v1.1 scopeAdded + Figure shows that 角色 ===')
{
  // scope 新增：一般陈述 → 受限陈述（可能缩窄外部有效性）
  const added = auditText(
    'In this cohort, the treatment improves survival.',
    { profile: 'manuscript', original: 'The treatment improves survival.' },
  )
  check('scope-added TP (general → restricted)', hasRule(added, 'scope-drift'), JSON.stringify(added.hits.map((h) => h.snippet)))

  // "Figure 4 shows that X increases survival" 的 shows that 承担 epistemic claim（v1.1 角色修复）
  const figThat = auditText(
    'Figure 4 suggests that the treatment increases survival.',
    { profile: 'manuscript', original: 'Figure 4 shows that the treatment increases survival.' },
  )
  check('shows-that TP (epistemic role kept despite Figure subject)', hasRule(figThat, 'claim-drift'), JSON.stringify(figThat.hits.map((h) => h.snippet)))

  // "Figure 4 shows the model architecture" 仍是 descriptive
  const figDesc = auditText(
    'Figure 4 presents the model architecture.',
    { profile: 'manuscript', original: 'Figure 4 shows the model architecture.' },
  )
  check('shows-descriptive TN (Figure shows architecture)', !hasRule(figDesc, 'claim-drift'), JSON.stringify(figDesc.hits.map((h) => h.snippet)))
}

console.log('=== 68. v1.1 多轴 delta 单 hit（causal+evidential+hedge 不丢轴）===')
{
  const multi = auditText(
    'The results demonstrate that X causes Y.',
    { profile: 'manuscript', original: 'The results may suggest an association between X and Y.' },
  )
  const h = multi.hits.find((x) => x.ruleId === 'claim-drift')
  check('multi-axis TP (single hit)', hasRule(multi, 'claim-drift'), JSON.stringify(multi.hits.map((x) => x.snippet)))
  // causal(1→5) + evidential(1→5) + hedge(有→无) 三个 delta 都在同一条里
  const snippet = h?.snippet ?? ''
  check('multi-axis deltas preserved', snippet.includes('因果力') && snippet.includes('证据力') && snippet.includes('hedge'), snippet.slice(0, 200))
}

console.log('=== 69. v1.2 raw threshold 不被 subject bonus 绕过 ===')
{
  // 同主语但 raw cosine < 0.3：不得被错误绑成同一 claim（1.1.1 P0）
  const r = auditText(
    'The model was initialized using pretrained weights.',
    { profile: 'manuscript', original: 'The model predicts mortality.' },
  )
  check('raw-threshold TP (same subject, low raw sim → no pairing)', !hasRule(r, 'claim-drift'), JSON.stringify(r.hits.map((h) => h.snippet)))
}

console.log('=== 70. v1.2 alignment-uncertain（未配对受保护主张不退化 sentence bag）===')
{
  const r = auditText(
    'In this cohort, the treatment improved survival, and the follow-up lasted one year.',
    { profile: 'manuscript', original: 'In this cohort, the treatment improved survival, and no adverse events were reported.' },
  )
  check('alignment-uncertain TP (unmatched protected claim)', hasRule(r, 'claim-alignment-uncertain'), JSON.stringify(r.hits.map((h) => h.snippet)))
  // 不得用 after 全句的 marker 假装否定被保留/被删——不产生 negation-drift
  check('alignment-uncertain: no false negation verdict', !hasRule(r, 'negation-drift'), JSON.stringify(r.hits.map((h) => h.ruleId)))
}

console.log('=== 71. v1.2 nullResultAdded 独立 + 双向去重 ===')
{
  const r = auditText(
    'Z did not improve.',
    { profile: 'manuscript', original: 'Z improved.' },
  )
  check('null-added TP (independent event)', hasRule(r, 'negation-drift'), JSON.stringify(r.hits.map((h) => h.label)))
  // "did not" 与 "did not improve" 只报更具体的零结果事件（added 方向也去重）
  const labels = r.hits.filter((h) => h.ruleId === 'negation-drift').map((h) => h.label)
  check('null-added dedup (specific event only)', labels.length === 1 && labels[0].includes('零结果'), JSON.stringify(labels))
}

console.log('=== 72. v1.2 fragment-aware 子句（scope 前缀附着 + 相对从句合并）===')
{
  const withScope = extractClaimSpans('In this cohort, the treatment improved survival.')
  check('scope-prefix attached to claim span', withScope.length === 1 && withScope[0].scopeMarkers.length > 0, JSON.stringify(withScope.map((s) => [s.clause, s.scopeMarkers])))

  const withRelative = extractClaimSpans('The model, which was trained on Dataset A, achieved higher accuracy.')
  check('relative clause merged into main clause', withRelative.length === 1 && withRelative[0].clause.includes('which was trained'), JSON.stringify(withRelative.map((s) => s.clause)))
}

console.log('=== 73. v1.2.1 Scholarship Lock added/removed 全覆盖 ===')
{
  // number removed：5 mg 被删（1.2.1 前只进摘要不进 hit）
  const rm = auditText(
    'The dose was administered.',
    { profile: 'manuscript', original: 'The dose was 5 mg.' },
  )
  check('scholarship number-removed TP', hasRule(rm, 'scholarship-lock'), JSON.stringify(rm.hits.map((h) => h.snippet)))

  // number added：凭空新增 5 mg
  const add = auditText(
    'The dose was 5 mg.',
    { profile: 'manuscript', original: 'The dose was administered.' },
  )
  check('scholarship number-added TP (MEDIUM)', hasRule(add, 'scholarship-lock') && add.hits.find((h) => h.ruleId === 'scholarship-lock')?.severity === 'medium', JSON.stringify(add.hits.map((h) => h.snippet)))

  // DOI 替换
  const doi = auditText(
    'The dataset is archived at 10.5678/new-doi.',
    { profile: 'manuscript', original: 'The dataset is archived at 10.1234/old-doi.' },
  )
  check('scholarship DOI-replacement TP', hasRule(doi, 'scholarship-lock'), JSON.stringify(doi.hits.map((h) => h.snippet)))

  // 引用凭空新增
  const cite = auditText(
    'This was demonstrated previously \\cite{Smith2024}.',
    { profile: 'manuscript', original: 'This was demonstrated previously.' },
  )
  check('scholarship cite-added TP', hasRule(cite, 'scholarship-lock'), JSON.stringify(cite.hits.map((h) => h.snippet)))

  // Figure 新增
  const fig = auditText(
    'Figure 2 shows the results of the experiment.',
    { profile: 'manuscript', original: 'The results of the experiment are reported here.' },
  )
  check('scholarship figure-added TP', hasRule(fig, 'scholarship-lock'), JSON.stringify(fig.hits.map((h) => h.snippet)))
}

console.log('=== 74. v1.2.1 self-report canonical + scope-only 统一分类 ===')
{
  // self reported（空格）vs self-reported（连字符）：同一 canonical，不误报
  const sr = auditText(
    'Participants self reported improvement after the intervention.',
    { profile: 'manuscript', original: 'Participants self-reported improvement after the intervention.' },
  )
  check('self-report canonical TN (space vs hyphen)', !hasRule(sr, 'evidence-status-drift'), JSON.stringify(sr.hits.map((h) => h.snippet)))

  // self-reported vs reported：真状态变化仍报
  const sr2 = auditText(
    'Participants reported improvement after the intervention.',
    { profile: 'manuscript', original: 'Participants self-reported improvement after the intervention.' },
  )
  check('self-report status change TP', hasRule(sr2, 'evidence-status-drift'), JSON.stringify(sr2.hits.map((h) => h.snippet)))

  // scope-only 统一分类：within this sample（SCOPE_RE 全覆盖，无需第二张表）
  const w = extractClaimSpans('Within this sample, treatment A improved survival.')
  check('scope-only unification (within this sample attached)', w.length === 1 && w[0].scopeMarkers.some((m) => m.toLowerCase().includes('within this sample')), JSON.stringify(w.map((s) => [s.clause, s.scopeMarkers])))
}

console.log('=== 75. v1.2.2 event-level 指纹（integrity 事件不再折叠）===')
{
  // 两个不同的 scholarship 事件必须产生不同指纹（v1.2.1 前共享 aggregate::scholarship-lock）
  const h1 = auditText('The dose was 6 mg.', { profile: 'manuscript', original: 'The dose was 5 mg.' }).hits.find((h) => h.ruleId === 'scholarship-lock')
  const h2 = auditText('The dose was 12 mg.', { profile: 'manuscript', original: 'The dose was 10 mg.' }).hits.find((h) => h.ruleId === 'scholarship-lock')
  const fp1 = hitFingerprint(h1)
  const fp2 = hitFingerprint(h2)
  check('scholarship events get distinct fingerprints', h1 && h2 && fp1 !== fp2, `${fp1} vs ${fp2}`)

  // 修复第一个后，第二个仍是 added（diffAudit 不折叠）
  const prev = new Set([fp1])
  const diff = diffAudit(prev, [h2])
  check('diffAudit treats second event as new', diff.added.length === 1, JSON.stringify(diff.added.map((h) => hitFingerprint(h))))

  // aggregate 规则仍用 aggregate 指纹
  const agg = auditText('— — — — — —', { profile: 'manuscript' }).hits.find((h) => h.ruleId === 'em-dash-density')
  check('aggregate rules keep aggregate fingerprint', agg && hitFingerprint(agg) === 'aggregate::em-dash-density', hitFingerprint(agg))
}

console.log('=== 76. v1.2.2 invariant 不受 severity filter 静默过滤 ===')
{
  // MEDIUM invariant（新增 cite）在 conservative(high) 过滤下必须保留
  const r = auditText(
    'This was demonstrated previously \\cite{Smith2024}.',
    { profile: 'manuscript', original: 'This was demonstrated previously.' },
  )
  const filtered = filterReport(r, 'high')
  check('invariant MEDIUM survives filter(high)', filtered.hits.some((h) => h.ruleId === 'scholarship-lock'), JSON.stringify(filtered.hits.map((h) => [h.ruleId, h.severity, h.findingKind])))

  // 非 invariant 的 MEDIUM 仍按 severity 过滤
  const r2 = auditText('The revised model uses ΔP. 本文并非要证明。真正重要的从来不是X而是Y。', { profile: 'manuscript' })
  const f2 = filterReport(r2, 'high')
  check('candidate MEDIUM still filtered by severity', !f2.hits.some((h) => h.ruleId === 'not-x-but-y-zh'), JSON.stringify(f2.hits.map((h) => h.ruleId)))
}

console.log('=== 77. v1.2.2 SCOPE lastIndex + version-gap inventory ===')
{
  // /g+test() lastIndex 回归：连续 scope fragments 第二个不再漏
  const multi = extractClaimSpans('In this cohort, under these conditions, X improved.')
  check('multiple scope prefixes attach (lastIndex safe)', multi.length === 1 && multi[0].scopeMarkers.length === 2, JSON.stringify(multi.map((s) => [s.clause, s.scopeMarkers])))

  // version-gap 仍输出全局科研实体清单
  const before = 'The first study examined drying kinetics in a porous micromodel under three temperatures. The second study focused on salt precipitation and its effect on permeability evolution.'
  const after = 'This review synthesizes evidence on fracture self-sealing in caprocks during CO2 geological storage. We organize the literature into four functional levels of sealing recovery. \\cite{Smith2024} appears here.'
  const gap = auditText(after, { profile: 'manuscript', original: before })
  const gh = gap.hits.find((h) => h.ruleId === 'version-gap')
  check('version-gap includes global inventory', gh && gh.snippet.includes('全局科研实体变化'), gh?.snippet?.slice(0, 200))
}

console.log('=== 78. v1.2.3 Epistemic 指纹带 claim identity（同 drift 不同 claim 不碰撞）===')
{
  // 分析最优先场景：两个不同 claim 发生完全相同的 association→causation
  const a = auditText('Treatment A caused mortality.', { profile: 'manuscript', original: 'Treatment A was associated with mortality.' })
  const b = auditText('Treatment B caused mortality.', { profile: 'manuscript', original: 'Treatment B was associated with mortality.' })
  const ha = a.hits.find((h) => h.ruleId === 'claim-drift')
  const hb = b.hits.find((h) => h.ruleId === 'claim-drift')
  const fpa = hitFingerprint(ha)
  const fpb = hitFingerprint(hb)
  check('same drift on different claims → distinct fingerprints', ha && hb && fpa !== fpb, `${fpa} vs ${fpb}`)

  // 第二个事件必须是 new（diffAudit 不折叠）
  const diff = diffAudit(new Set([fpa]), [hb])
  check('diffAudit treats claim-B drift as new', diff.added.length === 1, JSON.stringify(diff.added.map((h) => hitFingerprint(h))))

  // 同一个 claim 的相同 drift 仍稳定（指纹可复现）
  const a2 = auditText('Treatment A caused mortality.', { profile: 'manuscript', original: 'Treatment A was associated with mortality.' })
  check('same claim drift fingerprint stable', hitFingerprint(a2.hits.find((h) => h.ruleId === 'claim-drift')) === fpa)
}

console.log('=== 79. v1.2.3 inventory 用 unpaired multiset（数值替换不再漏）===')
{
  // version-gap 场景下 5 mg→6 mg 属于"移除 6 / 新增 1"，不因被配成 changed 而消失
  const before = 'A = 5 mg. B = 10 mg. C = 15 mg. D = 20 mg. E = 25 mg. F = 30 mg.'
  const after = '6 mg was reported in the revised analysis.'
  const gap = auditText(after, { profile: 'manuscript', original: before })
  const gh = gap.hits.find((h) => h.ruleId === 'version-gap')
  check('inventory counts number replacement', gh && gh.snippet.includes('带单位数值：移除 6 / 新增 1'), gh?.snippet?.slice(0, 200))

  // 全类型遍历：pvalue 类型也进清单
  const gap2 = auditText('The revised analysis reports p < 0.01.', { profile: 'manuscript', original: 'A = 5 mg. B = 10 mg. C = 15 mg. D = 20 mg. E = 25 mg. F = 30 mg.' })
  const gh2 = gap2.hits.find((h) => h.ruleId === 'version-gap')
  check('inventory covers pvalue type', gh2 && gh2.snippet.includes('p 值'), gh2?.snippet?.slice(0, 200))
}

console.log('=== 80. v1.2.3 fallback added/removed 统一可信度（位置兜底低相似 → candidate）===')
{
  // 短文档位置兜底 + 低真实相似度：added 事件也降为 candidate（不再写死 invariant）
  const r = auditText('Z did not improve.', { profile: 'manuscript', original: 'Z improved.' })
  const h = r.hits.find((x) => x.ruleId === 'negation-drift')
  check('fallback added event is candidate at low sim', h && h.findingKind === 'candidate', JSON.stringify(h && [h.findingKind, h.snippet]))
}

console.log('=== 81. v1.3 paragraph-rhythm（碎片化/拥塞/过度整齐）===')
{
  // 碎片化 TP：7 段里 4 段是一句成段
  const fragmented = 'P1 只有一句话。\n\nP2 也只有一句话。\n\nP3 还是只有一句话。\n\nP4 依然只有一句话。\n\nP5 这一段有两句话。第二句补足。\n\nP6 这一段也有两句。补充一句。\n\nP7 正常段落，包含足够多的内容来填充长度，让整体分布不至于过短，句子数量也足够。'
  const r1 = auditText(fragmented, { profile: 'manuscript' })
  const h1 = r1.hits.find((h) => h.ruleId === 'paragraph-rhythm')
  check('paragraph-rhythm fragmented TP', h1 && h1.snippet.includes('碎片化'), h1?.snippet)

  // 拥塞 TP：少数段远高于分布（2 段 > 中位数 2.5 倍）
  const congested = []
  for (let i = 0; i < 8; i++) congested.push(`段 ${i} 的普通内容。这一段的长度保持在正常范围内，大约二十个词左右，用来模拟论文中的典型段落。`)
  congested.push('这一段异常地长，包含了大量没有实际意义的填充内容，其目的是模拟论文中少数段落远高于自身段长分布的情况，这种段落往往需要拆分成多个独立段落来处理，每个段落只承担一个论证单元，内容虽然很多但实际上并没有增加多少信息量，读者在阅读时也会感到明显的负担。')
  congested.push('另一段也异常地长，同样包含了很多没有实际意义的填充内容，其目的是模拟论文中少数段落远高于自身段长分布的情况，这种段落往往需要拆分成多个独立段落来处理，每个段落只承担一个论证单元，内容虽然很多但实际上并没有增加多少信息量，读者在阅读时也会感到明显的负担。')
  const r2 = auditText(congested.join('\n\n'), { profile: 'manuscript' })
  const h2 = r2.hits.find((h) => h.ruleId === 'paragraph-rhythm')
  check('paragraph-rhythm congested TP', h2 && h2.snippet.includes('拥塞'), h2?.snippet)

  // 过度整齐 TP：连续 3+ 段长度在中位数 ±15%
  const uniform = []
  for (let i = 0; i < 8; i++) uniform.push(`第 ${i} 段内容是长度几乎相同的句子组合，每段大约二十五词。这样的段落长度完全一致。`)
  const r3 = auditText(uniform.join('\n\n'), { profile: 'manuscript' })
  const h3 = r3.hits.find((h) => h.ruleId === 'paragraph-rhythm')
  check('paragraph-rhythm uniform TP', h3 && h3.snippet.includes('过度整齐'), h3?.snippet)

  // TN：正常论文段落（长短自然变化）
  const normal = '第一段介绍了背景，并且包含了足够的细节来说明研究动机。\n\n第二段只有一句话作为过渡。\n\n第三段详细描述了方法，包含许多技术细节和参数。\n\n第四段展示了结果。\n\n第五段讨论了局限性与未来方向。'
  const tn = auditText(normal, { profile: 'manuscript' })
  check('paragraph-rhythm TN (short doc, no hit)', !hasRule(tn, 'paragraph-rhythm'), JSON.stringify(tn.hits.map((h) => h.ruleId)))
}

console.log('=== 82. v1.3 sentence-rhythm-uniformity（局部 run + 作者历史对比）===')
{
  // run TP：两个段落内各有连续 ≥3 句长度相近（共 8+ 句以满足总句数门槛）
  const runText = [
    'The first sentence here is about twenty words long in total. The second sentence here is also about twenty words long. The third sentence keeps the very same approximate length too. The fourth sentence again matches the length of the previous three.',
    '',
    'Another paragraph repeats the same pattern of uniform length. This second sentence matches the first one in length exactly. And the third sentence is again the same length again. The fourth sentence here also keeps that same uniform length.',
  ].join('\n')
  const r = auditText(runText, { profile: 'manuscript' })
  const h = r.hits.find((x) => x.ruleId === 'sentence-rhythm-uniformity')
  check('sentence-rhythm run TP', h && h.snippet.includes('连续'), h?.snippet)

  // 作者历史 std 对比 TP：当前 std 明显低于历史
  const author = computeStyleProfile('Short sentences. Medium length sentence here. Another medium sentence. A bit longer sentence follows. One more regular sentence. The final sentence ends the sample.') // std 应该较大
  const uniformText = 'The first sentence of this document is exactly twenty words long. The second sentence of this document is exactly twenty words long. The third sentence of this document is exactly twenty words long. The fourth sentence of this document is exactly twenty words long. The fifth sentence of this document is exactly twenty words long. The sixth sentence of this document is exactly twenty words long. The seventh sentence of this document is exactly twenty words long. The eighth sentence of this document is exactly twenty words long. The ninth sentence of this document is exactly twenty words long.'
  const r2 = auditText(uniformText, { profile: 'manuscript', styleProfile: author })
  const h2 = r2.hits.find((x) => x.ruleId === 'sentence-rhythm-uniformity')
  check('sentence-rhythm author-std TP', h2 && h2.snippet.includes('作者历史'), h2?.snippet)

  // TN：句长自然变化的正常文本（无 run、无 author 对比命中）
  const natural = 'Drying in porous media involves coupled gas-liquid flow. Higher temperature accelerated drying. This is a short concluding remark. We measured pressure drop across eight folds with five seeds, and the results were consistent across all evaluations. RMSE decreased from 2.1 to 1.3 after retraining. Done.'
  const tn = auditText(natural, { profile: 'manuscript' })
  check('sentence-rhythm TN (natural variation)', !hasRule(tn, 'sentence-rhythm-uniformity'), JSON.stringify(tn.hits.map((h) => h.ruleId)))
}

console.log('=== 83. v1.3 repeated-discourse-scaffold（枚举脚手架跨段落复用）===')
{
  // TP：两个段落都用 首先/其次/最后
  const tp = '首先，我们建立了微流控平台。其次，我们设计了验证协议。最后，我们总结了边界。\n\n首先，本文分析了出口配置的影响。其次，本文讨论了温度的作用。最后，本文给出了结论。'
  const r = auditText(tp, { profile: 'manuscript' })
  const h = r.hits.find((x) => x.ruleId === 'repeated-discourse-scaffold')
  check('scaffold repeat TP (首先/其次/最后 ×2)', h && h.snippet.includes('2 个独立段落'), h?.snippet)

  // TP 英文：First/Second/Third 两个段落（签名一致）
  const tpEn = 'First, we built the platform. Second, we designed the protocol. Third, we validated the model. Finally, we summarized the limits.\n\nFirst, the outlet effect was analyzed. Second, the temperature effect was discussed. Third, the boundary was defined. Finally, the conclusion was drawn.'
  const r2 = auditText(tpEn, { profile: 'manuscript' })
  check('scaffold repeat TP (First/Second/Third ×2)', hasRule(r2, 'repeated-discourse-scaffold'), JSON.stringify(r2.hits.map((h) => [h.ruleId, h.snippet])))

  // TN：只在一个段落里列举（单次使用正常）
  const tn = '本文从三个方面展开：首先，建立平台；其次，设计协议；最后，给出结论。下一段完全不用枚举结构。'
  const r3 = auditText(tn, { profile: 'manuscript' })
  check('scaffold repeat TN (single use)', !hasRule(r3, 'repeated-discourse-scaffold'), JSON.stringify(r3.hits.map((h) => h.ruleId)))

  // scaffoldSignature 单元测试
  check('scaffoldSignature 首先其次最后', scaffoldSignature('首先，A。其次，B。最后，C。') === '1-2-4')
  check('scaffoldSignature 单次不构成', scaffoldSignature('首先，A。后面没有枚举了。') === null)
  check('scaffoldSignature 从X层面', scaffoldSignature('从制度层面，A。从执行层面，B。从效果层面，C。') === 'P-P-P')
  check('scaffoldSignature 第一第二第三', scaffoldSignature('第一，A。第二，B。第三，C。') === '1-2-3')
}

console.log('=== 84. v1.3 punctuation-scaffold-overload（标点组合聚集）===')
{
  // TP：同句 ≥3 类结构标点
  const tp = '本文提出一种"多维协同"机制：首先解决A；其次处理B——形成"输入—处理—输出"的价值闭环（参见表1）。'
  const r = auditText(tp, { profile: 'manuscript' })
  const h = r.hits.find((x) => x.ruleId === 'punctuation-scaffold-overload')
  check('punctuation overload TP (引号+冒号+分号+破折号+括号)', h, h?.snippet)

  // TN：正常使用两种以内标点
  const tn = 'The results show that the RMSE decreased from 2.1 to 1.3 after retraining (see Table 3).'
  const r2 = auditText(tn, { profile: 'manuscript' })
  check('punctuation overload TN', !hasRule(r2, 'punctuation-scaffold-overload'), JSON.stringify(r2.hits.map((h) => h.ruleId)))
}

console.log('=== 85. v1.3 coined-framework-language（自创框架词，形式规则）===')
{
  // TP：A-B-C 短线框架
  const tp1 = '本框架采用"问题-原因-对策"的分析路径，形成了"输入-处理-输出"的数据流。'
  const r1 = auditText(tp1, { profile: 'manuscript' })
  check('coined framework TP (A-B-C 短线)', hasRule(r1, 'coined-framework-language'), JSON.stringify(r1.hits.map((h) => [h.ruleId, h.snippet])))

  // TP：连续多个 XX化
  const tp2 = '推动管理方式深度化、场景化、生态化转型，实现价值化运营。'
  const r2 = auditText(tp2, { profile: 'manuscript' })
  check('coined framework TP (XX化 连续)', hasRule(r2, 'coined-framework-language'), JSON.stringify(r2.hits.map((h) => [h.ruleId, h.snippet])))

  // TP：闭环/赋能机制
  const tp3 = '构建数据-业务-价值的赋能闭环与生态体系。'
  const r3 = auditText(tp3, { profile: 'manuscript' })
  check('coined framework TP (闭环/赋能)', hasRule(r3, 'coined-framework-language'), JSON.stringify(r3.hits.map((h) => [h.ruleId, h.snippet])))

  // TN：正常术语不报
  const tn = 'The system exhibits robust performance with a coupling mechanism between thermal and hydraulic fields (可持续性与协同性在此领域是正当术语).'
  const r4 = auditText(tn, { profile: 'manuscript' })
  check('coined framework TN (正常术语)', !hasRule(r4, 'coined-framework-language'), JSON.stringify(r4.hits.map((h) => [h.ruleId, h.snippet])))
}

console.log('=== 86. v1.3 generic-claim-candidate（多弱信号组合）===')
{
  // TP：抽象名词多 + 无实体 + 无方法动作 + 万能句型
  const tp = '本研究通过深入分析发现，企业管理实践中存在的诸多问题，需要通过全面系统的方法进行有效解决，以充分发挥管理体系的整体作用。'
  const r = auditText(tp, { profile: 'manuscript' })
  const h = r.hits.find((x) => x.ruleId === 'generic-claim-candidate')
  check('generic claim TP (4 弱信号)', h && h.findingKind === 'candidate', JSON.stringify(h && [h.snippet, h.findingKind]))

  // TN：有具体实体/方法动作的句子不报
  const tn = 'We measured pressure drop across eight folds and found RMSE = 1.283, which confirms the causal model improves accuracy by 12%.'
  const r2 = auditText(tn, { profile: 'manuscript' })
  check('generic claim TN (有证据)', !hasRule(r2, 'generic-claim-candidate'), JSON.stringify(r2.hits.map((h) => h.ruleId)))
}

console.log('=== 87. v1.3 local-citation-integrity（.bib 一致性）===')
{
  const bib = [
    '@article{smith2024,',
    '  title = {Pore-scale drying experiments},',
    '  author = {Smith, J. and Doe, A.},',
    '  year = {2024},',
    '  doi = {10.1000/abc}',
    '}',
    '@article{doe2023,',
    '  title = {Microfluidic visualization},',
    '  year = {2023}',
    '}',
  ].join('\n')

  // 解析
  const entries = parseBibText(bib)
  check('parseBibText 2 entries', entries.length === 2 && entries[0].key === 'smith2024' && entries[0].doi === '10.1000/abc' && entries[0].title === 'Pore-scale drying experiments', JSON.stringify(entries))
  check('parseBibText missing fields detected', entries[1].key === 'doe2023' && !entries[1].author && entries[1].title === 'Microfluidic visualization', JSON.stringify(entries[1]))

  // TP：unresolved cite + 缺失 label + 条目缺 author
  const tex = 'As shown in \\cite{smith2024} and \\cite{nonexistent2020}, the drying rate depends on temperature \\ref{fig:missing}.'
  const r = auditText(tex, { profile: 'manuscript', bibText: bib })
  check('citation integrity unresolved-cite TP', hasRule(r, 'local-citation-integrity'), JSON.stringify(r.hits.map((h) => h.snippet)))
  const details = r.hits.filter((h) => h.ruleId === 'local-citation-integrity').map((h) => h.snippet).join('|')
  check('citation integrity covers unresolved + missing-label + incomplete', details.includes('nonexistent2020') && details.includes('fig:missing') && details.includes('doe2023 缺字段'), details)

  // TN：全部一致时无命中（bib 条目都完整）
  const completeBib = [
    '@article{smith2024,',
    '  title = {Pore-scale drying experiments},',
    '  author = {Smith, J. and Doe, A.},',
    '  year = {2024},',
    '  doi = {10.1000/abc}',
    '}',
  ].join('\n')
  const cleanTex = 'As shown in \\cite{smith2024}, the drying rate depends on temperature. \\label{fig:x} See \\ref{fig:x}.'
  const r2 = auditText(cleanTex, { profile: 'manuscript', bibText: completeBib })
  check('citation integrity TN (all consistent)', !hasRule(r2, 'local-citation-integrity'), JSON.stringify(r2.hits.map((h) => h.snippet)))

  // TN：不提供 bibText 时规则不启用
  const r3 = auditText(tex, { profile: 'manuscript' })
  check('citation integrity no-bib no-op', !hasRule(r3, 'local-citation-integrity'), JSON.stringify(r3.hits.map((h) => h.ruleId)))
}

console.log('=== 88. v1.3 summary-cliche-positional（总结套话位置感知）===')
{
  // TP：两个章节末尾都用"综上所述"
  const tp = '# Introduction\n\n背景内容。\n\n综上所述，本研究有重要意义。\n\n# Results\n\n结果内容。\n\n综上所述，结果支持假设。\n\n# Methods\n\n方法内容，末尾是正常判断句。'
  const r = auditText(tp, { profile: 'manuscript' })
  const h = r.hits.find((x) => x.ruleId === 'summary-cliche-positional')
  check('summary cliche positional TP (2 sections end with 综上所述)', h && h.snippet.includes('2 个小节末尾'), h?.snippet)

  // TN：套话只出现一次（或不在小节末尾）
  const tn = '# Introduction\n\n综上所述，本研究有重要意义。\n\n# Results\n\n结果内容。\n\n# Methods\n\n方法内容。'
  const r2 = auditText(tn, { profile: 'manuscript' })
  check('summary cliche positional TN (single occurrence)', !hasRule(r2, 'summary-cliche-positional'), JSON.stringify(r2.hits.map((h) => h.ruleId)))
}

console.log('=== 89. v1.4 Journal Profile 蒸馏（computeJournalProfile）===')
{
  const corpus = [
    '# Abstract',
    '',
    'This study investigates the effect of temperature on drying. The experiment was performed in a microfluidic device. We observed a 12% increase in rate.',
    '# Introduction',
    '',
    'Drying in porous media is important. Several studies have examined this process. However, a gap remains in understanding salt precipitation. We therefore aim to quantify the effect.',
    '# Methods',
    '',
    'We used a microfluidic chip. The chip was heated at 25, 50, and 75 °C. Each condition was repeated three times. The drying rate was measured by image analysis.',
    '# Results',
    '',
    'Higher temperatures significantly increased the drying rate. The rate rose from 0.5 to 1.2 mL/h. These results demonstrate a clear thermal effect.',
    '# Discussion',
    '',
    'Our findings suggest that temperature is a key control. The observed increase may be related to enhanced vapor transport. Further studies should examine pore-scale salt precipitation.',
  ].join('\n')
  const profile = computeJournalProfile(corpus, { journal: 'Test Journal', articleType: 'research-article' })
  check('journal profile metadata', profile.metadata.journal === 'Test Journal' && profile.metadata.profileVersion === '1.4.1' && profile.structure.sections.length >= 4)
  check('journal profile has sentence distribution', !!profile.sentenceStyle.sentenceLength && profile.sentenceStyle.sentenceLength.count > 0)
  check('journal profile has section details', profile.structure.sections.some((s) => s.name === 'results' && s.sentenceLength.count > 0))
  check('journal profile preserves only statistics', profile.rhetoric.moves.length === 0 && !JSON.stringify(profile).includes('This study investigates'))
}

console.log('=== 90. v1.4 Journal Fit 审计（auditJournalFit / writing_audit journalProfile）===')
{
  const corpus = [
    '# Abstract',
    '',
    'This study investigates the effect of temperature on drying. The experiment was performed in a microfluidic device. We observed a 12% increase in rate.',
    '# Introduction',
    '',
    'Drying in porous media is important. Several studies have examined this process. However, a gap remains in understanding salt precipitation. We therefore aim to quantify the effect.',
    '# Methods',
    '',
    'We used a microfluidic chip. The chip was heated at 25, 50, and 75 °C. Each condition was repeated three times. The drying rate was measured by image analysis.',
    '# Results',
    '',
    'Higher temperatures significantly increased the drying rate. The rate rose from 0.5 to 1.2 mL/h. These results demonstrate a clear thermal effect.',
    '# Discussion',
    '',
    'Our findings suggest that temperature is a key control. The observed increase may be related to enhanced vapor transport. Further studies should examine pore-scale salt precipitation.',
  ].join('\n')
  const profile = computeJournalProfile(corpus, { journal: 'Test Journal' })
  const manuscript = corpus
  const report = auditText(manuscript, { profile: 'manuscript', journalProfile: profile })
  check('journal fit attached to report', !!report.journalFit && report.journalFit.journal === 'Test Journal' && report.journalFit.sections.length > 0)
  check('journal fit scores in range', report.journalFit.sections.every((s) => s.score >= 0 && s.score <= 100))
  check('journal fit format includes block', formatReport(report, { verbose: true }).includes('期刊写作契合度（Journal Fit · Test Journal）'))

  const withLimits = manuscript + '\n\n# Limitations\n\nThis study has some limitations. The sample size is small. Further work is needed.'
  const report2 = auditText(withLimits, { profile: 'manuscript', journalProfile: profile })
  check('journal fit warns on missing profile section', report2.journalFit?.warnings.some((w) => w.toLowerCase().includes('limitations')) ?? false, JSON.stringify(report2.journalFit?.warnings))
}

console.log('=== 91. v1.4.1 corpus-aware aggregation（多篇同名校验）===')
{
  const mk = (n) => `# Results\n\n${Array(n).fill('word').join(' ')}.`
  const docs = [10, 20, 30].map((n) => ({ text: mk(n), sourceId: `paper-${n}` }))
  const profile = computeJournalProfileFromDocuments(docs, { journal: 'Corpus Test' })
  const results = profile.structure.sections.find((s) => s.name === 'results')
  check('corpus results count/articleCount', results && results.articleCount === 3 && results.sentenceLength.count === 3, JSON.stringify(results))
  check('corpus results median is aggregate (20, not 30)', results && results.sentenceLength.median === 20, JSON.stringify(results?.sentenceLength))
  check('corpus sampleSize', profile.metadata.sampleSize === 3, JSON.stringify(profile.metadata.sampleSize))
}

console.log('=== 92. v1.4.1 real-corpus smoke test（D盘裂缝盐析 ESR/source.md）===')
{
  const esrRoot = 'D:\\裂缝盐析\\00_raw\\ESR论文'
  const readerRoot = 'D:\\裂缝盐析\\01_literature\\readers'
  const candidates = [esrRoot, readerRoot].filter((r) => fs.existsSync(r))
  if (candidates.length === 0) {
    check('real-corpus directory exists', false, `missing ESR/readers roots`)
  } else {
    const sources = []
    const walkMd = (dir) => {
      let entries = []
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) walkMd(full)
        else if (/\.md$/i.test(e.name) && !/^readme\.md$/i.test(e.name) && sources.length < 5) sources.push(full)
      }
    }
    // 优先 ESR 文件夹中的 md；不足 3 篇则回退到 readers 下的 source.md
    walkMd(esrRoot)
    if (sources.length < 3) {
      sources.length = 0
      const walkSource = (dir) => {
        let entries = []
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true })
        } catch {
          return
        }
        for (const e of entries) {
          const full = path.join(dir, e.name)
          if (e.isDirectory()) walkSource(full)
          else if (e.name === 'source.md' && sources.length < 5) sources.push(full)
        }
      }
      walkSource(readerRoot)
    }
    const docs = sources.slice(0, 5).map((f) => ({ text: fs.readFileSync(f, 'utf8'), sourceId: path.basename(path.dirname(f)) }))
    check('real-corpus found md files', docs.length >= 3, `found ${docs.length} from ${sources.join(', ')}`)
    if (docs.length >= 3) {
      const profile = computeJournalProfileFromDocuments(docs, { journal: 'D-Literature Smoke', sampleSize: docs.length })
      check('real-corpus sampleSize', profile.metadata.sampleSize === docs.length, JSON.stringify(profile.metadata.sampleSize))
      check('real-corpus has aggregated sections', profile.structure.sections.length > 0, JSON.stringify(profile.structure.sections.map((s) => s.name)))
      const results = profile.structure.sections.find((s) => s.name === 'results')
      check('real-corpus results distribution when present', !results || results.sentenceLength.count > 0, JSON.stringify(results?.sentenceLength))
    }
  }
}


console.log('')
console.log(`结果：${pass} 通过 / ${fail} 失败`)
if (fail > 0) {
  console.log('失败明细：')
  for (const f of failures) console.log('  -', f)
  process.exit(1)
}
console.log('ALL TESTS PASSED')
