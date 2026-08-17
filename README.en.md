# DSH Writing Guard

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)
[![CI](https://github.com/xmutfyh/dsh-plugin-writing-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/xmutfyh/dsh-plugin-writing-guard/actions/workflows/ci.yml)

> **A deterministic manuscript integrity guard for AI-assisted academic revision.**
> It detects when language polishing silently changes the science — numbers, citations,
> claim strength (causal & evidential force), negation/null findings, scope boundaries — and flags
> mechanical AI writing while protecting your authorial style. Local regex/statistics only:
> zero network, zero LLM.
>
> DeepSeek Harness (DSH) 论文写作守卫：在论文撰写和修改过程中自动检查常见 AI 写作风格、
> 修改残留、防御性表达与机械化句式，并在润色时保护科研事实与科学主张完整性
> （Scholarship Lock + Epistemic Lock）。

**Works with: Chinese papers, English papers, SCI manuscripts, theses, academic writing and polishing.**

The plugin is not a one-shot "humanizer" that rewrites your whole paper after it is done.
Instead it works continuously:

**rules before writing → guard while writing → audit after edits.**

It provides four native DSH tools:

- `writing_rules` — load the writing-discipline cheat sheet before writing
- `writing_audit` — scan text for AI-style patterns, revision residue, defensive writing, LLM-overused expressions and structural tells; `original` arg enables **Scholarship Lock** (numbers/citations/Figure/Table/DOI conservation) + **Epistemic Lock** (claim-strength drift on causal & evidential axes, negation/null-result flips, scope-boundary removal), each hit tagged with its finding kind (INVARIANT / VIOLATION / CANDIDATE / ADVISORY); `styleProfile` adds author-style drift detection; `journalProfile` adds section-level **Journal Fit** against a target journal writing profile
- `writing_style_profile` — learn an author's writing style from previous papers (sentence-length distribution, densities), zero LLM
- `writing_journal_profile` — distill a target journal's writing profile from representative papers (section-level sentence/paragraph length, hedge/causal/evidential density, first-person/passive ratios, citation density), zero LLM

and optionally auto-audits paper files (`.md` / `.tex` / `.txt`) after every `write` / `edit`
(v0.5 incremental mode + v0.8 automatic before/after capture via `tools/pre-execute`, keyed by
`exec.token` for concurrent edits), feeding only *new* high-risk issues back to the agent.

> Positioning: not an "AI detector", not just a writing linter — a **deterministic manuscript
> integrity guard**. It does not tell the model *how* to write; it independently checks, after the
> model has touched the paper, that nothing scientific was changed and that mechanical patterns
> were not introduced. All rules are local regex/statistics — zero network, zero LLM calls,
> millisecond latency.

## Why Writing Guard instead of a Humanizer?

| | Writing Guard | Humanizer | AI Detector |
|---|---|---|---|
| Rules before writing | ✅ | ❌ | ❌ |
| Checks while writing | ✅ | usually ❌ | ❌ |
| Auto-audits paper edits | ✅ | ❌ | ❌ |
| Full-text rewrite | ❌ | ✅ | ❌ |
| Explainable issue location | ✅ | partial | partial |
| Revision residue detection | ✅ | not necessarily | ❌ |
| Defensive writing detection | ✅ | not necessarily | ❌ |
| Local rules (zero network / zero LLM) | ✅ | usually needs LLM | varies |

> Writing Guard is complementary to Humanizers, not a replacement.
> Humanizer workflow: AI draft → rewrite → humanized version.
> Writing Guard workflow: rules → writing → automatic audit → targeted revision.
>
> **A humanizer fixes the text after it's written; Writing Guard guards it as you write.**

## About "removing AI flavor"

In this project, "removing AI flavor" means identifying and reducing mechanical, templated,
over-structured LLM writing style — the goal is better academic expression, not guaranteed
evasion of any AI-detection system.

## Install

```sh
# From npm (published — recommended)
dsh plugin --profile web add dsh-plugin-writing-guard

# From GitHub (lib/ is committed — no build needed)
dsh plugin --profile web add github:xmutfyh/dsh-plugin-writing-guard

# Or from the GitHub tarball
dsh plugin --profile web add https://github.com/xmutfyh/dsh-plugin-writing-guard/archive/refs/heads/master.tar.gz

# Or from a local source directory
dsh plugin --profile web add ./path/to/dsh-plugin-writing-guard

# Restart to apply
dsh web
```

Repository: https://github.com/xmutfyh/dsh-plugin-writing-guard

## Document-profile awareness (v0.3)

The same sentence means different things in different documents. Rules are scoped per document type:

| profile | meaning | e.g. `as requested by the reviewer` |
|---|---|---|
| `manuscript` | paper body | 🔴 revision residue, flagged |
| `rebuttal` | point-by-point response | ✅ normal, not flagged |
| `cover_letter` | submission letter | 🔴 residue, flagged |
| `review` / `notes` / `unknown` | other | conservative handling |

`writing_audit` accepts a `profile` argument, or auto-detects it from the file path
(rebuttal/cover_letter/manuscript keywords; `reviewer2_comments`, `my_notes`,
`revision_notes` are recognized too).

## What it detects

Based on reviewer-shared AI-writing tell lists (dash overuse, "it's not X but Y", absolutist
definitions, colon-title abuse), the "play to strengths / don't bait reviewers" principle, and
published research (Kobak et al., *Science Advances* 2025, >15M biomedical abstracts;
community word lists delve/tapestry/testament/leverage):

| category | typical issue |
|---|---|
| revision residue | "revised model", "as requested", "we have updated", Chinese 本轮/投稿前/审稿人要求 |
| claim calibration | "we do not claim", Chinese 本文并非要证明, self-deprecation; legitimate limitations are NOT flagged (ICMJE) |
| rhetorical patterns | "不是X而是Y"/"not X but Y", "rather than" overuse, absolutist definitions, rule of three, restatement loops |
| LLM-associated words | delve/tapestry/testament/leverage/harness etc. (density rule — a single occurrence is fine) |
| academic style | we believe/think, vague quantifiers, abstract adverbs; "significantly" only prompts review of statistical context |
| formatting | em-dash density (range en-dashes excluded), colon titles, Unicode math symbols (LaTeX workflow) |

## v0.6 Academic-writing quality guard

Position upgrade: from an "AI-style linter" to a guard that **protects research facts, author style, and writing quality while an agent edits a paper**. Still 100% local regex/statistics — zero network, zero LLM:

| capability | what it detects | example |
|---|---|---|
| **Scholarship Lock** 🔴 | research facts changed during polishing: numbers, percentages, p-values, CIs, units, `\cite`/`\ref`, Figure/Table numbers, DOI | `87.3% → 89.1%` → HIGH: language polishing must not change numbers; restore or explicitly confirm |
| **Defensive saturation (hedge density)** | may/might/could/possibly/potentially ≥5 and ≥300/1k sentences — a caveat on every conclusion | sentence-normalized; legitimate hedging in Discussion is fine (ICMJE) |
| **Hedge stacking** | multiple layers of insurance on one claim | `may potentially suggest` → keep one layer |
| **Overlong + clause-stacked sentences** | EN: >35 words and ≥3 clause markers (which/that/while/because…); ZH: >80 chars and ≥5 commas and ≥3 connectives | split sentences, one claim per sentence |
| **Restatement loops** | same-paragraph sentences with token-cosine ≥0.72 and no new evidence (numbers/citations/entities) in the later ones | delete redundant circles |
| **Author style profile** | `writing_style_profile` learns the author's historical style; drift in sentence-length distribution is flagged | "current median 38 vs author 22" |
| **Strong claim without evidence anchor** | prove/establish/confirm/guarantee with no number/statistic/table/figure citation within ±120 chars | check for an anchor, not a verdict |
| **Consecutive sentence-initial connectives** | ≥3 consecutive sentences starting with Moreover/Furthermore/Additionally in one paragraph | mechanical progression |
| **Unicode math symbols** | ₁₂₃ ²³ α β × − characters in LaTeX prose | use math mode instead |

> Principle (v0.6 design review): never write rules for a specific model (GPT-5.6 style, Opus style — models change, behaviors don't); evidence-based hedging is correct academic expression, this tool is not an "anti-hedge" tool.

## v1.3 Document-structure layer (paragraph rhythm → citation integrity)

Not another AI-buzzword list — the next gain is judging **whether the whole document is written too
neatly**. Seven new deterministic/statistical rules (zero network):

| rule | principle | findingKind |
|---|---|---|
| **`paragraph-rhythm`** 🔴 | one aggregate computes: one-sentence paragraph ratio (fragmentation), paragraph-length CV + long outliers (congestion), runs of ≥3 paragraphs within ±15% of the median (over-uniform). Uses prose-only paragraphs — layout lines (bold titles, images, table residue, author lines) never count as fragmentation | advisory |
| **`sentence-rhythm-uniformity`** 🔴 | runs of ≥3 consecutive sentences within ±15% of the paragraph's local median, repeated in ≥2 paragraphs → over-uniform rhythm; with an author `styleProfile`, current std < 60% of historical std also flags — **adaptive threshold**: profile → compare to history; no profile → conservative heuristic | advisory |
| **`repeated-discourse-scaffold`** 🔴 | paragraphs are abstracted to enumeration signatures (First→Second→Finally = `1-2-4`, 第一→第二→第三 = `1-2-3`, 从X层面→从Y层面 = `P-P-P`); the same signature in ≥2 independent paragraphs → templated structure. A single enumeration is fine | candidate |
| **`punctuation-scaffold-overload`** | ≥3 structural punctuation classes (parentheses/colon/semicolon/quote/em-dash) concentrated in one sentence; exempts standard definition lists (`1) RMSE: ...; ...`, `(a)(b)(c)` figure panels, `Level-2 (unseen-combination): ...`) | candidate |
| **`coined-framework-language`** | form-based, not word-list: A-B-C dash frameworks ("input—process—output"), ≥2 distinct XX化/XX力 in one paragraph, ≥3 distinct XX性 (可持续性/系统性 alone are legitimate terms), XX闭环/赋能机制 | candidate |
| **`generic-claim-candidate`** | multiple weak signals must co-occur (≥2 abstract nouns + no entity/number/citation + no method verb + universal template), ≥3 signals; EN+ZH | candidate + low |
| **`summary-cliche-positional`** | no new word list — the same closing cliché (综上所述 / in conclusion) appearing at the end of ≥2 sections | advisory |
| **`local-citation-integrity`** 🔴 | zero-network deterministic: `\cite{key}` exists in `.bib`, `\ref` has a matching `\label`, bib entries missing title/year/author, one DOI mapped to several keys; manual and auto-audit both probe a sibling `.bib`; "does this citation support this claim" stays outside the plugin boundary | violation/advisory |
| **StyleProfile → rhythm fingerprint** | adds `sentenceLengthCV`/`shortSentenceRatio`/`longSentenceRatio`/`paragraphLengthStd`/`paragraphLengthCV` (backward compatible) | — |

## v1.4 Journal Engine (target-journal writing distillation & Journal Fit)

> On top of the Integrity Engine (Scholarship + Epistemic Lock), this adds a **Journal Engine**:
> not "mimic Nature", but distill reusable **writing distributions** from representative target-journal
> papers so AI-assisted revision can converge toward the journal's real writing norms without changing
> the science. Everything is deterministic/statistical, zero network, zero LLM.

| capability | what it does |
|---|---|
| **`writing_journal_profile`** | distill a Journal Profile from representative target-journal papers (`.md/.tex/.txt`): per-section sentence/paragraph length distributions, hedge/causal/evidential density, first-person/passive ratios, global citation density; stores abstract statistics only, never original sentences |
| **`writing_audit(journalProfile=...)`** | with a Journal Profile JSON, outputs a section-level Journal Fit report (per-section score + main differences + target P10-P90 range) |
| **`computeJournalProfile` / `auditJournalFit`** | exported pure functions for tests and other DSH tools |
| **priority rule** | Scientific Invariant > Epistemic Safety > Journal Requirement > Journal Norm > Journal Style; journal style can never override scientific integrity |

## v1.4.1 Corpus-aware Journal Distillation

> Fixes the P0 where multiple papers were joined into one text and same-named sections overwrote each other.
> Each document is now parsed independently and aggregated by canonical section across documents.

- Added `computeJournalProfileFromDocuments(documents, opts)`; `writing_journal_profile` reads each file as a separate `JournalDocument`.
- `JournalSectionProfile` metrics are all `Distribution` now, with a new `articleCount`.
- Canonical section mapping: `method/methods/methodology/materials and methods → methods`, `conclusion/conclusions → conclusion`.
- Journal Fit now includes citation density and no longer fakes scalar values as distributions.
- Passive-voice detection now includes common irregular participles (`shown`, `found`, `given`, `seen`, `known`, `taken`, `made`, etc.).

## v1.4.2 Journal Fit hardening

- **CI-safe real-corpus tests**: local corpus tests are skipped when no corpus is available; use `WRITING_GUARD_REAL_CORPUS` to point at a private corpus.
- **Ratio scoring fix**: first-person/passive ratios use `minSpread=0.05`, so 10% vs 90% is no longer treated as OK.
- **Citation split**: `bibliographicCitationDensity` and `figureTableReferenceDensity` are now separate distributions and separate Journal Fit metrics.
- **Journal Fit Confidence**: reports include `confidence` (very_low/low/medium/high) and `corpusSize`.
- **More canonical aliases**: `materials & methods`, `experimental methods`, `modeling/modelling`, `summary`, `results and discussion`, `background`, etc.

## v1.5 Epistemic Journal Fingerprint (ClaimSpan-based)

- Journal Engine now reuses `extractClaimSpans` instead of counting regex keywords.
- New per-section distributions:
  - `claimCount`
  - `highCausalRatio` (causalLevel ≥ 4)
  - `hedgedClaimRatio`
  - `strongEvidentialRatio` (evidentialLevel ≥ 4)
  - `scopeQualifiedRatio`
  - `nullFindingRatio`
- Journal Fit includes these epistemic fingerprint metrics alongside syntactic/citation metrics.

## v1.6 Rhetorical Moves

- Added `detectRhetoricalMoves(text, sectionName)` for zero-LLM move detection.
- Journal Profile `rhetoric` now includes `sectionMoves` and `transitions`.
- Journal Fit adds `rhetorical move coverage` and `rhetorical order fit` (LCS-based).

## Density thresholds (v0.3.3)

Frequency rules use **per-1000-language-unit** density: English rules are normalized by English
word count, Chinese rules by CJK character count (bilingual files don't dilute each other),
with a **double gate**: `count >= minCount AND count/denominator*1000 >= perK` before flagging.
Examples: "rather than" ≥4 and ≥1.0/1k words; em-dash ≥5 and ≥0.5/1k; LLM words ≥2 and ≥0.4/1k;
Chinese connectives ≥8 and ≥2.0/1k chars. A 500-word abstract and a 12k-word manuscript no longer
share the same threshold.

## Preprocessing (v0.4 segment pipeline, on by default)

Documents are split into typed segments (prose/heading/reference/code/math/table), and each rule
declares which segment types it scans:

- LLM vocabulary, revision residue → `prose`
- colon titles → `heading` only (colons inside body prose don't count)
- references/code/math/table → ignored by default (v0.5.2: an Appendix after References is still scanned)

**Section detection** (Introduction/Methods/Results/Discussion/Conclusion…) powers
`limitations-across-sections`: repeated limitation statements scattered across ≥3 top-level
sections are flagged, while stating limitations once in the Discussion (ICMJE) is not.
(v0.5.2: the section base level adapts to `# Title` + `## Sections` layouts; sub-headings under
a top-level section are never counted as separate sections.)

## Confidence / evidence (v0.3)

Every rule carries `confidence` (high/medium/low) and `evidence` (literature/style-guide/heuristic/project-specific).
Reports show `🔴 HIGH · conf high`, so you know which findings are deterministic rules
(e.g. "revised" residue) and which are probabilistic signals (e.g. LLM word density).

## Tools

| tool | purpose |
|---|---|
| `writing_audit` | scan text/file; args: text/filePath, profile, verbose, projectResidueTerms, original (v0.6 Scholarship Lock: text before polishing — compares research entities), styleProfile (v0.6 author style profile JSON), journalProfile (v1.4 target-journal profile JSON); returns issues sorted by severity+confidence plus full-text stats and optional Journal Fit |
| `writing_rules` | return the writing-discipline cheat sheet (profiles + density rules) |
| `writing_style_profile` | v0.6: learn style metrics (sentence-length median/std, paragraph length, em-dash/hedge/connective density) from the author's previous papers (filePath/learnDir) → JSON for writing_audit's styleProfile |
| `writing_journal_profile` | v1.4: distill a target-journal writing profile from representative papers (filePath/learnDir) → JSON for writing_audit's journalProfile |

### Real output demo

`writing_audit` on a paragraph containing revision residue (verbose=true, real output):

```text
写作纪律检查报告（文档类型: manuscript）：发现 3 处问题（高 3 / 中 0 / 低 0）
- 统计：1 段 / 115 字符（英文 19 词 + 中文 0 字）；破折号 0；rather than 0；不是X而是Y 0；绝对化定义 0；三连排比 0；LLM过渡词 0；中文套话 0；冒号标题 0
- 分类：修改过程残留 3

🔴 [HIGH · conf high] 正文出现 "revised/revision" 修改过程残留 [para 0]
    原文：The revised model uses the ΔP regression objective only. As requested by the reviewer, we h…
    建议：改为中性论文语言：the proposed model / the model / the present analysis，把“修改”动作从正文清除。

🔴 [HIGH · conf high] 审稿回应用语残留 [para 0]
    原文：The revised model uses the ΔP regression objective only. As requested by the reviewer, we have updated the methods.
    建议：直接陈述做法或结果本身，不引用审稿过程。

🔴 [HIGH · conf high] "we have updated/modified" 修改叙述 [para 0]
    原文：…ΔP regression objective only. As requested by the reviewer, we have updated the methods.
    建议：把句子改写为对最终版本的直接陈述，例如直接描述模型/方法/结果，删除变更动词。

（提示：加 verbose=true 可查看每条的建议与备注；默认只输出原文摘要）
```

## Auto-audit (on by default, v0.5 incremental mode)

The plugin listens on `tools/post-execute`: when a **paper-like file** (.md/.tex/.txt whose path
contains manuscript/paper/revision/response/论文/修订/返修…, or inside knowledge-base dirs like
01_manuscript/) is written via `write`/`edit`, it auto-audits (auto profile detection) and
injects the result into the model's next request via `additionalContexts`.

**v0.5 incremental lint**: audit state is persisted per file
(`~/.dsh/plugins/dsh-plugin-writing-guard/state.json`); each write injects only the **delta**
(v0.5.2: fingerprints are based on the matched text itself, so editing other words in the same
paragraph no longer causes false "resolved+added" re-injection):

```text
新增 1 项 / 已解决 4 项 / 仍存在 8 项   (1 new / 4 resolved / 8 remaining)
```

- No change → nothing injected (no repeated nagging)
- Resolved-only → brief confirmation (doesn't consume the per-turn injection budget)
- Only **new** issues are listed with suggestions; the full list is always available via `writing_audit`

Configuration (web profile `cordis.patch.yml`):

```yaml
- id: dsh-plugin-writing-guard
  config:
    autoAuditOnWrite: true          # auto-audit paper writes (default true)
    mode: conservative              # conservative|balanced|strict (overrides minSeverity; default conservative=high)
    autoAuditMinSeverity: high      # high|medium|low (explicit value beats mode)
    maxAutoInjectPerTurn: 2         # max auto-injections per agent turn (only notifications; tracking always runs)
    verboseByDefault: false
    autoBrief: false
    projectResidueTerms: []         # project-internal vocabulary (appended to defaults; flagged as medium)
    stateFile: ''                   # incremental state file (default ~/.dsh/plugins/dsh-plugin-writing-guard/state.json)
```

## FAQ

### Is this an "AI de-flavoring" plugin for DSH?

Sort of — but unlike a traditional Humanizer, Writing Guard detects common AI writing style
*during* the writing/revision process instead of handing the whole text to another model to rewrite.

### Does it support Chinese papers?

Yes. Rules cover both Chinese and English papers: mechanical expressions, templated transitions,
revision residue and defensive writing (Chinese by CJK char count, English by word count).

### Does it support SCI / English academic writing?

Yes. `writing_audit` checks English manuscripts for revision residue, defensive writing,
LLM-overused expressions and common AI-style sentence patterns.

### How is Writing Guard different from academic-humanizer?

academic-humanizer edits existing text toward naturalness; Writing Guard continuously checks
and prevents issues in the DSH paper workflow. They complement each other.

## Tests

```sh
npm test   # builds first, then runs 134 TP/TN/edge-case assertions (zero-dependency runner,
           # incl. isPaperFile/profile detection, fingerprint-stability, Scholarship Lock and style-profile regressions)
```

CI (GitHub Actions) runs build + full tests on every push / PR.

## Development

```sh
pnpm install && pnpm build   # TypeScript -> lib/
# rule engine: src/rules.ts (zero dependencies, pure regex + statistics)
```

## License

MIT
