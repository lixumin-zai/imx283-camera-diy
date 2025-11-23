// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::{
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Default)]
struct CameraState {
    preview: Option<Child>,
    video: Option<Child>,
}

fn default_media_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let mut dir = PathBuf::from(home);
    dir.push("Pictures");
    dir.push("modern-camera");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_else(|_| "0".into())
}

#[tauri::command]
fn check_rpicam() -> bool {
    // Check for presence of rpicam-hello (Bookworm naming). Symbolic links may still exist for libcamera-*
    let ok_hello = Command::new("sh")
        .arg("-c")
        .arg("command -v rpicam-hello || command -v libcamera-hello")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    let ok_still = Command::new("sh")
        .arg("-c")
        .arg("command -v rpicam-still || command -v libcamera-still")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    ok_hello && ok_still
}

#[tauri::command]
fn start_preview(state: tauri::State<Mutex<CameraState>>) -> Result<(), String> {
    let mut st = state.lock().map_err(|_| "state lock failed")?;
    if st.preview.is_some() {
        return Ok(());
    }

    // Prefer rpicam-hello, fallback to libcamera-hello
    let cmd = if Command::new("sh")
        .arg("-c")
        .arg("command -v rpicam-hello")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
    {
        "rpicam-hello"
    } else {
        "libcamera-hello"
    };

    let child = Command::new(cmd)
        .arg("--timeout")
        .arg("0")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("failed to start preview: {}", e))?;
    st.preview = Some(child);
    Ok(())
}

#[tauri::command]
fn stop_preview(state: tauri::State<Mutex<CameraState>>) -> Result<(), String> {
    let mut st = state.lock().map_err(|_| "state lock failed")?;
    if let Some(mut child) = st.preview.take() {
        child.kill().map_err(|e| format!("failed to stop preview: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn capture_still(
    state: tauri::State<Mutex<CameraState>>,
    dir: Option<String>,
) -> Result<String, String> {
    let mut st = state.lock().map_err(|_| "state lock failed".to_string())?;

    // If a preview is running, we need to stop it to free the camera
    let preview_was_running = if let Some(mut child) = st.preview.take() {
        child
            .kill()
            .map_err(|e| format!("failed to stop preview for capture: {}", e))?;
        // Wait for the process to be fully killed and camera released
        child.wait().ok();
        true
    } else {
        false
    };

    // Give a moment for the camera device to be released
    if preview_was_running {
        std::thread::sleep(std::time::Duration::from_millis(200));
    }

    let base = dir
        .map(PathBuf::from)
        .unwrap_or_else(default_media_dir);
    let out = base.join(format!("photo_{}.jpg", timestamp()));
    let out_str = out.to_string_lossy().to_string();

    // Prefer rpicam-still, fallback to libcamera-still
    let cmd_name = if Command::new("sh")
        .arg("-c")
        .arg("command -v rpicam-still || command -v libcamera-still")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
    {
        "rpicam-still"
    } else {
        "libcamera-still"
    };

    let output = Command::new(cmd_name)
        .arg("-o")
        .arg(&out_str)
        .output()
        .map_err(|e| format!("failed to execute {}: {}", cmd_name, e))?;

    let capture_result = if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!(
            "{} returned non-zero status: {}",
            cmd_name, stderr
        ))
    } else {
        Ok(out_str.clone())
    };

    // If preview was running, restart it
    if preview_was_running {
        let preview_cmd_name = if Command::new("sh")
            .arg("-c")
            .arg("command -v rpicam-hello")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            "rpicam-hello"
        } else {
            "libcamera-hello"
        };

        let child = Command::new(preview_cmd_name)
            .arg("--timeout")
            .arg("0")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("failed to restart preview: {}", e))?;
        st.preview = Some(child);
    }

    capture_result
}

#[tauri::command]
fn start_video(state: tauri::State<Mutex<CameraState>>, dir: Option<String>) -> Result<String, String> {
    let mut st = state.lock().map_err(|_| "state lock failed".to_string())?;
    if st.video.is_some() {
        // already recording
        if let Some(child) = &st.video {
            return Ok(format!("pid:{}", child.id()));
        }
    }

    // If a preview is running, we need to stop it to free the camera
    if let Some(mut child) = st.preview.take() {
        child
            .kill()
            .map_err(|e| format!("failed to stop preview for video recording: {}", e))?;
        // Wait for the process to be fully killed and camera released
        child.wait().ok();
        std::thread::sleep(std::time::Duration::from_millis(200));
    }

    let base = dir
        .map(PathBuf::from)
        .unwrap_or_else(default_media_dir);
    let out = base.join(format!("video_{}.h264", timestamp()));
    let out_str = out.to_string_lossy().to_string();

    let cmd = if Command::new("sh")
        .arg("-c")
        .arg("command -v rpicam-vid")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
    {
        "rpicam-vid"
    } else {
        "libcamera-vid"
    };

    let child = Command::new(cmd)
        .arg("-o")
        .arg(&out_str)
        .arg("--timeout")
        .arg("0")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("failed to start video: {}", e))?;
    st.video = Some(child);
    Ok(out_str)
}

#[tauri::command]
fn stop_video(state: tauri::State<Mutex<CameraState>>) -> Result<(), String> {
    let mut st = state.lock().map_err(|_| "state lock failed")?;
    if let Some(mut child) = st.video.take() {
        child.kill().map_err(|e| format!("failed to stop video: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn list_media(dir: Option<String>) -> Result<Vec<String>, String> {
    use std::fs;
    let base = dir
        .map(PathBuf::from)
        .unwrap_or_else(|| default_media_dir());
    let mut entries: Vec<(String, u64)> = vec![];
    for e in fs::read_dir(&base).map_err(|e| format!("read_dir failed: {}", e))? {
        let e = e.map_err(|e| format!("entry error: {}", e))?;
        let path = e.path();
        if path.is_file() {
            let meta = fs::metadata(&path).map_err(|e| format!("metadata failed: {}", e))?;
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            entries.push((path.to_string_lossy().to_string(), mtime));
        }
    }
    entries.sort_by(|a, b| b.1.cmp(&a.1));
    Ok(entries.into_iter().map(|(p, _)| p).collect())
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(CameraState::default()))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            check_rpicam,
            start_preview,
            stop_preview,
            capture_still,
            start_video,
            stop_video,
            list_media
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
