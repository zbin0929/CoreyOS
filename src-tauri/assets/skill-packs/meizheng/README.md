# 美正 Pack

美正国际物流业务 Pack，运行在 CoreyOS（白标后即美正OS）之上。

## 目录约定

```
meizheng/
├── manifest.yaml         # Pack 元数据 + 注册表（当前为骨架）
├── REQUIREMENTS.md       # ⭐ 持续收集业务需求 —— 想到啥写啥
├── README.md             # 本文件
├── prompts/              # 业务人设 / 系统提示词（待填）
├── skills/               # 客户高频问题对应的 .md skill 文件（待填）
├── workflows/            # 自动化任务
│   └── refresh_ups_zones.yaml   # 已落地：每月更新 UPS 分区表
└── data/                 # （可选）Pack 自带的种子数据
```

## 工作流程（怎么把需求变成产品）

1. **任何时候想到客户需求** → 写进 `REQUIREMENTS.md` 对应小节
2. **每周/每两周整理一次**：和我说"整理需求"，我帮你把 REQUIREMENTS 转成：
   - skill .md 文件（FAQ 类）
   - workflow .yaml 文件（自动化类）
   - view 配置（首页卡片类）
   - manifest 里的 schedules / mcp_servers 条目
3. **测试通过** → bump `version`，pack 即可分发售卖

## 当前已落地能力

✅ **每月 1 号自动更新 UPS 全美 1000 个 ZIP 前缀分区表**
   - 触发：cron `0 3 1 * *` 或手动按钮
   - 输出：`~/.hermes/pack-data/meizheng/zone-charts/ups_zone_XXX.xls`（~22MB 总量）
   - 实测：~4 分钟跑完，0 LLM tokens
   - 实现：`workflows/refresh_ups_zones.yaml` → 调用 `scripts/ups-zone-downloader.mjs`

## 待办（按 REQUIREMENTS.md 优先级）

- [ ] §1 业务人设：填写 prompts/soul.md
- [ ] §2 数据资产：补 UPS 燃油费、FedEx 分区、FedEx 燃油费的 workflow
- [ ] §3 高频问题：把"91701 是 zone 几"做成 skill（先把 .xls 转 SQLite，skill 里 SQL 查）
- [ ] §5 首页视图：燃油走势 + 告警 + 快捷入口
- [ ] §6 集成：微信群机器人 / 钉钉推送（看客户用什么）
- [ ] §7 白标：客户名 / Logo / 主题色
