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

## 当前仓库状态（v2.0.0）

- 写作架构：Prompt-first Argument Economy + deterministic integrity checks。
- 核心文风约束：Critique is not content；Prefer CUT over REWRITE；Do not close every semantic loop；style-only revision 默认不扩写。
- auto-audit 使用结构化 control metadata，不再把 finding suggestion / snippet 作为正文素材回灌。
- 新增 defensive-purpose、semantic-closure、content-free-evaluation 中英文规则与 EditAction。
- Scholarship Lock / Epistemic Lock / Journal Engine / DELIVERY / Word Guard 保持为高优先级确定性保护。
- 测试：npm test = 390 通过 / 0 失败（真实语料 smoke test 在本地语料缺失时自动 SKIP）。
- 下一步候选：
  1. 更系统的 semantic over-explanation benchmark
  2. style-only expansion / contraction 统计与 corpus evaluation
  3. Journal Fingerprint 可视化
  4. LaTeX Project-aware Audit（跨文件 \input / \include / .bib 图）
  5. WritingGuardBench 公开 benchmark

## 安全注意

- `scripts/codex-task.sh` 使用 `--dangerously-bypass-approvals-and-sandbox`，
  只应在可信仓库/可信任务中使用。
- 涉及删除文件、覆盖配置、发布 npm 包等高风险操作，请先人工 review。
