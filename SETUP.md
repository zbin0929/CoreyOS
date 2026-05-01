# Setup

First-time setup after pulling the repo.

## Prerequisites

| Tool       | Version      | Check command         |
|------------|--------------|-----------------------|
| Node.js    | ≥ 20         | `node --version`      |
| pnpm       | ≥ 9          | `pnpm --version`      |
| Rust       | stable ≥ 1.80| `rustc --version`     |

### Install the missing ones (macOS)

```bash
# Node (via nvm is preferred)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 20
nvm use 20

# pnpm (corepack comes with modern Node)
corepack enable
corepack prepare pnpm@9.12.0 --activate

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

### Windows

- Install Node 20 LTS from nodejs.org (or via `winget install OpenJS.NodeJS.LTS`).
- `corepack enable` then `corepack prepare pnpm@9.12.0 --activate`.
- Install Rust from rustup.rs.
- Install **WebView2 Runtime** (already on Win11; Win10 1803+ needs the evergreen installer from Microsoft).

### Linux (Ubuntu / Debian)

```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

Then install Node + pnpm + Rust as above.

## Install dependencies

```bash
pnpm install
```

This fetches both JS deps (via pnpm) and triggers the first Rust dependency
resolution as a side effect the first time you run Tauri.

## Path gotcha

Our workspace root contains a CJK character (`AI项目`). This is fine for Rust,
Node, and Tauri 2. If your shell cannot `cd` into it, check `LC_ALL=en_US.UTF-8`.

## Run the desktop app (dev)

```bash
pnpm tauri:dev
```

Expected on first run:

1. Vite starts on `:5173`.
2. Cargo compiles `src-tauri/` (~1–2 min cold, ~seconds on rebuild).
3. A 1280×820 window opens with CoreyOS.
4. ⌘K (macOS) / Ctrl+K (Windows) opens the command palette.
5. Clicking sidebar items navigates through the app.

## Run the web-only dev server (no Rust)

```bash
pnpm dev
```

Opens `http://localhost:5173`. Tauri IPC calls will fail; this is useful only
for UI work.

## Useful scripts

```bash
pnpm typecheck     # tsc --noEmit
pnpm lint          # eslint
pnpm format        # prettier write
pnpm tauri:build   # produce platform installers (see "Icons" below first)
```

## Icons

**Both `pnpm tauri:dev` and `pnpm tauri:build`** require icons at the paths
listed in `src-tauri/tauri.conf.json` → `bundle.icon`, because Tauri's
`generate_context!()` macro embeds them at compile time.

A placeholder set is generated on first setup via:

```bash
python3 scripts/generate-placeholder-icon.py   # produces src-tauri/icons/source.png
pnpm tauri icon src-tauri/icons/source.png     # fans out into all 5 required files
```

Replace `source.png` with a real Caduceus mark (≥ 1024×1024 square PNG) when
the brand lands, and rerun the `tauri icon` command.

## Troubleshooting

| Symptom                                                              | Fix |
|----------------------------------------------------------------------|-----|
| `找不到模块 "react"` etc. in IDE                                       | Run `pnpm install` |
| Cargo error: `webkit2gtk-4.1 not found` on Linux                     | See Linux prereqs above |
| Tauri build fails with "could not find icon"                         | Run `pnpm tauri icon path/to/source.png` |
| Port 5173 already in use                                             | Kill the stray Vite, or change `vite.config.ts` `server.port` |
| Window looks unstyled                                                | Hard reload (Cmd+R / Ctrl+R inside the Tauri window) |
| Theme doesn't persist                                                | Clear `localStorage['caduceus.ui']` |

## Next steps

See [`docs/global-todo.md`](./docs/global-todo.md) for the current roadmap and active TODO items.
For architecture details, see [`docs/01-architecture.md`](./docs/01-architecture.md).
