# Out-of-tree Packs

Customer / industry Packs live here, **outside** the base binary. They
are version-controlled but are NOT bundled into `Corey.app` —
`src-tauri/tauri.conf.json::bundle.resources` only ships the generic
`cross_border_ecom` skeleton under `src-tauri/assets/skill-packs/`.

This enforces the architecture iron rule from
`docs/01-architecture.md` § Pack Architecture:

> 唯一基座二进制 + 数据驱动定制 — 客户差异 100% 在 `~/.hermes/` 数据
> 目录里，**Pack 不能写 React 代码，也不能塞进基座 binary**。

## Installing a Pack on a customer machine

There is currently **one** supported flow:

1. Zip the Pack directory (e.g. `cd packs && zip -r meizheng.zip
   meizheng -x '*.DS_Store'`).
2. Settings → Packs → "导入 zip" → pick the zip. This calls the
   `pack_import_zip` IPC which extracts into
   `~/.hermes/skill-packs/<id>/`.
3. Toggle the Pack on in the same Settings page.

The Pack is now indistinguishable from any user-installed Pack — it
gets the same `~/.hermes/pack-data/<id>/` data dir, the same
`pack-state.json` enable bit, and the same backup / uninstall paths.

## Why not bundle them?

Two reasons:

- **One binary for all customers**: shipping `meizheng/` inside the
  base means every Pack ships to every customer (license-features
  guard the *load*, not the *presence*). Out-of-tree keeps the binary
  generic.
- **Decoupled release cadence**: Pack manifest churn (e.g. fuel rate
  config tweaks) shouldn't force a base binary rebuild + redownload
  for every customer.

## Adding a new Pack

Mirror the layout of `packs/meizheng/`:

```
packs/<id>/
  manifest.yaml          # schema_version: 1, id, version, title, ...
  README.md              # customer-facing notes
  skills/*.md            # Hermes skill files
  workflows/*.yaml       # Hermes workflow definitions
  scripts/*.py           # invoked by workflows via Hermes shell tool
  config/*.yaml          # default config snapshots (UI seeds from these)
```

Skill manifest schema is documented in
`src-tauri/src/pack/manifest.rs`. Use
`@/Users/zbin/AI项目/CoreyOS/src-tauri/assets/skill-packs/cross_border_ecom/manifest.yaml`
as a known-good reference.
