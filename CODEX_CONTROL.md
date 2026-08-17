# CODEX_CONTROL.md — 用 Codex 执行后续仓库任务

> 目标：把后续“改代码 / 跑测试 / 继续实现分析方案”的任务交给本机 Codex CLI 执行。
> 你的 `~/.codex/config.toml` 已配置 custom provider（nuoda.vip），API 成本更低。

## 快速使用

```bash
# 方式 1：直接传任务描述
./scripts/codex-task.sh "继续实现 Journal Engine 的 Rhetorical Move 分析，并补测试"

# 方式 2：从 prompt 文件读取任务
./scripts/codex-task.sh docs/task-prompt.md
```

执行后：
- Codex 会在仓库根目录直接改文件/跑命令。
- 最终回复会写到 `.codex-last-message.md`。
- 建议先 `git diff` 审查 Codex 的改动，再提交。

## 当前仓库状态（截至 v1.4.2）

- 已实现：
  - Journal Profile 蒸馏、`writing_journal_profile`、`writing_audit(journalProfile=...)`
  - Journal Fit section-level 报告、中文 Claim Anchor CJK bigram
  - **v1.4.1 Corpus-aware Journal Distillation**：`computeJournalProfileFromDocuments`、
    逐篇解析、canonical section 聚合、所有指标 Distribution、引用密度入 Fit、
    被动语态不规则过去分词增强
  - **v1.4.2 Journal Fit hardening**：CI-safe 真实语料测试、ratio 评分修复、
    文献/图表引用拆分、Journal Fit Confidence、canonical aliases 扩充
- 测试：`npm test` = 293 通过 / 0 失败（本地 ESR/source.md smoke test；CI 无语料时自动 SKIP）。
- 下一步候选（来自 `C:\Users\fyh\Desktop\分析.md`）：
  1. Epistemic Journal Fingerprint（复用 `extractClaimSpans`，输出 causal/evidence 等级分布）
  2. Rhetorical Move 分析（Introduction move 序列）
  3. Journal Fingerprint 可视化
  4. 自动 PDF 蒸馏（Profile Builder）
  5. 社区 Journal Profile 仓库
  6. LaTeX Project-aware Audit（跨文件 `\input` / `\include` / `.bib` 图）
  7. WritingGuardBench 公开 benchmark

## 安全注意

- `scripts/codex-task.sh` 使用 `--dangerously-bypass-approvals-and-sandbox`，
  只应在可信仓库/可信任务中使用。
- 涉及删除文件、覆盖配置、发布 npm 包等高风险操作，请先人工 review。
