import { defineTool } from '@deepseek-ai/dsh-tools';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { auditText, formatReport, rulesBrief, filterReport, detectDocumentProfile, hitFingerprint, diffAudit, serializeFingerprints, deserializeFingerprints, computeStyleProfile, computeJournalProfileFromDocuments, PLUGIN_VERSION, } from './rules.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
export const name = 'dsh-plugin-writing-guard';
export const inject = ['tools'];
/** 预设模式 → 自动审计最低严重度（lint 工具宁可少报也要可信：默认 conservative） */
const MODE_MIN_SEVERITY = {
    conservative: 'high',
    balanced: 'medium',
    strict: 'low',
};
/**
 * 默认配置（内部常量，不导出）。
 * 注意：不能 `export const Config = {...}` —— cordis 会把导出的 Config 当
 * standard-schema 校验（调用 `Config["~standard"].validate`），普通对象没有
 * `~standard` 属性会抛 "Cannot read properties of undefined (reading 'validate')"
 * 导致整个插件树加载失败。必须作为内部常量 + apply 默认参数使用。
 */
const DEFAULT_CONFIG = {
    autoBrief: false,
    verboseByDefault: false,
    autoAuditOnWrite: true,
    autoAuditMinSeverity: 'high',
    maxAutoInjectPerTurn: 2,
    projectResidueTerms: [],
};
/** 默认项目内部词表（通用痕迹，不含 priority/SHA-256 等普通学术词） */
const DEFAULT_PROJECT_TERMS = ['source_map', 'reader 锚点', 'iteration_log', 'final_audit', 'blueprint', 'full_corpus'];
// ---------- v0.5 incremental lint 状态持久化 ----------
/** 指纹算法版本：指纹规则变化时递增，旧 state 清空重建（防止升级后制造假 resolved+added） */
const FINGERPRINT_VERSION = 7;
/** 基线缓存上限：≤20 个文件、单文件 ≤512KB、总量 ≤4MB（按 UTF-8 字节计，超限按 ts 淘汰最旧） */
const BASELINE_MAX_FILES = 20;
const BASELINE_MAX_BYTES_PER_FILE = 512 * 1024;
const BASELINE_MAX_TOTAL_BYTES = 4 * 1024 * 1024;
/** v0.9：UTF-8 字节数（中文一个汉字 3 字节，不能用 content.length 当字节数） */
export function baselineByteSize(content) {
    return Buffer.byteLength(content, 'utf8');
}
function emptyState() {
    return { fingerprints: new Map(), baselines: new Map() };
}
async function loadState(stateFile) {
    try {
        const raw = await fs.readFile(stateFile, 'utf8');
        const data = JSON.parse(raw);
        const fingerprints = new Map();
        // fingerprint 版本不兼容 → 清空基线（不制造假 resolved/added）
        if (data.fingerprintVersion === FINGERPRINT_VERSION) {
            for (const [file, fps] of Object.entries(data.files ?? {})) {
                fingerprints.set(file, deserializeFingerprints(fps));
            }
        }
        const baselines = new Map();
        for (const [file, b] of Object.entries(data.baselines ?? {})) {
            if (b && typeof b.content === 'string' && baselineByteSize(b.content) <= BASELINE_MAX_BYTES_PER_FILE) {
                baselines.set(file, { content: b.content, ts: typeof b.ts === 'number' ? b.ts : 0 });
            }
        }
        return { fingerprints, baselines };
    }
    catch {
        return emptyState();
    }
}
/** 基线缓存淘汰：超文件数或总字节上限时删除 ts 最旧的条目（UTF-8 字节计） */
export function pruneBaselines(baselines) {
    let total = 0;
    for (const b of baselines.values())
        total += baselineByteSize(b.content);
    while (baselines.size > BASELINE_MAX_FILES || total > BASELINE_MAX_TOTAL_BYTES) {
        let oldest = null;
        let oldestTs = Infinity;
        for (const [f, b] of baselines) {
            if (b.ts < oldestTs) {
                oldestTs = b.ts;
                oldest = f;
            }
        }
        if (!oldest)
            break;
        total -= baselineByteSize(baselines.get(oldest).content);
        baselines.delete(oldest);
    }
}
/**
 * v0.5.1：save 串行排队 + atomic write（tmp → rename），避免并发覆盖与中途写坏。
 * v0.5.2：失败通过 onError 上报（之前 .catch(() => {}) 静默吞错——
 * 状态丢失后每次写入都会把全部问题重新注入，且无法排查）。
 */
let saveQueue = Promise.resolve();
function queueSave(stateFile, fingerprints, baselines, onError) {
    saveQueue = saveQueue.then(async () => {
        const files = {};
        for (const [file, fps] of fingerprints) {
            files[file] = serializeFingerprints(fps);
        }
        const baselineRecord = {};
        for (const [file, b] of baselines) {
            baselineRecord[file] = b;
        }
        const data = {
            schemaVersion: 2,
            pluginVersion: PLUGIN_VERSION,
            fingerprintVersion: FINGERPRINT_VERSION,
            files,
            baselines: baselineRecord,
        };
        const dir = path.dirname(stateFile);
        await fs.mkdir(dir, { recursive: true });
        const tmp = stateFile + '.tmp';
        await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
        await fs.rename(tmp, stateFile);
    }).catch((e) => {
        onError?.(e);
    });
}
/** 从文件读取文本（.txt/.md/.markdown 直接读；.docx 请先经 anydoc 转 Markdown） */
async function readTextFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.docx' || ext === '.doc' || ext === '.pdf') {
        throw new Error(`"${filePath}" 是二进制文档，请先调用 anydoc 工具转换为 Markdown，再对转换结果执行 writing_audit`);
    }
    return fs.readFile(filePath, 'utf8');
}
// ---------- 论文文件识别 ----------
const MANUSCRIPT_EXT = new Set(['.md', '.markdown', '.tex', '.txt']);
/**
 * 论文特征路径段（相对路径任意层级命中即视为论文文件）。
 * v0.5.2：英文词用前后字符边界，避免 newspaper/synthesis/coverage/paperwork 等
 * 含子串的普通文件被误判为论文而触发自动审计；中文词沿用子串匹配。
 */
const PAPER_PATH_HINTS_EN = /(?<![a-z0-9])(manuscript|paper|thesis|revision|revised|response|rebuttal|cover|review|reviewer)(?![a-z])/i;
const PAPER_PATH_HINTS_CN = ['论文', '稿件', '修订', '返修', '回复', '审稿'];
/** 知识库布局中的论文目录（工作区根下；支持多级路径前缀匹配） */
const PAPER_ROOT_DIRS = [
    '01_manuscript', '02_reviews', '03_evidence', '08_response', '09_wiki/writing',
];
/** 论文特征路径判断（相对路径任意层级命中即视为论文路径）——isPaperFile 与 autoBrief 共用 */
export function isPaperPath(filePath) {
    const norm = filePath.replace(/\\/g, '/').toLowerCase();
    if (PAPER_PATH_HINTS_CN.some((h) => norm.includes(h)))
        return true;
    return PAPER_PATH_HINTS_EN.test(norm);
}
function isPaperFile(filePath, cwd) {
    const ext = path.extname(filePath).toLowerCase();
    if (!MANUSCRIPT_EXT.has(ext))
        return false;
    if (isPaperPath(filePath))
        return true;
    if (cwd) {
        const rel = path.relative(cwd, filePath).replace(/\\/g, '/').toLowerCase();
        if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
            // 前缀匹配（支持 09_wiki/writing 这类多级目录）
            if (PAPER_ROOT_DIRS.some((d) => rel === d || rel.startsWith(d + '/')))
                return true;
        }
    }
    return false;
}
/** 提取 write/edit 的目标文件路径 */
function targetPathOf(exec) {
    const name = exec.name;
    if (name !== 'write' && name !== 'edit')
        return null;
    const args = exec.arguments;
    const p = args?.file_path ?? args?.filePath;
    return typeof p === 'string' && p ? p : null;
}
/** 导出供 tests/run-tests.mjs 回归（自动审计的文件识别规则） */
export { isPaperFile };
export function apply(ctx, config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const projectTerms = [...new Set([...DEFAULT_PROJECT_TERMS, ...(cfg.projectResidueTerms ?? [])])];
    // v0.5：mode 预设（显式 autoAuditMinSeverity 优先）
    const minSeverity = cfg.mode && !config.autoAuditMinSeverity
        ? MODE_MIN_SEVERITY[cfg.mode]
        : cfg.autoAuditMinSeverity;
    // v0.5：增量状态持久化（缺省 ~/.dsh/plugins/dsh-plugin-writing-guard/state.json）
    // v0.5.1：stateFile 空串/空白 → 用默认路径（'' ?? default 仍是 ''，会让持久化静默失效）
    const stateFile = cfg.stateFile?.trim()
        ? path.resolve(cfg.stateFile)
        : path.join(os.homedir(), '.dsh', 'plugins', 'dsh-plugin-writing-guard', 'state.json');
    const stateLoaded = loadState(stateFile).catch(() => emptyState());
    // v0.9：preimage 按 exec.token 键控（同一文件并发 edit 不串扰；分析建议），
    // 内部保留 path 校验；token 缺失时回退到文件路径键。优先级高于持久化基线缓存。
    const preimages = new Map();
    ctx.tools.register(defineTool({
        name: 'writing_audit',
        description: '对论文/稿件文本执行写作纪律扫描（本地规则，零网络）：检测修改过程残留（revised/本轮/投稿前…）、' +
            '主张校准（we do not claim/防御密度/限定词堆叠/强主张缺证据/自黑免责套话…）、修辞模式（不是X而是Y/重复绕圈/三连排比/绝对化/多重"的"字链）、' +
            'LLM 关联词（delve/tapestry/过渡词堆叠/中文套话/空洞热词密度）、学术文体（超长句堆叠/抽象副词/句长偏离作者风格/平均句长）、' +
            '格式（破折号密度/冒号标题/Unicode 数学符号）。' +
            '可指定 profile（manuscript/rebuttal/cover_letter/review/notes）区分文档类型——rebuttal 中 "as requested" 不报警。' +
            '频率类规则按密度计算（英文按词、中文按字，每千语言单位）。' +
            'v0.6：传 original=修改前文本 开启 Scholarship Lock（对比数字/citation/图表编号是否被润色改动）；' +
            '传 styleProfile=作者历史风格档案 JSON 开启句长分布漂移检测。' +
            'v0.7：新增中文"的"字修饰链、平均句长（英 ≤18 词/中 ≤25 字）、自黑式免责套话（"基于假数据/模型毫无意义"）与空洞热词密度规则（借鉴 ko5.6sol 文体指南，密度门控避免误伤领域术语）。' +
            'v0.8：传 original 同时开启 Epistemic Lock——主张强度漂移（associated→caused，Yila claim ladder）、否定/零结果标记翻转、scope 边界消失；' +
            'v1.0：证据状态守恒（reported/observed/measured/estimated/simulated 消失或被替换时核验——"participants reported improvement" 不能变成 "participants improved"）；' +
            '命中带性质标签（INVARIANT/VIOLATION/CANDIDATE/ADVISORY）：INVARIANT=科学不变量被改动，CANDIDATE=防御性候选（可能承担正当边界，勿自动删除）。' +
            '版本差距过大（全文重写）时自动降级为 version-gap 提示，避免行级对比噪音。' +
            'v1.3 篇章统计层：段落节奏（碎片化/拥塞/过度整齐）、句长节奏均匀（局部 run + 作者历史 std 对比）、重复逻辑脚手架（首先其次最后/第一第二第三跨段落复用）、标点脚手架过载（括号/冒号/分号/引号/破折号同句聚集）、自创框架词（XX化/XX力/A-B-C 短线）、空泛判断（多弱信号组合）与本地引用完整性（filePath 同目录存在 .bib 时自动检查 \\cite key ↔ .bib、\\ref ↔ \\label、条目缺字段、DOI 重复）。' +
            'v1.6.2 期刊写作引擎（corpus-aware + epistemic fingerprint + rhetorical moves + semantic hardening）：传 journalProfile=Journal Profile JSON（由 writing_journal_profile 生成）开启 section-level Journal Fit 审计（句法/引用/epistemic/rhetorical move 指标 vs 目标期刊分布，含 Profile Confidence）。' +
            '输入 text 或 filePath（.txt/.md；.docx 请先经 anydoc 转 Markdown）。' +
            `（dsh-plugin-writing-guard v${PLUGIN_VERSION}）`,
        parameters: {
            text: { type: 'string', description: '要检查的文本内容（与 filePath 二选一）' },
            filePath: { type: 'string', description: '要检查的文本文件路径（.txt/.md；二选一）' },
            profile: { type: 'string', enum: ['manuscript', 'rebuttal', 'cover_letter', 'review', 'notes', 'unknown'], description: '文档类型（可选；缺省按路径自动检测，纯文本默认 unknown）' },
            verbose: { type: 'boolean', description: 'true 时输出每条问题的提示与修改建议（默认 false，只输出原文摘要）' },
            projectResidueTerms: { type: 'array', items: { type: 'string' }, description: '临时追加的项目内部词表（仅本次调用生效；命中按 medium 报；持久配置见插件 config.projectResidueTerms）' },
            original: { type: 'string', description: 'v0.6/v0.8 修改前的原文。提供后开启 Scholarship Lock（数字/百分数/p 值/CI/引用/图表编号/DOI 对比，变化按 HIGH 报）+ Epistemic Lock（主张强度漂移/否定与零结果翻转/scope 边界消失）——语言润色不应改变科研事实' },
            styleProfile: { type: 'string', description: 'v0.6/v1.3 Author Style Profile：作者历史风格档案 JSON（由 writing_style_profile 生成，含句长/段长节奏指纹）。提供后检测句长分布偏离（median 漂移 + std/CV 整齐度对比，v1.3）' },
            journalProfile: { type: 'string', description: 'v1.6.2 Journal Profile：目标期刊写作档案 JSON（由 writing_journal_profile 生成，含章节句法/引用/epistemic fingerprint/rhetorical moves 分布）。提供后输出 section-level Journal Fit 报告与 Profile Confidence' },
        },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }],
        },
        isConcurrencySafe: () => true,
        async execute(args) {
            let text = args.text;
            let profile;
            if (args.profile && args.profile !== 'unknown') {
                profile = args.profile;
            }
            else if (args.filePath) {
                profile = detectDocumentProfile(args.filePath);
            }
            // v1.3：filePath 同目录探测 .bib（local-citation-integrity 数据源；零网络）
            let bibText;
            if (typeof args.filePath === 'string' && args.filePath) {
                try {
                    const dir = path.dirname(args.filePath);
                    const bibs = (await fs.readdir(dir)).filter((f) => f.toLowerCase().endsWith('.bib'));
                    if (bibs.length > 0) {
                        bibText = await fs.readFile(path.join(dir, bibs[0]), 'utf8');
                    }
                }
                catch {
                    // 目录不可读/无 .bib：跳过引用完整性检查
                }
            }
            if (!text && args.filePath) {
                text = await readTextFile(args.filePath);
            }
            if (!text || !text.trim()) {
                throw new Error('需要提供 text 或 filePath（内容不能为空）');
            }
            const extraTerms = Array.isArray(args.projectResidueTerms)
                ? args.projectResidueTerms.filter((x) => typeof x === 'string')
                : [];
            let styleProfile;
            if (typeof args.styleProfile === 'string' && args.styleProfile.trim()) {
                try {
                    styleProfile = JSON.parse(args.styleProfile);
                }
                catch {
                    throw new Error('styleProfile 不是合法的 JSON（请使用 writing_style_profile 生成）');
                }
            }
            let journalProfile;
            if (typeof args.journalProfile === 'string' && args.journalProfile.trim()) {
                try {
                    journalProfile = JSON.parse(args.journalProfile);
                }
                catch {
                    throw new Error('journalProfile 不是合法的 JSON（请使用 writing_journal_profile 生成）');
                }
            }
            const report = auditText(text, {
                profile,
                projectResidueTerms: [...projectTerms, ...extraTerms],
                original: typeof args.original === 'string' && args.original.trim() ? args.original : undefined,
                styleProfile,
                bibText,
                journalProfile,
            });
            const verbose = args.verbose ?? cfg.verboseByDefault;
            return formatReport(report, { verbose });
        },
    }));
    ctx.tools.register(defineTool({
        name: 'writing_style_profile',
        description: 'v0.6/v1.3 Author Style Profile：从作者历史论文（.md/.tex/.txt）统计写作风格指标——句长中位数/标准差/变异系数、短句比例/长句比例、段长中位数/标准差/变异系数、破折号/hedge/连接词密度，' +
            '输出"节奏指纹"风格档案 JSON——零网络零 LLM，纯本地统计。' +
            '用法：对作者以前发表的论文目录/文件调用本工具得到 profile JSON，' +
            '再在 writing_audit 的 styleProfile 参数传入该 JSON，即可检测新稿件句长分布是否偏离作者历史风格（median 漂移 + std/CV 整齐度对比，v1.3 adaptive threshold）。' +
            `（dsh-plugin-writing-guard v${PLUGIN_VERSION}）`,
        parameters: {
            filePath: { type: 'string', description: '作者历史论文的文件路径（.md/.tex/.txt；与 learnDir 二选一）' },
            learnDir: { type: 'string', description: '作者历史论文所在目录（递归扫描 .md/.tex/.txt 合并统计；与 filePath 二选一）' },
        },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }],
        },
        isConcurrencySafe: () => true,
        async execute(args) {
            const { filePath, learnDir } = args;
            if (!filePath && !learnDir)
                throw new Error('需要提供 filePath 或 learnDir');
            const files = [];
            if (typeof filePath === 'string' && filePath) {
                files.push(filePath);
            }
            if (typeof learnDir === 'string' && learnDir) {
                // 递归收集 .md/.tex/.txt（兼容 Dirent 无 path 字段的 Node 版本，手写递归）
                const walk = async (dir) => {
                    const entries = await fs.readdir(dir, { withFileTypes: true });
                    for (const e of entries) {
                        const full = path.join(dir, e.name);
                        if (e.isDirectory()) {
                            await walk(full);
                        }
                        else {
                            const ext = path.extname(e.name).toLowerCase();
                            if (ext === '.md' || ext === '.markdown' || ext === '.tex' || ext === '.txt') {
                                files.push(full);
                            }
                        }
                    }
                };
                await walk(learnDir);
            }
            if (files.length === 0)
                throw new Error('未找到可统计的 .md/.tex/.txt 文件');
            const chunks = [];
            for (const f of files) {
                try {
                    chunks.push(await fs.readFile(f, 'utf8'));
                }
                catch {
                    // 跳过不可读文件
                }
            }
            if (chunks.length === 0)
                throw new Error('所有目标文件均不可读');
            const profile = computeStyleProfile(chunks.join('\n\n'));
            return [
                '作者写作风格档案（零网络零 LLM，纯本地统计）：',
                JSON.stringify(profile, null, 2),
                '',
                `统计来源：${files.length} 个文件（${chunks.length} 个成功读取）`,
                '用法：把上面的 JSON 传给 writing_audit 的 styleProfile 参数，检测新稿件的句长漂移。',
            ].join('\n');
        },
    }));
    ctx.tools.register(defineTool({
        name: 'writing_journal_profile',
        description: 'v1.6.2 Journal Profile：从多篇目标期刊代表论文（.md/.tex/.txt）逐篇独立蒸馏"期刊写作档案"——每个章节跨论文聚合的句法/引用/epistemic fingerprint/rhetorical moves 分布。' +
            '输出的是抽象统计分布（不保存论文原句），零网络零 LLM，纯本地统计。' +
            '用法：对目标期刊的代表论文目录/文件调用本工具得到 profile JSON，' +
            '再在 writing_audit 的 journalProfile 参数传入该 JSON，即可对当前稿件输出 section-level Journal Fit（契合度百分比 + 主要差异）。' +
            `（dsh-plugin-writing-guard v${PLUGIN_VERSION}）`,
        parameters: {
            filePath: { type: 'string', description: '目标期刊代表论文的文件路径（.md/.tex/.txt；与 learnDir 二选一）' },
            learnDir: { type: 'string', description: '目标期刊代表论文所在目录（递归扫描 .md/.tex/.txt 合并统计；与 filePath 二选一）' },
            journal: { type: 'string', description: '期刊名称（写入 profile.metadata.journal，默认 custom-journal）' },
            articleType: { type: 'string', description: '文章类型（如 research-article/review，写入 metadata.articleType）' },
            discipline: { type: 'string', description: '学科领域（写入 metadata.discipline）' },
        },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }],
        },
        isConcurrencySafe: () => true,
        async execute(args) {
            const { filePath, learnDir, journal, articleType, discipline } = args;
            if (!filePath && !learnDir)
                throw new Error('需要提供 filePath 或 learnDir');
            const files = [];
            if (typeof filePath === 'string' && filePath)
                files.push(filePath);
            if (typeof learnDir === 'string' && learnDir) {
                const walk = async (dir) => {
                    const entries = await fs.readdir(dir, { withFileTypes: true });
                    for (const e of entries) {
                        const full = path.join(dir, e.name);
                        if (e.isDirectory()) {
                            await walk(full);
                        }
                        else {
                            const ext = path.extname(e.name).toLowerCase();
                            if (ext === '.md' || ext === '.markdown' || ext === '.tex' || ext === '.txt')
                                files.push(full);
                        }
                    }
                };
                await walk(learnDir);
            }
            if (files.length === 0)
                throw new Error('未找到可统计的 .md/.tex/.txt 文件');
            const documents = [];
            for (const f of files) {
                try {
                    documents.push({
                        text: await fs.readFile(f, 'utf8'),
                        sourceId: path.basename(f),
                    });
                }
                catch {
                    // 跳过不可读文件
                }
            }
            if (documents.length === 0)
                throw new Error('所有目标文件均不可读');
            const profile = computeJournalProfileFromDocuments(documents, {
                journal: typeof journal === 'string' && journal ? journal : undefined,
                articleType: typeof articleType === 'string' && articleType ? articleType : undefined,
                discipline: typeof discipline === 'string' && discipline ? discipline : undefined,
                sampleSize: documents.length,
            });
            return [
                '目标期刊写作档案（Journal Profile，零网络零 LLM，纯本地统计）：',
                JSON.stringify(profile, null, 2),
                '',
                `统计来源：${files.length} 个文件（${documents.length} 个成功读取）`,
                '用法：把上面的 JSON 传给 writing_audit 的 journalProfile 参数，检测当前稿件的期刊写作契合度。',
            ].join('\n');
        },
    }));
    ctx.tools.register(defineTool({
        name: 'writing_rules',
        description: '返回论文写作纪律速查清单（dsh-plugin-writing-guard v' + PLUGIN_VERSION + '）：修改过程残留、主张校准、修辞模式、LLM 关联词、' +
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
            return rulesBrief();
        },
    }));
    // ---------- 自动审计：论文文件写入后自动检查并注入结果 ----------
    if (cfg.autoAuditOnWrite) {
        // 每个 agent 每轮注入计数。
        // v0.5.2：ToolExecution 上没有 turn 字段（旧实现 (exec as {turn}).turn ?? -1 恒为 -1，
        // "每轮上限"静默退化为"agent 生命周期上限"——长会话后续轮次的新增问题永不注入）。
        // 改用 agent/turn-stopping（DSH 官方轮次边界事件）在每轮结束时清零计数。
        const injectCounts = new Map();
        ctx.on('agent/disposed', ({ agent }) => {
            injectCounts.delete(agent.id);
        });
        // 轮次边界：turn 即将关闭时清零，下一轮重新计数（达到上限只影响 notification，不影响 tracking）
        ctx.on('agent/turn-stopping', ({ agent }) => {
            injectCounts.delete(agent.id);
        });
        // v0.8：pre-execute 捕获 write/edit 前的文本（修改前快照）——
        // 签名 (exec, next) => PreToolDecision，必须放行：return next()。
        // 自动路径的 Scholarship/Epistemic Lock 依赖它；捕获失败（新文件/不可读）时
        // 回退到持久化基线缓存（上次观测到的内容）。
        ctx.on('tools/pre-execute', async (exec, next) => {
            try {
                const target = targetPathOf(exec);
                if (!target)
                    return next();
                const agent = exec;
                if (!agent.agent || typeof agent.agent.id !== 'string')
                    return next();
                if (!isPaperFile(target, agent.agent.session?.header?.cwd))
                    return next();
                // v0.9：exec.token 作为 key（DSH 官方 execution state 范式），path 存进条目用于校验
                const token = exec.token;
                const key = typeof token === 'string' && token ? token : target;
                preimages.set(key, { path: target, content: await fs.readFile(target, 'utf8'), ts: Date.now() });
            }
            catch {
                // 新文件或不可读：无 preimage（首次写入无基线；后续写入由基线缓存兜底）
            }
            return next();
        });
        ctx.on('tools/post-execute', async (exec, _result, next) => {
            // 先放行原始结果，拿到决策
            const decision = await next();
            try {
                const target = targetPathOf(exec);
                if (!target)
                    return decision;
                const agent = exec.agent;
                if (!agent || typeof agent.id !== 'string')
                    return decision;
                // 只审计论文类文件
                if (!isPaperFile(target, agent.session?.header?.cwd))
                    return decision;
                let report;
                try {
                    const profile = detectDocumentProfile(target);
                    const afterContent = await readTextFile(target);
                    // v0.9 自动 Scholarship/Epistemic Lock：preimage（exec.token 键控）优先，否则用基线缓存；
                    // preimage 条目需与本次目标文件同路径（token 复用/路径变化时不误配 before/after）
                    const token = exec.token;
                    const key = typeof token === 'string' && token ? token : target;
                    const pre = preimages.get(key);
                    preimages.delete(key);
                    const original = pre && pre.path === target ? pre.content : (await stateLoaded).baselines.get(target)?.content;
                    // v1.3：自动路径也探测同目录 .bib（local-citation-integrity 数据源）
                    let bibText;
                    try {
                        const dir = path.dirname(target);
                        const bibs = (await fs.readdir(dir)).filter((f) => f.toLowerCase().endsWith('.bib'));
                        if (bibs.length > 0) {
                            bibText = await fs.readFile(path.join(dir, bibs[0]), 'utf8');
                        }
                    }
                    catch {
                        // 无 .bib / 目录不可读：跳过
                    }
                    report = auditText(afterContent, { profile, projectResidueTerms: projectTerms, original, bibText });
                    // 更新基线缓存（供下次写入对比）。v0.9：按 UTF-8 字节计，超过单文件上限
                    // 不持久化（不截断——截断的 baseline 会产生假的 integrity 结果）；
                    // 本次编辑仍可使用 execution preimage。
                    const baselines = (await stateLoaded).baselines;
                    if (baselineByteSize(afterContent) <= BASELINE_MAX_BYTES_PER_FILE) {
                        baselines.set(target, { content: afterContent, ts: Date.now() });
                        pruneBaselines(baselines);
                    }
                }
                catch {
                    return decision; // 二进制/不可读文件跳过
                }
                // 修正版过滤：high > medium > low，且重算 summary
                const filtered = filterReport(report, minSeverity);
                // v0.5 incremental lint：对比上次指纹，只注入新增/已解决
                const auditState = (await stateLoaded).fingerprints;
                const prevFps = auditState.get(target) ?? new Set();
                const currentFps = new Set(filtered.hits.map((h) => hitFingerprint(h)));
                const diff = diffAudit(prevFps, filtered.hits);
                // v0.5.1：cap 只限制 notification，不限制 tracking——
                // 无论是否达到注入上限，都先更新持久化状态；写失败上报日志（v0.5.2）
                auditState.set(target, currentFps);
                queueSave(stateFile, auditState, (await stateLoaded).baselines, (e) => {
                    ctx.logger.warn(`dsh-plugin-writing-guard: 增量状态写入失败（${stateFile}），下次审计将重复注入全部问题: ${e instanceof Error ? e.message : String(e)}`);
                });
                // 无变化：不注入（不要每次把同样的问题重新灌进 agent）
                if (diff.added.length === 0 && diff.resolved.length === 0)
                    return decision;
                // v0.5.1：resolved-only 不即时通知（最安静方案）——等下次有 added 时一起显示；
                // 只有"全部清零"这一种情况单独确认一次
                if (diff.added.length === 0) {
                    if (diff.remaining === 0) {
                        const notice = createUserMessage({
                            content: [{ type: 'text', text: `【dsh-plugin-writing-guard】"${target}" 写作纪律问题已全部清零 ✅` }],
                            source: { kind: 'plugin', plugin: name },
                        });
                        return { ...decision, additionalContexts: [...(decision.additionalContexts ?? []), notice] };
                    }
                    return decision; // 部分解决、无新增：安静等待下次 added 汇总
                }
                // 每轮注入次数限制（只限制 notification；轮次边界由 agent/turn-stopping 清零维护）
                const currentCount = injectCounts.get(agent.id) ?? 0;
                if (currentCount >= cfg.maxAutoInjectPerTurn)
                    return decision;
                injectCounts.set(agent.id, currentCount + 1);
                // 新增问题：只展示新增项 + 增量摘要（"新增 1 / 解决 4 / 仍存在 8"）
                const lines = [
                    `【dsh-plugin-writing-guard 自动审计】"${target}"：新增 ${diff.added.length} 项 / 已解决 ${diff.resolved.length} 项 / 仍存在 ${diff.remaining} 项`,
                    '',
                ];
                for (const h of diff.added) {
                    const sev = h.severity === 'high' ? '🔴' : h.severity === 'medium' ? '🟠' : '🟡';
                    // v0.8：带性质标签（INVARIANT=科学不变量被改动，最高优先）
                    lines.push(`${sev} [${h.severity.toUpperCase()} · conf ${h.confidence} · ${(h.findingKind ?? 'advisory').toUpperCase()}] ${h.label}`);
                    lines.push(`    原文：${h.snippet.trim().slice(0, 200)}`);
                    lines.push(`    建议：${h.suggestion}`);
                    lines.push('');
                }
                lines.push('请按上述建议在下一轮修正新增项（INVARIANT/VIOLATION 优先；CANDIDATE 先人工判定是否删除）；已解决项无需处理。');
                const text = lines.join('\n');
                const notice = createUserMessage({
                    content: [{ type: 'text', text }],
                    source: { kind: 'plugin', plugin: name },
                });
                // 把自动审计结果作为下一条请求的附加上下文（不阻塞本次调用）
                return {
                    ...decision,
                    additionalContexts: [...(decision.additionalContexts ?? []), notice],
                };
            }
            catch (error) {
                ctx.logger.warn(`dsh-plugin-writing-guard: auto audit failed: ${error instanceof Error ? error.message : String(error)}`);
                return decision;
            }
        });
    }
    // ---------- autoBrief：每轮注入纪律速查（默认关闭） ----------
    if (cfg.autoBrief) {
        // 每 agent 每 N 轮注入一次，避免打扰（默认每 5 轮）
        const briefCounts = new Map();
        const BRIEF_EVERY_TURNS = 5;
        ctx.on('agent/disposed', ({ agent }) => {
            briefCounts.delete(agent.id);
        });
        ctx.on('agent/turn-stopping', async ({ agent, turn }) => {
            try {
                const cwd = agent.session?.header?.cwd;
                // 只在论文工作区注入（知识库布局或路径含论文特征；与 isPaperFile 同词表）
                if (!cwd || !isPaperPath(cwd))
                    return;
                const prev = briefCounts.get(agent.id);
                if (prev && turn - prev.turn < BRIEF_EVERY_TURNS)
                    return;
                briefCounts.set(agent.id, { turn });
                agent.inject?.(createUserMessage({
                    content: [{ type: 'text', text: rulesBrief() }],
                    source: { kind: 'plugin', plugin: name },
                }));
            }
            catch (error) {
                ctx.logger.warn(`dsh-plugin-writing-guard: autoBrief failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
    }
}
