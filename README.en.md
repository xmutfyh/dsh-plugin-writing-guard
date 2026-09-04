# DSH Writing Guard

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)
[![CI](https://github.com/xmutfyh/dsh-plugin-writing-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/xmutfyh/dsh-plugin-writing-guard/actions/workflows/ci.yml)

**Less explanation. More argument. Preserve the science.**

Writing Guard is a research-paper writing guard for DeepSeek Harness:
it guides the host model toward economical, evidence-bound prose and audits mechanical, templated and defensive writing,
protects research facts and scientific commitments during AI-assisted revision,
calibrates a manuscript's writing distributions against representative target-journal papers,
and detects context-to-artifact leakage in final deliverables.

> **Language can change. Evidence cannot. Rejected alternatives should not leak.**

**Prompt-guided writing · Deterministic integrity core**

---

## New in 2.0 — Argument Economy & Control-Plane Separation

Writing Guard 2.0 moves semantic style decisions before generation while keeping deterministic code focused on integrity.

- **Critique is not content:** reviewer comments, user edit instructions and guard findings are control context, not manuscript evidence.
- **Prefer CUT over REWRITE:** delete sentences that only pre-empt criticism, reassure reviewers, advertise importance or restate an obvious implication.
- **Do not close every semantic loop:** stop after evidence plus the necessary interpretation; retain non-obvious statistics, reproducibility detail and genuine epistemic boundaries.
- **Style-only revisions default to the same length or shorter:** no explanatory inflation without new supported content.
- **Auto-audit no longer reinjects snippets or rewrite suggestions:** it returns structured rule/action metadata only.

Example:

```text
Avoid:  To prevent data leakage, normalization was carefully performed using only the training data.
Prefer: Normalization parameters were estimated from the training data.
```

---

## Five guards: STYLE / EVIDENCE / JOURNAL / DELIVERY / DOCUMENT

1. **Less AI / STYLE**
   Detect and reduce mechanical, templated, over-defensive AI writing — revision residue, defensive writing, hollow buzzwords and structural tells. We do not hide AI use; we remove bad AI writing.
   > Stronger AI models increasingly write “correct but unnecessary” sentences.

2. **More Evidence / EVIDENCE**
   Numbers, p-values, citations and DOIs must not silently drift during polishing; null findings must not disappear; correlation must not become causation; scope and evidence status must not be silently changed. Language can change. Evidence cannot.

3. **Better Journal Fit / JOURNAL**
   Distill section-level writing distributions, scientific claim patterns and rhetorical moves from representative target-journal papers. It is not only about wording — it compares what each section typically says and in what order.

4. **Clean Delivery / DELIVERY**
   Detects context-to-artifact leakage: rejected alternatives, revision history, or working-context residue that leaks into final deliverables without support from the authoritative baseline. CAL = Context-to-Artifact Leakage (an engineering term, not academic).
   > Language can change. Evidence cannot. Rejected alternatives should not leak.

5. **Safe Document Editing / DOCUMENT**
   Verify edit scope and preserve Word/OOXML structures, equations, tables and package integrity.

## Quick Start

```sh
dsh plugin --profile web add dsh-plugin-writing-guard
dsh web
```

Published on npm. GitHub / local source installs are also supported — see [full install instructions](#full-install).

---

## How it works

```text
writing rules → Agent revision → automatic guard → targeted revision
```

Writing Guard is not a one-shot humanizer. It works continuously inside the DSH paper workflow:

- Load `writing_rules` before writing
- Check while writing / editing with `writing_audit`
- Compare before/after revisions to protect Scholarship / Epistemic invariants

## STYLE — argument economy and prose discipline

Detects:

- Revision residue: `revised`, `as requested`, `本轮`, `审稿人要求`
- Defensive writing: concession stacking, limitation pre-emption, generic value claim, unnecessary epistemic retreat
- Mechanical rhetoric: `not X but Y`, `rather than` overuse, rule of three, em-dash / colon abuse
- LLM-associated words: `delve` / `tapestry` / `testament` / `leverage` (density-based, a single use is fine)
- Chinese filler chains, average sentence-length anomalies, etc.

Density thresholds are language-aware: English by word count, Chinese by CJK character count, with a double gate to avoid false positives on domain terms.

## EVIDENCE — Scholarship + Epistemic Lock

Writing Guard compares before/after AI revision and protects:

- Numbers, percentages, p-values, confidence intervals, units
- `\cite` / `\ref`, Figure/Table numbers, DOIs
- Causal and evidential force: `associated with` must not silently become `caused`
- Negation / null findings: `no significant difference` must not disappear or flip
- Scope boundaries and evidence status: “observed / reported” must not become direct claims

Each finding is tagged `INVARIANT / VIOLATION / CANDIDATE / ADVISORY` and an integrity regression report is produced.

## JOURNAL — target-journal calibration

Writing Guard builds a corpus-aware Journal Profile from multiple representative target-journal papers, each parsed independently.

It currently compares five signal groups:

- **Structure**: sentence length, paragraph length
- **Voice**: passive voice, first-person usage
- **Citations**: bibliographic citations, figure/table references
- **Scientific claims**: claim density, causal/evidential strength, hedging, scope, null findings
- **Rhetoric**: rhetorical move coverage, canonical order, section-bound transition fit

Journal Fit is reported per section, together with corpus size and confidence.

> **Scientific Integrity > Journal Fit**

Journal Fit uses grouped weights: Structure 20% / Voice 10% / Citations 15% / Epistemics 35% / Rhetoric 20%.

## Five DSH Tools

| Tool | Purpose |
|---|---|
| `writing_rules` | Returns the writing-discipline cheat sheet before writing |
| `writing_audit` | Main audit entry: checks STYLE issues, compares Scholarship / Epistemic invariants, and can load Style Profile / Journal Profile |
| `writing_style_profile` | Learns an author's style from previous papers and returns JSON for audit |
| `writing_journal_profile` | Distills a Journal Profile from target-journal papers and returns JSON for audit |
| `writing_delivery_audit` | DELIVERY layer: detects rejected alternatives, revision-process residue, and provenance leakage that lack factual support in the authoritative baseline (CAL detection) |

### writing_delivery_audit example

```js
auditDelivery({
  text: 'Remove Toast from the login form',
  surface: 'commit',
  baseline: 'export default function LoginForm() { return <div><Input /></div>; }',
  rejectedTerms: ['Toast'],
})
// → findings: [REJECTED_ALTERNATIVE_LEAKAGE, UNJUSTIFIED_NEGATIVE_REFERENCE]
// Toast was rejected and is absent from baseline → both fire
```

## Document-aware auditing

The same sentence can mean different things in different document types:

| profile | meaning | e.g. `as requested by the reviewer` |
|---|---|---|
| `manuscript` | paper body | 🔴 revision residue, flagged |
| `rebuttal` | point-by-point response | ✅ normal, not flagged |
| `cover_letter` | submission letter | 🔴 residue, flagged |
| `review` / `notes` / `unknown` | other | conservative handling |

`writing_audit` accepts a `profile` argument, or auto-detects it from the file path.

## Automatic / incremental audit

The plugin listens to `tools/post-execute`: when the agent writes/edits paper files (`.md` / `.tex` / `.txt`), it automatically audits and injects results into the next model request.

- Audit state is persisted per file; only **incremental** changes are injected (new / resolved / still present)
- No repeated injection when nothing changed
- Before/after text is captured automatically, so Scholarship Lock + Epistemic Lock run without manually passing `original`

## Full install

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

## Why not Humanizer / AI Detector?

| | Writing Guard | Humanizer | AI Detector |
|---|---|---|---|
| Rules before writing | ✅ | ❌ | ❌ |
| Checks while writing | ✅ | usually ❌ | ❌ |
| Auto-audits paper edits | ✅ | ❌ | ❌ |
| Full-text rewrite | ❌ | ✅ | ❌ |
| Explainable issue location | ✅ | partial | partial |
| Deterministic integrity checks | ✅ | usually no | varies |

> A humanizer fixes the text after it is written; Writing Guard guards it as you write.

## Security & Privacy

- Deterministic integrity checks run locally; semantic writing decisions are handled by the host model under the Writing Guard policy.
- The plugin only reads the paper files the agent is currently writing/editing and writes its incremental state under `~/.dsh/plugins/dsh-plugin-writing-guard/`.
- The plugin itself does not collect or upload paper content.
- See [SECURITY.md](SECURITY.md)

## Tests

```sh
npm test
```

390 deterministic TP / TN / boundary / regression tests covering:

- STYLE, Scholarship Lock, Epistemic Lock
- Claim alignment, local citation integrity
- Journal Profile, Journal Fit
- Rhetorical semantics (Chinese / medoid / transition)
- **DELIVERY (CAL detection)**: rejected alternative / process residue / baseline reality / provenance / defensive hedge / counterfactual pair / NFKC / stopwords / scientific TN / safety TN / real-migration TN

CI runs build + tests on every push / PR.

> Deterministic rules (regex + normalization) cannot cover every semantic paraphrase. DELIVERY-layer detection is limited to leakage patterns expressible via regular expressions; manual review remains necessary.

## FAQ

### Is this a DSH “remove AI flavor” plugin?

You can think of it that way, but Writing Guard is not a traditional humanizer. It detects common AI writing patterns during paper writing and revision instead of rewriting the whole text with another model.

### Does it support Chinese papers?

Yes. Rules cover both Chinese and English academic writing patterns, with language-aware density thresholds (CJK characters vs. English words).

### Does it support SCI / English academic writing?

Yes. `writing_audit` checks English manuscripts for revision residue, defensive writing, LLM-overused expressions, and common AI-style sentence patterns.

### What is the difference from academic-humanizer?

academic-humanizer focuses on rewriting existing text into a more natural style; Writing Guard focuses on continuous checking and prevention inside the DSH paper workflow. They can be used together.

## CHANGELOG

Full changelog and implementation details are in [CHANGELOG.md](CHANGELOG.md).

## License

MIT
