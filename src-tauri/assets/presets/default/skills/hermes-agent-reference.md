# Hermes Agent Reference

## Overview

Hermes Agent is an open-source self-improving AI agent by Nous Research (MIT license, 28K+ GitHub stars). It features a closed learning loop: auto-creates skills from experience, improves them during use, builds persistent memory, and models the user across sessions. It runs anywhere — a $5 VPS, a GPU cluster, or serverless infrastructure (Daytona, Modal) that costs nearly nothing when idle.

## Architecture

Core components:
- **Gateway**: Single process handles 15+ messaging platforms (Telegram, Discord, Slack, WhatsApp, Signal, Matrix, Mattermost, Email, SMS, DingTalk, Feishu, WeCom, BlueBubbles, Home Assistant)
- **Agent Loop**: LLM calls + 47 built-in tools + MCP integration
- **Skills System**: Procedural memory (auto-created, self-improving, agentskills.io compatible)
- **Memory**: Persistent MEMORY.md + USER.md + FTS5 session search + Honcho dialectic user modeling
- **Terminal Backends**: local, Docker, SSH, Daytona, Singularity, Modal (6 options)
- **Cron Scheduler**: Built-in with delivery to any platform
- **Delegation**: Spawn isolated subagents for parallel workstreams; `execute_code` collapses multi-step pipelines into single inference calls

## Installation

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
```

The installer handles everything: Python, Node.js, ripgrep, ffmpeg, repo clone, virtual environment, global `hermes` command setup, and LLM provider configuration.

After installation, reload your shell and start chatting:

```bash
source ~/.bashrc   # or: source ~/.zshrc
hermes             # Start chatting!
```

### Windows (WSL2 Required)

Hermes does **not** run natively on Windows. You must install WSL2 first:

```powershell
# 1. Install WSL2 (restart required)
wsl --install

# 2. Inside WSL2 (Ubuntu), run the standard installer
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash

# 3. Reload shell
source ~/.bashrc

# 4. Start gateway
hermes gateway start
```

**Corey + WSL2 data directory alignment**: Corey (Windows native) and Hermes (WSL2) must share the same data directory. Corey automatically injects `HERMES_HOME` when starting the gateway via `wsl -e`, pointing to the Windows-side data directory translated to `/mnt/c/...` format. No manual configuration needed.

| Component | Data directory |
|-----------|---------------|
| Corey (Windows native) | `C:\Users\<you>\AppData\Local\Corey\hermes` |
| Hermes (WSL2, via Corey) | `HERMES_HOME=/mnt/c/Users/<you>/AppData/Local/Corey/hermes` |

### Android / Termux

```bash
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
```

The installer detects Termux automatically and switches to a tested Android flow. Note: the full `.[all]` extra is not available on Android (voice extra depends on `faster-whisper` → `ctranslate2`, which lacks Android wheels). Use `.[termux]` instead.

### Manual / Developer Installation

```bash
git clone https://github.com/NousResearch/hermes-agent.git
cd hermes-agent
pip install -e ".[all]"
```

## File Layout (HERMES_HOME, default ~/.hermes/)

All data lives in `HERMES_HOME` (default `~/.hermes/`). Set `HERMES_HOME` to relocate data.

```
~/.hermes/
├── config.yaml          # Main config: model, tools, memory, gateway settings
├── .env                 # API keys and secrets (never in config.yaml)
├── auth.json            # OAuth provider credentials (Nous Portal, etc.)
├── SOUL.md              # Primary agent identity (slot #1 in system prompt)
├── memories/
│   ├── MEMORY.md        # Agent-curated persistent memory
│   └── USER.md          # User profile accumulated over sessions
├── skills/              # Procedural memory (SKILL.md files)
│   └── <skill-name>/
│       └── SKILL.md
├── cron/                # Scheduled jobs
│   └── jobs.json
├── sessions/            # Conversation history (FTS5 searchable)
├── logs/                # Logs (errors.log, gateway.log — secrets auto-redacted)
└── workspace/           # Working directory for file operations
```

## Configuration

### Managing Configuration

```bash
hermes config                      # View current configuration
hermes config edit                 # Open config.yaml in your editor
hermes config set KEY VAL          # Set a specific value
hermes config check                # Check for missing options (after updates)
hermes config migrate              # Interactively add missing options
# Examples:
hermes config set model anthropic/claude-opus-4
hermes config set terminal.backend docker
hermes config set OPENROUTER_API_KEY sk-or-...   # Saves to .env
```

`hermes config set` automatically routes values to the right file — API keys to `.env`, everything else to `config.yaml`.

### Configuration Precedence

1. **CLI arguments** — e.g., `hermes chat --model anthropic/claude-sonnet-4` (per-invocation override)
2. **config.yaml** — primary config for all non-secret settings
3. **.env** — fallback for env vars; required for secrets (API keys, tokens, passwords)
4. **Built-in defaults** — hardcoded safe defaults when nothing else is set

### Environment Variable Substitution

Reference env vars in config.yaml using `${VAR_NAME}` syntax:

```yaml
auxiliary:
  vision:
    api_key: ${GOOGLE_API_KEY}
    base_url: ${CUSTOM_VISION_URL}
```

Multiple references work: `url: "${HOST}:${PORT}"`. Undefined vars are kept verbatim.

### config.yaml Reference

```yaml
model:
  provider: openrouter       # nous/openrouter/openai/anthropic/google/deepseek/ollama/custom
  name: hermes-3-llama-3.1-70b

tools:
  enabled: [web, terminal, browser, vision, image_gen, tts, code_exec]

memory:
  memory_enabled: true
  user_profile_enabled: true
  memory_char_limit: 2200     # ~800 tokens
  user_char_limit: 1375       # ~500 tokens
  auto_nudge: true            # Periodic reminders to persist knowledge
  session_search: true        # FTS5 cross-session recall

skills:
  auto_create: true           # Generate skills from complex tasks
  auto_improve: true          # Refine skills during reuse

gateway:
  platforms:
    - telegram
    - discord
    - slack
  security:
    command_approval: true    # Require user confirmation for risky operations
    dm_pairing: true          # Only paired users can interact

terminal:
  backend: local             # local/docker/ssh/daytona/singularity/modal

cron:
  enabled: true

# File read safety
file_read_max_chars: 100000  # ~25-35K tokens (default)

# Delegation (subagents)
delegation:
  max_concurrent_children: 3  # Parallel children per batch
  max_spawn_depth: 1          # Delegation tree depth (1-3)
  orchestrator_enabled: true   # Allow orchestrator role

# Clarification prompt
clarify:
  timeout: 120               # Seconds to wait for user clarification

# Discord-specific
discord:
  require_mention: true       # Require @mention in server channels
  free_response_channels: ""  # Channel IDs where bot responds without @mention
  auto_thread: true           # Auto-create threads on @mention

# Security
security:
  redact_secrets: false       # Redact API key patterns in tool output
  tirith_enabled: true        # Pre-exec security scanning for terminal commands
  tirith_path: "tirith"
  tirith_timeout: 5
  tirith_fail_open: true      # Allow command if tirith unavailable
  website_blocklist:
    enabled: false
    domains: []
  shared_files: []

# Approvals (dangerous command approval)
approvals:
  mode: manual                # manual | smart | off
  timeout: 60                 # Seconds to wait for user response
```

### Custom / Local LLM Endpoint

```yaml
model:
  default: qwen3.5:27b
  provider: custom
  base_url: http://localhost:11434/v1
```

Works with Ollama, vLLM, llama.cpp server, SGLang, LocalAI. Hermes auto-detects local endpoints and relaxes streaming timeouts (120s → 1800s).

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

# YOLO mode (bypass all dangerous command approval)
HERMES_YOLO_MODE=1

# Data directory override
HERMES_HOME=/custom/path/.hermes

# Local LLM extended timeout
HERMES_STREAM_READ_TIMEOUT=1800
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
hermes backup                 # Export data for migration
hermes import <file.zip>      # Import data on new machine

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
| `/yolo` | Toggle YOLO mode (auto-approve all commands) |
| `/voice join` | Join voice channel (Discord) |
| `/voice leave` | Leave voice channel |
| `/platforms` | Show platform status |
| `/status` | Gateway status (messaging) |
| `/sethome` | Set home platform |

## Tools & Toolsets

### Available Tools

| Category | Tools |
|----------|-------|
| Web | `web_search`, `web_extract` |
| Terminal | `terminal`, `process` (background process management) |
| File | `read_file`, `patch` |
| Browser | `browser_navigate`, `browser_snapshot`, `browser_vision` |
| Vision | `vision_analyze` |
| Image | `image_generate` |
| Audio | `text_to_speech` |
| Code | `execute_code` |
| Delegation | `delegate_task` |
| Memory | `memory`, `session_search` |
| Scheduling | `cronjob` |
| Messaging | `send_message` |
| Home Assistant | `ha_*` |
| RL Training | `rl_*` |
| Other | `todo`, `clarify` |

### Toolsets

Toolsets group related tools for easy enabling:

```bash
hermes chat --toolsets "web,terminal"
hermes tools                   # Interactive toolset configuration
```

Common toolsets: `web`, `terminal`, `file`, `browser`, `vision`, `image_gen`, `moa`, `skills`, `tts`, `todo`, `memory`, `session_search`, `cronjob`, `code_execution`, `delegation`, `clarify`, `homeassistant`, `rl`.

Platform presets: `hermes-cli`, `hermes-telegram`. Dynamic MCP toolsets: `mcp-<server>`.

### Terminal Backends

| Backend | Use case |
|---------|----------|
| `local` | Default, commands run on host |
| `docker` | Container isolation with hardened settings |
| `ssh` | Remote execution |
| `singularity` | HPC / shared-cluster isolation |
| `modal` | Serverless cloud, pay-per-use |
| `daytona` | Serverless with persistent environments |

Container backends skip dangerous command checks — the container itself is the security boundary.

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

Discord-specific config:
```yaml
discord:
  require_mention: true       # Require @mention in server channels
  free_response_channels: ""  # Channel IDs for auto-response
  auto_thread: true           # Auto-create threads on @mention
```

## Skills System

Skills are SKILL.md files in `~/.hermes/skills/<name>/SKILL.md`. Three creation paths:

1. **Auto-extraction**: Agent detects reusable patterns and saves via `skill_manage` tool
2. **Manual creation**: Write SKILL.md directly
3. **From conversation**: Ask agent to create a skill

### Progressive Disclosure

Skills use a token-efficient loading pattern:
- **Level 0**: `skills_list()` → name, description, category (~3k tokens)
- **Level 1**: `skill_view(name)` → Full content + metadata
- **Level 2**: `skill_view(name, path)` → Specific reference file

The agent only loads full skill content when it actually needs it.

### SKILL.md Format

```yaml
---
name: my-skill
description: Brief description of what this skill does
version: 1.0.0
platforms: [macos, linux]     # Optional — restrict to specific OS
metadata:
  hermes:
    tags: [python, automation]
    category: devops
    fallback_for_toolsets: [web]   # Conditional activation
    requires_toolsets: [terminal]  # Conditional activation
  config:
    - key: my.setting
      description: "What this controls"
      default: "value"
      prompt: "Prompt for setup"
---
# Skill Title

## When to Use
Trigger conditions for this skill.

## Procedure
1. Step one
2. Step two

## Pitfalls
- Known failure modes and fixes

## Verification
How to confirm it worked.
```

### Skill Config Settings

Skills can declare config settings in their frontmatter. These are stored under `skills.config` in `config.yaml`:

```bash
hermes config set skills.config.myplugin.path ~/myplugin-data
hermes config migrate    # Scan all skills, find unconfigured settings
```

### Skills Hub

Browse, search, install, and manage skills from online registries:

```bash
hermes skills install <skill-name>    # Install from hub
hermes skills list                    # List installed skills
hermes skills reset                   # Reset bundled skills to defaults
```

Skills are portable, shareable via Skills Hub (agentskills.io open standard), and self-improve during use.

## Memory System

Two files make up the agent's memory, stored in `~/.hermes/memories/`:

- **MEMORY.md**: Agent's personal notes (facts, project context, preferences). Character limit keeps it focused (~2200 chars default). When full, agent consolidates or replaces entries.
- **USER.md**: Accumulated user profile (preferences, patterns, expertise). ~1375 chars default.

Both are injected into the system prompt as a **frozen snapshot** at session start (never changes mid-session to preserve LLM prefix cache). Changes are persisted to disk immediately but appear in the next session.

### Memory Tool Actions

- **add** — Add a new memory entry
- **replace** — Replace an existing entry (substring matching via `old_text`)
- **remove** — Remove an entry (substring matching via `old_text`)

No `read` action — memory content is automatically injected into the system prompt.

### Session Search

FTS5 full-text search across all past conversations. Different from memory:
- **Memory** = curated, agent-maintained knowledge
- **Session search** = raw conversation recall

### External Memory Providers

Honcho dialectic user modeling is available as a plugin (`plugins/memory/honcho/`).

## MCP Integration

Hermes supports MCP in both directions:

### Client Mode (Connect to external MCP servers)

Add servers to `config.yaml`:

```yaml
mcp_servers:
  filesystem:
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/projects"]
```

Two server types:
- **Stdio** — local subprocess, configured with `command` + `args`
- **HTTP** — remote server, configured with `url`

Per-server filtering:
```yaml
mcp_servers:
  github:
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-github"]
    tools_whitelist: [create_issue, list_issues]   # Only expose these
    # tools_blacklist: [delete_repo]                # Or block specific tools
    # enabled: false                                # Disable entirely
```

### Server Mode (Expose Hermes tools to external clients)

Hermes can run as an MCP server, exposing its tools to IDEs and other MCP clients. Corey uses this mode to integrate Hermes as a native tool provider.

## Delegation (Subagents)

Spawn isolated subagents for parallel workstreams:

```yaml
delegation:
  max_concurrent_children: 3   # Parallel children per batch
  max_spawn_depth: 1           # Tree depth (1=flat, 2=orchestrator→leaf, 3=3-level)
  orchestrator_enabled: true    # Allow orchestrator role
  # model: "google/gemini-3-flash-preview"  # Override model for subagents
  # provider: "openrouter"                   # Override provider
  # base_url: "http://localhost:1234/v1"     # Direct endpoint (takes precedence)
```

Precedence: `delegation.base_url` → `delegation.provider` → parent provider (inherited).

## Voice Mode

### CLI Voice Mode

Real-time voice conversations in the terminal:

```bash
hermes --voice                 # Start voice mode
```

Features: silence detection, streaming TTS, hallucination filter.

### Gateway Voice Reply (Telegram & Discord)

Voice replies on messaging platforms. Configure TTS provider in config.yaml.

### Discord Voice Channels

Join voice channels for real-time conversation:

```
/voice join    # Join your current voice channel
/voice leave   # Leave voice channel
```

Setup requires Discord bot with Connect + Speak + Use Voice Activity permissions.

### Voice Configuration

```yaml
tts:
  provider: openai            # openai/elevenlabs/nous/custom
  # voice: alloy
  # model: tts-1

stt:
  provider: openai            # openai/faster-whisper/local
```

## Cron Scheduling

Built-in cron scheduler with natural language task definition:
- Daily reports, nightly backups, weekly audits
- Delivery to any configured platform
- Managed via `hermes gateway setup` and config.yaml

## Context Files (SOUL.md, AGENTS.md)

- **SOUL.md** (`~/.hermes/SOUL.md`): Agent's primary identity. Occupies slot #1 in system prompt, completely replacing the built-in default identity. If missing, falls back to built-in default.
- **Project context files** (priority — first match wins): `.hermes.md` → `AGENTS.md` → `CLAUDE.md` → `.cursorrules`. SOUL.md is always loaded independently.
- **AGENTS.md** is hierarchical: subdirectory AGENTS.md files are combined.
- All context files capped at 20,000 characters with smart truncation.

## Security Model (7 Layers)

1. **User authorization** — who can talk to the agent (allowlists, DM pairing)
2. **Dangerous command approval** — human-in-the-loop for destructive operations
3. **Container isolation** — Docker/Singularity/Modal sandboxing with hardened settings
4. **MCP credential filtering** — environment variable isolation for MCP subprocesses
5. **Context file scanning** — prompt injection detection in project files
6. **Cross-session isolation** — sessions cannot access each other's data; cron paths hardened against traversal
7. **Input sanitization** — working directory parameters validated against allowlist

### Dangerous Command Approval

Three modes via `approvals.mode` in config.yaml:
- **manual** — every dangerous command prompts for approval
- **smart** — context-aware approval decisions
- **off** — disable all safety prompts (only in trusted environments)

YOLO mode bypasses all approval for the current session:
```bash
hermes --yolo          # CLI flag
/yolo                  # Slash command toggle
HERMES_YOLO_MODE=1     # Environment variable
```

### What Triggers Approval

Dangerous patterns include: `rm -r`, `chmod 777`, `chown -R root`, `mkfs`, `dd if=`, `DROP TABLE`, `DELETE FROM`, writes to `/etc/` or `~/.ssh/`, `curl | sh`, `bash -c`, `python -e`, `find -exec rm`, `pkill -9`, and more.

Container bypass: Docker, Singularity, Modal, and Daytona backends skip dangerous command checks — the container is the security boundary.

### Approval Flow (CLI)

```
⚠️ DANGEROUS COMMAND: recursive delete
rm -rf /tmp/old-project
[o]nce | [s]ession | [a]lways | [d]eny
Choice [o/s/a/D]:
```

- **once** — allow this single execution
- **session** — allow this pattern for the rest of the session
- **always** — add to permanent allowlist (saved to config.yaml)
- **deny** (default) — block the command

### Secret Redaction

```yaml
security:
  redact_secrets: true    # Redact API key patterns in tool output and logs
```

### Tirith Pre-Exec Scanning

```yaml
security:
  tirith_enabled: true     # Scan terminal commands before execution
  tirith_path: "tirith"    # Path to tirith binary
  tirith_timeout: 5        # Seconds to wait for scan
  tirith_fail_open: true   # Allow command if tirith unavailable
```

## Supported Models (200+)

| Source | Providers |
|--------|-----------|
| **OpenRouter** | All major providers (recommended for flexibility) |
| **Direct** | OpenAI, Anthropic, Google, DeepSeek, Nous Portal |
| **Local** | Ollama (any GGUF model), vLLM, llama.cpp, SGLang, LocalAI |
| **Special** | NVIDIA NIM, Xiaomi MiMo, z.ai/GLM, Kimi/Moonshot, MiniMax, Hugging Face |
| **Custom** | Any OpenAI-compatible endpoint |

Switch instantly: `hermes model` or `/model provider:name`

## Profiles

Hermes supports multiple profiles (each with its own config, memory, sessions):

```bash
hermes --profile work          # Use "work" profile
hermes profile list             # List profiles
hermes profile export <name>    # Export for migration
hermes import <backup.zip>      # Import on new machine
```

Profiles differ from `HERMES_HOME`: `HERMES_HOME` relocates the entire data directory; profiles create isolated subdirectories within it.

## FAQ

**Does it work on Windows?** Not natively. Use WSL2. Corey handles the WSL2 bridge automatically.

**Can I use it offline / with local models?** Yes. Set `provider: custom` and point `base_url` to your local server (Ollama, vLLM, etc.).

**How much does it cost?** Hermes is free (MIT). You only pay for LLM API usage from your chosen provider. Local models are free.

**Can multiple people use one instance?** Yes. The messaging gateway supports multi-user access via allowlists and DM pairing.

**What's the difference between memory and skills?** Memory stores facts (what the agent knows). Skills store procedures (how to do things). Both persist across sessions.

**Can I use it in my own Python project?** Yes. Import `AIAgent` and use programmatically:

```python
from run_agent import AIAgent
agent = AIAgent(model="anthropic/claude-opus-4.7")
response = agent.chat("Explain quantum computing briefly")
```

**Is my data sent anywhere?** API calls go only to your configured LLM provider. No telemetry, no analytics. All data stays local in `~/.hermes/`.
