import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import GalleryImageViewer from './components/GalleryImageViewer';


function App() {
  const [imageSrc, setImageSrc] = useState<string>();
  const [isTauri, setIsTauri] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // Gallery State
  const [viewMode, setViewMode] = useState<'camera' | 'gallery'>('camera');
  const [galleryPhotos, setGalleryPhotos] = useState<string[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [selectedPhotoData, setSelectedPhotoData] = useState<string | null>(null);
  const [webPhotos, setWebPhotos] = useState<{name: string, data: string}[]>([]);
  const [infoVisible, setInfoVisible] = useState(false);

  useEffect(() => {
    // Check if running in Tauri environment
    // @ts-ignore
    const tauriCheck = window.__TAURI_INTERNALS__ !== undefined;
    setIsTauri(tauriCheck);
    setIsReady(true);
  }, []);

  useEffect(() => {
    if (!isReady) return;

    if (isTauri) {
      const initTauri = async () => {
        try {
          await invoke('start_preview');
          // No longer need to listen for events, using MJPEG stream directly
        } catch (e) {
          console.error("Tauri init failed:", e);
        }
      };
      
      initTauri();
    } else {
      // Web Mode: Use Webcam
      if (videoRef.current) {
        navigator.mediaDevices.getUserMedia({ video: true })
          .then(stream => {
            if (videoRef.current) {
              videoRef.current.srcObject = stream;
            }
          })
          .catch(err => {
            console.error("Webcam access error:", err);
          });
      }
    }
  }, [isReady, isTauri]);

  useEffect(() => {
    if (viewMode === 'gallery' && isTauri) {
      invoke<string[]>('get_photos')
        .then(setGalleryPhotos)
        .catch(console.error);
    }
  }, [viewMode, isTauri]);

  useEffect(() => {
    if (selectedPhoto && isTauri && viewMode === 'gallery') {
      setSelectedPhotoData(`http://localhost:18888/photos/${selectedPhoto}`);
    } else if (selectedPhoto && !isTauri && viewMode === 'gallery') {
       const photo = webPhotos.find(p => p.name === selectedPhoto);
       if (photo) setSelectedPhotoData(photo.data);
    }
  }, [selectedPhoto, isTauri, viewMode, webPhotos]);

  const capture = () => {
    if (isTauri) {
      invoke<string>('capture_image')
        .then(msg => {
           console.log(msg);
        })
        .catch(console.error);
    } else {
      if (videoRef.current) {
        const video = videoRef.current;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 1.0); // High quality
          
          const now = new Date();
          const year = now.getFullYear();
          const month = String(now.getMonth() + 1).padStart(2, '0');
          const day = String(now.getDate()).padStart(2, '0');
          const hour = String(now.getHours()).padStart(2, '0');
          const minute = String(now.getMinutes()).padStart(2, '0');
          const second = String(now.getSeconds()).padStart(2, '0');
          const filename = `IMG_${year}${month}${day}_${hour}${minute}${second}.jpg`;

          const link = document.createElement('a');
          link.href = dataUrl;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          console.log(`Web Capture: Image saved as ${filename}`);
          setWebPhotos(prev => [{name: filename, data: dataUrl}, ...prev]);
        }
      } else {
        console.error("Web Capture: Video stream not active");
      }
    }
  };

  const handleNext = () => {
    const photos = isTauri ? galleryPhotos : webPhotos.map(p => p.name);
    if (!selectedPhoto) return;
    const idx = photos.indexOf(selectedPhoto);
    if (idx !== -1 && idx < photos.length - 1) {
      setSelectedPhoto(photos[idx + 1]);
    }
  };

  const handlePrev = () => {
    const photos = isTauri ? galleryPhotos : webPhotos.map(p => p.name);
    if (!selectedPhoto) return;
    const idx = photos.indexOf(selectedPhoto);
    if (idx !== -1 && idx > 0) {
      setSelectedPhoto(photos[idx - 1]);
    }
  };

  if (!isReady) return <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white font-sans">Initializing...</div>;

  return (
    <div className="flex w-screen h-screen bg-neutral-900">
      {/* Left Side: Camera Preview or Gallery Image */}
      <div className="flex-1 flex items-center justify-center p-5 bg-black overflow-hidden">
        <div className="aspect-[3/2] w-full h-auto max-h-full max-w-full relative bg-black border border-neutral-800 shadow-2xl flex items-center justify-center">
          {viewMode === 'camera' ? (
            isTauri ? (
              // Use MJPEG Stream from local server
              <img 
                className="w-full h-full object-contain block" 
                src="http://localhost:18888/stream" 
                alt="preview" 
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  setTimeout(() => {
                    target.src = "http://localhost:18888/stream?t=" + new Date().getTime();
                  }, 1000);
                }}
              />
            ) : (
              <video 
                className="w-full h-full object-contain block" 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted 
              />
            )
          ) : (
            // Gallery View
            selectedPhotoData ? (
              <>
                  <GalleryImageViewer 
                    src={selectedPhotoData} 
                    alt={selectedPhoto || "Photo"} 
                    onNext={handleNext}
                    onPrev={handlePrev}
                    onInfo={() => setInfoVisible(true)}
                  />
                  {infoVisible && (
                      <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setInfoVisible(false)}>
                        <div className="bg-neutral-800 p-6 rounded-xl border border-neutral-700 shadow-2xl max-w-xs w-full mx-4" onClick={e => e.stopPropagation()}>
                          <h3 className="text-lg font-bold text-white mb-4 border-b border-neutral-700 pb-2">Image Info</h3>
                          <div className="space-y-2 text-sm text-gray-300">
                            <p><span className="text-gray-500 block text-xs uppercase tracking-wider">Filename</span> {selectedPhoto}</p>
                            {selectedPhoto && selectedPhoto.match(/IMG_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/) && (() => {
                               const m = selectedPhoto.match(/IMG_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
                               if (!m) return null;
                               return (
                                 <p><span className="text-gray-500 block text-xs uppercase tracking-wider">Date Taken</span> {`${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`}</p>
                               );
                            })()}
                          </div>
                          <button className="mt-6 w-full py-2 bg-neutral-700 hover:bg-neutral-600 text-white rounded-lg transition-colors" onClick={() => setInfoVisible(false)}>
                            Close
                          </button>
                        </div>
                      </div>
                    )}
              </>
            ) : (
              <div className="text-white text-xl">Select a photo from the list</div>
            )
          )}
        </div>
      </div>

      {/* Right Side: Toolbar */}
      <div className="w-[250px] bg-neutral-800 border-l border-neutral-700 flex flex-col items-center p-5 shrink-0">
        <h3 className="mt-0 mb-5 text-lg text-gray-300 uppercase tracking-widest">{viewMode === 'camera' ? 'Controls' : 'Gallery'}</h3>
        
        {viewMode === 'camera' ? (
          <div className="w-full flex flex-col items-center gap-5">
            <button 
              className="w-20 h-20 rounded-full bg-white border-4 border-neutral-600 cursor-pointer transition-all duration-200 active:scale-95 active:bg-gray-200 hover:border-neutral-500 hover:shadow-[0_0_10px_rgba(255,255,255,0.2)] outline-none"
              onClick={capture} 
              title="Capture Photo"
            ></button>
            <button
               className="mt-10 px-6 py-2 bg-neutral-700 text-white rounded hover:bg-neutral-600 transition-colors"
               onClick={() => setViewMode('gallery')}
            >
              View Photos
            </button>
          </div>
        ) : (
          <div className="w-full flex flex-col h-full">
            <button
               className="mb-5 px-6 py-2 bg-neutral-700 text-white rounded hover:bg-neutral-600 transition-colors shrink-0"
               onClick={() => {
                 setViewMode('camera');
                 setSelectedPhoto(null);
                 setSelectedPhotoData(null);
                 setInfoVisible(false);
               }}
            >
              Back to Camera
            </button>
            <div className="flex-1 overflow-y-auto w-full pr-2 space-y-2 custom-scrollbar">
              {(isTauri ? galleryPhotos : webPhotos.map(p => p.name)).map(name => (
                <button
                  key={name}
                  onClick={() => {
                      setSelectedPhoto(name);
                      setInfoVisible(false); // Hide info when selecting new photo
                  }}
                  className={`w-full text-left px-3 py-2 rounded text-sm truncate ${
                    selectedPhoto === name 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-neutral-700 text-gray-300 hover:bg-neutral-600'
                  }`}
                  title={name}
                >
                  {name}
                </button>
              ))}
              {(isTauri ? galleryPhotos : webPhotos).length === 0 && (
                <div className="text-gray-500 text-center text-sm mt-10">No photos found</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
