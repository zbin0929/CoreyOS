# Hermes Agent Reference

## Overview

Hermes Agent is an open-source self-improving AI agent by Nous Research (MIT license, 28K+ GitHub stars). It features a closed learning loop: auto-creates skills from experience, improves them during use, builds persistent memory, and models the user across sessions.

## Architecture

Core components:
- **Gateway**: Single process handles 15+ messaging platforms (Telegram, Discord, Slack, WhatsApp, Signal, Matrix, Mattermost, Email, SMS, DingTalk, Feishu, WeCom, BlueBubbles, Home Assistant)
- **Agent Loop**: LLM calls + 47 built-in tools + MCP integration
- **Skills System**: Procedural memory (auto-created, self-improving, agentskills.io compatible)
- **Memory**: Persistent MEMORY.md + USER.md + FTS5 session search + Honcho user modeling
- **Terminal Backends**: local, Docker, SSH, Daytona, Singularity, Modal (6 options)
- **Cron Scheduler**: Built-in with delivery to any platform

## File Layout (~/.hermes/)

```
~/.hermes/
├── config.yaml          # Main config: model, tools, memory, gateway settings
├── .env                 # API keys and secrets (TELEGRAM_BOT_TOKEN, OPENAI_API_KEY, etc.)
├── MEMORY.md            # Agent-curated persistent memory
├── USER.md              # User profile accumulated over sessions
├── SOUL.md              # Global personality/voice definition
├── AGENTS.md            # Workspace-level instructions
├── skills/              # Procedural memory (YAML skill files)
│   ├── openclaw-imports/
│   └── *.yaml
├── sessions/            # Conversation history (FTS5 searchable)
└── workspace/           # Working directory for file operations
```

## Configuration (config.yaml)

```yaml
model:
  provider: openrouter       # nous/openrouter/openai/anthropic/google/deepseek/ollama
  name: hermes-3-llama-3.1-70b

tools:
  enabled: [web, terminal, browser, vision, image_gen, tts, code_exec]
  
memory:
  enabled: true
  auto_nudge: true           # Periodic reminders to persist knowledge
  session_search: true       # FTS5 cross-session recall
  
skills:
  auto_create: true          # Generate skills from complex tasks
  auto_improve: true         # Refine skills during reuse
  
gateway:
  platforms:
    - telegram
    - discord
    - slack
  security:
    command_approval: true   # Require user confirmation for risky operations
    dm_pairing: true         # Only paired users can interact
    
terminal:
  backend: local             # local/docker/ssh/daytona/singularity/modal
  
cron:
  enabled: true
```

## Environment Variables (~/.hermes/.env)

```bash
# Model providers
NOUS_API_KEY=nsk-xxxxxxxxxxxx
OPENROUTER_API_KEY=sk-or-xxxxxxxxxxxx
OPENAI_API_KEY=sk-xxxxxxxxxxxx
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx
GOOGLE_API_KEY=AIzaxxxxxxxxxx
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxx

# Telegram
TELEGRAM_BOT_TOKEN=123456789:AAFxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TELEGRAM_ALLOWED_USERS=123456789,987654321

# Discord
DISCORD_BOT_TOKEN=MTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
DISCORD_ALLOWED_USERS=123456789012345678,987654321098765432

# Slack
SLACK_BOT_TOKEN=xoxb-xxxxxxxxxx-xxxxxxxxxx-xxxxxxxxxxxxxxxx
SLACK_SIGNING_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SLACK_APP_TOKEN=xapp-xxxxxxxxxx-xxxxxxxxxx-xxxxxxxxxxxxxxxx  # Socket Mode
SLACK_ALLOWED_USERS=U01ABC123DE,U01FGH456IJ
```

## CLI Commands

```bash
hermes                        # Interactive TUI
hermes setup                  # First-time setup wizard
hermes model                  # Interactive model picker
hermes tools                  # Configure toolsets
hermes config set KEY VALUE   # Set config value
hermes gateway setup          # Configure messaging platforms
hermes gateway start          # Start gateway (--daemon for background)
hermes gateway status         # Check gateway health
hermes doctor                 # Diagnose issues
hermes update                 # Self-update

# Chat flags
hermes --model openai/gpt-4o              # Specify model
hermes --toolsets web,terminal,browser     # Enable toolsets
hermes --continue                          # Resume last session
hermes --verbose                           # Show tool calls
hermes --yolo                              # Auto-approve all (dangerous)
hermes -s skill_name                       # Activate a skill
hermes chat -q "question"                  # One-shot query
```

## Slash Commands (shared across CLI + messaging)

| Command | Description |
|---------|-------------|
| `/new` | Start fresh conversation |
| `/reset` | Reset current session |
| `/model [provider:model]` | Switch model mid-session |
| `/personality [name]` | Switch personality |
| `/retry` | Retry last assistant turn |
| `/undo` | Undo last turn |
| `/compress` | Compress context window |
| `/usage` | Show token usage |
| `/insights [--days N]` | Usage insights |
| `/skills` | Browse skills |
| `/stop` | Interrupt current work |
| `/voice join` | Join voice channel (Discord) |
| `/voice leave` | Leave voice channel |
| `/platforms` | Show platform status |
| `/status` | Gateway status (messaging) |
| `/sethome` | Set home platform |

## Telegram Setup

1. Create Bot via @BotFather → `/newbot` → get Token
2. Get user ID via @userinfobot
3. Set env: `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ALLOWED_USERS`
4. Run `hermes gateway setup` → select Telegram
5. Run `hermes gateway start`

Features: text (Markdown), voice memo transcription, image analysis, file attachments, group support (@mention or disable Privacy Mode), auto-split long messages, code formatting.

BotFather recommended settings:
```
/setcommands → new, reset, model, help
/setdescription → "Hermes Agent powered AI assistant"
/setjoingroups → Enable
```

## Slack Setup

1. Create App at api.slack.com/apps → From scratch
2. Bot Token Scopes: `chat:write`, `im:history`, `im:read`, `im:write`, `channels:history`, `files:read`, `files:write`, `users:read`
3. Install to Workspace → get `xoxb-` token
4. Enable Event Subscriptions → subscribe to `message.im`, `message.channels`, `app_mention`
5. Socket Mode (recommended for local): enable → generate `xapp-` token with `connections:write`
6. Set env: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN` (Socket Mode), `SLACK_ALLOWED_USERS`

Usage: DM directly, or @mention in channels. Invite bot to channel: `/invite @HermesAgent`.

## Discord Setup

1. Create App at discord.com/developers/applications → New Application → Add Bot
2. Copy Bot Token
3. Enable Privileged Gateway Intents: Server Members Intent + Message Content Intent
4. OAuth2 → URL Generator → Scopes: `bot`, `applications.commands` → Permissions: Send Messages, Read Message History, Attach Files, Embed Links, Connect, Speak, Use Voice Activity
5. Set env: `DISCORD_BOT_TOKEN`, `DISCORD_ALLOWED_USERS`
6. Invite bot via generated URL

Features: DM, server channels (@mention), slash commands, voice channels (`/voice join/leave`).

## Skills System

Skills are YAML files in `~/.hermes/skills/`. Three creation paths:

1. **Auto-extraction**: Agent detects reusable patterns and prompts to save
2. **Manual creation**: Write YAML directly
3. **From conversation**: Ask agent to create a skill

Skill YAML format:
```yaml
name: git_summary
description: Generate Git commit summary report
version: "1.0"
author: your_name
tags: [git, development]
steps:
  - tool: terminal
    command: git log --oneline -20
    description: Get last 20 commits
  - tool: terminal
    command: git diff --stat HEAD~5
    description: Show recent change stats
  - tool: llm
    prompt: |
      Based on the git info above, generate a concise summary report.
```

Skills are portable, shareable via Skills Hub (agentskills.io open standard), and self-improve during use.

## Memory System

- **MEMORY.md**: Agent-curated persistent memory with dated `## [auto]` sections
- **USER.md**: Accumulated user profile (preferences, patterns, expertise)
- **SOUL.md**: Global personality/voice definition
- **Session search**: FTS5 full-text search across all past conversations
- **Auto-nudge**: Periodic reminders to persist important knowledge
- **Honcho**: Dialectic user modeling for deeper personalization

## MCP Integration

Hermes supports MCP in both directions:
- **Client mode**: Connect to external MCP servers for extended tools
- **Server mode**: Expose Hermes tools to IDEs and other MCP clients

## Cron Scheduling

Built-in cron scheduler with natural language task definition:
- Daily reports, nightly backups, weekly audits
- Delivery to any configured platform
- Managed via `hermes gateway setup` and config.yaml

## Security Model

- Command approval: risky operations require user confirmation
- DM pairing: only authorized users can interact
- Container isolation: Docker/Singularity backends sandbox execution
- Secrets in .env, never in config.yaml

## Supported Models (200+)

Via OpenRouter: all major providers
Direct: OpenAI, Anthropic, Google, DeepSeek, Nous Portal
Local: Ollama (any GGUF model)
Special: NVIDIA NIM, Xiaomi MiMo, z.ai/GLM, Kimi/Moonshot, MiniMax, Hugging Face

Switch instantly: `hermes model` or `/model provider:name`
