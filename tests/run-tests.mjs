// -*- coding: utf-8 -*-
/**
 * writing-guard 回归测试：真实语料 TP/TN 检查（无需测试框架，node 直接跑）。
 * 目标：每条核心规则至少有一个 true-positive 和一个 true-negative 断言。
 * 运行：node tests/run-tests.mjs
 */
import { auditText, detectDocumentProfile, filterReport, hitFingerprint, diffAudit, serializeFingerprints, deserializeFingerprints } from '../lib/rules.js'

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

console.log('=== 20. v0.4 section detection + limitation-dispersal 跨章节 ===')
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
  check('limitation-dispersal TP (>=3 sections)', hasRule(r, 'limitation-dispersal'), JSON.stringify(r.hits.map((h) => h.ruleId)))

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
  check('limitation-dispersal TN (discussion only, ICMJE-appropriate)', !hasRule(ok, 'limitation-dispersal'), JSON.stringify(ok.hits.map((h) => h.ruleId)))
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
  const v1 = auditText('The revised model uses ΔP. This study has limitations in generalization.', { profile: 'manuscript' })
  const prev = new Set(v1.hits.map((h) => hitFingerprint(h)))
  const v2 = auditText('The model uses ΔP. We do not claim superiority. This study has limitations in generalization.', { profile: 'manuscript' })
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

console.log('')
console.log(`结果：${pass} 通过 / ${fail} 失败`)
if (fail > 0) {
  console.log('失败明细：')
  for (const f of failures) console.log('  -', f)
  process.exit(1)
}
console.log('ALL TESTS PASSED')
