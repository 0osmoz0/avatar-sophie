//! Observation du bureau : moniteurs, fenêtres, accessibilité.

use serde::Serialize;
use tauri::{AppHandle, Runtime};

#[derive(Debug, Clone, Serialize)]
pub struct MonitorInfo {
    pub id: u32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(rename = "scaleFactor")]
    pub scale_factor: f64,
    #[serde(rename = "workX")]
    pub work_x: f64,
    #[serde(rename = "workY")]
    pub work_y: f64,
    #[serde(rename = "workWidth")]
    pub work_width: f64,
    #[serde(rename = "workHeight")]
    pub work_height: f64,
    pub primary: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DesktopUnion {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(rename = "scaleFactor")]
    pub scale_factor: f64,
    pub monitors: Vec<MonitorInfo>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WindowInfo {
    pub id: u32,
    pub title: String,
    pub owner: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub layer: i64,
    pub on_screen: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AccessibilityStatus {
    pub trusted: bool,
}

#[cfg(target_os = "macos")]
mod macos_desktop {
    use super::*;
    use objc2_app_kit::NSScreen;
    use objc2_foundation::MainThreadMarker;
    use std::process::Command;

    fn appkit_to_topline(ax: f64, ay: f64, aw: f64, ah: f64, desktop_top: f64) -> (f64, f64, f64, f64) {
        let y = desktop_top - (ay + ah);
        (ax, y, aw, ah)
    }

    fn desktop_top_appkit(mtm: MainThreadMarker) -> f64 {
        let screens = NSScreen::screens(mtm);
        let mut top = f64::NEG_INFINITY;
        for screen in screens.iter() {
            let f = screen.frame();
            top = top.max(f.origin.y + f.size.height);
        }
        if top.is_finite() {
            top
        } else {
            0.0
        }
    }

    pub fn list_monitors() -> Vec<MonitorInfo> {
        let Some(mtm) = MainThreadMarker::new() else {
            return Vec::new();
        };
        let desktop_top = desktop_top_appkit(mtm);
        let screens = NSScreen::screens(mtm);
        let main = NSScreen::mainScreen(mtm);
        let mut out = Vec::new();

        for (index, screen) in screens.iter().enumerate() {
            let full = screen.frame();
            let visible = screen.visibleFrame();
            let scale = screen.backingScaleFactor();
            let (x, y, w, h) = appkit_to_topline(
                full.origin.x,
                full.origin.y,
                full.size.width,
                full.size.height,
                desktop_top,
            );
            let (wx, wy, ww, wh) = appkit_to_topline(
                visible.origin.x,
                visible.origin.y,
                visible.size.width,
                visible.size.height,
                desktop_top,
            );
            let is_primary = main
                .as_ref()
                .map(|m| **m == *screen)
                .unwrap_or(index == 0);
            out.push(MonitorInfo {
                id: index as u32,
                x,
                y,
                width: w,
                height: h,
                scale_factor: scale,
                work_x: wx,
                work_y: wy,
                work_width: ww,
                work_height: wh,
                primary: is_primary,
            });
        }
        out
    }

    pub fn desktop_union() -> DesktopUnion {
        let monitors = list_monitors();
        if monitors.is_empty() {
            return DesktopUnion {
                x: 0.0,
                y: 0.0,
                width: 1280.0,
                height: 800.0,
                scale_factor: 2.0,
                monitors,
            };
        }
        let mut min_x = f64::INFINITY;
        let mut min_y = f64::INFINITY;
        let mut max_x = f64::NEG_INFINITY;
        let mut max_y = f64::NEG_INFINITY;
        let mut scale = 1.0;
        for m in &monitors {
            min_x = min_x.min(m.x);
            min_y = min_y.min(m.y);
            max_x = max_x.max(m.x + m.width);
            max_y = max_y.max(m.y + m.height);
            if m.primary {
                scale = m.scale_factor;
            }
        }
        DesktopUnion {
            x: min_x,
            y: min_y,
            width: max_x - min_x,
            height: max_y - min_y,
            scale_factor: scale,
            monitors,
        }
    }

    pub fn accessibility_trusted() -> bool {
        unsafe {
            extern "C" {
                fn AXIsProcessTrusted() -> u8;
            }
            AXIsProcessTrusted() != 0
        }
    }

    pub fn open_accessibility_settings() {
        let _ = Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn();
    }

    /// Liste les fenêtres via CGWindowList (pas besoin d'Accessibilité pour les bounds).
    pub fn list_windows(own_pid: u32) -> Vec<WindowInfo> {
        use core_foundation::base::{CFTypeID, TCFType};
        use core_foundation::dictionary::{CFDictionary, CFDictionaryGetTypeID};
        use core_foundation::number::{CFNumber, CFNumberGetTypeID};
        use core_foundation::string::{CFString, CFStringGetTypeID};
        use core_graphics::window::{
            copy_window_info, kCGNullWindowID, kCGWindowListExcludeDesktopElements,
            kCGWindowListOptionOnScreenOnly,
        };
        use std::ffi::c_void;

        fn type_id(ptr: *const c_void) -> CFTypeID {
            if ptr.is_null() {
                return 0;
            }
            unsafe { core_foundation::base::CFGetTypeID(ptr as _) }
        }

        fn as_number(ptr: *const c_void) -> Option<f64> {
            if type_id(ptr) != unsafe { CFNumberGetTypeID() } {
                return None;
            }
            let n = unsafe { CFNumber::wrap_under_get_rule(ptr as _) };
            n.to_f64()
        }

        fn as_int(ptr: *const c_void) -> Option<i64> {
            if type_id(ptr) != unsafe { CFNumberGetTypeID() } {
                return None;
            }
            let n = unsafe { CFNumber::wrap_under_get_rule(ptr as _) };
            n.to_i64()
        }

        fn as_string(ptr: *const c_void) -> String {
            if type_id(ptr) != unsafe { CFStringGetTypeID() } {
                return String::new();
            }
            let s = unsafe { CFString::wrap_under_get_rule(ptr as _) };
            s.to_string()
        }

        fn dict_get(dict: &CFDictionary, key: &str) -> *const c_void {
            let k = CFString::new(key);
            dict
                .find(k.as_concrete_TypeRef() as *const c_void)
                .map(|r| *r)
                .unwrap_or(std::ptr::null())
        }

        let Some(array) = copy_window_info(
            kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
            kCGNullWindowID,
        ) else {
            return Vec::new();
        };

        let mut out = Vec::new();
        for item in array.iter() {
            let ptr = *item;
            if type_id(ptr) != unsafe { CFDictionaryGetTypeID() } {
                continue;
            }
            let dict = unsafe { CFDictionary::wrap_under_get_rule(ptr as _) };

            let layer = as_int(dict_get(&dict, "kCGWindowLayer")).unwrap_or(0);
            if layer != 0 {
                continue;
            }

            let owner_pid = as_int(dict_get(&dict, "kCGWindowOwnerPID")).unwrap_or(0) as u32;
            if owner_pid == own_pid {
                continue;
            }

            let bounds_ptr = dict_get(&dict, "kCGWindowBounds");
            if type_id(bounds_ptr) != unsafe { CFDictionaryGetTypeID() } {
                continue;
            }
            let bounds = unsafe { CFDictionary::wrap_under_get_rule(bounds_ptr as _) };

            let gx = as_number(dict_get(&bounds, "X")).unwrap_or(0.0);
            let gy = as_number(dict_get(&bounds, "Y")).unwrap_or(0.0);
            let gw = as_number(dict_get(&bounds, "Width")).unwrap_or(0.0);
            let gh = as_number(dict_get(&bounds, "Height")).unwrap_or(0.0);
            if gw < 80.0 || gh < 60.0 {
                continue;
            }

            let owner = as_string(dict_get(&dict, "kCGWindowOwnerName"));
            if owner == "Window Server" || owner == "Dock" || owner.is_empty() {
                continue;
            }

            out.push(WindowInfo {
                id: as_int(dict_get(&dict, "kCGWindowNumber")).unwrap_or(0) as u32,
                title: as_string(dict_get(&dict, "kCGWindowName")),
                owner,
                x: gx,
                y: gy,
                width: gw,
                height: gh,
                layer,
                on_screen: true,
            });
        }

        out
    }
}

#[tauri::command]
pub fn list_monitors() -> Vec<MonitorInfo> {
    #[cfg(target_os = "macos")]
    {
        return macos_desktop::list_monitors();
    }
    #[cfg(not(target_os = "macos"))]
    Vec::new()
}

#[tauri::command]
pub fn desktop_union() -> DesktopUnion {
    #[cfg(target_os = "macos")]
    {
        return macos_desktop::desktop_union();
    }
    #[cfg(not(target_os = "macos"))]
    DesktopUnion {
        x: 0.0,
        y: 0.0,
        width: 1280.0,
        height: 800.0,
        scale_factor: 1.0,
        monitors: Vec::new(),
    }
}

#[tauri::command]
pub fn list_windows<R: Runtime>(app: AppHandle<R>) -> Vec<WindowInfo> {
    let _ = app;
    #[cfg(target_os = "macos")]
    {
        return macos_desktop::list_windows(std::process::id());
    }
    #[cfg(not(target_os = "macos"))]
    Vec::new()
}

#[tauri::command]
pub fn accessibility_status() -> AccessibilityStatus {
    #[cfg(target_os = "macos")]
    {
        return AccessibilityStatus {
            trusted: macos_desktop::accessibility_trusted(),
        };
    }
    #[cfg(not(target_os = "macos"))]
    AccessibilityStatus { trusted: false }
}

#[tauri::command]
pub fn open_accessibility_settings() {
    #[cfg(target_os = "macos")]
    macos_desktop::open_accessibility_settings();
}
