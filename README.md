# DSH Writing Guard

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)
[![CI](https://github.com/xmutfyh/dsh-plugin-writing-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/xmutfyh/dsh-plugin-writing-guard/actions/workflows/ci.yml)

> DeepSeek Harness (DSH) 论文写作守卫：在论文撰写和修改过程中自动检查常见 AI 写作风格、
> 修改残留、防御性表达与机械化句式，并在润色时保护科研事实与科学主张完整性
> （Scholarship Lock + Epistemic Lock——数字、引用、主张强度、否定/零结果、scope 边界都不许被语言修改悄悄改变）。

**适用于：中文论文、英文论文、SCI manuscript、毕业论文、学术写作与论文润色。**

如果你正在寻找：

- DSH 论文去 AI 味插件
- DeepSeek Harness 学术写作插件
- AI writing style checker for academic papers
- academic writing guard / manuscript proofreading
- 论文 AI 痕迹检查
- SCI 写作 AI 味检查

这个插件的定位不是在论文写完之后进行一次"大规模 Humanize"，而是：

**写作前提供规则 → 写作过程中自动守卫 → 修改后自动审计。**

它提供四个 DSH 原生工具：

- `writing_rules`：写作前加载学术写作纪律
- `writing_audit`：检查论文中的 AI-style patterns、revision residue、defensive writing、LLM 高频表达及结构化写作痕迹；v0.6 起支持 Scholarship Lock（传 `original` 对比润色前后科研事实）与作者风格档案（`styleProfile`）；v1.4 起支持 Journal Profile（`journalProfile`）做目标期刊写作契合度；v0.8 起自动路径直接启用双锁（见下）
- `writing_style_profile`：从作者历史论文统计写作风格指标（句长/密度），零 LLM
- `writing_journal_profile`：从目标期刊代表论文蒸馏写作分布（Journal Profile），零 LLM

并支持在 `.md` / `.tex` / `.txt` 论文文件被 `write` / `edit` 修改后自动执行审计（v0.5 增量模式），
将高风险问题反馈给 Agent。**v0.8 起自动审计自动捕获修改前的文本**（`tools/pre-execute` 快照 +
持久化基线缓存），每次写入后直接运行 Scholarship Lock + Epistemic Lock——不需要手动传 `original`。

> 定位：不是 "AI 检测器"，而是一个知道自己在检查什么文档、能解释"为什么报"的写作 linter。
> 所有规则为本地正则/统计，零网络、零 LLM 调用，毫秒级返回。

## Why Writing Guard instead of a Humanizer?

| | Writing Guard | Humanizer | AI Detector |
|---|---|---|---|
| 写作前规则 | ✅ | ❌ | ❌ |
| 写作过程中检查 | ✅ | 通常 ❌ | ❌ |
| 自动监听论文修改 | ✅ | ❌ | ❌ |
| 整段重写 | ❌ | ✅ | ❌ |
| 风格问题定位（可解释） | ✅ | 部分 | 部分 |
| revision residue 检测 | ✅ | 不一定 | ❌ |
| defensive writing 检测 | ✅ | 不一定 | ❌ |
| 本地规则检查（零网络零 LLM） | ✅ | 通常需 LLM | 视工具而定 |

> Writing Guard is complementary to Humanizers, not a replacement for them.
>
> 大多数 Humanizer 的工作流是：AI draft → rewrite → humanized version
> Writing Guard 的工作流是：rules → writing → automatic audit → targeted revision
>
> **Humanizer 是写完再改，Writing Guard 是边写边防。**

## 去 AI 味（说明边界）

"去 AI 味"在本项目中指识别和减少机械化、模板化、过度结构化的 LLM 写作风格，
目标是改善论文表达质量，而非保证规避任何 AI 检测系统。

## 安装

```sh
# 从 npm 安装（已发布，推荐）
dsh plugin --profile web add dsh-plugin-writing-guard

# 从 GitHub 安装（lib/ 已提交，无需构建）
dsh plugin --profile web add github:xmutfyh/dsh-plugin-writing-guard

# 或直接从 GitHub tarball 安装
dsh plugin --profile web add https://github.com/xmutfyh/dsh-plugin-writing-guard/archive/refs/heads/master.tar.gz

# 或从本地源码目录安装
dsh plugin --profile web add ./path/to/dsh-plugin-writing-guard

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
| 修辞模式 | "不是X而是Y"/"not X but Y"、rather than 滥用、绝对化定义、三连排比、重复绕圈、多重"的"字链（v0.7） |
| LLM 关联词 | delve/tapestry/testament/leverage/harness 等（密度规则，单次出现不报警）；空洞热词密度（v0.7：robust/crucial/机制/耦合/范式，高门槛防误伤术语） |
| 学术文体 | we believe/think、模糊词、抽象副词；"significantly" 仅提示复核统计语境；平均句长（v0.7：英 ≤18 词/中 ≤25 字） |
| 格式 | 破折号密度（范围连字符不算）、冒号标题、Unicode 数学符号（LaTeX 工作流） |

## v0.6 学术写作质量守卫

定位升级：从"AI 风格 Linter"到"在 Agent 修改学术论文时，持续保护科研事实、作者风格和写作质量"。全部依旧本地正则/统计，零网络零 LLM：

| 能力 | 检测什么 | 例子 |
|---|---|---|
| **Scholarship Lock** 🔴 | 润色/改写前后科研事实被改动：数字、百分数、p 值、置信区间、单位、`\cite`/`\ref`、Figure/Table 编号、DOI | `87.3% → 89.1%` 直接 HIGH：语言润色不得改数字；恢复原值或显式确认 |
| **防御饱和（hedge 密度）** | may/might/could/possibly/potentially 密度 ≥5 次且 ≥300/千句——每个结论都附 caveat | 按句归一，讨论段正常 hedging 不误伤（ICMJE） |
| **限定词堆叠** | 一条 claim 套多层保险 | `may potentially suggest` → 只留一层 |
| **超长句 + 从句堆叠** | 英文 >35 词且 ≥3 从句标记（which/that/while/because…）；中文 >80 字且 ≥5 逗号且 ≥3 连接词 | 一句话承载过多独立论点 → 拆句 |
| **重复绕圈** | 同段句子 token 余弦相似 ≥0.72 且后句无新增证据（数字/引用/实体） | 同一观点换三种说法 → 删重复圈 |
| **作者风格档案** | `writing_style_profile` 学习作者历史论文；新稿件句长分布显著偏离时提示 | "当前句长中位数 38 vs 作者历史 22" |
| **强主张缺证据** | prove/establish/confirm/guarantee 附近 ±120 字符无数字/统计量/图表引用 | 提示补充证据锚点，非判定错误 |
| **连续句首连接词** | 同一段连续 ≥3 句以 Moreover/Furthermore/Additionally 开头 | 机械推进感 |
| **Unicode 数学符号** | LaTeX 正文中 ₁₂₃ ²³ α β × − 等字符 | 建议改用数学模式 |

> 原则（来自 v0.6 设计评审）：不针对具体模型写规则（GPT-5.6 风格、Opus 风格之类——模型会变，行为模式不会）；有证据依据的 hedging 是正确的学术表达，本工具不是"反 hedge 工具"。

## v0.7 机械感与自黑免责（ko5.6sol 借鉴）

借鉴社区技能 `handsomeZR-netizen/ko5.6sol`（KO GPT-5.6 SOL 机械措辞与防御性声明），在保留
"密度门控 + 领域安全"设计的前提下新增：

| 能力 | 检测什么 | 例子 |
|---|---|---|
| **多重"的"字链** | 中文连续 ≥3 个"的"的修饰嵌套 | `基于X的Y的Z的机制` → 拆成 2–3 个短句 |
| **平均句长** | 全文均值超参考目标（英 >18 词 / 中 >25 字），按语言各报一次 | 与 overlong-sentence 互补：抓整体均值而非单句极端 |
| **自黑免责套话** 🔴 | "完全基于假数据/模型毫无意义/结果完全不可靠/不足为凭" | 改写为客观边界 + 未来方向；诚实 limitations 与模拟数据表述不误伤 |
| **空洞热词密度** | 英 robust/crucial/exhibits/tailored/interplay/imperative（≥5 且 ≥1.0/千词）；中 机制/支撑/动态/耦合/范式（≥10 且 ≥3.0/千字） | 术语用法（robust regression、"耦合机理"）保留，高门槛防误伤 |
| **词表并入** | EN 过渡词 + consequently/thus/hence/accordingly/notably…；中文套话 + 进一步/由此可见/鉴于/毫无疑问… | 密度门槛不变（≥8 次），正常使用不受影响 |
| **writing_rules 新增章节** | 「局限性与学术自信」：自黑改写公式 + 主张动词校准表（modelled ≠ observed；suggested < demonstrated）+ ESR 纪律边界 | 只改措辞不改事实 |

另：仓库根新增 `SKILL.md`——规则集的独立静态导出，供没有 DSH 的环境（Codex/Claude Code/Antigravity）直接使用同一套纪律。

## v0.8 科学完整性守卫（Scholarship Lock 2.0 = Epistemic Lock）

定位升级：从"润色后对比数字/引用"到**完整保护作者已提供的 scientific commitments**——
语言润色不得改变 science，无论往强还是往弱。借鉴 Yila-AI/sci-ssci-skills（Apache-2.0，
adapted，署名见 [THIRD_PARTY.md](THIRD_PARTY.md)）与 Evidence-Bound（MIT）。

| 能力 | 检测什么 | 例子 |
|---|---|---|
| **自动双锁（P0）** | `tools/pre-execute` 捕获修改前文本 + 持久化基线缓存，写入后自动跑 Scholarship + Epistemic Lock | 不再需要手动传 `original`；连续编辑逐次对比 |
| **主张强度锁** 🔴 | Yila claim ladder（consistent with(0) < associated(1) < predicts(2) < contributes(3) < affects(4) < causes(5)）沿任一方向漂移 | `was associated with` → `caused`：数字没变但结论已变，按 INVARIANT HIGH 报 |
| **否定/零结果锁** 🔴 | no/not/did not/without 标记删除（阴性结果被翻转）、零结果表述删除（did not improve / no significant difference） | `No significant association` → `A significant association` |
| **scope 边界锁** 🟠 | in this study / under these conditions / 在本研究中… 从对齐句消失 | 不自动判错，只要求核验"主张是否被泛化" |
| **findingKind 性质标签** | 每条命中标注 invariant / violation / candidate / advisory | CANDIDATE（"we do not claim"）可能承担正当边界——勿自动删除，人工判定 |
| **完整性回归报告** | ✓/✗ 数字、引用、主张强度、否定、scope 五行回归块（0 命中也显示） | 报告尾部新增 |

> 原则（v0.8）：cue ≠ verdict——防御性措辞是候选不是判决；删除修辞性防御，但保护 scholarly
> caution（scope 条件/证据状态/竞争解释/负面发现）。negative、null、矛盾结果是数据，不得删除。
> 许可：Epistemic Lock 的 claim-strength ladder 思想改编自 Yila-AI/sci-ssci-skills（Apache-2.0），
> candidate 判定模型借鉴 Evidence-Bound（MIT）——见 THIRD_PARTY.md。

## v0.9 双轴主张模型 + 子句级多主张（0.8 复盘 8.3/10 的修复）

| 修复项 | 内容 |
|---|---|
| **双轴模型** | 单一 0–5 阶梯拆成 **因果力**（consistent with(0) < associated(1) < predicts(2) < contributes(3) < affects(4) < causes(5)）与 **证据力**（hedge(-1) < suggest(1) < indicate(2) < support(3) < show(4) < demonstrate(5) < establish/confirm(6) < prove(7)）："confirmed an association" = 因果力关联 + 证据力强，不再误报因果 L5；"may be associated" → "is associated"（hedge 移除）本身也是证据力漂移 |
| **子句级多主张** | 按 `; , while whereas although but and` 切分子句（保护 between/among X and Y 枚举），逐子句对齐——"X caused A, while Y may be associated with B" → "Y caused B" 不再被整句最高层掩盖 |
| **对齐相似度分档** | ≥0.70 → high/invariant；0.55–0.70 → medium/invariant；0.45–0.55 → low/**candidate**（提示人工复核）；整句重写（低于对齐阈值）不再产生假漂移 |
| **preimage 按 exec.token 键控** | 同一文件并发 edit 不串扰 before/after；条目内 path 校验防 token 复用 |
| **基线 UTF-8 字节核算** | `Buffer.byteLength` 计字节；单文件超限不持久化（不截断——截断会产生假 diff），本次编辑仍用 execution preimage |
| **P0：rulesBrief 残留修复** | "we believe" 不再机械建议改成 "the results show"（那会教会 Agent 制造漂移再被锁抓住）——改为 "One possible explanation is… / This finding may reflect… / We interpret this as…"，证据直接支持时才用 "the results show" |

> 定位（v0.9）：**deterministic manuscript integrity guard**——不是检测"AI 写得像不像人"，
> 而是检测"AI 在帮科研人员改文字时，有没有悄悄改掉 science"。

## v1.0 Evidence-Status Lock（Revision Integrity 模型收官）

科学承诺（scientific commitments）的确定性 delta 模型补全最后一块：**证据状态**。

```
Scientific tokens          Scientific commitments
├─ number                  ├─ causal force
├─ statistic               ├─ evidential force
├─ citation                ├─ modality / hedge
├─ DOI                     ├─ negation
└─ figure/table            ├─ null finding
                          ├─ scope
                          └─ evidence status (v1.0)
              ↓ before → aligned claims → after
              ↓ deterministic delta
```

| 能力 | 检测什么 | 例子 |
|---|---|---|
| **证据状态守恒** 🟠 | reported/observed/measured/implemented/estimated/simulated 等来源状态词消失或被替换 | `participants reported improvement` → `participants improved`（报告→直接声称）；`observed rate` → `estimated rate`（状态替换）——都要求核验，不自动判错 |
| **完整性回归第 6 行** | 报告尾部回归块新增"证据状态"行 | ✓ 保持 / ⚠ 变化 N 处 |

> 至此双锁覆盖：数字、引用、主张因果力/证据力、hedge、否定/零结果、scope、证据状态——
> **Scholarship Lock = token multiset integrity；Epistemic Lock = semantic-marker multiset
> integrity**（v0.9.2 评审架构落地）。

## v1.1 claim-bound integrity（marker 绑定到主张）

1.0 评审（9.2/10）的核心升级：marker 不再对整句做"袋子"比较，而是**绑定到所属子句**：

| 能力 | 检测什么 | 例子 |
|---|---|---|
| **claim-bound 守恒** 🔴 | 否定/零结果/scope/证据状态按子句配对比较（未配对子句全句兜底）——**标记交换**不再被句子级 multiset 掩盖 | `X did not improve, but Y improved` → `X improved, but Y did not improve`（两边都是 did not ×1，但结论交换了）✅ |
| **主语一致性配对** | 配对加分：同一实体的主张优先配对 | `X did not improve` 配 `X improved` 而非相似度更高的 `Y did not improve` |
| **marker canonicalization** | 大小写/英美拼写归一 | `Observed→observed`、`modelled→modeled` 不再误报 |
| **scope 新增事件** 🟡 | 引入边界 = 外部有效性可能被缩窄 | `The treatment improves survival` → `In this cohort, …` |
| **`shows that` 角色修复** | that-complement 恢复 epistemic | `Figure 4 shows that X increases survival` → suggest 漂移可检出；`Figure shows architecture` 仍 descriptive |
| **多轴 delta 单事件** | causal+evidential+hedge 同条保留 | `delta：因果力 1→5，证据力 1→5，hedge 有→无` |
| **version-gap F1** | 对齐率改 symmetric coverage | before=100/after=10 全对齐不再误判 100% 可比 |
| **null/negation 去重** | 重叠事件只报更具体的一条 | `did not improve` 只报零结果事件 |

测试 209 → 218 项。

## v1.2 claim alignment credibility（配对可信度，1.1 评审 9.4/10）

| 能力 | 检测什么 | 例子 |
|---|---|---|
| **raw 阈值修复** 🔴 | 配对门槛看 raw cosine ≥0.3，主语奖励只参与排名 | `The model predicts mortality` vs `The model was initialized…`（同主语但词面不似）不再被绑成同一 claim |
| **nullResultAdded 独立** | 零结果新增独立事件 + removed/added 双向去重 | `Z improved` → `Z did not improve` 只报更具体的零结果事件 |
| **scope 前缀附着** | In this cohort/Under these conditions/在本实验中 不单独成 span，附着到后续 claim | scope markers 归属真正的 claim |
| **fragment-aware 切分** | 相对从句（which was trained…）与无主语谓语片段（achieved higher accuracy）并入主句 | span 更接近真实 claim |
| **alignment-uncertain** 🟡 | 含受保护 markers 的未配对子句不再退化回整句袋子比较——生成 review candidate | 没有可靠 claim identity 时不假定 commitments 被保留 |
| **短文档位置兜底** | ≤3 句且零对齐时位置即身份，marker 守恒按位置跑 | `Z improved` → `Z did not improve`（sim≈0.35）不再漏报；version-gap 判定用低阈值对齐 |

测试 218 → 225 项。

## v1.2.1 Scholarship Lock hit 补全 + 精度修复（1.2 评审 9.3/10 的 P0/P1）

| 能力 | 修复 |
|---|---|
| **Scholarship Lock 全覆盖** 🔴 | `lockTypes` 补 `number`/`doi`；新增 `diff.added` hit 循环（凭空引入数字/引用/DOI/图表编号 → MEDIUM/invariant）——"5 mg 被删"、"DOI 被换"、"无引用→\cite{}" 不再只有摘要计数没有告警 |
| **self-report canonical** | 正则支持空格变体（`self reported`）；self-report/reports/reported/self reported 折叠为同一 canonical key |
| **位置兜底诚实化** | 短文档 fallback 事件携带**真实相似度** + `positionalFallback` 标记（报告明示"位置兜底，非词面对齐"） |
| **scope-only 统一分类** | 删除 SCOPE_PREFIX_RE，`isScopeOnlyFragment` 直接复用 SCOPE_RE——scope 检测与附着不再两表分叉（`Within this sample,` 等全覆盖） |
| **对齐 tokenizer 修复** | 句子对齐改用不滤停用词的 tokenization——`results/experiment/model` 是 claim 身份词，restatement 停用表曾导致含实体句对齐失败 |

测试 225 → 233 项。

## v1.2.2 自动 Guard 交付修复（1.2.1 评审：引擎 9.5/10，delivery 8.3/10 → 补上）

| 能力 | 修复 |
|---|---|
| **event-level 指纹** 🔴 | integrity 事件按 matchText 指纹（AGGREGATE_RULE_IDS 白名单保留全文统计类）——`5 mg→6 mg` 与 `10 mg→12 mg` 是独立事件，增量自动审计不再把新科研修改当"旧问题"静默 |
| **invariant 永不静默** 🔴 | `filterReport` 始终保留 `findingKind=invariant`——conservative 的 high 门槛只作用于文体问题；MEDIUM invariant（新增引用/数字/DOI、新增否定/零结果、证据状态漂移）默认进自动通知 |
| **SCOPE lastIndex 修复** | `SCOPE_TEST_RE`（无 /g 副本）——连续 scope 前缀不再漏附着 |
| **subject bonus 非空** | 纯中文空主语不再白拿 +0.3（中英混写排序不偏差） |
| **version-gap 全局清单** | 行级配对跳过但全文 multiset 计数仍报：`引用：移除 12 / 新增 17；DOI：移除 2 / 新增 3…`——供人工结构级核对 |

测试 233 → 240 项。

## v1.2.3 claim identity 指纹 + unpaired inventory（1.2.2 评审 9.55/10 的三项）

| 能力 | 实现 |
|---|---|
| **Epistemic 指纹带 claim identity** 🔴 | `Hit.fingerprintKey` 与展示用 matchText 分离；`claimAnchor`（subject+内容 token，零 NLP）进指纹——**两个不同 claim 发生完全相同的 association→causation 不再碰撞**，第二个始终被增量审计当 new；FNV-1a hash 消除截断碰撞（`FINGERPRINT_VERSION` 6→7） |
| **inventory 不配对 multiset** 🔴 | 新 `diffScholarshipInventory` 纯 multiset 守恒——version-gap 下 `5 mg→6 mg` 报"移除 6 / 新增 1"而非被 changed 配对吞掉；遍历全部 9 类 ScholarshipType（不再手写清单） |
| **marker 事件统一可信度** 🟡 | `markerEventTier(sim, fallback)` added/removed 共用——"多确定是同一个 claim"不因变化方向而异；位置兜底低相似 → candidate（不再写死 invariant） |

测试 240 → 246 项。

## v1.3.0 篇章统计层（第 10 轮评审：局部规则 → 篇章统计 → 科学完整性）

> 不是再扩 AI 禁词表，而是开始判断**整篇文章是不是写得过于整齐**——把 Writing Guard 从
> "词、句、claim 级"推到"篇章结构层"。7 条新规则全部 deterministic/statistical，零网络：

| 规则 | 原理 | 性质 |
|---|---|---|
| **`paragraph-rhythm`** 🔴 | 一次计算多个信号：一句成段比例（碎片化）、段长 CV + 长段 outlier（拥塞）、连续 ≥3 段长度在中位数 ±15% 内的 run 数（过度整齐）；只用 prose-only 段落（版式行如标题/图片/表格残留不误报） | advisory |
| **`sentence-rhythm-uniformity`** 🔴 | 段落内连续 ≥3 句长度在局部中位数 ±15% 内且全文 ≥2 处 → 节奏过匀；有作者 styleProfile 时对比历史 std（当前 < 历史 60% → 更整齐）——**adaptive threshold**：有 profile 用历史分布，无 profile 用 conservative heuristic | advisory |
| **`repeated-discourse-scaffold`** 🔴 | 段落抽象成枚举签名（首先→其次→最后=`1-2-4`、第一→第二→第三=`1-2-3`、First/Second/Third、从X层面→从Y层面=`P-P-P`）；同一签名在 ≥2 个独立段落出现 → 模板化；单次列举正常 | candidate |
| **`punctuation-scaffold-overload`** | 同一句内 ≥3 类结构标点（括号/冒号/分号/引号/破折号）组合聚集；豁免 `1) RMSE: ...; ...`、`(a)(b)(c)` 图注、`Level-2 (unseen-combination): ...` 等论文标准格式 | candidate |
| **`coined-framework-language`** | 形式规则不靠词表：A-B-C 短线框架（"输入—处理—输出"）、同段 ≥2 个不同 XX化/XX力、≥3 个不同 XX性（可持续性/系统性是正当术语）、XX闭环/赋能机制 | candidate |
| **`generic-claim-candidate`** | 多弱信号组合才报（抽象名词 ≥2 + 无实体/数值/引用 + 无方法动作 + 万能句型，≥3 信号），中英双语 | candidate + low |
| **`summary-cliche-positional`** | 不新增词表——同一总结套话（综上所述/in conclusion）在每个小节末尾反复出现（≥2 个小节末尾）才报，位置驱动 | advisory |
| **`local-citation-integrity`** 🔴 | 零网络确定性：`\cite{key}` ↔ `.bib` 条目存在性、`\ref` ↔ `\label` 对应、bib 条目缺 title/year/author、同一 DOI 多 key；写作/自动审计都自动探测同目录 `.bib`；"该文献是否支持这句话"留在边界外 | violation/advisory |
| **StyleProfile → 节奏指纹** | 新增 `sentenceLengthCV`/`shortSentenceRatio`/`longSentenceRatio`/`paragraphLengthStd`/`paragraphLengthCV`（向后兼容） | — |

测试 246 → 276 项（v1.4 新增 Journal Profile/Fit 后为 284 项；v1.4.1 Corpus-aware 后为 291 项；v1.4.2 hardening 后为 293 项；v1.5 Epistemic Fingerprint 后为 294 项；v1.6 Rhetorical Moves 后为 298 项，见下）。

## v1.4 Journal Engine（目标期刊写作蒸馏与 Journal Fit）

> 在 Integrity Engine（Scholarship + Epistemic Lock）之上新增 **Journal Engine**：不是简单
> "模仿 Nature 风格"，而是从目标期刊代表论文中蒸馏可复用的**写作分布**，让 AI 修改论文时不仅
> 不改变 science，还能向目标期刊的真实写作规范收敛。全部 deterministic/statistical，零网络零 LLM。

| 能力 | 内容 |
|---|---|
| **`writing_journal_profile`** | 从目标期刊代表论文（.md/.tex/.txt）生成 Journal Profile：每个章节的句长/段长分布、hedge/因果力/证据力密度、第一人称/被动语态比例、全文引用密度；只保存抽象统计，不保存原句 |
| **`writing_audit(journalProfile=...)`** | 传入 Journal Profile JSON 后输出 section-level Journal Fit：每个章节契合度百分比 + 主要差异 + 目标分布范围（P10-P90） |
| **`computeJournalProfile` / `auditJournalFit`** | 导出纯函数，供 tests / 其他工具直接调用 |
| **优先级纪律** | Scientific Invariant > Epistemic Safety > Journal Requirement > Journal Norm > Journal Style；期刊风格永远不能覆盖科学完整性 |

示例输出（formatReport 尾部）：

```text
期刊写作契合度（Journal Fit · nature-communications）：总分 74%
  Abstract 86%
  Introduction 78%
  Methods 91%
  Results 59%
  Discussion 76%
```

## v1.4.1 Corpus-aware Journal Distillation

> 修复多篇论文拼接后同章节互相覆盖的 P0：现在每篇论文独立解析，再按 canonical section 跨论文聚合。

- 新增 `computeJournalProfileFromDocuments(documents, opts)`，`writing_journal_profile` 已切换为逐篇读取。
- `JournalSectionProfile` 所有指标升级为 `Distribution`，并新增 `articleCount`。
- canonical section 映射：`method/methods/methodology/materials and methods → methods`，`conclusion/conclusions → conclusion`。
- Journal Fit 新增引用密度指标；删除 scalar 伪装 Distribution 的临时逻辑。
- 被动语态检测补充不规则过去分词（shown/found/given/seen/known/taken/made 等）。

## v1.4.2 Journal Fit hardening

- **CI 安全**：真实语料测试在本地语料不存在时自动 SKIP，支持 `WRITING_GUARD_REAL_CORPUS` 环境变量。
- **Ratio 评分修复**：第一人称/被动语态等 0–1 比例指标使用 `minSpread=0.05`，避免 10% vs 90% 仍被判 ok。
- **引用拆分**：`bibliographicCitationDensity` 与 `figureTableReferenceDensity` 分开统计和评分。
- **Journal Fit Confidence**：报告新增 `confidence`（very_low/low/medium/high）与 `corpusSize`。
- **Canonical aliases 扩充**：`materials & methods`、`experimental methods`、`modeling/modelling`、`summary`、`results and discussion` 等归一化。

## v1.5 Epistemic Journal Fingerprint（复用 ClaimSpan）

- Journal Engine 不再只数 `causes` / `suggest` 等 regex 词频。
- 现在通过 `splitSentences` → `extractClaimSpans` 提取每个章节的 claim-level 指纹。
- `JournalSectionProfile` 新增：
  - `claimCount`
  - `highCausalRatio`（causalLevel ≥ 4）
  - `hedgedClaimRatio`
  - `strongEvidentialRatio`（evidentialLevel ≥ 4）
  - `scopeQualifiedRatio`
  - `nullFindingRatio`
- Journal Fit 新增 6 个 epistemic 指标，与句法/引用指标一起参与打分。

## v1.6 Rhetorical Moves（Introduction / Discussion / Results / Methods 序列）

- 新增 `detectRhetoricalMoves(text, sectionName)`：零 LLM 的轻量 move 检测。
- Journal Profile `rhetoric` 升级：
  - `sectionMoves`：每个 canonical section 的 move 频率
  - `transitions`：move → move 转移概率
  - `moves`：全局 move 频率
- Journal Fit 新增：
  - `rhetorical move coverage`
  - `rhetorical order fit`（LCS 序列相似度）

## v0.9.1 / v0.9.2 / v0.9.3 real-paper hardened（真实论文压出来的修复）

> 不是又增加了几个 regex，而是拿真实 manuscript audit 出来的 false positive 反过来改 engine——
> 每次真实论文测试都直接产出一个 patch 版本：

| 版本 | 真实论文 | 发现并修复 |
|---|---|---|
| v0.9.1 | pore-scale 论文 | "a baseline (M1) is established" 误报——establish+基建名词是"建立"不是"证明" |
| v0.9.2 | pore-scale 论文 | 子句重排导致位置配对错配（引文子句↔正文子句）→ clause cosine ≥0.3 门槛；Markdown 引用块 `>` 破坏句子切分 → 先剥 blockquote 标记 |
| v0.9.3 | ESR 中文综述 + 0.9.2 评审 | 证据力角色排除（Figure shows / establish baseline / confirm config ≠ epistemic）；hedge 独立字段（may suggest ≠ suggest 可检出）；否定/零结果/scope 句子级 marker multiset（多主张句不再被布尔掩盖）；best-match-first 子句配对；**版本差距过大降级保护**（对齐率 <20% 时跳过行级双锁——ESR 两版全文重写对齐率仅 3.7%，原来会输出 171 条假引用变化）；因果动词原形补全（improve/reduce/cause…） |

测试 190 → 204 项。这套"真实论文 → regression case → 修规则"的迭代是插件的核心开发方式。

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
| `writing_audit` | 扫描文本/文件；参数：text/filePath、profile、verbose、projectResidueTerms、original（v0.6 Scholarship Lock：修改前原文，对比科研实体变化）、styleProfile（v0.6 作者风格档案 JSON）、journalProfile（v1.4 Journal Profile JSON：目标期刊写作契合度）；返回按严重度+置信度排序的问题清单与全文统计 |
| `writing_rules` | 返回写作纪律速查（含 profile 与密度说明） |
| `writing_style_profile` | v0.6：从作者历史论文（filePath/learnDir）统计风格指标（句长中位数/标准差、段长、破折号/hedge/连接词密度），输出 JSON 供 writing_audit 的 styleProfile 使用 |
| `writing_journal_profile` | v1.4：从目标期刊代表论文（filePath/learnDir）蒸馏 Journal Profile（章节句长/段长/hedge/因果力/证据力/第一人称/被动语态/引用密度分布），输出 JSON 供 writing_audit 的 journalProfile 使用 |

### 真实输出演示

对一段含修改残留的文本运行 `writing_audit`（verbose=true，真实输出）：

```text
写作纪律检查报告（文档类型: manuscript）：发现 3 处问题（高 3 / 中 0 / 低 0）
- 统计：1 段 / 115 字符（英文 19 词 + 中文 0 字）；破折号 0；rather than 0；不是X而是Y 0；绝对化定义 0；三连排比 0；LLM过渡词 0；中文套话 0；冒号标题 0
- 分类：修改过程残留 3

🔴 [HIGH · conf high] 正文出现 "revised/revision" 修改过程残留 [para 0]
    原文：The revised model uses the ΔP regression objective only. As requested by the reviewer, we h…
    提示：正文中出现了 "revised/revision" 等修改过程语言，这是写给审稿人的元话语；正式论文读者只应看到最终版本。（专有名词如 Revised Cardiac Risk Index、revised simplex method，以及文献引用语境 “Smith proposed a revised model” 除外）
    建议：改为中性论文语言：the proposed model / the model / the present analysis，把“修改”动作从正文清除。
    依据：style-guide — 写作纪律页：修改过程残留黑名单

🔴 [HIGH · conf high] 审稿回应用语残留 [para 0]
    原文：The revised model uses the ΔP regression objective only. As requested by the reviewer, we have updated the methods.
    建议：直接陈述做法或结果本身，不引用审稿过程。

🔴 [HIGH · conf high] "we have updated/modified" 修改叙述 [para 0]
    原文：…ΔP regression objective only. As requested by the reviewer, we have updated the methods.
    建议：把句子改写为对最终版本的直接陈述，例如直接描述模型/方法/结果，删除变更动词。

（提示：加 verbose=true 可查看每条的建议与备注；默认只输出原文摘要）
```

真实调用：

```text
writing_audit(filePath: "manuscript/main.md", profile: "manuscript", verbose: true)
→ 写作纪律检查报告：发现 0 处问题 ✅ 通过
```

## 自动审计（默认开启，v0.5 增量模式）

插件监听 `tools/post-execute`：`write`/`edit` 写入**论文类文件**（.md/.tex/.txt，路径含
manuscript/paper/revision/response/论文/修订/返修…，或位于 01_manuscript/ 等知识库目录）时
自动审计（自动检测文档 profile），结果经 `additionalContexts` 注入模型下一条请求。

**v0.5 incremental lint**：审计状态按文件持久化（`~/.dsh/plugins/dsh-plugin-writing-guard/state.json`），
每次写入只注入**增量**（v0.5.2：指纹基于命中词本身，同段其他文字编辑不会造成假"解决+新增"重复注入）：

```text
新增 1 项 / 已解决 4 项 / 仍存在 8 项
```

- 无变化 → 不注入（不再把同样的问题反复灌给 agent）
- 只有已解决 → 简短确认（不占注入次数）
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
    stateFile: ''                   # 增量状态文件（缺省 ~/.dsh/plugins/dsh-plugin-writing-guard/state.json）
```

## FAQ

### 这是 DSH 的论文去 AI 味插件吗？

可以这样理解，但 Writing Guard 与传统 Humanizer 不同。
它主要在论文写作和修改过程中检测常见 AI 写作风格，
而不是将全文交给另一个模型进行重写。

### 支持中文论文吗？

支持。规则同时覆盖中文和英文论文中常见的机械化表达、
模板化过渡、修改过程残留和防御性写作（中英文分别按
CJK 字数 / 英文词数独立计算密度阈值）。

### 支持 SCI / English academic writing 吗？

支持。`writing_audit` 可检查英文 manuscript 中的
revision residue、defensive writing、LLM-overused expressions
以及常见 AI-style sentence patterns。

### Writing Guard 和 academic-humanizer 有什么区别？

academic-humanizer 更偏向对已有文本进行自然化编辑；
Writing Guard 更偏向在 DSH 论文工作流中持续检查和预防。
二者可以配合使用。

## 测试

```sh
npm test   # 自动先 build 再跑 298 项 TP/TN/边界用例（零依赖自研 runner，含 isPaperFile/profile 检测/指纹稳定性含 claim-identity/Scholarship Lock 全方向/风格档案/Epistemic Lock mutation benchmark/版本差距保护+不配对全局清单/证据状态守恒/claim-bound 交换/alignment-uncertain 回归/Journal Profile 与 Journal Fit/corpus-aware 聚合/CI-safe 真实语料/Epistemic Journal Fingerprint/Rhetorical Moves）
```

CI（GitHub Actions）会在每次 push / PR 自动跑构建 + 全部测试。

## 开发

```sh
pnpm install && pnpm build   # TypeScript -> lib/
# 规则引擎：src/rules.ts（零依赖，纯正则+统计）
```

## License

MIT
