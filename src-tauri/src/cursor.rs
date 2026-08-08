//! Suivi du vrai curseur systeme.
//!
//! Aucun curseur factice n'est cree : `AppHandle::cursor_position` interroge le
//! serveur de fenetres et renvoie la position du pointeur reel, meme lorsqu'il
//! se trouve au-dessus d'une autre application. Cette API ne demande aucune
//! autorisation d'accessibilite.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Evenement pousse vers le frontend.
pub const CURSOR_MOVE_EVENT: &str = "cursor:move";

/// Cadence d'echantillonnage. 60 Hz suffit : le frontend lisse entre deux
/// mesures, inutile de saturer l'IPC davantage.
const POLL_INTERVAL: Duration = Duration::from_millis(16);

/// En dessous de ce deplacement en pixels physiques, on considere que le
/// curseur n'a pas bouge et on n'emet rien.
const MOVE_EPSILON: f64 = 1.0;

#[derive(Debug, Clone, Copy, Serialize)]
pub struct CursorPosition {
    /// Position physique par rapport au coin superieur gauche du bureau.
    pub x: f64,
    pub y: f64,
}

impl CursorPosition {
    fn nearly_equals(self, other: Self) -> bool {
        (self.x - other.x).abs() < MOVE_EPSILON && (self.y - other.y).abs() < MOVE_EPSILON
    }
}

/// Etat partage du suivi, conserve par l'application pour pouvoir suspendre la
/// boucle quand le compagnon est masque.
pub struct CursorTracker {
    paused: Arc<AtomicBool>,
}

impl CursorTracker {
    pub fn set_paused(&self, paused: bool) {
        self.paused.store(paused, Ordering::Relaxed);
    }
}

/// Suspend ou reprend le suivi. Utile quand le compagnon est masque : inutile
/// de reveiller le thread principal soixante fois par seconde pour rien.
#[tauri::command]
pub fn set_cursor_tracking<R: Runtime>(app: AppHandle<R>, enabled: bool) {
    if let Some(tracker) = app.try_state::<CursorTracker>() {
        tracker.set_paused(!enabled);
    }
}

/// Position instantanee du curseur, pour les appels ponctuels.
#[tauri::command]
pub fn cursor_position<R: Runtime>(app: AppHandle<R>) -> Result<CursorPosition, String> {
    app.cursor_position()
        .map(|p| CursorPosition { x: p.x, y: p.y })
        .map_err(|e| e.to_string())
}

/// Demarre la boucle de suivi.
pub fn spawn_tracker<R: Runtime>(app: AppHandle<R>) -> CursorTracker {
    let paused = Arc::new(AtomicBool::new(false));
    let paused_for_thread = paused.clone();
    let last: Arc<Mutex<Option<CursorPosition>>> = Arc::new(Mutex::new(None));

    thread::spawn(move || loop {
        thread::sleep(POLL_INTERVAL);

        if paused_for_thread.load(Ordering::Relaxed) {
            continue;
        }

        let app_for_tick = app.clone();
        let last_for_tick = last.clone();

        // AppKit exige le thread principal pour interroger le pointeur ; on y
        // fait un aller-retour plutot que de risquer un acces concurrent au
        // serveur de fenetres.
        let dispatched = app.run_on_main_thread(move || {
            let Ok(raw) = app_for_tick.cursor_position() else {
                return;
            };
            let current = CursorPosition { x: raw.x, y: raw.y };

            let Ok(mut previous) = last_for_tick.lock() else {
                return;
            };
            if previous.is_some_and(|p| p.nearly_equals(current)) {
                return;
            }
            *previous = Some(current);
            drop(previous);

            let _ = app_for_tick.emit(CURSOR_MOVE_EVENT, current);
        });

        // La boucle d'evenements est fermee : l'application se termine.
        if dispatched.is_err() {
            break;
        }
    });

    CursorTracker { paused }
}
