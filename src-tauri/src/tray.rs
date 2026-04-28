use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder},
    App, Manager,
};

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

    TrayIconBuilder::new()
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
        .on_tray_icon_event(|tray, event| {
            tracing::info!(?event, "tray icon event");
            if let tauri::tray::TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                show_window(app);
            }
        })
        .build(app)
        .expect("tray icon");
}

fn show_window(app: &impl Manager<tauri::Wry>) {
    let Some(w) = app.get_webview_window("main") else {
        tracing::warn!("show_window: main window not found");
        return;
    };
    tracing::info!("show_window: restoring main window");
    let _ = w.show();
    let _ = w.unminimize();
    let _ = w.set_focus();
    let _ = w.center();
}
