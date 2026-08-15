# dsh-plugin-writing-guard

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

**AI paper-writing style guard for DeepSeek Harness (DSH).**

A host plugin that keeps your academic writing clean: it scans manuscripts for
**revision-process residue**, **defensive writing**, and **AI-writing tells**
— the patterns reviewers recognize as machine-generated text — and can audit
automatically every time you write a paper file. Works in any session, on any
paper, with zero network calls and zero LLM cost (pure local regex/statistics).

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

## What it catches

| Category | Typical issues |
|---|---|
| Revision residue | "revised model", "as requested", "we have updated", "本轮/投稿前/审稿人要求" (CN) |
| Defensive writing | "we do not claim", "本文并非要证明", "这并不意味着", "this study has certain limitations" |
| AI-style patterns | em-dash density ≥6, "不是X而是Y" / "not X but Y", "rather than" abuse, absolutist definitions, colon titles, abstract filler adverbs |
| LLM overused words | delve / tapestry / testament / leverage / harness / underscore / pivotal / meticulous / realm / foster / navigate / streamline / seamless / showcase / boast / unlock / elevate / intricate / nuanced / multifaceted / cutting-edge / state-of-the-art |
| LLM structural tells | moreover/furthermore/in conclusion stacking, rule of three ("clear, concise, and compelling"), Chinese AI connectives (值得注意的是/综上所述/随着…的发展) |
| Style issues | "we believe/think", hedge stacking (somewhat/quite/fairly) |

Rule sources: the reviewer-shared AI-writing tell list (em-dash abuse, contrast
formulas, absolutist definitions, colon abuse), the "launch-event" writing
principle (扬长避短), the ESR scoping-review guide, and published research on
LLM vocabulary spikes ([Kobak et al., Science Advances 2024](https://www.science.org/doi/full/10.1126/sciadv.adt3813), 14M PubMed abstracts) plus community word lists ([Metric37](https://metric37.com/blog/common-ai-words-and-phrases), [Diglot](https://diglot.ai/blog/chatgpt-words-to-avoid)).

> These are probabilistic tells, not proof — a single occurrence is fine;
> density is the signal. `synergy` (e.g. "thermodynamic synergy") is a
> legitimate scientific term and is intentionally NOT flagged.

## Tools

| Tool | Purpose |
|---|---|
| `writing_audit` | Scan text or a .txt/.md file; returns issues sorted by severity (🔴 high / 🟠 medium / 🟡 low) plus full-text statistics (em-dash count, rather-than count, not-X-but-Y, rule-of-three, LLM transition words, Chinese connectives…) |
| `writing_rules` | Return the writing-discipline quick reference before you start drafting |

## Auto audit (on by default)

The plugin listens on `tools/post-execute`: after `write`/`edit` touches a
**paper-like file** (`.md/.tex/.txt` whose path contains manuscript/paper/
revision/response/论文/修订/返修…, or that lives under paper dirs such as
`01_manuscript/`, `02_reviews/`, `08_response/`), it runs `writing_audit`
automatically and injects any high-severity findings as `additionalContexts`
for the model's next request — the agent fixes them without being asked.
Bounded to a few injections per turn to avoid noise.

Configure in your web profile's `cordis.patch.yml`:

```yaml
- id: dsh-plugin-writing-guard
  config:
    autoAuditOnWrite: true        # audit paper files after write/edit (default true)
    autoAuditMinSeverity: high    # high | medium | low
    maxAutoInjectPerTurn: 2       # injection budget per turn
    verboseByDefault: false       # include per-hit suggestions by default
    autoBrief: false              # inject the discipline brief every turn
```

## Usage

After writing/editing a passage or full text (manual):

```
Run writing_audit on the passage I just revised, verbose=true
```

Before drafting:

```
Call writing_rules to load the writing discipline, then draft accordingly
```

With auto audit on, no call is needed — the plugin checks paper files for you.

`.docx`/`.pdf` files: convert with the `anydoc` tool first, then run
`writing_audit` on the Markdown.

## Development

```sh
pnpm install && pnpm build   # TypeScript -> lib/
# rules engine: src/rules.ts (zero dependencies, pure regex + statistics)
```

## License

MIT
