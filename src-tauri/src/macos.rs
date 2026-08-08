//! Shim AppKit.
//!
//! Tauri sait creer une fenetre transparente sans bordure, mais il n'expose ni
//! le niveau de fenetre, ni le `collectionBehavior` qui conditionne le
//! comportement multi-Spaces et le passage au-dessus des applications en plein
//! ecran. Ces trois reglages sont ce qui separe une fenetre flottante ordinaire
//! d'un vrai compagnon de bureau.
//!
//! ## Maximise vs vrai plein ecran
//!
//! - **Maximisee (zoom)** : meme Space que le bureau. Un niveau status +
//!   `always_on_top` suffit pour surnager au-dessus de Cursor, Safari, etc.
//! - **Plein ecran systeme** (bouton vert, Discord FS…) : Space separe. Le
//!   WindowServer n'honore `FullScreenAuxiliary` de facon fiable que pour un
//!   **NSPanel** non-activating — d'ou la conversion `TaoWindow` →
//!   `SophiePetPanel` (voir `ensure_pet_panel`). Bitmask :
//!   `CanJoinAllSpaces | FullScreenAuxiliary | IgnoresCycle`. Pas de
//!   `Stationary` / `MoveToActiveSpace`.
//! - **Plein ecran exclusif** (certains jeux / shielding) : limitation OS —
//!   aucune API publique fiable pour forcer un overlay auxiliaire.
//!
//! ## Diagnostic FS (temporaire)
//!
//! Les snapshots sont ecrits dans
//! `~/Library/Logs/Sophie/overlay-diag.log` et sur stderr.

#![cfg(target_os = "macos")]

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{
    AnyClass, AnyObject, Bool, ClassBuilder, NSObject, NSObjectProtocol, ProtocolObject, Sel,
};
use objc2::{sel, ClassType};
use objc2_app_kit::{
    NSApplicationDidChangeScreenParametersNotification, NSColor, NSPanel, NSScreen, NSWindow,
    NSWindowCollectionBehavior, NSWindowStyleMask, NSWorkspace,
    NSWorkspaceActiveSpaceDidChangeNotification,
};
use objc2_foundation::{
    MainThreadMarker, NSActivityOptions, NSNotification, NSNotificationCenter, NSNumber,
    NSOperationQueue, NSPoint, NSProcessInfo, NSRect, NSSize, NSString,
};
use serde::Serialize;
use std::ffi::CStr;
use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::ptr::NonNull;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{ActivationPolicy, AppHandle, Runtime, WebviewWindow};

/// `NSStatusWindowLevel` (25). Au-dessus des apps normales / maximisees.
/// Le niveau screen-saver (1000) sort parfois la fenetre de la composition.
/// `set_always_on_top` de Tauri redescend a Floating (3) : on reapplique apres.
const PET_WINDOW_LEVEL: isize = 25;

/// Tolerance (points) avant de considerer que winit a derive le frame hors ecran.
const FRAME_DRIFT_TOLERANCE: f64 = 2.0;

const BEHAVIOR_CAN_JOIN_ALL_SPACES: usize = 1 << 0;
const BEHAVIOR_MOVE_TO_ACTIVE_SPACE: usize = 1 << 1;
const BEHAVIOR_STATIONARY: usize = 1 << 4;
const BEHAVIOR_IGNORES_CYCLE: usize = 1 << 6;
const BEHAVIOR_FULL_SCREEN_PRIMARY: usize = 1 << 7;
const BEHAVIOR_FULL_SCREEN_AUXILIARY: usize = 1 << 8;
const STYLE_NONACTIVATING_PANEL: usize = 1 << 7; // NSWindowStyleMaskNonactivatingPanel

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

fn diag_log_path() -> PathBuf {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"));
    home.join("Library/Logs/Sophie/overlay-diag.log")
}

fn append_diag_line(line: &str) {
    let path = diag_log_path();
    if let Some(parent) = path.parent() {
        let _ = create_dir_all(parent);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{line}");
    }
    eprintln!("[sophie-overlay] {line}");
}

fn class_name(obj: &AnyObject) -> String {
    let cls: &AnyClass = obj.class();
    cls.name().to_string_lossy().into_owned()
}

/// Sous-classe NSPanel dediee : meme empreinte ivar que TaoWindow (Bool),
/// et refus explicite du role de fenetre cle / principale (pas de vol de focus).
extern "C" fn pet_can_become_key(_this: &NSObject, _cmd: Sel) -> Bool {
    Bool::NO
}

extern "C" fn pet_can_become_main(_this: &NSObject, _cmd: Sel) -> Bool {
    Bool::NO
}

fn pet_panel_class() -> &'static AnyClass {
    static CLASS: OnceLock<&'static AnyClass> = OnceLock::new();
    CLASS.get_or_init(|| {
        let name = CStr::from_bytes_with_nul(b"SophiePetPanel\0").unwrap();
        if let Some(existing) = AnyClass::get(name) {
            return existing;
        }
        let mut builder =
            ClassBuilder::new(name, NSPanel::class()).expect("allocation SophiePetPanel");
        // TaoWindow = NSWindow + ivar `focusable` : on aligne la taille d'instance.
        builder.add_ivar::<Bool>(CStr::from_bytes_with_nul(b"focusable\0").unwrap());
        unsafe {
            builder.add_method(
                sel!(canBecomeKeyWindow),
                pet_can_become_key as extern "C" fn(_, _) -> _,
            );
            builder.add_method(
                sel!(canBecomeMainWindow),
                pet_can_become_main as extern "C" fn(_, _) -> _,
            );
        }
        builder.register()
    })
}

fn is_already_pet_panel(ns_window: &NSWindow) -> bool {
    class_name(ns_window).contains("SophiePetPanel")
}

/// Convertit le `TaoWindow` Tauri en `SophiePetPanel` (NSPanel) non-activating.
///
/// Sans cette conversion, `FullScreenAuxiliary` se lit correctement dans AppKit
/// mais le WindowServer ignore le flag sur un NSWindow ordinaire — Sophie reste
/// hors des Spaces plein ecran. Aucun suivi d'app : uniquement le type de fenetre.
pub fn ensure_pet_panel<R: Runtime>(window: &WebviewWindow<R>) {
    let Some(ns_window) = ns_window(window) else {
        append_diag_line("ensure_pet_panel ERROR=ns_window_null");
        return;
    };
    if is_already_pet_panel(&ns_window) {
        return;
    }

    let old_cls_name = class_name(&*ns_window);
    let old_size = ns_window.class().instance_size();
    let panel_cls = pet_panel_class();
    let new_size = panel_cls.instance_size();

    append_diag_line(&format!(
        "ensure_pet_panel before class={old_cls_name} size={old_size} -> SophiePetPanel size={new_size}"
    ));

    if new_size > old_size {
        append_diag_line(
            "ensure_pet_panel ABORT new class larger than TaoWindow (ivar layout mismatch)",
        );
        return;
    }

    // object_setClass : meme technique que tauri-nspanel. Le WebView / contentView
    // restent attaches ; on ne recree pas la fenetre.
    let previous = unsafe { AnyObject::set_class(&*ns_window, panel_cls) };
    append_diag_line(&format!(
        "ensure_pet_panel set_class ok previous={} now={}",
        previous.name().to_string_lossy(),
        class_name(&*ns_window)
    ));

    // Borderless (0) + NonactivatingPanel : pas de focus app / pas de barre.
    ns_window.setStyleMask(NSWindowStyleMask::NonactivatingPanel);

    // API NSPanel (disponibles apres le changement de classe).
    unsafe {
        let _: () = objc2::msg_send![&*ns_window, setFloatingPanel: true];
        let _: () = objc2::msg_send![&*ns_window, setBecomesKeyOnlyIfNeeded: true];
        let _: () = objc2::msg_send![&*ns_window, setWorksWhenModal: true];
    }

    ns_window.setOpaque(false);
    ns_window.setBackgroundColor(Some(&NSColor::clearColor()));
    ns_window.setHasShadow(false);
    ns_window.setMovableByWindowBackground(false);

    log_overlay_diagnostics(window, "after_panel_convert");
}

/// Snapshot runtime du chrome natif (diagnostic temporaire plein ecran).
pub fn log_overlay_diagnostics<R: Runtime>(window: &WebviewWindow<R>, reason: &str) {
    let Some(ns_window) = ns_window(window) else {
        append_diag_line(&format!(
            "reason={reason} ERROR=ns_window_null tauri_label=pet"
        ));
        return;
    };

    let behavior = ns_window.collectionBehavior();
    let bits = behavior.0 as usize;
    let level = ns_window.level() as isize;
    let visible = ns_window.isVisible();
    let on_active_space = ns_window.isOnActiveSpace();
    let hides = ns_window.hidesOnDeactivate();
    let number = ns_window.windowNumber();
    let frame = ns_window.frame();
    let style = ns_window.styleMask().0 as usize;
    let opaque = ns_window.isOpaque();
    let cls = class_name(&*ns_window);

    let parent_cls = unsafe {
        let parent: *const AnyObject = objc2::msg_send![&*ns_window, parentWindow];
        if parent.is_null() {
            "none".to_string()
        } else {
            class_name(&*parent)
        }
    };

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let line = format!(
        "t={now} reason={reason} class={cls} parent={parent_cls} win#={number} \
         level={level} (want={PET_WINDOW_LEVEL}) visible={visible} onActiveSpace={on_active_space} \
         hidesOnDeactivate={hides} opaque={opaque} \
         styleMask=0x{style:x} nonactivatingPanel={} \
         collectionBehavior=0x{bits:x} \
         CanJoinAllSpaces={} FullScreenAuxiliary={} IgnoresCycle={} \
         Stationary={} MoveToActiveSpace={} FullScreenPrimary={} \
         frame=({:.1},{:.1},{:.1}x{:.1})",
        (style & STYLE_NONACTIVATING_PANEL) != 0,
        (bits & BEHAVIOR_CAN_JOIN_ALL_SPACES) != 0,
        (bits & BEHAVIOR_FULL_SCREEN_AUXILIARY) != 0,
        (bits & BEHAVIOR_IGNORES_CYCLE) != 0,
        (bits & BEHAVIOR_STATIONARY) != 0,
        (bits & BEHAVIOR_MOVE_TO_ACTIVE_SPACE) != 0,
        (bits & BEHAVIOR_FULL_SCREEN_PRIMARY) != 0,
        frame.origin.x,
        frame.origin.y,
        frame.size.width,
        frame.size.height,
    );
    append_diag_line(&line);
}

fn screen_union_frame(mtm: MainThreadMarker) -> Option<NSRect> {
    let screens = NSScreen::screens(mtm);
    if screens.is_empty() {
        return None;
    }

    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;

    for screen in screens.iter() {
        let f = screen.frame();
        min_x = min_x.min(f.origin.x);
        min_y = min_y.min(f.origin.y);
        max_x = max_x.max(f.origin.x + f.size.width);
        max_y = max_y.max(f.origin.y + f.size.height);
    }

    Some(NSRect {
        origin: NSPoint {
            x: min_x,
            y: min_y,
        },
        size: NSSize {
            width: max_x - min_x,
            height: max_y - min_y,
        },
    })
}

/// Level, collectionBehavior Spaces/FS, hidesOnDeactivate.
fn assert_overlay_chrome(ns_window: &NSWindow) {
    // CanJoinAllSpaces : visible sur chaque Space bureau.
    // FullScreenAuxiliary : visible en auxiliaire sur un Space plein ecran.
    // IgnoresCycle : hors Cmd+Tab.
    // Pas de Stationary / MoveToActiveSpace / FullScreenPrimary.
    ns_window.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::IgnoresCycle,
    );
    ns_window.setHidesOnDeactivate(false);
    ns_window.setLevel(PET_WINDOW_LEVEL);
}

/// Applique la configuration complete de fenetre compagnon.
///
/// Ne deplace **pas** le personnage dans le canvas : uniquement le chrome
/// natif (niveau, Spaces, transparence). Sophie reste independante des apps.
pub fn configure_pet_window<R: Runtime>(window: &WebviewWindow<R>, _above_menu_bar: bool) {
    // D'abord : NSPanel non-activating (requis pour les Spaces plein ecran).
    ensure_pet_panel(window);

    let Some(ns_window) = ns_window(window) else {
        return;
    };

    // Le CSS ne peut pas atteindre le NSWindow : sans ce fond transparent
    // explicite, il reste un rectangle opaque derriere le WKWebView.
    ns_window.setOpaque(false);
    ns_window.setBackgroundColor(Some(&NSColor::clearColor()));
    ns_window.setHasShadow(false);

    // Sans cela, un glissement sur une zone vide deplacerait la fenetre entiere
    // au lieu de laisser le compagnon gerer son propre deplacement.
    ns_window.setMovableByWindowBackground(false);

    // Reaffirmer le style panel (Tauri/winit peut toucher le styleMask).
    if is_already_pet_panel(&ns_window) {
        let mask = ns_window.styleMask();
        if (mask.0 as usize & STYLE_NONACTIVATING_PANEL) == 0 {
            ns_window.setStyleMask(NSWindowStyleMask::NonactivatingPanel);
        }
        unsafe {
            let _: () = objc2::msg_send![&*ns_window, setFloatingPanel: true];
            let _: () = objc2::msg_send![&*ns_window, setBecomesKeyOnlyIfNeeded: true];
        }
    }

    // always_on_top doit passer *avant* setLevel : Tauri force Floating (3).
    let _ = window.set_always_on_top(true);
    assert_overlay_chrome(&ns_window);

    // Remonte dans la pile sans activer l'app (Accessory + panel non-activating).
    ns_window.orderFrontRegardless();

    clear_webview_background(window);
    log_overlay_diagnostics(window, "configure");
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
            let value = NSNumber::numberWithBool(false);
            let _: () = objc2::msg_send![view, setValue: &*value, forKey: &*key];
        }
    });
}

/// True si le frame AppKit a derive hors de l'union des ecrans (ex. X negatif).
pub fn overlay_frame_drifted<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    let Some(mtm) = MainThreadMarker::new() else {
        return false;
    };
    let Some(ns_window) = ns_window(window) else {
        return false;
    };
    let Some(expected) = screen_union_frame(mtm) else {
        return false;
    };
    let current = ns_window.frame();
    (current.origin.x - expected.origin.x).abs() > FRAME_DRIFT_TOLERANCE
        || (current.origin.y - expected.origin.y).abs() > FRAME_DRIFT_TOLERANCE
        || (current.size.width - expected.size.width).abs() > FRAME_DRIFT_TOLERANCE
        || (current.size.height - expected.size.height).abs() > FRAME_DRIFT_TOLERANCE
}

/// Maintien periodique : chrome toujours ; fit overlay seulement si drift.
pub fn maintain_overlay<R: Runtime>(window: &WebviewWindow<R>) {
    if overlay_frame_drifted(window) {
        let _ = fit_overlay_to_screens(window);
    }
    configure_pet_window(window, false);

    // Log dilue pour ne pas saturer le fichier (toutes les ~10 s).
    static TICK: AtomicU64 = AtomicU64::new(0);
    let n = TICK.fetch_add(1, Ordering::Relaxed);
    if n % 5 == 0 {
        log_overlay_diagnostics(window, "maintain");
    }
}

/// Empeche App Nap d'endormir la boucle JS (sinon Sophie disparait apres idle).
pub fn prevent_app_nap() {
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
/// Les coords Tauri/winit se decalent parfois hors ecran sur macOS avec fenetre
/// transparente ; `NSWindow.setFrame` reste fiable.
pub fn fit_overlay_to_screens<R: Runtime>(window: &WebviewWindow<R>) -> Option<WorkArea> {
    let mtm = MainThreadMarker::new()?;
    let ns_window = ns_window(window)?;
    let frame = screen_union_frame(mtm)?;

    let mut scale = 2.0;
    if let Some(main) = NSScreen::mainScreen(mtm) {
        scale = main.backingScaleFactor();
    }

    ns_window.setFrame_display(frame, true);
    log_overlay_diagnostics(window, "fit");

    // Coordonnees canvas : origine haut-gauche de l'union (y=0 au sommet).
    Some(WorkArea {
        x: frame.origin.x,
        y: 0.0,
        width: frame.size.width,
        height: frame.size.height,
        scale_factor: scale,
    })
}

type ObserverToken = Retained<ProtocolObject<dyn NSObjectProtocol>>;

/// Observe les changements de Space et d'ecrans.
///
/// Sur un Space change : reconfigure le chrome (level / FullScreenAuxiliary)
/// et `show` si besoin — **sans** deplacer le personnage dans le canvas.
/// Sur un changement d'ecrans : refit l'overlay a l'union.
pub fn install_visibility_observers<R: Runtime>(window: &WebviewWindow<R>) {
    static STARTED: AtomicBool = AtomicBool::new(false);
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }

    let main_queue = NSOperationQueue::mainQueue();

    {
        let window = window.clone();
        let block = RcBlock::new(move |_note: NonNull<NSNotification>| {
            // Deja sur la file principale : pas de deplacement du body JS.
            configure_pet_window(&window, false);
            let _ = window.show();
            log_overlay_diagnostics(&window, "activeSpaceDidChange");
        });
        let center = NSWorkspace::sharedWorkspace().notificationCenter();
        let token: ObserverToken = unsafe {
            center.addObserverForName_object_queue_usingBlock(
                Some(NSWorkspaceActiveSpaceDidChangeNotification),
                None,
                Some(&main_queue),
                &block,
            )
        };
        // Doit vivre toute la duree du process (ProtocolObject n'est pas Sync).
        std::mem::forget(token);
    }

    {
        let window = window.clone();
        let block = RcBlock::new(move |_note: NonNull<NSNotification>| {
            let _ = fit_overlay_to_screens(&window);
            configure_pet_window(&window, false);
            let _ = window.show();
            log_overlay_diagnostics(&window, "screenParameters");
        });
        let center = NSNotificationCenter::defaultCenter();
        let token: ObserverToken = unsafe {
            center.addObserverForName_object_queue_usingBlock(
                Some(NSApplicationDidChangeScreenParametersNotification),
                None,
                Some(&main_queue),
                &block,
            )
        };
        std::mem::forget(token);
    }

    append_diag_line("observers=installed path=~/Library/Logs/Sophie/overlay-diag.log");
}

/// Zone utile de l'ecran principal, barre de menus et Dock exclus, convertie en
/// coordonnees a origine haut-gauche pour coller a celles du navigateur.
#[allow(dead_code)]
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
