// 배포 빌드에서 검은 콘솔 창이 같이 뜨지 않게 해요.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        // 이미 열려 있으면 새 창을 띄우지 않고 그 창을 앞으로 가져와요. (다른 플러그인보다 먼저 등록해야 해요)
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        // 창 크기·위치·최대화를 기억했다가 다음에 그대로 열어요.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("memoir 앱을 시작하지 못했어요");
}
