use base64::{Engine as _, engine::general_purpose};
use tauri::{command, AppHandle, Runtime, State};
use std::process::{Command, Stdio, Child};
use std::io::{BufReader, Read};
use std::path::PathBuf;
use std::fs;
use chrono::Local;
use std::sync::{Arc, Mutex, Condvar};
use std::thread;
use tiny_http::{Server, Response, Header};

// State to hold the latest preview frame
struct PreviewState {
    current_frame: Arc<Mutex<Vec<u8>>>,
    frame_cond: Arc<Condvar>,
}

// Define a state to hold the preview process
struct PreviewProcess(Arc<Mutex<Option<Child>>>);

fn spawn_preview_process<R: Runtime>(_app: &AppHandle<R>) -> Result<Child, String> {
    // Kill any existing dummy rpicam-still process just in case
    let _ = Command::new("pkill").arg("rpicam-still").output();

    let child = Command::new("rpicam-vid")
        .args(&[
            "-t", "0",
            "--codec", "mjpeg",
            "--width", "1280", // Reduced from 1920 for performance
            "--height", "854", // Reduced from 1280
            "--quality", "80",
            "--framerate", "30",
            "-o", "-",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(child)
}

fn start_http_server(preview_state: Arc<PreviewState>) {
    thread::spawn(move || {
        let server = Server::http("0.0.0.0:18888").unwrap();
        println!("HTTP Stream Server listening on port 18888");

        for request in server.incoming_requests() {
            let state = preview_state.clone();
            thread::spawn(move || {
                if request.url() == "/stream" {
                    let boundary = "frame";
                    let mut response = request.into_writer();
                    
                    let header = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary={}\r\n\r\n",
                        boundary
                    );
                    if let Err(_) = response.write_all(header.as_bytes()) {
                        return;
                    }

                    loop {
                        let frame = {
                            let (lock, cvar) = (&state.current_frame, &state.frame_cond);
                            let frame = lock.lock().unwrap();
                            // Wait for new frame or timeout (to avoid permanent blocking if camera dies)
                            // We use a simple strategy: just wait. If camera updates, we wake up.
                            // Ideally we'd use wait_timeout but standard Condvar wait is fine.
                            // Actually, to support multiple clients, we shouldn't consume the frame.
                            // But wait returns the guard.
                            // We need to know if it's a NEW frame.
                            // Simple hack: Check frame size > 0.
                            // Better: Add a frame counter?
                            // For now, let's just wait on condvar. The producer notifies all.
                            let _guard = cvar.wait(frame).unwrap();
                            _guard.clone()
                        };

                        if frame.is_empty() {
                            thread::sleep(std::time::Duration::from_millis(100));
                            continue;
                        }

                        let part_header = format!(
                            "--{}\r\nContent-Type: image/jpeg\r\nContent-Length: {}\r\n\r\n",
                            boundary,
                            frame.len()
                        );
                        
                        if response.write_all(part_header.as_bytes()).is_err() { break; }
                        if response.write_all(&frame).is_err() { break; }
                        if response.write_all(b"\r\n").is_err() { break; }
                    }
                } else if request.url().starts_with("/photos/") {
                    // Serve static photo file
                    // URL format: /photos/IMG_2024...jpg
                    let filename = &request.url()["/photos/".len()..];
                    let save_dir = PathBuf::from("photos");
                    // Security check: ensure no path traversal
                    if filename.contains("..") || filename.contains("/") || filename.contains("\\") {
                         let _ = request.respond(Response::from_string("Forbidden").with_status_code(403));
                         return;
                    }
                    
                    let file_path = save_dir.join(filename);
                    if file_path.exists() {
                         let file = fs::File::open(file_path).unwrap();
                         let response = Response::from_file(file).with_header(
                             tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"image/jpeg"[..]).unwrap()
                         );
                         let _ = request.respond(response);
                    } else {
                         let _ = request.respond(Response::from_string("Not Found").with_status_code(404));
                    }
                } else {
                     let _ = request.respond(Response::from_string("Not Found").with_status_code(404));
                }
            });
        }
    });
}

#[command]
fn start_preview<R: Runtime>(app: AppHandle<R>, process_state: State<PreviewProcess>, preview_state: State<Arc<PreviewState>>) -> Result<(), String> {
    let mut preview_guard = process_state.0.lock().map_err(|e| e.to_string())?;
    
    if let Some(mut child) = preview_guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }

    let mut child = spawn_preview_process(&app)?;
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
    
    // Start reading thread
    let state_clone = preview_state.inner().clone();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        let mut buffer = Vec::new();
        for byte in reader.bytes() {
            match byte {
                Ok(b) => {
                    buffer.push(b);
                    if buffer.ends_with(&[0xff, 0xd9]) {
                        // Found a frame
                        let (lock, cvar) = (&state_clone.current_frame, &state_clone.frame_cond);
                        let mut frame = lock.lock().unwrap();
                        *frame = buffer.clone();
                        cvar.notify_all();
                        
                        buffer.clear();
                    }
                }
                Err(_) => break,
            }
        }
    });

    *preview_guard = Some(child);
    Ok(())
}

#[command]
fn capture_image<R: Runtime>(app: AppHandle<R>, process_state: State<PreviewProcess>, preview_state: State<Arc<PreviewState>>) -> Result<String, String> {
    println!("Capture command received");
    
    // 1. Stop Preview
    {
        let mut preview_guard = process_state.0.lock().map_err(|e| e.to_string())?;
        if let Some(mut child) = preview_guard.take() {
            println!("Stopping preview for capture...");
            let _ = child.kill();
            let _ = child.wait();
            println!("Preview stopped.");
        }
    }

    // Save to "photos" directory
    let save_dir = PathBuf::from("photos");
    if !save_dir.exists() {
        fs::create_dir_all(&save_dir).map_err(|e| e.to_string())?;
    }

    let now = Local::now();
    let filename = format!("IMG_{}.jpg", now.format("%Y%m%d_%H%M%S"));
    let file_path = save_dir.join(&filename);
    let file_path_str = file_path.to_string_lossy().to_string();
    
    println!("Attempting to capture to: {}", file_path_str);

    let output = Command::new("rpicam-still")
        .args(&[
            "-o", &file_path_str,
            "--width", "5472",
            "--height", "3648",
            "-q", "100",
            "--immediate"
        ])
        .output()
        .map_err(|e| e.to_string())?;
        
    let result = if output.status.success() {
        let msg = format!("Image saved to: {}", fs::canonicalize(&file_path).unwrap_or(file_path).display());
        println!("Success: {}", msg);
        Ok(msg)
    } else {
        let err_msg = String::from_utf8_lossy(&output.stderr).to_string();
        println!("Error capturing image: {}", err_msg);
        Err(err_msg)
    };

    // 3. Restart Preview
    println!("Restarting preview...");
    
    match spawn_preview_process(&app) {
        Ok(mut child) => {
             if let Some(stdout) = child.stdout.take() {
                let state_clone = preview_state.inner().clone();
                thread::spawn(move || {
                    let reader = BufReader::new(stdout);
                    let mut buffer = Vec::new();
                    for byte in reader.bytes() {
                        match byte {
                            Ok(b) => {
                                buffer.push(b);
                                if buffer.ends_with(&[0xff, 0xd9]) {
                                    let (lock, cvar) = (&state_clone.current_frame, &state_clone.frame_cond);
                                    let mut frame = lock.lock().unwrap();
                                    *frame = buffer.clone();
                                    cvar.notify_all();
                                    buffer.clear();
                                }
                            }
                            Err(_) => break,
                        }
                    }
                });
             }
             
             let mut preview_guard = process_state.0.lock().map_err(|e| e.to_string())?;
             *preview_guard = Some(child);
             println!("Preview restarted.");
        }
        Err(e) => {
            println!("Failed to restart preview: {}", e);
        }
    }

    result
}

#[command]
fn get_photos() -> Result<Vec<String>, String> {
    let save_dir = PathBuf::from("photos");
    if !save_dir.exists() {
        return Ok(Vec::new());
    }

    let mut entries = fs::read_dir(save_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|res| res.ok())
        .map(|dir_entry| dir_entry.path())
        .filter(|path| path.extension().map_or(false, |ext| ext == "jpg"))
        .collect::<Vec<_>>();

    // Sort by modified time (descending)
    entries.sort_by(|a, b| {
        let meta_a = fs::metadata(a).ok();
        let meta_b = fs::metadata(b).ok();
        let time_a = meta_a.and_then(|m| m.modified().ok());
        let time_b = meta_b.and_then(|m| m.modified().ok());
        time_b.cmp(&time_a)
    });

    let filenames = entries.iter()
        .filter_map(|path| path.file_name())
        .filter_map(|name| name.to_str())
        .map(|s| s.to_string())
        .collect();

    Ok(filenames)
}

#[command]
fn get_photo_content(filename: String) -> Result<String, String> {
    let save_dir = PathBuf::from("photos");
    let file_path = save_dir.join(filename);
    
    let buffer = fs::read(file_path).map_err(|e| e.to_string())?;
    let base64_str = general_purpose::STANDARD.encode(&buffer);
    Ok(base64_str)
}

pub fn run() {
    let preview_state = Arc::new(PreviewState {
        current_frame: Arc::new(Mutex::new(Vec::new())),
        frame_cond: Arc::new(Condvar::new()),
    });

    start_http_server(preview_state.clone());

    tauri::Builder::default()
        .manage(PreviewProcess(Arc::new(Mutex::new(None))))
        .manage(preview_state)
        .invoke_handler(tauri::generate_handler![start_preview, capture_image, get_photos, get_photo_content])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
