# Corey License 系统使用手册

> 给未来的自己看的备忘录。历史英文版已归档至 `docs/archive/licensing-en.md`。

Corey 用一套**离线 ed25519 签名**的方式做激活控制：你（维护者）持有一把私钥，每次有买家就用这把私钥签一段 token；应用启动时用嵌在源码里的公钥验证 token，验过就解锁。**不需要服务器、不需要联网**。

适合：少量用户（几十到几百）、一次性买断或带有效期、**闭源** Tauri 应用。

不适合：开源仓库（任何人能 fork 删检查）、要订阅/退款/吊销、规模上千用户。

---

## ⚡ 一分钟速查

> ⚠️ **每张 license 必须绑机器**。脚本会强制要求 `--machine-id`，没传会拒绝执行。这是防止买家把 token 转发给朋友的最有效手段。

| 场景 | 命令 |
|---|---|
| 1 年正式版 | `bash scripts/mint-license.sh <邮箱> --machine-id <UUID> --expires 1y` |
| 半年试用 | `bash scripts/mint-license.sh <邮箱> --machine-id <UUID> --expires 6mo` |
| 30 天试用 | `bash scripts/mint-license.sh <邮箱> --machine-id <UUID> --expires 30d` |
| 永久版 | `bash scripts/mint-license.sh <邮箱> --machine-id <UUID> --perpetual` |
| 指定到期日 | `bash scripts/mint-license.sh <邮箱> --machine-id <UUID> --expires 2027-04-27` |
| **整包交付**（推荐）| `bash scripts/new-customer.sh <slug> --app-name "..." --machine-id <UUID> --expires 1y --packs <pack_id> --license-features <feat>` —— 一次出齐 customer.yaml + license.txt + INSTALL.md，见 § 「🎁 整包交付」 |

`--expires` 支持：`1y` / `6mo` / `30d` / `2027-04-27` 四种写法。

> 💡 **UUID 从哪来？** 买家装好 Corey 启动后，激活窗顶部会显示「本机 ID」一段 UUID + 复制按钮，让他发给你。

---

## 📂 你机器上的关键文件

```
~/.corey-license/
  private.pem    ← 私钥（permissions 600，永远不要泄露）
  public.pem     ← 公钥（已经拷到源码里了）

src-tauri/src/license/public_key.pem   ← 应用嵌入的公钥
scripts/mint-license.sh                 ← 签 license 的脚本

~/Library/Application Support/com.caduceus.app/
  license.txt    ← 应用读取的 license 文件
  machine_id     ← 这台机器的持久 UUID
```

> ⚠️ **私钥备份必做**。把 `private.pem` 拷到 1Password / 加密 U 盘 / 异地云盘。**私钥丢了 = 你以后再也签不出新 license**（已发的还能继续用）。

---

## � 跨平台支持

### 买家端（运行 Corey 的人）
**Windows / macOS / Linux 全都支持**。整个 license 系统是 Tauri 跨平台原语 + 纯 Rust ed25519 签名验证，没有平台特定逻辑：

| 平台 | License 文件位置 | machine_id 文件位置 |
|---|---|---|
| **macOS** | `~/Library/Application Support/com.caduceus.app/license.txt` | 同目录下 `machine_id` |
| **Windows** | `%APPDATA%\com.caduceus.app\license.txt`（一般是 `C:\Users\<你>\AppData\Roaming\com.caduceus.app\`） | 同目录下 `machine_id` |
| **Linux** | `~/.config/com.caduceus.app/license.txt` | 同目录下 `machine_id` |

UI 在三个平台都一致：激活弹窗、设置页面、复制按钮的行为完全相同。

### 维护者端（你签 license 的人）

| 平台 | 状态 | 备注 |
|---|---|---|
| **macOS** | ✅ 完全支持 | 你现在就在用 |
| **Linux** | ✅ 完全支持 | 脚本自动检测 `date` 版本 (BSD vs GNU)，两者都能跑 |
| **Windows** | ⚠️ 直接调 cargo | `mint-license.sh` 是 Bash 脚本；Windows 上用 git-bash / WSL 也能跑，或者直接用底层命令：<br>`cargo run --manifest-path src-tauri/Cargo.toml --bin mint_license -- --user X --machine-id Y --expires 2027-04-27` |

> 💡 你以后无论换 Mac、Linux、Windows 维护，**只要把 `~/.corey-license/private.pem` 拷过去，公钥不动**，就能继续签 license。

---

## � 一次性设置（已完成）

> 这一段记录给将来万一你换电脑、重装系统时参考。今天的 setup 已经做完了。

```bash
# 1. 生成密钥对（只做一次，永远）
cargo run --manifest-path src-tauri/Cargo.toml --bin license_keygen -- ~/.corey-license

# 2. 把公钥塞进源码
cp ~/.corey-license/public.pem src-tauri/src/license/public_key.pem

# 3. 重新构建应用
pnpm tauri:dev:clean    # 或者 bash scripts/release-local.sh
```

如果换电脑：
- 把备份的 `private.pem` 拷回 `~/.corey-license/`
- `chmod 600 ~/.corey-license/private.pem`
- 公钥不用动（已经在源码里）

如果**真的丢了私钥**：跑上面的步骤 1+2+3，然后给所有现有买家重新签 license（旧 license 全失效）。

---

## 💸 卖一份 license 的标准流程

> 每张 license 都必须绑机器。脚本不接受没 `--machine-id` 的请求。下面就是标准流程：

**1. 买家装好 Corey 启动 →** 看到激活窗，里面顶部显示一段 UUID：

```
本机 ID: 1f4d1e2c-9b8a-4d2c-bc01-7e8a09f1b6c4   [📋 复制]
```

**2. 买家点复制按钮 → 通过微信/邮件发给你**

**3. 你在终端跑**：

```bash
bash scripts/mint-license.sh wang@acme.com \
  --machine-id 1f4d1e2c-9b8a-4d2c-bc01-7e8a09f1b6c4 \
  --expires 1y
```

输出长这样：
```
eyJ1c2VyIjoid2FuZ0BhY21lLmNvbSIsImlzc3VlZCI6IjIwMjYt...

──────────────────────── License minted ────────────────────────
  user      : wang@acme.com
  expires   : 2027-04-27
  bound to  : 1f4d1e2c-9b8a-4d2c-bc01-7e8a09f1b6c4
  length    : 240 chars

Send the buyer the line above. They paste it into Corey's
Activate dialog and Corey unlocks.
─────────────────────────────────────────────────────────────────
```

**4. 把 stdout 那一行 token 发给买家** —— 微信/邮件/你方便的渠道

**5. 买家粘进激活窗，点「激活」→ 解锁**

---

## 🎁 整包交付（推荐路径）

> 如果客户买的不只是基座而是一份**白标包**（带品牌 / 预装 Pack / 自定义侧边栏），用 `scripts/new-customer.sh` 一键出齐所有交付物，**包含 license**。无需再单独跑 `mint-license.sh`。

### 一行命令

```bash
bash scripts/new-customer.sh acme \
    --app-name "Acme 跨境电商助手" \
    --machine-id 1f4d1e2c-9b8a-4d2c-bc01-7e8a09f1b6c4 \
    --expires 1y \
    --packs cross_border_ecom \
    --hide terminal,mcp,compare,logs \
    --primary-color "#FF6B00" \
    --license-features cross_border_ecom
```

### 产出

落在 `customers/<slug>/`，默认 4 个文件：

```
customers/acme/
  customer.yaml   ← 白标配置（品牌 + 侧边栏屏蔽 + 预装 Pack）
  license.txt     ← ed25519 签名的 token，**已绑 machine-id**
  INSTALL.md      ← 给客户的 5 步中文手册
  README.md       ← 给自己的摘要（复签参数都在）
```

客户侧 3 步（`INSTALL.md` 已写，这里速览）：

1. 安装 Corey 安装包
2. 把 `customer.yaml` 放到 `~/.hermes/customer.yaml`（macOS / Linux）或 `%USERPROFILE%\.hermes\customer.yaml`（Windows）
3. 打开 Corey → 设置 → 许可证 → 粘贴 `license.txt` 内容 → 激活

### 参数速查

| 参数 | 必填 | 语义 |
|---|---|---|
| 位置参 `<slug>` | ✅ | 客户标识，只能 `[a-z0-9_-]`，用作目录名 + license user-id |
| `--app-name "..."` | 建议 | 顶栏 / 窗口标题；不填默认 "Corey" |
| `--machine-id <uuid>` | ✅（除非 `--no-license`）| 买家终端 UUID（Settings → 许可证页可见）|
| `--expires <1y\|6mo\|30d\|YYYY-MM-DD>` | ✅（除非 `--no-license`）| 到期期限 |
| `--packs <id[,id]>` | 可选 | 首启自动启用的 Pack id 列表 |
| `--hide <route[,route]>` | 可选 | 侧边栏要摸掉的入口（terminal / mcp / compare / logs / analytics / browser …）|
| `--primary-color <#HEX>` | 可选 | 主题色覆盖 |
| `--license-features <feat[,feat]>` | 可选 | 写进 license token 的 features；要启用 `license_feature: xxx` 的 Pack 必填对应项 |
| `--output <dir>` | 可选 | 默认 `customers/<slug>/` |
| `--dry-run` | 可选 | 不写任何文件，stdout 打印预览 |
| `--no-license` | 可选 | 跳过 license 签发（用于客户未给 UUID 时先出白标骨架）|

### 4 个真实场景

**1・ 先出白标，等客户发 UUID 再补 license：**

```bash
# 今天：先出白标骨架
bash scripts/new-customer.sh acme --app-name "Acme 助手" \
    --packs cross_border_ecom --no-license

# 客户发来 UUID 后：补签 license
bash scripts/mint-license.sh acme@customer \
    --machine-id <UUID> --expires 1y --features cross_border_ecom \
    > customers/acme/license.txt
```

**2・ 极简入口的白标（只留 chat + home + settings）：**

```bash
bash scripts/new-customer.sh minimal \
    --app-name "MyBot" \
    --machine-id <UUID> --expires 1y \
    --hide terminal,mcp,compare,logs,analytics,browser,skills,memory,profiles
```

**3・ 预览不落盘（调参考）：**

```bash
bash scripts/new-customer.sh test \
    --app-name "Test" --machine-id test-uuid --expires 6mo \
    --packs cross_border_ecom --hide terminal \
    --dry-run | less
```

**4・ 永久授权（内部机 / 演示机）：**

```bash
# new-customer.sh 暂未透传 --perpetual，先 --no-license 再手工签
bash scripts/new-customer.sh demo --app-name "Demo" --no-license
bash scripts/mint-license.sh demo@internal --machine-id <UUID> --perpetual \
    > customers/demo/license.txt
```

### 客户换机子了：只重签 license、不动 customer.yaml

```bash
# 数字换成新机子的 UUID，其他参数拄 customers/<slug>/README.md
bash scripts/mint-license.sh acme@customer \
    --machine-id <新 UUID> --expires 1y --features cross_border_ecom \
    > customers/acme/license.txt

# 客户端：设置 → 许可证 → 移除旧 license → 粘新 token → 激活
```

### 踩坑指南

| 症状 | 原因 | 解决 |
|---|---|---|
| `error: --machine-id is required` | mint-license.sh 的强制检查 | 给 UUID，或加 `--no-license` |
| cargo 报找不到 private key | `~/.corey-license/private.pem` 缺失 | 按 § 「一次性设置」重新放回 |
| 客户装好品牌没变 | `customer.yaml` 放错目录 | 必须是 `~/.hermes/customer.yaml`（不是工作目录）|
| 启用 Pack 提示 `license_feature required` | license features 缺对应 flag | 重签时加 `--license-features <feat>` |
| 脚本修改后怕和 Rust parser 脱销 | 包含 smoke test | 跑 `cargo test --lib customer::tests::new_customer_sh_emits_parseable_yaml` 验 yaml 契约 |
| 改了仓库里的 Pack manifest，端上 Settings → Packs 看不到新版 | seed 默认不覆盖已存在的 `~/.hermes/skill-packs/<id>/`（保护用户数据）| **开发模式**：`COREY_FORCE_RESEED=1 pnpm tauri:dev`，每次启动自动重拷 bundled Pack；**生产包永不要设这个变量** |


## 👀 买家会看到什么

### 第一次启动（没 license）
全屏弹窗，标题「激活 Corey」，里面有：
- 一段 UUID（要发给你）+ 复制按钮
- 一个 textarea 让他粘 token
- 「激活」按钮

### 已激活
应用正常启动，没任何弹窗。Settings → 许可证 里能看到：
- 持有人：xxx
- 签发时间 / 到期时间
- 机器 ID
- 「移除许可证」按钮

### 到期了
启动后弹「你的 license 已于 YYYY-MM-DD 过期」，让他粘新 token。

### 拿别人的 token / 换电脑了
启动后弹「License 绑定到其他机器」+ 显示**这台**机器的新 UUID，提示他把新 ID 发给你重签。

### 开发模式（你自己 `pnpm tauri:dev`）
顶部一条黄色 banner「DEV BUILD — 已跳过 license 校验」+ 隐藏按钮。**永远不会被挡住** —— 你开发不需要签 license 给自己。

---

## 🤔 常见问题

### 我自己开发 Corey 时也要 license 吗？
**不用**。`cargo build` / `pnpm tauri:dev` 编出来的 debug 构建会自动 bypass 整个 license 检查，只显示一条提示 banner。只有 `pnpm tauri build` / `bash scripts/release-local.sh` 出来的 release 包才会真的 enforce。

### 怎么测试 release 包的 license 流程？
```bash
# 1. 构建 release
bash scripts/release-local.sh

# 2. 删掉自己机器上的 license 模拟首次启动
rm "$HOME/Library/Application Support/com.caduceus.app/license.txt"

# 3. 打开 .app，应该弹激活窗
open src-tauri/target/release/bundle/macos/Corey.app
```

### 买家退款了，能撤销 license 吗？
**这个方案没有撤销机制**。三个选项：
1. 用 `--expires` 限期 + 等到期（最常见）
2. 整套换 keypair：跑一次性设置流程，所有人都得重发 license（核选项）
3. 真要正经撤销 → 改用 [Keygen.sh](https://keygen.sh) 这种 SaaS

### 买家把 token 发给朋友了怎么办？
**不用担心** —— 因为脚本强制要求 `--machine-id`，每张 license 都绑机器。朋友机器的 UUID 不一样，激活时会显示「License is bound to a different machine」直接被拒。这就是强制绑机器的核心目的。

### 买家换 SSD / 重装系统了，license 还能用吗？
**不能**。`machine_id` 文件在 `<config_dir>` 下，重装会丢。这种情况让他把新机器的 UUID 发你重签 —— 你判断合理就重发。如果他频繁换，限制次数 / 收手续费。

### 私钥能不能放进 git？
**绝对不能**。私钥泄露 = 任何人都能签合法 license。已经设置好了 `chmod 600` 只有你自己能读。

### 脚本能放进 git 吗？
**能，安全**。脚本只是个 wrapper，不含密钥；它跑的时候才去读 `~/.corey-license/private.pem`，那个文件在脚本之外。

### 新版本发布会让旧 license 失效吗？
**不会**。只要源码里的公钥不变（`src-tauri/src/license/public_key.pem`），所有用同一私钥签的 license 跨版本都有效。

### 我想做 14 天免费试用

---

## 🏷️ Pack 授权限联动（B-4）

### 机制

Pack manifest 可声明 `license_feature: "cross_border"`。Corey 启动时：

1. 读取 license token → 解析 `payload.features` 数组
2. 扫描 Pack → 若 manifest 的 `license_feature` 不在 features 中 → 标记 `license_gated = true`
3. **gated Pack 无法启用**：`pack_set_enabled` 返回 `Unauthorized` 错误
4. **gated Pack 的视图不出现**：`pack_views_list` 跳过 gated Pack
5. 前端 Settings → Packs 显示 🔒 + "需要授权许可"，开关禁用

### 卖家操作流程

**新客户买 Pack**：
1. 客户发来机器 UUID（Settings → 许可证 页面可见）
2. 你用 `mint-license.sh` 签新 license，`--features` 加上 Pack 对应的 feature tag
3. 客户在 Settings → 许可证 粘贴新 token → 旧 token 被替换
4. 重启后 Pack 自动解锁

**续费 / 加 Pack**：
1. 同上，但 `--features` 合并新旧 features（逗号分隔）
2. 例：原 license 有 `basic`，客户加购 `cross_border` → `--features basic,cross_border`

**示例**：
```bash
bash scripts/mint-license.sh wang@acme.com \
    --machine-id 1f4d1e2c-9b8a-4d2c-bc01-7e8a09f1b6c4 \
    --expires 1y \
    --features basic,cross_border
```

### 不做的事

- ❌ 在线激活 / JWT / 心跳
- ❌ 客户管理后台
- ❌ 自动续费
- 离线 ed25519 签名够用，复杂度不值得
两种思路：
1. **直接给试用者签 14 天的 license**：`--expires 14d`
2. **应用内置试用机制**：要改代码，加一个「首次启动日期」存盘 + 14 天后才显示激活窗。当前没实现。

### 我能加「Pro 版功能」分级吗？
能。`Payload.features` 字段已经预留好了，比如：
```bash
bash scripts/mint-license.sh user@x.com --expires 1y --features pro,beta
```
但**前端还没读这个字段**。当前 license 是「全有/全无」。如果要做分级（基础版 vs Pro 版），需要加个新 store 字段 + 在路由 / 功能里 gate。这是后续工作，你想做的时候告诉我。

---

## 🔐 威胁模型 / 这个方案防得住什么

✅ **防得住**：
- 普通用户偷偷把安装包给朋友（朋友没 license 进不去）
- 用户改 `expires` 字段试图延期（签名一动就 invalid）
- 把 portable token 发到论坛（如果绑了机器，别人用不了）

❌ **防不住**：
- 用 debugger / patcher 绕过校验的破解者（需要厉害的逆向能力）
- 整个 `<config_dir>` 拷到另一台机器（含 `machine_id`）的人
- **源码泄露** —— 任何人能重新编译一个去掉检查的版本

第三条是硬约束。**只要源码闭源**，这套方案就够用。所以你的计划「先做免费内测、源码私有化、再开始卖」是对的。

---

## 📖 涉及的文件清单（万一以后要改）

```
src-tauri/src/license/
  mod.rs           ← 验证逻辑、Payload/Verdict 类型
  public_key.pem   ← 嵌入的公钥（你的）

src-tauri/src/ipc/license.rs         ← 三个 IPC 命令
src-tauri/src/ipc/pack.rs            ← pack_is_gated / resolve_license_features
src-tauri/src/bin/
  license_keygen.rs                  ← 生成 keypair 的 CLI
  mint_license.rs                    ← 签 license 的 CLI

src/features/license/
  store.ts                            ← 前端状态
  LicenseGate.tsx                     ← 激活弹窗

src/features/settings/sections/
  LicenseSection.tsx                  ← 设置里的 license 信息面板
  PacksSection.tsx                    ← Pack 列表 + 授权限锁

src/lib/ipc/license.ts                ← TS 类型 + IPC 包装

scripts/mint-license.sh               ← 友好命令包装
scripts/new-customer.sh               ← 整包交付（customer.yaml + license.txt + INSTALL.md）

src-tauri/src/customer/mod.rs         ← customer.yaml schema + parse + new-customer.sh smoke test

customers/<slug>/                     ← new-customer.sh 默认产出目录（已在 .gitignore，**不得入库** —— 含签名 token）

docs/
  spec/licensing.md                   ← 你正在看的这份（中文现行版）
  archive/licensing-en.md             ← 历史英文版（只读）
```

---

**最后**：如果一年后你忘了 license 怎么用，从这份文档的「⚡ 一分钟速查」开始。万一连这个也忘了，至少记得 `bash scripts/mint-license.sh --help`。
