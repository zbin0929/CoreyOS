# AI 的程序性记忆 — Skill 自我进化演示手册

> 演示给客户看「AI 越用越聪明」的具体做法。基于 Hermes Agent 已经内置
> 的 `skill_manage` 工具 + Curator 后台维护，CoreyOS 把这一层用 base
> soul prompt 显式打开。

## 一、技术底座（不是 Corey 重新发明的）

Hermes Agent 上游早就有这两个能力：

| 能力 | 谁负责 | 我们做了什么 |
|------|--------|--------------|
| `skill_manage` 工具 | Hermes（`tools/skill_manager_tool.py`） | base soul 显式指示 agent 何时使用 |
| Curator 后台维护 | Hermes（`agent/curator.py`） | 默认开启 + 准备 Settings UI |
| 默认文档技能 | Hermes hub（Anthropic xlsx/docx/pdf/pptx） | 打包进 `presets/default/skills/` |
| 产物落地 + 链接 | Corey 自有 | `save_artifact` MCP + `corey://artifact/` 链接渲染 |

**HD-2 原则**：Corey = 编排，Hermes = 执行。这里完全遵循。

## 二、演示 3 个段子（按由浅入深）

### 段子 1 — 第一次跑出 xlsx 周报（30 秒）

**剧本**：

1. 你（在 Corey 聊天框）："给我做一份示意性的销售周报，数据自己造，
   要 Excel 格式，里面要有饼图和柱状图。"
2. **AI 流程**（客户看屏）：
   - 调 \`bash\` 执行 Python（openpyxl，含 PieChart + BarChart）
   - 调 \`save_artifact(name="weekly-sales-demo.xlsx", source_path="/tmp/...")\`
   - 回复中附 `[📊 weekly-sales-demo.xlsx](corey://artifact/chat/weekly-sales-demo.xlsx)`
3. 聊天里**自动出现文件卡片**（图标 + 大小 + 打开 + 在 Finder 显示）
4. 点"打开" → 系统自动用 Excel / Numbers 打开 → **真的有饼图柱图**

**客户脑子里发生什么**：

- "AI 不光会聊天，会做出真东西"
- "数据没飘出去——文件就在我电脑上"
- "Excel 不是丑陋的 dump，是带图表的"

### 段子 2 — AI 主动提议保存为 skill（关键演示）

紧接段子 1，**不重启不清屏**：

1. AI 完成段子 1 后，**回复末尾自动追加**：
   ```
   ✨ 我注意到这是个 5 步的工作流，未来可能会重复。要不要我存成
   skill `weekly-sales-report`？以后你只说"跑周报"我就直接复用，
   不用每次都重新讲一遍。

   👇 [保存为 skill] [先不存]
   ```

2. 你："好"
3. AI 调 `skill_manage(action='create', name='weekly-sales-report',
   content="...")` 写入 `~/.hermes/skills/weekly-sales-report/SKILL.md`
4. AI 回复："已保存。下次说'跑周报'我会直接按这套流程做。"
5. **打开 /skills 页面** → 真的多了一个 skill

**客户脑子里发生什么**：

- "AI 在保存它自己的经验"
- "下次同样的请求不用我重新讲，它有记忆"
- "这个记忆是我的本地文件，可以备份、可以分享、可以删"

### 段子 3 — 复用刚保存的 skill（封口）

新开一个对话或等 30 秒清话题：

1. 你："跑周报"
2. AI **直接进入第 4 步**（不用问"什么数据"、"什么格式"），按 skill
   里的步骤跑，输出文件
3. 客户："这才半小时前刚教过它一次，已经会了"

**演示价值**：

- 与"AI 越用越聪明"的营销话术形成**一一对应**
- 实物可见（SKILL.md 文件、Excel 输出），不是抽象 PPT
- 客户可以**当场让你删掉那个 skill**，验证可控

## 三、什么时候 AI **不会**主动提议保存

base soul 里有显式排除列表（防止 skill 库被污染）：

- 一次性闲聊 / 单步问答 / 单纯查事实
- 用户明说"就这一次"
- 任务失败了
- 已经有匹配的 skill（agent 会用 patch 修改，而不是新建）

## 四、客户常问的 5 个问题

### Q1：这些 skill 存在哪里？我能看吗？

`~/.hermes/skills/<name>/SKILL.md`。**Settings → Skills 页**列全部，
点开能看正文。是普通 markdown 文件，VSCode 也能开。

### Q2：会不会越攒越多变成垃圾堆？

Hermes Curator 后台 7 天跑一次复审：

- 30 天没用 → 标记 stale
- 90 天没用 → 移到 `~/.hermes/skills/.archive/`（可恢复）
- aux LLM 复审：发现重叠的 skill 自动合并

**永不删除**，最坏只是归档。

### Q3：我能锁死某个 skill 不让 AI 改吗？

```bash
hermes curator pin weekly-sales-report
```

锁定后 agent 调 `skill_manage(action='edit' | 'patch' | 'delete')`
**全部被拒**。锁可以用 `unpin` 解。

### Q4：跨设备同步怎么办？

`~/.hermes/skills/` 是普通文件夹。

- 单机：天然在
- 多人/多端：rsync / 网盘同步 / git 仓库托管
- Corey **不内置同步**——保持本地主权。同步策略客户自己挑。

### Q5：AI 私自保存的 skill 我能看到提示吗？

base soul 已经强制要求 agent **提议+用户确认**才保存。没提议直接静默
保存 = 违反 HARD RULE。

> v0.2.13 计划：监听 `~/.hermes/skills/` 文件系统事件，**chat 顶部**
> 实时显示"AI 刚保存了 skill X"卡片。即使 agent 跳过 prompt，文件
> 创建动作也会被前端看见。

## 五、演示前 5 分钟清单

```
[ ] 重启 Corey，确保 v0.2.12 base soul 生效
[ ] Settings → Skills 页：清掉前几次试跑生成的 demo skill
[ ] 一份"干净"对话开演段子 1
[ ] 桌面上准备一个空白 Excel——演示完真的能打开
[ ] 演示完后告诉客户 ~/.hermes/skills/ 的物理位置，让他自己点开看
```

## 六、可能翻车的 3 个点 + 应急

| 风险 | 应急 |
|------|------|
| AI 没在回复末尾追加"保存提议" | 你**直接问**："要不要把刚才那套流程存成 skill？" |
| Excel 出来没图表 | 关掉 PRESET xlsx skill 演示档次会掉，确认装了 anthropic xlsx |
| `~/.hermes/skills/` 没权限 | 演示前 `ls -la ~/.hermes/skills/` 检查 |

## 七、与"AI 自动删数据"安全顾虑的关系

客户问"AI 自己保存 skill 安不安全"——指出：

- skill 是**只读知识库**，不是 AI 的"权限"
- 跑 skill 时每一步仍受**破坏性操作 HARD RULE** 管控（看
  `docs/ai-browser-security.md`）
- skill 错了不会损害数据，最多就是产生一份错误的报告——回滚 0 成本

把这两个 feature 一起讲：**程序性记忆**（这个文档）+ **审批门**（安
全文档）= "AI 越用越聪明 + 永远受控"，是对客户的核心承诺。
