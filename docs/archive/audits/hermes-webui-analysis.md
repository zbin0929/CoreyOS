# Hermes WebUI Analysis for CoreyOS

## 1. What is Hermes WebUI

Official web frontend for Hermes Agent. 1900+ tests, 50+ sprints, MIT license.
Python (stdlib HTTPServer) + Vanilla JS. Zero framework, zero build step.

GitHub: `nesquena/hermes-webui`
Version: v0.50.156 (April 2026)
Test count: 1903

Architecture: Three-panel layout (sessions sidebar | chat center | workspace right panel).
Composer footer always shows model selector, context ring, attach/mic buttons.

## 2. Architecture Comparison

| Dimension | Hermes WebUI | CoreyOS |
|-----------|-------------|---------|
| Frontend | Vanilla JS (10 files, ~7100 lines) | React + TanStack Router + Zustand |
| Backend | Python stdlib ThreadingHTTPServer | Rust (Tauri) |
| Agent comm | Direct Python import (`from run_agent import AIAgent`) | CLI subprocess + HTTP API |
| Session storage | File system JSON (`~/.hermes/webui/sessions/`) | SQLite (CoreyOS db) |
| Streaming | SSE via `queue.Queue` | SSE via Tauri event emit |
| Model mgmt | Reads Hermes config.yaml live | Own LlmProfile system |
| Channel config | Proxies through Hermes CLI | Own ChannelSpec system |
| Skills | Reads/writes `~/.hermes/skills/` YAML | Same YAML, own UI |
| Memory | Reads/writes MEMORY.md / USER.md | Own Memory page |
| Cron | Direct Hermes cron module calls | Own Scheduler page |
| Profiles | Multi-profile = multiple `~/.hermes/` dirs | Config snapshots |
| Deployment | Docker / SSH / Tailscale | Desktop (Tauri) |
| Auth | Optional password (PBKDF2) | None (local app) |
| Mobile | Responsive + PWA | Tauri window |

## 3. API Surface (100+ endpoints)

### Session Management
```
GET  /api/sessions                    List all sessions
GET  /api/session?sid=X               Get session detail
POST /api/session/new                 Create session
POST /api/session/rename              Rename
POST /api/session/delete              Delete
POST /api/session/update              Update messages
POST /api/session/clear               Clear messages
POST /api/session/truncate            Truncate to N messages
POST /api/session/compress            Trigger context compression
POST /api/session/retry               Retry last assistant
POST /api/session/undo                Undo last turn
POST /api/session/pin                 Pin/unpin
POST /api/session/archive             Archive/unarchive
POST /api/session/move                Move to project
GET  /api/session/export?sid=X        Export as JSON
GET  /api/session/status?sid=X        Check if streaming
POST /api/session/yolo                Toggle auto-approve
GET  /api/session/usage?sid=X         Token usage stats
```

### Chat & Streaming
```
POST /api/chat/start                  Start agent (returns stream_id)
GET  /api/chat/stream?sid=X           SSE stream (token/tool/approval/done/error)
GET  /api/chat/stream/status          Check active streams
POST /api/chat/cancel                 Cancel running stream
POST /api/chat/steer                  Mid-stream steering
POST /api/chat                        Sync fallback (debug only)
```

### Gateway Session Sync (KEY FEATURE)
```
GET  /api/sessions/gateway/stream     SSE: real-time CLI/Telegram/Discord sessions
                                      (polls state.db every 5s, pushes changes)
```

### Models & Providers
```
GET  /api/models                      List from config.yaml
GET  /api/models/live                 Live probe provider APIs (with SSRF guard)
GET  /api/providers                   List configured providers
POST /api/providers                   Add custom provider
POST /api/providers/delete            Remove provider
GET  /api/default-model               Get default model
```

### Workspace & Files
```
GET  /api/list?path=X                 Directory listing (200 max entries)
GET  /api/file?path=X                 Read file content (200KB limit)
GET  /api/file/raw?path=X             Raw binary download
POST /api/file/save                   Save file content
POST /api/file/delete                 Delete file
POST /api/file/create                 Create new file
POST /api/file/rename                 Rename file
POST /api/file/create-dir             Create directory
POST /api/upload                      Multipart upload (20MB limit)
GET  /api/workspaces                  List workspaces
POST /api/workspaces/add              Register workspace
POST /api/workspaces/remove           Unregister workspace
POST /api/workspaces/rename           Rename workspace
GET  /api/workspaces/suggest          Suggest workspace paths
GET  /api/git-info                    Git branch + dirty count
```

### Cron (Scheduled Tasks)
```
GET  /api/crons                       List cron jobs
POST /api/crons/create                Create job
POST /api/crons/update                Update job
POST /api/crons/delete                Delete job
POST /api/crons/run                   Run job now
POST /api/crons/pause                 Pause job
POST /api/crons/resume                Resume job
GET  /api/crons/output                Get job output
GET  /api/crons/recent                Recent job runs
```

### Skills
```
GET  /api/skills                      List skills
GET  /api/skills/content?name=X       Read skill YAML
POST /api/skills/save                 Create/update skill
POST /api/skills/delete               Delete skill
```

### Memory
```
GET  /api/memory                      Read MEMORY.md
POST /api/memory/write                Write MEMORY.md
```

### Profiles
```
GET  /api/profiles                    List profiles with status
GET  /api/profile/active              Get active profile name
POST /api/profile/switch              Switch profile (sets HERMES_HOME)
POST /api/profile/create              Create profile (with optional clone)
POST /api/profile/delete              Delete profile
```

### Approval System
```
GET  /api/approval/pending            Check pending approval
POST /api/approval/respond            Respond: once/session/always/deny
```

### Settings & Onboarding
```
GET  /api/settings                    Read settings.json
POST /api/settings                    Update settings
GET  /api/onboarding/status           Check first-run status
POST /api/onboarding/setup            Provider setup wizard
POST /api/onboarding/complete         Mark onboarding done
```

### Other
```
GET  /health                          Health check
GET  /api/personalities               List SOUL.md personalities
POST /api/personality/set             Set active personality
GET  /api/commands                    List slash commands
GET  /api/updates/check               Check for updates
POST /api/admin/reload                Reload config
GET  /api/reasoning                   Get reasoning display setting
POST /api/reasoning                   Toggle reasoning display
POST /api/transcribe                  Voice transcription
POST /api/btw                         Background task
GET  /api/background/status           Background task status
POST /api/projects/create             Create session project group
GET  /api/projects                    List projects
GET  /api/sessions/search?q=X         Search sessions by content
POST /api/sessions/cleanup            Remove zero-message sessions
```

## 4. Key Design Patterns Worth Borrowing

### 4.1 GatewayWatcher (Real-time Multi-platform Session Sync)

**How it works:**
- Background daemon thread polls Hermes `state.db` (SQLite) every 5 seconds
- Computes MD5 hash of session IDs + timestamps for change detection
- On change: pushes `{type: 'sessions_changed', sessions: [...]}` to all SSE subscribers
- WebUI sidebar shows CLI/Telegram/Discord sessions with gold "cli" badge
- Click to import full conversation history

**Value for CoreyOS:** Currently CoreyOS only shows its own sessions. Adding GatewayWatcher would let users see ALL conversations across all platforms (CLI, Telegram, Discord, Slack, etc.) in one sidebar.

**Implementation path:**
- Rust: Read `~/.hermes/state.db` SQLite directly (already have `rusqlite`)
- New IPC: `gateway_sessions_list` command
- Frontend: Add "Gateway Sessions" section to SessionsPanel

### 4.2 Approval Card (4-level Command Approval)

**How it works:**
- Agent hits dangerous shell command → Hermes approval module blocks
- SSE pushes `approval` event with command text + description
- UI shows inline card with 4 buttons: Allow Once / Allow Session / Always / Deny
- "Always" writes to permanent allowlist in config

**Value for CoreyOS:** Our approval step in Workflow is auto-approved. Adding real human-in-the-loop approval for dangerous operations would be a security win.

### 4.3 Tool Call Inline Cards

**How it works:**
- Each tool invocation during streaming emits a `tool` SSE event
- UI renders inline card: tool name + args preview + result snippet
- Expand/collapse toggle for multi-tool turns
- Subagent delegation shown with distinct icon + indented border

**Value for CoreyOS:** Our Trajectory page shows tool calls separately. Inlining them in the chat bubble would be much more useful.

### 4.4 Context Ring (Real-time Token Usage)

**How it works:**
- Circular indicator in composer footer
- Shows token count, cost estimate, fill percentage
- Model-aware (knows context window size per model)
- Color changes as context fills up

**Value for CoreyOS:** We have budget gate but no real-time visibility. Adding a token counter would help users manage costs.

### 4.5 Multi-Profile with True Isolation

**How it works:**
- Each profile = separate `~/.hermes/profiles/<name>/` directory
- Switching changes `HERMES_HOME` env var + monkey-patches module caches
- .env secrets are cleared and reloaded per profile (prevents key leakage)
- Each profile has its own config.yaml, skills, memory, cron, sessions

**Value for CoreyOS:** Our Profiles are just config snapshots. True isolation means different API keys, models, and agent configs per profile.

### 4.6 Session Projects + Tags

**How it works:**
- Projects: named groups with colors (stored in `projects.json`)
- Tags: `#tag` in session title → colored chips → click to filter
- Sessions grouped by Today / Yesterday / Earlier

**Value for CoreyOS:** Our session list is flat. Adding projects and tags would help organize many sessions.

### 4.7 Onboarding Wizard

**How it works:**
- First-run detection (`settings.json` has `onboarding_complete` flag)
- Step-by-step: Choose Provider → Enter API Key → Select Model → Start
- Provider config written directly to `config.yaml` + `.env`
- Hidden after completion

**Value for CoreyOS:** New users currently see an empty app. A wizard would dramatically reduce time-to-first-message.

### 4.8 Title Generation (Robust)

**How it works:**
- After each conversation, extracts (first_user_text, first_assistant_text)
- Sends to LLM with carefully crafted prompt
- Strips thinking markup, chain-of-thought leakage, meta-reasoning
- Retry with doubled completion budget on length/empty failures
- Falls back to first 64 chars of user message
- Periodic auto-refresh title as conversation evolves

**Value for CoreyOS:** Our title generation is simpler. The retry + sanitization logic would improve quality.

### 4.9 Streaming Metering

**How it works:**
- Per-session TPS tracking (tokens per second)
- Global TPS = average across active sessions
- 60-minute rolling HIGH/LOW history
- Emits `metering` SSE events for live header display

**Value for CoreyOS:** Adding TPS display would help users understand model performance differences.

## 5. Hermes Internal APIs Discovered

WebUI directly imports Hermes Python modules, revealing the true internal API:

```python
from run_agent import AIAgent                # Core agent class
from tools.approval import approve_session   # Approval system
from cron.jobs import list_jobs, create_job  # Cron scheduler
from tools.skills_tool import list_skills    # Skills system
from hermes_cli.profiles import list_profiles, create_profile  # Profiles
from agent.auxiliary_client import _get_auxiliary_task_config  # Auxiliary tasks
```

AIAgent constructor:
```python
AIAgent(
    model='openai/gpt-4o',
    platform='cli',
    quiet_mode=True,
    enabled_toolsets=['web', 'terminal', 'browser'],
    session_id='abc123',
    stream_delta_callback=on_token,    # per-token callback
    tool_progress_callback=on_tool,    # per-tool callback
)
agent.run_conversation(
    user_message='hello',
    conversation_history=[...],
    task_id='abc123',          # NOT session_id keyword!
)
```

state.db schema (sessions we can read):
```sql
SELECT s.id, s.title, s.model, s.message_count, s.started_at, s.source,
       s.parent_session_id, s.ended_at, s.end_reason,
       COUNT(m.id) AS actual_message_count,
       MAX(m.timestamp) AS last_activity
FROM sessions s LEFT JOIN messages m ON m.session_id = s.id
WHERE s.source IS NOT NULL AND s.source != 'webui'
GROUP BY s.id
```

## 6. What NOT to Borrow

| Pattern | Reason |
|---------|--------|
| Vanilla JS | CoreyOS already uses React; rewrite makes no sense |
| Python backend | Rust/Tauri is faster and more appropriate for desktop |
| File system JSON sessions | SQLite is more robust |
| stdlib HTTPServer | Tauri IPC is better for desktop |
| process-global env vars | Thread-unsafe; Tauri's architecture avoids this |
| Monkey-patching module caches | Hack needed because of Python import semantics |

## 7. Priority Recommendations

### High Priority (Direct user impact)
1. **Gateway Session Sync** — Show all platform conversations in one place
2. **Onboarding Wizard** — Reduce new user friction
3. **Tool Call Inline Cards** — Better chat UX

### Medium Priority (Quality of life)
4. **Session Projects + Tags** — Organization for power users
5. **Context Ring / Token Counter** — Cost visibility
6. **Multi-Profile True Isolation** — Separate API keys per use case

### Low Priority (Nice to have)
7. **Approval Card 4-level** — Better security for dangerous ops
8. **Streaming TPS Metering** — Performance visibility
9. **Title Generation Robustness** — Better auto-titles

## 8. Source File Reference

| File | Lines | Purpose |
|------|-------|---------|
| `server.py` | ~165 | Thin routing shell + auth middleware |
| `api/routes.py` | ~1800 | All HTTP handlers (100+ routes) |
| `api/streaming.py` | ~600 | SSE engine, agent thread runner, title generation |
| `api/config.py` | ~700 | Discovery, globals, model detection |
| `api/profiles.py` | ~576 | Multi-profile management |
| `api/agent_sessions.py` | ~196 | Read sessions from Hermes state.db |
| `api/gateway_watcher.py` | ~227 | Background state.db poller + SSE push |
| `api/metering.py` | ~187 | TPS tracking with rolling HIGH/LOW |
| `api/models.py` | ~137 | Session CRUD |
| `api/workspace.py` | ~77 | File operations |
| `api/upload.py` | ~78 | Multipart upload parser |
| `api/auth.py` | ~149 | Password auth with PBKDF2 |
| `static/ui.js` | ~977 | DOM helpers, renderMd, tool cards |
| `static/panels.js` | ~974 | Cron, skills, memory panels |
| `static/sessions.js` | ~533 | Session list, search, actions |
| `static/messages.js` | ~297 | SSE handlers, approval, send |
| `static/boot.js` | ~338 | Event wiring, voice, mobile |
| `static/style.css` | ~1050 | Full CSS including mobile + themes |
