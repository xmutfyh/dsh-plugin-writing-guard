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
/** 语言适应的词/字计数（v0.3.1：不要用英文 whitespace-word 衡量中文） */
export function countLexicalUnits(text) {
    // 中文字符单独计数（无空格），其余按空白切词
    const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
    const cjkChars = cjk ? cjk.length : 0;
    const nonCjk = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ');
    const m = nonCjk.match(/\S+/g);
    const englishWords = m ? m.length : 0;
    return { englishWords, cjkChars };
}
/** 兼容：密度分母用词/字合计（英文按词、中文按字） */
export function countWords(text) {
    const { englishWords, cjkChars } = countLexicalUnits(text);
    return englishWords + cjkChars;
}
/** 按规则单位计算密度分母（v0.3.3：language-aware——英文规则用英文词数、中文规则用 CJK 字数，双语文件不再互相稀释） */
function denominatorForRule(text, rule, unit) {
    if (unit === 'char') {
        // char 单位：优先用 CJK 字数（中文规则），比 text.length 更准（不含英文/标点/Markdown 符号）
        const { cjkChars } = countLexicalUnits(text);
        return cjkChars > 0 ? cjkChars : text.length;
    }
    const { englishWords, cjkChars } = countLexicalUnits(text);
    // 语言感知：规则声明单一语言时用对应分母
    if (rule.languages?.length === 1) {
        if (rule.languages[0] === 'en')
            return englishWords;
        if (rule.languages[0] === 'zh')
            return cjkChars;
    }
    return englishWords + cjkChars;
}
export const CATEGORY_LABELS = {
    process_residue: '修改过程残留',
    claim_calibration: '主张校准',
    rhetorical_pattern: '修辞模式',
    llm_associated: 'LLM 关联词',
    academic_style: '学术文体',
    formatting: '格式',
};
// ---------------------------------------------------------------------------
// 规则定义
// ---------------------------------------------------------------------------
const RULES = [
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
        pattern: /\bwe (have |now |also )?(updated|modified|corrected|clarified|expanded|rewritten|replaced|revised)\b/gi,
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
        id: 'limitation-dispersal',
        category: 'claim_calibration',
        severity: 'low',
        confidence: 'medium',
        label: '局限性分散重复',
        pattern: /(limitation|局限|不足|cannot be (generalized|extended)|not be applied)/gi,
        threshold: { minCount: 3, perK: 0.5 },
        message: '“局限/limitation”类表述全文出现较多（≥3 次且密度 ≥0.5/千词），可能在多个章节重复免责。',
        suggestion: '边界声明集中写：方法定位一处 + 结论边界一处；其余用证据角色表达。注意：在 Discussion 中正当陈述局限（ICMJE 要求）不算问题，重点是避免同一局限在多个章节重复。',
        languages: ['zh', 'en'],
        evidence: { type: 'style-guide', source: 'ESR 指南：边界声明集中写' },
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
        pattern: /\b[a-z]{3,}, [a-z]{3,}, and [a-z]{3,}\b/g,
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
        pattern: /\b(moreover|furthermore|additionally|in conclusion|to sum up|in summary|ultimately|that being said|in today's|in the realm of|when it comes to|a wide range of|plays? a crucial role in|it is worth mentioning|navigating the complexities of)\b/gi,
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
        pattern: /(值得注意的是|值得一提的是|不难发现|不难看出|显而易见|众所周知|综上所述|总的来说|与此同时|基于此|在此基础上|随着[^，。；]{2,20}的发展|在[^，。；]{2,20}的背景下|需要强调的是)/g,
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
        // v0.3.1：真正实现"附近有统计证据则跳过"（GPT：文案写了逻辑没实现）；match-local 窗口
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
        evidence: { type: 'heuristic' },
    },
];
// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------
/** 检测文档类型（从文件路径推断）——v0.3.1 收紧：peer-review 只认明确词，综述类归 manuscript */
export function detectDocumentProfile(filePath) {
    const norm = filePath.replace(/\\/g, '/').toLowerCase();
    if (/rebuttal|response[_ -]?to[_ -]?reviewers?|回复审稿|返修回复|逐条回复/.test(norm))
        return 'rebuttal';
    if (/cover[_ -]?letter|投稿信/.test(norm))
        return 'cover_letter';
    // 明确的审稿材料（GPT v0.3.1：systematic_review / literature_review / scoping_review / review_article 是论文而非审稿意见）
    if (/(reviewer[_ -]?comments?|review[_ -]?comments?|peer[_ -]?review|referee[_ -]?report|审稿意见|评审意见)/.test(norm))
        return 'review';
    // 综述类论文归 manuscript
    if (/(systematic[_ -]?review|literature[_ -]?review|scoping[_ -]?review|review[_ -]?article|narrative[_ -]?review)/.test(norm))
        return 'manuscript';
    if (/manuscript|paper|thesis|论文|稿件|修订|返修稿/.test(norm))
        return 'manuscript';
    // 一般笔记/草稿（GPT v0.3.1：让 notes profile 可被自动检测到）
    if (/(^|\/)(notes?|draft|草稿|笔记|scratch)(\/|\.|$)/.test(norm))
        return 'notes';
    return 'unknown';
}
/** 规则计数（v0.3.1：单一数据源——优先用 rule.counter，否则用 rule.pattern 全局计数） */
function countRuleOccurrences(rule, text) {
    if (rule.counter)
        return rule.counter(text);
    // 无 g 标志的正则克隆并加 g
    const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags + 'g');
    const m = text.match(re);
    return m ? m.length : 0;
}
/** 按 ruleId 计数（v0.3.1：stats 与规则同一 source of truth，杜绝 drift） */
function countRuleById(id, text) {
    const rule = RULES.find((r) => r.id === id);
    return rule ? countRuleOccurrences(rule, text) : 0;
}
function ruleMatchesProfile(rule, profile) {
    if (!rule.profiles || rule.profiles.length === 0)
        return true;
    if (rule.profiles.includes(profile))
        return true;
    // unknown 文档类型：保守执行（宁可多报让用户判断）
    if (profile === 'unknown' && rule.profiles.includes('unknown'))
        return true;
    return false;
}
/** 按最小严重度过滤并重算 summary（修正版：high > medium > low） */
export function filterReport(report, minSeverity) {
    const rank = { low: 1, medium: 2, high: 3 };
    const hits = report.hits.filter((h) => rank[h.severity] >= rank[minSeverity]);
    const byCategory = {
        process_residue: 0,
        claim_calibration: 0,
        rhetorical_pattern: 0,
        llm_associated: 0,
        academic_style: 0,
        formatting: 0,
    };
    let high = 0, medium = 0, low = 0;
    for (const h of hits) {
        byCategory[h.category] += 1;
        if (h.severity === 'high')
            high += 1;
        else if (h.severity === 'medium')
            medium += 1;
        else
            low += 1;
    }
    return {
        ...report,
        ok: hits.length === 0,
        hits,
        summary: { total: hits.length, high, medium, low, byCategory },
    };
}
/** 简单 Markdown/LaTeX 预处理：返回 prose 视图 */
export function preprocess(text) {
    let t = text;
    // 1. YAML frontmatter（--- ... --- 开头）
    t = t.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    // 2. code fences（``` ... ``` / ~~~ ... ~~~）
    t = t.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '');
    // 3. 行内代码与 LaTeX 行内公式
    t = t.replace(/`[^`\n]*`/g, ' ');
    t = t.replace(/\$[^$\n]+\$/g, ' ');
    // 4. LaTeX 块公式（$$...$$ / \[...\] / equation 环境）
    t = t.replace(/\$\$[\s\S]*?\$\$/g, ' ');
    t = t.replace(/\\\[[\s\S]*?\\\]/g, ' ');
    // 5. Markdown 链接：先保留 anchor text（v0.3.3：顺序反了会导致 [text](url) 残留 "["）
    t = t.replace(/\[([^\]]+)\]\(https?:\/\/[^)]*\)/g, '$1');
    t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    // 6. 裸 URLs
    t = t.replace(/https?:\/\/\S+/g, ' ');
    // 7. References / Bibliography 段截断（v0.3.3：必须放在 LaTeX 命令清理之前，
    //    否则 \begin{thebibliography} 会被 \\[a-zA-Z]+\s* 提前吃掉）
    const refMatch = t.match(/(?:^|\n)\s*(?:#{1,6}\s*)?(?:references|bibliography|参考文献)\s*:?\s*(?:\n|$)|\\begin\{thebibliography\}|\\section\*?\{References\}|\\section\*?\{Bibliography\}/i);
    let references = '';
    if (refMatch) {
        const idx = refMatch.index ?? 0;
        references = t.slice(idx);
        t = t.slice(0, idx);
    }
    // 8. LaTeX 命令（\cite{...} \ref{...} \textbf{...} 等，保留内容词）
    t = t.replace(/\\[a-zA-Z]+\{([^{}]*)\}/g, '$1');
    t = t.replace(/\\[a-zA-Z]+\s*/g, ' ');
    // 标题提取（Markdown # 或 LaTeX section）
    const headings = [];
    for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s{0,3}#{1,6}\s+(.+)$/);
        if (m)
            headings.push(m[1].trim());
    }
    return { raw: text, prose: t, headings, references };
}
export function auditText(text, opts) {
    const profile = opts?.profile ?? 'unknown';
    const maxParagraphs = opts?.maxParagraphs ?? 400;
    // v0.4 preprocessing：默认剥离 references/code/math/URL，规则只扫 prose
    const view = opts?.preprocess === false ? { raw: text, prose: text, headings: [], references: '' } : preprocess(text);
    const scanText = view.prose;
    const paragraphs = scanText
        .split(/\n{2,}|\r?\n\r?\n/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
        .slice(0, maxParagraphs);
    const { englishWords, cjkChars } = countLexicalUnits(scanText);
    const words = englishWords + cjkChars;
    const stats = {
        words,
        englishWords,
        cjkChars,
        // v0.3.1：统计与规则同一 source of truth（GPT：杜绝 counter 漂移）
        emDashCount: countRuleById('em-dash-density', scanText),
        colonTitleCount: countRuleById('colon-title', scanText),
        notXbutYCount: countRuleById('not-x-but-y-zh', scanText) + countRuleById('not-x-but-y-en', scanText),
        ratherThanCount: countRuleById('rather-than-heavy', scanText),
        absolutistCount: countRuleById('absolutist-def', scanText),
        ruleOfThreeCount: countRuleById('rule-of-three', scanText),
        transitionCount: countRuleById('llm-transition-overuse', scanText),
        cnConnectivesCount: countRuleById('cn-ai-connectives', scanText),
        paragraphs: paragraphs.length,
        chars: scanText.length,
    };
    const hits = [];
    for (const rule of RULES) {
        // 文档类型过滤
        if (!ruleMatchesProfile(rule, profile))
            continue;
        // 语言过滤：无法可靠检测语言时全部执行（规则本身多为双语正则）
        // 密度规则（全文统计级）——v0.3.3 P0 修复：必须用 scanText（preprocessing 后的 prose），
        // 否则 References/code/math/URL 里的词仍会污染全文计数与分母
        if (rule.threshold) {
            const count = countRuleOccurrences(rule, scanText);
            const unit = rule.threshold.unit ?? 'word';
            const denominator = denominatorForRule(scanText, rule, unit);
            const rate = denominator > 0 ? (count / denominator) * 1000 : 0;
            const okCount = rule.threshold.minCount === undefined || count >= rule.threshold.minCount;
            const okRate = rule.threshold.perK === undefined || rate >= rule.threshold.perK;
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
                });
            }
            continue;
        }
        // 段落级规则
        const maxHits = rule.maxHits ?? 3;
        let found = 0;
        for (let i = 0; i < paragraphs.length && found < maxHits; i++) {
            const para = paragraphs[i];
            const m = rule.pattern.exec(para);
            if (!m)
                continue;
            // 命中位置局部上下文（v0.3.1 match-local）：只看当前 match ±window，不再整段排除
            if (rule.context && m.index !== undefined) {
                const { window: w, exclude, require: requireRe } = rule.context;
                const start = Math.max(0, m.index - w);
                const end = Math.min(para.length, m.index + (m[0]?.length ?? 0) + w);
                const windowText = para.slice(start, end);
                if (exclude && exclude.test(windowText)) {
                    exclude.lastIndex = 0;
                    rule.pattern.lastIndex = 0;
                    continue;
                }
                exclude?.lastIndex !== undefined && (exclude.lastIndex = 0);
                if (requireRe && !requireRe.test(windowText)) {
                    requireRe.lastIndex = 0;
                    rule.pattern.lastIndex = 0;
                    continue;
                }
                requireRe?.lastIndex !== undefined && (requireRe.lastIndex = 0);
            }
            found += 1;
            const start = Math.max(0, (m.index ?? 0) - 60);
            const end = Math.min(para.length, (m.index ?? 0) + (m[0]?.length ?? 0) + 80);
            const snippet = (start > 0 ? '…' : '') + para.slice(start, end) + (end < para.length ? '…' : '');
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
            });
            rule.pattern.lastIndex = 0;
        }
    }
    // 项目内部词表（可配置）：project-specific residue
    const projectTerms = opts?.projectResidueTerms ?? [];
    if (projectTerms.length > 0) {
        const esc = projectTerms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
        const re = new RegExp(`(?:${esc})`, 'g');
        let found = 0;
        for (let i = 0; i < paragraphs.length && found < 5; i++) {
            const para = paragraphs[i];
            const m = re.exec(para);
            if (!m)
                continue;
            found += 1;
            const start = Math.max(0, (m.index ?? 0) - 60);
            const end = Math.min(para.length, (m.index ?? 0) + (m[0]?.length ?? 0) + 80);
            hits.push({
                ruleId: 'project-residue',
                category: 'process_residue',
                severity: 'medium',
                confidence: 'medium',
                label: '项目内部词表残留',
                paragraphIndex: i,
                snippet: (start > 0 ? '…' : '') + para.slice(start, end) + (end < para.length ? '…' : ''),
                message: `检测到项目内部词表条目 "${m[0]}"（可通过 writing_audit 的 projectResidueTerms 配置维护）。`,
                suggestion: '确认为内部流程词则删除或改写；若不是内部词，请从 projectResidueTerms 移除。',
                evidence: { type: 'project-specific' },
            });
            re.lastIndex = 0;
        }
    }
    const byCategory = {
        process_residue: 0,
        claim_calibration: 0,
        rhetorical_pattern: 0,
        llm_associated: 0,
        academic_style: 0,
        formatting: 0,
    };
    let high = 0, medium = 0, low = 0;
    for (const h of hits) {
        byCategory[h.category] += 1;
        if (h.severity === 'high')
            high += 1;
        else if (h.severity === 'medium')
            medium += 1;
        else
            low += 1;
    }
    return {
        ok: hits.length === 0,
        profile,
        summary: { total: hits.length, high, medium, low, byCategory },
        stats,
        hits,
    };
}
// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------
export function formatReport(report, opts) {
    const { summary, stats, hits } = report;
    const lines = [];
    const profileTag = report.profile !== 'unknown' ? `（文档类型: ${report.profile}）` : '';
    lines.push(`写作纪律检查报告${profileTag}：${hits.length === 0 ? '✅ 通过' : `发现 ${summary.total} 处问题（高 ${summary.high} / 中 ${summary.medium} / 低 ${summary.low}）`}`);
    lines.push(`- 统计：${stats.paragraphs} 段 / ${stats.chars} 字符（英文 ${stats.englishWords} 词 + 中文 ${stats.cjkChars} 字）；破折号 ${stats.emDashCount}；rather than ${stats.ratherThanCount}；不是X而是Y ${stats.notXbutYCount}；绝对化定义 ${stats.absolutistCount}；三连排比 ${stats.ruleOfThreeCount}；LLM过渡词 ${stats.transitionCount}；中文套话 ${stats.cnConnectivesCount}；冒号标题 ${stats.colonTitleCount}`);
    if (hits.length === 0)
        return lines.join('\n');
    const cats = Object.entries(summary.byCategory)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${CATEGORY_LABELS[k]} ${n}`)
        .join(' / ');
    lines.push(`- 分类：${cats}`);
    lines.push('');
    const order = { high: 0, medium: 1, low: 2 };
    const confRank = { high: 0, medium: 1, low: 2 };
    const sorted = [...hits].sort((a, b) => order[a.severity] - order[b.severity] || confRank[a.confidence] - confRank[b.confidence] || a.paragraphIndex - b.paragraphIndex);
    for (const h of sorted) {
        const sev = h.severity === 'high' ? '🔴' : h.severity === 'medium' ? '🟠' : '🟡';
        const loc = h.paragraphIndex >= 0 ? `[para ${h.paragraphIndex}]` : '[全文]';
        lines.push(`${sev} [${h.severity.toUpperCase()} · conf ${h.confidence}] ${h.label} ${loc}`);
        lines.push(`    原文：${h.snippet.trim().slice(0, 200)}`);
        if (opts?.verbose) {
            lines.push(`    提示：${h.message}`);
            lines.push(`    建议：${h.suggestion}`);
            if (h.evidence) {
                const src = h.evidence.source ? ` — ${h.evidence.source}` : '';
                lines.push(`    依据：${h.evidence.type}${src}`);
            }
            if (h.note)
                lines.push(`    备注：${h.note}`);
        }
        lines.push('');
    }
    if (!opts?.verbose) {
        lines.push('（提示：加 verbose=true 可查看每条的建议与备注）');
    }
    return lines.join('\n');
}
/** 输出给 Agent 的纪律速查文本（写作前加载） */
export function rulesBrief() {
    return [
        '# 论文写作纪律速查（dsh-plugin-writing-guard v0.3）',
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
        '## 六、发布会原则（扬长避短）',
        '- 只围绕优势组织论文；不写工作汇报、不主动示弱、不替审稿人攻击自己',
        '- 打不过的维度不设为比赛项目；不占优的结果从目标/约束/场景解释',
        '- 优势必须明确说出来；结论只强化记忆点',
        '',
        '## 七、提交前自查',
        '- 用 writing_audit 工具对全文扫描（可指定 profile: manuscript/rebuttal/cover_letter）；高危项必须清零，中危项 ≤3 处，低危项可保留但应说明理由',
    ].join('\n');
}
