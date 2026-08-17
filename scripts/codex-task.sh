#!/usr/bin/env bash
# codex-task.sh — 把后续任务交给 Codex CLI 非交互执行（省钱模式）
#
# 用法：
#   ./scripts/codex-task.sh "请继续实现 Journal Engine 的 Rhetorical Move 分析"
#   ./scripts/codex-task.sh task-prompt.md
#
# 说明：
# - 默认在仓库根目录执行，工作目录为脚本所在仓库。
# - 使用 Codex 的 custom provider（你 ~/.codex/config.toml 已配置）。
# - 非交互模式：codex exec + --dangerously-bypass-approvals-and-sandbox。
#   这会让 Codex 直接改文件/跑命令；请只在可信仓库/可信任务中使用。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ "$#" -eq 0 ]; then
  echo "用法: $0 <任务描述或 prompt 文件路径>" >&2
  exit 1
fi

if [ -f "$1" ]; then
  PROMPT="$(cat "$1")"
else
  PROMPT="$*"
fi

echo ">> Codex 工作目录: $REPO_ROOT"
echo ">> 任务: ${PROMPT:0:120}..."
echo ">> 正在调用 codex exec ..."

# --output-last-message 把最终回复写到 .codex-last-message.md，方便查看
codex exec \
  --dangerously-bypass-approvals-and-sandbox \
  --skip-git-repo-check \
  --output-last-message "$REPO_ROOT/.codex-last-message.md" \
  "$PROMPT"

echo ">> Codex 执行完成，最终回复已写入 .codex-last-message.md"
