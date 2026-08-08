//! Commandes de fenetre exposees au frontend.

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

pub const PET_WINDOW_LABEL: &str = "pet";

/// Zone couverte par l'overlay, en points logiques, origine haut-gauche bureau.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct WorkArea {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(rename = "scaleFactor")]
    pub scale_factor: f64,
}

fn pet_window<R: Runtime>(app: &AppHandle<R>) -> Result<WebviewWindow<R>, String> {
    app.get_webview_window(PET_WINDOW_LABEL)
        .ok_or_else(|| format!("fenetre `{PET_WINDOW_LABEL}` introuvable"))
}

#[tauri::command]
pub fn set_click_through<R: Runtime>(app: AppHandle<R>, ignore: bool) -> Result<(), String> {
    pet_window(&app)?
        .set_ignore_cursor_events(ignore)
        .map_err(|e| e.to_string())
}

/// Zone utile de l'ecran principal (compat).
#[tauri::command]
pub fn work_area<R: Runtime>(app: AppHandle<R>) -> Result<WorkArea, String> {
    let _ = &app;
    #[cfg(target_os = "macos")]
    {
        let union = crate::desktop::desktop_union();
        return Ok(WorkArea {
            x: union.x,
            y: union.y,
            width: union.width,
            height: union.height,
            scale_factor: union.scale_factor,
        });
    }

    #[cfg(not(target_os = "macos"))]
    {
        let window = pet_window(&app)?;
        let monitor = window
            .current_monitor()
            .map_err(|e| e.to_string())?
            .ok_or("aucun moniteur detecte")?;
        let scale = monitor.scale_factor();
        let size = monitor.size().to_logical::<f64>(scale);
        let position = monitor.position().to_logical::<f64>(scale);
        Ok(WorkArea {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
            scale_factor: scale,
        })
    }
}

/// Etend l'overlay a l'union de tous les ecrans.
#[tauri::command]
pub fn fit_to_work_area<R: Runtime>(app: AppHandle<R>) -> Result<WorkArea, String> {
    let window = pet_window(&app)?;

    #[cfg(target_os = "macos")]
    {
        // Ne pas faire de rendez-vous synchrone via run_on_main_thread ici :
        // la commande tourne deja souvent sur le main thread → deadlock.
        let area = crate::macos::fit_overlay_to_screens(&window)
            .ok_or_else(|| "impossible de cadrer l'overlay sur les ecrans".to_string())?;
        crate::macos::configure_pet_window(&window, false);
        return Ok(WorkArea {
            x: area.x,
            y: area.y,
            width: area.width,
            height: area.height,
            scale_factor: area.scale_factor,
        });
    }

    #[cfg(not(target_os = "macos"))]
    {
        let area = work_area(app.clone())?;
        window
            .set_size(tauri::LogicalSize::new(area.width, area.height))
            .map_err(|e| e.to_string())?;
        window
            .set_position(tauri::LogicalPosition::new(area.x, area.y))
            .map_err(|e| e.to_string())?;
        Ok(area)
    }
}

#[tauri::command]
pub fn reveal<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let window = pet_window(&app)?;

    #[cfg(target_os = "macos")]
    crate::macos::configure_pet_window(&window, false);

    window
        .set_always_on_top(true)
        .map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    crate::macos::configure_pet_window(&window, false);

    Ok(())
}
