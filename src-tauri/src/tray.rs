use std::sync::atomic::{AtomicI64, Ordering};

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Listener, Manager,
};

/// Stable id we look up the tray icon by from `app.tray_by_id()`.
/// Hard-coded so any background task (workflow watcher, scheduler) can
/// find our tray without threading a handle through APIs.
const TRAY_ID: &str = "corey-main";

/// In-flight workflow run counter. Bumped on `workflow:run-started`,
/// decremented on `workflow:run-finished`. Read by `apply_count` to
/// derive the tray title / tooltip / red-dot indicator.
///
/// **Why an atomic and not a Mutex<HashSet<run_id>>**: we don't need
/// the per-run identity here, only the cardinality. If a stray
/// finished event fires for a run we never saw started (e.g. test
/// harness, race during app boot) the saturating_sub(1) keeps us at
/// zero — nothing surprising, just a missed increment.
///
/// Using `i64` instead of `u32` so the saturating-decrement branch is
/// trivial; we never go above `i32::MAX` runs in practice anyway.
static ACTIVE_RUNS: AtomicI64 = AtomicI64::new(0);

pub fn build(app: &App) {
    let show = MenuItemBuilder::with_id("tray_show", "Show Corey")
        .build(app)
        .expect("tray show item");
    let quit = MenuItemBuilder::with_id("tray_quit", "Quit Corey")
        .build(app)
        .expect("tray quit item");
    let menu = MenuBuilder::new(app)
        .item(&show)
        .separator()
        .item(&quit)
        .build()
        .expect("tray menu");

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(app.default_window_icon().cloned().expect("default icon"))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Corey")
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "tray_show" => {
                tracing::info!("tray menu: show clicked");
                show_window(app);
            }
            "tray_quit" => {
                tracing::info!("tray menu: quit clicked");
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(move |tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_window(tray.app_handle());
            }
        })
        .build(app)
        .expect("tray icon");

    // Subscribe to workflow lifecycle events so the tray reflects how
    // many runs are in flight without polling. Both listeners apply
    // the same delta logic (+1 / -1) and re-render via apply_count.
    let h_started = app.handle().clone();
    app.listen("workflow:run-started", move |_event| {
        ACTIVE_RUNS.fetch_add(1, Ordering::Relaxed);
        apply_count(&h_started);
    });
    let h_finished = app.handle().clone();
    app.listen("workflow:run-finished", move |_event| {
        // Saturating decrement: a finished event with no matching
        // start is treated as a no-op (see ACTIVE_RUNS docstring).
        let cur = ACTIVE_RUNS.load(Ordering::Relaxed);
        if cur > 0 {
            ACTIVE_RUNS.fetch_sub(1, Ordering::Relaxed);
        }
        apply_count(&h_finished);
    });
}

/// Reflect the current `ACTIVE_RUNS` count on the tray icon.
///
/// - **Tooltip** (all platforms): always set, e.g. "Corey · 运行中 3".
/// - **Title** (macOS only — `set_title` is a no-op on Win/Linux):
///   shows `●N` so the menubar shows a running count. The bullet is
///   the simplest "red dot" we can emit through the title API
///   without shipping a custom badge icon — fits the menubar font
///   metrics on every macOS release we support.
///
/// Errors are logged at debug level and dropped: a transient tray
/// failure should not stop a workflow from finishing.
fn apply_count(app: &AppHandle) {
    let n = ACTIVE_RUNS.load(Ordering::Relaxed);
    let tray = match app.tray_by_id(TRAY_ID) {
        Some(t) => t,
        None => {
            tracing::debug!("tray {TRAY_ID} not registered yet, skipping update");
            return;
        }
    };
    let tooltip = if n > 0 {
        format!("Corey · 运行中 {n}")
    } else {
        "Corey".to_string()
    };
    if let Err(e) = tray.set_tooltip(Some(tooltip)) {
        tracing::debug!(error = %e, "tray set_tooltip failed");
    }
    let title: Option<String> = if n > 0 { Some(format!("●{n}")) } else { None };
    if let Err(e) = tray.set_title(title) {
        tracing::debug!(error = %e, "tray set_title failed");
    }
}

pub fn show_window(app: &AppHandle) {
    let Some(w) = app.get_webview_window("main") else {
        tracing::warn!("show_window: main window not found");
        return;
    };
    tracing::info!("show_window: restoring main window");
    let _ = w.show();
    let _ = w.unminimize();
    let _ = w.set_focus();
}
