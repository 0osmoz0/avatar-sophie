mod cursor;
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
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            #[cfg(target_os = "macos")]
            macos::set_accessory_policy(&handle);

            if let Some(pet) = app.get_webview_window(window::PET_WINDOW_LABEL) {
                let _ = pet.set_always_on_top(true);
                #[cfg(target_os = "macos")]
                macos::configure_pet_window(&pet, false);

                // Le compagnon est transparent aux clics tant que le frontend
                // n'a pas detecte le pointeur sur un pixel opaque.
                let _ = pet.set_ignore_cursor_events(true);

                // Si une autre app prend le focus, on reforce le niveau pour
                // qu'elle reste devant toutes les fenetres.
                let pet_for_events = pet.clone();
                pet.on_window_event(move |event| {
                    if matches!(
                        event,
                        tauri::WindowEvent::Focused(_) | tauri::WindowEvent::Moved(_)
                    ) {
                        let _ = pet_for_events.set_always_on_top(true);
                        #[cfg(target_os = "macos")]
                        macos::configure_pet_window(&pet_for_events, false);
                    }
                });
            }

            app.manage(cursor::spawn_tracker(handle));
            tray::install_tray(app.handle())?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Sophie");
}
