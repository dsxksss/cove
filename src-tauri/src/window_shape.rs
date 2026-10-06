//! Use the same DWM composition boundary for the material and window corners.
//! A custom SetWindowRgn prevents Windows from applying native rounded corners.
use std::ffi::c_void;

#[link(name = "user32")]
extern "system" {
    fn SetWindowRgn(hwnd: *mut c_void, region: *mut c_void, redraw: i32) -> i32;
}
#[link(name = "dwmapi")]
extern "system" {
    fn DwmSetWindowAttribute(
        hwnd: *mut c_void,
        attribute: u32,
        value: *const c_void,
        size: u32,
    ) -> i32;
}

pub fn sync(hwnd: *mut c_void) -> Result<(), String> {
    // Remove any old custom region before opting into DWM's antialiased corners.
    // No GDI region is created or owned by this implementation.
    if unsafe { SetWindowRgn(hwnd, std::ptr::null_mut(), 1) } == 0 {
        return Err(format!(
            "无法清除旧窗口裁切：{}",
            std::io::Error::last_os_error()
        ));
    }
    const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
    const DWMWCP_ROUND: i32 = 2;
    let result = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &DWMWCP_ROUND as *const _ as *const c_void,
            4,
        )
    };
    if result < 0 {
        return Err(format!("无法启用系统窗口圆角（0x{:08X}）", result as u32));
    }
    Ok(())
}

#[cfg(test)]
pub(crate) fn assert_window_shape(hwnd: *mut c_void) {
    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmGetWindowAttribute(
            hwnd: *mut c_void,
            attribute: u32,
            value: *mut c_void,
            size: u32,
        ) -> i32;
    }
    sync(hwnd).unwrap();
    let mut preference: i32 = 0;
    assert_eq!(
        unsafe { DwmGetWindowAttribute(hwnd, 33, &mut preference as *mut _ as *mut c_void, 4) },
        0
    );
    assert_eq!(preference, 2);
}
