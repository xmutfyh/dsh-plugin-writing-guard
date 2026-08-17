# Changelog

All notable changes to dsh-plugin-writing-guard are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.2] - 2026-08-17

### Added / Fixed — Rhetorical Semantics Hardening

- **修复中文 Rhetorical Moves 的 `` 边界问题（P0）**：中英文 regex 拆开，中文不再经过 ``，
  `近年来 / 随着 / 背景 / 缺乏 / 尚未 / 本研究` 等中文 move 现在能正确识别。
- **Rhetorical order fit 改用 medoid sequence（P0）**：不再把 frequency-sorted move list 当目标顺序；
  Journal Profile 新增 `sectionSequences.<section>.medoid`，取 corpus 中真实存在且与其他序列平均 LCS
  相似度最高的序列作为 canonical order。
- **`results_discussion` 双 move vocabulary（P1）**：combined section 同时支持 Results moves
  （finding / comparison / unexpected）和 Discussion moves（summary / interpretation / limitation /
  implication / future）。
- **transitions 改为 section-bound（P1）**：新增 `sectionTransitions`，避免 Abstract / Introduction /
  Discussion 共享 move 时互相污染；旧全局 `transitions` 保留兼容。
- **spanKind 真正进入统计口径（P1）**：新增 `spanDensity`、`recognizedClaimDensity`、
  `highCausalDensity`、`hedgedClaimDensity`、`strongEvidentialDensity`，区分“所有 proposition spans”
  与“明确 scientific claim”，并同步进入 Journal Profile / Journal Fit。
- **Journal Fit 引入分组权重（P1）**：按 句法结构 20% / 语态人称 10% / 引用 15% / 科学主张 35% /
  修辞结构 20% 分组加权，不再由 metric 数量隐式决定模块权重。
- `PLUGIN_VERSION` 1.6.1 → 1.6.2。

### Tests

- 新增中文 Introduction 序列、medoid order、results_discussion 双 move、procedural/descriptive
  不进入 recognized scientific claim、order permutation 等回归测试。

## [1.6.1] - 2026-08-17

### Added / Fixed — Semantic Hardening

- **`claimDensity` 取代 `claimCount` 进入 Journal Fit**：`claimCount` 保留为描述性元数据，
  主分数改用 `claims / 1000 words`，避免 section 长度直接主导分数。
- **`ClaimSpan.spanKind`**：新增 `claim / procedural / descriptive / unknown` 启发式标签，
  为后续真正的 proposition semantics 留出扩展点。
- **移除旧 regex epistemic 重复计权**：Journal Fit 主分数不再直接使用 `hedgeDensity` /
  `causalForce` / `evidentialForce` 三个旧 regex 密度，避免与 ClaimSpan epistemic ratios 重复。
- **`results_discussion` 独立 canonical section**：不再把 `Results and Discussion` 强行并入
  `results`，避免混合解释/机制污染 Results 语料。
- **epistemic ratios 数值 TP/TN 测试**：覆盖 highCausal / strongEvidence / hedged / scope /
  null 的真实语义。
- `PLUGIN_VERSION` 1.6.0 → 1.6.1。

### Tests

- 298 → 308: semantic hardening TP/TN（10 项新增）。

## [1.6.0] - 2026-08-17


### Added — Rhetorical Moves（Introduction / Discussion / Results / Methods 序列）

- **`detectRhetoricalMoves(text, sectionName)`**: 零 LLM 的轻量 rhetorical move 检测，返回去重后的 move 序列。
- **Journal Profile `rhetoric` 升级**：
  - `sectionMoves`: 每个 canonical section 的 move 出现频率
  - `transitions`: move → move 的转移概率
  - `moves`: 全局 move 频率
- **Journal Fit 新增 rhetorical 指标**：
  - `rhetorical move coverage`
  - `rhetorical order fit`（LCS 序列相似度）
- `PLUGIN_VERSION` 1.5.0 → 1.6.0。

### Tests

- 294 → 298: rhetorical moves 单元测试、rhetoric profile sectionMoves/transitions、Journal Fit rhetorical metrics。

## [1.5.0] - 2026-08-17


### Added — Epistemic Journal Fingerprint（复用 ClaimSpan）

- **Journal Engine 不再只数 regex 词频**：`computeSectionSample` 现在通过
  `splitSentences` → `extractClaimSpans` 提取每个章节的 claim-level 科学主张指纹。
- **`JournalSectionProfile` 新增 v1.5 分布字段**：
  - `claimCount`
  - `highCausalRatio`（causalLevel ≥ 4）
  - `hedgedClaimRatio`
  - `strongEvidentialRatio`（evidentialLevel ≥ 4）
  - `scopeQualifiedRatio`
  - `nullFindingRatio`（零结果/否定）
- **Journal Fit 新增 6 个 epistemic 指标**，与原有句法/引用指标一起参与打分。
- **`JournalProfile.epistemics` 同步扩展**，全局 corpus 也能输出 epistemic fingerprint。
- `PLUGIN_VERSION` 1.4.2 → 1.5.0。

### Tests

- 293 → 294: epistemic fingerprint distributions 存在性检查。

## [1.4.2] - 2026-08-17


### Added / Fixed — Journal Fit engineering hardening

- **CI 真实语料解耦（P0）**: real-corpus smoke test 在本地语料不存在时自动 SKIP，不再让 GitHub
  Actions / npm publish 因缺少 `D:\裂缝盐析` 而失败；支持 `WRITING_GUARD_REAL_CORPUS` 环境变量指定语料目录。
- **Ratio 型指标评分修复（P1）**: `journalMetricScore` 增加 `minSpread`，第一人称/被动语态等 0–1
  比例指标使用 `minSpread=0.05`，避免 10% vs 90% 仍被误判为 ok。
- **引用密度拆分（P1）**: Journal Profile 新增 `bibliographicCitationDensity` 与
  `figureTableReferenceDensity` 两个独立分布；Journal Fit 分别输出“文献引用密度”和“图表引用密度”。
- **Journal Fit Confidence（P1）**: 报告新增 `confidence`（very_low/low/medium/high）与
  `corpusSize`；formatReport 显示 Profile Confidence 和每个 section 的 `n=` 覆盖数。
- **Canonical section aliases 扩充（P2）**: `materials & methods`、`experimental methods`、
  `modeling/modelling`、`summary`、`results and discussion`、`background` 等常见别名归一化。
- `PLUGIN_VERSION` 1.4.1 → 1.4.2。

### Tests

- 291 → 293: Journal Fit confidence/corpusSize、split citation distributions。

## [1.4.1] - 2026-08-17


### Fixed / Added — Corpus-aware Journal Distillation

- **`computeJournalProfileFromDocuments(documents, opts)`**: 新增多论文聚合入口。每篇论文独立
  `preprocess` / `detectSections`，不再 `chunks.join("

")` 后当作一篇超长文档。
- **Canonical section mapping**: `method / methods / methodology / materials and methods` → `methods`；
  `conclusion / conclusions` → `conclusion`。
- **`JournalSectionProfile` 全部指标升级为 `Distribution`**: `sentenceLength` / `paragraphLength` /
  `hedgeDensity` / `causalForce` / `evidentialForce` / `firstPersonUsage` / `passiveVoice` /
  `citationDensity` 都保存跨论文聚合后的分布；新增 `articleCount`。
- **`auditJournalFit()` 修复**: 删除 scalar 伪装 Distribution 的临时逻辑，所有指标直接使用真实
  Distribution 打分；新增 **引用密度** 进入 Journal Fit。
- **`writing_journal_profile`**: 按 `JournalDocument[]` 读取每篇论文，并正确写入
  `metadata.sampleSize = documents.length`。
- **被动语态检测增强**: 补充 `shown / found / given / seen / known / taken / made / used /
  considered / observed / measured / performed / conducted / calculated / estimated / simulated /
  modeled / modelled / reported / detected / described / discussed / presented` 等常用过去分词。
- `PLUGIN_VERSION` 1.4.0 → 1.4.1。

### Tests

- 284 → 291: sections 91–92（corpus-aware 三篇 Results 中位数聚合、D盘真实 source.md smoke test）。

## [1.4.0] - 2026-08-17


### Added — Journal Engine（期刊写作蒸馏与 Journal Fit，DSH Scientific Writing Guard 基础层）

- **`JournalProfile` schema**: 新增 `Distribution` / `JournalSectionProfile` / `JournalProfile` /
  `JournalFitReport` 类型——从目标期刊代表论文提取句长/段长/hedge/因果力/证据力/第一人称/被动语态/
  引用密度的抽象统计分布，不保存论文原句。
- **`writing_journal_profile` 工具**: 从目标期刊代表论文目录/文件（.md/.tex/.txt）蒸馏 Journal Profile，
  零网络零 LLM，纯本地统计；支持 `journal` / `articleType` / `discipline` 元数据。
- **`writing_audit(journalProfile=...)`**: 传入 Journal Profile JSON 后，输出 section-level Journal Fit
  报告（每个章节契合度百分比 + 主要差异 + 目标分布范围），并在 `formatReport` 中独立展示。
- **`computeJournalProfile` / `auditJournalFit`**: 导出纯函数，供 tests / 其他 DSH 工具直接调用。
- **`rulesBrief` 新增 Journal Engine 纪律**: 明确 Journal Fit 不能覆盖 Scientific Integrity 的优先级
  （Invariant > Epistemic Safety > Journal Requirement > Journal Norm > Journal Style）。
- **`claimAnchor` 中文支持**: Epistemic 指纹的 claim identity 增加 CJK bigram，帮助中文 scientific
  revision 区分不同 claim 上的相同漂移（模型A vs 治疗组不再因同一种关联→因果变化而指纹碰撞）。
- `PLUGIN_VERSION` 1.3.0 → 1.4.0，package.json / CHANGELOG / SKILL / rules.ts 版本统一。

### Tests

- 276 → 284: sections 89–90（Journal Profile 蒸馏 metadata/distributions/statistics-only、Journal Fit 审计/format/缺失章节 warning）。

## [1.3.0] - 2026-08-16

### Added — 篇章统计层（第 10 轮评审 9.55/10：局部规则 → 篇章统计 → 科学完整性）

- **`paragraph-rhythm`（段落节奏，aggregate）**: 一次计算多个信号——一句成段比例（碎片化，
  ≥35% 且 ≥3 段）、段长中位数/标准差/CV、长段 outlier 比例（拥塞，> 中位数 2.5 倍 ≥2 段）、
  连续 ≥3 段长度在中位数 ±15% 内的 run 数（过度整齐，≥2 处）。节奏统计只用 prose-only
  段落（排除标题/图片/作者行/表格残留等版式元素行，避免把正常版式误报为碎片化）。
- **`sentence-rhythm-uniformity`（句长节奏均匀）**: 段落内连续 ≥3 句长度在局部中位数 ±15% 内
  且全文 ≥2 处 → "节奏过匀"（variance 过小 + 连续发生）；有作者 styleProfile 时对比历史
  `sentenceLengthStd`（当前 std < 历史 60% → 更整齐）——adaptive threshold 原则：
  有 profile 用历史分布，无 profile 用 conservative heuristic。
- **`repeated-discourse-scaffold`（重复逻辑脚手架）**: 段落抽象为枚举签名（首先→其次→最后 =
  `1-2-4`、第一→第二→第三 = `1-2-3`、First→Second→Third、从X层面→从Y层面 = `P-P-P`），
  同一签名在 ≥2 个独立段落出现 → 模板化。单次列举正常（candidate）。
- **`punctuation-scaffold-overload`（标点脚手架过载）**: 同一句内 ≥3 类结构标点
  （括号/冒号/分号/引号/破折号）聚集；豁免符号定义列表（`1) RMSE: ...; ...`、
  `(a)(b)(c)` 图注、`Level-2 (unseen-combination): ...` 等论文标准格式）。
- **`coined-framework-language`（自创框架词，形式规则）**: A-B-C 短线框架（"输入—处理—输出"）、
  同一段 ≥2 个不同 XX化/XX力、≥3 个不同 XX性（可持续性/系统性单独出现是正当术语）、
  XX闭环/赋能机制——全部 candidate。
- **`generic-claim-candidate`（正确但空泛）**: 多弱信号组合（抽象名词 ≥2 + 无实体/数值/引用 +
  无方法动作 + 万能句型），≥3 信号同时满足才报；中英双语；candidate + low。
- **`summary-cliche-positional`（总结套话位置感知）**: 不新增词表——同一总结套话
  （综上所述/in conclusion）在每个小节末尾反复出现（≥2 个小节末尾）才报。
- **`local-citation-integrity`（本地引用完整性，零网络确定性）**: `\cite{key}` ↔ `.bib` 条目
  存在性、`\ref` ↔ `\label` 对应、bib 条目缺 title/year/author、同一 DOI 对应多个 key。
  写作/自动审计路径都会探测目标文件同目录的 `.bib`；"该文献是否支持这句话"明确留在插件边界外。
- **StyleProfile 升级为"节奏指纹"**: 新增 `sentenceLengthCV`、`shortSentenceRatio`、
  `longSentenceRatio`、`paragraphLengthStd`、`paragraphLengthCV`（向后兼容，旧档案缺省跳过）。
- **`PLUGIN_VERSION` 1.2.3 → 1.3.0**，版本源统一（package.json/CHANGELOG/SKILL/rules.ts）。

### Tests

- 246 → 276: sections 81–88（paragraph-rhythm 三类 TP/TN、sentence-rhythm run+author TP/TN、
  scaffold 中英 TP/TN + signature 单元、punctuation overload TP/TN + 定义列表豁免、
  coined framework TP/TN（含 XX性 正当术语 TN）、generic claim 中英 TP/TN、
  citation integrity 解析/TP/TN/无 bib no-op、summary-cliche positional TP/TN）。

## [1.2.3] - 2026-08-16

### Added — claim identity in fingerprints + unpaired inventory (1.2.2 评审 9.55/10 的三项)

- **Epistemic fingerprints carry claim identity (P0)**: `Hit` gains a `fingerprintKey` field,
  separate from the display `matchText`. Epistemic events now fingerprint on a lightweight
  `claimAnchor` (subject + content tokens, zero-NLP: "The intervention was associated with
  mortality" → `intervention|associated|mortality`) — two different claims undergoing the exact
  same association→causation drift no longer share a fingerprint, so the incremental auto-audit
  treats the second claim's change as **new**. Fingerprints use a deterministic FNV-1a hash of
  the full key (no more `slice(0, 60)` truncation collisions). `FINGERPRINT_VERSION` 6 → 7.
- **Global Scholarship Inventory uses unpaired multiset (P0/P1)**: new `diffScholarshipInventory`
  performs raw multiset conservation with **no pairing** — in a version-gap, "5 mg → 6 mg" is
  reported as "带单位数值：移除 1 / 新增 1" instead of vanishing into a `changed` pair that the
  removed/added-only counter missed. Iterates all `ScholarshipType`s (number/percent/pvalue/ci/
  cite/ref/figure/table/doi) so the inventory can't drift from the engine's entity set.
- **Unified marker-event confidence (P1)**: `markerEventTier(sim, positionalFallback)` is now
  shared by added and removed directions — "how sure we are this is the same claim" no longer
  depends on the change direction. Positional-fallback events below 0.55 sim are `candidate`
  (not hard-coded `invariant`), consistent with the removed side.

### Tests

- 240 → 246: same-drift-on-different-claims distinct fingerprints + diffAudit-new + stability,
  unpaired inventory counts number replacement (and pvalue coverage), fallback added→candidate.

## [1.2.2] - 2026-08-16

### Fixed — automatic Guard delivery (1.2.1 评审 P0×2 + P1×2 + P1/P2)

- **Event-level fingerprints (P0)**: `hitFingerprint` no longer infers "aggregate" from
  `paragraphIndex === -1`. A whitelist (`AGGREGATE_RULE_IDS`: density/section/style-profile
  rules) keeps aggregate semantics; Scholarship/Epistemic integrity events now fingerprint on
  their `matchText` — "5 mg→6 mg" and "10 mg→12 mg" are distinct events, so the incremental
  auto-audit no longer treats a *new* scientific change as the same old issue and stays silent.
  `FINGERPRINT_VERSION` 5 → 6 (old state rebuilt).
- **Invariants always surface (P0)**: `filterReport` keeps every `findingKind === 'invariant'`
  hit regardless of the severity filter — conservative mode's `high` gate now applies to
  style/rhetorical/formatting issues only. MEDIUM invariants (added citations/numbers/DOIs,
  added negation/null findings, evidence-status drift, scope drift) are no longer silently
  dropped from the auto-audit notification.
- **SCOPE lastIndex bug (P1)**: `isScopeOnlyFragment` now uses a `/g`-free `SCOPE_TEST_RE`
  clone — consecutive scope fragments ("In this cohort, under these conditions, …") no longer
  fail the second `.test()` call.
- **Subject bonus requires non-empty subjects (P1)**: `'' === ''` no longer grants +0.3
  (pure-Chinese candidates vs mixed-script candidates no longer rank wrongly).
- **Version-gap keeps a Global Scholarship Inventory (P1/P2)**: when alignment F1 < 0.2,
  line-level pairing is skipped (it would fabricate "5 mg→7 mg" pairs), but the full-document
  multiset counts for citations/DOIs/figures/tables/numbers are still computed and reported
  ("引用：移除 12 / 新增 17；DOI：移除 2 / 新增 3…") for human structural review.

### Tests

- 233 → 240: distinct event fingerprints + diffAudit non-collapse + aggregate preserved,
  invariant-survives-filter / candidate-still-filtered, multi-scope lastIndex regression,
  version-gap inventory.

## [1.2.1] - 2026-08-16

### Fixed — Scholarship Lock hit-emission gaps (1.2 评审 P0) & precision

- **Scholarship Lock full hit emission (P0)**: `lockTypes` now includes `number` and `doi` —
  "5 mg deleted", "DOI replaced" previously only showed in the integrity summary without a
  concrete hit. A new `diff.added` loop emits hits for every protected entity introduced
  (citation/figure/table/number/DOI added out of nowhere) as MEDIUM/invariant — no more
  "summary says ✗, details show nothing" mismatch. changed/removed stay HIGH.
- **self-report canonical/regex fix (P1)**: `EVIDENCE_STATUS_RE` now matches `self reported`
  (space variant) via `self[\s-]?report(?:s|ed)?`; `self-report`/`self-reports` fold into the
  `self-reported` canonical key alongside the spaced forms.
- **Positional fallback honesty (P1)**: short-document fallback events now carry the **real**
  cosine similarity (no more hardcoded 0.5) and a `positionalFallback` flag — reports say
  "short-text positional fallback, not high-confidence lexical alignment".
- **Scope-only unification (1.3 preview)**: `SCOPE_PREFIX_RE` removed; `isScopeOnlyFragment`
  reuses `SCOPE_RE` directly (plus "contains no causal/evidential marker" check) — the scope
  detector and scope attachment can no longer drift apart. `Within this sample,` /
  `during the study period,` etc. now attach to the following claim.
- **Alignment tokenizer fix (found while testing)**: sentence alignment now uses a
  stop-word-preserving tokenizer — `results`/`experiment`/`model` etc. are claim-identity words
  and were being filtered by the restatement stop list, breaking alignment of entity-bearing
  sentences. `tokenizeForSimilarity` (stop-filtered) remains for restatement-loop semantics.

### Tests

- 225 → 233: number-removed/added, DOI-replacement, cite-added, figure-added, self-report
  canonical TN/TP, scope-only unification.

## [1.2.0] - 2026-08-16

### Added — claim alignment credibility (1.1 评审 9.4/10 的 4+2 项)

- **Raw-threshold fix (P0)**: clause pairing now gates on **raw** cosine ≥ 0.3; the subject bonus
  only ranks among candidates that already pass — "The model predicts mortality" vs "The model was
  initialized using pretrained weights" (same subject, raw sim ~0.29) is no longer bound as the
  same claim.
- **nullResultAdded independent + two-way dedup (P0)**: null-result additions get their own event
  stream instead of being folded into `negationAdded`; overlap dedup (keep the more specific
  null-result marker) now runs on both removed and added directions.
- **Scope-prefix attachment**: "In this cohort, / Under these conditions, / Among participants,
  / 在本实验中…" no longer become standalone ClaimSpans — they attach to the following claim span
  (scope markers belong to the claim they qualify).
- **Fragment-aware clause segmentation**: relative clauses ("The model, which was trained on
  Dataset A, …") and subjectless predicate fragments ("…, achieved higher accuracy.") merge into
  the main clause — spans are closer to real claims than comma-delimited fragments.
- **Alignment-uncertain candidate**: an unmatched clause carrying protected markers
  (negation/null/scope/evidence-status) no longer degrades back to a sentence-level bag-of-markers
  comparison. Without a reliable claim identity, the engine refuses to assert preservation or
  removal and emits a `claim-alignment-uncertain` review candidate instead.
- **EvidenceStatus canonical enum direction**: canonicalization now folds self-report variants
  (self-report/self-reports/self-reported/self reported) and modelled/modeled into single
  canonical keys.
- **Short-document positional fallback**: when sentence alignment yields zero pairs but both sides
  have ≤3 sentences, position = identity — marker conservation runs positionally (claim drift still
  requires lexical similarity), so "Z improved" → "Z did not improve" (sim≈0.35) is no longer a
  miss; version-gap thresholding uses minSim 0.35 so short rewrites are not misread as full rewrites.

### Tests

- 218 → 225: raw-threshold TP, alignment-uncertain TP (+no-false-verdict), null-added TP + dedup,
  scope-prefix attachment, relative-clause merge.

## [1.1.0] - 2026-08-16

### Added — claim-bound integrity (1.0 评审 P0/P1/P2)

The next layer of the Revision Integrity model: markers are now **bound to the claim they belong
to**, not a bag-of-markers over the sentence.

- **Claim-bound marker conservation (P0)**: negation/null/scope/evidence-status are compared per
  aligned clause pair (with unmatched-clause fallbacks against the full sentence on the other
  side). The swap case the sentence-level multiset could not see is now caught:
  "X did not improve, but Y improved" → "X improved, but Y did not improve" (both `did not` counts
  identical at sentence level, scientific conclusions swapped).
- **Subject-consistency pairing reward (P0, discovered while testing the swap case)**: best-match
  pairing adds a +0.3 score when both clauses share the same subject — "X did not improve" now
  pairs with "X improved" instead of the lexically closer "Y did not improve".
- **Marker canonicalization (P0)**: diff keys are canonicalized (lowercase; modelled/modeled →
  modelled; self reported/self-report* → self-reported) — case-only or en-US/en-GB spelling edits
  are no longer reported as status drift.
- **Scope-added events (P1)**: introducing a scope boundary ("The treatment improves survival" →
  "In this cohort, …") is a possible narrowing of external validity — LOW/invariant event, while
  removal stays MEDIUM.
- **`shows that` / `demonstrates that` role fix (P1)**: that-complements restore epistemic role
  even when the subject is Figure/Table ("Figure 4 shows that treatment increases survival");
  only display objects (architecture/workflow/schematic/example) stay descriptive.
- **Multi-axis deltas in one claim-drift event (P1)**: causal + evidential + hedge changes on the
  same clause are all preserved in a single hit (`delta：因果力 1→5，证据力 1→5，hedge 有→无`)
  instead of silently dropping secondary axes.
- **Version-gap symmetric coverage (P2)**: alignment rate now uses `2·aligned/(before+after)`
  (F1) — before=100 / after=10 with all 10 aligned no longer reads as 100% comparable.
- **Null/negation overlap dedup (P2)**: "did not improve" matching both negation and null-result
  regexes now reports the more specific null-result event only.

### Tests

- 209 → 218: negation swap TP, evidence-status swap TP, canonical TNs, scope-added TP,
  shows-that TP + descriptive TN, multi-axis deltas preserved.

## [1.0.0] - 2026-08-16

### Added — Evidence-Status Lock (Revision Integrity model complete)

The epistemic representation is now the full "scientific commitments" set the 0.9 design review
called for: causal force, evidential force, modality (hedge), negation, null findings, scope, and
now **evidence status**. 1.0 = the deterministic delta model is complete:

```
Scientific tokens        Scientific commitments
├─ number                ├─ causal force
├─ statistic             ├─ evidential force
├─ citation              ├─ modality / hedge
├─ DOI                   ├─ negation
└─ figure/table          ├─ null finding
                         ├─ scope
                         └─ evidence status (v1.0)
            ↓ before → aligned claims → after
            ↓ deterministic delta
```

- **Evidence-Status Lock** (`evidence-status-drift`, MEDIUM/invariant): sentence-level multiset
  conservation of source-status markers (reported/self-reported/observed/measured/recorded/
  detected/visualized/implemented/deployed/installed/estimated/simulated/modelled/calculated/
  derived/inferred/obtained). "participants reported improvement" → "participants improved"
  (report-state erased into a direct claim), "observed rate" → "estimated rate" (status swap),
  and "modelled results" introduced are all flagged for verification — never auto-judged.
- Integrity regression report gains a sixth line: evidence status.
- `writing_audit` description and `writing_rules` brief document the new lock.

### Tests

- 204 → 209: reported-removed TP, observed→estimated TP, modelled-introduced TP, unchanged TN,
  integrity field.

## [0.9.3] - 2026-08-16

### Added — epistemic representation precision (0.9.2 评审的 4 个 engine 问题 + ESR 实测发现)

- **Evidential role disambiguation (P0)**: `EVIDENTIAL_LADDER` now applies per-marker context
  role checks — "Figure 4 shows the model architecture" (descriptive), "a baseline is established"
  (procedural), "confirm configuration/identity/setup" (procedural), "the model demonstrates
  capability" (descriptive) no longer count as epistemic force. Real epistemic drifts
  ("results show" → "results indicate", "well established") still fire.
- **Hedge as independent modality (P0)**: `ClaimSpan.hedged` / `hedgeMarkers` split from the
  evidential integer — "may suggest" → "suggest" (verb level 1→1, hedged true→false) is now
  detected as evidence-force strengthening; hedge introduction detected as weakening.
- **Sentence-level marker multiset for negation/null/scope (P1)**: boolean conservation replaced
  with `diffMarkerLists` multiset conservation (Scholarship Lock's diffValueLists idea) — in
  "X was not associated with Y, and Z did not improve" → "…and Z improved", the "did not" marker
  is removed even though the first clause keeps a negation; partial scope removal
  ("in this cohort, under these conditions…" → "in this cohort…") is detected.
- **Best-match-first clause pairing (P1)**: before-clauses now pick the highest-similarity
  unmatched after-clause within the ±1 window and only then consume it — a low-sim positional
  pair no longer steals the target from a genuinely corresponding clause.
- **Version-gap guard (ESR audit finding)**: when sentence alignment rate < 20% (full-rewrite
  level differences, e.g. the ESR 研究进展0 → V05 FINAL pair at 3.7%), line-level Scholarship/
  Epistemic locks are skipped and a single `version-gap` advisory is reported instead of
  hundreds of misalignment noise hits ("60 d → 5.5 mol", 171 fake citation changes).
- **Causal ladder verb-base fix**: effect/causation rungs now include base forms
  (improve/reduce/increase/modify/influence/promote/enhance/accelerate/attenuate/cause…) that
  were previously missed ("did not improve" no longer reads as a bare 0→4 causal drift).
- Claim-drift hits no longer skip the negation/scope conservation checks on the same clause.

### Tests

- 190 → 204: evidential role TN/TP (Figure/establish/confirm/results/well-established), hedge
  removal/introduction, multi-claim negation multiset, partial scope removal, version-gap guard
  (noise suppression + local-revision unaffected).

## [0.9.2] - 2026-08-16

### Fixed (both discovered by auditing `pore_scale_revised_model_marked_v2`)

- **Clause-misalignment false drifts**: positional clause pairing mispaired citation/infra clauses
  when the revision reordered clauses (e.g. "predicted" vs a citation clause at 96% sentence sim).
  Span-level drift now requires clause cosine ≥0.3 (sentence-level negation/scope locks unaffected).
- **Markdown blockquote broke sentence splitting**: "pore image.\n>\n> As shown in Figure 4(a)…"
  — the period lookahead failed on the `>` marker, merging two sentences into one and producing a
  fake shown→∅ evidential drift. `splitSentences` now strips `>` blockquote markers first.

### Tests

- 188 → 190: clause-reorder TN/TP, blockquote sentence-boundary TP.

## [0.9.1] - 2026-08-16

### Fixed

- **claim-evidence-proximity false positive (real-paper test)**: auditing
  `pore_scale_revised_model_marked_v2.docx` revealed that "a baseline (M1) is established" was
  flagged — `establish` + infrastructure nouns (baseline/protocol/framework/system/dataset/
  benchmark/procedure/workflow/pipeline/registry/criteria/standards) means "to set up", not "to
  prove". The context exclusion now suppresses those collocations while "It is well established
  that…" (a genuine strong claim) still fires.

### Tests

- 183 → 186: establish-a-baseline TN, establish-a-protocol TN, well-established-claim TP.

## [0.9.0] - 2026-08-16

### Added — two-axis epistemic model & clause-level multi-claim drift

Follow-up review (0.8 分析，8.3/10) fixes + the 0.9 design items. All still deterministic.

- **Two-axis claim model** (analysis §"0.9 设计问题"): the single 0–5 ladder is split into
  **causal force** (consistent with(0) < associated(1) < predicts(2) < contributes(3) <
  affects(4) < causes(5)) and **evidential force** (hedge(-1) < suggest(1) < indicate(2) <
  support(3) < show(4) < demonstrate(5) < establish/confirm(6) < prove/guarantee(7)).
  "confirmed an association" is now causal=association + evidential=strong, not a blunt causal L5.
  Hedge removal ("may be associated" → "is associated") is itself an evidential drift.
- **Clause-level multi-claim drift** (`ClaimSpan` + `splitClauses`): sentences are segmented on
  `; , while whereas although but and` (with "between/among X and Y" enumeration protection) and
  each clause's causal/evidential levels are aligned positionally — fixing the structural miss
  where "X caused A, while Y may be associated with B" → "Y caused B" was masked by whole-sentence
  max-level comparison.
- **Alignment-similarity tiers** (analysis item 3): sim ≥0.70 → high confidence / invariant;
  0.55–0.70 → medium / invariant; 0.45–0.55 → low / **candidate** (explicit "please verify" note).
  Completely rewritten sentences (below alignment) can no longer produce false drift.
- **preimage keyed by `exec.token`** (analysis item 4): concurrent edits to the same manuscript no
  longer overwrite each other's before-snapshot; path check inside the entry guards token reuse.
- **UTF-8 baseline byte accounting** (analysis item 5): `Buffer.byteLength` everywhere; per-file
  cap enforced on write — oversized baselines are skipped (never truncated: truncation would
  fabricate integrity diffs); execution preimage still covers the current edit.
- **P0 hotfix** (analysis item 1): `writing_rules` brief no longer tells agents to mechanically
  replace "we believe" with "the results show" (that loop taught the agent to create epistemic
  drift the lock then flags). Calibrated wording: author interpretation → "One possible
  explanation is… / This finding may reflect… / We interpret this as…"; "the results show" only
  when evidence directly supports it.
- Tests 170 → 183: two-axis extraction, multi-claim drift, evidential drift, hedge removal,
  simTier boundaries, low-sim rewrite safety, baseline byte accounting & eviction.

### Changed

- `FINGERPRINT_VERSION` 4 → 5 (claim-drift fingerprints now include axis: `epistemic:claim:causal:1->5`).
- Rule patterns use non-capturing groups (capture groups polluted `.match()` results).
- GitHub/npm description & English README repositioned: **deterministic manuscript integrity guard**.

## [0.8.0] - 2026-08-16

### Added — Epistemic Lock & findingKind（manuscript integrity guard 升级）

Position upgrade: from "AI-style linter + Scholarship Lock" to a **deterministic manuscript
integrity guard** — protecting scientific facts AND epistemic integrity (claim strength, negation,
null findings, scope) during AI-assisted revision. All still local regex/statistics, zero network,
zero LLM.

- **Automatic Scholarship Lock (P0 fix)**: auto-audit now captures the pre-edit file content via a
  `tools/pre-execute` hook (confirmed harness signature `(exec, next) => PreToolDecision`) and
  passes it as `original`, so every paper write/edit is diffed against the previous version —
  Scholarship Lock is no longer manual-only. A persisted baseline cache (state file v2, capped at
  20 files / 512KB each / 4MB total) backs up host restarts and first-edit misses.
- **Epistemic Lock 🔴** (`original` 对比时启用):
  - `claim-drift` — Yila claim-strength ladder (consistent with/may suggest(0) < associated(1) <
    predicts(2) < contributes(3) < affects/leads to(4) < causes/demonstrates(5), adapted, see
    THIRD_PARTY.md). "was associated with" → "caused" is HIGH invariant even when no number
    changed; downward weakening is flagged too (polishing must not change science in either
    direction). Descriptor participles ("associated with reduced mortality") stay capped at the
    association level.
  - `negation-drift` — negation markers removed (no/not/did not/without…) = possible flipped
    negative finding (HIGH); negation added (MEDIUM); null-result phrasing removed (no significant
    difference / did not improve) is a data loss (HIGH, Evidence-Bound principle).
  - `scope-drift` — scope markers (in this study / under these conditions / 在本研究中…) vanishing
    from an aligned sentence → "verify the claim was not generalized" (MEDIUM, never auto-judged).
- **`findingKind` data model**: every hit carries a kind — `invariant` (science changed),
  `violation` (clear discipline breach), `candidate` (defensive wording that may carry a
  legitimate claim boundary — never auto-delete, human triage), `advisory` (pure style). Report and
  auto-inject show the kind tag; defensive rules got cue ≠ verdict notes.
- **`we-believe` suggestion fixed** (no longer pushes "the results show" blindly — that can silently
  upgrade author interpretation into an evidence claim); **`self-deprecation` suggestion fixed**
  (precise evidence-bounded description; negative/null/contradictory findings are data, never
  removed for narrative).
- **Revision Integrity report**: `formatReport` shows a Scholarship + Epistemic regression block
  (✓/✗ numeric, citations, claim strength, negation, scope) whenever `original` is provided —
  including the all-clear case.
- **Mutation benchmark tests**: dedicated v0.8 sections — ladder extraction units, association→
  causation, downward weakening, negation removal, null-result removal, scope removal (en+zh),
  descriptor TN, findingKind classification, integrity summary. 149 → 170 assertions.
- **`THIRD_PARTY.md`**: attribution for Yila-AI/sci-ssci-skills (Apache-2.0 ladder/invariant,
  required), Evidence-Bound (MIT), ko5.6sol (MIT); ARS / journal-adapt noted as references.

### Changed

- State file schema v2 (`baselines`); fingerprint version unchanged (fingerprint semantics intact).

## [0.7.0] - 2026-08-16

### Added — ko5.6sol-informed style rules (anti-mechanical-phrasing)

Borrowed from the community skill `handsomeZR-netizen/ko5.6sol` (anti-GPT-5.6-SOL mechanical
phrasing & defensive disclaimers), while keeping the plugin's density-gated, domain-safe design:

- **`cn-modifier-chain`** (rhetorical_pattern, medium): ≥3 consecutive "的"-joined modifier
  segments in a clause (「基于X的Y的Z的机制」). Two-layer chains (「该方法的预测结果」) are not flagged.
- **`avg-sentence-length`** (academic_style, low): full-document mean sentence length over the
  ko5.6sol targets — English >18 words, Chinese >25 chars — reported per language (≥3 sentences
  each). Complements `overlong-sentence-*` (single-sentence extremes vs overall mean).
- **`cn-self-defeating`** (claim_calibration, high): self-defeating disclaimers that destroy a
  paper's value (完全基于假数据 / 模型毫无意义 / 结果完全不可靠 / 不足为凭…). Honest limitations
  (样本量有限, 结果可能不完全可靠) and legitimate simulated-data statements are NOT flagged.
- **`llm-buzzword-en`** (llm_associated, low): density rule for common-but-AI-flavored adjectives
  (robust/crucial/substantially/exhibits/tailored/interplay/imperative, ≥5 & ≥1.0/1k words).
  Term usages (robust regression) are explicitly exempted.
- **`cn-buzzword-density`** (llm_associated, low): high-bar density rule for abstract nouns
  (机制/支撑/动态/稳健/范式/拓扑/耦合/协同/维度/全流程/精细化/解耦, ≥10 & ≥3.0/1k chars) so domain
  terminology (耦合机理 in geoscience manuscripts) is not false-positived.
- **Word-list merges** (density gates unchanged): EN transition list gains consequently/thus/hence/
  accordingly/thereby/to this end/notably/importantly/specifically/this matters/this motivates;
  CN connective list gains 进一步/由此可见/鉴于/毫无疑问/特别地/有鉴于此/也就是说.
- **`writing_rules` brief** gains a new section「局限性与学术自信」: self-defeating zero-tolerance,
  limitation rewrite formula (objective boundary + future direction), a claim-verb calibration
  table (modelled/simulated ≠ observed/measured; suggested/indicated < demonstrated/established),
  and the ESR discipline boundary (never delete real evidence gaps for "confidence").
- **`SKILL.md`** (repo root): standalone static skill export of the discipline guide for agents
  running outside DSH (Codex / Claude Code / Antigravity), mirroring the ko5.6sol distribution shape.

### Tests

- 136 → 149 assertions: TP/TN for the 的-chain, average sentence length (en/zh), self-defeating
  disclaimers, buzzword densities (en/zh, incl. domain-term TN), and merged word lists.

## [0.6.1] - 2026-08-16

### Fixed

- **Scholarship Lock duplicate-entity diff**: `diffScholarship` now uses multiset diff instead of `Set`-based diff, so changing one occurrence among repeated identical values (e.g. two `5 mm` → one `5 mm` + one `6 mm`) is correctly reported as `5 mm → 6 mm`, and removing one duplicate citation is reported as a removal.
- **Config robustness**: `projectResidueTerms: undefined` in plugin config no longer crashes `apply()`; it now falls back to the default project term list.
- **Docs/security metadata**: `SECURITY.md` now lists `0.6.x` as supported; publish workflow comment no longer claims the npm package name is still unclaimed.

### Tests

- 134 → 136 assertions: duplicate-number change and duplicate citation removal cases for Scholarship Lock.

## [0.6.0] - 2026-08-15

### Added — Academic-writing quality guard (position upgrade)

Position shift: from an "AI-style linter" to a guard that protects **research facts, author style,
and writing quality** while an agent edits a paper. All still local regex/statistics — zero network,
zero LLM.

- **Scholarship Lock 🔴**: `writing_audit` gains the `original` argument (text before polishing).
  Compares research entities between before/after — numbers with units, percentages, p-values,
  confidence intervals, `\cite`/`\ref` keys, Figure/Table numbers, DOI — and reports changes as
  HIGH ("language polishing must not change 87.3% → 89.1%"). Citation/ref removal is flagged too.
- **Defensive saturation (hedge density)**: `hedge-density-en` / `hedge-density-zh` — density rules
  with a new `sentence` unit (≥5 hedges and ≥300/1k sentences). Catches "a caveat on every
  conclusion" as a whole behavior instead of one keyword.
- **Hedge stacking**: `may potentially suggest` / `could possibly indicate` / Chinese 或许可能 —
  one claim wrapped in multiple layers of insurance. ("may well be" is NOT flagged.)
- **Overlong + clause-stacked sentences**: `overlong-sentence-en` (>35 words and ≥3 clause markers
  which/that/while/because…) and `overlong-sentence-zh` (>80 chars and ≥5 commas and ≥3 connectives) —
  implemented via rule `counter` + threshold, fully deterministic.
- **Restatement loops**: `restatement-loop` — same-paragraph sentence pairs with token-cosine ≥0.72
  whose later sentence adds no new evidence (number/citation/entity) → "possible restatement loop".
  Zero-LLM cosine via word tokens (EN) / character 2-grams (ZH).
- **Author Style Profile**: new `writing_style_profile` tool (learn from `filePath`/`learnDir` of the
  author's previous .md/.tex/.txt) producing a JSON profile (sentence-length median/std, paragraph
  median, em-dash/hedge/connective density); `writing_audit`'s `styleProfile` argument flags
  sentence-length drift from the author's historical distribution.
- **Strong claim without evidence anchor**: `claim-evidence-proximity` — prove/establish/confirm/
  guarantee with no number/statistic/table/figure citation within ±120 chars → "check for an anchor",
  not a verdict.
- **Consecutive sentence-initial connectives**: `connective-overuse` — ≥3 consecutive sentences
  starting with Moreover/Furthermore/Additionally/However… in one paragraph.
- **Unicode math symbols**: `format-unicode-math` — ₁₂₃ ²³ α β × − characters in prose (LaTeX
  workflow "tell"): suggest math mode; low severity with a note that α diversity etc. is fine.
- `rulesBrief` cheat sheet extended with a v0.6 section (Scholarship Lock, defensive saturation,
  sentence splitting, restatement, style profile, LaTeX format).

### Changed

- `splitSentences` sentence splitter (EN/ZH mixed; half-width period only splits before a capital
  or CJK char so "Fig. 3", "et al. (2020)", "e.g." survive).
- Density rules support `unit: 'sentence'` denominators.
- Fingerprint version bumped to 4 (new rule set); state baselines rebuilt once.
- Tool descriptions updated (`writing_audit` now documents `original` and `styleProfile`).

### Tests

- 105 → 134 assertions: Scholarship Lock TP/TN (changed percent / removed cite / pure-wording TN),
  hedge density & stacking, overlong EN/ZH, restatement loop, style-profile drift, Unicode symbols,
  claim-evidence anchor, connective overuse, sentence splitter, cosine, profile math.

## [0.5.2] - 2026-08-15

### Fixed

- **Incremental-lint fingerprint instability (P0)**: paragraph-level fingerprints previously used
  the ±60/80-char context snippet, so editing *other* words in the same paragraph turned an
  unfixed issue into a false "resolved+added" pair and re-injected it on every write. Fingerprints
  now use the matched text itself (`ruleId::matchText`) — stable under unrelated edits, and only
  disappear when the issue is actually fixed. State fingerprint version bumped to 3 (old baselines
  are rebuilt once).
- **`maxAutoInjectPerTurn` silently degraded to a per-agent lifetime cap (P0)**: `ToolExecution`
  has no `turn` field, so `exec.turn ?? -1` was always `-1` and the per-turn injection counter
  never reset — in long paper-writing sessions, new issues stopped being injected after the first
  two notifications. The counter is now reset at `agent/turn-stopping` (the real DSH turn boundary).
- **`isPaperFile` substring false positives**: paths like `newspaper-notes.md`, `synthesis-draft.md`,
  `coverage-report.md`, `paperwork.md` were treated as paper files and auto-audited. English hints
  now use character-boundary matching.
- **`detectDocumentProfile` inconsistency**: `revision_notes.md` / `Supplementary_revision_notes.md`
  fell to `unknown` (English `revision/revised` missing from the manuscript regex), `reviewer2_comments.md`
  and `reviewer 2 comments.md` fell to `unknown`, `my_notes.md` / `draft_notes.md` fell to `unknown`.
  All are now classified correctly; `revision_response.md` → `rebuttal`.
- **`we-have-changed` missed "we have now updated" / "we now have also corrected"** (the optional
  group matched only one adverb).
- **`rule-of-three` was case-sensitive**: "Clear, Concise, and Compelling" at sentence start was missed.
- **Incremental state write failures were silently swallowed** (`queueSave` `.catch(() => {})`);
  state loss then caused full re-injection on every write with no way to diagnose. Failures now
  surface through `ctx.logger.warn`.
- **Same-paragraph duplicate hits were under-reported**: a paragraph with 3 occurrences of a rule
  pattern produced only 1 hit; the scan loop now continues within the paragraph (still capped by
  `maxHits`), using a cloned `g`-flagged regex so the shared `rule.pattern.lastIndex` is never mutated.
- **References swallowed the Appendix**: everything after the References heading was classified as
  `reference`; an Appendix / Supplementary section (starting with a heading) after References is now
  scanned again.

### Changed

- `writing_audit` gains a `projectResidueTerms` parameter (temporary per-call project vocabulary),
  matching what the rule message already told users ("可通过 writing_audit 的 projectResidueTerms 维护").
- Section detection now derives the base heading level from the first section-named heading, so
  `# Title` + `## Introduction/## Methods/## Results` layouts (common Markdown structure) support
  cross-section detection correctly; sub-headings under a top-level section still don't split it.
- Plugin version is single-sourced in `src/rules.ts` (`PLUGIN_VERSION`) and reused by the state file,
  tool descriptions, and the rules cheat sheet instead of three hard-coded copies.
- Developer-process residue removed from code comments (the "GPT P0/P1" markers); technical notes kept.

### Tests

- 68 → 105 assertions: new coverage for `isPaperFile` word boundaries, profile detection edge cases
  (`reviewer2_comments` / `my_notes` / `revision_notes` / `revision_response`), fingerprint stability
  under same-paragraph edits (the P0 regression), multiple hits per paragraph, `# Title` + `## Sections`
  base-level detection, Appendix-after-References scanning, `we have now updated`, and capitalized
  rule-of-three.

### Infrastructure

- Added GitHub Actions CI (`.github/workflows/ci.yml`): build + full test suite on push / PR.
- Added npm publish workflow (`.github/workflows/publish.yml`), tag-triggered (`v*`), needs the
  `NPM_TOKEN` secret.
- Added `repository` / `homepage` / `bugs` / `packageManager` / `engines` metadata to `package.json`.
- Full English README (previously one-third of the Chinese version), real `writing_audit` output demo
  in both READMEs, CI badge; removed the author's machine-local install path from the README.
- Published to npm as `dsh-plugin-writing-guard@0.5.2`.

## [0.5.1] - 2026-08-15

### Fixed

- Single-line `$$...$$` math no longer swallows the following prose.
- Density-rule fingerprints are now stable across denominator changes (`aggregate::ruleId`);
  previously 4/3200 → 4/3300 was misread as resolved+added.
- LaTeX `\cite` / `\ref` / `\label` argument keys are dropped entirely (keys are not prose).
- Heading hierarchy: sub-headings under a top-level section are no longer counted as separate
  sections for the cross-section limitation rule.
- `stateFile` empty string now falls back to the default path instead of silently disabling persistence.
- Auto-audit cap only limits notifications, never tracking; resolved-only changes stay quiet until
  the next "added" summary (single confirmation only when everything is cleared).

## [0.5.0] - 2026-08-15

### Added

- Incremental lint: fingerprint diff with persisted per-file state
  (`~/.dsh/plugins/dsh-plugin-writing-guard/state.json`); only new/resolved issues are injected.
- Mode presets (`conservative` / `balanced` / `strict`) overriding the auto-audit minimum severity.

## [0.4.0] - 2026-08-15

### Added

- Segment pipeline preprocessing: typed segments (prose/heading/reference/code/math/table); rules
  declare which kinds they scan; references/code/math/URLs no longer pollute prose stats or density.
- Section detection (Introduction/Methods/Results/…) and the cross-section
  `limitations-across-sections` rule (flagged only across ≥3 top-level sections).

## [0.3.0] - 2026-08-15

### Added

- Document profiles (`manuscript` / `rebuttal` / `cover_letter` / `review` / `notes` / `unknown`)
  with profile-scoped rules ("as requested" is normal in a rebuttal, residue in a manuscript).
- Confidence + evidence on every rule; report shows severity and confidence.
- Chinese density rules (per-CJK-char) with the double gate (minCount + perK).

### Fixed

- Exporting `Config` crashed cordis schema validation (`~standard`); config is now an internal
  constant merged with defaults.

## [0.2.0] - 2026-08-15

### Added

- Initial release: AI writing-tell linter for DSH (`writing_audit` / `writing_rules`), auto-audit
  on paper-file writes, local regex rules (revision residue, defensive writing, rhetorical
  patterns, LLM-associated vocabulary, style and formatting).
