# C4 · IPC 类型安全评估

**Status**: ✅ Resolved (manual TS bindings)
**日期**: 2026-04-25
**结论**: 暂不引入 tauri-specta，维持手动 TS 绑定

## 评估内容

评估是否引入 [tauri-specta](https://github.com/specta-rs/tauri-specta) 自动从 Rust IPC 命令生成 TypeScript 类型绑定，消除 Rust↔TS 参数名/类型的手动同步风险。

## 当前状态

| 指标 | 数值 |
|---|---|
| Rust IPC 命令数 | ~55 个 |
| TS 手动绑定行数 | ~1750 行 (ipc.ts) |
| 类型不对齐 bug 历史 | 0（自检审查确认） |

## 方案对比

| 方案 | 优点 | 缺点 |
|---|---|---|
| **A: 维持手动绑定** | 零依赖；完全可控；IPC.ts 是单一真相源 | 新增 IPC 需手动同步 |
| **B: 引入 tauri-specta** | 自动生成 TS 类型；编译时保证一致 | 新依赖；构建流程变复杂； specta 对 Tauri 2 支持尚在 beta；生成的代码可能不符合项目风格 |

## 决策

**选 A：维持手动绑定。** 理由：

1. **规模可控** — 55 个 IPC 命令，手动维护成本可接受。每次新增 IPC 的 code review 会自然检查参数名一致性。
2. **tauri-specta 成熟度** — 对 Tauri 2 的支持仍在快速迭代中，引入后有 breaking risk。
3. **项目风格** — `ipc.ts` 的注释风格和 export 结构与项目一致，自动生成代码会打破这个一致性。
4. **已有保障** — 自检流程中会核对 Rust 参数名 vs TS invoke 参数名（`snake_case` → `camelCase` 自动转换）。

## 缓解措施

如果 IPC 数量超过 100 个或出现类型不对齐 bug，重新评估引入 specta。

建议在 CI 中添加一个轻量检查脚本：对比 Rust `#[tauri::command]` 函数签名和 `ipc.ts` 中的 invoke 调用参数名。
