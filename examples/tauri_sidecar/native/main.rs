#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{sync::{mpsc, Mutex}, time::Duration};
use tauri::Manager;
use tauri_plugin_shell::{ShellExt, process::{CommandChild, CommandEvent}};

struct Backend { child: Option<CommandChild>, replies: mpsc::Receiver<String>, pid: u32 }
impl Backend {
    fn stop(&mut self) { if let Some(child) = self.child.take() { let _ = child.kill(); } }
}
impl Drop for Backend { fn drop(&mut self) { self.stop(); } }
#[derive(serde::Serialize)]
struct Reply { result: u64, pid: u32 }

// The renderer can request a calculation, but cannot launch arbitrary programs.
#[tauri::command]
fn calculate(value: u64, state: tauri::State<Mutex<Backend>>) -> Result<Reply, String> {
    if value > 1_000_000 { return Err("Use an integer from 0 to 1000000".into()); }
    let mut backend = state.lock().map_err(|e| e.to_string())?;
    let child = backend.child.as_mut().ok_or("Backend stopped. Restart the app to reconnect.")?;
    child.write(format!("{value}\n").as_bytes()).map_err(|e| e.to_string())?;
    match backend.replies.recv_timeout(Duration::from_secs(3)) {
        Ok(line) => Ok(Reply { result: line.trim().parse().map_err(|_| "Invalid sidecar reply")?, pid: backend.pid }),
        Err(error) => { backend.stop(); Err(format!("Sidecar stopped or timed out: {error}")) }
    }
}
fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let (mut events, child) = app.shell().sidecar("tinybuild-math-backend")?.spawn()?;
            let (send, replies) = mpsc::channel();
            tauri::async_runtime::spawn(async move {
                while let Some(event) = events.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => { if send.send(String::from_utf8_lossy(&line).into_owned()).is_err() { break } },
                        CommandEvent::Stderr(line) => eprintln!("{}", String::from_utf8_lossy(&line)),
                        CommandEvent::Terminated(_) | CommandEvent::Error(_) => break,
                        _ => {}
                    }
                }
            });
            // Own the process before waiting, so a readiness failure cleans it up.
            let mut backend = Backend { child: Some(child), replies, pid: 0 };
            let ready = backend.replies.recv_timeout(Duration::from_secs(5))?;
            backend.pid = ready.trim().strip_prefix("ready ").ok_or("Invalid sidecar greeting")?.parse()?;
            app.manage(Mutex::new(backend));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![calculate])
        .build(tauri::generate_context!())
        .expect("Could not start the sidecar example");
    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(state) = handle.try_state::<Mutex<Backend>>() {
                if let Ok(mut backend) = state.lock() { backend.stop(); }
            }
        }
    });
}
