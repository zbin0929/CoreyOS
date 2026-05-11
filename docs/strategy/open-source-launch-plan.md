# Corey 开源发布计划

> 目标：通过开源引流建立知名度，Pro 版商业化变现

## 一、背景分析

### 竞品：hermes-desktop

| 指标 | 值 |
|------|---|
| 仓库 | fathah/hermes-desktop |
| Stars | 1,365（40 天） |
| Forks | 210 |
| Commits | 68 |
| 贡献者 | 1 人 (fathah) |
| License | MIT |
| 上游依赖 | NousResearch/hermes-agent (138,763 ⭐) |

### hermes-desktop 星多的原因

1. **借了 hermes-agent 的光** — 138K star 项目唯一的官方 GUI 客户端，用户自然流入
2. **填了痛点空白** — Hermes Agent 纯 CLI，hermes-desktop 是第一个提供 GUI 的项目
3. **NousResearch 品牌效应** — 官方推荐天然获得信任
4. **踩中时间窗口** — 2026 年 3-4 月 AI Agent 桌面化是热门赛道

### hermes-desktop 的硬伤

- `index.ts` 1167 行巨型 IPC 文件，无模块化拆分
- `config.yaml` 读写无原子保护，可能写坏文件
- 无 RAG / 知识库
- 无安全 Guard
- 无工作流引擎
- 无多 Agent 支持
- Windows Python 路径硬编码 Unix (`bin/python` 而非 `Scripts\python.exe`)
- 测试仅 8 个文件
- Claw3D 3D 可视化需 git clone + npm install ~200MB 外部依赖
- 1365 ⭐ × $0 收入 = 无商业价值

## 二、产品定位

### 一句话定位

> **Corey — The best desktop client for Hermes Agent**
>
> 15 MB, 10x lighter than Electron. RAG, workflows, multi-agent — out of the box.

### 目标用户

- Hermes Agent 的 138K star 用户群（需要桌面 GUI）
- 中文 AI Agent 社区（没有好的桌面客户端）
- 跨境电商 / 客服 / 数据分析等行业从业者（需要定制化 Agent）

## 三、Free / Pro 功能切分

### Corey Free（开源，引流）

| 功能 | 说明 |
|------|------|
| 聊天 | 多模型 SSE 流式 + 斜杠命令 |
| 会话管理 | FTS5 全文搜索 + 会话恢复 |
| Profile 多配置集 | 独立 .env / config.yaml / skills |
| Memory 编辑 | MEMORY.md / USER.md CRUD |
| Skills 管理 | 技能浏览 / 安装 / 卸载 |
| Tools 开关 | 16 toolset 控制 |
| 模型管理 | 多 Provider 模型 CRUD |
| Gateway 管理 | 启动 / 停止 / 重启 |
| MCP 工具桥接 | corey-native 桌面工具 |
| Soul 编辑 | SOUL.md 人格编辑器 |
| 安装器 | macOS / Windows 一键安装 |
| i18n | en / zh 双语 |

### Corey Pro（付费，赚钱）

| 功能 | 说明 | 定价理由 |
|------|------|---------|
| 白标系统 | customer.yaml → 品牌定制 | 企业刚需 |
| 行业 Pack | 跨境电商 / 客服等行业技能包 | 核心差异化 |
| 工作流引擎 | DAG 编排 + 定时触发 | 生产力工具 |
| 多 Agent 适配器 | Claude Code / Aider 协同 | 开发者付费点 |
| 知识库 RAG | BGE-M3 语义搜索 | 企业知识管理 |
| 安全 Guard | file-ops-guard 跨平台保护 | 合规需求 |
| Budget 预算控制 | Token / 费用上限 | 成本管控 |
| Analytics 统计 | 用量 / 费用 / 延迟面板 | 企业可观测性 |
| Trajectory 轨迹 | 会话工具调用时间线可视化 | 调试效率 |
| 定时工作流 | Cron + 工作流自动执行 | 自动化需求 |
| 优先技术支持 | Slack / 专属群 | 服务溢价 |
| 客户定制服务 | 按需开发行业功能 | 高客单价 |

### 对比表（README 用）

| | Hermes Desktop | Corey Free | Corey Pro |
|---|---|---|---|
| 体积 | ~200 MB (Electron) | ~15 MB (Tauri) | ~15 MB (Tauri) |
| 内存 | 200-400 MB | 50-100 MB | 50-100 MB |
| 知识库 RAG | ❌ | ❌ | ✅ BGE-M3 |
| 工作流 | ❌ | ❌ | ✅ DAG |
| 多 Agent | ❌ | ❌ | ✅ |
| 安全 Guard | ❌ | ❌ | ✅ |
| 白标定制 | ❌ | ❌ | ✅ |
| Analytics | ❌ | ❌ | ✅ |
| Trajectory | ❌ | ❌ | ✅ |
| 开源 | MIT | MIT | 闭源 |

## 四、技术准备

### 4.1 剥离开源版代码

需要从 CoreyOS 仓库中移除或隔离的模块：

- `src-tauri/src/customer/` — 白标系统
- `src-tauri/src/ipc/knowledge.rs` — 知识库（Pro 保留 Jaccard，Pro 解锁 BGE-M3）
- `src-tauri/src/ipc/embedding.rs` — BGE-M3 向量检索
- `src-tauri/src/ipc/workflow.rs` — 工作流引擎
- `src-tauri/assets/corey-guards/` — 安全 Guard
- `src/features/workflow/` — 工作流前端
- `src/features/knowledge/` — 知识库前端（保留 UI 占位 + 🔒 标签）
- `src/features/trajectory/` — 轨迹可视化（保留 UI 占位）
- `src/features/analytics/` — 统计面板（保留 UI 占位）
- `src/app/baseSoul.ts` 中的 Pack 引用
- 代码注释中的客户名称 / 内部术语

### 4.2 Pro 功能占位 UI

Free 版中 Pro 功能页面不删除，改为：

- 页面可见，展示功能说明 + 截图
- 操作按钮显示 🔒 Pro 标签
- 点击弹出升级引导（定价页 / 购买链接）
- 侧边栏底部显示 "Corey Free → Upgrade to Pro"

### 4.3 Release 准备

三平台构建：

- macOS (Apple Silicon) — .dmg
- macOS (Intel) — .dmg
- Windows — .exe (NSIS)

## 五、推广策略

### 5.1 Hermes 社区（核心流量源）

hermes-desktop 的 1365 星全部来自 Hermes Agent 社区，用同样方式获取：

1. GitHub Discussions 发帖介绍 Corey
2. Hermes Discord 频道展示功能
3. 给 hermes-agent 提 PR/Issue 时带 Corey 签名
4. 写 "Hermes Agent + Corey: 5 分钟搭建 AI 工作站" 教程

### 5.2 中文社区（蓝海）

hermes-desktop 的中文翻译是机器翻译水平，Corey 原生中文支持：

- 掘金 / V2EX / 知乎 发技术文章
- B 站录 5 分钟演示视频
- 微信群 / 即刻 / 小红书 发截图

### 5.3 英文社区

- Product Hunt 发布
- Hacker Valley / Reddit r/LocalLLaMA 发帖
- Dev.to / Medium 写对比测评

## 六、定价

| 层级 | 价格 | 目标用户 |
|------|------|---------|
| Free | $0 | 个人开发者，引流 |
| Pro | $19/月 或 $149/年 | 小团队，知识库 + 工作流 + 多 Agent |
| Team | $49/月/seat | 企业，Analytics + 预算控制 + 优先支持 |
| White-label | $499/月 + 定制费 | 行业客户，白标 + 行业 Pack + 定制 |

付费渠道：Stripe / LemonSqueezy

## 七、时间线

### 第 1 周：代码剥离

- 从 CoreyOS 仓库创建 Corey 开源分支
- 移除白标 / Pack / 客户定制代码
- 保留 Pro 功能的 UI 占位（🔒 标签）
- 清理代码注释中的敏感信息
- 确保 `cargo test` + `pnpm build` 通过

### 第 2 周：打磨发布素材

- 英文 + 中文双版 README
- 录制 GIF 演示（聊天 + 工具调用 + 安装流程）
- 准备三平台 Release artifact
- 设计 Logo + 品牌 VI

### 第 3 周：发布 + 推广

- GitHub Release + README 上线
- Hermes Discord / Discussions 发帖
- 中文社区（掘金 / V2EX）发技术文章
- Product Hunt 发布
- 开通付费渠道

### 第 4 周：反馈 + 迭代

- 处理 GitHub Issue
- 根据用户反馈调整 Free / Pro 边界
- 收集第一批 Pro 付费用户反馈
- 优化转化漏斗

## 八、风险

| 风险 | 应对 |
|------|------|
| 白标逻辑泄露 | 开源分支完全移除 customer 模块，不留痕迹 |
| 竞品 fork 抢客户 | Pro 功能闭源，核心壁垒在行业 Pack 和定制服务 |
| 开源维护负担 | 先做小规模发布（GitHub Release only），不承诺社区支持 SLA |
| Hermes Agent 更新破坏兼容 | 已有 `HERMES_MIN_SUPPORTED` / `HERMES_MAX_TESTED` 版本门控 |
| 定价不合理 | 第一个月按年付 50% 折扣试水，根据转化率调整 |

## 九、成功指标

| 指标 | 1 个月目标 | 3 个月目标 | 6 个月目标 |
|------|-----------|-----------|-----------|
| GitHub Stars | 500 | 2,000 | 5,000 |
| 下载量 | 1,000 | 10,000 | 50,000 |
| Pro 付费用户 | 5 | 30 | 100 |
| 月收入 (MRR) | $500 | $3,000 | $10,000 |

---

*文档创建：2026-05-12*
*基于 hermes-desktop 代码分析 + CoreyOS 产品战略讨论*
