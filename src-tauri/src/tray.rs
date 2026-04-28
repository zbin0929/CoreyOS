use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
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
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "tray_quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)
        .expect("tray icon");
}
