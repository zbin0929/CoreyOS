# Icon Audit (lucide-react → Custom Icons)

本文档列出所有当前使用 `lucide-react` 图标的位置及建议尺寸。

## 导航图标（Sidebar）

**文件**: `src/app/nav-config.ts` + `src/app/shell/Sidebar.tsx`

| 图标 | 使用位置 | 当前尺寸 | 建议尺寸 |
|------|----------|----------|----------|
| Home | Home 页面 | `size={16}` | 16px |
| MessageSquare | Chat 页面 | `size={16}` | 16px |
| Columns3 | Compare 页面 | `size={16}` | 16px |
| Wand2 | Skills 页面 | `size={16}` | 16px |
| GitBranch | Trajectory 页面 | `size={16}` | 16px |
| BarChart3 | Analytics 页面 | `size={16}` | 16px |
| ScrollText | Logs 页面 | `size={16}` | 16px |
| Terminal | Terminal 页面 | `size={16}` | 16px |
| Clock | Scheduler 页面 | `size={16}` | 16px |
| Radio | Channels 页面 | `size={16}` | 16px |
| Boxes | Models 页面 | `size={16}` | 16px |
| FolderTree | Profiles 页面 | `size={16}` | 16px |
| BookMarked | Runbooks 页面 | `size={16}` | 16px |
| PiggyBank | Budgets 页面 | `size={16}` | 16px |
| Settings | Settings 页面 | `size={16}` | 16px |

## 顶部栏（Topbar）

**文件**: `src/app/shell/Topbar.tsx`

| 图标 | 使用位置 | 当前尺寸 | 建议尺寸 |
|------|----------|----------|----------|
| Sun | 主题切换（暗色模式） | `size={14}` | 14px |
| Moon | 主题切换（亮色模式） | `size={14}` | 14px |
| Search | 命令面板触发器 | `size={13}` | 13px |
| CircleDot | Gateway 状态指示灯 | `size={12}` | 12px |

## 命令面板

**文件**: `src/components/command-palette/Palette.tsx`

| 图标 | 使用位置 | 当前尺寸 | 建议尺寸 |
|------|----------|----------|----------|
| BookMarked | Runbook 条目 | `size={15}` | 15px |
| Sun/Moon | 主题切换 | `size={15}` | 15px |
| ArrowRight | 右侧箭头（选中时显示） | `size={12}` | 12px |

## UI 组件

**文件**: `src/components/ui/combobox.tsx`

| 图标 | 使用位置 | 当前尺寸 | 建议尺寸 |
|------|----------|----------|----------|
| Check | 选中标记 | 无（默认） | 14px |
| ChevronDown | 下拉箭头 | 无（默认） | 14px |

**文件**: `src/components/ui/select.tsx`

| 图标 | 使用位置 | 当前尺寸 | 建议尺寸 |
|------|----------|----------|----------|
| Check | 选中标记 | 无（默认） | 14px |
| ChevronDown | 下拉箭头 | 无（默认） | 14px |

**文件**: `src/components/ui/empty-state.tsx`

| 图标 | 使用位置 | 当前尺寸 | 建议尺寸 |
|------|----------|----------|----------|
| LucideIcon (动态) | 空状态图标 | `size={20}` | 20px |

**文件**: `src/components/ui/drawer.tsx`

| 图标 | 使用位置 | 当前尺寸 | 建议尺寸 |
|------|----------|----------|----------|
| X | 关闭按钮 | `className="h-4 w-4"` | 16px |

## 功能页面

### Home

**文件**: `src/features/home/index.tsx`

| 图标 | 使用位置 | 当前尺寸 | 建议尺寸 |
|------|----------|----------|----------|
| Plug | 连接提示 | `size={14}` | 14px |
| BookOpen | 文档链接 | `size={14}` | 14px |
| Sparkles | 特性亮点 | `size={12}` | 12px |
| HardDrive | 存储提示 | `size={12}` | 12px |

### Chat

**文件**: `src/features/chat/index.tsx`

| 图标 | 使用位置 | 当前尺寸 | 建议尺寸 |
|------|----------|----------|----------|
| AlertTriangle | 预算警告 | 无（默认） | 16px |
| Paperclip | 附件按钮 | 无（默认） | 16px |
| Send | 发送按钮 | 无（默认） | 16px |
| Sparkles | 空状态装饰 | `className="h-6 w-6"` | 24px |
| Square | 停止生成按钮 | 无（默认） | 16px |
| X | 关闭按钮 | 无（默认） | 16px |

**文件**: `src/features/chat/MessageBubble.tsx`

| 图标 | 使用位置 | 当前尺寸 | 建议尺寸 |
|------|----------|----------|----------|
| AlertCircle | 错误提示 | 无（默认） | 14px |
| Check | 复制成功 | 无（默认） | 14px |
| Copy | 复制按钮 | 无（默认） | 14px |
| Loader2 | 加载中 | 无（默认） | 14px |
| Paperclip | 附件图标 | 无（默认） | 14px |
| Sparkles | AI 标记 | 无（默认） | 14px |
| User | 用户头像 | 无（默认） | 16px |
| Wrench | 工具调用 | 无（默认） | 14px |

**文件**: `src/features/chat/SessionsPanel.tsx`

| 图标 | 使用位置 | 当前尺寸 | 建议尺寸 |
|------|----------|----------|----------|
| Check | 当前会话标记 | 无（默认） | 14px |
| MessageSquarePlus | 新建会话 | 无（默认） | 14px |
| Trash2 | 删除会话 | 无（默认） | 14px |

**文件**: `src/features/chat/ActiveLLMBadge.tsx`

| 图标 | 使用位置 | 当前尺寸 | 建议尺寸 |
|------|----------|----------|----------|
| Cpu | LLM 图标 | 无（默认） | 14px |
| Settings2 | 设置按钮 | 无（默认） | 14px |

### Analytics

**文件**: `src/features/analytics/index.tsx`

| 图标 | 使用位置 | 当前尺寸 | 建议尺寸 |
|------|----------|----------|----------|
| Activity | 活跃度指标 | `size={14}` | 14px |
| BarChart3 | 图表图标 | `size={14}` | 14px |
| Coins | 成本指标 | `size={14}` | 14px |
| MessageSquare | 消息指标 | `size={14}` | 14px |
| Wrench | 工具调用指标 | `size={14}` | 14px |
| RefreshCcw | 刷新按钮 | `size={14}` | 14px |
| Calendar | 日历图标 | 无（默认） | 14px |

### Budgets

**文件**: `src/features/budgets/index.tsx`

| 图标 | 使用位置 | 当前尺寸 | 建议尺寸 |
|------|----------|----------|----------|
| AlertCircle | 错误提示 | 无（默认） | 14px |
| AlertTriangle | 警告提示 | 无（默认） | 14px |
| Check | 成功标记 | 无（默认） | 14px |
| Loader2 | 加载中 | 无（默认） | 14px |
| PiggyBank | 空状态图标 | 无（默认） | 32px |
| Plus | 新建按钮 | 无（默认） | 14px |
| Trash2 | 删除按钮 | 无（默认） | 14px |
| X | 关闭按钮 | 无（默认） | 14px |

### Skills

**文件**: `src/features/skills/index.tsx`

| 图标 | 使用位置 | 当前尺寸 | 建议尺寸 |
|------|----------|----------|----------|
| AlertCircle | 错误提示 | 无（默认） | 14px |
| Check | 成功标记 | `className="h-3.5 w-3.5"` | 14px |
| FileText | 文件图标 | `className="h-3 w-3"` / `h-3.5 w-3.5` | 14px |
| FolderClosed | 文件夹图标 | `className="h-3 w-3"` | 12px |
| Loader2 | 加载中 | `className="h-3.5 w-3.5"` / `h-4 w-4` | 14px |
| Plus | 新建按钮 | `className="h-3.5 w-3.5"` | 14px |
| Save | 保存按钮 | `className="h-3.5 w-3.5"` | 14px |
| Trash2 | 删除按钮 | `className="h-3.5 w-3.5"` | 14px |
| Wand2 | 空状态图标 | 无（默认） | 32px |

### Channels

**文件**: `src/features/channels/WeChatQr.tsx`

| 图标 | 使用位置 | 当前尺寸 | 建议尺寸 |
|------|----------|----------|----------|
| AlertCircle | 错误提示 | 无（默认） | 14px |
| CheckCircle2 | 成功标记 | 无（默认） | 14px |
| Loader2 | 加载中 | 无（默认） | 14px |
| QrCode | QR 码按钮 | `className="h-3.5 w-3.5"` | 14px |
| RefreshCw | 刷新按钮 | 无（默认） | 14px |
| Smartphone | 手机图标 | 无（默认） | 32px |
| X | 关闭按钮 | 无（默认） | 14px |

**文件**: `src/features/channels/ChannelForm.tsx`

| 图标 | 使用位置 | 当前尺寸 | 建议尺寸 |
|------|----------|----------|----------|
| Check | 保存按钮 | `className="h-3.5 w-3.5"` | 14px |
| Eye | 显示密码 | 无（默认） | 14px |
| EyeOff | 隐藏密码 | 无（默认） | 14px |
| Loader2 | 加载中 | `className="h-3.5 w-3.5"` | 14px |
| X | 取消按钮 | `className="h-3.5 w-3.5"` | 14px |

**文件**: `src/features/channels/index.tsx`

| 图标 | 使用位置 | 当前尺寸 | 建议尺寸 |
|------|----------|----------|----------|
| AlertCircle | 错误提示 | 无（默认） | 14px |
| Check | 成功标记 | 无（默认） | 14px |
| CircleOff | 离线状态 | 无（默认） | 14px |
| Hash | 频道图标 | 无（默认） | 14px |
| Loader2 | 加载中 | 无（默认） | 14px |
| MessageSquareMore | 消息图标 | 无（默认） | 14px |
| Pencil | 编辑按钮 | `className="h-3.5 w-3.5"` | 14px |
| QrCode | QR 码按钮 | 无（默认） | 14px |
| RefreshCw | 刷新按钮 | `className="h-3.5 w-3.5"` | 14px |
| RotateCw | 重启按钮 | 无（默认） | 14px |
| X | 关闭按钮 | 无（默认） | 14px |

### Profiles

**文件**: `src/features/profiles/index.tsx`

| 图标 | 使用位置 | 当前尺寸 | 建议尺寸 |
|------|----------|----------|----------|
| AlertCircle | 错误提示 | 无（默认） | 14px |
| Check | 成功标记 | `className="h-3.5 w-3.5"` | 14px |
| Copy | 克隆按钮 | `className="h-3.5 w-3.5"` | 14px |
| FolderOpen | 文件夹图标 | 无（默认） | 32px |
| Loader2 | 加载中 | `className="h-3.5 w-3.5"` | 14px |
| Pencil | 重命名按钮 | `className="h-3.5 w-3.5"` | 14px |
| Plus | 新建按钮 | `className="h-3.5 w-3.5"` | 14px |
| RefreshCw | 刷新按钮 | `className="h-3.5 w-3.5"` | 14px |
| Trash2 | 删除按钮 | `className="h-3.5 w-3.5"` | 14px |
| X | 取消按钮 | `className="h-3.5 w-3.5"` | 14px |

### Logs

**文件**: `src/features/logs/HermesLogPanel.tsx`

| 图标 | 使用位置 | 当前尺寸 | 建议尺寸 |
|------|----------|----------|----------|
| AlertCircle | 错误提示 | 无（默认） | 14px |
| FileSearch | 搜索图标 | 无（默认） | 14px |
| Loader2 | 加载中 | 无（默认） | 14px |
| RefreshCw | 刷新按钮 | 无（默认） | 14px |

**文件**: `src/features/logs/index.tsx`

| 图标 | 使用位置 | 当前尺寸 | 建议尺寸 |
|------|----------|----------|----------|
| Activity | Agent 标签图标 | `className="h-3.5 w-3.5"` | 14px |
| AlertTriangle | Error 标签图标 | `className="h-3.5 w-3.5"` | 14px |
| Cpu | Gateway 标签图标 | `className="h-3.5 w-3.5"` | 14px |
| ScrollText | Changelog 标签图标 | `className="h-3.5 w-3.5"` | 14px |

**文件**: `src/features/logs/ChangelogPanel.tsx`

| 图标 | 使用位置 | 当前尺寸 | 建议尺寸 |
|------|----------|----------|----------|
| AlertCircle | 错误提示 | 无（默认） | 14px |
| CheckCircle2 | 成功标记 | 无（默认） | 14px |
| Loader2 | 加载中 | 无（默认） | 14px |
| RefreshCw | 刷新按钮 | 无（默认） | 14px |
| RotateCcw | 撤销按钮 | 无（默认） | 14px |
| ScrollText | 空状态图标 | 无（默认） | 32px |

### Terminal

**文件**: `src/features/terminal/index.tsx`

| 图标 | 使用位置 | 当前尺寸 | 建议尺寸 |
|------|----------|----------|----------|
| AlertCircle | 错误提示 | 无（默认） | 14px |
| Loader2 | 加载中 | 无（默认） | 14px |
| Terminal | 空状态图标 | 无（默认） | 32px |

### Runbooks

**文件**: `src/features/runbooks/index.tsx`

| 图标 | 使用位置 | 当前尺寸 | 建议尺寸 |
|------|----------|----------|----------|
| AlertCircle | 错误提示 | 无（默认） | 14px |
| BookMarked | 空状态图标 | 无（默认） | 32px |
| Check | 成功标记 | 无（默认） | 14px |
| Loader2 | 加载中 | 无（默认） | 14px |
| Pencil | 编辑按钮 | 无（默认） | 14px |
| Play | 运行按钮 | 无（默认） | 14px |
| Plus | 新建按钮 | 无（默认） | 14px |
| Trash2 | 删除按钮 | 无（默认） | 14px |
| X | 关闭按钮 | 无（默认） | 14px |

### Compare

**文件**: `src/features/compare/index.tsx`

| 图标 | 使用位置 | 当前尺寸 | 建议尺寸 |
|------|----------|----------|----------|
| AlertCircle | 错误提示 | 无（默认） | 14px |
| ChevronDown | 下拉箭头 | 无（默认） | 14px |
| Clock | 时间图标 | 无（默认） | 14px |
| Coins | 成本图标 | 无（默认） | 14px |
| Columns3 | 空状态图标 | 无（默认） | 32px |
| Download | 下载按钮 | 无（默认） | 14px |
| Loader2 | 加载中 | 无（默认） | 14px |
| Play | 运行按钮 | 无（默认） | 14px |
| Plus | 新建按钮 | 无（默认） | 14px |
| Square | 停止按钮 | 无（默认） | 14px |
| X | 关闭按钮 | 无（默认） | 14px |

### Models

**文件**: `src/features/models/index.tsx`

| 图标 | 使用位置 | 当前尺寸 | 建议尺寸 |
|------|----------|----------|----------|
| AlertCircle | 错误提示 | 无（默认） | 14px |
| CheckCircle2 | 成功标记 | 无（默认） | 14px |
| Eye | 显示密钥 | 无（默认） | 14px |
| EyeOff | 隐藏密钥 | 无（默认） | 14px |
| FileText | 空状态图标 | 无（默认） | 32px |
| Info | 信息提示 | 无（默认） | 14px |
| Key | 密钥图标 | 无（默认） | 14px |
| Loader2 | 加载中 | 无（默认） | 14px |
| RefreshCw | 刷新按钮 | 无（默认） | 14px |
| RotateCcw | 重启按钮 | 无（默认） | 14px |
| Save | 保存按钮 | 无（默认） | 14px |
| Search | 搜索图标 | 无（默认） | 14px |

### Trajectory

**文件**: `src/features/trajectory/index.tsx`

| 图标 | 使用位置 | 当前尺寸 | 建议尺寸 |
|------|----------|----------|----------|
| AlertCircle | 错误提示 | 无（默认） | 14px |
| ChevronDown | 下拉箭头 | `className="h-3 w-3"` | 12px |
| Clock | 时间图标 | `className="h-3 w-3"` | 12px |
| Coins | Token 图标 | `className="h-3 w-3"` | 12px |
| GitBranch | 空状态图标 | 无（默认） | 32px |
| Hammer | 工具调用图标 | `className="h-3 w-3"` | 12px |
| Loader2 | 加载中 | `className="h-4 w-4"` | 16px |
| MessageSquare | 消息图标 | `className="h-3 w-3"` | 12px |
| Sparkles | 空状态装饰 | 无（默认） | 24px |
| User | 用户图标 | 无（默认） | 14px |
| Wrench | 工具图标 | `className="h-3 w-3"` | 12px |

### Settings

**文件**: `src/features/settings/index.tsx`

| 图标 | 使用位置 | 当前尺寸 | 建议尺寸 |
|------|----------|----------|----------|
| AlertCircle | 错误提示 | 无（默认） | 14px |
| CheckCircle2 | 成功标记 | 无（默认） | 14px |
| Check | 成功标记 | 无（默认） | 14px |
| Copy | 复制按钮 | 无（默认） | 14px |
| Eye | 显示密钥 | 无（默认） | 14px |
| EyeOff | 隐藏密钥 | 无（默认） | 14px |
| Loader2 | 加载中 | 无（默认） | 14px |
| Monitor | 显示器图标 | 无（默认） | 32px |
| Moon | 暗色模式 | 无（默认） | 14px |
| RotateCcw | 重置按钮 | 无（默认） | 14px |
| Save | 保存按钮 | 无（默认） | 14px |
| Sun | 亮色模式 | 无（默认） | 14px |

## 尺寸建议总结

- **导航图标（Sidebar）**: 16px（固定）
- **顶部栏（Topbar）**: 12-14px
- **按钮内图标**: 14px（`h-3.5 w-3.5`）
- **下拉箭头**: 14px
- **选中标记（Check）**: 14px
- **空状态图标**: 20-32px（视容器大小）
- **装饰性小图标**: 12px（`h-3 w-3`）
- **加载图标（Loader2）**: 14-16px
- **关闭按钮（X）**: 14-16px

## 替换优先级

### 高优先级（核心导航 + 顶部栏）
1. 导航图标（15 个）- 16px
2. 顶部栏图标（4 个）- 12-14px

### 中优先级（常用 UI 组件）
3. Check / ChevronDown（combobox/select）- 14px
4. X（drawer/close）- 16px
5. Loader2（加载状态）- 14px
6. AlertCircle / AlertTriangle（错误/警告）- 14px

### 低优先级（功能页面）
7. 各功能页面的操作按钮（Plus, Trash2, Pencil, Save 等）- 14px
8. 空状态图标- 20-32px
9. 装饰性图标（Sparkles, Coins 等）- 12-24px
