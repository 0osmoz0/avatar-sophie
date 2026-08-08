//! Activite utilisateur locale (app frontmost + idle input).
//!
//! Ne lit aucun contenu d'ecran / clavier. Pas de keylogging.
//! Independant de macos.rs (NSPanel / Spaces overlay).

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

pub const APP_CHANGED_EVENT: &str = "user-activity:app-changed";
pub const SPACE_CHANGED_EVENT: &str = "user-activity:space-changed";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeUserActivity {
    pub app_name: Option<String>,
    pub bundle_id: Option<String>,
    /// Secondes depuis le dernier evenement clavier (systeme).
    pub seconds_since_keyboard: f64,
    /// Secondes depuis le dernier evenement souris (systeme).
    pub seconds_since_mouse: f64,
    /// Secondes depuis n'importe quel input.
    pub seconds_since_any: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppChangedPayload {
    pub app_name: Option<String>,
    pub bundle_id: Option<String>,
    pub at: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceChangedPayload {
    pub at: f64,
}

#[tauri::command]
pub fn get_user_activity() -> NativeUserActivity {
    #[cfg(target_os = "macos")]
    {
        macos_activity::snapshot()
    }
    #[cfg(not(target_os = "macos"))]
    {
        NativeUserActivity {
            app_name: None,
            bundle_id: None,
            seconds_since_keyboard: 9999.0,
            seconds_since_mouse: 9999.0,
            seconds_since_any: 9999.0,
        }
    }
}

/// Installe les observers app / Space → events frontend (sans toucher NSPanel).
pub fn install_observers<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "macos")]
    macos_activity::install_observers(app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

#[cfg(target_os = "macos")]
mod macos_activity {
    use super::*;
    use block2::RcBlock;
    use core_graphics::event::CGEventType;
    use core_graphics::event_source::CGEventSourceStateID;
    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{
        NSRunningApplication, NSWorkspace, NSWorkspaceActiveSpaceDidChangeNotification,
        NSWorkspaceDidActivateApplicationNotification,
    };
    use objc2_foundation::{NSNotification, NSObjectProtocol, NSOperationQueue};
    use std::ptr::NonNull;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(
            state_id: CGEventSourceStateID,
            event_type: CGEventType,
        ) -> f64;
    }

    /// kCGAnyInputEventType = (CGEventType)~0
    const ANY_INPUT: CGEventType = unsafe { std::mem::transmute(!0u32) };

    fn now_ms() -> f64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs_f64() * 1000.0)
            .unwrap_or(0.0)
    }

    fn seconds_since(event_type: CGEventType) -> f64 {
        let v = unsafe {
            CGEventSourceSecondsSinceLastEventType(
                CGEventSourceStateID::CombinedSessionState,
                event_type,
            )
        };
        if v.is_finite() && v >= 0.0 {
            v
        } else {
            9999.0
        }
    }

    fn frontmost() -> (Option<String>, Option<String>) {
        let workspace = NSWorkspace::sharedWorkspace();
        let Some(app) = workspace.frontmostApplication() else {
            return (None, None);
        };
        // Ignorer Sophie elle-meme si elle est frontmost (rare en accessory).
        if app.processIdentifier() == NSRunningApplication::currentApplication().processIdentifier()
        {
            return (None, None);
        }
        let name = app.localizedName().map(|s| s.to_string());
        let bundle = app.bundleIdentifier().map(|s| s.to_string());
        (name, bundle)
    }

    pub fn snapshot() -> NativeUserActivity {
        let (app_name, bundle_id) = frontmost();
        let keyboard = seconds_since(CGEventType::KeyDown).min(seconds_since(CGEventType::KeyUp));
        let mouse = seconds_since(CGEventType::MouseMoved)
            .min(seconds_since(CGEventType::LeftMouseDown))
            .min(seconds_since(CGEventType::RightMouseDown))
            .min(seconds_since(CGEventType::ScrollWheel));
        let any = seconds_since(ANY_INPUT);
        NativeUserActivity {
            app_name,
            bundle_id,
            seconds_since_keyboard: keyboard,
            seconds_since_mouse: mouse,
            seconds_since_any: any,
        }
    }

    type ObserverToken = Retained<ProtocolObject<dyn NSObjectProtocol>>;

    pub fn install_observers<R: Runtime>(app: &AppHandle<R>) {
        static STARTED: AtomicBool = AtomicBool::new(false);
        if STARTED.swap(true, Ordering::SeqCst) {
            return;
        }

        let main_queue = NSOperationQueue::mainQueue();
        let center = NSWorkspace::sharedWorkspace().notificationCenter();

        {
            let app = app.clone();
            let block = RcBlock::new(move |_note: NonNull<NSNotification>| {
                let (app_name, bundle_id) = frontmost();
                let _ = app.emit(
                    APP_CHANGED_EVENT,
                    AppChangedPayload {
                        app_name,
                        bundle_id,
                        at: now_ms(),
                    },
                );
            });
            let token: ObserverToken = unsafe {
                center.addObserverForName_object_queue_usingBlock(
                    Some(NSWorkspaceDidActivateApplicationNotification),
                    None,
                    Some(&main_queue),
                    &block,
                )
            };
            std::mem::forget(token);
        }

        {
            let app = app.clone();
            let block = RcBlock::new(move |_note: NonNull<NSNotification>| {
                let _ = app.emit(SPACE_CHANGED_EVENT, SpaceChangedPayload { at: now_ms() });
            });
            let token: ObserverToken = unsafe {
                center.addObserverForName_object_queue_usingBlock(
                    Some(NSWorkspaceActiveSpaceDidChangeNotification),
                    None,
                    Some(&main_queue),
                    &block,
                )
            };
            std::mem::forget(token);
        }
    }
}
