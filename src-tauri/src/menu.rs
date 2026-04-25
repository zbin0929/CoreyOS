//! Native macOS / Linux / Windows menubar.
//!
//! Tauri 2 ships a default menu (app / File / Edit / View / Window / Help)
//! when you don't set one. The default is usable but generic — it has no
//! app-specific actions like "New Chat" or "Go to Terminal", and the
//! Help menu is empty. This module builds a custom menu that:
//!
//! 1. Keeps every macOS-standard predefined item users expect
//!    (Quit / Hide / Undo / Copy / Paste / Minimize / Fullscreen / …),
//!    so the app behaves like a native citizen.
//! 2. Adds Corey-specific entries (New Chat, Go-to nav, Toggle Theme,
//!    Documentation, Report Issue) that dispatch to the frontend via a
//!    single `menu-action` Tauri event carrying the item id.
//!
//! The frontend listens for `menu-action` in `src/app/useMenuEvents.ts`
//! and maps each id to a store action (navigate, theme toggle, shell
//! open, etc). Predefined items (cut/copy/paste/…) are handled entirely
//! by the OS — we never see those events here.
//!
//! ### Accelerators
//!
//! `CmdOrCtrl` resolves to ⌘ on macOS and Ctrl elsewhere — exactly what
//! the frontend's `useNavShortcuts` already uses, so the menu labels and
//! the in-app shortcuts stay in sync without per-platform forking.

use tauri::{
    menu::{
        AboutMetadataBuilder, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem,
        SubmenuBuilder,
    },
    AppHandle, Emitter, Runtime,
};

/// Navigation targets surfaced in the View menu. Keep `path` in lockstep
/// with `src/app/nav-config.ts`. The `label` is an i18n *key* resolved
/// against `Labels::nav` at build time. `None` for accelerator means
/// "no keyboard shortcut" (still clickable).
struct NavItem {
    key: &'static str,
    path: &'static str,
    accel: Option<&'static str>,
}

const NAV_MENU: &[NavItem] = &[
    NavItem {
        key: "home",
        path: "/",
        accel: Some("CmdOrCtrl+0"),
    },
    NavItem {
        key: "chat",
        path: "/chat",
        accel: Some("CmdOrCtrl+1"),
    },
    NavItem {
        key: "compare",
        path: "/compare",
        accel: Some("CmdOrCtrl+2"),
    },
    NavItem {
        key: "skills",
        path: "/skills",
        accel: Some("CmdOrCtrl+3"),
    },
    NavItem {
        key: "trajectory",
        path: "/trajectory",
        accel: Some("CmdOrCtrl+4"),
    },
    NavItem {
        key: "analytics",
        path: "/analytics",
        accel: Some("CmdOrCtrl+5"),
    },
    NavItem {
        key: "logs",
        path: "/logs",
        accel: Some("CmdOrCtrl+6"),
    },
    NavItem {
        key: "terminal",
        path: "/terminal",
        accel: Some("CmdOrCtrl+7"),
    },
    NavItem {
        key: "scheduler",
        path: "/scheduler",
        accel: Some("CmdOrCtrl+8"),
    },
    NavItem {
        key: "channels",
        path: "/channels",
        accel: Some("CmdOrCtrl+9"),
    },
    NavItem {
        key: "models",
        path: "/models",
        accel: None,
    },
    NavItem {
        key: "profiles",
        path: "/profiles",
        accel: None,
    },
    NavItem {
        key: "runbooks",
        path: "/runbooks",
        accel: None,
    },
    NavItem {
        key: "budgets",
        path: "/budgets",
        accel: None,
    },
];

/// Supported menu locales. Anything unrecognized falls back to English
/// in `from_tag`. Kept tight on purpose — adding a locale means
/// translating ~25 strings below; not a hot path for contributors.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Locale {
    En,
    Zh,
}

impl Locale {
    /// Parse a BCP-47-ish tag (`en`, `en-US`, `zh`, `zh-CN`, …). Case
    /// insensitive; only the primary subtag is considered so
    /// `zh-Hant-HK` still maps to `Zh` rather than an unknown fallback.
    pub fn from_tag(tag: &str) -> Self {
        let primary = tag
            .split(['-', '_'])
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        match primary.as_str() {
            "zh" => Locale::Zh,
            _ => Locale::En,
        }
    }
}

/// All user-visible strings that go into the menu, resolved for a
/// specific locale. Every field is a borrowed `&'static str` — the
/// translation tables are compile-time constants so building the menu
/// does zero heap allocation for the label side (the `format!`s for
/// "Hide Corey" / "Go to Chat" still allocate, but that's unavoidable).
struct Labels {
    // Submenu titles
    file: &'static str,
    edit: &'static str,
    view: &'static str,
    window: &'static str,
    help: &'static str,

    // App menu (predefined items carrying the app name)
    about_tpl: &'static str, // "About {app}"
    hide_tpl: &'static str,  // "Hide {app}"
    quit_tpl: &'static str,  // "Quit {app}"
    hide_others: &'static str,
    show_all: &'static str,

    // File
    new_chat: &'static str,
    close_window: &'static str,

    // Edit (predefined on the Tauri side; we pass custom text because a
    // non-localized Tauri bundle gets no automatic AppKit translation)
    undo: &'static str,
    redo: &'static str,
    cut: &'static str,
    copy: &'static str,
    paste: &'static str,
    select_all: &'static str,

    // View
    go_to_tpl: &'static str, // "Go to {label}"
    toggle_theme: &'static str,
    fullscreen: &'static str,

    // Window
    minimize: &'static str,
    maximize: &'static str,

    // Help
    help_docs: &'static str,
    help_issues: &'static str,

    /// Parallel to `NAV_MENU` — indexed lookup by nav key. Both input
    /// and output are `&'static str`: we only ever call this with a
    /// literal from `NAV_MENU.key`, and the unknown-key fallback
    /// returns the input unchanged, which needs the input to be
    /// `'static` too for the borrow checker to accept.
    nav: fn(&'static str) -> &'static str,
}

impl Labels {
    fn for_locale(locale: Locale) -> Self {
        match locale {
            Locale::En => Labels {
                file: "File",
                edit: "Edit",
                view: "View",
                window: "Window",
                help: "Help",
                about_tpl: "About {app}",
                hide_tpl: "Hide {app}",
                quit_tpl: "Quit {app}",
                hide_others: "Hide Others",
                show_all: "Show All",
                new_chat: "New Chat",
                close_window: "Close Window",
                undo: "Undo",
                redo: "Redo",
                cut: "Cut",
                copy: "Copy",
                paste: "Paste",
                select_all: "Select All",
                go_to_tpl: "Go to {label}",
                toggle_theme: "Toggle Theme",
                fullscreen: "Enter Full Screen",
                minimize: "Minimize",
                maximize: "Zoom",
                help_docs: "Corey Documentation",
                help_issues: "Report an Issue",
                nav: nav_label_en,
            },
            // Translations match Apple's Simplified Chinese localization
            // conventions on macOS — e.g. Copy → 拷贝 (not 复制), Zoom → 缩放,
            // Enter Full Screen → 进入全屏幕. Staying consistent with the OS
            // avoids the uncanny-valley feel of a Chinese app with
            // translations that don't match native macOS apps.
            Locale::Zh => Labels {
                file: "文件",
                edit: "编辑",
                view: "视图",
                window: "窗口",
                help: "帮助",
                about_tpl: "关于 {app}",
                hide_tpl: "隐藏 {app}",
                quit_tpl: "退出 {app}",
                hide_others: "隐藏其他",
                show_all: "全部显示",
                new_chat: "新建对话",
                close_window: "关闭窗口",
                undo: "撤销",
                redo: "重做",
                cut: "剪切",
                copy: "拷贝",
                paste: "粘贴",
                select_all: "全选",
                go_to_tpl: "前往{label}",
                toggle_theme: "切换主题",
                fullscreen: "进入全屏幕",
                minimize: "最小化",
                maximize: "缩放",
                help_docs: "Corey 文档",
                help_issues: "反馈问题",
                nav: nav_label_zh,
            },
        }
    }

    fn about(&self, app: &str) -> String {
        self.about_tpl.replacen("{app}", app, 1)
    }
    fn hide(&self, app: &str) -> String {
        self.hide_tpl.replacen("{app}", app, 1)
    }
    fn quit(&self, app: &str) -> String {
        self.quit_tpl.replacen("{app}", app, 1)
    }
    fn go_to(&self, label: &str) -> String {
        self.go_to_tpl.replacen("{label}", label, 1)
    }
}

fn nav_label_en(key: &'static str) -> &'static str {
    match key {
        "home" => "Home",
        "chat" => "Chat",
        "compare" => "Compare",
        "skills" => "Skills",
        "trajectory" => "Trajectory",
        "analytics" => "Analytics",
        "logs" => "Logs",
        "terminal" => "Terminal",
        "scheduler" => "Scheduler",
        "channels" => "Channels",
        "models" => "Models",
        "profiles" => "Profiles",
        "runbooks" => "Runbooks",
        "budgets" => "Budgets",
        _ => key,
    }
}

fn nav_label_zh(key: &'static str) -> &'static str {
    // Mirrors `src/locales/zh.json :: nav.*`. Keep in sync when nav
    // entries gain or rename in either side.
    match key {
        "home" => "首页",
        "chat" => "对话",
        "compare" => "多模型对比",
        "skills" => "技能",
        "trajectory" => "轨迹",
        "analytics" => "用量",
        "logs" => "日志",
        "terminal" => "终端",
        "scheduler" => "定时任务",
        "channels" => "平台通道",
        "models" => "大模型",
        "profiles" => "配置集",
        "runbooks" => "运行手册",
        "budgets" => "预算",
        _ => key,
    }
}

/// Menu-item IDs we dispatch back to the frontend. Keep in sync with
/// the `MENU_ACTIONS` union in `src/app/useMenuEvents.ts`.
pub const ACTION_NEW_CHAT: &str = "new-chat";
pub const ACTION_TOGGLE_THEME: &str = "toggle-theme";
pub const ACTION_HELP_DOCS: &str = "help:docs";
pub const ACTION_HELP_ISSUES: &str = "help:issues";
/// Prefix for "Go to <route>" nav items. Full id is `nav:<path>`.
pub const ACTION_NAV_PREFIX: &str = "nav:";

pub fn build<R: Runtime>(app: &AppHandle<R>, locale: Locale) -> tauri::Result<Menu<R>> {
    let pkg = app.package_info();
    // `pkg.name` for us is literally "Corey" via `productName` in
    // tauri.conf.json — good enough as the app-menu title on macOS
    // (where the first submenu's title IS the app name by AppKit
    // convention).
    let app_name = pkg.name.clone();
    let l = Labels::for_locale(locale);

    // ── App menu (macOS shows this as "Corey" in the menubar) ──
    let about_label = l.about(&app_name);
    let about = PredefinedMenuItem::about(
        app,
        Some(&about_label),
        Some(
            AboutMetadataBuilder::new()
                .name(Some(app_name.clone()))
                .version(Some(pkg.version.to_string()))
                .copyright(Some::<String>("Corey Contributors".into()))
                .build(),
        ),
    )?;
    let hide_label = l.hide(&app_name);
    let quit_label = l.quit(&app_name);
    let app_menu = SubmenuBuilder::new(app, &app_name)
        .item(&about)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some(&hide_label))?)
        .item(&PredefinedMenuItem::hide_others(app, Some(l.hide_others))?)
        .item(&PredefinedMenuItem::show_all(app, Some(l.show_all))?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some(&quit_label))?)
        .build()?;

    // ── File ──
    let new_chat = MenuItemBuilder::with_id(ACTION_NEW_CHAT, l.new_chat)
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let file_menu = SubmenuBuilder::new(app, l.file)
        .item(&new_chat)
        .separator()
        .item(&PredefinedMenuItem::close_window(
            app,
            Some(l.close_window),
        )?)
        .build()?;

    // ── Edit ──
    // These are `PredefinedMenuItem`s so the OS wires them into the
    // focused input element's undo stack / clipboard for free. We pass
    // explicit labels because Tauri bundles don't ship with macOS
    // localization resources (`.lproj/` folders), so AppKit's usual
    // auto-localization of "Undo"/"Cut"/… into the system language
    // never fires — the app appears English-only to AppKit's locale
    // resolver, and every predefined label stays in English. Giving
    // our own translated labels is the path of least resistance.
    //
    // The system-injected items (AutoFill, Start Dictation, Emoji &
    // Symbols) sit *below* our items and we can't label them — they're
    // added by AppKit's Services infrastructure. Localizing those
    // would require full bundle localization.
    let edit_menu = SubmenuBuilder::new(app, l.edit)
        .item(&PredefinedMenuItem::undo(app, Some(l.undo))?)
        .item(&PredefinedMenuItem::redo(app, Some(l.redo))?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, Some(l.cut))?)
        .item(&PredefinedMenuItem::copy(app, Some(l.copy))?)
        .item(&PredefinedMenuItem::paste(app, Some(l.paste))?)
        .item(&PredefinedMenuItem::select_all(app, Some(l.select_all))?)
        .build()?;

    // ── View ──
    let mut view_builder = SubmenuBuilder::new(app, l.view);
    for item in NAV_MENU {
        let id = format!("{ACTION_NAV_PREFIX}{}", item.path);
        let go_label = l.go_to((l.nav)(item.key));
        let mut b = MenuItemBuilder::with_id(&id, &go_label);
        if let Some(a) = item.accel {
            b = b.accelerator(a);
        }
        view_builder = view_builder.item(&b.build(app)?);
    }
    let toggle_theme = MenuItemBuilder::with_id(ACTION_TOGGLE_THEME, l.toggle_theme)
        .accelerator("CmdOrCtrl+Shift+L")
        .build(app)?;
    let view_menu = view_builder
        .separator()
        .item(&toggle_theme)
        .item(&PredefinedMenuItem::fullscreen(app, Some(l.fullscreen))?)
        .build()?;

    // ── Window ──
    let window_menu = SubmenuBuilder::new(app, l.window)
        .item(&PredefinedMenuItem::minimize(app, Some(l.minimize))?)
        .item(&PredefinedMenuItem::maximize(app, Some(l.maximize))?)
        .build()?;

    // ── Help ──
    let docs = MenuItemBuilder::with_id(ACTION_HELP_DOCS, l.help_docs).build(app)?;
    let issues = MenuItemBuilder::with_id(ACTION_HELP_ISSUES, l.help_issues).build(app)?;
    let help_menu = SubmenuBuilder::new(app, l.help)
        .item(&docs)
        .item(&issues)
        .build()?;

    MenuBuilder::new(app)
        .items(&[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ])
        .build()
}

/// Swap the live menu for one built in a new locale. Called from IPC
/// when the user changes the Settings language selector.
pub fn set_locale<R: Runtime>(app: &AppHandle<R>, locale: Locale) -> tauri::Result<()> {
    let menu = build(app, locale)?;
    app.set_menu(menu)?;
    Ok(())
}

/// Install the event handler that fans custom menu clicks out to the
/// frontend as a unified `menu-action` Tauri event. Predefined items
/// (cut/copy/paste/minimize/…) never reach this handler — they're
/// intercepted by the OS.
pub fn install_handler<R: Runtime>(app: &AppHandle<R>) {
    app.on_menu_event(|app, event| {
        let id = event.id().as_ref().to_string();
        // Skip anything that couldn't be one of OUR ids. Predefined items
        // don't surface here, but guard against future items we forgot
        // to wire — better to ignore silently than crash the UI.
        if !is_app_action(&id) {
            return;
        }
        if let Err(e) = app.emit("menu-action", id) {
            tracing::warn!(error = %e, "failed to emit menu-action");
        }
    });
}

fn is_app_action(id: &str) -> bool {
    id.starts_with(ACTION_NAV_PREFIX)
        || id == ACTION_NEW_CHAT
        || id == ACTION_TOGGLE_THEME
        || id == ACTION_HELP_DOCS
        || id == ACTION_HELP_ISSUES
}
