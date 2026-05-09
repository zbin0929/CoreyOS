# Phase C · 工程质量提升

**Status**: ✅ Shipped

**Goal**: 消除定时炸弹，提升可维护性。聚焦文档同步、组件拆分、错误边界和 IPC 类型安全评估。

**Est.**: 2–3 天。

**Depends on**: Phase A 完成。

---

## 退出标准

1. `docs/01-architecture.md` 中的技术栈描述与实际 `package.json` / `Cargo.toml` 完全一致。
2. `ChatRoute` 组件行数减少 50%+，逻辑拆分为 3–4 个自定义 Hook。
3. 每个懒加载的功能路由被 `ErrorBoundary` 包裹，单个模块崩溃不影响全局。
4. IPC 类型安全方案完成评估（引入或不引入 specta，有明确结论）。
5. `pnpm typecheck` + `pnpm lint` + `pnpm test` 全绿。

---

## 任务拆解

### C1 · 文档清理 — 同步 01-architecture.md 与实际代码

**~0.5 天**

文档中声称使用了以下依赖，但实际 `package.json` / `Cargo.toml` 中不存在：

| 文档中的声明 | 实际状态 |
|---|---|
| `sqlx` | 实际用 `rusqlite` (bundled) |
| `keyring` | 未在 Cargo.toml 中 |
| `shiki` | 实际用 `highlight.js` |
| `react-hook-form` + `zod` | 未在 package.json 中 |
| `Recharts` + `D3` | 未在 package.json 中 |
| `TanStack Virtual` | 实际用 `react-virtuoso` |
| `store/` 目录 (sqlx migrations) | 实际用 `db.rs` (rusqlite) |
| `secrets.rs` | 不存在 |

**涉及文件**: `docs/01-architecture.md`

### C2 · ChatRoute 拆分 — 提取 Hook + 子组件

**~1 天**

当前 `src/features/chat/index.tsx` 的 `ChatRoute` 组件承担了过多职责。拆分为：

- `useChatSession.ts` — 会话管理 (CRUD + hydrate)
- `useChatStream.ts` — 流式消息发送/接收/cancel
- `useChatAttachments.ts` — 附件 stage/delete/preview
- `ChatComposer.tsx` — 底部输入区 (textarea + 附件 + 发送按钮)

### C3 · Error Boundary — 每个功能路由添加错误边界

**~0.5 天**

在 `routes.tsx` 中为每个懒加载路由添加 `ErrorBoundary` 包裹。

### C4 · IPC 类型安全评估

**~0.5 天**

评估是否引入 `tauri-specta` 自动生成 TS 绑定。输出为评估文档，不一定立即实施。

---

## 不做的事

- 不改变 IPC 命名或签名
- 不改变数据模型
- 不引入新依赖（除非 C4 评估后决定引入 specta）
