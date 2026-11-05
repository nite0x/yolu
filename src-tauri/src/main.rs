#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend;
#[cfg(target_os = "macos")]
mod window_controls;

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
    webview::NewWindowResponse,
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
                    // Only the verified local backend can move the main window.
                    // No filesystem, shell or general window-management access.
                    #[cfg(target_os = "macos")]
                    if let Err(error) = app.add_capability(
                        tauri::ipc::CapabilityBuilder::new(format!("window-drag-{}", service.pid))
                            .window("main")
                            .remote(format!("{}/*", url.origin().ascii_serialization()))
                            .permission("core:window:allow-start-dragging")
                            .permission("core:window:allow-internal-toggle-maximize"),
                    ) {
                        show_error(&app, &error.to_string());
                        host.working.store(false, Ordering::SeqCst);
                        return;
                    }
                    *host.origin.lock().unwrap() = Some(url.origin().ascii_serialization());
                    if let Some(window) = app.get_webview_window("main") {
                        // Keep the selected task/environment when reconnecting to a new port.
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
    app.state::<Host>().chinese.store(chinese, Ordering::SeqCst);
    Ok(())
}

fn menu(app: &tauri::AppHandle, chinese: bool) -> tauri::Result<Menu<tauri::Wry>> {
    let label = |zh, en| if chinese { zh } else { en };
    let reconnect = MenuItem::with_id(app, "reconnect", label("重新连接后台", "Reconnect backend"), true, None::<&str>)?;
    let new_tab = MenuItem::with_id(app, "new-tab", label("新建标签页", "New tab"), true, Some("CmdOrCtrl+T"))?;
    let close_tab = MenuItem::with_id(app, "close-tab", label("关闭当前标签页", "Close current tab"), true, Some("CmdOrCtrl+W"))?;
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
    let work = Submenu::with_items(
        app,
        "Yolu",
        true,
        &[
            &reconnect,
            &PredefinedMenuItem::separator(app)?,
            &new_tab,
            &close_tab,
            &close,
            &quit,
        ],
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
    Menu::with_items(app, &[&work, &edit])
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let context = tauri::generate_context!();
    let options = Options::parse(std::env::args_os().skip(1))?;
    if context.config().identifier == "dev.work-hub.desktop.preview"
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
        .invoke_handler(tauri::generate_handler![set_ui_language])
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
                        // Keep the current task intact; report the conflict in a separate window.
                        show_notice(app, "另一个数据目录或工作区的桌面窗口已经打开。请先关闭该窗口，再使用新的启动参数。");
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
            // Finder launches of the preview use their own backend and workspace.
            if app.config().identifier == "dev.work-hub.desktop.preview" {
                let preview = app.path().app_data_dir()?;
                options.data.get_or_insert_with(|| preview.join("data"));
                options.root.get_or_insert_with(|| preview.join("workspaces"));
            }
            let agent = app.path().resource_dir()?.join("agents").join(format!("worktree-hub-linux-{}", if cfg!(target_arch = "aarch64") { "arm64" } else { "amd64" }));
            app.manage(Host { options, binary, agent: agent.is_file().then_some(agent),
                service: Mutex::new(None), origin: Mutex::new(None), working: AtomicBool::new(false), chinese: AtomicBool::new(false) });
            app.add_capability(tauri::ipc::CapabilityBuilder::new("startup-ui-language")
                .window("main").permission("allow-set-ui-language"))?;
            app.set_menu(menu(app.handle(), false)?)?;
            let handle = app.handle().clone();
            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title(app.config().product_name.as_deref().unwrap_or("Yolu")).inner_size(1380.0, 900.0).min_inner_size(900.0, 600.0).center();
            #[cfg(target_os = "macos")]
            let builder = {
                app.add_capability(tauri::ipc::CapabilityBuilder::new("startup-window-drag")
                    .window("main")
                    .permission("core:window:allow-start-dragging")
                    .permission("core:window:allow-internal-toggle-maximize"))?;
                builder.title_bar_style(tauri::TitleBarStyle::Overlay)
                    .hidden_title(true)
                    .traffic_light_position(tauri::LogicalPosition::new(12.0, 20.0))
                    .initialization_script_for_all_frames(include_str!("window-chrome.js"))
            };
            let window = builder
                .on_page_load(|window, _| {
                    #[cfg(target_os = "macos")]
                    window_controls::align(&window);
                    #[cfg(not(target_os = "macos"))]
                    let _ = window;
                })
                .on_navigation(move |url| {
                    let bundled = url.scheme() == "tauri" && url.host_str() == Some("localhost")
                        || url.scheme() == "http" && url.host_str() == Some("tauri.localhost");
                    bundled || handle.state::<Host>().origin.lock().unwrap().as_ref()
                        .is_some_and(|origin| *origin == url.origin().ascii_serialization())
                })
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .build()?;
            #[cfg(target_os = "macos")]
            window_controls::align(&window);
            #[cfg(target_os = "macos")]
            let controls_window = window.clone();
            let handle = app.handle().clone();
            window.on_window_event(move |event| {
                #[cfg(target_os = "macos")]
                if matches!(event, tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. } | tauri::WindowEvent::Focused(true)) {
                    window_controls::align(&controls_window);
                }
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
            "new-tab" | "close-tab" => {
                if let Some(window) = app.get_webview_window("main") {
                    let command = if event.id().as_ref() == "new-tab" { "new" } else { "close" };
                    let _ = window.eval(&format!("window.dispatchEvent(new CustomEvent('workhub:tab-command', {{detail:'{command}'}}))"));
                }
            }
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
