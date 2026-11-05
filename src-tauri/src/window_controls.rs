use objc2_app_kit::{NSWindow, NSWindowButton};
use objc2_foundation::{NSPoint, NSSize};

// Match the center of the 36-point web titlebar. Keep real AppKit buttons so
// close, minimize, zoom, hover symbols and accessibility retain native behavior.
pub fn align(window: &tauri::WebviewWindow) {
    let target = window.clone();
    let _ = window.run_on_main_thread(move || {
        let Ok(pointer) = target.ns_window() else {
            return;
        };
        // Tauri owns this NSWindow; the borrowed pointer is used only here on
        // the main thread while the WebviewWindow handle is still alive.
        let native = unsafe { &*(pointer as *const NSWindow) };
        if let Some(close) = native.standardWindowButton(NSWindowButton::CloseButton) {
            // These retained superviews belong to the live standard button.
            let container = unsafe { close.superview().and_then(|view| view.superview()) };
            if let Some(container) = container {
                // Wry re-applies an inset using button height + 20 on redraw.
                // Reserve that final height before aligning the larger buttons.
                let mut frame = container.frame();
                frame.size.height = 36.0;
                frame.origin.y = native.frame().size.height - frame.size.height;
                container.setFrame(frame);
            }
        }
        let Some(content) = native.contentView() else {
            return;
        };
        let content_frame = content.convertRect_toView(content.bounds(), None);
        let center_y = content_frame.origin.y + content_frame.size.height - 18.0;
        for kind in [
            NSWindowButton::CloseButton,
            NSWindowButton::MiniaturizeButton,
            NSWindowButton::ZoomButton,
        ] {
            let Some(button) = native.standardWindowButton(kind) else {
                continue;
            };
            let Some(parent) = (unsafe { button.superview() }) else {
                continue;
            };
            let original_bounds = button.bounds().size;
            let center = parent.convertPoint_fromView(NSPoint::new(0.0, center_y), None);
            let mut frame = button.frame();
            frame.origin.y = center.y - 8.0;
            frame.size = NSSize::new(16.0, 16.0);
            button.setFrame(frame);
            // Scale the usual 14-point native drawing to 16 points without
            // enlarging it again on subsequent resize or focus notifications.
            button.setBoundsSize(original_bounds);
        }
    });
}
