mod commands;

use tauri::Builder;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::align_mafft,
            commands::run_iqtree,
            commands::detect_engines,
            commands::download_engine,
            commands::run_beast,
            commands::run_beast_phylodynamics
        ])
        .run(tauri::generate_context!())
        .expect("error while running EvoSuite");
}
