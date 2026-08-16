# Changelog

All notable changes to dsh-plugin-writing-guard are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
