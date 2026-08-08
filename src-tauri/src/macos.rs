//! Shim AppKit.
//!
//! Tauri sait creer une fenetre transparente sans bordure, mais il n'expose ni
//! le niveau de fenetre, ni le `collectionBehavior` qui conditionne le
//! comportement multi-Spaces et le passage au-dessus des applications en plein
//! ecran. Ces trois reglages sont ce qui separe une fenetre flottante ordinaire
//! d'un vrai compagnon de bureau.

#![cfg(target_os = "macos")]

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_app_kit::{NSColor, NSScreen, NSWindow, NSWindowCollectionBehavior};
use objc2_foundation::{
    MainThreadMarker, NSActivityOptions, NSProcessInfo, NSString, NSRect,
};
use serde::Serialize;
use tauri::{ActivationPolicy, AppHandle, Runtime, WebviewWindow};

/// `NSStatusWindowLevel` (25). Au-dessus des apps normales ; le niveau
/// screen-saver (1000) sort parfois la fenetre de la composition bureau.
/// `set_always_on_top` de Tauri redescend a Floating (3) : on reapplique apres.
const PET_WINDOW_LEVEL: isize = 25;

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
/// Sophie doit rester au-dessus de Safari, Cursor, Finder, et des apps en
/// plein ecran (Discord) — pas seulement dans une page web.
pub fn configure_pet_window<R: Runtime>(window: &WebviewWindow<R>, _above_menu_bar: bool) {
    let Some(ns_window) = ns_window(window) else {
        return;
    };

    // Le CSS ne peut pas atteindre le NSWindow : sans ce fond transparent
    // explicite, il reste un rectangle opaque derriere le WKWebView.
    ns_window.setOpaque(false);
    ns_window.setBackgroundColor(Some(&NSColor::clearColor()));
    ns_window.setHasShadow(false);

    // CanJoinAllSpaces : suit l'utilisateur sur chaque bureau virtuel.
    // FullScreenAuxiliary : reste visible par-dessus une app en plein ecran.
    // IgnoresCycle : n'apparait pas dans Cmd+Tab.
    // Pas de Stationary : il clouait Sophie sur le Space initial (invisible
    // dans Discord / un autre bureau).
    ns_window.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::IgnoresCycle,
    );

    // Sans cela, un glissement sur une zone vide deplacerait la fenetre entiere
    // au lieu de laisser le compagnon gerer son propre deplacement.
    ns_window.setMovableByWindowBackground(false);

    // Empeche la fenetre de se faire renvoyer derriere quand une autre app
    // prend le focus.
    ns_window.setHidesOnDeactivate(false);

    // always_on_top doit passer *avant* setLevel : Tauri force Floating (3).
    let _ = window.set_always_on_top(true);
    ns_window.setLevel(PET_WINDOW_LEVEL);

    clear_webview_background(window);
}

fn clear_webview_background<R: Runtime>(window: &WebviewWindow<R>) {
    // WKWebView dessine un fond blanc par defaut meme si le NSWindow est clear.
    // KVC exige un NSNumber pour les BOOL (Bool::NO est traite comme nil → crash).
    let _ = window.with_webview(|webview| {
        unsafe {
            let view = webview.inner() as *mut AnyObject;
            if view.is_null() {
                return;
            }
            let key = NSString::from_str("drawsBackground");
            let value = objc2_foundation::NSNumber::numberWithBool(false);
            let _: () = objc2::msg_send![view, setValue: &*value, forKey: &*key];
        }
    });
}

/// Empeche App Nap d'endormir la boucle JS (sinon Sophie disparait apres idle).
pub fn prevent_app_nap() {
    use std::sync::atomic::{AtomicBool, Ordering};
    static STARTED: AtomicBool = AtomicBool::new(false);
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let info = NSProcessInfo::processInfo();
    let reason = NSString::from_str("Sophie desktop companion");
    let activity = info.beginActivityWithOptions_reason(
        NSActivityOptions::UserInitiatedAllowingIdleSystemSleep,
        &reason,
    );
    // Doit vivre toute la duree du process.
    std::mem::forget(activity);
}

/// Retire l'icone du Dock et empeche l'application de prendre le focus.
pub fn set_accessory_policy<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.set_activation_policy(ActivationPolicy::Accessory);
}

/// Etend l'overlay a l'union des ecrans via AppKit (pas Tauri set_position).
///
/// Les coords Tauri/winit se decalent parfois hors ecran (ex. X=-3487) sur macOS
/// avec fenetre transparente ; `NSWindow.setFrame` reste fiable.
pub fn fit_overlay_to_screens<R: Runtime>(window: &WebviewWindow<R>) -> Option<WorkArea> {
    let mtm = MainThreadMarker::new()?;
    let ns_window = ns_window(window)?;
    let screens = NSScreen::screens(mtm);
    if screens.is_empty() {
        return None;
    }

    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    let mut scale = 2.0;
    if let Some(main) = NSScreen::mainScreen(mtm) {
        scale = main.backingScaleFactor();
    }

    for screen in screens.iter() {
        let f = screen.frame();
        min_x = min_x.min(f.origin.x);
        min_y = min_y.min(f.origin.y);
        max_x = max_x.max(f.origin.x + f.size.width);
        max_y = max_y.max(f.origin.y + f.size.height);
    }

    let width = max_x - min_x;
    let height = max_y - min_y;
    let frame = NSRect {
        origin: objc2_foundation::NSPoint {
            x: min_x,
            y: min_y,
        },
        size: objc2_foundation::NSSize { width, height },
    };
    ns_window.setFrame_display(frame, true);

    // Coordonnees canvas : origine haut-gauche de l'union (y=0 au sommet).
    Some(WorkArea {
        x: min_x,
        y: 0.0,
        width,
        height,
        scale_factor: scale,
    })
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
