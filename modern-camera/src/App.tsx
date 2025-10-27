import { useState, useEffect, useRef } from "react";
import "./App.css";

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string>("");
  const [stream, setStream] = useState<MediaStream | null>(null);

  const startCamera = async () => {
    try {
      setError("");
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          facingMode: "environment" // 优先使用后置摄像头
        },
        audio: false
      });

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        setStream(mediaStream);
        setIsStreaming(true);
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
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
  };

  const capturePhoto = () => {
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

  useEffect(() => {
    // 组件挂载时自动启动摄像头
    startCamera();

    // 清理函数
    return () => {
      stopCamera();
    };
  }, []);

  return (
    <div className="camera-app">
      {error && (
        <div className="error-message">
          {error}
          <button onClick={startCamera} className="retry-button">
            重试
          </button>
        </div>
      )}
      
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="camera-video"
      />
      
      {isStreaming && (
        <div className="camera-controls">
          <button onClick={capturePhoto} className="capture-button">
            📷
          </button>
          <button onClick={stopCamera} className="stop-button">
            ⏹️
          </button>
        </div>
      )}
      
      {!isStreaming && !error && (
        <div className="start-screen">
          <button onClick={startCamera} className="start-button">
            启动摄像头
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
