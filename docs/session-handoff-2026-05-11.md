# 演示冲刺 — Session Handoff（2026-05-11 14:30）

> 给下一个 session 的 me 看。读完 1 分钟知道现状 + 下一步。

## 今天落地的 8 个 commit（v0.2.12 演示版）

```
6450f58 ai-browser: headless background mode + clean mode-switch
83f072a ai-browser: louder save feedback on alias form
94f5c13 skills+artifacts: bundle xlsx/docx/pdf/pptx + chat artifact cards + soul rules
ec0d8ff home: preset card detects missing bundled skills
b1944c7 settings: skill Curator panel wrapping hermes curator CLI
(early today)
362dced docs(ai-browser): security narrative + destructive-action guard
070ccfa feat(ai-browser): conversational control + auto-launch + aliases + per-domain clear
```

CI 状态：截至 14:30 仍在跑最后几个 commit，未确认全绿。

## v0.2.12 已 ship 的功能（演示讲点）

| Feature | 文件 | 演示讲法 |
|--------|------|---------|
| AI 浏览器（headless 自启动） | `src-tauri/src/ipc/browser_cdp.rs` | "Corey 一开自动后台准备 Chrome，无窗口" |
| 对话控制（status/launch/stop/clear） | `mcp_server/tools.rs` | "聊天里直接说'打开浏览器登录'" |
| 站点别名（chat + Settings 表格） | `browser_aliases.rs` + `BrowserCdpSection.tsx` | "说'打开店铺后台'AI 自己找 URL" |
| 单域名清登录 ✕ | `browser_cdp_clear_domain` | "Settings 里点 ✕ 只清这一个" |
| 破坏性操作 HARD RULE | `baseSoul.ts` | "删/付/发 全部决策卡片再做" |
| 产物保存 + 一键打开 | `save_artifact(source_path)` + `ArtifactLinkCard.tsx` | "聊天里 [📊 file.xlsx] 卡片，点开直接打开" |
| xlsx/docx/pdf/pptx 默认装 | `src-tauri/assets/presets/default/skills/` | "Excel 财务级标准，不是 amateur dump" |
| AI 自动存 skill（soul + Curator） | `baseSoul.ts` + `SkillCuratorSection.tsx` | "做完复杂任务 AI 主动提议保存为 skill" |

## 演示前 P0 修复（**今天还要做**）

### 真实 bug 来源：今天用户跑「美正OS 查订单」session 实测

session 路径：`~/.hermes/sessions/session_20260511_134939_998729.json`

**4 个真实问题**：

1. **iteration 被打满**（msg 197 + 216 都有 "max iterations" 强制注入）
   - 95+ 次 tool call 跑超 Hermes 默认上限，被强行 summary
   - **修复**：调高 `max_iterations`（找 hermes config.yaml），或 base soul 教 AI 翻页类任务先估算 iteration budget

2. **登录态在 CDP 浏览器 vs Playwright 之间漂移**
   - AI 自己承认（msg 15）："我用的浏览器和你登录的不是同一个"
   - 用户登录的是 CDP Chrome（9222），但 agent 默认 `browser_navigate` 走 Hermes 自带 Playwright
   - **修复**：确认 `BROWSER_CDP_URL` 真的注入到 Hermes 进程环境；base soul 加"登录站务必先 corey_browser_status"

3. **headless 模式 Excel 下载取不出来**
   - 美正 OS 的「导出 Excel」成功了但 headless 没法 GUI 触发"另存为"
   - **修复**：Chrome `--download.default_directory` 指向 `~/.hermes/downloads/`，AI 完事调 save_artifact 把文件搬进 chat

4. **AI 翻页策略选错**（非 bug，是教导问题）
   - 应优先：API 拦截 > 导出文件 > 翻页 N 次
   - **修复**：base soul 加"分页扫数据 = 先想 API，最后才翻页"

### 修复优先级

```
P0（演示前必修，30 min - 1h）
  A. 确认 BROWSER_CDP_URL 注入 Hermes
  B. base soul："登录站必须先 corey_browser_status"硬规则

P1（演示前最好修，1-2h）
  C. Hermes max_iterations 调高
  D. headless 模式 download_dir 配置

P2（v0.2.13）
  E. base soul 教"API > 导出 > 翻页"策略
  F. sk-B chat 顶部"AI 学到新 skill"实时通知卡片
```

## 已留下但未做的（v0.2.13 候补）

```
sk-B  Chat 实时通知"AI 刚保存了新 skill"
      技术路径：Tauri fs watcher 监听 ~/.hermes/skills/ 
      触发 corey_native:skill_changed 事件，chat 注入卡片
      预估 3-4h
```

## 关键文档（演示时给客户看）

```
docs/ai-browser-security.md            浏览器安全 Q&A（5 个客户高频问题）
docs/ai-skill-self-improvement.md      Skill 自动进化 3 段子演示手册
docs/session-handoff-2026-05-11.md     这份
```

## 当前 Branch + 远程

```
main @ b1944c7  pushed to origin/main
```

## 重启 Corey 验证清单

```
1. pkill -9 -f 'tauri.js dev|cargo.*--no-default-features|rustc.*caduceus|Corey'
2. pnpm tauri:dev:clean
3. Home 应出现"有 4 个新的 skill 可一键加入" → 点更新
4. Settings → AI 浏览器 → 应该静默 headless 运行（无窗口）
5. Settings → 技能维护 → 看到 curator status
6. Chat: "给我做一份示意销售周报，要 Excel 带饼图柱图"
   → 应弹 [📊 file.xlsx] 卡片，点开能用 Excel 打开
   → 末尾应有"要不要存为 skill"提议
```

## 下一个 session 开场白建议

> "继续做 v0.2.12 演示冲刺。读 docs/session-handoff-2026-05-11.md。
> 先做 P0 的 A + B，再视时间做 P1。"
