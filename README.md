# dsh-plugin-writing-guard

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

DSH（DeepSeek Harness）宿主插件：**确定性学术写作 linter（deterministic academic-writing linter）**。
把「写作纪律」做成常驻工具，任何会话、任何论文在写作或修改前后都能一键扫描（也可全自动触发），
避免审稿人一眼看穿的 AI 写作痕迹、防御性写作和修改过程语句残留。

> 定位：不是 "AI 检测器"，而是一个知道自己在检查什么文档、能解释"为什么报"的写作 linter。
> 所有规则为本地正则/统计，零网络、零 LLM 调用，毫秒级返回。

## 安装

```sh
# 从 GitHub 安装（lib/ 已提交，无需构建）
dsh plugin --profile web add github:xmutfyh/dsh-plugin-writing-guard

# 或直接从 GitHub tarball 安装
dsh plugin --profile web add https://github.com/xmutfyh/dsh-plugin-writing-guard/archive/refs/heads/master.tar.gz

# 或从本地源码目录安装
dsh plugin --profile web add C:/Users/fyh/Downloads/dsh-plugins-src/dsh-plugin-writing-guard

# 重启生效
dsh web
```

仓库：https://github.com/xmutfyh/dsh-plugin-writing-guard

## 文档类型感知（document profiles，v0.3）

同一段文字在不同文档里含义不同。插件按文档类型应用规则：

| profile | 说明 | 例：`as requested by the reviewer` |
|---|---|---|
| `manuscript` | 论文正文 | 🔴 修改过程残留，报警 |
| `rebuttal` | 逐条回复信 | ✅ 正常表述，不报警 |
| `cover_letter` | 投稿信 | 🔴 残留，报警 |
| `review` / `notes` / `unknown` | 其他 | 保守处理 |

`writing_audit` 可通过 `profile` 参数指定，或从文件路径自动检测（rebuttal/cover_letter/manuscript 关键词）。

## 解决的问题

基于审稿人分享的 AI 写作识别清单（破折号铺天盖地、"它不是X而是Y"、绝对化定义、冒号滥用）
与"扬长避短/发布会原则"提示词，以及网络研究（Kobak et al., Science Advances 2025，>1500 万
biomedical abstracts 词频统计；社区词表 delve/tapestry/testament/leverage 等），自动检测：

| 类别 | 典型问题 |
|---|---|
| 修改过程残留 | "revised model"、"as requested"、"we have updated"、"本轮/投稿前/审稿人要求" |
| 主张校准 | "we do not claim"、"本文并非要证明"、自我削弱词；研究局限性正当陈述不报警（ICMJE 要求） |
| 修辞模式 | "不是X而是Y"/"not X but Y"、rather than 滥用、绝对化定义、三连排比 |
| LLM 关联词 | delve/tapestry/testament/leverage/harness 等（密度规则，单次出现不报警） |
| 学术文体 | we believe/think、模糊词、抽象副词；"significantly" 仅提示复核统计语境 |
| 格式 | 破折号密度（范围连字符不算）、冒号标题 |

## 密度阈值（v0.3.3）

频率规则采用 **每千语言单位** 密度：英文规则按英文词数、中文规则按 CJK 字数（双语文件不互相稀释），
同时要求 minimum count 与 density **双门槛**：`count >= minCount AND count/denominator*1000 >= perK` 才报警。
例如 rather than：≥4 次且 ≥1.0/千词；破折号：≥5 次且 ≥0.5/千词；LLM 高频词：≥2 次且 ≥0.4/千词；
中文套话：≥8 次且 ≥2.0/千字。500 字摘要和 12000 字全文不再用同一阈值。

## preprocessing（v0.4 segment pipeline，默认开启）

文档先被切分为**带类型的 segment**（prose/heading/reference/code/math/table），每条规则声明自己扫描的类型：
- LLM 词表、修订残留等 → `prose`
- 冒号标题 → `heading`（正文里的冒号句不算）
- References/code/math/table → 默认忽略

同时支持 **section detection**（Introduction/Methods/Results/Discussion/Conclusion…）：
`limitation-dispersal` 从"词频"升级为"跨章节分散"——同一局限散落在 ≥3 个章节才提示，
仅在 Discussion 正当陈述（ICMJE 要求）不报警。

## confidence / evidence（v0.3）

每条规则带 `confidence`（high/medium/low）与 `evidence`（literature/style-guide/heuristic/project-specific）。
报告显示 `🔴 HIGH · conf high`，用户知道哪些是确定性规则（如 revised 残留）、哪些是概率信号
（如 LLM 高频词密度）。

## 工具

| 工具 | 用途 |
|---|---|
| `writing_audit` | 扫描文本/文件；参数：text/filePath、profile、verbose；返回按严重度+置信度排序的问题清单与全文统计 |
| `writing_rules` | 返回写作纪律速查（含 profile 与密度说明） |

## 自动审计（默认开启，v0.5 增量模式）

插件监听 `tools/post-execute`：`write`/`edit` 写入**论文类文件**（.md/.tex/.txt，路径含
manuscript/paper/revision/response/论文/修订/返修…，或位于 01_manuscript/ 等知识库目录）时
自动审计（自动检测文档 profile），结果经 `additionalContexts` 注入模型下一条请求。

**v0.5 incremental lint**：审计状态按文件持久化（`~/.dsh/plugins/dsh-plugin-writing-guard/state.json`），
每次写入只注入**增量**：

```text
新增 1 项 / 已解决 4 项 / 仍存在 8 项
```

- 无变化 → 不注入（不再把同样的问题反复灌给 agent）
- 只有已解决 → 不即时提示（等下次新增时一起汇总；全部清零时单独确认一次）
- 只列出**新增项**详情 + 建议；完整清单仍可用 `writing_audit` 手动获取

配置（web profile `cordis.patch.yml`）：

```yaml
- id: dsh-plugin-writing-guard
  config:
    autoAuditOnWrite: true          # 论文文件写入后自动审计（默认 true）
    mode: conservative              # conservative|balanced|strict（覆盖 minSeverity，默认 conservative=high）
    autoAuditMinSeverity: high      # high|medium|low（显式设置优先于 mode）
    maxAutoInjectPerTurn: 2         # 每轮最多自动注入次数
    verboseByDefault: false
    autoBrief: false
    projectResidueTerms: []         # 项目内部词表（追加到默认词表，命中按 medium 报）
    # stateFile 缺省即可（~/.dsh/plugins/dsh-plugin-writing-guard/state.json）；勿配空串 ''
```

## 测试

```sh
npm test   # 自动先 build 再跑 68 项 TP/TN/边界用例（无测试框架依赖）
```

## 开发

```sh
pnpm install && pnpm build   # TypeScript -> lib/
# 规则引擎：src/rules.ts（零依赖，纯正则+统计）
```

## License

MIT
