# dsh-plugin-writing-guard

DSH（DeepSeek Harness）宿主插件：**AI 论文写作常见错误守卫**。把「写作纪律」做成常驻工具，
任何会话、任何论文在写作或修改前后都能一键扫描（也可全自动触发），避免审稿人一眼看穿的
AI 写作痕迹、防御性写作和修改过程语句残留。

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

## 解决的问题

基于审稿人分享的 AI 写作识别清单（破折号铺天盖地、"它不是X而是Y"、绝对化定义、冒号滥用）
与"扬长避短/发布会原则"提示词，以及网络研究（Kobak et al., Science Advances 2024 统计
1400 万摘要的 LLM 高频词；社区词表 delve/tapestry/testament/leverage 等），自动检测：

| 类别 | 典型问题 |
|---|---|
| 修改过程残留 | "revised model"、"as requested"、"we have updated"、"本轮/投稿前/审稿人要求" |
| 防御性写作 | "we do not claim"、"本文并非要证明"、"这并不意味着"、"本研究存在一定局限性" |
| AI 痕迹句式 | 破折号 ≥6、"不是X而是Y"/"not X but Y"、"rather than" 滥用、绝对化定义、冒号标题、抽象副词 |
| LLM 高频词 | delve/tapestry/testament/leverage/harness/underscore/pivotal/meticulous 等 |
| LLM 结构痕迹 | moreover/furthermore/in conclusion 过渡词堆叠、三连排比（X, Y, and Z）、中文套话（值得注意的是/综上所述） |
| 文体问题 | "we believe/think"、模糊程度词堆叠 |

规则来源：`09_wiki/writing/写作纪律_防AI痕迹与防御性写作.md` + 网络 LLM 风格分析
（[Science Advances](https://www.science.org/doi/full/10.1126/sciadv.adt3813)、
[Metric37](https://metric37.com/blog/common-ai-words-and-phrases)、
[Diglot](https://diglot.ai/blog/chatgpt-words-to-avoid)），全部为本地正则/统计，
零网络、零 LLM 调用，毫秒级返回。

## 工具

| 工具 | 用途 |
|---|---|
| `writing_audit` | 输入文本或 .txt/.md 文件，返回按严重度（🔴高/🟠中/🟡低）排序的违规清单 + 全文统计 |
| `writing_rules` | 返回写作纪律速查清单，写作前加载纪律用 |

## 自动审计（默认开启）

插件监听 `tools/post-execute`：当 `write`/`edit` 工具写入**论文类文件**时自动执行
`writing_audit`，发现高危问题（如 "revised" 残留、防御性声明）后把审计结果作为
`additionalContexts` 注入模型下一条请求，**无需手动调用**，agent 下一轮会自动修正。

- 论文文件识别：`.md/.tex/.txt` 且路径含论文特征（manuscript/paper/revision/response/论文/修订/返修…）
  或位于论文目录（`01_manuscript/`、`02_reviews/`、`08_response/` 等知识库布局）
- 配置项（web profile `cordis.patch.yml`）：

```yaml
- id: dsh-plugin-writing-guard
  config:
    autoAuditOnWrite: true        # 论文文件写入后自动审计（默认 true）
    autoAuditMinSeverity: high    # 自动审计最低严重度：high|medium|low
    maxAutoInjectPerTurn: 2       # 每轮最多自动注入次数（防刷屏）
    verboseByDefault: false       # audit 是否默认输出每条建议
    autoBrief: false              # 每轮是否自动注入纪律速查
```

## 使用

写作或修改完一段/全文后（手动）：

```
请对刚刚修改的段落执行 writing_audit，verbose=true
```

开始写作前（手动）：

```
调用 writing_rules 获取写作纪律，然后按纪律起草
```

自动模式下无需任何调用：插件会在论文文件被写入后自动检查并提示。

`.docx/.pdf` 请先用 `anydoc` 工具转为 Markdown，再执行 `writing_audit`。
