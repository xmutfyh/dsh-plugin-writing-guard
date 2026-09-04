# Writing Guard

[![CI](https://github.com/xmutfyh/dsh-plugin-writing-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/xmutfyh/dsh-plugin-writing-guard/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-plugin-writing-guard)](https://www.npmjs.com/package/dsh-plugin-writing-guard)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Scientific Writing & Document Integrity Guard for AI-assisted research

**Less explanation. More argument. Preserve the science.**

Writing Guard combines prompt-guided scientific prose discipline with deterministic integrity checks for AI-assisted research.
It protects your manuscript across five layers:

| Guard | Protects against | Risk |
|-------|------------------|------|
| **STYLE** | Argument economy | 防御性写作、过度解释、语义重复、模板腔 |
| **EVIDENCE** | Scientific drift | 数值、单位、引用、结论被改 |
| **JOURNAL** | Journal mismatch | scope/style/convention 不匹配 |
| **DELIVERY** | Context leakage | prompt、notes、workflow metadata 泄漏 |
| **DOCUMENT** 🆕 | Document corruption | Word 格式、公式、表格、OOXML 被破坏 |

**Prompt-guided writing · Deterministic integrity core · 390 Tests**

```
npm install dsh-plugin-writing-guard
```

> Writing Guard does not write your paper for you.
> It makes AI-assisted writing safer to ship.

---

## New in 2.0 — Argument Economy & Control-Plane Separation

Writing Guard 2.0 moves semantic style decisions **before generation** and keeps deterministic code focused on integrity.

- **Critique is not content** — reviewer/user/guard wording is control context, not manuscript evidence.
- **Prefer CUT over REWRITE** — if a sentence only prevents criticism, reassures reviewers, advertises importance, or repeats an obvious implication, delete it.
- **Do not close every semantic loop** — stop after evidence + necessary interpretation; keep non-obvious statistical interpretation and reproducibility detail.
- **Style-only revisions default to same length or shorter** — no explanatory inflation without new supported content.
- **Auto-audit no longer reinjects snippets or rewrite suggestions** — only structured rule/action metadata is sent back to the agent.
- New English/Chinese cues for defensive-purpose framing, semantic-closure markers, and content-free evaluation.

Example:

```text
Avoid:  To prevent data leakage, normalization was carefully performed using only the training data.
Prefer: Normalization parameters were estimated from the training data.
```

The second sentence states the method fact without importing the defensive reason for mentioning it.

---

## 🛡️ Word Document Guard (introduced in 1.8)

**Change what was requested. Verify what wasn't.**

AI-assisted document editing introduces a subtle risk: the requested text may improve while unrelated parts of the manuscript silently change.

When you ask an AI agent to "rewrite paragraph 3 only," it may inadvertently modify:

- equation structures
- table borders
- numbering
- styles
- section geometry
- relationships
- embedded media
- OOXML package parts

Writing Guard 1.8 introduces a **document-integrity layer** for Word manuscripts:

| Feature | What it does |
|---------|--------------|
| **Safe scoped editing** | Only the specified range can change |
| **Package validation** | Verifies DOCX/OOXML package integrity after editing |
| **Structural fingerprinting** | Compares document structure before and after |
| **Equation integrity** | Checks equation structure, numbering continuity, math-font drift |
| **Scholarly table awareness** | Distinguishes data tables from layout/figure containers |
| **Pre/post integrity verification** | Deterministic verification, not "I think it's fine" |

### Before / After

**Without Writing Guard:**
```
"Please improve the wording in paragraph 3."
→ AI agent modifies DOCX.
→ Result: paragraph looks better.
→ Unknown: what else changed?
```

**With Writing Guard:**
```
"Please improve the wording in paragraph 3."
→ Writing Guard:
   ✓ scope validated
   ✓ package valid
   ✓ equations preserved
   ✓ protected structures unchanged
   ✓ document fingerprint checked
→ Result: paragraph changed — and unintended document drift is detected.
```

---

## Quick Start

```sh
# Install
dsh plugin add dsh-plugin-writing-guard

# Restart
dsh web
```

### Natural Language Usage

Once installed, you can use natural language:

| Say this | Writing Guard does this |
|----------|------------------------|
| "帮我检查论文写作质量" | `writing_word_audit` |
| "把表格改成三线表" | `writing_word_format_tables` |
| "扫描DOCX结构" | `writing_word_scan` |
| "修改第三章的XXX" | `writing_word_edit` |
| "编辑后验证范围" | `writing_word_scope_check` |
| "检查有没有AI味" | `writing_audit` |

---

## Five Guards — Detailed

### STYLE — Argument Economy & Prose Discipline

Guides the host model before writing, then uses deterministic cues to audit mechanical, defensive, and over-explained prose:

- Revision residue: `revised`, `as requested`, `本轮`, `审稿人要求`
- Defensive writing: concession stacking, limitation pre-emption
- Mechanical rhetoric: `不是X而是Y`, `rather than` abuse, triple parallelism
- LLM high-frequency words: `delve` / `tapestry` / `testament` (density-based)
- Chinese patterns and average sentence length anomalies

### EVIDENCE — Scholarship + Epistemic Lock

Protects scientific facts during AI editing:

- Numbers, percentages, p-values, confidence intervals, units
- Citations, Figure/Table numbers, DOI
- Causal strength: `associated with` cannot become `caused`
- Null findings: `no significant difference` cannot disappear
- Scope boundaries and evidence status

### JOURNAL — Target Journal Fit

Calibrates manuscript against target journal conventions:

- Syntax structure (sentence length, paragraph length)
- Voice and person (passive voice, first-person usage)
- Citations (bibliographic, figure/table references)
- Scientific claims (claim density, causal/evidential strength)
- Rhetorical moves (coverage, canonical order)

### DELIVERY — Context Leakage Detection

Stops workflow context from leaking into final artifacts:

- Rejected alternatives
- Revision process residue
- Provenance leakage
- Defensive hedge leakage

### DOCUMENT — Word Document Integrity 🆕

Safely edit Word manuscripts without breaking structure:

```
writing_word_scan → writing_word_edit → writing_word_scope_check
```

**13 tools** for complete document integrity:

| Tool | Purpose |
|------|---------|
| `writing_word_scan` | Structural scan |
| `writing_word_edit` | Safe scoped editing |
| `writing_word_audit` | Writing audit for .docx |
| `writing_word_scope_check` | Scope integrity verification |
| `writing_word_format_tables` | Three-line table formatting |
| `writing_word_audit_equations` | OMML equation audit |
| `writing_word_package_validate` | OOXML package validation |
| `writing_word_fingerprint` | Baseline formatting fingerprint |
| `writing_audit` | Text writing audit |
| `writing_rules` | Writing guidelines |
| `writing_style_profile` | Author style profile |
| `writing_journal_profile` | Journal profile |
| `writing_delivery_audit` | Delivery integrity audit |

---

## Installation

```sh
# From npm (recommended)
dsh plugin add dsh-plugin-writing-guard

# From GitHub
dsh plugin add github:xmutfyh/dsh-plugin-writing-guard

# From local source
dsh plugin add ./path/to/dsh-plugin-writing-guard
```

**Prerequisites:**
- Node.js ≥ 18
- Python 3.10+ with `python-docx` (`pip install python-docx`)

---

## Architecture

```
Writing Guard
├── STYLE (writing_audit)
│   ├── Revision residue detection
│   ├── AI style patterns
│   └── Density-based thresholds
├── EVIDENCE (Scholarship/Epistemic Lock)
│   ├── Number/unit preservation
│   ├── Citation integrity
│   └── Claim strength conservation
├── JOURNAL (Journal Profile)
│   ├── Corpus-aware analysis
│   ├── Section-level comparison
│   └── Rhetorical move matching
├── DELIVERY (CAL Detection)
│   ├── Rejected alternative leakage
│   ├── Process residue
│   └── Baseline reality check
└── DOCUMENT (Word Guard) 🆕
    ├── Structural scanning
    ├── Safe editing
    ├── Package validation
    ├── Fingerprinting
    └── Equation audit
```

**Design principle:** Baseline manuscript > journal/template > plugin defaults.

The LLM/agent decides *what* should change. Deterministic Word code decides *how* to make that change without silently altering unrelated formatting.

---

## Tests

```sh
npm test
```

390 deterministic tests covering:
- STYLE, Scholarship Lock, Epistemic Lock
- Claim alignment, local citation integrity
- Journal Profile, Journal Fit
- DELIVERY (CAL detection)
- **Word Guard** (v1.8.2): OOXML validation, fingerprinting, equation audit

---

## Security & Privacy

- Deterministic integrity checks run locally; semantic writing decisions are handled by the host model under the Writing Guard policy.
- The plugin only reads files being edited.
- The plugin itself does not upload or collect manuscript content.
- See [SECURITY.md](SECURITY.md)

---

## Why Writing Guard?

| | Writing Guard | Humanizer | AI Detector |
|---|---|---|---|
| Pre-writing rules | ✅ | ❌ | ❌ |
| During-writing checks | ✅ | Usually ❌ | ❌ |
| Auto-monitor manuscript | ✅ | ❌ | ❌ |
| Full rewrite | ❌ | ✅ | ❌ |
| Explainable issues | ✅ | Partial | Partial |
| Deterministic integrity checks | ✅ | Usually no | Depends |

> Humanizer rewrites after writing. Writing Guard prevents during writing.

---

## Brand

```
                  WRITING GUARD
                       │
       Scientific Writing & Document Integrity
                       │
 ┌─────────┬──────────┬─────────┬──────────┬──────────┐
 STYLE   EVIDENCE   JOURNAL   DELIVERY   DOCUMENT
                                            │
                               Change what was requested.
                               Verify what wasn't.
```

**Classic slogan:** Less AI. More Evidence. Better Journal Fit. Clean Delivery.

**Document slogan:** Change what was requested. Verify what wasn't.

---

## CHANGELOG

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT
