# DSH Writing Guard

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)
[![CI](https://github.com/xmutfyh/dsh-plugin-writing-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/xmutfyh/dsh-plugin-writing-guard/actions/workflows/ci.yml)

**去 AI 腔 · 守住证据 · 写向目标期刊**

Writing Guard 是面向 DeepSeek Harness 的科研论文写作守卫：
减少机械化、模板化和防御性的 AI 写作，
保护 AI 润色前后的科研事实与 scientific commitments，
并根据目标期刊代表论文校准 manuscript 的写作分布。

> **Less AI. More Evidence. Better Journal Fit.**
>
> Language can change. Evidence cannot.

**Local · Deterministic · Zero Network · Zero LLM**

---

## STYLE / EVIDENCE / JOURNAL 三大支柱

1. **去 AI 腔 / STYLE**
   识别并减少机械化、模板化、过度防御的 AI 写作，包括 revision residue、defensive writing、空洞热词与结构化套话。不是隐藏 AI，而是消除 AI 带来的坏写作。
   > AI 越强，越会写“正确但没必要”的句子。

2. **守住证据 / EVIDENCE**
   数字、p 值、引用与 DOI 不能在润色中无声漂移；null finding 不能消失，correlation 不能变 causation，scope 和 evidence status 不能被悄悄改变。语言可以改，证据不能改。

3. **写向目标期刊 / JOURNAL**
   从目标期刊代表论文中蒸馏 section-level 写作分布、科学主张模式与 rhetorical moves。不是只学“怎么措辞”，也比较目标期刊各章节通常“写什么、按什么顺序写”。

## Quick Start

```sh
dsh plugin --profile web add dsh-plugin-writing-guard
dsh web
```

npm 已发布。也支持 GitHub / 本地源码安装，见下方[完整安装说明](#完整安装说明)。

---

## How it works

```text
写作规则 → Agent revision → automatic guard → targeted revision
```

Writing Guard 不是写完全文后一次性 Humanize，而是在 DSH 论文工作流中持续工作：

- 写作前加载 `writing_rules`
- 写作 / 修改时由 `writing_audit` 自动检查
- 修改后自动对比前后版本，保护 Scholarship / Epistemic invariants

## STYLE — 去 AI 腔

检测范围：

- 修改过程残留：`revised`、`as requested`、`本轮`、`审稿人要求`
- 防御性写作：concession stacking、limitation pre-emption、generic value claim、unnecessary epistemic retreat
- 机械化修辞：`不是X而是Y`、`rather than` 滥用、三连排比、破折号 / 冒号滥用
- LLM 高频词：`delve` / `tapestry` / `testament` / `leverage` 等（密度规则，单次不报警）
- 中文套话与“的”字链、平均句长异常等

密度阈值按语言独立计算：英文按词数、中文按 CJK 字数，双门槛避免误伤术语。

## EVIDENCE — Scholarship + Epistemic Lock

Writing Guard 在 AI 润色前后对比并保护：

- 数字、百分数、p 值、置信区间、单位
- `\cite` / `\ref`、Figure/Table 编号、DOI
- 因果力与证据力：`associated with` 不能被悄悄改成 `caused`
- 否定 / 零结果：`no significant difference` 不能消失或翻转
- scope 边界与 evidence status：不能从“观察到 / 报告”被改成直接声称

每个问题带 `findingKind`：`INVARIANT / VIOLATION / CANDIDATE / ADVISORY`，并输出完整性回归报告。

## JOURNAL — 面向目标期刊写作

Writing Guard 从多篇目标期刊代表论文中按文章独立统计，生成 corpus-aware Journal Profile。

当前比较五类信号：

- **句法结构**：句长、段长等
- **语态与人称**：passive voice、first-person usage
- **引用**：bibliographic citations、figure/table references
- **科学主张**：claim density、causal/evidential strength、hedging、scope、null findings
- **修辞结构**：rhetorical move coverage、canonical order、section-bound transition fit

Journal Fit 按章节输出，并同时报告 corpus size 与 confidence。

> **Scientific Integrity > Journal Fit**

Journal Fit 采用五组权重：句法结构 20% / 语态人称 10% / 引用 15% / 科学主张 35% / 修辞结构 20%。

## 四个 DSH Tools

| 工具 | 用途 |
|---|---|
| `writing_rules` | 返回写作纪律速查，写作前加载 |
| `writing_audit` | 主审计入口：检查 STYLE 问题，比较 revision 前后的 Scholarship / Epistemic invariants，并可加载 Style Profile 与 Journal Profile |
| `writing_style_profile` | 从作者历史论文学习风格指标，输出 JSON 供 audit 使用 |
| `writing_journal_profile` | 从目标期刊代表论文蒸馏 Journal Profile，输出 JSON 供 audit 使用 |

## Document-aware auditing

同一段文字在不同文档里含义不同。插件按文档类型应用规则：

| profile | 说明 | 例：`as requested by the reviewer` |
|---|---|---|
| `manuscript` | 论文正文 | 🔴 修改过程残留，报警 |
| `rebuttal` | 逐条回复信 | ✅ 正常表述，不报警 |
| `cover_letter` | 投稿信 | 🔴 残留，报警 |
| `review` / `notes` / `unknown` | 其他 | 保守处理 |

`writing_audit` 可通过 `profile` 参数指定，或从文件路径自动检测（rebuttal/cover_letter/manuscript 关键词）。

## Automatic / incremental audit

插件监听 `tools/post-execute`：`write` / `edit` 写入论文类文件（`.md` / `.tex` / `.txt`）时自动审计，结果注入模型下一条请求。

- 按文件持久化审计状态，每次只注入**增量**（新增 / 已解决 / 仍存在）
- 无变化 → 不重复注入
- 自动捕获修改前文本，直接运行 Scholarship Lock + Epistemic Lock

## 完整安装说明

```sh
# 从 npm 安装（已发布，推荐）
dsh plugin --profile web add dsh-plugin-writing-guard

# 从 GitHub 安装（lib/ 已提交，无需构建）
dsh plugin --profile web add github:xmutfyh/dsh-plugin-writing-guard

# 或从 GitHub tarball 安装
dsh plugin --profile web add https://github.com/xmutfyh/dsh-plugin-writing-guard/archive/refs/heads/master.tar.gz

# 或从本地源码目录安装
dsh plugin --profile web add ./path/to/dsh-plugin-writing-guard

# 重启生效
dsh web
```

仓库：https://github.com/xmutfyh/dsh-plugin-writing-guard

## Why not Humanizer / AI Detector?

| | Writing Guard | Humanizer | AI Detector |
|---|---|---|---|
| 写作前规则 | ✅ | ❌ | ❌ |
| 写作过程中检查 | ✅ | 通常 ❌ | ❌ |
| 自动监听论文修改 | ✅ | ❌ | ❌ |
| 整段重写 | ❌ | ✅ | ❌ |
| 风格问题定位（可解释） | ✅ | 部分 | 部分 |
| 本地规则检查（零网络零 LLM） | ✅ | 通常需 LLM | 视工具而定 |

> Humanizer 是写完再改，Writing Guard 是边写边防。

## Security & Privacy

- 所有规则**本地运行**：零网络、零 LLM、无子进程
- 插件只读取 Agent 正在写入的论文文件，并写入 `~/.dsh/plugins/dsh-plugin-writing-guard/` 下的增量状态
- 不收集、不上传论文内容
- 详见 [SECURITY.md](SECURITY.md)

## Tests

```sh
npm test
```

300+ 项确定性 TP / TN / boundary / regression 测试，覆盖：

- STYLE、Scholarship Lock、Epistemic Lock
- claim alignment、local citation integrity
- Journal Profile、Journal Fit
- Rhetorical semantics（中文 / medoid / transition）

CI 在每次 push / PR 自动执行 build + tests。

## FAQ

### 这是 DSH 的论文去 AI 味插件吗？

可以这样理解，但 Writing Guard 与传统 Humanizer 不同。它主要在论文写作和修改过程中检测常见 AI 写作风格，而不是将全文交给另一个模型进行重写。

### 支持中文论文吗？

支持。规则同时覆盖中文和英文论文中常见的机械化表达、模板化过渡、修改过程残留和防御性写作；中英文分别按 CJK 字数 / 英文词数独立计算密度阈值。

### 支持 SCI / English academic writing 吗？

支持。`writing_audit` 可检查英文 manuscript 中的 revision residue、defensive writing、LLM-overused expressions 以及常见 AI-style sentence patterns。

### Writing Guard 和 academic-humanizer 有什么区别？

academic-humanizer 更偏向对已有文本进行自然化编辑；Writing Guard 更偏向在 DSH 论文工作流中持续检查和预防。二者可以配合使用。

## CHANGELOG

完整版本演化、修复记录与测试增量见 [CHANGELOG.md](CHANGELOG.md)。

## License

MIT
