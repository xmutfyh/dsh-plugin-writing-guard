---
name: writing-guard
description: "Scientific manuscript writing, polishing, auditing, and safe Word editing guard. Use for academic papers, abstracts, introductions, methods, results, discussions, rebuttals, DOCX edits, AI-style cleanup, defensive-writing cleanup, over-explanation reduction, semantic-restatement cleanup, scientific-claim preservation, table formatting, and edit-scope verification."
---

# Writing Guard — 论文写作审计与 Word 安全编辑

## Manuscript Writing Policy (v2.0)

### Control context is not manuscript content

- **Critique is not content.** Reviewer comments, user editing instructions, guard findings, rejected alternatives, and remediation suggestions are control context, not manuscript evidence.
- Never quote, paraphrase, or convert control-context wording into manuscript prose unless authoritative research material independently supports the resulting statement.
- If a concern maps to a real method fact, state the fact only. Example: prefer `Normalization parameters were estimated from the training data.` over `To prevent data leakage, ...`.
- If the source material does not establish the needed fact, do not invent a mitigation. Leave the manuscript unchanged or query the author.

### Argument economy

Every sentence must earn its place by adding at least one of: evidence, method, result, comparison, non-obvious interpretation, a necessary scope/evidence boundary, or a logical relation required by the argument.

If deleting a sentence preserves the scientific content and argument, **CUT it**. Prefer CUT over REWRITE. Do not turn a useless sentence into a more polished useless sentence.

Delete prose whose only function is to:

- pre-empt reviewer criticism;
- reassure the reader that a risk was considered;
- defend the authors or the method;
- advertise that a finding is important;
- narrate the writing/revision process;
- restate an already explicit claim;
- explain an implication that the intended specialist reader can infer directly.

### Do not close every semantic loop

State each scientific claim once. After evidence and the necessary calibrated interpretation are present, stop. Assume a specialist reader can make one obvious inferential step unaided.

Treat `In other words`, `This means that`, `Taken together`, and equivalent Chinese summary markers as **candidates**, not banned phrases. Keep them only when the next sentence adds a mechanism, comparison, quantitative interpretation, condition, citation, or necessary boundary.

Standalone evaluations such as `This is an important finding.` should be cut unless they immediately specify a concrete consequence.

### Clarity is not exhaustive explanation

Clarity means explicit referents, readable syntax, sufficient reproducibility detail, and the reasoning needed to interpret the evidence. It does **not** mean spelling out every implication.

Do not remove definitions, non-obvious statistical interpretation, necessary method detail, or genuine epistemic boundaries merely to be terse. A sentence that translates a difficult metric into useful meaning may stay; a sentence that only paraphrases an already explicit claim should go.

### Defensive-purpose test

Treat reviewer-facing prebuttals, repeated non-claim disclaimers, omitted-experiment defenses, result excuses, legalistic reassurance, and automatic "therefore this is important" summaries as candidates for removal or relocation.

For any such sentence, ask in order:

1. Does it change a scientifically necessary understanding of method, validity, scope, evidence strength, or interpretation? If **no**, CUT.
2. Is the underlying fact independently supported by the authoritative research material? If **yes**, state that fact directly and minimally; if **no**, QUERY rather than inventing it.
3. Is the content a real limitation or alternative explanation? If **yes**, keep the scientific content in the appropriate section, but remove the reviewer-facing motive and repeated reassurance.

### Style-only expansion discipline

When the user asks only for polishing, rewriting, or style improvement and supplies no new scientific content, default to the **same length or shorter**. Expansion is justified only when needed to resolve real ambiguity, preserve reproducibility, or state a necessary scientific boundary. Do not add explanation simply to make the prose feel more complete.

### Minimal edit protocol

Use **CUT -> PRUNE -> RECAST -> SPLIT**. Do not automatically turn one difficult sentence into two or three explanatory sentences. Split only when the original genuinely contains multiple independent scientific claims.

For defensive prose, **write the scientific fact, not the reason you are defensively mentioning the fact**.

### Scientific invariants

Never silently alter numbers, units, statistics, citations, Figure/Table references, negation, null findings, causal strength, evidential strength, evidence status, population, condition, or scope for style. If a better sentence requires unsupported science, **QUERY**.


本 skill 提供两大能力：

1. **写作纪律审计**（writing_audit / writing_word_audit）：检测修改过程残留、AI 风格、主张漂移、Scholarship/Epistemic Lock
2. **Word 文档安全编辑**（writing_word_scan / writing_word_edit / writing_word_scope_check）：结构化扫描、局部安全编辑、范围完整性验证
3. **Word 文档格式化**（writing_word_format_tables）：三线表格式化、字体字号调整

## 路由协议

### 步骤 1：判断用户意图

根据用户请求判断需要的能力组合：

| 用户意图 | 需要的工具 |
|----------|-----------|
| 检查论文写作质量 | `writing_audit` 或 `writing_word_audit` |
| 修改 Word 论文的某个章节 | `writing_word_scan` → `writing_word_edit` → `writing_word_scope_check` |
| 扫描 DOCX 结构 | `writing_word_scan` |
| 替换论文中的某些表述 | `writing_word_edit` |
| 编辑后验证范围 | `writing_word_scope_check` |
| 去 AI 味 / 检查 AI 风格 | `writing_audit`（profile=rebuttal 或 manuscript） |
| 检查修改过程残留 | `writing_audit`（传 original 参数开启 Scholarship Lock） |
| 表格改成三线表 | `writing_word_format_tables` |
| 修改字体字号 | 直接用 Python 脚本调用 python-docx |

### 步骤 2：执行流程

#### 流程 A：论文写作审计

1. 确定文件路径和文档类型（manuscript/rebuttal/cover_letter）
2. 调用 `writing_audit` 或 `writing_word_audit`
3. 解读结果并给出修改建议
4. 如有 original 文本，传入以开启 Scholarship/Epistemic Lock

#### 流程 B：Word 文档安全编辑

1. **扫描**：调用 `writing_word_scan` 获取文档结构
2. **定位**：根据用户描述的章节标题确定编辑范围
3. **编辑**：调用 `writing_word_edit` 执行安全替换
4. **验证**：调用 `writing_word_scope_check` 确认未越界修改

#### 流程 C：混合操作（先审计再编辑）

1. 先调用 `writing_word_audit` 检查当前问题
2. 再按流程 B 执行编辑
3. 编辑后再次调用 `writing_word_audit` 确认问题已解决

### 步骤 3：报告结果

- 审计结果：按严重度分类（HIGH/MEDIUM/LOW），给出具体修改建议
- 编辑结果：展示变更清单（Change Manifest），确认范围完整性
- 如有问题未解决，建议下一步操作

## 工具详解

### writing_audit

对文本执行确定性写作与科研完整性扫描；语义文风决策由上方 Manuscript Writing Policy 约束宿主模型。

**参数：**
- `text` 或 `filePath`：要检查的文本/文件路径
- `profile`：文档类型（manuscript/rebuttal/cover_letter/review/notes/unknown）
- `verbose`：是否输出每条建议（默认 false）
- `original`：修改前原文（开启 Scholarship Lock + Epistemic Lock）
- `styleProfile`：作者风格档案 JSON（开启句长漂移检测）
- `journalProfile`：目标期刊档案 JSON（开启 Journal Fit 审计）

**检测项：**
- 修改过程残留（revised/本轮/投稿前…）
- 主张校准（防御密度/限定词堆叠/强主张缺证据）
- 修辞模式（不是X而是Y/重复绕圈/三连排比）
- LLM 关联词（delve/tapestry/过渡词堆叠）
- 学术文体（超长句/抽象副词/句长偏离）
- 格式（破折号密度/Unicode 数学符号）

### writing_word_scan

对 .docx 文件执行结构化扫描。

**参数：**
- `filePath`：要扫描的 .docx 文件路径

**返回：**
- 文档 profile（manuscript/rebuttal）
- 标题层级树
- 段落信息（样式、复杂对象检测）
- 表格列表
- 受保护节点警告

### writing_word_edit

对 .docx 文件执行局部安全编辑。

**参数：**
- `filePath`：要编辑的 .docx 文件路径
- `replacements`：替换列表 `[{old: "原文", new: "新文本"}]`
- `scopeConfig`：编辑范围（可选）
  - `startHeading` / `endHeading`：标题范围
  - `heading`：单节标题
- `mode`：编辑模式（text_only/structural/format_normalization）
- `outputPath`：输出路径（可选，默认覆盖）

**保护规则：**
- 不修改：页边距、页眉页脚、section break、页码、图片、参考文献、交叉引用、书签、脚注
- 替换文本时保留原始格式（粗体、斜体、字体、颜色）
- 复杂段落（含公式/图片/字段）使用 XML-aware 编辑

### writing_word_scope_check

验证编辑操作是否修改了请求范围之外的内容。

**参数：**
- `fileBefore`：编辑前的 .docx 文件路径
- `fileAfter`：编辑后的 .docx 文件路径
- `scopeConfig`：预期编辑范围

### writing_word_format_tables

将 .docx 中所有表格转换为学术三线表格式。

**参数：**
- `filePath`：要格式化的 .docx 文件路径
- `outputPath`：输出文件路径（可选，默认覆盖）

**三线表规则：**
- 顶线：1.5pt 粗线
- 表头底线：0.75pt 细线
- 底线：1.5pt 粗线
- 无竖线、无内部横线
- 表头行加粗

## 使用示例

### 示例 1：检查论文写作质量

用户：帮我检查一下 pore_scale_revised.docx 的写作质量

执行：
1. 调用 `writing_word_audit(filePath="pore_scale_revised.docx")`
2. 解读结果，按严重度分类报告

### 示例 2：修改论文特定章节

用户：帮我把第三章的 "leakage-free" 改成 "zero-leakage"

执行：
1. 调用 `writing_word_scan(filePath="pore_scale_revised.docx")` 获取结构
2. 调用 `writing_word_edit(filePath="pore_scale_revised.docx", replacements=[{old: "leakage-free", new: "zero-leakage"}], scopeConfig={startHeading: "3. Model methodology", endHeading: "4. Results and discussion"})`
3. 调用 `writing_word_scope_check(fileBefore="原始文件", fileAfter="编辑后文件")` 验证

### 示例 3：编辑后审计

用户：我改了论文，帮我检查有没有问题

执行：
1. 调用 `writing_word_audit(filePath="修改后的文件")`
2. 如有 original 文本，传入以对比 Scholarhip/Epistemic Lock
3. 报告新增/已解决的问题

### 示例 4：表格改为三线表

用户：帮我把论文里的表格改成三线表

执行：
1. 调用 `writing_word_format_tables(filePath="论文.docx")`
2. 报告转换结果

## 注意事项

- .docx 文件的自动审计已集成到插件的 `autoAuditOnWrite` 机制中
- 编辑 Word 文档时，插件会自动创建备份（.bak 文件）
- 复杂段落（含公式/图片/交叉引用）需要特别小心，插件会自动检测并警告
- 建议在编辑前先调用 `writing_word_scan` 了解文档结构
