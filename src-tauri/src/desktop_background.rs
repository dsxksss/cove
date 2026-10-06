//! Desktop Acrylic is composed by Windows, independently of the WebView tree.
//! Suspend the live material during the native move/size loop; restore on exit.
//! Never reapply it on individual move, resize or scroll events.

#[tauri::command]
pub fn set_desktop_blur(window: tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        movement::set_preference(hwnd.0, enabled)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, enabled);
        Err("桌面背景模糊目前支持 Windows 11 22H2 及更新版本".into())
    }
}

#[cfg(target_os = "windows")]
fn set_backdrop(hwnd: *mut std::ffi::c_void, enabled: bool) -> i32 {
    use std::ffi::c_void;
    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(
            hwnd: *mut c_void,
            attribute: u32,
            value: *const c_void,
            size: u32,
        ) -> i32;
    }
    // Documented Windows 11 API: DWMWA_SYSTEMBACKDROP_TYPE and
    // DWMSBT_TRANSIENTWINDOW (Desktop Acrylic) / DWMSBT_NONE.
    const DWMWA_SYSTEMBACKDROP_TYPE: u32 = 38;
    let material: i32 = if enabled { 3 } else { 1 };
    // SAFETY: hwnd comes from the live Tauri window; material is a valid i32
    // throughout this synchronous call and its exact byte size is supplied.
    unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_SYSTEMBACKDROP_TYPE,
            &material as *const _ as *const c_void,
            4,
        )
    }
}

#[cfg(target_os = "windows")]
pub use movement::{install, register_events};

#[cfg(target_os = "windows")]
mod movement {
    use super::set_backdrop;
    use std::ffi::c_void;
    use std::sync::OnceLock;
    use tauri::Emitter;
    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

    pub fn register_events(app: tauri::AppHandle) {
        let _ = APP.set(app);
    }
    type Hwnd = *mut c_void;
    type SubclassProc = unsafe extern "system" fn(Hwnd, u32, usize, isize, usize, usize) -> isize;
    const ID: usize = 0x434f5645;
    const SET_PREFERENCE: u32 = 0x8000 + 0x2c1;
    const ENABLED: usize = 1;
    const MOVING: usize = 2;
    const INITIALIZED: usize = 4;
    const APPLIED: usize = 8;
    #[link(name = "comctl32")]
    extern "system" {
        fn SetWindowSubclass(hwnd: Hwnd, proc: SubclassProc, id: usize, data: usize) -> i32;
        fn GetWindowSubclass(hwnd: Hwnd, proc: SubclassProc, id: usize, data: *mut usize) -> i32;
        fn RemoveWindowSubclass(hwnd: Hwnd, proc: SubclassProc, id: usize) -> i32;
        fn DefSubclassProc(hwnd: Hwnd, msg: u32, wp: usize, lp: isize) -> isize;
    }
    #[link(name = "user32")]
    extern "system" {
        fn SendMessageW(hwnd: Hwnd, msg: u32, wp: usize, lp: isize) -> isize;
        fn GetWindowThreadProcessId(hwnd: Hwnd, pid: *mut u32) -> u32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentThreadId() -> u32;
    }

    // Call only from Tauri setup on the owning UI thread. State is stored by
    // value in the subclass reference data: no heap pointer or borrowed state
    // survives a re-entrant window message.
    pub fn install(hwnd: Hwnd) -> Result<(), String> {
        if unsafe { GetWindowThreadProcessId(hwnd, std::ptr::null_mut()) }
            != unsafe { GetCurrentThreadId() }
        {
            return Err("窗口拖动优化必须在窗口线程初始化".into());
        }
        let mut existing = 0;
        if unsafe { GetWindowSubclass(hwnd, callback, ID, &mut existing) } != 0 {
            return Ok(());
        }
        if unsafe { SetWindowSubclass(hwnd, callback, ID, 0) } == 0 {
            return Err("无法初始化窗口拖动优化".into());
        }
        Ok(())
    }

    // SendMessage also works if a command is dispatched off the UI thread.
    // All subclass state and DWM writes remain on the window's owning thread.
    pub fn set_preference(hwnd: Hwnd, enabled: bool) -> Result<(), String> {
        let result = unsafe { SendMessageW(hwnd, SET_PREFERENCE, enabled as usize, ID as isize) };
        if result == 1 {
            return Ok(());
        }
        if result == 0 {
            return Err("窗口拖动优化尚未初始化，无法设置桌面模糊".into());
        }
        Err(format!(
            "无法设置桌面背景模糊（0x{:08X}），需要 Windows 11 22H2 或更新版本",
            result as u32
        ))
    }

    fn transition(hwnd: Hwnd, previous: usize, mut next: usize) -> isize {
        let wanted = next & ENABLED != 0 && next & MOVING == 0;
        let applied = previous & APPLIED != 0;
        if wanted != applied || previous & INITIALIZED == 0 {
            let result = set_backdrop(hwnd, wanted);
            if result < 0 {
                return result as isize;
            }
        }
        next |= INITIALIZED;
        if wanted {
            next |= APPLIED;
        } else {
            next &= !APPLIED;
        }
        if next != previous {
            unsafe {
                SetWindowSubclass(hwnd, callback, ID, next);
            }
        }
        1
    }

    unsafe extern "system" fn callback(
        hwnd: Hwnd,
        msg: u32,
        wp: usize,
        lp: isize,
        _id: usize,
        state: usize,
    ) -> isize {
        let next = match msg {
            SET_PREFERENCE if lp == ID as isize => {
                let next = if wp != 0 {
                    state | ENABLED
                } else {
                    state & !ENABLED
                };
                return transition(hwnd, state, next);
            }
            0x0231 => Some(state | MOVING), // WM_ENTERSIZEMOVE: once per drag
            0x0232 | 0x001f => Some(state & !MOVING), // exit or WM_CANCELMODE
            0x0018 if wp == 0 => Some(state & !MOVING), // hidden while dragging
            0x0082 => {
                // WM_NCDESTROY: no callback state outlives its window
                RemoveWindowSubclass(hwnd, callback, ID);
                None
            }
            _ => None,
        };
        if let Some(next) = next {
            let result = transition(hwnd, state, next);
            if result < 0 {
                // Movement state must remain accurate even when an older OS
                // rejects the optional material. Preserve the saved preference.
                SetWindowSubclass(hwnd, callback, ID, (state & !MOVING) | (next & MOVING));
                eprintln!("窗口拖动材质切换失败：0x{:08X}", result as u32);
            }
            if state & MOVING != next & MOVING {
                if let Some(app) = APP.get() {
                    // Only two events per native move/size loop, never per frame.
                    let _ = app.emit_to("main", "cove://window-interaction", next & MOVING != 0);
                }
            }
        }
        DefSubclassProc(hwnd, msg, wp, lp)
    }
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;
    use std::ffi::c_void;

    #[test]
    #[ignore = "requires Windows 11 desktop composition; creates only a hidden test window"]
    fn native_desktop_blur_smoke() {
        #[link(name = "user32")]
        extern "system" {
            fn CreateWindowExW(
                ex: u32,
                class: *const u16,
                name: *const u16,
                style: u32,
                x: i32,
                y: i32,
                w: i32,
                h: i32,
                parent: *mut c_void,
                menu: *mut c_void,
                instance: *mut c_void,
                param: *mut c_void,
            ) -> *mut c_void;
            fn DestroyWindow(hwnd: *mut c_void) -> i32;
            fn SendMessageW(hwnd: *mut c_void, msg: u32, wp: usize, lp: isize) -> isize;
        }
        let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
        let title: Vec<u16> = "Cove native background test\0".encode_utf16().collect();
        // WS_POPUP without WS_VISIBLE: never shown or focused.
        let hwnd = unsafe {
            CreateWindowExW(
                0,
                class.as_ptr(),
                title.as_ptr(),
                0x80000000,
                0,
                0,
                100,
                100,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        assert!(!hwnd.is_null());
        install(hwnd).unwrap();
        crate::window_shape::assert_window_shape(hwnd);
        let enabled = movement::set_preference(hwnd, true);
        crate::window_shape::assert_window_shape(hwnd);
        #[link(name = "dwmapi")]
        extern "system" {
            fn DwmGetWindowAttribute(
                hwnd: *mut c_void,
                attribute: u32,
                value: *mut c_void,
                size: u32,
            ) -> i32;
        }
        let material = || {
            let mut value: i32 = 0;
            assert_eq!(
                unsafe { DwmGetWindowAttribute(hwnd, 38, &mut value as *mut _ as *mut c_void, 4) },
                0
            );
            value
        };
        assert_eq!(material(), 3);
        for _ in 0..3 {
            unsafe {
                SendMessageW(hwnd, 0x231, 0, 0);
            }
            assert_eq!(
                material(),
                1,
                "material is suspended even on repeated enter"
            );
        }
        unsafe {
            SendMessageW(hwnd, 0x232, 0, 0);
        }
        assert_eq!(material(), 3, "restore after drag");
        unsafe {
            SendMessageW(hwnd, 0x231, 0, 0);
        }
        movement::set_preference(hwnd, false).unwrap();
        unsafe {
            SendMessageW(hwnd, 0x232, 0, 0);
        }
        assert_eq!(material(), 1, "disabled preference must not be re-enabled");
        unsafe {
            SendMessageW(hwnd, 0x231, 0, 0);
        }
        movement::set_preference(hwnd, true).unwrap();
        assert_eq!(material(), 1, "enabling during drag waits for its end");
        unsafe {
            SendMessageW(hwnd, 0x1f, 0, 0);
        }
        assert_eq!(material(), 3, "cancel restores the saved preference");
        let disabled = movement::set_preference(hwnd, false);
        crate::window_shape::assert_window_shape(hwnd);
        unsafe {
            DestroyWindow(hwnd);
        }
        assert!(enabled.is_ok(), "{enabled:?}");
        assert!(disabled.is_ok(), "{disabled:?}");
    }
}
