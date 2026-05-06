# 怎么测 Workflow Tool Step（B-10.4）

> 给完全没接触过 MCP 的人看的最小可工作指南。10 分钟内能跑通。

## 一、前置：MCP server 是什么？

MCP（Model Context Protocol）= 一种约定，让外部进程通过 JSON-RPC 暴露一组「工具」给 LLM 调用。Hermes Agent 已经支持读 `~/.hermes/config.yaml` 里的 `mcp_servers:` 段，把它们启动起来。

CoreyOS workflow 的 tool step（B-10.4）现在能直接复用这些 server —— 你只需要在 `tool_name` 里写 `mcp:<server>:<tool>` 格式。

## 二、最简单的测试路线：用 `filesystem` MCP server

`@modelcontextprotocol/server-filesystem` 是官方维护的最小 MCP server，read/write/list 文件。零网络依赖，零 API key。

### Step 1：装 Node 跑环境

```bash
node --version  # 需要 ≥ 18
```

没装就 `brew install node`（macOS）或去 nodejs.org 下。

### Step 2：编辑 `~/.hermes/config.yaml`

如果文件不存在就新建。把以下加到 `mcp_servers:` 节点下（**注意**：如果该节点已存在，只追加 `fs-test` 这一项）：

```yaml
mcp_servers:
  fs-test:
    command: npx
    args:
      - -y
      - "@modelcontextprotocol/server-filesystem"
      - /tmp/corey-mcp-test
```

然后建测试目录 + 一个文件：

```bash
mkdir -p /tmp/corey-mcp-test
echo "hello from MCP" > /tmp/corey-mcp-test/test.txt
```

### Step 3：在 CoreyOS 里建 workflow

`/workflows` → 新建 → 切到 YAML 视图，粘下面这个：

```yaml
id: mcp-smoke
name: MCP 冒烟测试
description: 用 filesystem MCP server 读 /tmp 下的文件
trigger:
  type: manual
inputs: []
steps:
  - id: read-file
    name: 读 test.txt
    type: tool
    tool_name: "mcp:fs-test:read_file"
    tool_args:
      path: /tmp/corey-mcp-test/test.txt
    timeout_minutes: 1
```

保存 → 运行（Run）。

### Step 4：看结果

`/tasks` 看这条 run 的状态：
- ✅ **`completed`** + 步骤输出包含 `hello from MCP` → tool step 真打到了 MCP server，B-10.4 链路通
- ❌ `failed` + 错误是 `mcp tool error: server 'fs-test' not found in config.yaml` → `~/.hermes/config.yaml` 没生效，重启 CoreyOS 一次（或者 `/settings` → "Restart gateway"）
- ❌ `failed` + 错误是 `tool step expects 'mcp:<server>:<tool>' format` → tool_name 写错了，必须是冒号分隔
- ❌ `failed` + `npx: command not found` → npx 不在 PATH，装下 Node

## 三、测 retry / on_error / timeout 组合

把上面 workflow 改成下面这个，一次验证 B-10.1 / B-10.2 / B-10.3：

```yaml
id: mcp-resilience
name: MCP 容错测试
trigger:
  type: manual
inputs: []
steps:
  # 1. 故意指向不存在的文件 → 必失败
  - id: read-missing
    name: 读不存在的文件（必失败）
    type: tool
    tool_name: "mcp:fs-test:read_file"
    tool_args:
      path: /tmp/corey-mcp-test/does-not-exist.txt
    timeout_minutes: 1
    retry:
      max: 2
      backoff_seconds: 1
      exponential: false
    on_error: handler
  # 2. 当主 step 失败 → 跳到这里
  - id: handler
    name: 错误处理（用现存文件兜底）
    type: tool
    tool_name: "mcp:fs-test:read_file"
    tool_args:
      path: /tmp/corey-mcp-test/test.txt
    after: []
```

**预期行为**：
- `read-missing` 重试 3 次（initial + 2 retries），每次间隔 1s → 全失败
- 触发 `on_error: handler` → handler 跑成功
- **整个 run 状态 = `completed`**（不是 `failed`），因为 on_error 接住了

`/tasks` 点开这条 run，能看到：
- `read-missing` 状态 `failed`，error 字段有 ENOENT / no such file
- `handler` 状态 `completed`，输出是 `hello from MCP`
- run 总状态 `completed`

如果你想看 timeout 真实生效，把 `timeout_minutes: 1` 改成 `timeout_minutes: 0`（注意：当前 schema 是 u32，0 会被当成 None 用默认 5min；要严格触发用一个极小值需要后续支持秒级精度）。或者改 `retry.backoff_seconds: 999` 让重试自己撑爆。

## 四、`tool_name` 格式硬性规则

| 写法 | 接受？ | 说明 |
|---|---|---|
| `mcp:fs-test:read_file` | ✅ | 标准格式 |
| `mcp:amazon-sp-api:get_orders` | ✅ | server 名可含连字符 |
| `read_file` | ❌ | 没 `mcp:` 前缀 → 报错 |
| `mcp:fs-test` | ❌ | 缺 tool 部分 → 报错 |
| `mcp_fs-test_read_file` | ❌ | 用了下划线，被解析成单一字符串 |
| `fs-test:read_file` | ❌ | 缺 `mcp:` 前缀 |

错误信息：`tool step expects 'mcp:<server>:<tool>' format, got '<...>'`。

## 五、其他可用的免费 MCP server

- **`@modelcontextprotocol/server-memory`** — 内存 KV，适合测 set/get 链路
- **`@modelcontextprotocol/server-fetch`** — HTTP fetch（Python 实现，需要 `pipx`）
- **`@modelcontextprotocol/server-git`** — 仓库 git 操作
- **`@modelcontextprotocol/server-sqlite`** — SQLite 数据库

完整列表：<https://github.com/modelcontextprotocol/servers>

每个都是 `command + args` 配置，跟 `fs-test` 一样的形状。

## 六、Stagehand / Browser tool（B-10.5 后续）

Browser step（type: browser）走的是另一条链路——不是 MCP，而是子进程跑 `scripts/browser-runner.cjs`（Stagehand + Playwright）。需要你配一个 LLM key（OpenAI / DeepSeek 等）才能驱动。这块单独测，跟 tool step 互不干扰。

## 七、跑不通时检查清单

1. `cat ~/.hermes/config.yaml | grep -A5 mcp_servers` 看有没有写进去
2. CoreyOS 重启一次（gateway 不热加载 config，需要重启 — HD-9 规则）
3. `/settings` → MCP 页面看 `fs-test` 是否在列表里、probe 是否绿
4. `/logs` 看 `tool step start` / `tool step done` / `tool step failed` 的 tracing 输出
5. 确认 `tool_name` 用冒号分隔，全部小写无空格
6. 确认 `path` 在 `mcp_servers.fs-test.args` 里允许的目录下（filesystem server 沙盒到 args 指定的根目录）

## 八、源码定位

- 解析 `mcp:<server>:<tool>` 格式：`@/Users/zbin/AI项目/CoreyOS/src-tauri/src/ipc/workflow/mod.rs:404-472`
- 真正调 MCP server：`@/Users/zbin/AI项目/CoreyOS/src-tauri/src/ipc/pack.rs:375-468`（HTTP + stdio 两条传输都走这里）
- Engine tool step 路由：`@/Users/zbin/AI项目/CoreyOS/src-tauri/src/workflow/engine/mod.rs:690-713`
- 单元测试（mock executor）：`@/Users/zbin/AI项目/CoreyOS/src-tauri/src/workflow/engine/tests.rs:961-1105`
