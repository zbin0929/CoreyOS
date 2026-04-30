# 01 · Architecture

## High-level

```
┌───────────────────────────────────────────────────────────────────┐
│                         Corey (Tauri app)                      │
│                                                                   │
│  ┌──────────────────────────┐      ┌──────────────────────────┐   │
│  │  Frontend  (React SPA)   │◄────►│  Rust core  (Tauri 2)    │   │
│  │                          │ IPC  │                          │   │
│  │  • shadcn/ui + Tailwind  │      │  • HTTP client (reqwest) │   │
│  │  • TanStack Router/Query │      │  • SSE / WS streams      │   │
│  │  • Zustand (UI state)    │      │  • File I/O (~/.hermes)  │   │
│  │  • ⌘K command palette    │      │  • PTY (portable-pty)    │   │
│  │  • i18n (en / zh)        │      │  • AgentAdapter registry │   │
│  └──────────────────────────┘      └──────────┬───────────────┘   │
└───────────────────────────────────────────────┼───────────────────┘
                                                │
                                                ▼
                 ┌───────────────────────────────────────────────┐
                 │  AgentAdapter implementations                 │
                 │                                               │
                 │  • HermesAdapter                              │
                 │     ├─ Gateway HTTP :8642 (OpenAI-compatible) │
                 │     ├─ Hermes CLI (sessions, logs, version)   │
                 │     └─ ~/.hermes/{auth.json, config.yaml,.env}│
                 │                                               │
                 │  • ClaudeCodeAdapter  (Phase 5)               │
                 │  • AiderAdapter       (Phase 5)               │
                 │  • OpenHandsAdapter   (Phase 5)               │
                 └───────────────────────────────────────────────┘
```

Key contrast with `hermes-web-ui`: no separate Koa BFF. Rust core owns everything the BFF did (proxy, SSE, file I/O, PTY, config writes), and the frontend talks to it via typed Tauri commands — no HTTP round-trip for local operations.

## Process model

- **1 process** (Tauri) with two logical halves: webview + Rust main.
- **0 long-lived subprocesses** owned by Corey. Hermes Gateway runs under its own profile manager; Corey only starts/stops it on demand.
- **Web-only mode** (`pnpm dev` without Tauri): Rust core is replaced by a thin Node shim that exposes the same command surface over HTTP, for VPS / phone scenarios. Designed from day 1 so adapters don't care which transport they're on.

## Tech stack (locked)

| Layer            | Choice                                     | Why                                              |
|------------------|--------------------------------------------|--------------------------------------------------|
| Shell            | Tauri 2                                    | Small binary, Rust core, native menus, auto-update |
| Frontend build   | Vite 5                                     | Fast HMR, canonical for Tauri                    |
| UI framework     | React 18                                   | Ecosystem, shadcn/ui availability                |
| Language         | TypeScript (strict)                        | Safety, refactorability                          |
| Router           | TanStack Router                            | Type-safe routes, search-param state             |
| Data fetching    | TanStack Query                             | Cache, streaming, retries                        |
| UI state         | Zustand                                    | Minimal, no context churn                        |
| Components       | shadcn/ui                                  | Own the source, restyle freely                   |
| Styling          | Tailwind CSS 3 + CSS variables             | Token-driven theming                             |
| Icons            | Lucide + custom glyph set                  | Consistent line weight                           |
| Charts           | (none — Analytics renders KPI cards + simple activity bar from SQLite aggregates) | Custom lightweight charts; no charting library in bundle |
| Markdown         | react-markdown + remark-gfm + highlight.js | Server-free syntax highlighting                  |
| Virtualization   | react-virtuoso                             | Bottom-pin + dynamic row heights for chat        |
| Command palette  | cmdk                                       | Battle-tested, a11y-correct                      |
| Forms            | native HTML form + controlled components   | Lightweight; no form library needed for current form complexity |
| i18n             | react-i18next                              | en / zh out of the box                           |
| Animation        | Framer Motion                              | Layout transitions, modal motion                 |
| Testing          | Vitest + Testing Library + Playwright      | Unit + e2e; Playwright drives Tauri via webdriver |
| Rust HTTP        | reqwest + tokio + eventsource-stream       | SSE support, async-first                         |
| Rust PTY         | portable-pty                               | Cross-platform terminal                          |
| Rust IPC types   | hand-written mirrors in `src/lib/ipc.ts`   | Originally planned specta + tauri-specta; in practice the interface stayed stable and the hand-written mirrors are cheaper to reason about. Revisit if the IPC surface churns rapidly. |
| Rust config      | serde_yaml, serde_json                      | Read/write Hermes configs                        |
| Rust secrets     | (none — API keys in ~/.hermes/.env with 0600 perms) | Hermes-compatible; OS keyring not currently wired |

## Data flow — three canonical paths

### A. Chat streaming (hot path)

```
User input ─► Frontend Chat store
                │
                ▼
     invoke('chat_send', { sessionId, message })
                │
                ▼
     Rust: HermesAdapter.sendMessage()
                │
          POST /v1/chat/completions (stream=true) to Hermes gateway
                │
     SSE chunks ─► Tauri event 'chat:delta' with session-scoped payload
                │
                ▼
     Frontend subscribes via useChatStream(sessionId)
                │
                ▼
     React reducer appends deltas, re-render is virtualized
```

- Backpressure: Rust side buffers with a bounded channel (capacity 256 chunks) and drops intermediate re-renders if frontend is behind; final message is always consistent.
- Cancellation: `invoke('chat_cancel', { sessionId })` drops the HTTP connection and emits `'chat:cancelled'`.

### B. Configuration write (safety-critical)

```
User edits form (Telegram token) ─► native form validation
                │
                ▼
     invoke('config_set', { path: '.env', key: 'TELEGRAM_BOT_TOKEN', value })
                │
                ▼
     Rust:
       1. load existing ~/.hermes/.env
       2. write atomically (tmpfile + rename)
       3. fsync
       4. compute diff, return { before, after }
                │
                ▼
     Frontend shows diff modal, user confirms gateway restart
                │
                ▼
     invoke('gateway_restart', { profileId })
```

Every config write is atomic, produces a diff, and is journaled to `~/.corey/changelog.jsonl` for undo.

### C. Terminal (PTY)

```
Frontend opens tab ─► invoke('pty_spawn', { cwd, cols, rows, env })
                          │
                          ▼
     Rust spawns shell via portable-pty, returns ptyId
                          │
                          ▼
     Bidirectional:
       • frontend → 'pty:input'  event → Rust writes to PTY
       • Rust reader → 'pty:output:{id}' Tauri event → xterm.js writes
                          │
                          ▼
     Resize: invoke('pty_resize', { ptyId, cols, rows })
     Close:  invoke('pty_kill',   { ptyId })
```

## Repo layout (after Phase 0)

```
caduceus/
├── README.md
├── docs/                          # this folder
├── pnpm-workspace.yaml
├── package.json
├── src-tauri/                     # Rust core
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   └── src/
│       ├── main.rs
│       ├── lib.rs
│       ├── ipc/                   # Tauri command handlers (hand-written TS mirrors in src/lib/ipc.ts)
│       │   ├── chat.rs
│       │   ├── config.rs
│       │   ├── model.rs
│       │   ├── session.rs
│       │   ├── pty.rs
│       │   └── log.rs
│       ├── adapters/
│       │   ├── mod.rs             # AgentAdapter trait
│       │   ├── hermes/
│       │   │   ├── mod.rs
│       │   │   ├── gateway.rs     # HTTP + SSE
│       │   │   └── probe.rs       # Gateway health probe
│       │   ├── claude_code/       # Phase 5 (mock)
│       │   └── aider/             # Phase 5 (mock)
│       ├── db/                    # SQLite persistence, split by domain (2026-04-26)
│       │   ├── mod.rs             # `Db` struct + open/open_in_memory + re-exports
│       │   ├── migrations.rs      # PRAGMA user_version v1..v11
│       │   ├── sessions.rs        # SessionRow + load_all
│       │   ├── messages.rs        # MessageRow / ToolCallRow / AttachmentRow + embedding
│       │   ├── analytics.rs       # rollups for the Analytics page
│       │   ├── runbooks.rs        # T4.6 runbook templates
│       │   ├── budgets.rs         # T4.4 cost caps
│       │   ├── skills_history.rs  # v9 skill version snapshots
│       │   └── knowledge.rs       # knowledge_docs / knowledge_chunks
│       ├── sandbox/               # path access control (split 2026-04-26)
│       │   ├── mod.rs             # docs + re-exports
│       │   ├── types.rs           # AccessMode/Op + WorkspaceRoot/Scope + SandboxError
│       │   ├── denylist.rs        # hard + home-relative denylists
│       │   ├── authority.rs       # PathAuthority state machine + check_scoped
│       │   ├── persistence.rs     # sandbox.json reader/writer
│       │   └── fs.rs              # sandbox-gated read/write helpers
│       ├── fs_atomic.rs           # atomic writes + journal
│       └── error.rs
│
├── src/                           # React frontend
│   ├── main.tsx
│   ├── app/
│   │   ├── routes.tsx             # TanStack Router tree
│   │   ├── providers.tsx          # Query client, theme, i18n
│   │   └── shell/                 # AppShell, sidebar, topbar
│   ├── features/
│   │   ├── chat/
│   │   ├── models/
│   │   ├── analytics/
│   │   ├── scheduler/
│   │   ├── skills/
│   │   ├── memory/
│   │   ├── logs/
│   │   ├── settings/
│   │   ├── profiles/
│   │   ├── channels/              # Phase 3
│   │   ├── compare/               # Phase 4 multi-model
│   │   ├── trajectory/            # Phase 4
│   │   ├── budgets/               # Phase 4
│   │   └── terminal/              # Phase 4
│   ├── components/                # shared shadcn wrappers
│   │   ├── ui/                    # shadcn primitives
│   │   ├── command-palette/
│   │   ├── kbd/
│   │   ├── diff/
│   │   └── …
│   ├── lib/
│   │   ├── ipc.ts                 # hand-written TS mirrors of Rust IPC types
│   │   ├── cn.ts
│   │   ├── i18n.ts
│   │   ├── modelCapabilities.ts
│   │   └── useIsMobile.ts
│   ├── stores/                    # Zustand stores
│   │   ├── chat.ts
│   │   ├── ui.ts
│   │   └── palette.ts
│   ├── styles/
│   │   ├── globals.css
│   │   └── tokens.css             # design tokens
│   └── locales/
│       ├── en.json
│       └── zh.json
│
├── scripts/
│   ├── gen-bindings.ts            # run tauri-specta to emit TS
│   └── release.ts
├── .github/workflows/
│   ├── ci.yml                     # lint, test, build matrix
│   └── release.yml                # tag → sign → upload
└── tests/
    ├── e2e/                       # Playwright
    └── visual/                    # Playwright screenshots
```

## State management rules

- **Server state** (sessions, models, usage, configs) lives in TanStack Query. Single source of truth, cache-first, invalidated by mutations.
- **UI state** (palette open, sidebar collapsed, current theme) lives in Zustand.
- **Stream state** (chat deltas) is a per-session reducer inside a Zustand slice, fed by Tauri event listeners.
- **Form state** is react-hook-form; never mix with Zustand.
- **URL state** (active route, filters) is TanStack Router search params.

## Security

- **Tauri allowlist**: explicit permissions (`fs: ~/.hermes/**`, `shell: none`, `http: only configured agent endpoints`).
- **Secrets**: provider API keys stored in `~/.hermes/.env` with 0600 perms. OS keychain not currently wired; keys are local-file only.
- **CSP**: strict; no `unsafe-eval`. highlight.js uses pre-built grammars.
- **External fetches**: frontend cannot fetch arbitrary URLs; all network calls go through Rust, which enforces the adapter's configured endpoint.
- **Update channel**: Tauri updater with minisign signatures; manifest on GitHub Releases.

## Performance budgets

| Metric                        | Target       |
|-------------------------------|--------------|
| Cold start → interactive      | < 1.0 s      |
| Route transition              | < 100 ms     |
| First chat delta render       | < 80 ms after receipt |
| Idle RAM                      | < 100 MB     |
| 10k-message session scroll    | 60 fps       |
| Bundle (frontend gzipped)     | < 1.5 MB     |
| Installer size (macOS arm64)  | < 20 MB      |

Measured in CI via Playwright tracing + `performance.now()` marks. Phase 0 sets up the measurement rig.

## Observability (self)

- Rust `tracing` → rolling file at `~/.corey/logs/corey.log`.
- Frontend errors captured and forwarded to Rust via `invoke('log_frontend_error', ...)`.
- Opt-in local-only "debug bundle" export: logs + redacted configs for bug reports.
- No external telemetry. Ever.

---

## Pack Architecture (v2.0+)

> 锁定日期：2026-05-01
> 适用范围：v0.2.0 起所有 Pack 加载、白标定制、license 联动、升级流程
> 配套文档：`docs/competitor-maiduo-ai.md`、`docs/global-todo.md`

CoreyOS 商业模式是**只做定制（B2B 直签 + 本地部署）**，不做 SaaS。这套架构所有设计都为这个目标服务。

### 设计铁律（不可妥协）

1. **唯一基座二进制** — 所有客户跑同一个 `Corey.exe` / `Corey.app`，永不维护多版本。客户差异 100% 在数据目录里。
2. **`skill-packs/<id>/` 只读** — 任何 Pack 内代码 / MCP / Skill 试图写入这里都是 bug。运行时数据只能写到 `pack-data/<id>/`。
3. **`pack-data/<id>/` 永不被任何升级覆盖** — 用户资产神圣不可侵犯（配置 / 缓存 / 历史 / 用户自加内容）。
4. **MCP 二进制 vs MCP 运行时数据物理分离** — Pack 启动 MCP 时通过环境变量告知数据目录路径。
5. **Pack 不写 React 代码** — 所有 UI 必须用基座内置的 12 个视图模板组合 + `manifest.yaml` 声明。
6. **manifest `schema_version` 永久向后兼容** — 直到大版本（如 Corey v2.0）才允许 break。
7. **Pack 升级前自动备份** — `pack-data/` 关键文件 zip 到 `~/.hermes/backups/`，保留 7 天。

### 数据目录布局

```
~/.hermes/
│
├── (基座用户数据 — 永不被任何升级动)
│   ├── chat-history.db
│   ├── .env                          API keys
│   ├── skills/                       用户全局 Skill
│   ├── knowledge/                    RAG 知识库
│   ├── workflows/                    用户全局 Workflow
│   ├── machine_id
│   └── license.txt
│
├── models/                           基座管理的大模型（如 BGE-M3）
│   └── bge-m3/                       不属于任何 Pack
│
├── skill-packs/                      Pack 内容（只读 — 升级会替换）
│   └── <pack_id>/
│       ├── manifest.yaml             schema_version + version + 注册声明
│       ├── skills/                   Hermes 原生 .md skills
│       ├── workflows/                Workflow YAML
│       ├── views/                    视图配置（用 12 模板）
│       ├── prompts/                  Pack 自带的 Persona / SOUL 片段
│       ├── data/                     出厂静态数据（关键词词典等）
│       ├── mcp/                      Pack 自带 MCP 二进制（按平台分子目录）
│       │   └── <server>/
│       │       ├── manifest.json     启动方式
│       │       ├── server-darwin-arm64
│       │       ├── server-darwin-x64
│       │       ├── server-windows-x64.exe
│       │       └── server-linux-x64
│       └── assets/                   图标、报告模板等
│
├── pack-data/                        Pack 用户数据（永不被覆盖）⭐
│   └── <pack_id>/
│       ├── config.json               用户填的配置（API key 等）
│       ├── cache/                    MCP 抓回的数据
│       ├── state/                    运行状态
│       ├── user-skills/              用户自加的 Skill（覆盖出厂版）
│       ├── user-workflows/           用户自加的 Workflow
│       ├── reports/                  Pack 生成的历史报告
│       └── mcp/                      MCP 自己产生的运行时数据
│           └── <server>/
│
├── customer.yaml                     白标定制（runtime 加载）
└── backups/                          Pack 升级前自动备份
    └── YYYY-MM-DD-<pack_id>.zip
```

### Pack manifest.yaml schema

```yaml
schema_version: 1
id: <pack_id>
version: "1.0.0"
title: <显示名>
description: <简介>
icon: icon.png
author: CoreyOS

requires:
  corey: ">=0.2.0"                   # 最低基座版本
  templates: [DataTable, MetricsCard, TrendsMatrix, RadarChart, ...]

license_feature: <feature_id>        # license 必须含此 feature 才加载

mcp_servers:
  - id: <server_id>
    type: stdio
    command: ["./mcp/<server>/server-${platform}"]
    env:
      MCP_DATA_DIR: "${pack_data_dir}/mcp/<server>"
      MCP_CACHE_DIR: "${pack_data_dir}/cache"
      <USER_CONFIG_KEY>: "${pack_config.<key>}"
    auto_start: true
    timeout_ms: 30000

skills:                              # 路径相对 Pack 根
  - skills/<skill>.md

workflows:                           # 注册到 /workflow
  - workflows/<workflow>.yaml

schedules:                           # 注册到 cron
  - id: <schedule_id>
    cron: "0 9 * * *"
    workflow: <workflow_id>

views:                               # 注册路由 + 渲染视图
  - id: <view_id>
    title: <显示名>
    icon: <Lucide icon>
    nav_section: pack                # primary / tools / more / pack
    template: <模板名>
    data_source: { mcp: <server_id>, method: <method> }
    actions:                         # 决策归还按钮（嵌入视图旁）
      - { label: <文字>, workflow: <workflow_id>, confirm: false }
      - { label: <文字>, skill: <skill_id> }

config_schema:                       # Pack 启用时表单 / customer.yaml 预填
  - key: <key>
    label: <显示名>
    type: secret | string | number | enum
    required: true
    default: <值>

soul_inject:                         # 注入 Persona（替代单独 Persona 系统）
  - prompts/soul.md

migrations:                          # 跨版本数据迁移
  - from_version: "1.0.0"
    to_version: "1.1.0"
    config_renames:
      old_key: new_key
    config_defaults:
      new_key: default_value
```

### 视图模板清单（基座内置 Tier 1 = 12 个）

所有 Pack 必须用以下 12 个模板组合实现 UI。新增模板需基座升版（全员受益）。

| # | 模板 | 用途 |
|---|------|------|
| 1 | **DataTable** | 通用表格（筛选 / 排序 / 分页 / 状态着色） |
| 2 | **MetricsCard** | KPI 卡片（单值 / 多值 / 同环比） |
| 3 | **TimeSeriesChart** | 折线 / 柱状 / 区域图 |
| 4 | **PivotTable** | 多级行项目展开（P&L / 损益 / 库存分类） |
| 5 | **TrendsMatrix** | 产品 × 时间矩阵 + sparkline + 涨跌着色（Sellerboard 同款） |
| 6 | **Timeline** | 时间轴（货物追踪 / 竞品雷达） |
| 7 | **AlertList** | 异常 / 预警条目列表（红黄绿） |
| 8 | **WorkflowLauncher** | Pack 工作流快捷入口 |
| 9 | **SkillPalette** | Pack Skill 入口按钮组 |
| 10 | **FormRunner** | 表单 → MCP 调用 → 结果展示 |
| 11 | **RadarChart** | 多维评分（六维诊断 / 健康度） |
| 12 | **CompositeDashboard** | 栅格容器（多视图组合，如战场地图） |

每个视图均支持 `actions:` 段嵌入动作按钮，实现"决策归还"模式（分析旁边直接执行 Skill / Workflow）。

### Pack 生命周期

```
[未安装] ─文件夹放进 skill-packs/<id>/─► [已安装/未启用]
                                              │
                                              │ 用户启用 / customer.yaml 预启用
                                              ▼
                              [已启用/license 缺 feature] ─license 含 feature─► [运行中]
                                                                                  │
                                                                                  │ 用户卸载
                                                                                  ▼
                                                                              [已卸载]
```

启用 → 加载操作（基座统一调度）：
1. 解析 manifest，校验 `schema_version` / `requires`
2. 拷贝 `mcp/` 二进制（按平台选）→ 启动子进程 + 注入环境变量
3. 注册 skills / workflows / schedules（打 `pack_id` 标签）
4. 挂载视图路由 `/pack/<pack_id>/<view_id>`
5. 注入 `soul_inject`

禁用 / 卸载：按 `pack_id` 标签批量注销 + 关闭 MCP 子进程。**默认保留** `pack-data/<id>/`，重新安装可恢复。

### 升级数据流

| 场景 | skill-packs/ | pack-data/ | 基座数据 |
|------|------------|----------|---------|
| Corey 基座升级 | 不动 | 不动 | 不动 |
| Pack 升级（v1.0 → v1.1） | **整体替换** | **绝不动**（migration 脚本就地修改） | 不动 |
| Pack 卸载（默认） | 删除 | **保留** | 不动 |
| Pack 卸载（勾选"也删除数据"） | 删除 | 删除 | 不动 |

**Pack 升级前自动备份** `pack-data/<id>/` 到 `backups/YYYY-MM-DD-<pack_id>.zip`，保留 7 天。

### License Features 联动

- `license.txt` 的 `Payload.features` 字段是单一权限源（已有 ed25519 离线签名机制，见 `docs/licensing.zh.md`）
- 每个 Pack `manifest.license_feature` 必须出现在客户 license 的 features 数组中，否则 Pack 不加载（UI 显示"需要授权"占位）
- 不做在线激活、不做心跳、不做联网管控 — 完全离线
- 续费 / 加 Pack = 重新签一张新 license token 发给客户

### MCP 交付：自带预编译二进制（v0.2.0 起）

- Pack 出厂自带跨平台预编译二进制：`darwin-arm64` / `darwin-x64` / `windows-x64` / `linux-x64`
- 启动时按 `${platform}` 模板变量选择正确版本
- **完全离线可用**，客户机器不需要装 Python / Node 运行时
- 超大资产（如 BGE-M3 模型 2.3GB）不进 Pack，走基座 `~/.hermes/models/`，支持在线下载 + 离线 zip 导入两种模式

### customer.yaml 白标定制

`~/.hermes/customer.yaml` 是 runtime 加载的定制配置，**不影响二进制**：

```yaml
brand:
  app_name: "ACME 智能助手"
  logo: "assets/acme-logo.png"
  primary_color: "#FF6B00"

navigation:
  hidden_routes: [analytics, browser]      # 隐藏不需要的基座路由
  pin_to_primary: [battleground, ad-monitor]  # Pack 视图升级到主导航

packs:
  preinstall: [cross_border_ecom]
  config:                                  # Pack 配置预填
    cross_border_ecom:
      amazon_marketplace: "US"
      amazon_refresh_token: "${env:AMAZON_TOKEN}"
```

**交付流程**：
1. 你（开发者）准备好 `customer.yaml` + `skill-packs/<id>/` + `license.txt`
2. 客户拿到同一个 `Corey.exe` + 上述文件 → 解压到 `~/.hermes/` → 启动
3. 客户看到的就是定制好的"ACME 智能助手"，预装跨境电商 Pack

### 不做清单（与"只做定制"冲突，永久砍掉）

- ❌ Skill Pack 商店 UI / 推荐列表 / 分类搜索
- ❌ 在线激活 / JWT / 心跳 / 联网校验
- ❌ 客户管理后台（直签客户用 Notion 记账即可）
- ❌ 通用拖拽式可视化引擎（用 12 模板替代）
- ❌ 远程更新服务后端（手动交付 / GitHub Releases）
- ❌ 单独的 Persona 角色管理系统（并入 Pack `soul_inject`）

详见 `docs/global-todo.md` 第 2 节"已砍清单"。

