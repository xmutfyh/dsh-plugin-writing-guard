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
/** 插件版本（单点定义：state 标记、工具描述、规则速查共用，避免多处硬编码漂移） */
export const PLUGIN_VERSION = '1.6.2';
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
    if (unit === 'sentence') {
        // v0.6：句子单位（hedge 密度等按句归一）
        return splitSentences(text).length;
    }
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
// ---------------------------------------------------------------------------
// v0.6 sentence-level utilities（零依赖）
// ---------------------------------------------------------------------------
/** 句子切分（中英混合；不切分号——分号是句内分隔）。
 *  半角句号只在后跟大写/中文时切（避免切坏 "Fig. 3"、"et al. (2020)"、"e.g."）；缩写点后跟小写不切。
 *  v0.9.2：先剥离 Markdown 引用块标记（> 行）——"pore image.\n>\n> As shown" 里句号后跟 '>'
 *  会挡住切分前瞻，导致两句被合并（实测制造假漂移）。 */
export function splitSentences(text) {
    const normalized = text.replace(/^\s*>\s?/gm, '');
    return normalized
        .split(/[。！？!?]+(?=\s|$|[\u4e00-\u9fffA-Z"'（(])|\.(?=\s+[A-Z\u4e00-\u9fff]|$)/u)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}
/** 中位数（排序后取中） */
export function medianOf(arr) {
    if (arr.length === 0)
        return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
/** 标准差（总体） */
export function stdOf(arr) {
    if (arr.length === 0)
        return 0;
    const mu = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((a, b) => a + (b - mu) ** 2, 0) / arr.length);
}
const SIM_STOP = new Set([
    'the', 'a', 'an', 'of', 'to', 'in', 'and', 'is', 'are', 'was', 'were', 'that', 'this',
    'with', 'for', 'on', 'as', 'by', 'at', 'from', 'it', 'its', 'we', 'our', 'be', 'been',
    'can', 'may', 'have', 'has', 'had', 'not', 'but', 'or', 'which', 'their', 'they', 'them',
    'than', 'these', 'those', 'such', 'into', 'over', 'between', 'while', 'using', 'used',
    'use', 'via', 'per', 'after', 'before', 'due', 'more', 'most', 'however', 'therefore',
    'thus', 'also', 'results', 'result', 'method', 'methods', 'model', 'data', 'paper', 'study',
]);
/**
 * v0.6 restatement-loop 相似度 token：英文按词（小写、去停用词），
 * 中文按相邻 2-gram 字符（无空格语言无法按词）。
 */
export function tokenizeForSimilarity(sentence) {
    const freq = new Map();
    const bump = (t) => { freq.set(t, (freq.get(t) ?? 0) + 1); };
    const en = sentence.toLowerCase().match(/[a-z][a-z'-]*/g);
    for (const w of en ?? []) {
        if (!SIM_STOP.has(w))
            bump(w);
    }
    const cjk = sentence.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? [];
    for (let i = 0; i + 1 < cjk.length; i++)
        bump(cjk[i] + cjk[i + 1]);
    return freq;
}
/** 余弦相似度（两个 token 频率向量） */
export function cosineSimilarity(a, b) {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (const [k, v] of a) {
        na += v * v;
        const w = b.get(k);
        if (w)
            dot += v * w;
    }
    for (const v of b.values())
        nb += v * v;
    const d = Math.sqrt(na) * Math.sqrt(nb);
    return d === 0 ? 0 : dot / d;
}
/** 句子的科研证据实体（数字/百分数/引用/图表编号/大写实体）——restatement 判断"后句是否有新增" */
function evidenceTokens(sentence) {
    const hits = sentence.match(/\b\d+(?:\.\d+)?%?|\b[A-Z][a-z]{2,}\b|\\cite|\\ref|Table\s*\d|Figure\s*\d/g) ?? [];
    return new Set(hits.map((t) => t.toLowerCase()));
}
/** 短句/长句阈值（词/字合计）——与 overlong-sentence 的极端阈值互补 */
const SHORT_SENTENCE_LIMIT = 12;
const LONG_SENTENCE_LIMIT = 35;
/** 从文本计算风格指标（作者历史或当前稿件皆可）——v1.3 增加节奏指纹字段 */
export function computeStyleProfile(text) {
    const sentences = splitSentences(text);
    const lens = sentences.map((s) => countWords(s));
    const paraLens = text
        .split(/\n{2,}/)
        .map((p) => countWords(p.trim()))
        .filter((n) => n > 0);
    const words = countWords(text);
    const perK = (n) => (words > 0 ? Math.round((n / words) * 1000 * 100) / 100 : 0);
    const hedgeRe = /\b(may|might|could|possibly|potentially|perhaps)\b/gi;
    const connRe = /\b(moreover|furthermore|additionally|however|therefore|thus|consequently|in addition)\b/gi;
    const emRe = /(——|—|–—)/g;
    const sMean = lens.length > 0 ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
    const sStd = stdOf(lens);
    const pMean = paraLens.length > 0 ? paraLens.reduce((a, b) => a + b, 0) / paraLens.length : 0;
    const pStd = stdOf(paraLens);
    const round2 = (n) => Math.round(n * 100) / 100;
    return {
        sentenceLengthMedian: medianOf(lens),
        sentenceLengthStd: round2(sStd),
        paragraphLengthMedian: medianOf(paraLens),
        emDashPerK: perK((text.match(emRe) ?? []).length),
        hedgePerK: perK((text.match(hedgeRe) ?? []).length),
        connectivePerK: perK((text.match(connRe) ?? []).length),
        // v1.3 节奏指纹
        sentenceLengthCV: sMean > 0 ? round2(sStd / sMean) : 0,
        shortSentenceRatio: lens.length > 0 ? round2(lens.filter((n) => n < SHORT_SENTENCE_LIMIT).length / lens.length) : 0,
        longSentenceRatio: lens.length > 0 ? round2(lens.filter((n) => n > LONG_SENTENCE_LIMIT).length / lens.length) : 0,
        paragraphLengthStd: round2(pStd),
        paragraphLengthCV: pMean > 0 ? round2(pStd / pMean) : 0,
    };
}
const round2 = (n) => Math.round(n * 100) / 100;
function computeDistribution(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const count = sorted.length;
    if (count === 0)
        return { count: 0, mean: 0, median: 0, p10: 0, p90: 0, std: 0 };
    const mean = sorted.reduce((a, b) => a + b, 0) / count;
    const pct = (q) => {
        if (count === 1)
            return sorted[0];
        const pos = Math.min(count - 1, Math.floor(q * count));
        return sorted[pos];
    };
    return {
        count,
        mean: round2(mean),
        median: round2(medianOf(sorted)),
        p10: round2(pct(0.1)),
        p90: round2(pct(0.9)),
        std: round2(stdOf(sorted)),
    };
}
const JOURNAL_HEDGE_RE = /\b(?:may|might|could|possibly|potentially|perhaps)\b/gi;
const JOURNAL_CAUSAL_RE = /\b(?:causes?|caused?|leads? to|resulted? in|contributes? to|affects?|affect|predicts?|associated with)\b/gi;
const JOURNAL_EVIDENCE_RE = /\b(?:suggest|suggests|suggested|indicate|indicates|indicated|support|supports|supported|show|shows|showed|demonstrate|demonstrates|demonstrated|establish|establishes|established|confirm|confirms|confirmed|prove|proves|proved)\b/gi;
const JOURNAL_FIRST_PERSON_RE = /\b(?:we|our|I)\b/gi;
const JOURNAL_FIRST_PERSON_SENTENCE_RE = /\b(?:we|our|I)\b/i;
const JOURNAL_PASSIVE_RE = /\b(?:is|are|was|were|been|being)\s+(?:\w+ed|shown|found|given|seen|known|taken|made|used|considered|observed|measured|performed|conducted|calculated|estimated|simulated|modeled|modelled|reported|detected|described|discussed|presented)\b/gi;
const JOURNAL_PASSIVE_SENTENCE_RE = /\b(?:is|are|was|were|been|being)\s+(?:\w+ed|shown|found|given|seen|known|taken|made|used|considered|observed|measured|performed|conducted|calculated|estimated|simulated|modeled|modelled|reported|detected|described|discussed|presented)\b/i;
const JOURNAL_CITATION_RE = /\\cite(?:\[[^\]]*\])?\{[^{}]*\}|\b(?:Figure|Table|Fig\.?)\s*\d+\b|\[\d+(?:[,-]\d+)*\]|\([^)]*(?:et al\.|\d{4})[^)]*\)/gi;
const JOURNAL_BIBLIOGRAPHIC_CITATION_RE = /\\cite(?:\[[^\]]*\])?\{[^{}]*\}|\[\d+(?:[,-]\d+)*\]|\([^)]*(?:et al\.|\d{4})[^)]*\)/gi;
const JOURNAL_FIGURE_TABLE_REFERENCE_RE = /\b(?:Figure|Table|Fig\.?)\s*\d+\b/gi;
function canonicalSectionName(name) {
    const n = name.trim().toLowerCase().replace(/&/g, 'and');
    if (n === 'method' || n === 'methods' || n === 'methodology' ||
        n === 'materials and methods' || n === 'materials and method' ||
        n === 'material and methods' || n === 'methods and materials' ||
        n === 'experimental methods' || n === 'experimental setup' ||
        n === 'model' || n === 'modeling' || n === 'modelling' ||
        n === 'numerical model' || n === 'numerical modeling' || n === 'numerical modelling')
        return 'methods';
    if (n === 'conclusion' || n === 'conclusions' || n === 'summary' || n === 'concluding remarks')
        return 'conclusion';
    if (n === 'result' || n === 'findings')
        return 'results';
    if (n === 'results and discussion' || n === 'results & discussion' || n === 'results and discussions')
        return 'results_discussion';
    if (n === 'background' || n === 'introduction and background' || n === 'introduction and motivation')
        return 'introduction';
    return n;
}
/** v1.6：轻量 rhetorical move 检测（零 LLM，按句匹配模式，返回去重后的 move 序列）
 *  v1.6.2：修复中文 \b 边界问题；results_discussion 同时支持 Results + Discussion 两套 move。
 */
export function detectRhetoricalMoves(text, sectionName) {
    const section = (sectionName ?? '').toLowerCase();
    const moves = [];
    const pushMove = (move) => {
        if (moves[moves.length - 1] !== move)
            moves.push(move);
    };
    const sentences = splitSentences(text);
    const isIntro = section.includes('introduction') || section.includes('background');
    const isCombined = section.includes('result') && section.includes('discussion');
    const isDiscussion = section.includes('discussion') || section.includes('conclusion');
    const isResults = section.includes('result');
    const isMethods = section.includes('method');
    // 中英文分开写：中文不能放在 \b ... \b 里（JS \b 对 CJK 无效）
    const introBackgroundEn = /\b(?:in recent years|over the past|has become|is (?:important|critical|essential)|plays? a (?:key|critical|important|major) role|background)\b/i;
    const introBackgroundZh = /(?:随着|近年来|在过去的|变得|具有重要|至关重要|背景)/;
    const introGapEn = /\b(?:however|yet|remains? (?:unclear|poorly understood|unknown)|little is known|few studies|no studies|a gap|limited research)\b/i;
    const introGapZh = /(?:缺乏|尚未|仍然|不足|鲜有|少有|空白)/;
    const introObjectiveEn = /\b(?:this (?:study|paper|work|review) (?:aims?|presents?|proposes?|investigates?|reviews?)|we aim|our aim|the purpose)\b/i;
    const introObjectiveZh = /(?:本文|本研究)(?:旨在|目的是)|我们(?:旨在|试图|拟|希望)/;
    const introMethodEn = /\b(?:we (?:used|applied|developed|proposed|performed)|this (?:study|paper) (?:uses|applies|develops))\b/i;
    const introMethodZh = /(?:本文|我们)(?:采用|使用|提出|构建|基于)/;
    const discussionSummaryEn = /\b(?:in summary|in conclusion|taken together|overall)\b/i;
    const discussionSummaryZh = /(?:综上所述|总的来说|总之)/;
    const discussionInterpretEn = /\b(?:suggests?|indicates?|demonstrates?|implies?|shows?)\b/i;
    const discussionInterpretZh = /(?:表明|说明|意味着|支持|证实)/;
    const discussionLimitEn = /\b(?:limitation|limited|caveat|however|should be interpreted)\b/i;
    const discussionLimitZh = /(?:局限|不足|限制|需要谨慎)/;
    const discussionImplicationEn = /\b(?:implication|practical (?:implications?|significance)|important for)\b/i;
    const discussionImplicationZh = /(?:意义|启示|对.*具有重要意义)/;
    const discussionFutureEn = /\b(?:future (?:work|research|studies)|further (?:work|research|studies)|next step)\b/i;
    const discussionFutureZh = /(?:未来|下一步|后续)/;
    const resultsFindingEn = /\b(?:we (?:found|observed)|the results (?:show|indicate|demonstrate)|results? (?:shows?|indicate|demonstrate))\b/i;
    const resultsFindingZh = /(?:发现|结果表明|结果显示)/;
    const resultsComparisonEn = /\b(?:compared with|compared to|in contrast|versus)\b/i;
    const resultsComparisonZh = /(?:与.*相比|对比|而)/;
    const resultsUnexpectedEn = /\b(?:surprisingly|unexpectedly|interestingly)\b/i;
    const resultsUnexpectedZh = /(?:值得注意的是|出乎意料)/;
    const methodsSetupEn = /\b(?:we (?:used|employed|applied)|this (?:study|work) (?:uses|employs))\b/i;
    const methodsSetupZh = /(?:本文(?:采用|使用)|实验(?:采用|使用)|方法)/;
    const methodsDataEn = /\b(?:data|dataset|samples?|materials?)\b/i;
    const methodsDataZh = /(?:数据|样本|材料)/;
    const methodsAnalysisEn = /\b(?:analysis|analyses|model|simulation)\b/i;
    const methodsAnalysisZh = /(?:统计|分析|模型|模拟)/;
    for (const s of sentences) {
        if (isIntro) {
            if (introBackgroundEn.test(s) || introBackgroundZh.test(s))
                pushMove('background');
            else if (introGapEn.test(s) || introGapZh.test(s))
                pushMove('gap');
            else if (introObjectiveEn.test(s) || introObjectiveZh.test(s))
                pushMove('objective');
            else if (introMethodEn.test(s) || introMethodZh.test(s))
                pushMove('method');
        }
        else if (isCombined) {
            // Results & Discussion：先识别 Results move，再识别 Discussion move
            if (resultsFindingEn.test(s) || resultsFindingZh.test(s))
                pushMove('finding');
            else if (resultsComparisonEn.test(s) || resultsComparisonZh.test(s))
                pushMove('comparison');
            else if (resultsUnexpectedEn.test(s) || resultsUnexpectedZh.test(s))
                pushMove('unexpected');
            else if (discussionSummaryEn.test(s) || discussionSummaryZh.test(s))
                pushMove('summary');
            else if (discussionInterpretEn.test(s) || discussionInterpretZh.test(s))
                pushMove('interpretation');
            else if (discussionLimitEn.test(s) || discussionLimitZh.test(s))
                pushMove('limitation');
            else if (discussionImplicationEn.test(s) || discussionImplicationZh.test(s))
                pushMove('implication');
            else if (discussionFutureEn.test(s) || discussionFutureZh.test(s))
                pushMove('future');
        }
        else if (isDiscussion) {
            if (discussionSummaryEn.test(s) || discussionSummaryZh.test(s))
                pushMove('summary');
            else if (discussionInterpretEn.test(s) || discussionInterpretZh.test(s))
                pushMove('interpretation');
            else if (discussionLimitEn.test(s) || discussionLimitZh.test(s))
                pushMove('limitation');
            else if (discussionImplicationEn.test(s) || discussionImplicationZh.test(s))
                pushMove('implication');
            else if (discussionFutureEn.test(s) || discussionFutureZh.test(s))
                pushMove('future');
        }
        else if (isResults) {
            if (resultsFindingEn.test(s) || resultsFindingZh.test(s))
                pushMove('finding');
            else if (resultsComparisonEn.test(s) || resultsComparisonZh.test(s))
                pushMove('comparison');
            else if (resultsUnexpectedEn.test(s) || resultsUnexpectedZh.test(s))
                pushMove('unexpected');
        }
        else if (isMethods) {
            if (methodsSetupEn.test(s) || methodsSetupZh.test(s))
                pushMove('setup');
            else if (methodsDataEn.test(s) || methodsDataZh.test(s))
                pushMove('data');
            else if (methodsAnalysisEn.test(s) || methodsAnalysisZh.test(s))
                pushMove('analysis');
        }
    }
    return moves;
}
function computeSectionSample(text) {
    const sentences = splitSentences(text);
    const sentenceLengths = sentences.map((s) => countWords(s));
    const paragraphs = text
        .split(/\n{2,}/)
        .map((p) => countWords(p.trim()))
        .filter((n) => n > 0);
    const words = countWords(text);
    const perK = (n) => (words > 0 ? round2((n / words) * 1000) : 0);
    const firstPersonSentenceCount = sentences.filter((s) => JOURNAL_FIRST_PERSON_SENTENCE_RE.test(s)).length;
    const passiveSentenceCount = sentences.filter((s) => JOURNAL_PASSIVE_SENTENCE_RE.test(s)).length;
    // v1.5：复用 ClaimSpan 提取 epistemic fingerprint，不再只数 regex 词频
    // v1.6.2：区分 spanDensity（所有 proposition spans）与 recognizedClaimDensity（明确 scientific claim）
    const spans = sentences.flatMap((s) => extractClaimSpans(s));
    const claimCount = spans.length;
    const recognizedClaims = spans.filter((c) => c.spanKind === 'claim');
    const ratioOf = (pred) => (claimCount > 0 ? round2(spans.filter(pred).length / claimCount) : 0);
    return {
        name: '',
        words,
        sentenceLengthMedian: medianOf(sentenceLengths),
        sentenceLengthStd: stdOf(sentenceLengths),
        paragraphLengthMedian: medianOf(paragraphs),
        paragraphLengthStd: stdOf(paragraphs),
        hedgeDensity: perK((text.match(JOURNAL_HEDGE_RE) ?? []).length),
        causalForce: perK((text.match(JOURNAL_CAUSAL_RE) ?? []).length),
        evidentialForce: perK((text.match(JOURNAL_EVIDENCE_RE) ?? []).length),
        firstPersonSentenceRatio: sentences.length > 0 ? round2(firstPersonSentenceCount / sentences.length) : 0,
        passiveSentenceRatio: sentences.length > 0 ? round2(passiveSentenceCount / sentences.length) : 0,
        citationDensity: perK((text.match(JOURNAL_CITATION_RE) ?? []).length),
        bibliographicCitationDensity: perK((text.match(JOURNAL_BIBLIOGRAPHIC_CITATION_RE) ?? []).length),
        figureTableReferenceDensity: perK((text.match(JOURNAL_FIGURE_TABLE_REFERENCE_RE) ?? []).length),
        claimCount,
        claimDensity: perK(claimCount),
        spanDensity: perK(claimCount),
        recognizedClaimDensity: perK(recognizedClaims.length),
        highCausalDensity: perK(spans.filter((c) => c.causalLevel >= 4).length),
        hedgedClaimDensity: perK(spans.filter((c) => c.hedged).length),
        strongEvidentialDensity: perK(spans.filter((c) => c.evidentialLevel >= 4).length),
        highCausalRatio: ratioOf((c) => c.causalLevel >= 4),
        hedgedClaimRatio: ratioOf((c) => c.hedged),
        strongEvidentialRatio: ratioOf((c) => c.evidentialLevel >= 4),
        scopeQualifiedRatio: ratioOf((c) => c.scopeMarkers.length > 0),
        nullFindingRatio: ratioOf((c) => c.nullMarkers.length > 0 || c.negationMarkers.length > 0),
    };
}
function aggregateSectionProfiles(samples) {
    const groups = new Map();
    for (const s of samples) {
        const key = s.name.toLowerCase();
        let g = groups.get(key);
        if (!g) {
            g = { docs: new Set(), samples: [] };
            groups.set(key, g);
        }
        g.docs.add(s.docIndex);
        g.samples.push(s);
    }
    const out = [];
    for (const [name, g] of groups) {
        out.push({
            name,
            articleCount: g.docs.size,
            sentenceLength: computeDistribution(g.samples.map((s) => s.sentenceLengthMedian)),
            paragraphLength: computeDistribution(g.samples.map((s) => s.paragraphLengthMedian)),
            hedgeDensity: computeDistribution(g.samples.map((s) => s.hedgeDensity)),
            causalForce: computeDistribution(g.samples.map((s) => s.causalForce)),
            evidentialForce: computeDistribution(g.samples.map((s) => s.evidentialForce)),
            firstPersonUsage: computeDistribution(g.samples.map((s) => s.firstPersonSentenceRatio)),
            passiveVoice: computeDistribution(g.samples.map((s) => s.passiveSentenceRatio)),
            citationDensity: computeDistribution(g.samples.map((s) => s.citationDensity)),
            bibliographicCitationDensity: computeDistribution(g.samples.map((s) => s.bibliographicCitationDensity)),
            figureTableReferenceDensity: computeDistribution(g.samples.map((s) => s.figureTableReferenceDensity)),
            claimCount: computeDistribution(g.samples.map((s) => s.claimCount)),
            claimDensity: computeDistribution(g.samples.map((s) => s.claimDensity)),
            spanDensity: computeDistribution(g.samples.map((s) => s.spanDensity)),
            recognizedClaimDensity: computeDistribution(g.samples.map((s) => s.recognizedClaimDensity)),
            highCausalDensity: computeDistribution(g.samples.map((s) => s.highCausalDensity)),
            hedgedClaimDensity: computeDistribution(g.samples.map((s) => s.hedgedClaimDensity)),
            strongEvidentialDensity: computeDistribution(g.samples.map((s) => s.strongEvidentialDensity)),
            highCausalRatio: computeDistribution(g.samples.map((s) => s.highCausalRatio)),
            hedgedClaimRatio: computeDistribution(g.samples.map((s) => s.hedgedClaimRatio)),
            strongEvidentialRatio: computeDistribution(g.samples.map((s) => s.strongEvidentialRatio)),
            scopeQualifiedRatio: computeDistribution(g.samples.map((s) => s.scopeQualifiedRatio)),
            nullFindingRatio: computeDistribution(g.samples.map((s) => s.nullFindingRatio)),
        });
    }
    return out;
}
function aggregateGlobalSamples(samples) {
    return {
        sentenceStyle: {
            sentenceLength: computeDistribution(samples.map((s) => s.sentenceLengthMedian)),
            sentenceLengthVariance: computeDistribution(samples.map((s) => s.sentenceLengthStd)),
            passiveVoice: computeDistribution(samples.map((s) => s.passiveSentenceRatio)),
            firstPersonUsage: computeDistribution(samples.map((s) => s.firstPersonSentenceRatio)),
        },
        paragraphStyle: {
            paragraphLength: computeDistribution(samples.map((s) => s.paragraphLengthMedian)),
            paragraphVariance: computeDistribution(samples.map((s) => s.paragraphLengthStd)),
        },
        epistemics: {
            causalForce: computeDistribution(samples.map((s) => s.causalForce)),
            evidentialForce: computeDistribution(samples.map((s) => s.evidentialForce)),
            hedgeDensity: computeDistribution(samples.map((s) => s.hedgeDensity)),
            claimCount: computeDistribution(samples.map((s) => s.claimCount)),
            claimDensity: computeDistribution(samples.map((s) => s.claimDensity)),
            spanDensity: computeDistribution(samples.map((s) => s.spanDensity)),
            recognizedClaimDensity: computeDistribution(samples.map((s) => s.recognizedClaimDensity)),
            highCausalDensity: computeDistribution(samples.map((s) => s.highCausalDensity)),
            hedgedClaimDensity: computeDistribution(samples.map((s) => s.hedgedClaimDensity)),
            strongEvidentialDensity: computeDistribution(samples.map((s) => s.strongEvidentialDensity)),
            highCausalRatio: computeDistribution(samples.map((s) => s.highCausalRatio)),
            hedgedClaimRatio: computeDistribution(samples.map((s) => s.hedgedClaimRatio)),
            strongEvidentialRatio: computeDistribution(samples.map((s) => s.strongEvidentialRatio)),
            scopeQualifiedRatio: computeDistribution(samples.map((s) => s.scopeQualifiedRatio)),
            nullFindingRatio: computeDistribution(samples.map((s) => s.nullFindingRatio)),
        },
        citations: {
            density: computeDistribution(samples.map((s) => s.citationDensity)),
            bibliographicDensity: computeDistribution(samples.map((s) => s.bibliographicCitationDensity)),
            figureTableDensity: computeDistribution(samples.map((s) => s.figureTableReferenceDensity)),
            sectionDistribution: {},
        },
    };
}
function computeRhetoricProfile(observations) {
    const sectionGroups = new Map();
    const allMoveCounts = new Map();
    for (const obs of observations) {
        let g = sectionGroups.get(obs.section);
        if (!g) {
            g = { docs: new Set(), sequences: [] };
            sectionGroups.set(obs.section, g);
        }
        g.docs.add(obs.docIndex);
        g.sequences.push(obs.moves);
        for (const m of new Set(obs.moves))
            allMoveCounts.set(m, (allMoveCounts.get(m) ?? 0) + 1);
    }
    const sectionMoves = {};
    const sectionTransitions = {};
    const sectionSequences = {};
    // 兼容旧版：全局 transitions（由所有 section 汇总）
    const globalTransitionsMap = new Map();
    const globalFromCounts = new Map();
    for (const [section, g] of sectionGroups) {
        const counts = new Map();
        const secTransMap = new Map();
        const secFromCounts = new Map();
        for (const seq of g.sequences) {
            for (const m of new Set(seq))
                counts.set(m, (counts.get(m) ?? 0) + 1);
            for (let i = 0; i + 1 < seq.length; i++) {
                const from = seq[i];
                const to = seq[i + 1];
                if (!secTransMap.has(from))
                    secTransMap.set(from, new Map());
                secTransMap.get(from).set(to, (secTransMap.get(from).get(to) ?? 0) + 1);
                secFromCounts.set(from, (secFromCounts.get(from) ?? 0) + 1);
                if (!globalTransitionsMap.has(from))
                    globalTransitionsMap.set(from, new Map());
                globalTransitionsMap.get(from).set(to, (globalTransitionsMap.get(from).get(to) ?? 0) + 1);
                globalFromCounts.set(from, (globalFromCounts.get(from) ?? 0) + 1);
            }
        }
        sectionMoves[section] = [...counts.entries()]
            .map(([move, count]) => ({ move, frequency: g.docs.size > 0 ? round2(count / g.docs.size) : 0 }))
            .sort((a, b) => b.frequency - a.frequency);
        // v1.6.2：section-bound transitions
        const secTransitions = [];
        for (const [from, tos] of secTransMap) {
            const total = secFromCounts.get(from) ?? 0;
            for (const [to, count] of tos) {
                secTransitions.push({ from, to, probability: total > 0 ? round2(count / total) : 0 });
            }
        }
        sectionTransitions[section] = secTransitions;
        // v1.6.2：medoid rhetorical sequence——不按频率排序拼顺序，而是选 corpus 中真实存在、
        // 与其他序列平均 LCS 相似度最高的那条序列作为 canonical order。
        const seqs = g.sequences;
        if (seqs.length > 0) {
            let bestIdx = 0;
            let bestSim = -1;
            for (let i = 0; i < seqs.length; i++) {
                let sum = 0;
                for (let j = 0; j < seqs.length; j++) {
                    const denom = Math.max(seqs[i].length, seqs[j].length, 1);
                    sum += lcsLength(seqs[i], seqs[j]) / denom;
                }
                const mean = sum / seqs.length;
                if (mean > bestSim) {
                    bestSim = mean;
                    bestIdx = i;
                }
            }
            sectionSequences[section] = {
                medoid: [...seqs[bestIdx]],
                meanSimilarity: round2(bestSim),
            };
        }
    }
    const transitions = [];
    for (const [from, tos] of globalTransitionsMap) {
        const total = globalFromCounts.get(from) ?? 0;
        for (const [to, count] of tos) {
            transitions.push({ from, to, probability: total > 0 ? round2(count / total) : 0 });
        }
    }
    const moves = [...allMoveCounts.entries()]
        .map(([move, count]) => ({ move, frequency: observations.length > 0 ? round2(count / observations.length) : 0 }))
        .sort((a, b) => b.frequency - a.frequency);
    return { moves, sectionMoves, sectionTransitions, sectionSequences, transitions };
}
/**
 * 每篇论文独立 preprocess / detectSections，再按 canonical section 跨论文聚合。
 * 输出只包含抽象统计特征，不保存论文原句。
 */
export function computeJournalProfileFromDocuments(documents, opts) {
    const sectionSamples = [];
    const globalSamples = [];
    const rhetoricObservations = [];
    let parsed = 0;
    documents.forEach((doc, docIndex) => {
        try {
            const view = preprocess(doc.text);
            const sections = detectSections(view);
            if (sections.length === 0) {
                const s = computeSectionSample(view.prose);
                s.name = canonicalSectionName('unknown');
                s.docIndex = docIndex;
                sectionSamples.push(s);
                rhetoricObservations.push({ section: s.name, moves: detectRhetoricalMoves(view.prose, s.name), docIndex });
            }
            else {
                for (const sec of sections) {
                    const s = computeSectionSample(sec.text);
                    s.name = canonicalSectionName(sec.name);
                    s.docIndex = docIndex;
                    sectionSamples.push(s);
                    rhetoricObservations.push({ section: s.name, moves: detectRhetoricalMoves(sec.text, sec.name), docIndex });
                }
            }
            globalSamples.push(computeSectionSample(view.prose));
            parsed += 1;
        }
        catch {
            // 单篇解析失败跳过，不影响其他论文
        }
    });
    const sectionProfiles = aggregateSectionProfiles(sectionSamples);
    const sectionLengths = sectionSamples.map((s) => s.words);
    const global = aggregateGlobalSamples(globalSamples);
    return {
        metadata: {
            journal: opts?.journal ?? 'custom-journal',
            articleType: opts?.articleType,
            discipline: opts?.discipline,
            sampleSize: opts?.sampleSize ?? parsed,
            profileVersion: '1.6.2',
            corpusDate: new Date().toISOString().slice(0, 10),
        },
        structure: {
            sections: sectionProfiles,
            sectionLengthDistribution: computeDistribution(sectionLengths),
        },
        rhetoric: computeRhetoricProfile(rhetoricObservations),
        epistemics: global.epistemics,
        sentenceStyle: global.sentenceStyle,
        paragraphStyle: global.paragraphStyle,
        citations: global.citations,
    };
}
/**
 * 从目标期刊代表论文语料蒸馏 Journal Profile（单文档兼容入口）。
 * 输入可以是一篇或多篇代表论文的拼接文本；推荐多篇时改用 computeJournalProfileFromDocuments。
 */
export function computeJournalProfile(text, opts) {
    return computeJournalProfileFromDocuments([{ text }], opts);
}
function journalMetricScore(current, dist, opts) {
    if (!dist || dist.count < 1)
        return null;
    const expected = dist.median;
    const spread = Math.max(dist.p90 - dist.p10, Math.abs(expected) * 0.3, opts?.minSpread ?? 1);
    const diff = Math.abs(current - expected);
    const z = diff / spread;
    const score = Math.max(0, Math.round(100 - z * 25));
    const status = score >= 80 ? 'ok' : score >= 55 ? 'warn' : 'diff';
    return { score, status };
}
function journalFitConfidence(n) {
    if (!n || n < 3)
        return 'very_low';
    if (n < 8)
        return 'low';
    if (n < 20)
        return 'medium';
    return 'high';
}
function lcsLength(a, b) {
    const n = a.length;
    const m = b.length;
    const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
    }
    return dp[n][m];
}
function journalMetricGroup(metric) {
    if (metric.includes('句长') || metric.includes('段长') || metric.includes('sentence') || metric.includes('paragraph'))
        return '句法结构';
    if (metric.includes('第一人称') || metric.includes('被动') || metric.includes('first person') || metric.includes('passive'))
        return '语态人称';
    if (metric.includes('引用') || metric.includes('citation'))
        return '引用';
    if (metric.includes('claim') || metric.includes('span') || metric.includes('主张') || metric.includes('scope') || metric.includes('零结果') || metric.includes('hedge') || metric.includes('因果') || metric.includes('证据'))
        return '科学主张';
    if (metric.includes('rhetorical') || metric.includes('修辞') || metric.includes('move'))
        return '修辞结构';
    return '其他';
}
/** v1.6.2：Journal Fit 分组权重（避免“哪个模块 metric 多，哪个模块权重就高”的隐式加权） */
const JOURNAL_FIT_GROUP_WEIGHTS = {
    句法结构: 0.2,
    语态人称: 0.1,
    引用: 0.15,
    科学主张: 0.35,
    修辞结构: 0.2,
    其他: 0,
};
/** 将当前稿件与目标期刊 Profile 对比，输出 section-level Journal Fit 报告 */
export function auditJournalFit(text, profile) {
    const view = preprocess(text);
    const sections = detectSections(view);
    const profileSections = new Map(profile.structure.sections.map((s) => [s.name.toLowerCase(), s]));
    const warnings = [];
    const fitSections = [];
    const corpusSize = profile.metadata.sampleSize ?? Math.max(0, ...profile.structure.sections.map((s) => s.articleCount));
    for (const sec of sections) {
        const name = canonicalSectionName(sec.name);
        const cur = computeSectionSample(sec.text);
        cur.name = name;
        const prof = profileSections.get(name);
        if (!prof) {
            warnings.push(`当前稿件章节 "${sec.name}" 未出现在目标期刊 Profile 中（Profile 章节：${[...profileSections.keys()].join(' / ') || '无'}）`);
            continue;
        }
        const metrics = [];
        const addMetric = (metric, current, dist, minSpread) => {
            const r = journalMetricScore(current, dist, minSpread === undefined ? undefined : { minSpread });
            if (!r)
                return;
            metrics.push({
                metric,
                current: round2(current),
                expected: dist.median,
                p10: dist.p10,
                p90: dist.p90,
                score: r.score,
                status: r.status,
            });
        };
        addMetric('句长中位数', cur.sentenceLengthMedian, prof.sentenceLength);
        addMetric('段长中位数', cur.paragraphLengthMedian, prof.paragraphLength);
        addMetric('第一人称句子比例', cur.firstPersonSentenceRatio, prof.firstPersonUsage, 0.05);
        addMetric('被动语态句子比例', cur.passiveSentenceRatio, prof.passiveVoice, 0.05);
        addMetric('文献引用密度', cur.bibliographicCitationDensity, prof.bibliographicCitationDensity);
        addMetric('图表引用密度', cur.figureTableReferenceDensity, prof.figureTableReferenceDensity);
        // v1.5 Epistemic Journal Fingerprint（v1.6.1 起主分数不再使用旧 regex hedge/causal/evidence 密度）
        // v1.5 Epistemic Journal Fingerprint（v1.6.2：新增 spanDensity / recognizedClaimDensity / 密度口径）
        addMetric('claim 密度', cur.claimDensity, prof.claimDensity);
        addMetric('span 密度', cur.spanDensity, prof.spanDensity);
        addMetric('识别科学主张密度', cur.recognizedClaimDensity, prof.recognizedClaimDensity);
        addMetric('高因果主张密度', cur.highCausalDensity, prof.highCausalDensity);
        addMetric('hedge 主张密度', cur.hedgedClaimDensity, prof.hedgedClaimDensity);
        addMetric('强证据主张密度', cur.strongEvidentialDensity, prof.strongEvidentialDensity);
        addMetric('高因果主张比例', cur.highCausalRatio, prof.highCausalRatio, 0.05);
        addMetric('hedge 主张比例', cur.hedgedClaimRatio, prof.hedgedClaimRatio, 0.05);
        addMetric('强证据主张比例', cur.strongEvidentialRatio, prof.strongEvidentialRatio, 0.05);
        addMetric('scope 限定主张比例', cur.scopeQualifiedRatio, prof.scopeQualifiedRatio, 0.05);
        addMetric('零结果/否定主张比例', cur.nullFindingRatio, prof.nullFindingRatio, 0.05);
        // v1.6 Rhetorical Moves
        const currentMoves = detectRhetoricalMoves(sec.text, sec.name);
        const profileMoves = profile.rhetoric.sectionMoves?.[name] ?? [];
        // v1.6.2：优先使用 medoid sequence（corpus 真实存在的最具代表性顺序），
        // 不再把 frequency-sorted move list 当作“目标顺序”。
        const medoidSeq = profile.rhetoric.sectionSequences?.[name]?.medoid;
        const expectedMoves = medoidSeq && medoidSeq.length > 0
            ? medoidSeq
            : profileMoves.filter((m) => m.frequency >= 0.3).map((m) => m.move);
        const moveCoverage = expectedMoves.length > 0
            ? expectedMoves.filter((m) => currentMoves.includes(m)).length / expectedMoves.length
            : 1;
        const orderSim = (expectedMoves.length > 0 || currentMoves.length > 0)
            ? lcsLength(currentMoves, expectedMoves) / Math.max(expectedMoves.length, currentMoves.length)
            : 1;
        const moveCoverageScore = Math.round(moveCoverage * 100);
        const orderScore = Math.round(orderSim * 100);
        metrics.push({
            metric: 'rhetorical move coverage',
            current: round2(moveCoverage),
            expected: 1,
            score: moveCoverageScore,
            status: moveCoverageScore >= 80 ? 'ok' : moveCoverageScore >= 55 ? 'warn' : 'diff',
        });
        metrics.push({
            metric: 'rhetorical order fit',
            current: round2(orderSim),
            expected: 1,
            score: orderScore,
            status: orderScore >= 80 ? 'ok' : orderScore >= 55 ? 'warn' : 'diff',
        });
        // v1.6.2：transition likelihood——不只是“顺序对不对”，还看每个 move transition
        // 在目标期刊 corpus 中的出现概率；未出现过的 transition 按 0 计，避免只奖励 LCS 命中。
        const sectionTransitions = profile.rhetoric.sectionTransitions?.[name] ?? [];
        const transitionProb = new Map();
        for (const t of sectionTransitions) {
            if (!transitionProb.has(t.from))
                transitionProb.set(t.from, new Map());
            transitionProb.get(t.from).set(t.to, t.probability);
        }
        let transitionSum = 0;
        let transitionCount = 0;
        for (let i = 0; i + 1 < currentMoves.length; i++) {
            const from = currentMoves[i];
            const to = currentMoves[i + 1];
            const prob = transitionProb.get(from)?.get(to) ?? 0;
            transitionSum += prob;
            transitionCount += 1;
        }
        const transitionFit = transitionCount > 0 ? transitionSum / transitionCount : 1;
        const transitionScore = Math.round(transitionFit * 100);
        metrics.push({
            metric: 'rhetorical transition fit',
            current: round2(transitionFit),
            expected: 1,
            score: transitionScore,
            status: transitionScore >= 80 ? 'ok' : transitionScore >= 55 ? 'warn' : 'diff',
        });
        // v1.6.2：按指标分组加权，而不是所有 metric 简单平均
        const groups = new Map();
        for (const m of metrics) {
            const g = journalMetricGroup(m.metric);
            m.group = g;
            if (!groups.has(g))
                groups.set(g, []);
            groups.get(g).push(m.score);
        }
        let weightedSum = 0;
        let totalWeight = 0;
        for (const [g, scores] of groups) {
            const groupAvg = scores.reduce((a, b) => a + b, 0) / scores.length;
            const w = JOURNAL_FIT_GROUP_WEIGHTS[g] ?? 0;
            weightedSum += groupAvg * w;
            totalWeight += w;
        }
        const score = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
        fitSections.push({ name: sec.name, score, metrics, articleCount: prof.articleCount });
    }
    const overall = fitSections.length > 0 ? Math.round(fitSections.reduce((a, s) => a + s.score, 0) / fitSections.length) : 0;
    return {
        journal: profile.metadata.journal,
        overall,
        confidence: journalFitConfidence(corpusSize),
        corpusSize,
        sections: fitSections,
        warnings,
    };
}
const SCHOLARSHIP_EXTRACTORS = [
    ['cite', /\\cite\*?\{[^{}]*\}/g],
    ['ref', /\\ref\*?\{[^{}]*\}/g],
    ['figure', /\bFigures?\s*\d+[a-z]?\b/gi],
    ['table', /\bTables?\s*\d+[a-z]?\b/gi],
    ['percent', /\b\d+(?:\.\d+)?\s*%/g],
    ['pvalue', /\bp\s*[<≤=]\s*0?\.?\d+/gi],
    ['ci', /\b\d+(?:\.\d+)?\s*[–—-]\s*\d+(?:\.\d+)?\s*(?:CI|%|m|mm|nm|mL|ml|mg|µg|kg|g|s|ms|h|d|°C|K)\b/g],
    ['doi', /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/gi],
    ['number', /\b\d+(?:\.\d+)?\s*(?:mm|nm|cm|km|kg|g|mg|µg|μg|mL|ml|L|s|ms|h|d|°C|K|Hz|kHz|MHz|V|W|J|mol|M)\b/g],
];
/** 提取文本中的科研实体（Scholarship Lock 的数据源） */
export function extractScholarshipEntities(text) {
    const out = [];
    for (const [type, re] of SCHOLARSHIP_EXTRACTORS) {
        for (const m of text.matchAll(re))
            out.push({ type, value: m[0].trim() });
    }
    return out;
}
/**
 * 多重集差异：按出现次数而不是集合去重，避免“两个相同数值中改掉一个”
 * 被漏报（例如 before 有 5 mm、5 mm，after 有 5 mm、6 mm，应报 5 mm → 6 mm）。
 * 返回值保留原顺序，便于数值类实体按顺序配对。
 */
function diffValueLists(beforeValues, afterValues) {
    const bCounts = new Map();
    const aCounts = new Map();
    for (const v of beforeValues)
        bCounts.set(v, (bCounts.get(v) ?? 0) + 1);
    for (const v of afterValues)
        aCounts.set(v, (aCounts.get(v) ?? 0) + 1);
    const removed = beforeValues.filter((v) => {
        const bCount = bCounts.get(v) ?? 0;
        const aCount = aCounts.get(v) ?? 0;
        if (bCount > aCount) {
            bCounts.set(v, bCount - 1);
            return true;
        }
        return false;
    });
    const added = afterValues.filter((v) => {
        const aCount = aCounts.get(v) ?? 0;
        const bCount = bCounts.get(v) ?? 0;
        if (aCount > bCount) {
            aCounts.set(v, aCount - 1);
            return true;
        }
        return false;
    });
    return { removed, added };
}
/** v0.6 Scholarship Lock：对比修改前后的科研事实（数字/引用/图表编号/DOI） */
export function diffScholarship(before, after) {
    const changed = [];
    const removed = [];
    const added = [];
    const types = ['cite', 'ref', 'figure', 'table', 'percent', 'pvalue', 'ci', 'doi', 'number'];
    for (const t of types) {
        const bv = extractScholarshipEntities(before).filter((e) => e.type === t).map((e) => e.value);
        const av = extractScholarshipEntities(after).filter((e) => e.type === t).map((e) => e.value);
        const { removed: rm, added: ad } = diffValueLists(bv, av);
        // 数值类实体按顺序配对为 changed（如 87.3% → 89.1%）
        if (t === 'number' || t === 'percent' || t === 'pvalue' || t === 'ci') {
            const n = Math.min(rm.length, ad.length);
            for (let i = 0; i < n; i++)
                changed.push({ type: t, before: rm[i], after: ad[i] });
            for (const v of rm.slice(n))
                removed.push({ type: t, value: v });
            for (const v of ad.slice(n))
                added.push({ type: t, value: v });
        }
        else {
            for (const v of rm)
                removed.push({ type: t, value: v });
            for (const v of ad)
                added.push({ type: t, value: v });
        }
    }
    return { changed, removed, added };
}
/** v1.2.3：Global Scholarship Inventory——raw multiset conservation，完全不 pairing。
 *  大版本对比时不声称 "5 mg → 6 mg" 是一一对应（顺序配对在全文重写下不可靠），
 *  只报"移除 N / 新增 M"。遍历全部 ScholarshipType（number/percent/pvalue/ci/
 *  cite/ref/figure/table/doi），避免手写清单与 engine 分叉。 */
export function diffScholarshipInventory(before, after) {
    const out = {};
    const types = ['number', 'percent', 'pvalue', 'ci', 'cite', 'ref', 'figure', 'table', 'doi'];
    for (const t of types) {
        const bv = extractScholarshipEntities(before).filter((e) => e.type === t).map((e) => e.value);
        const av = extractScholarshipEntities(after).filter((e) => e.type === t).map((e) => e.value);
        const { removed, added } = diffValueLists(bv, av);
        out[t] = { removed: removed.length, added: added.length };
    }
    return out;
}
const SCHOLARSHIP_TYPE_LABEL = {
    number: '带单位数值', percent: '百分数', pvalue: 'p 值', ci: '置信区间',
    cite: '\\cite 引用', ref: '\\ref 引用', figure: 'Figure 编号', table: 'Table 编号', doi: 'DOI',
};
/** 因果力阶梯（0=不确定 … 5=因果）。demonstrate/prove/establish/confirm 等是证据力词，不在本轴。
 *  注意：全部使用非捕获组 (?:...)——.match() 无 /g 时捕获组会把组内容混进结果数组 */
const CAUSAL_LADDER = [
    { level: 0, type: 'uncertainty', pattern: /\b(?:consistent with|compatible with|appears? to|seems? to)\b/gi },
    { level: 1, type: 'association', pattern: /\b(?:associat(?:es|ed|ion)? (?:with|between)|relat(?:es|ed)? to|correlat(?:es|ed|ion)? (?:with|between)|link(?:s|ed)? to|co-?occur(?:s|red)? with)\b/gi },
    { level: 2, type: 'prediction', pattern: /\b(?:predict(?:s|ed|ion)?|forecast(?:s|ed)?|anticipat(?:es|ed)?)\b/gi },
    { level: 3, type: 'contribution', pattern: /\b(?:contribut(?:es|ed|ing)? to|plays? a role in|is involved in)\b/gi },
    { level: 4, type: 'effect', pattern: /\b(?:affect(?:s|ed)?|lead(?:s|ing)? to|led to|reduc(?:es|ed|e)?|increas(?:es|ed|e)?|decreas(?:es|ed|e)?|improv(?:es|ed|e)?|lower(?:s|ed)?|alter(?:s|ed)?|modif(?:ies|ied|y)?|influenc(?:es|ed|e)?|result(?:s|ing)? in|resulted in|promot(?:es|ed|e)?|inhibit(?:s|ed)?|enhanc(?:es|ed|e)?|suppress(?:es|ed)?|trigger(?:s|ed)?|accelerat(?:es|ed|e)?|attenuat(?:es|ed|e)?|impair(?:s|ed)?|boost(?:s|ed)?)\b/gi },
    { level: 5, type: 'causation', pattern: /\b(?:caus(?:es|ed|e)?|determin(?:es|ed|e)?|results? from|stems? from|driv(?:es|en)? by)\b/gi },
];
/** 证据力阶梯（0=无证据动词，1=建议 … 7=证明/保证）。非捕获组；/g 供 matchAll（v0.9.3）。 */
const EVIDENTIAL_LADDER = [
    { level: -1, pattern: /\b(?:may|might|could|possibly|potentially)\b/gi },
    { level: 1, pattern: /\b(?:suggests?|suggested)\b/gi },
    { level: 2, pattern: /\b(?:indicates?|indicated)\b/gi },
    { level: 3, pattern: /\b(?:supports?|supported|supportive)\b/gi },
    { level: 4, pattern: /\b(?:shows?|showed|shown)\b/gi },
    { level: 5, pattern: /\b(?:demonstrates?|demonstrated|demonstrating)\b/gi },
    { level: 6, pattern: /\b(?:establishes?|established|confirms?|confirmed)\b/gi },
    { level: 7, pattern: /\b(?:proves?|proved|proven|proof|guarantees?|guaranteed)\b/gi },
];
// 注意：以下只用于 .match() 提取 markers（/g 返回全部匹配，无 lastIndex 状态问题）
const NEGATION_RE = /\b(?:no|not|did not|does not|do not|without|neither|never|non-?significant|no difference|not associated|not significant|failed to|absence of|no effect|no association|no correlation)\b/gi;
const NULL_RESULT_RE = /\b(?:no significant|not significant|no difference|no effect|did not (?:improve|change|reduce|affect)|remained unchanged|failed to (?:improve|change|reduce|affect)|no association|no correlation|absence of (?:effect|association|improvement)|not associated)\b/gi;
/** scope 边界标记（EN + ZH）。消失即提示"可能被泛化"——不自动判错，只要求核验。 */
const SCOPE_RE = /(?:within this (?:sample|cohort|study|dataset)|in this (?:cohort|study|dataset|experiment|system|setup)|in our (?:experiments?|study|dataset)|under these conditions|under the (?:tested|investigated) conditions|during the (?:study|experiment) period|among participants|for the evaluated datasets?|internally validated|externally validated|for the tested (?:range|conditions)|at the tested (?:temperature|pressure|rates?)|in the investigated (?:system|range)|in the present (?:study|dataset|work)|in the current work|在本研究中|在本样本中|在该队列中|在上述条件下|在研究期间|对于本数据集|在本实验中|在当前工况下|在所研究的|在测试的|在考察的|内部验证|外部验证)/gi;
/** v1.0 证据状态标记（Evidence-Status Lock）：事实的"来源状态"——
 *  reported/observed/measured/implemented/estimated/simulated 等。
 *  "participants reported improvement" ≠ "participants improved"：
 *  状态词消失或被替换，说明修改把一种证据来源状态变成了另一种（或直接声称）。 */
const EVIDENCE_STATUS_RE = /\b(?:reported|self[\s-]?report(?:s|ed)?|observed|measured|recorded|detected|visualized|implemented|deployed|installed|estimated|simulated|modelled|modeled|calculated|derived|inferred|obtained)\b/gi;
/** 保守子句切分（分析建议：; , while whereas although but and）——v0.9 多主张检测的基础。
 *  "between X and Y / among A, B and C" 等枚举里的 and 用占位符保护，不作为子句边界。 */
const CLAUSE_SPLIT_RE = /[;,，；]|\b(?:while|whereas|although|but|and)\b/i;
const BETWEEN_AND_RE = /\b(between|among)\s+[\w-]+(?:\s+[\w-]+){0,3}\s+and\s+/gi;
const AND_PLACEHOLDER = '\uE000';
export function splitClauses(sentence) {
    // "between X and Y / among A, B and C" 等枚举里的 and 用单字符占位符保护（不触发切分正则）
    const protected_ = sentence.replace(BETWEEN_AND_RE, (m) => m.replace(/\band\b/gi, AND_PLACEHOLDER));
    return protected_
        .split(CLAUSE_SPLIT_RE)
        .map((c) => c.trim().replaceAll(AND_PLACEHOLDER, 'and'))
        .filter((c) => c.length > 0);
}
/** v1.2.2：SCOPE_RE 的无 /g 副本——.test() 用 global regex 会更新 lastIndex，
 *  连续 scope fragments 第二个可能错误 false（"In this cohort, under these conditions, …"） */
const SCOPE_TEST_RE = new RegExp(SCOPE_RE.source, SCOPE_RE.flags.replace('g', ''));
/** v1.2.1：scope-only fragment 统一判定——直接复用 SCOPE_RE（不再维护第二张表，
 *  避免 scope detector 与 scope attachment 越走越分叉），且 fragment 不含任何
 *  因果/证据主张 marker（纯 scope 短语才附着到后续 claim）。 */
function isScopeOnlyFragment(clause) {
    if (clause.length > 60)
        return false;
    if (!SCOPE_TEST_RE.test(clause))
        return false;
    for (const rung of CAUSAL_LADDER) {
        if (clause.match(rung.pattern))
            return false;
    }
    for (const rung of EVIDENTIAL_LADDER) {
        if (clause.match(rung.pattern))
            return false;
    }
    return true;
}
/** v1.2：相对从句（which/who/whose…）合并到前一个 clause（逗号切分产生的 fragment） */
const RELATIVE_CLAUSE_RE = /^(?:which|who|whose|whom|where|when)\b/i;
/** v1.2：无主语 fragment——以动词形态开头的 clause（主句谓语延续）合并到前一个 claim */
const VERB_LEAD_RE = /^(?:achieved|achieving|leads?|led|resulted|resulting|remained|remains?|was|were|is|are|followed|follows?|occurred|occurs?|became|becomes?|allowed|allowing|enabled|enabling|produced|producing|yielded|yielding)\b/i;
/** v1.2：fragment-aware 子句合并——scope-only 前缀 attach 到后续 claim；相对从句与无主语
 *  fragment（主句谓语延续）attach 到前驱 */
function mergeClauseFragments(clauses) {
    const out = [];
    let pendingScope = '';
    for (const c of clauses) {
        if (out.length > 0 && RELATIVE_CLAUSE_RE.test(c)) {
            out[out.length - 1] = out[out.length - 1] + ' ' + c;
            continue;
        }
        if (out.length > 0 && VERB_LEAD_RE.test(c)) {
            out[out.length - 1] = out[out.length - 1] + ' ' + c;
            continue;
        }
        if (isScopeOnlyFragment(c)) {
            pendingScope = (pendingScope ? pendingScope + ' ' : '') + c;
            continue;
        }
        out.push((pendingScope ? pendingScope + ' ' : '') + c);
        pendingScope = '';
    }
    if (pendingScope)
        out.push(pendingScope);
    return out;
}
/** 关联句中的描述性分词不升级因果力："was associated with reduced mortality" 是关联主张，
 *  不是效应主张——'with <adj-participle> <noun>' 结构里的 reduced/increased/improved 是形容词修饰 */
const ASSOC_DESCRIPTOR_RE = /associated with(?: (?:a|an|the) )?(?: [\w-]+){0,3} (reduced|increased|decreased|improved|lower|higher|greater|elevated|altered|modified|enhanced|suppressed|impaired)\b/i;
/** v0.9.3 证据力角色排除（P0）：Figure 4 shows / establish a baseline / confirm configuration 等
 *  descriptive/procedural 用法不是 epistemic claim——只统计 epistemic 角色的证据动词。
 *  按动词类型定向检查 ±30 字符窗口。 */
function evidentialRoleFor(marker, clause, index) {
    const win = clause.slice(Math.max(0, index - 30), Math.min(clause.length, index + marker.length + 30));
    if (/^(shows?|showed|shown)$/i.test(marker)) {
        // v1.1：优先判断 that-complement——"Figure 4 shows that X increases survival" 的 shows that
        // 承担 epistemic claim（即使主语是 Figure）；只有 "Figure shows architecture/workflow/
        // schematic/example" 这类展示性宾语才是 descriptive。
        if (/\b(?:shows?|showed)\s+(?:that|evidence that|a (?:significant|clear|strong|positive)|an? (?:increase|decrease|reduction|association|effect|improvement|decline|change))\b/i.test(clause)) {
            return 'epistemic';
        }
        return /\b(?:figures?|tables?|panels?|images?|diagrams?|examples?|insets?)\b/i.test(win) ? 'descriptive' : 'epistemic';
    }
    if (/^(establishes?|established|establishing)$/i.test(marker)) {
        // "a baseline/protocol/framework is established" —— 建立，不是证明
        return /\b(?:baselines?|protocols?|frameworks?|systems?|datasets?|benchmarks?|procedures?|workflows?|pipelines?|registries?|criteria|standards?)\b/i.test(win) ? 'procedural' : 'epistemic';
    }
    if (/^(confirms?|confirmed|confirming)$/i.test(marker)) {
        // "confirm receipt/configuration/identity/setup/presence" —— 程序性确认
        return /\b(?:receipt|configuration|identity|setup|presence)\b/i.test(win) ? 'procedural' : 'epistemic';
    }
    if (/^(demonstrates?|demonstrated|demonstrating)$/i.test(marker)) {
        // v1.1：demonstrates that 优先算 epistemic；"the model demonstrates capability" 才是 descriptive
        if (/\b(?:demonstrates?|demonstrated)\s+(?:that|evidence that|a (?:significant|clear|strong)|an? (?:increase|decrease|reduction|association|effect|improvement|decline))\b/i.test(clause)) {
            return 'epistemic';
        }
        return /\b(?:model|framework|system|method|approach|implementation|experiment|algorithm|pipeline)\b.{0,20}(?:demonstrates?|demonstrated)\b/i.test(win) ? 'descriptive' : 'epistemic';
    }
    return 'epistemic';
}
/** v1.0/v1.1/v1.2：按子句提取 ClaimSpan 列表（纯正则，零 LLM；v1.2 先做 fragment 合并） */
export function extractClaimSpans(sentence) {
    const spans = [];
    for (const clause of mergeClauseFragments(splitClauses(sentence))) {
        let causalLevel = -1;
        let evidentialLevel = 0;
        let hedged = false;
        const hedgeMarkers = [];
        const causalMarkers = [];
        const evidentialMarkers = [];
        for (const rung of CAUSAL_LADDER) {
            const m = clause.match(rung.pattern);
            if (m && m.length > 0) {
                if (rung.level > causalLevel)
                    causalLevel = rung.level;
                causalMarkers.push(...m);
            }
        }
        // 关联子句 + 描述性分词：因果力封顶在关联层
        if (causalLevel >= 4 && /\bassociat(es|ed|ion)? (with|between)\b/i.test(clause) && ASSOC_DESCRIPTOR_RE.test(clause)) {
            causalLevel = 1;
        }
        // 证据力：v0.9.3 只统计 epistemic 角色的证据动词；hedge 独立成 hedged 字段
        for (const rung of EVIDENTIAL_LADDER) {
            if (rung.level === -1) {
                const m = clause.match(rung.pattern);
                if (m && m.length > 0) {
                    hedged = true;
                    hedgeMarkers.push(...m);
                }
                continue;
            }
            for (const m of clause.matchAll(rung.pattern)) {
                const role = evidentialRoleFor(m[0], clause, m.index ?? 0);
                if (role !== 'epistemic')
                    continue;
                if (rung.level > evidentialLevel)
                    evidentialLevel = rung.level;
                evidentialMarkers.push(m[0]);
            }
        }
        const negationMarkers = clause.match(NEGATION_RE) ?? [];
        const nullMarkers = clause.match(NULL_RESULT_RE) ?? [];
        const scopeMarkers = clause.match(SCOPE_RE) ?? [];
        const evidenceStatusMarkers = clause.match(EVIDENCE_STATUS_RE) ?? [];
        const hasEpistemic = causalLevel >= 0 || evidentialLevel > 0 || hedged ||
            negationMarkers.length > 0 || nullMarkers.length > 0 || scopeMarkers.length > 0 || evidenceStatusMarkers.length > 0;
        const looksProcedural = /\b(?:used|measured|collected|performed|conducted|applied|employed|implemented|dried|heated|acquired|recorded|obtained|calculated|estimated|simulated|modeled|modelled)\b/i.test(clause);
        // v1.6.2：方法动作（measured/collected/estimated 等）即使带 evidence-status marker，
        // 只要没有因果/证据/hedge/否定/scope 等真正的 claim 信号，就不算 recognized scientific claim。
        const onlyProceduralEvidenceStatus = hasEpistemic && causalLevel < 0 && evidentialLevel === 0 && !hedged &&
            negationMarkers.length === 0 && nullMarkers.length === 0 && scopeMarkers.length === 0 &&
            evidenceStatusMarkers.length > 0 && looksProcedural;
        let spanKind = 'unknown';
        if (onlyProceduralEvidenceStatus) {
            spanKind = 'procedural';
        }
        else if (hasEpistemic) {
            spanKind = 'claim';
        }
        else if (looksProcedural) {
            spanKind = 'procedural';
        }
        else if (/\b(?:figure|table|architecture|schematic|workflow|overview|diagram|example|samples|data)\b/i.test(clause)) {
            spanKind = 'descriptive';
        }
        spans.push({
            clause, spanKind, causalLevel, evidentialLevel, hedged, hedgeMarkers,
            causalMarkers, evidentialMarkers, negationMarkers, nullMarkers, scopeMarkers, evidenceStatusMarkers,
        });
    }
    return spans;
}
/** 提取单句的 epistemic markers（纯正则，零 LLM；基于 ClaimSpan 聚合） */
export function extractEpistemicMarkers(sentence) {
    const spans = extractClaimSpans(sentence);
    let claimLevel = -1;
    const ladderWords = [];
    let negation = false;
    let nullResult = false;
    let scope = false;
    for (const s of spans) {
        if (s.causalLevel > claimLevel)
            claimLevel = s.causalLevel;
        ladderWords.push(...s.causalMarkers);
        if (s.negationMarkers.length > 0)
            negation = true;
        if (s.nullMarkers.length > 0)
            nullResult = true;
        if (s.scopeMarkers.length > 0)
            scope = true;
    }
    return { claimLevel, ladderWords, negation, nullResult, scope };
}
/** v1.2.1：对齐用 tokenization——不滤停用词（"The results of the experiment" 的 results/
 *  experiment 是科研实体词，滤掉会导致句子对齐相似度失真）；restatement-loop 的
 *  tokenizeForSimilarity（stop 过滤版）保持语义相似度语义不变。 */
function tokenizeRaw(text) {
    const freq = new Map();
    const bump = (t) => { freq.set(t, (freq.get(t) ?? 0) + 1); };
    for (const w of text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [])
        bump(w);
    const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? [];
    for (let i = 0; i + 1 < cjk.length; i++)
        bump(cjk[i] + cjk[i + 1]);
    return freq;
}
/** 句对齐：贪心匹配 before→after（cosine ≥ minSim 且句位差 ≤ window）；返回配对索引。
 *  v1.2.1：使用 tokenizeRaw（不滤停用词）——对齐的职责是找同一句的两个版本，
 *  results/model/study 等论文高频词恰恰是判断同句性的关键证据。 */
export function alignSentences(before, after, minSim = 0.45, window = 4) {
    const beforeToks = before.map(tokenizeRaw);
    const afterToks = after.map(tokenizeRaw);
    const used = new Set();
    const pairs = [];
    for (let i = 0; i < before.length; i++) {
        let best = -1;
        let bestSim = minSim;
        for (let j = 0; j < after.length; j++) {
            if (used.has(j) || Math.abs(i - j) > window)
                continue;
            const sim = cosineSimilarity(beforeToks[i], afterToks[j]);
            if (sim > bestSim) {
                bestSim = sim;
                best = j;
            }
        }
        if (best >= 0) {
            used.add(best);
            pairs.push({ beforeIdx: i, afterIdx: best, sim: bestSim });
        }
    }
    return pairs;
}
/** v1.1：marker canonicalization——diff 用规范形做 key，避免大小写（Observed→observed）与
 *  英美拼写（modelled→modeled）被误判为两个不同 marker */
const MARKER_CANON = {
    modeled: 'modelled',
    'self-report': 'self-reported',
    'self-reports': 'self-reported',
    'self reported': 'self-reported',
    'self report': 'self-reported',
    'self reports': 'self-reported',
};
function canonicalMarker(m) {
    const l = m.trim().toLowerCase();
    return MARKER_CANON[l] ?? l;
}
/** v0.9.3：marker multiset diff（Scholarship Lock 的 diffValueLists 思想——次数守恒，不是 boolean）。
 *  v1.1：key 用 canonicalMarker（大小写/拼写归一），返回规范形。 */
function diffMarkerLists(before, after) {
    const bCounts = new Map();
    const aCounts = new Map();
    for (const v of before) {
        const k = canonicalMarker(v);
        bCounts.set(k, (bCounts.get(k) ?? 0) + 1);
    }
    for (const v of after) {
        const k = canonicalMarker(v);
        aCounts.set(k, (aCounts.get(k) ?? 0) + 1);
    }
    const removed = [];
    const added = [];
    for (const [k, count] of bCounts) {
        const a = aCounts.get(k) ?? 0;
        for (let i = 0; i < Math.max(0, count - a); i++)
            removed.push(k);
    }
    for (const [k, count] of aCounts) {
        const b = bCounts.get(k) ?? 0;
        for (let i = 0; i < Math.max(0, count - b); i++)
            added.push(k);
    }
    return { removed, added };
}
/** v1.1：子句主语候选（配对奖励用）——"X did not improve" 应配 "X improved"（同一实体），
 *  而不是相似度更高的 "Y did not improve"（主语不同，claim 不同） */
const CLAUSE_SUBJECT_STOP = new Set([
    'the', 'a', 'an', 'this', 'that', 'these', 'those', 'our', 'their', 'its', 'his', 'her',
    'in', 'on', 'at', 'of', 'for', 'with', 'by', 'from', 'as', 'to', 'into', 'over', 'under',
    'while', 'whereas', 'although', 'but', 'and', 'however', 'moreover', 'furthermore', 'thus',
]);
function clauseSubject(clause) {
    const toks = clause.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];
    for (const t of toks) {
        if (!CLAUSE_SUBJECT_STOP.has(t))
            return t;
    }
    return toks[0] ?? '';
}
/**
 * v0.9.3 Epistemic Lock：对比修改前后的科学主张完整性。
 * 与 Scholarship Lock（科研 token 守恒）互补：数字/引用没动，但
 * "associated → caused"、"No significant… → A significant…"、
 * "Among participants in this study… → …generally" 同样改变了科学结论。
 * v0.9：整句 max level → 子句级 ClaimSpan 对齐；相似度分档。
 * v0.9.3（0.9.2 评审）：
 *  - 证据力角色排除（Figure shows / establish baseline / confirm config 不计 epistemic）；
 *  - hedge 独立字段（may suggest → suggest 可检出）；
 *  - 否定/零结果/scope 子句级 marker multiset（"Z did not improve" → "Z improved" 不再被前半句布尔掩盖）；
 *  - 子句配对 best-match-first（先选最高相似度，达标才 consume，降低漏报）。
 */
export function diffEpistemic(before, after) {
    const out = {
        claimDrift: [], negationRemoved: [], negationAdded: [], nullResultRemoved: [], nullResultAdded: [],
        scopeRemoved: [], scopeAdded: [], evidenceStatusRemoved: [], evidenceStatusAdded: [], alignmentUncertain: [],
    };
    const bs = splitSentences(before);
    const as = splitSentences(after);
    const pairs = alignSentences(bs, as);
    // claim-bound marker 守恒（v1.2：函数级，供主循环与短文档位置配对兜底共用）
    const reportClauseMarkers = (bSpan, aMarkers, labelB, labelA, simForEvent, opts) => {
        const fb = opts?.fallback ? { positionalFallback: true } : {};
        const neg = diffMarkerLists(bSpan.negationMarkers, aMarkers.negation);
        for (const marker of neg.removed)
            out.negationRemoved.push({ before: labelB, after: labelA, marker, sim: simForEvent, ...fb });
        for (const marker of neg.added)
            out.negationAdded.push({ before: labelB, after: labelA, marker, sim: simForEvent, ...fb });
        const nul = diffMarkerLists(bSpan.nullMarkers, aMarkers.null);
        for (const marker of nul.removed)
            out.nullResultRemoved.push({ before: labelB, after: labelA, marker, sim: simForEvent, ...fb });
        // v1.2：零结果新增走独立字段（不再塞 negationAdded，便于双向去重）
        for (const marker of nul.added)
            out.nullResultAdded.push({ before: labelB, after: labelA, marker, sim: simForEvent, ...fb });
        const scp = diffMarkerLists(bSpan.scopeMarkers, aMarkers.scope);
        for (const marker of scp.removed)
            out.scopeRemoved.push({ before: labelB, after: labelA, marker, sim: simForEvent, ...fb });
        for (const marker of scp.added)
            out.scopeAdded.push({ before: labelB, after: labelA, marker, sim: simForEvent, ...fb });
        const es = diffMarkerLists(bSpan.evidenceStatusMarkers, aMarkers.evidenceStatus);
        for (const marker of es.removed)
            out.evidenceStatusRemoved.push({ before: labelB, after: labelA, marker, sim: simForEvent, ...fb });
        for (const marker of es.added)
            out.evidenceStatusAdded.push({ before: labelB, after: labelA, marker, sim: simForEvent, ...fb });
    };
    for (const { beforeIdx, afterIdx, sim } of pairs) {
        const b = bs[beforeIdx];
        const a = as[afterIdx];
        // v1.2：claim-bound 对比——每对 before/after 子句比较绑定在该主张上的 markers。
        // 未配对子句不退化回 sentence bag：含受保护 markers 时产生 alignment-uncertain candidate
        const bSpans = extractClaimSpans(b);
        const aSpans = extractClaimSpans(a);
        const aUsed = new Set();
        // 1) 子句级多主张漂移（best-match-first：窗口内选最高相似度；v1.2 threshold 看 raw
        //    cosine（≥0.3 才配对），subject bonus 只参与 ranking——"The model predicts mortality"
        //    与 "The model was initialized…" 同主语但 raw 相似度低，不再被错误绑成同一 claim）
        for (let i = 0; i < bSpans.length; i++) {
            let bestJ = -1;
            let bestSim = 0.3;
            const bSubj = clauseSubject(bSpans[i].clause);
            for (let j = Math.max(0, i - 1); j < Math.min(aSpans.length, i + 2); j++) {
                if (aUsed.has(j))
                    continue;
                // 句子级对齐用 tokenizeRaw（保留实体词）；clause 级配对用 stop 过滤版——
                // 短子句里 did/not/the 等功能词占比高，raw 会让 "X did not improve" 与
                // "Y did not improve" 的相似度压倒真正对应的 "X improved"
                const simJ = cosineSimilarity(tokenizeForSimilarity(bSpans[i].clause), tokenizeForSimilarity(aSpans[j].clause));
                if (simJ < 0.3)
                    continue;
                // v1.2.2：subject bonus 要求双方主语非空（clauseSubject 对纯中文/无英文 token 返回 ''，
                // ''==='' 不应获得 +0.3——中英混写时可能抬错候选）
                const aSubj = clauseSubject(aSpans[j].clause);
                const subjectBonus = bSubj !== '' && aSubj !== '' && bSubj === aSubj ? 0.3 : 0;
                const scored = simJ + subjectBonus;
                if (scored > bestSim) {
                    bestSim = scored;
                    bestJ = j;
                }
            }
            const bSpan = bSpans[i];
            if (bestJ < 0) {
                // v1.2：未配对 before 子句不再退化回 sentence bag（"没有可靠 claim identity 时，
                // 不应用整句 marker 证明它没变"）——含受保护 markers 时产生 alignment-uncertain
                // review candidate，提示不要假定这些 commitments 被保留
                const protectedMarkers = [
                    ...bSpan.negationMarkers, ...bSpan.nullMarkers, ...bSpan.scopeMarkers, ...bSpan.evidenceStatusMarkers,
                ];
                if (protectedMarkers.length > 0) {
                    out.alignmentUncertain.push({ before: bSpan.clause.slice(0, 120), markers: protectedMarkers.map(canonicalMarker), sim });
                }
                continue;
            }
            aUsed.add(bestJ);
            const aSpan = aSpans[bestJ];
            // v1.1：单 hit 多轴 delta（causal + evidential + hedge 全部保留，不静默丢轴）
            const causalDrifted = (bSpan.causalLevel >= 0 || aSpan.causalLevel >= 0) && aSpan.causalLevel !== bSpan.causalLevel;
            const evidentialDrifted = bSpan.evidentialLevel !== aSpan.evidentialLevel;
            const hedgedChanged = bSpan.hedged !== aSpan.hedged;
            if (causalDrifted || evidentialDrifted || hedgedChanged) {
                const deltas = [];
                let axis = 'causal';
                let levelBefore = 0;
                let levelAfter = 0;
                let beforeWord = '(无)';
                let afterWord = '(无)';
                if (causalDrifted) {
                    axis = 'causal';
                    levelBefore = Math.max(bSpan.causalLevel, 0);
                    levelAfter = Math.max(aSpan.causalLevel, 0);
                    beforeWord = bSpan.causalMarkers.length > 0 ? bSpan.causalMarkers[bSpan.causalMarkers.length - 1] : '(无)';
                    afterWord = aSpan.causalMarkers.length > 0 ? aSpan.causalMarkers[aSpan.causalMarkers.length - 1] : '(无)';
                    deltas.push(`因果力 ${levelBefore}→${levelAfter}`);
                }
                if (evidentialDrifted) {
                    if (!causalDrifted) {
                        axis = 'evidential';
                        levelBefore = bSpan.evidentialLevel;
                        levelAfter = aSpan.evidentialLevel;
                        beforeWord = bSpan.evidentialMarkers.length > 0 ? bSpan.evidentialMarkers[bSpan.evidentialMarkers.length - 1] : '(无)';
                        afterWord = aSpan.evidentialMarkers.length > 0 ? aSpan.evidentialMarkers[aSpan.evidentialMarkers.length - 1] : '(无)';
                    }
                    deltas.push(`证据力 ${bSpan.evidentialLevel}→${aSpan.evidentialLevel}`);
                }
                if (hedgedChanged) {
                    deltas.push(`hedge ${bSpan.hedged ? '有' : '无'}→${aSpan.hedged ? '有' : '无'}`);
                    if (!causalDrifted && !evidentialDrifted) {
                        axis = 'evidential';
                        beforeWord = bSpan.hedgeMarkers[0] ?? '(hedge)';
                        afterWord = aSpan.hedgeMarkers[0] ?? '(hedge)';
                    }
                }
                out.claimDrift.push({
                    before: bSpan.clause.slice(0, 120), after: aSpan.clause.slice(0, 120),
                    levelBefore, levelAfter, beforeWord, afterWord, axis, sim,
                    hedgedBefore: bSpan.hedged, hedgedAfter: aSpan.hedged,
                    deltas,
                });
            }
            // 2) claim-bound marker conservation：绑定到配对子句
            reportClauseMarkers(bSpan, {
                negation: aSpan.negationMarkers,
                null: aSpan.nullMarkers,
                scope: aSpan.scopeMarkers,
                evidenceStatus: aSpan.evidenceStatusMarkers,
            }, bSpan.clause.slice(0, 120), aSpan.clause.slice(0, 120), sim);
        }
        // 3) 未配对 after 子句（对称）：含受保护 markers → alignment-uncertain candidate
        for (let j = 0; j < aSpans.length; j++) {
            if (aUsed.has(j))
                continue;
            const aSpan = aSpans[j];
            const protectedMarkers = [
                ...aSpan.negationMarkers, ...aSpan.nullMarkers, ...aSpan.scopeMarkers, ...aSpan.evidenceStatusMarkers,
            ];
            if (protectedMarkers.length > 0) {
                out.alignmentUncertain.push({ before: aSpan.clause.slice(0, 120), markers: protectedMarkers.map(canonicalMarker), sim });
            }
        }
    }
    // v1.2：短文档位置配对兜底——句子级对齐失败（minSim 0.45）但双方句数相同且 ≤3 时，
    // 位置即身份（没有错配余地）：按位置配对跑 marker 守恒（claim-drift 仍要求词面相似，
    // 不在此兜底）——"Z improved" → "Z did not improve"（sim≈0.35）不再是漏报。
    // v1.2.1：事件携带真实相似度（不再硬编码 0.5）+ positionalFallback 标记（报告明示
    // "这是位置兜底，不是高可信词面对齐"）。
    if (pairs.length === 0 && bs.length === as.length && bs.length <= 3) {
        for (let i = 0; i < bs.length; i++) {
            const realSim = cosineSimilarity(tokenizeRaw(bs[i]), tokenizeRaw(as[i]));
            const bSpans = extractClaimSpans(bs[i]);
            const aSpans = extractClaimSpans(as[i]);
            for (let k = 0; k < Math.min(bSpans.length, aSpans.length); k++) {
                reportClauseMarkers(bSpans[k], {
                    negation: aSpans[k].negationMarkers,
                    null: aSpans[k].nullMarkers,
                    scope: aSpans[k].scopeMarkers,
                    evidenceStatus: aSpans[k].evidenceStatusMarkers,
                }, bSpans[k].clause.slice(0, 120), aSpans[k].clause.slice(0, 120), realSim, { fallback: true });
            }
        }
    }
    // v1.2：null/negation 双向去重（removed 与 added 各自对称）——"did not improve" 同时命中
    // 否定与零结果正则时只保留更具体的零结果事件
    const nullRemovedSet = new Set(out.nullResultRemoved.map((d) => canonicalMarker(d.marker)));
    out.negationRemoved = out.negationRemoved.filter((d) => {
        const k = canonicalMarker(d.marker);
        for (const nk of nullRemovedSet) {
            if (nk !== k && (nk.includes(k) || k.includes(nk)))
                return false;
        }
        return true;
    });
    const nullAddedSet = new Set(out.nullResultAdded.map((d) => canonicalMarker(d.marker)));
    out.negationAdded = out.negationAdded.filter((d) => {
        const k = canonicalMarker(d.marker);
        for (const nk of nullAddedSet) {
            if (nk !== k && (nk.includes(k) || k.includes(nk)))
                return false;
        }
        return true;
    });
    return out;
}
/** v0.9：对齐相似度 → confidence/severity/findingKind 分档（分析建议 0.70/0.55/0.45） */
export function simTier(sim) {
    if (sim >= 0.7)
        return { confidence: 'high', severity: 'high', kind: 'invariant' };
    if (sim >= 0.55)
        return { confidence: 'medium', severity: 'high', kind: 'invariant' };
    return { confidence: 'low', severity: 'medium', kind: 'candidate' };
}
/** v1.2.3：marker 事件可信度统一模型——added/removed 共用（"我们有多确定这是同一个 claim"
 *  不应因变化方向而异）：
 *  - 正常对齐 + sim ≥0.55 → invariant
 *  - 正常对齐 <0.55 → candidate
 *  - 位置兜底 + sim ≥0.55 → invariant
 *  - 位置兜底 + sim <0.55 → candidate（低可信，明示"短文本位置兜底"） */
function markerEventTier(sim, positionalFallback) {
    if (positionalFallback && sim < 0.55)
        return { confidence: 'low', kind: 'candidate' };
    const t = simTier(sim);
    return { confidence: t.confidence, kind: t.kind };
}
/** v0.8 findingKind 推导（缺省语义；invariant 类在代码中显式标注） */
export function resolveFindingKind(rule) {
    if (rule.findingKind)
        return rule.findingKind;
    if (rule.severity === 'high') {
        return rule.category === 'claim_calibration' ? 'candidate' : 'violation';
    }
    return rule.category === 'claim_calibration' ? 'candidate' : 'advisory';
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
        // v0.8：明确违规（修改过程残留），非 candidate
        findingKind: 'violation',
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
        // v0.8（Evidence-Bound 借鉴）：cue ≠ verdict——"we do not claim" 也可能承担
        // 正当的 epistemic boundary（如 "We do not claim that this association is causal"）
        note: 'candidate 判定：此措辞也可能承担正当的边界功能（scope/证据状态/因果边界/竞争解释）——不要自动删除，人工判定（KEEP/TIGHTEN/REFRAME/RELOCATE/CUT/QUERY）。',
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
        note: '陈述研究局限性是 ICMJE 的正当要求（Discussion 应讨论局限），本规则只针对“反复否认主张”句式，不针对 limitations 段落本身。candidate 判定：此措辞也可能承担正当的 epistemic boundary——不要自动删除，人工判定。',
    },
    {
        id: 'self-deprecation',
        category: 'claim_calibration',
        severity: 'medium',
        confidence: 'medium',
        label: '自我削弱词',
        pattern: /(遗憾的[是地]|仍明显落后|效果有限|存在严重不足|仅能初步|只能算|不敢说|远远不够|非常有限|尚显不足)/g,
        message: '检测到自我削弱式表达（“遗憾的是/仍明显落后/效果有限/存在严重不足”）。',
        // v0.8（Evidence-Bound 借鉴）：宽泛自我否定 → 精确受证据约束的描述；负面/零/矛盾结果是数据，不得删除
        suggestion: '把宽泛的自我否定改写为精确的、受证据约束的描述（如“本研究未覆盖高温高压工况，属于范围边界”）；不得因为负面/零/矛盾结果削弱叙事就删除它们——阴性发现本身是数据。',
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
        // v0.8：candidate 判定（cue ≠ verdict）
        note: 'candidate 判定：此措辞也可能承担正当的边界功能——不要自动删除，人工判定。',
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
        // v0.8（Evidence-Bound 借鉴）：不要把作者解释升级成证据主张——
        // "we believe X" → "the results show X" 可能悄悄发生 author interpretation → evidence claim
        suggestion: '若这是作者解释，用证据校准措辞：“One possible explanation is…” / “This finding may reflect…”；只有证据直接支持时才用 “the results show / the data indicate”——不要把作者判断升级成证据主张（interpretation → evidence claim 属于主张强度漂移）。',
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
        note: '密度规则：单次 hedge 不报警；这是"防御饱和"的整体行为检测，不是反 hedge 工具。candidate 判定：有证据依据的 hedging 是正确的学术表达（ICMJE）——不要自动删除，人工判定。',
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
        note: '与"并非要证明"等防御性声明不同，本规则检测的是整体限定密度。candidate 判定：有证据依据的 hedging 保留（ICMJE），不要自动删除。',
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
        // v0.8：candidate 判定（cue ≠ verdict）
        note: 'candidate 判定：多层限定可能分别标记不同的 scope/来源/因果边界（Evidence-Bound D3）——只压缩真正的冗余层，不要整句删限定。',
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
        counter: (text) => {
            let n = 0;
            for (const s of splitSentences(text)) {
                const words = countLexicalUnits(s).englishWords;
                const markers = (s.match(/\b(which|that|while|whereas|although|because|thereby|leading to|resulting in)\b/gi) ?? []).length;
                if (words > 35 && markers >= 3)
                    n += 1;
            }
            return n;
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
        counter: (text) => {
            let n = 0;
            for (const s of splitSentences(text)) {
                const chars = countLexicalUnits(s).cjkChars;
                const commas = (s.match(/[，；,;]/g) ?? []).length;
                const conns = (s.match(/(其中|同时|进一步|从而|进而|因此|并且|尤其|这意味着)/g) ?? []).length;
                if (chars > 80 && commas >= 5 && conns >= 3)
                    n += 1;
            }
            return n;
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
        counter: (text) => {
            let n = 0;
            for (const para of text.split(/\n{2,}/)) {
                const sents = splitSentences(para).filter((s) => s.length > 0);
                let run = 0;
                for (const s of sents) {
                    if (/^(Moreover|Furthermore|Additionally|In addition|However|Therefore|Thus|Consequently|Meanwhile)[,\s]/i.test(s)) {
                        run += 1;
                        if (run >= 3) {
                            n += 1;
                            break;
                        }
                    }
                    else {
                        run = 0;
                    }
                }
            }
            return n;
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
        // v0.9.1：establish + 基建类名词（baseline/protocol/framework…）是"建立"不是"证明"——
        // 实测 "a baseline (M1) is established"（建立基线）误报，加入上下文排除
        context: {
            window: 120,
            exclude: /\b\d+(?:\.\d+)?\s*%?|p\s*[<≤=]\s*0?\.?\d|\bCI\b|confidence interval|95%|Table\s*\d|Figure\s*\d|\\cite|\[\d+\]|\b(?:baselines?|protocols?|frameworks?|systems?|datasets?|benchmarks?|procedures?|workflows?|pipelines?|registries?|criteria|standards?)\b.{0,40}\bestablish(?:ed|ing)?\b|\bestablish(?:ed|ing)?\b.{0,40}\b(?:baselines?|protocols?|frameworks?|systems?|datasets?|benchmarks?|procedures?|workflows?|pipelines?)\b/i,
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
        // v0.8：自黑免责是明确违规（摧毁论文价值），不是 candidate
        findingKind: 'violation',
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
    // ================= v1.3 篇章统计层（第10轮评审：局部规则 → 篇章统计 → 科学完整性）=================
    {
        id: 'paragraph-rhythm',
        category: 'academic_style',
        severity: 'low',
        confidence: 'low',
        label: '段落节奏（碎片化 / 拥塞 / 过度整齐）',
        pattern: /(.)/,
        paragraphRhythm: true,
        message: '段落节奏异常：连续一句成段（碎片化）、少数段落远高于自身段长分布（拥塞）或连续多段长度几乎相同（过度整齐）。',
        suggestion: '按"一个完整论证单元"划分段落：长段按独立问题拆分，碎片段合并到相邻论证，避免按固定字数切段。',
        languages: ['zh', 'en'],
        evidence: { type: 'style-guide', source: 'GPT-5.6 Sol 论文写作破绽精简整合版 #9（段落划分机械）' },
        findingKind: 'advisory',
    },
    {
        id: 'sentence-rhythm-uniformity',
        category: 'academic_style',
        severity: 'low',
        confidence: 'low',
        label: '句长节奏过度均匀（variance 过小 + 连续发生）',
        pattern: /(.)/,
        sentenceRhythm: true,
        message: '连续多句长度落在局部中位数附近的小范围内，且跨多个段落重复；或当前句长标准差明显低于作者历史（写得过于整齐）。句长应随信息密度自然变化。',
        suggestion: '长句只在确有复杂逻辑关系时保留，一个句子只承担一个主要判断；让句长随信息密度自然变化，不要刻意制造整齐或碎句。',
        languages: ['zh', 'en'],
        evidence: { type: 'style-guide', source: 'GPT-5.6 Sol 论文写作破绽精简整合版 #1（句长分布过于整齐）' },
        findingKind: 'advisory',
    },
    {
        id: 'repeated-discourse-scaffold',
        category: 'rhetorical_pattern',
        severity: 'medium',
        confidence: 'low',
        label: '重复使用相同逻辑脚手架（首先其次最后 / 第一第二第三 / First Second Third）',
        pattern: /(.)/,
        scaffoldRepeat: true,
        message: '多个独立段落重复使用同一种枚举逻辑骨架（首先→其次→最后 / 第一→第二→第三 / First→Second→Third）。单次列举正常，跨段落机械复用会使文章呈现模板化结构。',
        suggestion: '根据内容关系选择最自然的组织方式：有并列关系才列举，有因果关系直接写因果，有主次关系重点展开；不要每一段都长成同一种"标准答案"结构。',
        languages: ['zh', 'en'],
        evidence: { type: 'style-guide', source: 'GPT-5.6 Sol 论文写作破绽精简整合版 #2（逻辑结构过度模板化）' },
        findingKind: 'candidate',
    },
    {
        id: 'punctuation-scaffold-overload',
        category: 'formatting',
        severity: 'low',
        confidence: 'low',
        label: '标点脚手架过载（括号/冒号/分号/引号/破折号组合聚集）',
        pattern: /(.)/,
        punctuationOverload: true,
        message: '同一句/段内连续使用多种标点（括号补定义 → 冒号顶解释 → 分号列要点 → 引号包装概念 → 破折号补充说明）：用标点承担了本应由句法和段落完成的逻辑组织。',
        suggestion: '把重要例子直接写进句子（"关注员工的薪酬、晋升等需求"），把解释写成独立短句；分号连续 ≥2 次时拆句。',
        languages: ['zh', 'en'],
        evidence: { type: 'style-guide', source: 'GPT-5.6 Sol 论文写作破绽精简整合版 #7（标点和补充说明使用过密）' },
        findingKind: 'candidate',
    },
    {
        id: 'coined-framework-language',
        category: 'llm_associated',
        severity: 'low',
        confidence: 'low',
        label: '自创框架词/组合词（XX化/XX力/A-B-C 短线框架）',
        pattern: /(.)/,
        coinedFramework: true,
        message: '检测到"看起来像高级术语"的生产性造词（XX化/XX力/XX性/闭环/A-B-C 短线框架）。这些词并非天然错误，但常被当作成熟术语使用而缺乏理论来源与定义。',
        suggestion: '先问：是不是该领域已有术语？如果不是，能否用普通准确的词表达？若必须自定义，给出清晰定义和使用边界；"输入—处理—输出"类短线框架尽量改写成正常句法。',
        languages: ['zh', 'en'],
        evidence: { type: 'style-guide', source: 'GPT-5.6 Sol 论文写作破绽精简整合版 #8（自创高级框架词）' },
        findingKind: 'candidate',
    },
    {
        id: 'generic-claim-candidate',
        category: 'claim_calibration',
        severity: 'low',
        confidence: 'low',
        label: '正确但空泛的判断（多弱信号组合）',
        pattern: /(.)/,
        genericClaim: true,
        message: '句子同时满足多个空泛弱信号（抽象名词堆叠、无实体/数值/引用/方法动作、命中万能句型），语法正确但缺少对象、机制、证据或具体判断。',
        suggestion: '优先回答：具体是什么问题？出现在哪里？为什么？对哪个变量/结果有什么影响？有什么数据、文献或案例支持？本文真正新增的判断是什么？',
        languages: ['zh', 'en'],
        evidence: { type: 'style-guide', source: 'GPT-5.6 Sol 论文写作破绽精简整合版 #4（正确但没有信息量）' },
        findingKind: 'candidate',
    },
    {
        id: 'summary-cliche-positional',
        category: 'llm_associated',
        severity: 'low',
        confidence: 'low',
        label: '总结套话位置感知（每个小节末尾都出现）',
        pattern: /(.)/,
        summaryPositional: true,
        message: '同一类总结套话（综上所述/总而言之/in conclusion 等）在每个小节末尾反复出现——位置固定比次数更能体现模板化收尾。',
        suggestion: '如果前文逻辑已经完成，不必强行再写一句总结；需要承接下一段时，直接写真正的新判断，而不是用套话重复上一段。',
        languages: ['zh', 'en'],
        evidence: { type: 'style-guide', source: 'GPT-5.6 Sol 论文写作破绽精简整合版 #3（机械使用总结套话）' },
        findingKind: 'advisory',
    },
    {
        id: 'local-citation-integrity',
        category: 'claim_calibration',
        severity: 'medium',
        confidence: 'high',
        label: '本地引用完整性（\\cite key ↔ .bib / \\ref ↔ \\label）',
        pattern: /(.)/,
        citationIntegrity: true,
        message: '检测到 \\cite 引用的 key 在 .bib 中不存在、\\ref 无对应 \\label、bib 条目缺 title/year/author 或同一 DOI 对应多个 key。',
        suggestion: '补齐 .bib 条目或修正 \\cite key；确保 \\ref 与 \\label 一一对应；同一 DOI 只保留一个 key。',
        languages: ['zh', 'en'],
        evidence: { type: 'heuristic' },
        note: '仅当 .bib 内容随调用提供时启用（writing_audit 的 filePath 参数会自动探测同目录 .bib）。',
        findingKind: 'violation',
    },
];
// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------
/** 检测文档类型（从文件路径推断）——v0.3.1 收紧：peer-review 只认明确词，综述类归 manuscript */
export function detectDocumentProfile(filePath) {
    const norm = filePath.replace(/\\/g, '/').toLowerCase();
    // v0.5.2：rebuttal 同时认 "revision_response"（返修回复的常见命名）
    if (/rebuttal|response[_ -]?to[_ -]?(reviewers?|revisions?)|revision[_ -]?response|回复审稿|返修回复|逐条回复/.test(norm))
        return 'rebuttal';
    if (/cover[_ -]?letter|投稿信/.test(norm))
        return 'cover_letter';
    // 明确的审稿材料（v0.3.1：systematic_review / literature_review / scoping_review / review_article 是论文而非审稿意见；
    // v0.5.2：支持 "reviewer2_comments"、"reviewer 2 comments" 这类带编号的常见命名）
    if (/(reviewer[ _\-.]?\d*[ _\-.]?comments?|review[ _\-.]?comments?|peer[_ -]?review|referee[_ -]?report|审稿意见|评审意见)/.test(norm))
        return 'review';
    // 综述类论文归 manuscript
    if (/(systematic[_ -]?review|literature[_ -]?review|scoping[_ -]?review|review[_ -]?article|narrative[_ -]?review)/.test(norm))
        return 'manuscript';
    // v0.5.2：补英文 revision/revised，与 isPaperFile 的判定词表对齐（revision_notes.md 等修订材料不再掉进 unknown）
    if (/manuscript|paper|thesis|revision|revised|论文|稿件|修订|返修稿/.test(norm))
        return 'manuscript';
    // 一般笔记/草稿（v0.3.1：让 notes profile 可被自动检测到；v0.5.2：支持 my_notes / draft_notes 等常见前缀）
    if (/(^|[\/_\-. ])(notes?|draft|草稿|笔记|scratch)([\/_\-. ]|$)/.test(norm))
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
    // v1.2.2：findingKind=invariant 不受普通 severity 过滤——科学完整性事件（即使 MEDIUM/LOW）
    // 不应被 conservative 模式的 style 过滤静默掉。"严重度"描述影响程度，invariant 描述
    // 科学承诺已变化，两个维度分开：invariant 始终保留，style/rhetorical 按 minSeverity 过滤。
    const hits = report.hits.filter((h) => h.findingKind === 'invariant' || rank[h.severity] >= rank[minSeverity]);
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
// ---------------------------------------------------------------------------
// v0.5 incremental lint：指纹与增量 diff（"新增 1 / 解决 4 / 仍存在 8"）
// ---------------------------------------------------------------------------
/** v1.2.3：FNV-1a 32-bit hash（无依赖）——指纹用完整事件 key 的确定性 hash，
 *  避免 slice(0,60) 截断导致长 claim anchor 的碰撞 */
export function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
}
/**
 * v1.2.3：轻量 claim anchor（无 NLP）——subject + 内容 token：
 *  "The intervention was associated with mortality" → intervention|associated|mortality。
 *  fingerprint 用它区分"不同 claim 上发生的相同 drift"（Treatment A 与 Treatment B
 *  都发生 association→causation 时，指纹不再碰撞）。
 */
function claimAnchor(clause) {
    const subj = clauseSubject(clause);
    const toks = clause.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];
    const content = [];
    for (const t of toks) {
        if (CLAUSE_SUBJECT_STOP.has(t) || SIM_STOP.has(t))
            continue;
        if (content.includes(t) || content.length >= 4)
            continue;
        content.push(t);
    }
    // v1.4：中文 Claim Anchor——用 CJK bigram 补充 subject/content token，
    // 让中文 scientific revision 也能区分不同 claim 上的相同漂移（模型A vs 治疗组）。
    const cjk = clause.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? [];
    if (cjk.length === 1) {
        if (!content.includes(cjk[0]))
            content.push(cjk[0]);
    }
    else {
        for (let i = 0; i + 1 < cjk.length && content.length < 4; i++) {
            const bigram = cjk[i] + cjk[i + 1];
            if (!content.includes(bigram))
                content.push(bigram);
        }
    }
    const parts = [subj, ...content].filter(Boolean);
    return parts.join('|') || '?';
}
/**
 * v1.2.2：稳定指纹——显式区分 aggregate 与 event 两类。
 *  - aggregate（真正全文统计类：density/section/风格漂移）：每文件每种规则最多一个，
 *    snippet 含 count/denominator 会随编辑变化，不能用它做指纹（4/3200 → 4/3300
 *    会被误判为 resolved+added）→ `aggregate::<ruleId>`。
 *  - event（integrity 事件：Scholarship/Epistemic/version-gap 等）：paragraphIndex 也是 -1，
 *    但每个事件是独立的 scientific commitment——必须用 matchText 做 event-level 指纹。
 *    否则 "5 mg→6 mg" 与 "10 mg→12 mg" 共享同一指纹，第二次修改会被增量 lint
 *    当成"同一个旧问题"静默（Guard 第一次提醒后新问题永不再提示）。
 *  - 段落级：ruleId + 命中原文（matchText）归一化。
 */
const AGGREGATE_RULE_IDS = new Set([
    'llm-verb-noun-overuse',
    'llm-transition-overuse',
    'cn-ai-connectives',
    'llm-buzzword-en',
    'cn-buzzword-density',
    'em-dash-density',
    'colon-title',
    'rule-of-three',
    'rather-than-heavy',
    'avg-sentence-length',
    'hedge-density-en',
    'hedge-density-zh',
    'overlong-sentence-en',
    'overlong-sentence-zh',
    'connective-overuse',
    'limitations-across-sections',
    'style-profile-drift',
    // v1.3 篇章统计层（全文统计级，指纹必须稳定）
    'paragraph-rhythm',
    'sentence-rhythm-uniformity',
]);
export function hitFingerprint(h) {
    if (AGGREGATE_RULE_IDS.has(h.ruleId)) {
        return `aggregate::${h.ruleId}`;
    }
    // v1.2.3：fingerprintKey 优先（Epistemic 事件带 claim identity：ruleId::hash(claim anchor)）；
    // 其余用 matchText（Scholarship 的 matchText 已含实体 identity）。FNV hash 避免截断碰撞。
    const key = (h.fingerprintKey ?? h.matchText ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (key) {
        return `${h.ruleId}::${fnv1a(key)}`;
    }
    // 非白名单且无 key 的全文统计级命中（罕见）：退化为 aggregate 语义
    return `aggregate::${h.ruleId}`;
}
/** 对比上一次指纹集合与当前 hits，返回增量（自动模式只告诉 agent 新增/解决） */
export function diffAudit(previous, current) {
    const currentFps = new Set(current.map((h) => hitFingerprint(h)));
    const added = current.filter((h) => !previous.has(hitFingerprint(h)));
    const resolved = [];
    for (const fp of previous) {
        if (!currentFps.has(fp))
            resolved.push(fp);
    }
    return {
        added,
        resolved,
        remaining: currentFps.size,
        previousTotal: previous.size,
        currentTotal: currentFps.size,
    };
}
/** 序列化/反序列化指纹集合（用于持久化到磁盘） */
export function serializeFingerprints(fps) {
    return [...fps];
}
export function deserializeFingerprints(arr) {
    if (!Array.isArray(arr))
        return new Set();
    return new Set(arr.filter((x) => typeof x === 'string'));
}
/** v0.5.1：LaTeX 命令分类——argument 是引用 key 的命令整体删除，不把 key 留进 prose */
const DROP_ARG_COMMANDS = new Set([
    'cite', 'citep', 'citet', 'citep', 'citet', 'citenum', 'ref', 'eqref', 'autoref', 'label',
    'bibliography', 'includegraphics', 'url', 'href', 'index', 'footnote',
]);
/** 行内清理：剥离行内 code / LaTeX math / Markdown 链接（保留 anchor）/ URL / LaTeX 命令 */
function cleanInline(t) {
    let s = t;
    s = s.replace(/`[^`\n]*`/g, ' ');
    s = s.replace(/\$[^$\n]+\$/g, ' ');
    s = s.replace(/\[([^\]]+)\]\(https?:\/\/[^)]*\)/g, '$1');
    s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    s = s.replace(/https?:\/\/\S+/g, ' ');
    // v0.5.1：引用/标签类命令整体删除（\cite{smith-revised-2025} → ''，key 不是 prose）
    s = s.replace(new RegExp(`\\\\(?:${[...DROP_ARG_COMMANDS].join('|')})\\*?\\{([^{}]*)\\}`, 'g'), ' ');
    // 格式化命令保留 argument（\textbf{important result} → important result）
    s = s.replace(/\\[a-zA-Z]+\{([^{}]*)\}/g, '$1');
    s = s.replace(/\\[a-zA-Z]+\s*/g, ' ');
    return s;
}
const REF_HEADING_RE = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:references|bibliography|参考文献)\s*:?\s*(?:\n|$)|\\begin\{thebibliography\}|\\section\*?\{References\}|\\section\*?\{Bibliography\}/i;
/** 块级分段器：识别 YAML/code fence/表格/标题/公式块/References/正文 */
export function preprocess(text) {
    const segments = [];
    const lines = text.split(/\r?\n/);
    let i = 0;
    const flushProse = (buf) => {
        if (buf.length === 0)
            return;
        const raw = buf.join('\n');
        const cleaned = cleanInline(raw);
        // prose 段按空行再拆（保持段落粒度）
        for (const para of cleaned.split(/\n{2,}/)) {
            const p = para.trim();
            if (p.length > 0)
                segments.push({ kind: 'prose', text: p });
        }
    };
    let buf = [];
    while (i < lines.length) {
        const line = lines[i];
        // References 段：从 References 标题到下一个标题行（v0.5.2：References 之后的
        // Appendix/Supplementary 常以 heading 开头，不再被整段吞进 reference 而漏扫）
        if (REF_HEADING_RE.test('\n' + line + '\n')) {
            flushProse(buf);
            buf = [];
            let end = lines.length;
            for (let j = i + 1; j < lines.length; j++) {
                if (/^\s{0,3}(#{1,6})\s+/.test(lines[j]) || /^\s*\\(sub)*section\*?\{/.test(lines[j])) {
                    end = j;
                    break;
                }
            }
            segments.push({ kind: 'reference', text: lines.slice(i, end).join('\n') });
            i = end;
            continue;
        }
        // YAML frontmatter（文件开头）
        if (i === 0 && /^---\s*$/.test(line)) {
            flushProse(buf);
            buf = [];
            const end = lines.findIndex((l, j) => j > i && /^---\s*$/.test(l));
            if (end > 0) {
                segments.push({ kind: 'code', text: lines.slice(i, end + 1).join('\n') });
                i = end + 1;
                continue;
            }
        }
        // code fence
        if (/^\s*(```|~~~)/.test(line)) {
            flushProse(buf);
            buf = [];
            const fence = line.match(/^\s*(```|~~~)/)[1];
            const end = lines.findIndex((l, j) => j > i && l.trim().startsWith(fence));
            const endIdx = end > 0 ? end : lines.length - 1;
            segments.push({ kind: 'code', text: lines.slice(i, endIdx + 1).join('\n') });
            i = endIdx + 1;
            continue;
        }
        // Markdown 标题（v0.5.1：记录 heading level 供 section hierarchy 使用）
        const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
        if (heading) {
            flushProse(buf);
            buf = [];
            segments.push({ kind: 'heading', text: cleanInline(heading[2].trim()), headingLevel: heading[1].length });
            i += 1;
            continue;
        }
        // LaTeX section/subsection 标题（v0.5.1：记录 level）
        const latexHeading = line.match(/^\s*\\(sub)*section\*?\{([^}]+)\}/);
        if (latexHeading) {
            flushProse(buf);
            buf = [];
            const level = 1 + (latexHeading[1]?.match(/sub/g)?.length ?? 0);
            segments.push({ kind: 'heading', text: cleanInline(latexHeading[2].trim()), headingLevel: level });
            i += 1;
            continue;
        }
        // LaTeX 块公式（$$...$$ 单独行 或 equation 环境）
        if (/^\s*\$\$/.test(line) || /^\s*\\begin\{equation/.test(line)) {
            flushProse(buf);
            buf = [];
            // 先检测单行闭合 $$...$$，避免把后续正文全部吞进 math
            const trimmed = line.trim();
            if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 4) {
                segments.push({ kind: 'math', text: line });
                i += 1;
                continue;
            }
            const start = i;
            if (/^\s*\$\$/.test(line)) {
                const end = lines.findIndex((l, j) => j > i && /^\s*\$\$/.test(l));
                const endIdx = end > 0 ? end : lines.length - 1;
                segments.push({ kind: 'math', text: lines.slice(start, endIdx + 1).join('\n') });
                i = endIdx + 1;
            }
            else {
                const end = lines.findIndex((l, j) => j > i && /\\end\{equation/.test(l));
                const endIdx = end > 0 ? end : lines.length - 1;
                segments.push({ kind: 'math', text: lines.slice(start, endIdx + 1).join('\n') });
                i = endIdx + 1;
            }
            continue;
        }
        // Markdown 表格（当前行含 | 且下一行是分隔符 |---|）
        if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|—-]+\|?\s*$/.test(lines[i + 1])) {
            flushProse(buf);
            buf = [];
            const start = i;
            while (i < lines.length && /^\s*\|/.test(lines[i]))
                i += 1;
            segments.push({ kind: 'table', text: lines.slice(start, i).join('\n') });
            continue;
        }
        // 普通行 → prose 缓冲
        buf.push(line);
        i += 1;
    }
    flushProse(buf);
    const headings = segments.filter((s) => s.kind === 'heading').map((s) => s.text);
    const references = segments.filter((s) => s.kind === 'reference').map((s) => s.text).join('\n');
    const prose = segments
        .filter((s) => s.kind === 'prose' || s.kind === 'heading')
        .map((s) => s.text)
        .join('\n\n');
    return { raw: text, segments, prose, headings, references };
}
/** 常见论文章节名（用于 section detection） */
const SECTION_NAMES = [
    'abstract', 'introduction', 'methods', 'methodology', 'materials and methods',
    'results and discussion', 'results & discussion', 'results',
    'discussion', 'conclusion', 'conclusions', 'limitations', 'related work',
    '摘要', '引言', '方法', '材料与方法', '结果与讨论', '结果', '讨论', '结论', '局限性', '相关工作',
];
/**
 * v0.4 section detection：把 heading 段映射到章节，正文按章节归组。
 * v0.5.1：维护 heading hierarchy——Discussion 下的 "Sample size / External validity /
 * Measurement" 子标题不拆成三个 section。
 * v0.5.2：章节基准层级 = 第一个匹配常见章节名的 heading 的层级。Markdown 常见结构
 * "# 论文标题" + "## Introduction/## Methods" 时章节是 level 2；全用 "# Introduction"
 * 时基准为 1。修复了旧实现把 "# 标题" 当章节、所有正文归入其下导致跨章节检测失效的问题。
 */
export function detectSections(view) {
    let baseLevel = 1;
    for (const seg of view.segments) {
        if (seg.kind !== 'heading')
            continue;
        const level = seg.headingLevel ?? 1;
        const lower = seg.text.toLowerCase();
        if (SECTION_NAMES.some((s) => lower.includes(s))) {
            baseLevel = level;
            break;
        }
    }
    const sections = [];
    let current = 'unknown';
    let buf = [];
    const flush = () => {
        if (buf.length > 0) {
            sections.push({ name: current, text: buf.join('\n') });
            buf = [];
        }
    };
    for (const seg of view.segments) {
        if (seg.kind === 'heading') {
            const level = seg.headingLevel ?? 1;
            if (level === baseLevel) {
                flush();
                const lower = seg.text.toLowerCase();
                const matched = SECTION_NAMES.find((s) => lower.includes(s));
                current = matched ?? seg.text.slice(0, 40);
            }
            // 子标题（level ≠ 基准）：不新开 section，正文继续归当前顶层章节
        }
        else if (seg.kind === 'prose') {
            buf.push(seg.text);
        }
    }
    flush();
    return sections;
}
/**
 * v0.6 重复绕圈检测：段内句子两两 cosine 相似 ≥0.72，且后句未引入新的
 * 证据实体（数字/引用/图表编号/大写实体）→ 疑似同一观点换说法重复解释。
 * 每段最多报 1 对。纯 token 统计，零 LLM。
 */
export function findRestatementLoops(text, max) {
    const out = [];
    const paragraphs = text
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
    for (let pi = 0; pi < paragraphs.length && out.length < max; pi++) {
        const sents = splitSentences(paragraphs[pi]).slice(0, 12);
        if (sents.length < 3)
            continue;
        const toks = sents.map(tokenizeForSimilarity);
        const evs = sents.map(evidenceTokens);
        let reported = false;
        for (let i = 0; i < sents.length - 1 && !reported; i++) {
            for (let j = i + 1; j < sents.length && !reported; j++) {
                const sim = cosineSimilarity(toks[i], toks[j]);
                if (sim >= 0.72) {
                    const newEvidence = [...evs[j]].filter((e) => !evs[i].has(e));
                    if (newEvidence.length === 0) {
                        out.push({ paraIndex: pi, sim, sentences: [sents[i], sents[j]] });
                        reported = true;
                    }
                }
            }
        }
    }
    return out;
}
/** 连续 N 段长度"太接近"的判定窗口（段数） */
const NEAR_EQUAL_RUN_MIN = 3;
/** 局部中位数 ± 容差比例 */
const NEAR_EQUAL_TOL = 0.15;
/** 拥塞长段：长度 > 全局中位数 × 该倍数 */
const LONG_OUTLIER_MULT = 2.5;
/** 一句成段：段内句子数 == 1 */
const SINGLETON_SENTENCES = 1;
export function analyzeParagraphRhythm(paragraphs) {
    const lens = paragraphs.map((p) => countWords(p.trim()));
    const total = lens.length;
    if (total === 0) {
        return { total: 0, singletonCount: 0, singletonRatio: 0, lengthMedian: 0, lengthStd: 0, lengthCV: 0, longOutlierCount: 0, longOutlierRatio: 0, nearEqualRunCount: 0 };
    }
    const singletonCount = paragraphs.filter((p) => splitSentences(p).length === SINGLETON_SENTENCES).length;
    const median = medianOf(lens);
    const std = stdOf(lens);
    const mean = lens.reduce((a, b) => a + b, 0) / total;
    const longOutlierCount = lens.filter((n) => median > 0 && n > median * LONG_OUTLIER_MULT).length;
    // 连续段长 run：每段与下一段长度差都在局部中位数 ±15% 内
    let nearEqualRunCount = 0;
    if (total >= NEAR_EQUAL_RUN_MIN) {
        let run = 1;
        for (let i = 1; i < total; i++) {
            const lo = median * (1 - NEAR_EQUAL_TOL);
            const hi = median * (1 + NEAR_EQUAL_TOL);
            const within = (n) => n >= lo && n <= hi;
            if (within(lens[i]) && within(lens[i - 1])) {
                run += 1;
                if (run >= NEAR_EQUAL_RUN_MIN) {
                    nearEqualRunCount += 1;
                    run = 1; // 每个 run 计一次后重置（重叠 run 只报一次）
                }
            }
            else {
                run = 1;
            }
        }
    }
    return {
        total,
        singletonCount,
        singletonRatio: total > 0 ? Math.round((singletonCount / total) * 1000) / 1000 : 0,
        lengthMedian: median,
        lengthStd: Math.round(std * 100) / 100,
        lengthCV: mean > 0 ? Math.round((std / mean) * 1000) / 1000 : 0,
        longOutlierCount,
        longOutlierRatio: total > 0 ? Math.round((longOutlierCount / total) * 1000) / 1000 : 0,
        nearEqualRunCount,
    };
}
/** v1.3 段落节奏判定阈值（无作者 profile 时的 conservative heuristic） */
const PARAGRAPH_RHYTHM_GATES = {
    /** 碎片化：一句成段比例 ≥ 该值 且 数量 ≥ 该值 */
    singletonRatioMin: 0.35,
    singletonCountMin: 3,
    /** 拥塞：长段 outlier 比例 ≥ 该值 且 数量 ≥ 该值 */
    outlierRatioMin: 0.15,
    outlierCountMin: 2,
    /** 过度整齐：连续等长 run 数 ≥ 该值 */
    nearEqualRunMin: 2,
};
const SENTENCE_RUN_MIN = 3;
const SENTENCE_RUN_TOL = 0.15;
/** 当前 std 低于作者历史 std 的比例阈值（明显更整齐） */
const AUTHOR_STD_RATIO = 0.6;
export function analyzeSentenceRhythm(paragraphs, styleProfile) {
    const allLens = [];
    let runCount = 0;
    for (const para of paragraphs) {
        const lens = splitSentences(para).map((s) => countWords(s));
        if (lens.length < SENTENCE_RUN_MIN)
            continue;
        allLens.push(...lens);
        const med = medianOf(lens);
        const lo = med * (1 - SENTENCE_RUN_TOL);
        const hi = med * (1 + SENTENCE_RUN_TOL);
        let run = 1;
        for (let i = 1; i < lens.length; i++) {
            const within = (n) => n >= lo && n <= hi;
            if (within(lens[i]) && within(lens[i - 1])) {
                run += 1;
                if (run >= SENTENCE_RUN_MIN) {
                    runCount += 1;
                    run = 1;
                }
            }
            else {
                run = 1;
            }
        }
    }
    const std = stdOf(allLens);
    const mean = allLens.length > 0 ? allLens.reduce((a, b) => a + b, 0) / allLens.length : 0;
    const cv = mean > 0 ? std / mean : 0;
    const authorStd = styleProfile?.sentenceLengthStd;
    const authorCv = styleProfile?.sentenceLengthCV;
    return {
        totalSentences: allLens.length,
        runCount,
        std: Math.round(std * 100) / 100,
        cv: Math.round(cv * 1000) / 1000,
        authorStd,
        authorCv,
        uniformByRun: runCount >= 2,
        uniformVsAuthor: !!authorStd && authorStd > 0 && std < authorStd * AUTHOR_STD_RATIO,
    };
}
/**
 * v1.3 重复逻辑脚手架：段落抽象成枚举签名（首先→其次→最后 / 第一→第二→第三 /
 * First→Second→Third / 从X层面→从Y层面→从Z层面），同一签名出现在 ≥2 个不同段落 → 模板化。
 */
const SCAFFOLD_ENUM = [
    // 中文枚举（词边界：后跟标点/空白/句末）
    { re: /(?:首先|其一|第一)(?=[，,、。;；:\s])/g, sig: '1' },
    { re: /(?:其次|其二|第二)(?=[，,、。;；:\s])/g, sig: '2' },
    { re: /(?:再次|其三|第三)(?=[，,、。;；:\s])/g, sig: '3' },
    { re: /(?:最后|其四|第四|终)(?=[，,、。;；:\s])/g, sig: '4' },
    // 中文"从X层面"（从制度层面/从执行层面/从效果层面；不要求后随标点，靠 ≥2 个不同实例成脚手架）
    { re: /从[^，。;；\s]{1,12}(?:层面|角度|视角)/g, sig: 'P' },
    // 英文枚举
    { re: /\b(?:first|firstly|one)\b(?=[,，\s:])/gi, sig: '1' },
    { re: /\b(?:second|secondly|two)\b(?=[,，\s:])/gi, sig: '2' },
    { re: /\b(?:third|thirdly|three)\b(?=[,，\s:])/gi, sig: '3' },
    { re: /\b(?:fourth|fourthly|finally|last(?:ly)?)\b(?=[,，\s:])/gi, sig: '4' },
];
/** 段落 → 枚举签名（如 "1-2-3"、"1-2-4"、"P-P-P"）；不足 2 个枚举返回 null */
export function scaffoldSignature(paragraph) {
    const found = [];
    for (const { re, sig } of SCAFFOLD_ENUM) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(paragraph)) !== null) {
            found.push({ idx: m.index, sig, text: m[0] });
            re.lastIndex = m.index + 1; // 同一枚举词多次出现都记位置
        }
    }
    found.sort((a, b) => a.idx - b.idx);
    const sig = found.map((f) => f.sig).join('-');
    // 至少 2 个枚举标记才算"脚手架"；纯重复同一标记不算（"第一…第一…"是并列强调不是枚举）
    const distinctSigs = new Set(found.map((f) => f.sig));
    const distinctTexts = new Set(found.map((f) => f.text));
    const valid = found.length >= 2 && (distinctSigs.size >= 2 || distinctTexts.size >= 2);
    return valid ? sig : null;
}
/** v1.3 跨段落重复脚手架检测：签名 → 段落数；≥2 段用同一签名 → 报 */
export function findRepeatedScaffolds(paragraphs) {
    const sigCount = new Map();
    for (const p of paragraphs) {
        const sig = scaffoldSignature(p);
        if (sig)
            sigCount.set(sig, (sigCount.get(sig) ?? 0) + 1);
    }
    return [...sigCount.entries()]
        .filter(([, c]) => c >= 2)
        .map(([signature, count]) => ({ signature, count }))
        .sort((a, b) => b.count - a.count);
}
/**
 * v1.3 标点脚手架过载：同一句内出现 ≥3 类不同"结构标点"
 * （括号/冒号/分号/引号/破折号）→ 用标点承担句法组织的信号。
 * 括号类排除单字母形式（(a)(b)(c) 图注/列表是学术规范，不算聚集）。
 */
const STRUCTURAL_PUNC_CLASSES = [
    /[（(][^)）]{2,}[)）]/g, // 括号（内容 ≥2 字符；(a)(b) 单字母图注不算）
    /[：:]/g, // 冒号
    /[；;]/g, // 分号
    /[“”"「」『』]/g, // 引号
    /(——|—|–)/g, // 破折号
];
const PUNC_OVERLOAD_MIN_CLASSES = 3;
/** 符号定义列表（1) 术语(缩写): 定义; 补充 / 2) Level-2 (unseen-combination): ...）是论文方法章标准格式，不报 */
const DEF_LIST_RE = /^\s*(?:\d+\)?|\([a-z]\)|[a-z]\))\s*[A-Za-z0-9][\w\s\-/²]{1,40}\([A-Za-z0-9²\-]{1,24}\)\s*:/i;
export function findPunctuationOverloads(paragraphs) {
    const out = [];
    for (let pi = 0; pi < paragraphs.length && out.length < 3; pi++) {
        for (const s of splitSentences(paragraphs[pi])) {
            if (DEF_LIST_RE.test(s))
                continue;
            let classes = 0;
            for (const re of STRUCTURAL_PUNC_CLASSES) {
                re.lastIndex = 0;
                if (re.test(s))
                    classes += 1;
            }
            if (classes >= PUNC_OVERLOAD_MIN_CLASSES) {
                out.push({ paraIndex: pi, classes, snippet: s.slice(0, 160) });
                break; // 每段最多报 1 句
            }
        }
    }
    return out;
}
/**
 * v1.3 自创框架词/组合词（形式规则，不依赖具体词表）：
 *  - A-B-C 中文短线框架："输入—处理—输出"、"问题-原因-对策"
 *  - 连续多个"XX化 / XX力 / XX性"（同一段 ≥2 个不同实例）
 *  - "XX闭环 / XX赋能机制 / XX体系"
 * 全部 candidate（"可持续性""系统性"在很多论文中完全正常，只提示形式聚集）。
 */
const ABC_FRAME_RE = /[\u4e00-\u9fff]{1,4}(?:-|—|–)[\u4e00-\u9fff]{1,4}(?:-|—|–)[\u4e00-\u9fff]{1,4}/g;
// "XX化/XX力"：生产性造词信号强（深度化/场景化/穿透力），≥2 个不同实例即提示
const SUFFIX_FORM_RE = /[\u4e00-\u9fff]{1,3}(?:化|力)/g;
// "XX性"：可持续性/系统性/协同性都是正当术语，需 ≥3 个不同实例才提示
const SUFFIX_XING_RE = /[\u4e00-\u9fff]{1,3}性/g;
const CLOSED_LOOP_RE = /[\u4e00-\u9fff]{1,4}(?:闭环|赋能机制|生态体系|协同机制|联动机制)/g;
const COINED_MIN_DISTINCT = 2;
const XING_MIN_DISTINCT = 3;
export function findCoinedFrameworks(paragraphs) {
    const out = [];
    for (let pi = 0; pi < paragraphs.length; pi++) {
        const p = paragraphs[pi];
        // A-B-C 短线框架：出现一次即提示（候选，低危）
        ABC_FRAME_RE.lastIndex = 0;
        let m;
        while ((m = ABC_FRAME_RE.exec(p)) !== null) {
            out.push({ paraIndex: pi, kind: 'abc-frame', snippet: m[0] });
            break; // 每段一个框架提示即可
        }
        // XX化/XX力：同一段 ≥2 个不同实例（深度化/场景化/生态化…）
        const suffixes = new Set();
        SUFFIX_FORM_RE.lastIndex = 0;
        while ((m = SUFFIX_FORM_RE.exec(p)) !== null) {
            suffixes.add(m[0]);
            if (suffixes.size >= COINED_MIN_DISTINCT)
                break;
        }
        if (suffixes.size >= COINED_MIN_DISTINCT) {
            out.push({ paraIndex: pi, kind: 'suffix-form', snippet: [...suffixes].slice(0, 4).join(' / ') });
        }
        // XX性：需 ≥3 个不同实例（可持续性/系统性单独出现是正当术语）
        const xings = new Set();
        SUFFIX_XING_RE.lastIndex = 0;
        while ((m = SUFFIX_XING_RE.exec(p)) !== null) {
            xings.add(m[0]);
            if (xings.size >= XING_MIN_DISTINCT)
                break;
        }
        if (xings.size >= XING_MIN_DISTINCT) {
            out.push({ paraIndex: pi, kind: 'suffix-form', snippet: [...xings].slice(0, 4).join(' / ') });
        }
        // 闭环/赋能机制/体系
        CLOSED_LOOP_RE.lastIndex = 0;
        while ((m = CLOSED_LOOP_RE.exec(p)) !== null) {
            out.push({ paraIndex: pi, kind: 'closed-loop', snippet: m[0] });
            break;
        }
    }
    return out.slice(0, 4);
}
/**
 * v1.3 正确但空泛（generic-claim-candidate）：仅当一句话同时满足多个弱信号才报——
 * 抽象名词多 + 无实体（数字/引用/大写实体）+ 无方法动作 + 命中万能句型。
 * findingKind=candidate、confidence=low（理论/定性论文不误伤）。
 */
const GENERIC_ABSTRACT = /(机制|支撑|动态|稳健|范式|耦合|协同|维度|体系|闭环|赋能|生态|价值|全方位|多维度|深层次|\bcomprehensive(?:ly)?\b|\bholistic\b|\boverall\b|\beffective(?:ness)?\b|\bmeaningful\b|\bsignificant\b|\bframework\b|\bintegration\b|\bapproach\b)/gi;
const GENERIC_TEMPLATES = /(通过深入分析发现|需要[^，。；]{2,16}(进行|加以)[^，。；]{2,16}(解决|提升|处理|应对)|以充分发挥[^，。；]{1,12}的作用|在[^，。；]{2,16}的过程中发挥着?[^，。；]{1,10}(作用|价值)|对[^，。；]{2,16}(具有|起到)[^，。；]{1,10}(意义|价值|作用))/g;
export function findGenericClaims(paragraphs) {
    const out = [];
    for (let pi = 0; pi < paragraphs.length && out.length < 3; pi++) {
        for (const s of splitSentences(paragraphs[pi])) {
            const signals = [];
            const abstractHits = s.match(GENERIC_ABSTRACT) ?? [];
            if (abstractHits.length >= 2)
                signals.push(`抽象名词×${abstractHits.length}`);
            // 实体检测：数字/引用/图表编号/专有实体（句首大写词不算——"This/We/Our" 是普通句首词）
            const body = s.replace(/^\s*[A-Z][a-z]{1,3}\s+/, '');
            const hasEntity = /\d|\\cite|\\ref|Figure\s*\d|Table\s*\d|[A-Z][a-z]{2,}/.test(body);
            if (!hasEntity)
                signals.push('无实体/数值/引用');
            // /g 正则 test() 有 lastIndex 污染——用非全局克隆
            if (!/^(?:analyz|analys|measure|compare|estimate|derive|compute|evaluate|examine|investigat|simulat|model|test|assess|quantif|observ)\w*/i.test(s))
                signals.push('无方法动作');
            if (GENERIC_TEMPLATES.test(s))
                signals.push('万能句型');
            if (signals.length >= 3) {
                out.push({ paraIndex: pi, signals, sentence: s.slice(0, 160) });
                break;
            }
        }
    }
    return out;
}
/** 极简 .bib 解析（@type{key, field = {value}, ...}；支持字段值内嵌套花括号的简单情况） */
export function parseBibText(bibText) {
    const out = [];
    const entryRe = /@(\w+)\s*\{\s*([^,\s]+)\s*,/g;
    let m;
    while ((m = entryRe.exec(bibText)) !== null) {
        // 从 key 后开始平衡花括号扫描条目体（支持 title = {A {B} C} 这类嵌套）
        const start = m.index + m[0].length;
        let depth = 1;
        let i = start;
        while (i < bibText.length && depth > 0) {
            if (bibText[i] === '{')
                depth += 1;
            else if (bibText[i] === '}')
                depth -= 1;
            i += 1;
        }
        const body = bibText.slice(start, i - 1);
        const field = (name) => {
            const fm = new RegExp(`\\b${name}\\s*=\\s*\\{((?:[^{}]|\\{[^{}]*\\})*)\\}`, 'i').exec(body);
            return fm ? fm[1].trim() : undefined;
        };
        out.push({
            key: m[2],
            title: field('title'),
            year: field('year'),
            author: field('author'),
            doi: field('doi'),
        });
    }
    return out;
}
/** 正文 \cite key 提取（含多 key：\cite{a,b}） */
function extractCiteKeys(text) {
    const re = /\\cite(?:\[[^\]]*\])?\{([^{}]*)\}/g;
    const keys = [];
    let m;
    while ((m = re.exec(text)) !== null) {
        for (const k of m[1].split(',')) {
            const t = k.trim();
            if (t)
                keys.push(t);
        }
    }
    return keys;
}
/** \label 与 \ref 提取 */
function extractLabelsRefs(text) {
    const labels = new Set();
    const refs = [];
    let m;
    const lRe = /\\label\{([^{}]*)\}/g;
    while ((m = lRe.exec(text)) !== null)
        labels.add(m[1].trim());
    const rRe = /\\ref\{([^{}]*)\}/g;
    while ((m = rRe.exec(text)) !== null)
        refs.push(m[1].trim());
    return { labels, refs };
}
export function checkCitationIntegrity(text, bibText) {
    const hits = [];
    const entries = parseBibText(bibText);
    const keys = new Set(entries.map((e) => e.key));
    // 1. unresolved \cite key
    for (const k of extractCiteKeys(text)) {
        if (!keys.has(k))
            hits.push({ kind: 'unresolved-cite', detail: `\\cite{${k}} 在 .bib 中不存在` });
    }
    // 2. \ref ↔ \label
    const { labels, refs } = extractLabelsRefs(text);
    for (const r of refs) {
        if (!labels.has(r))
            hits.push({ kind: 'missing-label', detail: `\\ref{${r}} 无对应 \\label{${r}}` });
    }
    // 3. bib 条目缺 title/year/author（最多报 5 条）
    let incomplete = 0;
    for (const e of entries) {
        if (incomplete >= 5)
            break;
        const missing = [];
        if (!e.title)
            missing.push('title');
        if (!e.year)
            missing.push('year');
        if (!e.author)
            missing.push('author');
        if (missing.length > 0) {
            incomplete += 1;
            hits.push({ kind: 'incomplete-bib-entry', detail: `${e.key} 缺字段: ${missing.join('/')}` });
        }
    }
    // 4. 同一 DOI 对应多个 key
    const doiKeys = new Map();
    for (const e of entries) {
        if (!e.doi)
            continue;
        const d = e.doi.toLowerCase();
        const arr = doiKeys.get(d) ?? [];
        arr.push(e.key);
        doiKeys.set(d, arr);
    }
    for (const [d, ks] of doiKeys) {
        if (ks.length > 1)
            hits.push({ kind: 'duplicate-doi', detail: `DOI ${d} 对应多个 key: ${ks.join(', ')}` });
    }
    return hits;
}
/**
 * v1.3 版式元素行判定：整行加粗/斜体标题（**1. Introduction**）、图片行
 * （![](...)）、纯分隔符行（表格残留 --------）、作者上标行（^a^ ...）、
 * 关键词行（**Keywords:** ...）——这些是正常版式，不是"一句成段"碎片化。
 */
function isLayoutOnlyParagraph(p) {
    const t = p.trim();
    // 整行加粗/斜体标题（**Figure 9. ...** / *2.1.1 ...* / **Abstract**）
    if (/^\*\*[^*]{1,150}\*\*$/.test(t))
        return true;
    if (/^\*[^*]{1,150}\*$/.test(t))
        return true;
    // 图片行
    if (/^!\[[^\]]*\]\([^)]*\)/.test(t))
        return true;
    // 纯分隔符/表格残留行（-------- ------------）
    if (/^[\s\-–—:|+=\\.]{6,}$/.test(t))
        return true;
    // 作者上标行（^a^ Fujian Key Laboratory ...）
    if (/^\^[a-z]\^?\s/.test(t))
        return true;
    // 关键词行（**Keywords:** / **Key words:**）
    if (/^\*{0,2}\s*key\s?words?\s*:?\s*\*{0,2}/i.test(t))
        return true;
    return false;
}
/**
 * v1.3 总结套话位置感知：不新增词表——检测"同一总结套话在每个小节末尾反复出现"。
 * 每个 section 取最后一句（或最后 20% 文本），命中套话词记一次；≥2 个 section 末尾
 * 都出现 → 模板化信号（"每个小节末尾都来一句总结"）。
 */
const SUMMARY_CLICHE_RE = /(综上所述|总而言之|总的来说|综上|由此可见|不难发现|可以看出|总之|综上可见|in conclusion|to sum up|in summary|overall,|taken together)/gi;
export const SUMMARY_CLICHE_MIN_SECTIONS = 2;
export function findSummaryClicheBySection(sections) {
    const out = [];
    for (const sec of sections) {
        const sents = splitSentences(sec.text);
        if (sents.length === 0)
            continue;
        // 位置感知：只取最后一句（小节末尾）
        const last = sents[sents.length - 1];
        const m = last.match(SUMMARY_CLICHE_RE);
        if (m)
            out.push({ name: sec.name, cliche: m[0] });
    }
    return out;
}
export function auditText(text, opts) {
    const profile = opts?.profile ?? 'unknown';
    const maxParagraphs = opts?.maxParagraphs ?? 400;
    // v0.4 preprocessing：默认剥离 references/code/math/URL，规则只扫 prose
    const view = opts?.preprocess === false
        ? { raw: text, prose: text, segments: [{ kind: 'prose', text }], headings: [], references: '' }
        : preprocess(text);
    const scanText = view.prose;
    const paragraphs = scanText
        .split(/\n{2,}|\r?\n\r?\n/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
        .slice(0, maxParagraphs);
    // v1.3：节奏类规则（段落/句长）只用 prose-only 段落——标题行（heading）单独成行
    // 会污染"一句成段"统计（论文标题/图注一行一段是正常版式，不是碎片化）
    const proseParagraphs = view.segments
        .filter((s) => s.kind === 'prose')
        .flatMap((s) => s.text.split(/\n{2,}|\r?\n\r?\n/))
        .map((p) => p.trim())
        .filter((p) => p.length > 0 && !isLayoutOnlyParagraph(p))
        .slice(0, maxParagraphs);
    // v0.4：按 segment 类型分组文本（stats 与规则共用同一来源）
    const segTextByKind = {};
    for (const seg of view.segments) {
        const prev = segTextByKind[seg.kind] ?? '';
        segTextByKind[seg.kind] = prev ? prev + '\n\n' + seg.text : seg.text;
    }
    const headingText = segTextByKind.heading ?? '';
    const { englishWords, cjkChars } = countLexicalUnits(scanText);
    const words = englishWords + cjkChars;
    const stats = {
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
    };
    const hits = [];
    // v0.4：section-based 规则（如 limitation-dispersal）——先做跨章节检测
    const sections = detectSections(view);
    for (const rule of RULES) {
        // 文档类型过滤
        if (!ruleMatchesProfile(rule, profile))
            continue;
        // 语言过滤：无法可靠检测语言时全部执行（规则本身多为双语正则）
        // v0.4 section-based 规则：统计命中章节数，≥ threshold 才报
        if (rule.sectionBased) {
            const threshold = rule.sectionThreshold ?? 3;
            const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags + 'g');
            const hitSections = new Map();
            for (const sec of sections) {
                const m = sec.text.match(re);
                if (m && m.length > 0)
                    hitSections.set(sec.name, (hitSections.get(sec.name) ?? 0) + m.length);
            }
            if (hitSections.size >= threshold) {
                const detail = [...hitSections.entries()].map(([n, c]) => `${n}×${c}`).join(', ');
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
                });
            }
            continue;
        }
        // v0.6 restatement-loop 规则：段内句子相似度（不依赖固定词表）
        if (rule.restatementLoop) {
            const loops = findRestatementLoops(scanText, rule.maxHits ?? 3);
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
                });
            }
            continue;
        }
        // v1.3 paragraph-rhythm：段落节奏（碎片化/拥塞/过度整齐）——aggregate 统计（prose-only，排除标题）
        if (rule.paragraphRhythm) {
            const sig = analyzeParagraphRhythm(proseParagraphs);
            const g = PARAGRAPH_RHYTHM_GATES;
            const sub = [];
            if (sig.total >= 6) {
                if (sig.singletonRatio >= g.singletonRatioMin && sig.singletonCount >= g.singletonCountMin) {
                    sub.push(`碎片化：${sig.singletonCount}/${sig.total} 段是一句成段（${(sig.singletonRatio * 100).toFixed(0)}%）`);
                }
                if (sig.longOutlierRatio >= g.outlierRatioMin && sig.longOutlierCount >= g.outlierCountMin) {
                    sub.push(`拥塞：${sig.longOutlierCount} 段长度 > 段长中位数 ${sig.lengthMedian} 的 ${LONG_OUTLIER_MULT} 倍`);
                }
                if (sig.nearEqualRunCount >= g.nearEqualRunMin) {
                    sub.push(`过度整齐：${sig.nearEqualRunCount} 处连续 ${NEAR_EQUAL_RUN_MIN}+ 段长度在中位数 ±${NEAR_EQUAL_TOL * 100}% 内`);
                }
            }
            if (sub.length > 0) {
                hits.push({
                    ruleId: rule.id,
                    category: rule.category,
                    severity: rule.severity,
                    confidence: rule.confidence,
                    label: rule.label,
                    paragraphIndex: -1,
                    snippet: `（段落统计 ${sig.total} 段，中位长 ${sig.lengthMedian}，CV ${sig.lengthCV}）${sub.join('；')}`,
                    message: rule.message,
                    suggestion: rule.suggestion,
                    note: rule.note,
                    evidence: rule.evidence,
                    findingKind: rule.findingKind,
                    density: { count: sig.total, perK: 0 },
                    matchText: `paragraph-rhythm:${sub.join('|').slice(0, 60)}`,
                });
            }
            continue;
        }
        // v1.3 sentence-rhythm-uniformity：句长节奏均匀（局部 run + 历史 std 对比）
        if (rule.sentenceRhythm) {
            const sr = analyzeSentenceRhythm(proseParagraphs, opts?.styleProfile);
            if (sr.totalSentences >= 8 && (sr.uniformByRun || sr.uniformVsAuthor)) {
                const why = [];
                if (sr.uniformByRun)
                    why.push(`全文 ${sr.runCount} 处连续 ${SENTENCE_RUN_MIN}+ 句长度相近`);
                if (sr.uniformVsAuthor)
                    why.push(`当前句长 std ${sr.std} 明显低于作者历史 ${sr.authorStd}（< ${AUTHOR_STD_RATIO * 100}%）`);
                hits.push({
                    ruleId: rule.id,
                    category: rule.category,
                    severity: rule.severity,
                    confidence: rule.confidence,
                    label: rule.label,
                    paragraphIndex: -1,
                    snippet: `（句长统计 ${sr.totalSentences} 句，std ${sr.std}，CV ${sr.cv}）${why.join('；')}`,
                    message: rule.message,
                    suggestion: rule.suggestion,
                    note: rule.note,
                    evidence: rule.evidence,
                    findingKind: rule.findingKind,
                    density: { count: sr.totalSentences, perK: 0 },
                    matchText: `sentence-rhythm:${sr.uniformByRun ? 'run' : ''}${sr.uniformVsAuthor ? 'author' : ''}`,
                });
            }
            continue;
        }
        // v1.3 repeated-discourse-scaffold：跨段落重复枚举脚手架
        if (rule.scaffoldRepeat) {
            const scaffolds = findRepeatedScaffolds(proseParagraphs);
            for (const sc of scaffolds.slice(0, 2)) {
                hits.push({
                    ruleId: rule.id,
                    category: rule.category,
                    severity: rule.severity,
                    confidence: rule.confidence,
                    label: rule.label,
                    paragraphIndex: -1,
                    snippet: `（脚手架签名 ${sc.signature}）${sc.count} 个独立段落重复使用相同枚举骨架`,
                    message: rule.message,
                    suggestion: rule.suggestion,
                    note: rule.note,
                    evidence: rule.evidence,
                    findingKind: rule.findingKind,
                    matchText: `scaffold:${sc.signature}`,
                });
            }
            continue;
        }
        // v1.3 punctuation-scaffold-overload：标点组合聚集
        if (rule.punctuationOverload) {
            const overs = findPunctuationOverloads(proseParagraphs);
            for (const o of overs) {
                hits.push({
                    ruleId: rule.id,
                    category: rule.category,
                    severity: rule.severity,
                    confidence: rule.confidence,
                    label: rule.label,
                    paragraphIndex: o.paraIndex,
                    snippet: `（${o.classes} 类结构标点同句聚集）${o.snippet}`,
                    message: rule.message,
                    suggestion: rule.suggestion,
                    note: rule.note,
                    evidence: rule.evidence,
                    findingKind: rule.findingKind,
                    matchText: `punct:${o.snippet.slice(0, 40)}`,
                });
            }
            continue;
        }
        // v1.3 coined-framework-language：自创框架词（形式规则，全 candidate）
        if (rule.coinedFramework) {
            const frames = findCoinedFrameworks(proseParagraphs);
            for (const f of frames) {
                const kindLabel = f.kind === 'abc-frame' ? 'A-B-C 短线框架' : f.kind === 'suffix-form' ? '后缀造词（化/力/性）' : '闭环/机制类框架词';
                hits.push({
                    ruleId: rule.id,
                    category: rule.category,
                    severity: rule.severity,
                    confidence: rule.confidence,
                    label: rule.label,
                    paragraphIndex: f.paraIndex,
                    snippet: `（${kindLabel}）${f.snippet}`,
                    message: rule.message,
                    suggestion: rule.suggestion,
                    note: rule.note,
                    evidence: rule.evidence,
                    findingKind: rule.findingKind,
                    matchText: `coined:${f.kind}:${f.snippet.slice(0, 40)}`,
                });
            }
            continue;
        }
        // v1.3 generic-claim-candidate：正确但空泛（多弱信号组合）
        if (rule.genericClaim) {
            const claims = findGenericClaims(proseParagraphs);
            for (const c of claims) {
                hits.push({
                    ruleId: rule.id,
                    category: rule.category,
                    severity: rule.severity,
                    confidence: rule.confidence,
                    label: rule.label,
                    paragraphIndex: c.paraIndex,
                    snippet: `（弱信号：${c.signals.join('、')}）${c.sentence}`,
                    message: rule.message,
                    suggestion: rule.suggestion,
                    note: rule.note,
                    evidence: rule.evidence,
                    findingKind: rule.findingKind,
                    matchText: `generic:${c.sentence.slice(0, 40)}`,
                });
            }
            continue;
        }
        // v1.3 summary-cliche-positional：总结套话位置感知（每个小节末尾都出现）
        if (rule.summaryPositional) {
            const cliches = findSummaryClicheBySection(sections);
            const counts = new Map();
            for (const c of cliches)
                counts.set(c.cliche.toLowerCase(), (counts.get(c.cliche.toLowerCase()) ?? 0) + 1);
            for (const [cliche, n] of counts) {
                if (n >= SUMMARY_CLICHE_MIN_SECTIONS) {
                    const where = cliches.filter((c) => c.cliche.toLowerCase() === cliche).map((c) => c.name).slice(0, 5).join('、');
                    hits.push({
                        ruleId: rule.id,
                        category: rule.category,
                        severity: rule.severity,
                        confidence: rule.confidence,
                        label: rule.label,
                        paragraphIndex: -1,
                        snippet: `（位置感知）"${cliche}" 出现在 ${n} 个小节末尾：${where}`,
                        message: rule.message,
                        suggestion: rule.suggestion,
                        note: rule.note,
                        evidence: rule.evidence,
                        findingKind: rule.findingKind,
                        matchText: `summary-pos:${cliche}`,
                    });
                }
            }
            continue;
        }
        // v1.3 local-citation-integrity：\cite ↔ .bib / \ref ↔ \label（仅提供 bibText 时）
        if (rule.citationIntegrity) {
            if (opts?.bibText && opts.bibText.trim()) {
                const citHits = checkCitationIntegrity(view.raw, opts.bibText);
                for (const ch of citHits.slice(0, 8)) {
                    const sev = ch.kind === 'unresolved-cite' || ch.kind === 'missing-label' ? 'medium' : 'low';
                    const kind = ch.kind === 'unresolved-cite' || ch.kind === 'missing-label' ? 'violation' : 'advisory';
                    hits.push({
                        ruleId: rule.id,
                        category: rule.category,
                        severity: sev,
                        confidence: rule.confidence,
                        label: `${rule.label}（${ch.kind === 'unresolved-cite' ? '未解析引用' : ch.kind === 'missing-label' ? '缺失标签' : ch.kind === 'incomplete-bib-entry' ? '条目不完整' : 'DOI 重复'}）`,
                        paragraphIndex: -1,
                        snippet: `（.bib 一致性）${ch.detail}`,
                        message: rule.message,
                        suggestion: rule.suggestion,
                        note: rule.note,
                        evidence: rule.evidence,
                        findingKind: kind,
                        matchText: `cite:${ch.kind}:${ch.detail.slice(0, 60)}`,
                    });
                }
            }
            continue;
        }
        // v0.7 averageLength 规则：全文平均句长（按语言分别统计；各语言 ≥3 句才判定）。
        // 与 density/段落扫描不同：判定条件是"均值超上限"，按语言各报一次。
        if (rule.averageLength) {
            const sents = splitSentences(scanText);
            const enLens = [];
            const zhLens = [];
            for (const s of sents) {
                const { englishWords, cjkChars } = countLexicalUnits(s);
                if (englishWords > 0)
                    enLens.push(englishWords);
                if (cjkChars > 0)
                    zhLens.push(cjkChars);
            }
            const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
            const { enMaxWords, zhMaxChars } = rule.averageLength;
            if (enLens.length >= 3 && avg(enLens) > enMaxWords) {
                const enAvg = avg(enLens);
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
                });
            }
            if (zhLens.length >= 3 && avg(zhLens) > zhMaxChars) {
                const zhAvg = avg(zhLens);
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
                });
            }
            continue;
        }
        // segment 过滤（v0.4）：规则只扫自己声明的类型，缺省 prose
        const ruleSegs = rule.segments ?? ['prose'];
        const ruleText = ruleSegs.map((k) => segTextByKind[k] ?? '').filter((s) => s.length > 0).join('\n\n');
        if (!ruleText.trim())
            continue;
        // 密度规则（全文统计级）——v0.3.3 P0：用 segment 过滤后的文本；v0.4：只统计声明类型
        if (rule.threshold) {
            const count = countRuleOccurrences(rule, ruleText);
            const unit = rule.threshold.unit ?? 'word';
            const denominator = denominatorForRule(ruleText, rule, unit);
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
        // 段落级规则：只扫描规则声明的 segment 类型。
        // v0.5.2：用带 g 的克隆正则在同一段落内继续 exec，同段多处命中都报告（受 maxHits 全局上限约束）；
        // 不再修改共享的 rule.pattern.lastIndex。context 排除只跳过当前命中，继续本段后续位置。
        const ruleParagraphs = ruleText
            .split(/\n{2,}|\r?\n\r?\n/)
            .map((p) => p.trim())
            .filter((p) => p.length > 0)
            .slice(0, maxParagraphs);
        const maxHits = rule.maxHits ?? 3;
        let found = 0;
        const scanRe = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags + 'g');
        for (let i = 0; i < ruleParagraphs.length && found < maxHits; i++) {
            const para = ruleParagraphs[i];
            scanRe.lastIndex = 0;
            let m;
            while (found < maxHits && (m = scanRe.exec(para)) !== null) {
                // 命中位置局部上下文（v0.3.1 match-local）：只看当前 match ±window，不再整段排除
                if (rule.context && m.index !== undefined) {
                    const { window: w, exclude, require: requireRe } = rule.context;
                    const start = Math.max(0, m.index - w);
                    const end = Math.min(para.length, m.index + (m[0]?.length ?? 0) + w);
                    const windowText = para.slice(start, end);
                    if (exclude && exclude.test(windowText))
                        continue;
                    if (requireRe && !requireRe.test(windowText))
                        continue;
                }
                found += 1;
                const start = Math.max(0, m.index - 60);
                const end = Math.min(para.length, m.index + (m[0]?.length ?? 0) + 80);
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
                    matchText: m[0],
                });
            }
            scanRe.lastIndex = 0;
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
                message: `检测到项目内部词表条目 "${m[0]}"（可通过 writing_audit 的 projectResidueTerms 参数或插件配置维护）。`,
                suggestion: '确认为内部流程词则删除或改写；若不是内部词，请从 projectResidueTerms 移除。',
                evidence: { type: 'project-specific' },
                findingKind: 'violation',
                matchText: m[0],
            });
            re.lastIndex = 0;
        }
    }
    // v0.8：科学完整性回归摘要（仅 original 对比时生成）
    let integrity;
    // v0.6 Scholarship Lock：对比修改前后的科研实体（数字/引用/图表编号/DOI）。
    // 注意用原始文本（view.raw）——prose 已剥离 \cite 等 LaTeX 命令，无法对比引用。
    if (opts?.original !== undefined && opts.original.trim()) {
        // v0.9.3 版本差距保护（ESR 实测发现）：全文重写级别差异时行级对比全是噪音——
        // 对齐率 3.7% 时产出 171 条假引用变化与 "60 d → 5.5 mol" 类错配。低于阈值跳过双锁。
        // v1.1：min 分母 → symmetric coverage F1——before=100 句 after=10 句且 10 句全对齐时，
        // min 分母会误判 100%；F1 = 2·aligned/(before+after) 正确反映"90% 内容被删"。
        // v1.2：gap 判定用低阈值对齐（minSim 0.35）——短文档对里句子轻微重写
        //（"Z improved" → "Z did not improve" sim≈0.35）不应误判为全文重写。
        const bSents = splitSentences(opts.original);
        const aSents = splitSentences(view.raw);
        const alignedCount = alignSentences(bSents, aSents, 0.35).length;
        const alignRate = (2 * alignedCount) / Math.max(1, bSents.length + aSents.length);
        if (alignRate < 0.2) {
            // v1.2.2：version-gap 时行级配对跳过（会造假 pairing），但 Global Scholarship
            // Inventory（全文级确定性 multiset）仍计算——只给各实体类型的 removed/added 计数
            // 摘要，不做逐条"5 mg → 7 mg"式配对。
            // v1.2.3：改用 diffScholarshipInventory（完全不 pairing）——"5 mg→6 mg" 这类
            // 数值替换不再漏报（diffScholarship 会把它们配成 changed，从 removed/added 消失）；
            // 遍历全部 ScholarshipType，不再手写六个。
            const inv = diffScholarshipInventory(opts.original, view.raw);
            const invText = Object.keys(inv)
                .filter((t) => inv[t].removed > 0 || inv[t].added > 0)
                .map((t) => `${SCHOLARSHIP_TYPE_LABEL[t]}：移除 ${inv[t].removed} / 新增 ${inv[t].added}`)
                .join('；');
            hits.push({
                ruleId: 'version-gap',
                category: 'claim_calibration',
                severity: 'medium',
                confidence: 'medium',
                findingKind: 'advisory',
                label: '版本差距过大，行级完整性对比已跳过（全局科研实体清单见下）',
                paragraphIndex: -1,
                snippet: `（版本对比）句子对齐率 ${(alignRate * 100).toFixed(1)}%（${alignedCount}/${Math.min(bSents.length, aSents.length)} 句）。全局科研实体变化：${invText || '无'}（不做行级配对——跨全文大版本时顺序配对不可靠）`,
                message: '修改前后版本差异过大（全文重写级别），句子级 Scholarship/Epistemic Lock 的行级对比不可靠，已自动跳过；全局科研实体清单（引用/DOI/图表编号/数字等全类型的移除与新增计数）仍然计算，供人工核对结构级差异。',
                suggestion: '如需逐条数值对比，请提供更接近的中间版本，或逐章/逐节对比。',
                evidence: { type: 'heuristic' },
                matchText: 'version-gap',
            });
        }
        else {
            const diff = diffScholarship(opts.original, view.raw);
            // v1.2.1：lockTypes 补全 number/doi——"5 mg 被删"、"DOI 被换" 等不再只有摘要计数没有 hit
            const lockTypes = new Set(['number', 'percent', 'pvalue', 'ci', 'cite', 'ref', 'figure', 'table', 'doi']);
            for (const c of diff.changed) {
                hits.push({
                    ruleId: 'scholarship-lock',
                    category: 'claim_calibration',
                    severity: 'high',
                    confidence: 'high',
                    findingKind: 'invariant',
                    label: `科研实体被修改（${SCHOLARSHIP_TYPE_LABEL[c.type]}）`,
                    paragraphIndex: -1,
                    snippet: `${c.before} → ${c.after}`,
                    message: '润色操作改变了科研事实（数字/统计量/数值与修改前不一致）。如果这是有意的科学内容修改，请显式确认；如果只是语言润色，请恢复原值。',
                    suggestion: `恢复原值（${c.before}），或在回复中显式说明这是有意的科学修改（而非语言润色）。`,
                    evidence: { type: 'heuristic' },
                    matchText: `scholarship:${c.type}:${c.before}->${c.after}`,
                });
            }
            for (const r of diff.removed) {
                if (!lockTypes.has(r.type))
                    continue;
                hits.push({
                    ruleId: 'scholarship-lock',
                    category: 'claim_calibration',
                    severity: 'high',
                    confidence: 'high',
                    findingKind: 'invariant',
                    label: `科研实体消失（${SCHOLARSHIP_TYPE_LABEL[r.type]}）`,
                    paragraphIndex: -1,
                    snippet: r.value,
                    message: `修改后丢失了 ${SCHOLARSHIP_TYPE_LABEL[r.type]}：${r.value}。数字/引用/图表编号/DOI 不应在润色中被删除。`,
                    suggestion: '恢复被删除的实体；如确为有意删除，请显式确认。',
                    evidence: { type: 'heuristic' },
                    matchText: `scholarship-removed:${r.type}:${r.value}`,
                });
            }
            // v1.2.1：新增方向也生成 hit（MEDIUM——凭空新增数字/引用/DOI 同样需要作者确认）
            for (const a of diff.added) {
                if (!lockTypes.has(a.type))
                    continue;
                hits.push({
                    ruleId: 'scholarship-lock',
                    category: 'claim_calibration',
                    severity: 'medium',
                    confidence: 'medium',
                    findingKind: 'invariant',
                    label: `科研实体被引入（${SCHOLARSHIP_TYPE_LABEL[a.type]}）`,
                    paragraphIndex: -1,
                    snippet: a.value,
                    message: `修改后新增了 ${SCHOLARSHIP_TYPE_LABEL[a.type]}：${a.value}。语言润色不应凭空引入数字/引用/DOI——请确认这是有意的科学修改。`,
                    suggestion: '确认新增实体是作者授权的科学修改；若只是润色误加，删除它。',
                    evidence: { type: 'heuristic' },
                    matchText: `scholarship-added:${a.type}:${a.value}`,
                });
            }
            // v0.8/v0.9 Epistemic Lock：主张强度 / 否定 / 零结果 / scope 边界的润色前后对比。
            // 与 Scholarship Lock 互补——数字/引用没变，但科学结论可能已经被语言修改改变。
            // 原则：polishing 不得让科学主张沿阶梯静默移动（无论变强还是变弱）；负面、
            // 零结果、矛盾结果是数据，不得因削弱叙事而删除；scope 边界消失只要求核验。
            // v0.9：双轴（因果力/证据力）+ 子句级多主张 + 对齐相似度分档（≥0.70 high / ≥0.55 medium / ≥0.45 low）。
            const ed = diffEpistemic(opts.original, view.raw);
            // v1.2.1：位置兜底事件标注（短文本位置对齐 ≠ 高可信词面对齐）
            const fbSuffix = (d) => d.positionalFallback ? '（短文本位置兜底对齐，非词面对齐——请人工复核）' : '';
            for (const d of ed.claimDrift) {
                // v1.1：单 hit 多轴 delta（causal+evidential+hedge 全保留，不静默丢轴）
                const up = d.levelAfter > d.levelBefore;
                const axis = d.axis === 'causal' ? '因果力' : '证据力';
                const tier = simTier(d.sim);
                const lowSim = tier.kind === 'candidate';
                const deltaTag = d.deltas && d.deltas.length > 0 ? d.deltas.join('，') : `${d.levelBefore} → ${d.levelAfter}`;
                hits.push({
                    ruleId: 'claim-drift',
                    category: 'claim_calibration',
                    severity: tier.severity,
                    confidence: tier.confidence,
                    findingKind: tier.kind,
                    label: `主张${axis}被${up ? '抬高' : '削弱'}（${d.beforeWord} → ${d.afterWord}）`,
                    paragraphIndex: -1,
                    snippet: `改前：${d.before} … 改后：${d.after}（delta：${deltaTag}；对齐相似度 ${(d.sim * 100).toFixed(0)}%）`,
                    message: `语言润色改变了科学主张（${deltaTag}）。` +
                        (lowSim ? '句对齐相似度较低（<0.55），本条为 CANDIDATE——请人工复核是否确实发生了主张变化。' : 'polishing 不应改变 science——无论往强还是往弱。'),
                    suggestion: `恢复原主张${axis}（"${d.beforeWord}"），除非作者显式授权修改科学结论。`,
                    evidence: { type: 'literature', source: 'Yila-AI/sci-ssci-skills claim-strength ladder（Apache-2.0，adapted，见 THIRD_PARTY.md）' },
                    matchText: `epistemic:claim:${d.axis}:${d.levelBefore}->${d.levelAfter}`,
                    fingerprintKey: `claim:${d.axis}:${d.levelBefore}>${d.levelAfter}:${claimAnchor(d.before)}`,
                });
            }
            for (const d of ed.negationRemoved) {
                const tier = markerEventTier(d.sim, d.positionalFallback);
                hits.push({
                    ruleId: 'negation-drift',
                    category: 'claim_calibration',
                    severity: tier.kind === 'invariant' ? 'high' : 'medium',
                    confidence: tier.confidence,
                    findingKind: tier.kind,
                    label: `否定标记被删除（${d.marker}）——负/零结果可能被翻转`,
                    paragraphIndex: -1,
                    snippet: `改前：${d.before} … 改后：${d.after}（对齐相似度 ${(d.sim * 100).toFixed(0)}%）`,
                    message: `修改后删除了否定标记（no/not/did not…）：阴性结果或零结果表述可能被悄悄翻转。${tier.kind === 'candidate' ? '句对齐相似度较低，请人工复核。' : ''}${fbSuffix(d)}`,
                    suggestion: '恢复否定标记；如科学结论确实改变，需作者显式授权并同步修改数字/统计量。',
                    evidence: { type: 'literature', source: 'Yila-AI/sci-ssci-skills invariant checker（adapted）' },
                    matchText: `epistemic:negation-removed:${d.marker}`,
                    fingerprintKey: `negation:removed:${canonicalMarker(d.marker)}:${claimAnchor(d.before)}`,
                });
            }
            for (const d of ed.negationAdded) {
                const tier = markerEventTier(d.sim, d.positionalFallback);
                hits.push({
                    ruleId: 'negation-drift',
                    category: 'claim_calibration',
                    severity: tier.kind === 'invariant' ? 'medium' : 'low',
                    confidence: tier.confidence,
                    findingKind: tier.kind,
                    label: `否定标记被引入（${d.marker}）`,
                    paragraphIndex: -1,
                    snippet: `改前：${d.before} … 改后：${d.after}（对齐相似度 ${(d.sim * 100).toFixed(0)}%）`,
                    message: `修改后引入了否定标记：原句未否定，现在被否定——核对这是否是作者的意图。${fbSuffix(d)}`,
                    suggestion: '确认否定是作者授权的科学修改；语言润色不应凭空加入否定。',
                    evidence: { type: 'literature', source: 'Yila-AI/sci-ssci-skills invariant checker（adapted）' },
                    matchText: `epistemic:negation-added:${d.marker}`,
                    fingerprintKey: `negation:added:${canonicalMarker(d.marker)}:${claimAnchor(d.before)}`,
                });
            }
            // v1.2：零结果表述被引入（独立事件）
            for (const d of ed.nullResultAdded) {
                const tier = markerEventTier(d.sim, d.positionalFallback);
                hits.push({
                    ruleId: 'negation-drift',
                    category: 'claim_calibration',
                    severity: tier.kind === 'invariant' ? 'medium' : 'low',
                    confidence: tier.confidence,
                    findingKind: tier.kind,
                    label: `零结果表述被引入（${d.marker}）`,
                    paragraphIndex: -1,
                    snippet: `改前：${d.before} … 改后：${d.after}（对齐相似度 ${(d.sim * 100).toFixed(0)}%）`,
                    message: `修改后引入了零结果表述（${d.marker}）：原句未否定结果，现在有了——核对这是否是作者的意图。${fbSuffix(d)}`,
                    suggestion: '确认零结果是作者授权的科学修改；语言润色不应凭空加入阴性结果。',
                    evidence: { type: 'literature', source: 'Evidence-Bound: negative/null findings are data（MIT，见 THIRD_PARTY.md）' },
                    matchText: `epistemic:null-added:${d.marker}`,
                    fingerprintKey: `null:added:${canonicalMarker(d.marker)}:${claimAnchor(d.before)}`,
                });
            }
            // v1.2：alignment-uncertain——含受保护 markers 的未配对主张（不假定 commitments 被保留）
            for (const d of ed.alignmentUncertain) {
                hits.push({
                    ruleId: 'claim-alignment-uncertain',
                    category: 'claim_calibration',
                    severity: 'low',
                    confidence: 'low',
                    findingKind: 'candidate',
                    label: '主张对齐不确定（含受保护 markers 的未配对子句）',
                    paragraphIndex: -1,
                    snippet: `未配对子句：${d.before} …（受保护 markers：${d.markers.join(' / ')}）`,
                    message: '一个包含受保护 markers（否定/零结果/scope/证据状态）的主张子句未能与修改后的版本可靠对齐。没有可靠 claim identity 时，不要假定这些 commitments 被保留或未被保留——请人工核对该主张的去向。',
                    suggestion: '在修改后文本中定位该主张；若被删除或重写，确认是否是有意的科学变化。',
                    evidence: { type: 'heuristic' },
                    matchText: `epistemic:alignment-uncertain:${d.markers.join('|')}`,
                    fingerprintKey: `alignment-uncertain:${claimAnchor(d.before)}`,
                });
            }
            for (const d of ed.nullResultRemoved) {
                const tier = markerEventTier(d.sim, d.positionalFallback);
                hits.push({
                    ruleId: 'negation-drift',
                    category: 'claim_calibration',
                    severity: tier.kind === 'invariant' ? 'high' : 'medium',
                    confidence: tier.confidence,
                    findingKind: tier.kind,
                    label: `零结果表述被删除（${d.marker}）`,
                    paragraphIndex: -1,
                    snippet: `改前：${d.before} … 改后：${d.after}（对齐相似度 ${(d.sim * 100).toFixed(0)}%）`,
                    message: `修改后删除了零结果表述（${d.marker}）：阴性结果本身是数据，不应因削弱叙事而被删除。${tier.kind === 'candidate' ? '句对齐相似度较低，请人工复核。' : ''}${fbSuffix(d)}`,
                    suggestion: '恢复零结果表述；负面、零、矛盾结果必须保留。',
                    evidence: { type: 'literature', source: 'Evidence-Bound: negative/null findings are data（MIT，见 THIRD_PARTY.md）' },
                    matchText: `epistemic:null-result-removed:${d.marker}`,
                    fingerprintKey: `null:removed:${canonicalMarker(d.marker)}:${claimAnchor(d.before)}`,
                });
            }
            for (const d of ed.scopeRemoved) {
                const tier = markerEventTier(d.sim, d.positionalFallback);
                hits.push({
                    ruleId: 'scope-drift',
                    category: 'claim_calibration',
                    severity: tier.kind === 'invariant' ? 'medium' : 'low',
                    confidence: tier.confidence,
                    findingKind: tier.kind,
                    label: `scope 边界消失（${d.marker}）`,
                    paragraphIndex: -1,
                    snippet: `改前：${d.before} … 改后：${d.after}（对齐相似度 ${(d.sim * 100).toFixed(0)}%）`,
                    message: `修改后 scope 边界标记（${d.marker}）消失了。不自动判错——请核验主张是否被泛化。${tier.kind === 'candidate' ? '句对齐相似度较低，请人工复核。' : ''}${fbSuffix(d)}`,
                    suggestion: '若范围未变，恢复边界标记；若确实外推，需要新的证据与作者授权。',
                    evidence: { type: 'literature', source: 'Evidence-Bound: scope conditions KEEP（MIT，见 THIRD_PARTY.md）' },
                    matchText: `epistemic:scope-removed:${d.marker}`,
                    fingerprintKey: `scope:removed:${canonicalMarker(d.marker)}:${claimAnchor(d.before)}`,
                });
            }
            // v1.1：scope 新增（主张可能被缩窄——外部有效性悄悄收窄同样是科学变化）
            for (const d of ed.scopeAdded) {
                const tier = markerEventTier(d.sim, d.positionalFallback);
                hits.push({
                    ruleId: 'scope-drift',
                    category: 'claim_calibration',
                    severity: 'low',
                    confidence: tier.confidence,
                    findingKind: tier.kind,
                    label: `scope 边界被引入（${d.marker}）——主张可能被缩窄`,
                    paragraphIndex: -1,
                    snippet: `改前：${d.before} … 改后：${d.after}（对齐相似度 ${(d.sim * 100).toFixed(0)}%）`,
                    message: `修改后引入了 scope 边界标记（${d.marker}）：原句未限定范围，现在限定了——主张从一般陈述变成受限陈述，外部有效性可能被悄悄收窄。不自动判错，请核验。${fbSuffix(d)}`,
                    suggestion: '若范围确未改变，删除新增边界；若作者有意缩窄声明范围，显式确认。',
                    evidence: { type: 'literature', source: 'Evidence-Bound: scope conditions KEEP（MIT，见 THIRD_PARTY.md）' },
                    matchText: `epistemic:scope-added:${d.marker}`,
                    fingerprintKey: `scope:added:${canonicalMarker(d.marker)}:${claimAnchor(d.before)}`,
                });
            }
            // v1.0 Evidence-Status Lock：证据来源状态（reported/observed/measured…）守恒。
            // "participants reported improvement" ≠ "participants improved"——报告≠事实；
            // observed → estimated 是状态替换，同样改变读者对证据来源的理解。
            for (const d of ed.evidenceStatusRemoved) {
                const tier = markerEventTier(d.sim, d.positionalFallback);
                hits.push({
                    ruleId: 'evidence-status-drift',
                    category: 'claim_calibration',
                    severity: tier.kind === 'invariant' ? 'medium' : 'low',
                    confidence: tier.confidence,
                    findingKind: tier.kind,
                    label: `证据状态消失（${d.marker}）——从"${d.marker}"变成直接声称`,
                    paragraphIndex: -1,
                    snippet: `改前：${d.before} … 改后：${d.after}（对齐相似度 ${(d.sim * 100).toFixed(0)}%）`,
                    message: `修改后证据来源状态标记（${d.marker}）消失或被替换：例如 "participants reported improvement" 不能变成 "participants improved"——报告/观测/测量≠直接事实。不自动判错，请核验来源状态是否仍准确。${tier.kind === 'candidate' ? '句对齐相似度较低，请人工复核。' : ''}${fbSuffix(d)}`,
                    suggestion: '若来源状态未变，恢复状态词（reported/observed/measured…）；状态确实改变时显式说明（如 modelled → observed 需要对应实验证据）。',
                    evidence: { type: 'literature', source: 'Evidence-Bound: source-status distinction KEEP（MIT，见 THIRD_PARTY.md）' },
                    matchText: `epistemic:evidence-status-removed:${d.marker}`,
                    fingerprintKey: `evidence-status:removed:${canonicalMarker(d.marker)}:${claimAnchor(d.before)}`,
                });
            }
            for (const d of ed.evidenceStatusAdded) {
                const tier = markerEventTier(d.sim, d.positionalFallback);
                hits.push({
                    ruleId: 'evidence-status-drift',
                    category: 'claim_calibration',
                    severity: tier.kind === 'invariant' ? 'medium' : 'low',
                    confidence: tier.confidence,
                    findingKind: tier.kind,
                    label: `证据状态被引入（${d.marker}）`,
                    paragraphIndex: -1,
                    snippet: `改前：${d.before} … 改后：${d.after}（对齐相似度 ${(d.sim * 100).toFixed(0)}%）`,
                    message: `修改后引入了证据状态标记（${d.marker}）：原句没有来源状态限定，现在有了——核对这是否是作者的意图。${fbSuffix(d)}`,
                    suggestion: '确认来源状态是作者授权的科学修改；语言润色不应凭空改变证据来源。',
                    evidence: { type: 'literature', source: 'Evidence-Bound: source-status distinction KEEP（MIT，见 THIRD_PARTY.md）' },
                    matchText: `epistemic:evidence-status-added:${d.marker}`,
                    fingerprintKey: `evidence-status:added:${canonicalMarker(d.marker)}:${claimAnchor(d.before)}`,
                });
            }
            const numTypes = new Set(['number', 'percent', 'pvalue', 'ci']);
            const citTypes = new Set(['cite', 'ref', 'figure', 'table', 'doi']);
            integrity = {
                numericChanged: diff.changed.filter((c) => numTypes.has(c.type)).length +
                    diff.removed.filter((r) => numTypes.has(r.type)).length +
                    diff.added.filter((a) => numTypes.has(a.type)).length,
                citationChanged: diff.changed.filter((c) => citTypes.has(c.type)).length +
                    diff.removed.filter((r) => citTypes.has(r.type)).length +
                    diff.added.filter((a) => citTypes.has(a.type)).length,
                claimDrift: ed.claimDrift.length,
                negationDrift: ed.negationRemoved.length + ed.negationAdded.length + ed.nullResultRemoved.length + ed.nullResultAdded.length,
                scopeDrift: ed.scopeRemoved.length + ed.scopeAdded.length,
                evidenceStatusDrift: ed.evidenceStatusRemoved.length + ed.evidenceStatusAdded.length,
            };
        }
    }
    // v0.6 Author Style Profile：句长分布漂移检测（偏离作者历史写作分布）
    if (opts?.styleProfile) {
        const lens = splitSentences(scanText).map((s) => countWords(s));
        if (lens.length >= 5) {
            const med = medianOf(lens);
            const sp = opts.styleProfile;
            const threshold = Math.max(sp.sentenceLengthMedian * 0.5, sp.sentenceLengthStd * 2, 8);
            const dev = Math.abs(med - sp.sentenceLengthMedian);
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
                });
            }
        }
    }
    // v1.4：Journal Fit（目标期刊写作契合度）——与 integrity/style 独立输出，不混入 hits
    const journalFit = opts?.journalProfile ? auditJournalFit(text, opts.journalProfile) : undefined;
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
    // v0.8：统一补齐 findingKind——规则显式声明优先，否则按 severity/category 推导
    // （invariant 类已在命中创建时显式标注；规则级 findingKind 如 cn-self-defeating→violation 在这里传播）
    for (const h of hits) {
        if (!h.findingKind) {
            const rule = RULES.find((r) => r.id === h.ruleId);
            h.findingKind = rule?.findingKind
                ?? (h.severity === 'high'
                    ? (h.category === 'claim_calibration' ? 'candidate' : 'violation')
                    : (h.category === 'claim_calibration' ? 'candidate' : 'advisory'));
        }
    }
    return {
        ok: hits.length === 0,
        profile,
        summary: { total: hits.length, high, medium, low, byCategory },
        stats,
        hits,
        integrity,
        journalFit,
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
    // v0.8：科学完整性回归块（提供 original 时显示；0 命中也显示——"全部保持"本身是结果）
    if (report.integrity) {
        const i = report.integrity;
        lines.push('');
        lines.push('科学完整性回归（Scholarship + Epistemic Lock）：');
        lines.push(`  ${i.numericChanged === 0 ? '✓' : '✗'} 数字/统计量 ${i.numericChanged === 0 ? '不变' : `变化 ${i.numericChanged} 处`}`);
        lines.push(`  ${i.citationChanged === 0 ? '✓' : '✗'} 引用/图表编号 ${i.citationChanged === 0 ? '不变' : `变化 ${i.citationChanged} 处`}`);
        lines.push(`  ${i.claimDrift === 0 ? '✓' : '✗'} 主张强度 ${i.claimDrift === 0 ? '不变' : `漂移 ${i.claimDrift} 处`}`);
        lines.push(`  ${i.negationDrift === 0 ? '✓' : '✗'} 否定/零结果 ${i.negationDrift === 0 ? '不变' : `变化 ${i.negationDrift} 处`}`);
        lines.push(`  ${i.scopeDrift === 0 ? '✓' : '⚠'} scope 边界 ${i.scopeDrift === 0 ? '保持' : `消失 ${i.scopeDrift} 处`}`);
        lines.push(`  ${i.evidenceStatusDrift === 0 ? '✓' : '⚠'} 证据状态 ${i.evidenceStatusDrift === 0 ? '保持' : `变化 ${i.evidenceStatusDrift} 处`}`);
        lines.push('');
    }
    // v1.4：Journal Fit 块（提供 journalProfile 时显示；0 hits 也显示）
    if (report.journalFit) {
        const jf = report.journalFit;
        lines.push('');
        lines.push(`期刊写作契合度（Journal Fit · ${jf.journal}）：${jf.sections.length === 0 ? '未匹配到章节' : `总分 ${jf.overall}%`}（Profile Confidence: ${jf.confidence.toUpperCase()}，corpus ${jf.corpusSize} 篇）`);
        for (const s of jf.sections) {
            const coverage = s.articleCount !== undefined ? `（n=${s.articleCount}）` : '';
            lines.push(`  ${s.name} ${s.score}%${coverage}`);
            if (opts?.verbose) {
                for (const m of s.metrics) {
                    const flag = m.status === 'ok' ? '✓' : m.status === 'warn' ? '⚠' : '✗';
                    const range = m.p10 !== undefined && m.p90 !== undefined ? `（P10-P90: ${m.p10}-${m.p90}）` : '';
                    lines.push(`    ${flag} ${m.metric}：当前 ${m.current} vs 目标中位 ${m.expected}${range}（score ${m.score}）`);
                }
            }
        }
        for (const w of jf.warnings)
            lines.push(`  ⚠ ${w}`);
        lines.push('');
    }
    if (hits.length === 0)
        return lines.join('\n');
    const cats = Object.entries(summary.byCategory)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${CATEGORY_LABELS[k]} ${n}`)
        .join(' / ');
    lines.push(`- 分类：${cats}`);
    // v0.8：性质分布（invariant/violation 需处理；candidate 需人工判定；advisory 可保留）
    const kindCounts = { invariant: 0, violation: 0, candidate: 0, advisory: 0 };
    for (const h of hits)
        kindCounts[h.findingKind ?? 'advisory'] += 1;
    lines.push(`- 性质：不变量 ${kindCounts.invariant} / 违规 ${kindCounts.violation} / 候选 ${kindCounts.candidate} / 建议 ${kindCounts.advisory}`);
    lines.push('');
    const order = { high: 0, medium: 1, low: 2 };
    const confRank = { high: 0, medium: 1, low: 2 };
    const sorted = [...hits].sort((a, b) => order[a.severity] - order[b.severity] || confRank[a.confidence] - confRank[b.confidence] || a.paragraphIndex - b.paragraphIndex);
    for (const h of sorted) {
        const sev = h.severity === 'high' ? '🔴' : h.severity === 'medium' ? '🟠' : '🟡';
        const loc = h.paragraphIndex >= 0 ? `[para ${h.paragraphIndex}]` : '[全文]';
        // v0.8：命中行带性质标签（INVARIANT/VIOLATION/CANDIDATE/ADVISORY）
        lines.push(`${sev} [${h.severity.toUpperCase()} · conf ${h.confidence} · ${(h.findingKind ?? 'advisory').toUpperCase()}] ${h.label} ${loc}`);
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
        `# 论文写作纪律速查（dsh-plugin-writing-guard v${PLUGIN_VERSION}）`,
        '',
        '## 一、修改过程残留（process residue，仅正文/投稿信）',
        '- 正文不得出现 "revised/revision"、"as requested"、"we have updated"、"previous version" 等修改过程语言',
        '- 中文不得出现：本轮/本次修改/投稿前/待补齐/审稿人要求/我们修改了 等',
        '- 版本号、文件名、SHA、内部流程名词不得进入正文；项目内部词可配置 projectResidueTerms',
        '- 例外：rebuttal（回复信）中 "the revised manuscript / as requested" 属正常表述',
        '',
        '## 二、主张校准（claim calibration）',
        '- "we do not claim"、"本文并非要证明"、"这并不意味着" 等反复自我设限句式：属 CANDIDATE——可能承担正当的 epistemic boundary（"We do not claim that this association is causal" 是负责任的边界声明），人工判定后再改，不要自动删除',
        '- 自黑免责（完全基于假数据/模型毫无意义/结果完全不可靠/不足为凭）属 VIOLATION，必须改写',
        '- 自我削弱词（遗憾的是/仍明显落后/效果有限）改写为精确的、受证据约束的描述；负面/零/矛盾结果是数据，不得删除',
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
        // v0.9（0.8.1 P0 修复）：不再机械建议 "the results show"——那会把作者解释升级成证据主张
        '- "we believe/think" 不应机械改成 "the results show"：若原句表达作者解释，用 "One possible explanation is…" / "This finding may reflect…" / "We interpret this as…"；仅当证据直接支持该结论时才用 "the results show / the data indicate"；模糊词（somewhat/quite/fairly）少堆叠',
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
        '## 六·v0.8/v0.9 科学完整性锁（Epistemic Lock：主张/否定/scope 守恒）',
        '- 定位：语言润色不得改变 science——无论往强还是往弱。数字/引用没变 ≠ 没改坏（"associated → caused" 数字没动但结论已变）',
        '- 双轴模型（v0.9）：因果力（consistent with(0) < associated(1) < predicts(2) < contributes(3) < affects(4) < causes(5)）与证据力（hedge(-1) < suggest(1) < indicate(2) < support(3) < show(4) < demonstrate(5) < establish/confirm(6) < prove(7)）独立检测——"confirmed an association" 是因果力=关联 + 证据力=强，不是因果 L5',
        '- 子句级多主张（v0.9）：按 ; , while whereas although but and 切分逐子句对齐——"X caused A, while Y may be associated with B" → "Y caused B" 不再被整句最高层掩盖',
        '- 对齐相似度分档（v0.9）：≥0.70 → high/invariant；0.55–0.70 → medium/invariant；0.45–0.55 → low/candidate（人工复核）',
        '- 主张强度阶梯（Yila claim-strength ladder，adapted）：修改不得静默沿阶梯移动；"may be associated" → "is associated"（hedge 移除）也是证据力变化',
        '- 否定守恒："No significant association" → "A significant association" 会翻转负/零结果；no/not/did not/without/non-significant 标记删除按 HIGH 报',
        '- 零结果守恒：no significant difference / did not improve / remained unchanged 是数据，不得因削弱叙事而删除',
        '- scope 边界：in this study / under these conditions / 在本研究中… 消失时提示"可能被泛化"——不自动判错，只要求核验',
        '- 证据状态守恒（v1.0）：reported/observed/measured/implemented/estimated/simulated 等来源状态词消失或被替换时核验——"participants reported improvement" 不能变成 "participants improved"（报告≠事实）；observed → estimated 是状态替换，同样改变读者对证据来源的理解',
        '- 自动守护：DSH 环境中插件自动捕获 write/edit 前的文本（exec.token 键控，并发编辑不串扰），写入后自动跑 Scholarship + Epistemic Lock（自动路径与手动 writing_audit(original=) 同规则）',
        '- 命中性质（findingKind）：INVARIANT（不变量，改即事故）/ VIOLATION（明确违规）/ CANDIDATE（防御性候选或低相似度漂移——cue ≠ verdict，可能承担正当边界，勿自动删除）/ ADVISORY（文体建议）',
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
        '## 七·v1.3 篇章统计层（局部规则 → 篇章统计 → 科学完整性）',
        '- 段落节奏（paragraph-rhythm）：碎片化（一句成段 ≥35% 且 ≥3 段）/ 拥塞（段长 > 中位数 2.5 倍 ≥2 段）/ 过度整齐（连续 ≥3 段长度在中位数 ±15% 内 ≥2 处）——按"一个完整论证单元"切段，不按字数',
        '- 句长节奏（sentence-rhythm-uniformity）：连续 ≥3 句长度在局部中位数 ±15% 内且全文 ≥2 处 → 节奏过匀；有作者 styleProfile 时对比历史 std（当前 < 历史 60% → 更整齐）——句长随信息密度自然变化，不为整齐而整齐',
        '- 重复逻辑脚手架（repeated-discourse-scaffold）：多个独立段落重复"首先→其次→最后 / 第一→第二→第三 / First→Second→Third / 从X层面→从Y层面"同一种枚举骨架 → 模板化；单次列举正常',
        '- 标点脚手架（punctuation-scaffold-overload）：同一句内 ≥3 类结构标点（括号/冒号/分号/引号/破折号）聚集——用标点承担句法组织时改写',
        '- 自创框架词（coined-framework-language）：A-B-C 短线框架（"输入—处理—输出"）、连续多个 XX化/XX力/XX性、XX闭环/赋能机制——candidate，需有定义与来源',
        '- 空泛判断（generic-claim-candidate）：抽象名词 ≥2 + 无实体/数值/引用 + 无方法动作 + 万能句型，多弱信号同时满足才报（candidate + low）',
        '- 总结套话位置感知（summary-cliche-positional）：不新增词表——"综上所述/in conclusion" 在每个小节末尾反复出现才报（位置驱动，≥2 个小节末尾）',
        '- 本地引用完整性（local-citation-integrity）：同目录 .bib 存在时检查 \\cite key 是否真实存在、\\ref ↔ \\label 是否对应、bib 条目是否缺 title/year/author、同一 DOI 是否对应多个 key——零网络确定性检查；"该文献是否支持这句话"留在插件边界外',
        '- adaptive threshold 原则：有作者 profile → 用历史分布做自适应阈值；无 profile → conservative heuristic，不做固定次数一刀切',
        '',
        '## 七·v1.4 期刊写作引擎（Journal Engine）',
        '- 目标不是"模仿 Nature 风格"，而是从目标期刊 author guidelines + 代表论文中提取可复用的统计规律（Journal Writing Profile）',
        '- Profile 只保存抽象分布（句长/段长/hedge 密度/因果力/第一人称/被动语态/引用密度），不保存论文原句',
        '- 用 writing_journal_profile 从代表论文语料生成 profile；用 writing_audit(journalProfile=JSON) 对当前稿件做 section-level Journal Fit',
        '- Journal Fit 输出每个章节的契合度（如 Results 61%），并列出主要差异（句长/解释密度/因果语言/段落节奏）',
        '- 优先级：Scientific Invariant > Epistemic Safety > Journal Requirement > Journal Norm > Journal Style——期刊风格永远不能覆盖科学完整性',
        '',
        '## 八、发布会原则（扬长避短）',
        '- 只围绕优势组织论文；不写工作汇报、不主动示弱、不替审稿人攻击自己',
        '- 打不过的维度不设为比赛项目；不占优的结果从目标/约束/场景解释',
        '- 优势必须明确说出来；结论只强化记忆点',
        '',
        '## 九、提交前自查',
        '- 用 writing_audit 工具对全文扫描（可指定 profile: manuscript/rebuttal/cover_letter）；高危项必须清零，中危项 ≤3 处，低危项可保留但应说明理由',
        '- 润色/改写后：用 writing_audit(original=改前原文) 确认 Scholarship Lock 无 HIGH（科研事实未被改动）',
    ].join('\n');
}
