import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './App.css';

function App() {
  const [imageSrc, setImageSrc] = useState<string>();

  useEffect(() => {
    const init = async () => {
      try {
        await invoke('start_preview');
        const unlisten = await listen('preview-frame', (event) => {
          setImageSrc(`data:image/jpeg;base64,${event.payload}`);
        });
        return () => {
          unlisten();
        };
      } catch (e) {
        console.error(e);
      }
    };

    const cleanUp = init();

    return () => {
      cleanUp.then(f => f && f());
    };
  }, []);

  const capture = () => {
    invoke('capture_image').catch(console.error);
  };

  return (
    <div className="container">
      <h1>RPi Camera Preview</h1>
      <img src={imageSrc} alt="preview" />
      <button onClick={capture}>Capture</button>
    </div>
  );
}

export default App;