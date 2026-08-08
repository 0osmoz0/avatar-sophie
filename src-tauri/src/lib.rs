mod cursor;
mod desktop;
#[cfg(target_os = "macos")]
mod macos;
mod tray;
mod window;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            cursor::cursor_position,
            cursor::set_cursor_tracking,
            window::set_click_through,
            window::work_area,
            window::fit_to_work_area,
            window::reveal,
            desktop::list_monitors,
            desktop::desktop_union,
            desktop::list_windows,
            desktop::accessibility_status,
            desktop::open_accessibility_settings,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            #[cfg(target_os = "macos")]
            {
                macos::set_accessory_policy(&handle);
                macos::prevent_app_nap();
            }

            if let Some(pet) = app.get_webview_window(window::PET_WINDOW_LABEL) {
                let _ = pet.set_always_on_top(true);
                #[cfg(target_os = "macos")]
                macos::configure_pet_window(&pet, false);

                let _ = pet.set_ignore_cursor_events(true);

                let pet_for_events = pet.clone();
                pet.on_window_event(move |event| {
                    if matches!(
                        event,
                        tauri::WindowEvent::Focused(_)
                            | tauri::WindowEvent::Moved(_)
                            | tauri::WindowEvent::Resized(_)
                    ) {
                        let _ = pet_for_events.set_always_on_top(true);
                        #[cfg(target_os = "macos")]
                        macos::configure_pet_window(&pet_for_events, false);
                    }
                });

                // Tauri / le gestionnaire d'espaces redescendent parfois le
                // niveau : on le reapplique periodiquement.
                #[cfg(target_os = "macos")]
                {
                    let pet_tick = pet.clone();
                    std::thread::spawn(move || {
                        loop {
                            std::thread::sleep(std::time::Duration::from_secs(2));
                            let window = pet_tick.clone();
                            let handle = window.app_handle().clone();
                            let _ = handle.run_on_main_thread(move || {
                                // Winit/Tauri decale parfois la fenetre hors ecran :
                                // on recadre + reapplique le niveau.
                                let _ = macos::fit_overlay_to_screens(&window);
                                macos::configure_pet_window(&window, false);
                            });
                        }
                    });
                }
            }

            app.manage(cursor::spawn_tracker(handle));
            tray::install_tray(app.handle())?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Sophie");
}
