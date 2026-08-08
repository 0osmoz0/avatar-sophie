//! Commandes de fenetre exposees au frontend.

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

pub const PET_WINDOW_LABEL: &str = "pet";

/// Zone utile de l'ecran, en points logiques, origine en haut a gauche.
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

/// Bascule la transparence aux clics. Le compagnon laisse passer les clics par
/// defaut ; le frontend repasse a `false` des que le pointeur touche un pixel
/// opaque du personnage.
#[tauri::command]
pub fn set_click_through<R: Runtime>(app: AppHandle<R>, ignore: bool) -> Result<(), String> {
    pet_window(&app)?
        .set_ignore_cursor_events(ignore)
        .map_err(|e| e.to_string())
}

/// Zone utile de l'ecran principal, barre de menus et Dock exclus.
#[tauri::command]
pub fn work_area<R: Runtime>(app: AppHandle<R>) -> Result<WorkArea, String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(area) = crate::macos::main_work_area() {
            return Ok(WorkArea {
                x: area.x,
                y: area.y,
                width: area.width,
                height: area.height,
                scale_factor: area.scale_factor,
            });
        }
    }

    // Repli generique : la totalite du moniteur courant.
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

/// Etend la fenetre a toute la zone utile de l'ecran et l'affiche. L'overlay
/// plein ecran evite de deplacer la fenetre a chaque image, ce qui produirait un
/// mouvement saccade sur macOS.
#[tauri::command]
pub fn fit_to_work_area<R: Runtime>(app: AppHandle<R>) -> Result<WorkArea, String> {
    let area = work_area(app.clone())?;
    let window = pet_window(&app)?;

    window
        .set_size(tauri::LogicalSize::new(area.width, area.height))
        .map_err(|e| e.to_string())?;
    window
        .set_position(tauri::LogicalPosition::new(area.x, area.y))
        .map_err(|e| e.to_string())?;

    Ok(area)
}

/// Signale que le frontend a fini de charger ses assets et que la fenetre peut
/// apparaitre. Evite le flash d'une fenetre vide au demarrage.
#[tauri::command]
pub fn reveal<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let window = pet_window(&app)?;

    // Re-applique le niveau / multi-Spaces apres le show : macOS peut les
    // reinitialiser au premier affichage.
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
