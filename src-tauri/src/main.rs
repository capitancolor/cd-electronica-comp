// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build()) // Lo cargamos simple, sin migraciones en Rust
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error running tauri app");
}