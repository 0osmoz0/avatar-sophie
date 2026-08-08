//! Shim AppKit.
//!
//! Tauri sait creer une fenetre transparente sans bordure, mais il n'expose ni
//! le niveau de fenetre, ni le `collectionBehavior` qui conditionne le
//! comportement multi-Spaces et le passage au-dessus des applications en plein
//! ecran. Ces trois reglages sont ce qui separe une fenetre flottante ordinaire
//! d'un vrai compagnon de bureau.

#![cfg(target_os = "macos")]

use objc2::rc::Retained;
use objc2_app_kit::{NSColor, NSScreen, NSWindow, NSWindowCollectionBehavior};
use objc2_foundation::MainThreadMarker;
use serde::Serialize;
use tauri::{ActivationPolicy, AppHandle, Runtime, WebviewWindow};

/// Niveau `NSFloatingWindowLevel`. Assez haut pour surnager au-dessus des
/// fenetres ordinaires, assez bas pour ne pas masquer la barre de menus.
const FLOATING_WINDOW_LEVEL: isize = 3;

/// Niveau `NSStatusWindowLevel`, utilise quand on veut passer aussi au-dessus
/// de la barre de menus.
const STATUS_WINDOW_LEVEL: isize = 25;

/// Zone utile d'un ecran, en points logiques, origine en haut a gauche.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct WorkArea {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(rename = "scaleFactor")]
    pub scale_factor: f64,
}

fn ns_window<R: Runtime>(window: &WebviewWindow<R>) -> Option<Retained<NSWindow>> {
    let ptr = window.ns_window().ok()? as *mut NSWindow;
    if ptr.is_null() {
        return None;
    }
    // Le pointeur appartient a la fenetre Tauri ; on emprunte sans transferer
    // la propriete, d'ou le `retain` explicite.
    unsafe { Retained::retain(ptr) }
}

/// Applique la configuration complete de fenetre compagnon.
///
/// Par defaut on utilise le niveau status : Sophie reste au-dessus de Safari,
/// Cursor, Finder, etc. — pas seulement dans une page web.
pub fn configure_pet_window<R: Runtime>(window: &WebviewWindow<R>, above_menu_bar: bool) {
    let Some(ns_window) = ns_window(window) else {
        return;
    };

    // Le CSS ne peut pas atteindre le NSWindow : sans ce fond transparent
    // explicite, il reste un rectangle opaque derriere le WKWebView.
    ns_window.setOpaque(false);
    ns_window.setBackgroundColor(Some(&NSColor::clearColor()));
    ns_window.setHasShadow(false);

    // Status (25) > Floating (3) : necessaire pour rester visible devant les
    // fenetres ordinaires de toutes les applications.
    ns_window.setLevel(if above_menu_bar {
        STATUS_WINDOW_LEVEL
    } else {
        STATUS_WINDOW_LEVEL.max(FLOATING_WINDOW_LEVEL)
    });

    // CanJoinAllSpaces : suit l'utilisateur sur chaque bureau virtuel.
    // Stationary : ne part pas en vol plane pendant Mission Control.
    // FullScreenAuxiliary : reste visible par-dessus une app en plein ecran.
    // IgnoresCycle : n'apparait pas dans Cmd+Tab.
    ns_window.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::IgnoresCycle,
    );

    // Sans cela, un glissement sur une zone vide deplacerait la fenetre entiere
    // au lieu de laisser le compagnon gerer son propre deplacement.
    ns_window.setMovableByWindowBackground(false);

    // Empeche la fenetre de se faire renvoyer derriere quand une autre app
    // prend le focus.
    ns_window.setHidesOnDeactivate(false);
    let _ = window.set_always_on_top(true);
}

/// Retire l'icone du Dock et empeche l'application de prendre le focus.
pub fn set_accessory_policy<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.set_activation_policy(ActivationPolicy::Accessory);
}

/// Zone utile de l'ecran principal, barre de menus et Dock exclus, convertie en
/// coordonnees a origine haut-gauche pour coller a celles du navigateur.
pub fn main_work_area() -> Option<WorkArea> {
    let mtm = MainThreadMarker::new()?;
    let screen = NSScreen::mainScreen(mtm)?;

    let full = screen.frame();
    let visible = screen.visibleFrame();
    let scale = screen.backingScaleFactor();

    Some(WorkArea {
        x: visible.origin.x,
        // AppKit a son origine en bas a gauche ; le canvas l'a en haut a gauche.
        y: full.size.height - (visible.origin.y + visible.size.height),
        width: visible.size.width,
        height: visible.size.height,
        scale_factor: scale,
    })
}
