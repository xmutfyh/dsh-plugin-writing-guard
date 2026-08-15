# dsh-plugin-writing-guard

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

**A deterministic academic-writing linter for DeepSeek Harness (DSH).**

Keeps your academic writing clean: it scans manuscripts for **revision-process
residue**, **claim-calibration issues**, **rhetorical patterns**, **LLM-associated
vocabulary**, and **formatting tells** — with **document-type awareness** and
**density-based thresholds**. Auto-audits every paper file you write. Zero network,
zero LLM cost (pure local regex/statistics).

> Not an "AI detector" — a linter that knows what document it is checking and can
> explain why it flags something.

## Install

```sh
# from GitHub (lib/ is committed — no build step needed)
dsh plugin --profile web add github:xmutfyh/dsh-plugin-writing-guard

# or from the GitHub tarball directly
dsh plugin --profile web add https://github.com/xmutfyh/dsh-plugin-writing-guard/archive/refs/heads/master.tar.gz

# restart to load
dsh web
```

Repo: <https://github.com/xmutfyh/dsh-plugin-writing-guard>

## Document profiles (v0.3)

The same phrase means different things in different documents. Rules are scoped
by document type:

| profile | meaning | e.g. "as requested by the reviewer" |
|---|---|---|
| `manuscript` | paper body | 🔴 revision residue — flagged |
| `rebuttal` | response letter | ✅ normal — not flagged |
| `cover_letter` | submission letter | 🔴 residue — flagged |
| `review` / `notes` / `unknown` | other | conservative |

Pass `profile` to `writing_audit`, or it is auto-detected from the file path.

## What it catches

| Category | Typical issues |
|---|---|
| Process residue | "revised model", "as requested", "we have updated", CN "本轮/投稿前" |
| Claim calibration | "we do not claim", CN "本文并非要证明", self-deprecation; legitimate limitations statements are NOT flagged (ICMJE requires them) |
| Rhetorical patterns | "not X but Y", "rather than" abuse, absolutist definitions, rule of three |
| LLM-associated words | delve / tapestry / testament / leverage / harness… (density rule — a single occurrence is fine) |
| Academic style | "we believe/think", hedges, abstract adverbs; "significantly" only prompts review of non-statistical uses |
| Formatting | em-dash density (range en-dashes excluded), colon-title abuse |

## Density thresholds (v0.3.3)

Frequency rules use **per-1,000 language units**: English rules use the English
word count, Chinese rules use CJK char count (bilingual files do not dilute each
other), with a **double gate**: `count >= minCount AND count/denominator*1000 >= perK`.
E.g. rather than: ≥4 and ≥1.0/1k; em-dash: ≥5 and ≥0.5/1k; LLM words: ≥2 and
≥0.4/1k; Chinese connectives: ≥8 and ≥2.0/1k chars. A 500-word abstract and a
12,000-word full paper no longer share one absolute threshold.

## Preprocessing (v0.3.3, on by default)

Before auditing, non-prose content is stripped: YAML frontmatter, code fences,
inline code, LaTeX inline/block math, Markdown links (anchor text kept), bare
URLs, LaTeX commands; the References/Bibliography section is cut (`# References`,
`References:`, `\section{References}`, `\begin{thebibliography}` all supported).
Rules scan prose only — references/code/math/URLs never enter hits or density
denominators.

## Confidence & evidence (v0.3)

Every rule carries `confidence` (high/medium/low) and `evidence`
(literature/style-guide/heuristic/project-specific). Reports show
`🔴 HIGH · conf high`, so you know which flags are deterministic rules
(e.g. revision residue) and which are probabilistic signals (e.g. LLM-word density).

## Tools

| Tool | Purpose |
|---|---|
| `writing_audit` | Scan text or file; args: text/filePath, profile, verbose; returns severity+confidence sorted issues and full-text statistics |
| `writing_rules` | Return the discipline quick-reference (profiles + density) before drafting |

## Auto audit (on by default)

Listens on `tools/post-execute`: after `write`/`edit` touches a paper-like file
(.md/.tex/.txt under manuscript/paper/revision/response/论文/修订/返修… or KB dirs),
it runs the audit automatically (profile auto-detected) and injects high-severity
findings as `additionalContexts` for the model's next request.

Configure in `cordis.patch.yml`:

```yaml
- id: dsh-plugin-writing-guard
  config:
    autoAuditOnWrite: true
    autoAuditMinSeverity: high
    maxAutoInjectPerTurn: 2
    verboseByDefault: false
    autoBrief: false
    projectResidueTerms: []   # project-internal terms appended to defaults
```

## Tests

```sh
npm test   # builds first, then 50 TP/TN/edge cases, no framework needed
```

## Development

```sh
pnpm install && pnpm build   # TypeScript -> lib/
# rule engine: src/rules.ts (zero dependencies, regex + statistics)
```

## License

MIT
