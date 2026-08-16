---
name: writing-guard
description: >-
  Academic-writing discipline guard (deterministic, zero-network): rewrite/refactor manuscript
  prose to remove AI mechanical phrasing and defensive disclaimers while protecting research facts.
  论文写作纪律守则（本地规则，零网络）：去 AI 机械感（多重"的"字链、套路过渡词、空洞热词、超长句）、
  清除自黑式免责套话（"基于假数据/模型毫无意义"）、保护科研事实（数字/引用/图表编号不改动）。
  Use when writing, polishing, or refactoring academic papers (LaTeX/Markdown, Chinese/English)
  to achieve publication-ready tone without changing scientific facts.
---

# 论文写作纪律守则（writing-guard）

本技能是 `dsh-plugin-writing-guard`（DSH 插件，v0.7.0）的独立静态版——规则集与插件一致，
供没有 DSH 的环境（Codex / Claude Code / Antigravity / 任意 agent）在写作与润色时执行。
所有规则均为确定性正则/统计，零网络零 LLM；源插件还提供 `writing_audit`（扫描）、
`writing_rules`（速查）、`writing_style_profile`（作者风格档案）工具与 Scholarship Lock 实体对比。

---

## 1. 修改过程残留（process residue）——正文/投稿信中零容忍

- 删除："revised/revision"、"as requested"、"we have updated/modified"、"previous version"、
  中文"本轮/本次修改/投稿前/待补齐/审稿人要求/我们修改了/修订稿/返修稿"。
- 例外：rebuttal（回复信）中 "the revised manuscript / as requested" 完全正常；专有名词
  （Revised Cardiac Risk Index、revised simplex method）与文献语境（"Smith proposed a revised model"）不算。
- 版本号、文件名、SHA、内部流程名词不得进入正文。

## 2. 主张校准（claim calibration）

- 禁止反复自我设限："we do not claim"、"本文并非要证明"、"这并不意味着"——同一边界集中写一次。
- 自黑免责零容忍（v0.7）：不得出现"完全基于假数据 / 基于虚构/伪造数据 / 模型毫无意义 /
  结果完全不可靠 / 不足为凭"等摧毁论文价值的自我打压（AI 安全护栏误触发的过度防御）。
  诚实 limitations（"样本量有限"、"结果可能不完全可靠"）是正当表述，不在此列。
- 防御饱和：may/might/could/possibly/potentially 密度 ≥5 次且 ≥300/千句时清理；
  一条 claim 套多层保险（"may potentially suggest"、"或许可能"）拆到只剩一层；
  有证据依据的 hedging 保留（ICMJE 要求报告统计不确定性）。
- 强主张（prove/establish/confirm/guarantee）附近必须有证据锚点（数字/统计量/图表引用），否则弱化。
- 局限性跨章节分散（≥3 个章节出现局限表述）时集中写：方法定位 1 处 + 结论边界 1 处。

## 3. 修辞模式（rhetorical pattern）

- "不是X而是Y"/"not X but Y"对仗句式：删除一半，用数字、动作、场景替代（概念澄清可保留一次）。
- 绝对化定义（"唯…才…/其核心在于/其本质在于"）改为有条件的命题。
- 三连排比（X, Y, and Z）密度 ≥4 处且 ≥0.8/千词时精简。
- 中文多重"的"字修饰链（v0.7）：连续 ≥3 个"的"的嵌套（"基于X的Y的Z的机制"）拆成 2–3 个短句，
  主谓宾主干显性化；两层"的"（"该方法的预测结果"）不算。
- 重复绕圈：同段句子高词汇重合且无新增证据时删掉重复圈。

## 4. LLM 关联词与空洞热词（density-gated，概率信号非证据）

- 高频动词/名词（delve/tapestry/testament/leverage/harness/underscore/pivotal/meticulous）：
  全文 ≥2 次且 ≥0.4/千词才处理，单次出现不慌。
- 过渡词（moreover/furthermore/additionally/in conclusion/ultimately/consequently/thus/hence/
  accordingly/thereby/to this end/notably/importantly/specifically/this matters/this motivates）：
  ≥8 次且 ≥1.5/千词时删除大部分；学术写作出现 1–2 次正常。
- 中文套话（值得注意的是/综上所述/与此同时/基于此/进一步/由此可见/鉴于/毫无疑问/特别地/有鉴于此/也就是说/随着…的发展）：
  ≥8 次且 ≥2.0/千字符时精简。
- 空洞热词（v0.7，密度门控避免误伤术语）：
  - 英文 robust/crucial/substantially/exhibits/tailored/interplay/imperative：≥5 次且 ≥1.0/千词时，
    用具体证据替换（"robust performance" → "RMSE decreased from 2.1 to 1.3"）；术语（robust regression）保留；
  - 中文 机制/支撑/动态/稳健/范式/拓扑/耦合/协同/维度/全流程/精细化/解耦：≥10 次且 ≥3.0/千字时
    检查抽象名词堆砌；专业术语（"耦合机理"）在领域文献中正常，低于阈值不报。

## 5. 学术文体与格式

- 平均句长（v0.7）：英文均值 ≤18 词、中文均值 ≤25 字（参考目标 12–18 词 / 15–25 字）；
  把最长的约 20% 句子拆短。综述等文体可整体偏长，人工判断。
- 超长句堆叠：英文 >35 词且 ≥3 从句标记、中文 >80 字且 ≥5 逗号且 ≥3 连接词——拆句。
- 抽象副词（remarkably/interestingly/importantly）换成具体数值；"significantly" 仅在无统计证据的
  修辞用法需改（p<0.05 是正当用法）。
- "we believe/think" 改为 "the results show"；模糊词（somewhat/quite/fairly）少堆叠。
- 破折号 ≥5 次且 ≥0.5/千词时删除大部分（范围连字符 30–75 °C 不算）；冒号标题前后必须并列或递进。
- LaTeX 中 Unicode 下标/希腊字母（₁ α）改用数学模式；绝不破坏 \cite/\ref/\label、自定义宏与公式。

## 6. 局限性与学术自信（v0.7，ko5.6sol 借鉴）

- 自黑改写公式：客观边界 + 未来方向——"本研究采用模拟数据开展敏感性分析" →
  "下一步可在真实岩心实验中验证"。
- 主张动词校准表（按证据强度选词，不夸大也不自贬）：
  - modelled / simulated ≠ observed / measured（模拟评估 ≠ 真实观测，用词必须对应）；
  - suggested / indicated < demonstrated / established（弱证据用弱动词）；
  - we suggest ≠ we show（主观意愿 ≠ 结果陈述）。
- 纪律边界（ESR）：不得为了"学术自信"删除真实的证据缺口、失效模式、条件限制——
  局限是证据透明度的一部分，只改措辞不改事实。

## 7. 发布原则与提交前自查

- 只围绕优势组织论文；不写工作汇报、不主动示弱、不替审稿人攻击自己；
  打不过的维度不设为比赛项目；优势必须明确说出来。
- 润色/改写后自查：① 数字、百分数、p 值、置信区间、\cite/\ref、Figure/Table 编号、DOI
  是否被改动（语言润色不得改变科研事实——Scholarship Lock）；② 高危项清零、中危 ≤3 处；
  ③ 若在 DSH 环境，用 `writing_audit`（可传 original=改前原文）复核；④ 用
  `writing_style_profile` 学习作者历史风格，句长分布向作者靠拢。

---

*本守则来源于 dsh-plugin-writing-guard v0.7.0（MIT）。检测类规则为概率信号：命中即人工复核，
专业术语与正当 limitations 不因规则报警而删改。*
