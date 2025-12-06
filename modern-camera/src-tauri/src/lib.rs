use base64::{Engine as _, engine::general_purpose};
use tauri::{command, AppHandle, Emitter, Manager, Runtime};
use std::process::{Command, Stdio};
use std::io::{BufReader, Read};

use std::thread;

#[command]
fn start_preview<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    
    Command::new("rpicam-still").arg("-o").arg("/dev/null").arg("--immediate").output().map_err(|e| e.to_string())?;

    let mut child = Command::new("rpicam-vid")
        .args(&[
            "-t", "0",
            "--codec", "mjpeg",
            "-o", "-",
        ])
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
    let reader = BufReader::new(stdout);

    thread::spawn(move || {
        let mut buffer = Vec::new();
        for byte in reader.bytes() {
            let byte = byte.unwrap();
            buffer.push(byte);
            if buffer.ends_with(&[0xff, 0xd9]) {
                
                let image_data = general_purpose::STANDARD.encode(&buffer);
                app.emit("preview-frame", image_data).unwrap();
                buffer.clear();
            }
        }
    });

    Ok(())
}

#[command]
fn capture_image() -> Result<String, String> {
    let output = Command::new("rpicam-still")
        .args(&[
            "-o", "capture.jpg",
            "--width", "1920",
            "--height", "1080",
            "-q", "100",
            "--immediate"
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok("Image captured successfully".to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![start_preview, capture_image])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}