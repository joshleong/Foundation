//! Foundation's desktop shell.
//!
//! In `tauri dev` the window shows the Vite dev server (:1430), which proxies the
//! Foundation server, so everything is same-origin.
//!
//! Packaged, the window is served by the app itself from http://localhost:31440
//! (tauri-plugin-localhost) instead of Tauri's own scheme (http://tauri.localhost
//! on Windows, tauri://localhost on macOS). Cookies are matched by host, not port,
//! so a Foundation server on http://localhost:4410 is the same site: its
//! SameSite=Lax session cookie, the sync WebSocket and SSE all reach it, and its
//! CORS already admits http://localhost:<port>. The bundled client still opens when
//! the server is down, so the device's board copies keep working offline.

use std::net::TcpListener;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// The packaged window's origin. Fixed, because the origin keys the device's offline
/// board copies (IndexedDB) and localStorage: change it and they're left behind.
/// Above 15000 and below 32768 on purpose: Windows reserves blocks of its dynamic
/// port range for Hyper-V and WSL at boot (bind fails with WSAEACCES), and that range
/// is 49152+ by default but 1024–15000 on some machines; Linux and macOS hand out
/// ephemeral ports from 32768 and 49152.
const PORT: u16 = 31440;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let dev = tauri::is_dev();
    let mut builder = tauri::Builder::default()
        // a second launch shows the open window: two copies can't share the port
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        // updates (SPEC: Desktop updates): the page asks the signed feed and a person presses Update
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());
    // the plugin's server panics on its own thread if it can't bind; check first and say why instead
    let port_free = dev || TcpListener::bind(("localhost", PORT)).is_ok();
    if !dev && port_free {
        builder = builder.plugin(tauri_plugin_localhost::Builder::new(PORT).build());
    }
    builder
        .setup(move |app| {
            let url = if dev {
                WebviewUrl::App("index.html".into())
            } else if port_free {
                WebviewUrl::External(format!("http://localhost:{PORT}").parse().expect("loopback url"))
            } else {
                WebviewUrl::External(port_taken_page().parse().expect("data url"))
            };
            WebviewWindowBuilder::new(app, "main", url)
                .title("Foundation")
                .inner_size(1440.0, 900.0)
                .min_inner_size(960.0, 600.0)
                .center()
                // files dropped on the window go to the page (uploads), not to Tauri
                .disable_drag_drop_handler()
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Foundation");
}

/// Shown when another program holds the window's port (or Windows has reserved it).
fn port_taken_page() -> String {
    let html = format!(
        "<!doctype html><meta charset=utf-8><title>Foundation</title>\
         <body style=\"font:15px/1.5 system-ui,sans-serif;background:#0f1729;color:#dfe6f3;display:grid;place-items:center;height:100vh;margin:0\">\
         <div style=\"max-width:34em\"><h1 style=\"font-size:20px;font-weight:600\">Foundation can't open its window</h1>\
         <p>It serves its page from <code>http://localhost:{PORT}</code>, and something else on this computer is using that port.</p>\
         <p>Close the other program and start Foundation again. On Windows, <code>netstat -ano | findstr :{PORT}</code> shows what holds it, \
         and <code>netsh int ipv4 show excludedportrange protocol=tcp</code> shows ports Windows has reserved.</p></div>"
    );
    format!("data:text/html;charset=utf-8,{}", html.replace('%', "%25").replace('#', "%23").replace(' ', "%20").replace('"', "%22").replace('<', "%3C").replace('>', "%3E"))
}
