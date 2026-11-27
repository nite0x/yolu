#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend;

use backend::{Options, Service};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    webview::{NewWindowResponse, PermissionKind, PermissionResponse},
    Manager, WebviewUrl, WebviewWindowBuilder,
};

struct Host {
    options: Options,
    binary: PathBuf,
    agent: Option<PathBuf>,
    service: Mutex<Option<Service>>,
    origin: Mutex<Option<String>>,
    working: AtomicBool,
    chinese: AtomicBool,
}

#[cfg(any(target_os = "macos", windows))]
fn window_capability(identifier: impl Into<String>) -> tauri::ipc::CapabilityBuilder {
    let capability = tauri::ipc::CapabilityBuilder::new(identifier)
        .window("main")
        .permission("core:window:allow-start-dragging")
        .permission("core:window:allow-internal-toggle-maximize");
    #[cfg(windows)]
    let capability = capability
        .permission("core:window:allow-minimize")
        .permission("core:window:allow-is-maximized")
        .permission("core:window:allow-close")
        .permission("allow-show-app-menu");
    capability
}

fn status_url(_app: &tauri::AppHandle, message: &str) -> tauri::Url {
    // Use the same bundled origin on Windows/Linux and macOS. There is no
    // general filesystem or process command on either page.
    let mut url = tauri::Url::parse(if cfg!(windows) || cfg!(target_os = "linux") {
        "http://tauri.localhost/index.html"
    } else {
        "tauri://localhost/index.html"
    })
    .unwrap();
    url.query_pairs_mut().append_pair("error", message);
    url
}

fn show_notice(app: &tauri::AppHandle, message: &str) {
    if let Some(window) = app.get_webview_window("notice") {
        let _ = window.close();
    }
    let _ = WebviewWindowBuilder::new(
        app,
        "notice",
        WebviewUrl::External(status_url(app, message)),
    )
    .title(if app.state::<Host>().chinese.load(Ordering::SeqCst) { "Yolu · 提示" } else { "Yolu · Notice" })
    .inner_size(720.0, 420.0)
    .build();
}

fn show_error(app: &tauri::AppHandle, message: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.navigate(status_url(app, message));
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn connect(app: tauri::AppHandle, stop: bool) {
    let host = app.state::<Host>();
    if host.working.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        let host = app.state::<Host>();
        if stop {
            let mut options = host.options.clone();
            if let Some(service) = host.service.lock().unwrap().as_ref() {
                options.data = Some(service.data_dir.clone());
            }
            match backend::stop(&host.binary, &options) {
                Ok(()) => app.exit(0),
                Err(message) => show_notice(&app, &message),
            }
        } else {
            match backend::start(&host.binary, &host.options, host.agent.as_ref()) {
                Ok(service) => {
                    let mut url = tauri::Url::parse(&service.url).unwrap();
                    if let Err(error) = app.add_capability(
                        tauri::ipc::CapabilityBuilder::new(format!("ui-language-{}", service.pid))
                            .window("main")
                            .remote(format!("{}/*", url.origin().ascii_serialization()))
                            .permission("allow-set-ui-language"),
                    ) {
                        show_error(&app, &error.to_string());
                        host.working.store(false, Ordering::SeqCst);
                        return;
                    }
                    // Only the verified local backend can control the main window.
                    #[cfg(any(target_os = "macos", windows))]
                    if let Err(error) = app.add_capability(
                        window_capability(format!("window-controls-{}", service.pid))
                            .remote(format!("{}/*", url.origin().ascii_serialization())),
                    ) {
                        show_error(&app, &error.to_string());
                        host.working.store(false, Ordering::SeqCst);
                        return;
                    }
                    *host.origin.lock().unwrap() = Some(url.origin().ascii_serialization());
                    if let Some(window) = app.get_webview_window("main") {
                        // Keep the selected conversation/environment when reconnecting to a new port.
                        if let Ok(old) = window.url() {
                            if old.host_str() == Some("127.0.0.1") {
                                url.set_query(old.query());
                                url.set_fragment(old.fragment());
                            }
                        }
                        *host.service.lock().unwrap() = Some(service);
                        if let Err(error) = window.navigate(url) {
                            show_error(&app, &error.to_string());
                        }
                    }
                }
                Err(message) => show_error(&app, &message),
            }
        }
        host.working.store(false, Ordering::SeqCst);
    });
}

#[tauri::command]
fn set_ui_language(app: tauri::AppHandle, window: tauri::WebviewWindow, language: String) -> Result<(), String> {
    if window.label() != "main" || (language != "en" && language != "zh-CN") {
        return Err("Unsupported interface language".into());
    }
    let chinese = language == "zh-CN";
    app.set_menu(menu(&app, chinese).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    window.hide_menu().map_err(|e| e.to_string())?;
    app.state::<Host>().chinese.store(chinese, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
fn show_app_menu(app: tauri::AppHandle, window: tauri::WebviewWindow, ready: bool, x: f64, y: f64) -> Result<(), String> {
    if !cfg!(windows) || window.label() != "main" {
        return Err("Application popup menu is only available in the main Windows window".into());
    }
    let menu = app.menu().ok_or("Application menu is unavailable")?;
    if let Some(item) = menu.get("home").and_then(|item| item.as_menuitem().cloned()) {
        item.set_enabled(ready).map_err(|e| e.to_string())?;
    }
    window.popup_menu_at(&menu, tauri::LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}

fn menu(app: &tauri::AppHandle, chinese: bool) -> tauri::Result<Menu<tauri::Wry>> {
    let label = |zh, en| if chinese { zh } else { en };
    let reconnect = MenuItem::with_id(app, "reconnect", label("重新连接后台", "Reconnect backend"), true, None::<&str>)?;
    let close = MenuItem::with_id(
        app,
        "close",
        label("关闭窗口（保留后台）", "Close window (keep backend)"),
        true,
        Some("CmdOrCtrl+Shift+W"),
    )?;
    let quit = MenuItem::with_id(
        app,
        "quit",
        label("退出并停止后台", "Quit and stop backend"),
        true,
        Some("CmdOrCtrl+Q"),
    )?;
    let edit = Submenu::with_items(
        app,
        label("编辑", "Edit"),
        true,
        &[
            &PredefinedMenuItem::undo(app, Some(label("撤销", "Undo")))?,
            &PredefinedMenuItem::redo(app, Some(label("重做", "Redo")))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some(label("剪切", "Cut")))?,
            &PredefinedMenuItem::copy(app, Some(label("复制", "Copy")))?,
            &PredefinedMenuItem::paste(app, Some(label("粘贴", "Paste")))?,
            &PredefinedMenuItem::select_all(app, Some(label("全选", "Select all")))?,
        ],
    )?;
    if cfg!(windows) {
        let home = MenuItem::with_id(app, "home", label("对话首页", "Conversations"), false, None::<&str>)?;
        Menu::with_items(app, &[
            &home,
            &PredefinedMenuItem::separator(app)?,
            &reconnect,
            &edit,
            &PredefinedMenuItem::separator(app)?,
            &close,
            &quit,
        ])
    } else {
        let work = Submenu::with_items(
            app,
            "Yolu",
            true,
            &[
                &reconnect,
                &PredefinedMenuItem::separator(app)?,
                &close,
                &quit,
            ],
        )?;
        Menu::with_items(app, &[&work, &edit])
    }
}

fn is_preview_identifier(identifier: &str) -> bool {
    identifier == "dev.work-hub.desktop.preview"
        || identifier.starts_with("dev.work-hub.desktop.preview.")
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "linux")]
    if std::env::args_os().nth(1).as_deref() == Some(std::ffi::OsStr::new("--mcp")) {
        use std::os::unix::process::CommandExt;
        // Relaunch from an AppImage while preserving the agent's stdio.
        let error = std::process::Command::new(backend::binary_path()?)
            .args(std::env::args_os().skip(1))
            .exec();
        return Err(error.into());
    }
    let context = tauri::generate_context!();
    let options = Options::parse(std::env::args_os().skip(1))?;
    if is_preview_identifier(&context.config().identifier)
        && (options.stop || options.backend_info) && options.data.is_none()
    {
        return Err("测试版命令行操作必须显式指定 --data，避免操作正式版后台".into());
    }
    let binary = backend::binary_path()?;
    if options.stop {
        backend::stop(&binary, &options)?;
        return Ok(());
    }
    if options.backend_info {
        let service = backend::start(&binary, &options, None)?;
        println!("{}", serde_json::to_string(&service)?);
        return Ok(());
    }
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![set_ui_language, show_app_menu])
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            // Refuse to silently switch an existing window to another profile.
            let host = app.state::<Host>();
            let incoming = Options::parse_at(args.into_iter().skip(1).map(Into::into), cwd.into());
            if let Err(message) = &incoming { show_notice(app, message); return; }
            if let Ok(incoming) = incoming {
                let service = host.service.lock().unwrap();
                if let Some(service) = service.as_ref() {
                    let same = |requested: &Option<PathBuf>, active: &PathBuf| requested.as_ref()
                        .is_none_or(|p| p.canonicalize().unwrap_or_else(|_| p.clone()) == *active);
                    if !same(&incoming.data, &service.data_dir) || !same(&incoming.root, &service.root) {
                        // Keep the current window intact; report the conflict in a separate window.
                        show_notice(app, "另一个数据目录或 Worktree 根目录的桌面窗口已经打开。请先关闭该窗口，再使用新的启动参数。");
                        return;
                    }
                }
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize(); let _ = window.show(); let _ = window.set_focus();
            }
        }))
        .setup(move |app| {
            let mut options = options;
            // Finder launches of the preview use their own backend and worktree directory.
            if is_preview_identifier(&app.config().identifier) {
                let preview = app.path().app_data_dir()?;
                options.data.get_or_insert_with(|| preview.join("data"));
                options.root.get_or_insert_with(|| preview.join("workspaces"));
            }
            let agent = app.path().resource_dir()?.join("agents").join(format!("worktree-hub-linux-{}", if cfg!(target_arch = "aarch64") { "arm64" } else { "amd64" }));
            app.manage(Host { options, binary, agent: agent.is_file().then_some(agent),
                service: Mutex::new(None), origin: Mutex::new(None), working: AtomicBool::new(false), chinese: AtomicBool::new(false) });
            app.add_capability(tauri::ipc::CapabilityBuilder::new("startup-ui-language")
                .window("main").permission("allow-set-ui-language"))?;
            #[cfg(any(target_os = "macos", windows))]
            app.add_capability(window_capability("startup-window-controls"))?;
            app.set_menu(menu(app.handle(), false)?)?;
            let handle = app.handle().clone();
            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title(app.config().product_name.as_deref().unwrap_or("Yolu")).inner_size(1380.0, 900.0).min_inner_size(900.0, 600.0).center()
                .initialization_script_for_all_frames(format!("{}({:?});", include_str!("window-chrome.js"), std::env::consts::OS));
            #[cfg(windows)]
            let builder = builder.decorations(false).visible(false);
            #[cfg(target_os = "macos")]
            let builder = {
                // Center AppKit's buttons on the 36-point macOS web header.
                builder.title_bar_style(tauri::TitleBarStyle::Overlay)
                    .hidden_title(true)
                    .traffic_light_position(tauri::LogicalPosition::new(7.0, 16.0))
            };
            let window = builder
                .on_permission_request(|view, kind| {
                    let trusted = view.url().ok().is_some_and(|url| {
                        view.state::<Host>().origin.lock().unwrap().as_ref()
                            .is_some_and(|origin| *origin == url.origin().ascii_serialization())
                    });
                    if trusted && matches!(kind, PermissionKind::Microphone) {
                        PermissionResponse::Allow
                    } else {
                        PermissionResponse::Default
                    }
                })
                .on_navigation(move |url| {
                    let bundled = url.scheme() == "tauri" && url.host_str() == Some("localhost")
                        || url.scheme() == "http" && url.host_str() == Some("tauri.localhost");
                    bundled || handle.state::<Host>().origin.lock().unwrap().as_ref()
                        .is_some_and(|origin| *origin == url.origin().ascii_serialization())
                })
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .build()?;
            #[cfg(windows)]
            {
                // Hiding retains native menu accelerators and popup handling.
                window.hide_menu()?;
                window.show()?;
            }
            let handle = app.handle().clone();
            window.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    // Tauri exits; the detached Go backend intentionally outlives it.
                    handle.exit(0);
                }
            });
            connect(app.handle().clone(), false);
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "reconnect" => connect(app.clone(), false),
            "quit" => connect(app.clone(), true),
            "close" => { if let Some(window) = app.get_webview_window("main") { let _ = window.close(); } }
            "home" => { if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval("window.dispatchEvent(new Event('workhub:desktop-home'))");
            } }
            _ => (),
        })
        .run(context)?;
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("Yolu: {error}");
        std::process::exit(1);
    }
}
