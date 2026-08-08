//! Menu barre de menus (tray) pour controler Sophie sans Dock.

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime,
};

use crate::window;

pub const TRAY_ACTION_EVENT: &str = "tray:action";

pub fn install_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Afficher Sophie", true, None::<&str>)?;
    let dance = MenuItem::with_id(app, "dance", "Danser", true, None::<&str>)?;
    let sleep = MenuItem::with_id(app, "sleep", "Dormir", true, None::<&str>)?;
    let coffee = MenuItem::with_id(app, "coffee", "Café", true, None::<&str>)?;
    let hang = MenuItem::with_id(app, "hang", "S'accrocher", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show, &dance, &sleep, &coffee, &hang, &quit])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .expect("icone manquante");

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("Sophie")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "show" => {
                if let Some(win) = app.get_webview_window(window::PET_WINDOW_LABEL) {
                    let _ = win.show();
                }
            }
            other => {
                let _ = app.emit(TRAY_ACTION_EVENT, other.to_string());
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(win) = app.get_webview_window(window::PET_WINDOW_LABEL) {
                    let _ = win.show();
                }
            }
        })
        .build(app)?;

    Ok(())
}
