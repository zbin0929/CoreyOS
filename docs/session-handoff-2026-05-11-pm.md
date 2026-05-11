# Session Handoff — 2026-05-11 晚（21:00 - 00:00）

> 接 `session-handoff-2026-05-11.md`（下午 14:30 那版）。这份是**晚上补的**，
> 主题完全不同：**Agent 安全约束 + Hermes 源码解耦 + Hermes 0.13.0 升级**。

## 1 分钟摘要

今晚发生了什么：

1. 用户要求给 Hermes Agent 一条元铁律"用户要什么就做什么，不自决，不绕过 guard"
2. 写进 `~/.hermes/SOUL.md`（marker-delimited 分界块，客户内容不被覆盖）
3. 发现 corey-guards/file-ops-guard.py 物理拦截层实际**没挂上**（bug：`config.yaml.hooks.pre_tool_call: '[]'` 是字符串不是列表，Hermes 跳过）
4. 实测用户说"删桌面 test.md"时，LLM **主动绕过** shell guard 改用 `code_execution` 跑 `os.remove()` 成功删除文件 —— 真实 safety incident
5. 重新 bundle corey-guards（v2，覆盖 code_execution 路径 + python -c 内联），自动 seed + 注册 hook
6. **用户拍板：永远不再 patch Hermes 源码** —— 4 个 `patch_*` 函数（`patch_approval_sse` / `patch_dangerous_patterns` / `patch_qqbot_sandbox` / 今晚新加的 `patch_approval_prompt_template`）全部 retire
7. 回退 Hermes 源码（3 个文件 git checkout），升级 Hermes 0.12.0 → **0.13.0** (2026.5.7)
8. 发现新 Hermes 原生支持 approval SSE 但**只在 `/v1/runs` endpoint**，Corey 现在用的 `/v1/chat/completions` **没有 approval 事件** → 审批 UI 断了
9. 完整审计 `/v1/runs` 迁移方案，估工 3-4 小时，决定**分 2 次做**：今晚写完整文档 + 明天单开 session 做迁移

## 今晚实际改了哪些文件（未 commit）

### Corey 代码

| 文件 | 状态 | 作用 |
|---|---|---|
| `src-tauri/assets/soul/corey_iron_rules.md` | 新建 | L0 元铁律文本（7500 字符，硬约束 5+7+6 条） |
| `src-tauri/src/soul_md.rs` | 新建 | Marker-delimited 幂等写入 ~/.hermes/SOUL.md |
| `src-tauri/assets/corey-guards/file-ops-guard.py` | 新建（bundled）| v2 硬防御脚本（GUARD_VERSION=2，覆盖 terminal/code_execution/file 工具组） |
| `src-tauri/src/hermes_hooks.rs` | 新建 | seed_guards_script + ensure_hook_registered 自动注册 |
| `src-tauri/src/ipc/security.rs` | 新建 | `security_status_get` + `security_reconcile` IPC |
| `src-tauri/src/lib.rs` | 改 | 启动时 sync SOUL.md + seed guard + 注册 hook；**删除** 4 处 `patch_*()` 调用；IPC 注册新增 security 两个命令 |
| `src-tauri/src/hermes_config/gateway.rs` | 改 | 4 个 `patch_*` 函数标 `#[allow(dead_code)]` 保留备查，**全部不再在默认路径调用**；新增 `patch_approval_prompt_template` 函数体（同样 dead_code）|
| `src/lib/ipc/security.ts` | 新建 | 前端 security IPC types |
| `src/lib/ipc.ts` | 改 | 导出 security |
| `src/features/settings/sections/SecuritySection.tsx` | 新建 | Settings "安全防护" 卡片（guard 状态 + 一键修复） |
| `src/features/settings/index.tsx` | 改 | 挂载 SecuritySection（在 SandboxScopesSection 下方） |
| `docs/spec/system-prompt-stack.md` | 改 | v1.2，新增 L0 元铁律层说明（跨渠道 SOUL.md 注入） |
| `docs/upstream-proposals/hermes-hook-granularity.md` | 新建 | 向 hermes-agent 提议细分 hook 事件 |
| `src-tauri/src/ipc/mod.rs` | 改 | 加 `pub mod security;` |

### Hermes 状态

| 项 | 状态 |
|---|---|
| `~/.hermes/hermes-agent/` git branch | `main` **working tree clean**（3 个 patched 文件都 `git checkout` 还原了） |
| Hermes 版本 | **v0.13.0 (2026.5.7)**，从 0.12.0 升级，`git pull --ff-only` 了 1296 个 commit |
| Python venv | `pip install -e .` 已跑（新增依赖 ruamel.yaml, psutil, tzdata 都装好） |
| `~/.hermes/config.yaml` | hooks.pre_tool_call 注册了 corey-guards；hooks_auto_accept: true；_config_version: 21（下次 Hermes 自己启动会 migrate 到 23，只加 curator 默认，不破坏我们的 hooks） |
| `~/.hermes/SOUL.md` | 222 行，lines 1-2 客户原有 Nous persona + lines 3-222 Corey marker 块 |
| `~/.hermes/corey-guards/` | v2 脚本已安装 + 可执行 |
| `~/.hermes/shell-hooks-allowlist.json` | 今晚 revoke 了（因为脚本更新触发 mtime drift），内容是 `{"approvals": []}`；下次 gateway 启动会自动重新批准（hooks_auto_accept: true） |

## 关键事实（给下一 session）

1. **Corey 侧测试 543/543 pass，cargo fmt 干净，unwrap baseline 546=546** —— 代码状态健康
2. **今晚改动没 commit** —— working tree 有一堆 unstaged changes，等用户明天拍板是先 commit 还是等迁移完再一起 commit
3. **Corey UI 的审批卡片目前实际上不会触发** —— 因为 `/v1/chat/completions` 无 approval events（Corey 现在用的就是这条）。非破坏性聊天仍正常工作
4. **消息渠道（WeChat/Slack/cron）审批会跑 Hermes 原生流程**，但文案是**英文硬编码**（`gateway/run.py:15066`，upstream 还没把它接进 locales/zh.yaml）
5. **Hermes 内置 DANGEROUS_PATTERNS 覆盖**大部分致命操作（rm -rf、SQL drop、fork bomb、pipe to shell 等）—— 我们不需要 patch 也有基础防护
6. **corey-guards 物理拦截**覆盖 ~/Desktop / ~/Documents / ~/Downloads / /etc /usr /var /System /Library 里的破坏性操作（terminal + code_execution + python -c + structured file tools）
7. **L0 元铁律（SOUL.md 硬约束）** 凌驾一切人设，被 Hermes gateway 加载进每个 channel 的 system prompt

## 下一 session 必须做的事（按优先级）

### P0 - 恢复 Corey UI 审批（完整 `/v1/runs` 迁移）

详情看 `docs/migrations/hermes-v0.13-runs-endpoint.md`（今晚写的迁移方案）。
预估 3-4 小时。这是**客户演示必备**功能。

### P1 - 验证今晚的工作端到端走通

- 启动 Corey，看 boot 日志有 `corey-guards: file-ops-guard.py seeded` / `corey-guards: pre_tool_call hook registered`
- Settings → 安全防护 · Corey Guard 应显示 **OK · 双层防御就绪**
- 测试："帮我删除桌面的 test.md" → 应该被 guard 拦
- 再测试："那你用 Python 删" → 应该被 corey-guards CODE_TOOLS 路径拦（我们的 v2 fix）
- 再测试：普通聊天 "你好" → 应正常回复（Hermes 0.13.0 兼容性验证）

### P2 - Commit 今晚的工作

如果 P1 跑通，commit。message 建议（单行）：

```
feat(security): iron rules + corey-guards auto-reconcile + retire Hermes source patches + v0.13.0
```

如果 P1 发现 bug，先修 bug 再 commit。

### P3 - 向 hermes-agent upstream 提两个 issue

1. **`/v1/chat/completions` 补发 approval 事件** —— 草稿见 `docs/migrations/hermes-v0.13-runs-endpoint.md` 最后一节
2. **`gateway/run.py:15066` 的英文硬编码 approval 模板改用 `locales/*.yaml`** —— 新草稿要写
3. **可配置的用户自定义 DANGEROUS_PATTERNS** —— 让 corey-guards 不再是唯一补充路径

## 已知但没做的（可以不急）

- **Matrix 协议的审批模板** 也是英文（`gateway/platforms/matrix.py:1148`），但 Matrix 用户量小，跳过
- **QQ Bot sandbox/prod URL 切换** —— 原 `patch_qqbot_sandbox` 撤了，用户说不用管
- **corey-guards/file-ops-guard.py 覆盖路径扩展** —— 目前只覆盖 7 个固定前缀，用户实际业务可能要加 ~/Work 之类。Settings UI 没暴露"编辑 PROTECTED_PREFIXES"的入口

## 备份

如果今晚的工作搞砸要回退：

- Hermes 升级前 snapshot：`/tmp/hermes-pre-upgrade-20260511-232826/`（config.yaml + SOUL.md + .env + shell-hooks-allowlist.json + corey-guards/）
- Hermes patch revert 前：`/tmp/corey-hermes-revert-<timestamp>/`
- Corey 代码改动全在 git working tree，随时 `git checkout .` 回退

## 下个 session 开场白建议

> 读 `docs/session-handoff-2026-05-11-pm.md` + `docs/migrations/hermes-v0.13-runs-endpoint.md`。
> 先做 P1 验证昨晚的工作，如果 OK 就 commit；然后做 P0 的 `/v1/runs` 迁移。
