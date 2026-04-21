# Icons

Tauri needs platform icon artifacts in this directory at build time:

```
32x32.png
128x128.png
128x128@2x.png
icon.icns   (macOS)
icon.ico    (Windows)
```

## Generate from a single source image

Once you have a square PNG (≥ 1024×1024) for the Caduceus mark:

```bash
pnpm tauri icon path/to/caduceus-source.png
```

Tauri will emit all five artifacts into this folder.

## Phase 0 workaround

Dev mode (`pnpm tauri dev`) works without custom icons — Tauri falls back to
a default. `pnpm tauri build` requires the real files. If you see

> `failed to bundle project: … could not find icon`

then run the `pnpm tauri icon` command above.

Source image is **not checked in yet**; design TBD. Suggested direction:
a geometric single-line caduceus (see `src/components/ui/caduceus-mark.tsx`)
exported at 1024×1024 on an obsidian (`hsl(225 18% 6%)`) background with
the gold accent (`hsl(43 86% 58%)`).
