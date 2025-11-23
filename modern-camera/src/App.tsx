import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<"rpi" | "web">("web");
  const [isStreaming, setIsStreaming] = useState(false); // web 模式流状态
  const [error, setError] = useState<string>("");
  const [stream, setStream] = useState<MediaStream | null>(null);

  // rpicam 模式状态
  const [isPreview, setIsPreview] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [saveDir, setSaveDir] = useState<string>("");
  const [gallery, setGallery] = useState<string[]>([]);
  const openerRef = useRef<null | ((target: string) => Promise<void>)>(null);

  const startCamera = async () => {
    try {
      setError("");
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          facingMode: { ideal: "environment" }
        },
        audio: false
      });

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        setStream(mediaStream);
        setIsStreaming(true);
        const v = videoRef.current;
        const tryPlay = async () => {
          try {
            await v.play();
          } catch (e) {
            console.warn("自动播放失败，等待元数据加载后重试", e);
          }
        };
        v.addEventListener("loadedmetadata", () => {
          tryPlay();
        }, { once: true });
        tryPlay();
      }
    } catch (err) {
      console.error("摄像头访问失败:", err);
      setError("无法访问摄像头，请检查权限设置");
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    if (videoRef.current) {
      try { videoRef.current.pause(); } catch {}
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
  };

  const capturePhotoWeb = () => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      
      if (context) {
        context.drawImage(videoRef.current, 0, 0);
        
        // 创建下载链接
        canvas.toBlob((blob) => {
          if (blob) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `photo_${new Date().getTime()}.jpg`;
            a.click();
            URL.revokeObjectURL(url);
          }
        }, 'image/jpeg', 0.9);
      }
    }
  };

  // ===== rpicam 模式相关逻辑 =====
  const startPreview = async () => {
    try {
      await invoke("start_preview");
      setIsPreview(true);
    } catch (e) {
      console.error(e);
      setError("启动 rpicam 预览失败");
    }
  };

  const stopPreview = async () => {
    try {
      await invoke("stop_preview");
      setIsPreview(false);
    } catch (e) {
      console.error(e);
    }
  };

  const captureStill = async () => {
    try {
      const path = await invoke<string>("capture_still", { dir: saveDir || undefined });
      setGallery((g) => [path, ...g]);
    } catch (e) {
      console.error(e);
      setError("拍照失败，请检查 rpicam-still 是否可用 " + e);
    }
  };

  const startVideo = async () => {
    try {
      const path = await invoke<string>("start_video", { dir: saveDir || undefined });
      setIsRecording(true);
      setGallery((g) => [path, ...g]);
    } catch (e) {
      console.error(e);
      setError("启动录像失败，请检查 rpicam-vid 是否可用");
    }
  };

  const stopVideo = async () => {
    try {
      await invoke("stop_video");
      setIsRecording(false);
    } catch (e) {
      console.error(e);
    }
  };

  const refreshGallery = async () => {
    try {
      const files = await invoke<string[]>("list_media", { dir: saveDir || undefined });
      setGallery(files);
    } catch (e) {
      // ignore errors in non-rpi environment
    }
  };

  useEffect(() => {
    // 尝试动态加载 opener 插件（仅在 Tauri 原生可用）
    (async () => {
      try {
        const mod: any = await import("@tauri-apps/plugin-opener");
        if (mod && typeof mod.open === "function") {
          openerRef.current = mod.open as (t: string) => Promise<void>;
        }
      } catch {
        // 在纯 Web 环境会失败，忽略即可
      }
    })();

    // 组件挂载时：优先使用 rpicam；不可用则回退到浏览器摄像头
    (async () => {
      try {
        const available = await invoke<boolean>("check_rpicam");
        if (available) {
          setMode("rpi");
          await refreshGallery();
        } else {
          setMode("web");
          startCamera();
        }
      } catch (e) {
        setMode("web");
        startCamera();
      }
    })();

    // 清理函数
    return () => {
      if (mode === "web") {
        stopCamera();
      } else {
        if (isPreview) void stopPreview();
        if (isRecording) void stopVideo();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="camera-app">
      {error && (
        <div className="error-message">
          {error}
          {mode === "web" && (
            <button onClick={startCamera} className="retry-button">重试</button>
          )}
        </div>
      )}

      {mode === "web" && (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="camera-video"
          />
          {isStreaming && (
            <div className="camera-controls">
              <button onClick={capturePhotoWeb} className="capture-button">📷</button>
              <button onClick={stopCamera} className="stop-button">⏹️</button>
            </div>
          )}
          {!isStreaming && !error && (
            <div className="start-screen">
              <button onClick={startCamera} className="start-button">启动摄像头</button>
            </div>
          )}
        </>
      )}

      {mode === "rpi" && (
        <>
          {/* rpicam 预览不会在此 <video> 展示，它会打开系统窗口 */}
          <div className="rpi-banner">rpicam 模式：预览将显示在系统窗口</div>
          <div className="camera-controls">
            {!isPreview && (
              <button onClick={startPreview} className="start-button">启动预览</button>
            )}
            {isPreview && (
              <button onClick={stopPreview} className="stop-button">停止预览</button>
            )}
            <button onClick={captureStill} className="capture-button">📷</button>
            {!isRecording && (
              <button onClick={startVideo} className="start-button">⏺️ 录像</button>
            )}
            {isRecording && (
              <button onClick={stopVideo} className="stop-button">⏹️ 停止</button>
            )}
          </div>

          <div className="gallery">
            <div className="gallery-header">
              <span>媒体库</span>
              <button className="refresh-button" onClick={refreshGallery}>刷新</button>
            </div>
            <div className="gallery-list">
              {gallery.length === 0 && <div className="gallery-empty">暂无文件</div>}
              {gallery.map((p) => {
                const name = p.split("/").pop() || p;
                return (
                  <button
                    key={p}
                    className="gallery-item"
                    onClick={async () => {
                      if (openerRef.current) {
                        await openerRef.current(p);
                      }
                    }}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default App;
