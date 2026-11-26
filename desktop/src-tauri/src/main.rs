// 배포 빌드에서 검은 콘솔 창이 같이 뜨지 않게 해요.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("memoir 앱을 시작하지 못했어요");
}
