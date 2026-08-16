# THIRD PARTY — Inspiration & Adaptation Attribution

本文件记录 dsh-plugin-writing-guard 在设计与规则上借鉴/改编的第三方项目及其许可要求。
dsh-plugin-writing-guard 本体为 MIT；以下借鉴均以"思想/机制适配"为主，未复制受保护内容。

## Yila-AI/sci-ssci-skills（Apache-2.0）

- **来源**：<https://github.com/Yila-AI/sci-ssci-skills>（`skills/science-research-writing` 的
  claim-strength ladder 与 `scripts/check_draft_invariants.py` 的 invariant 思想）
- **借鉴内容（v0.8 / v0.9）**：
  - claim-strength ladder（uncertainty < association < prediction < contribution < effect < causation）
    的层级化主张强度模型 → 本插件的 `CAUSAL_LADDER`（adapted：层级定义与正则词表为本项目实现）；
  - v0.9 按其"因果强度 ≠ 证据强度"的区分扩展为**双轴模型**（因果力 + 证据力），
    demonstrate/prove/establish/confirm 移入证据力轴——"confirmed an association" 不再误判为因果 L5；
  - "修改不得静默沿梯子向任何方向移动；科学主张变化需要新的证据和作者授权"原则 → Epistemic Lock
    的 `claim-drift` 规则（上升与下降均按 invariant 报）；
  - negation / null-result / 数字 / citation 的 invariant 守恒思想 → `negation-drift` 与既有
    Scholarship Lock。
- **合规**：Apache-2.0 要求 reuse/adaptation 给予 attribution，本文件即履行该要求。

## lensback940701/Evidence-Bound-Press-Conference-Revision-Skill（MIT）

- **来源**：<https://github.com/lensback940701/Evidence-Bound-Press-Conference-Revision-Skill>
- **借鉴内容（v0.7 / v0.8）**：
  - **cue ≠ verdict** 判定模型（词汇线索只是 candidate，必须人工判定其承担的
    scope / evidence-status / rival / method 功能）→ `findingKind` 数据模型
    （invariant / violation / candidate / advisory）与防御性规则的 candidate 语义；
  - D1–D8 / K1–K4 分类与 KEEP 作为正面审计结果 → 规则 message/suggestion 的"不自动删除、人工判定"措辞；
  - scope condition / 负面结果 / 矛盾结果必须保留的原则 → `scope-drift` 规则与
    "零结果表述被删除"检测、`self-deprecation` 建议的改写；
  - 三问保全测试（同或更窄主张 / 来源状态区分 / 引文角色不变）→ `writing_rules` 提交前自查。

## handsomeZR-netizen/ko5.6sol（MIT）

- **来源**：<https://github.com/handsomeZR-netizen/ko5.6sol>
- **借鉴内容（v0.7）**：中文"的"字修饰链检测目标、平均句长参考值（英 12–18 词 / 中 15–25 字）、
  自黑免责套话词表（完全基于假数据/模型毫无意义等）、过渡词与空洞热词词表（已并入密度规则并保持门控）。
  **未采用**其"全禁词表"策略（本插件坚持 density + minCount 双门控，术语与诚实 limitations 豁免）。

## imbad0202/academic-research-skills（思路参考）

- **来源**：<https://github.com/imbad0202/academic-research-skills>
- **参考**：revision-round claim-drift guards 与 provenance 边界意识
  （"只能检查稿件与声明过程之间的一致性，不能证明实验真的发生过"）→ 插件 README 的定位表述
  （保护作者已提供的 scientific commitments，而非验证科研事实正确）。

## WantongC/journal-adapt-writing-skill（思路参考，未采用）

- **来源**：<https://github.com/WantongC/journal-adapt-writing-skill>
- **参考**：分层风格档案思想（discipline > journal > personal style 的优先级）——
  列入 v1.0 路线，当前未实现。

---

*本插件所有规则均为本地确定性正则/统计，零网络零 LLM；任何检测结果都是"概率信号/候选"，不是对
科研事实正确性的判定。*
