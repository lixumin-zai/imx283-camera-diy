import { useState, useEffect, useRef } from 'react';
import { useGesture } from '@use-gesture/react';

interface GalleryImageViewerProps {
  src: string;
  alt: string;
  onNext: () => void;
  onPrev: () => void;
  onInfo: () => void;
}

const GalleryImageViewer = ({ src, alt, onNext, onPrev, onInfo }: GalleryImageViewerProps) => {
  const [style, setStyle] = useState({ x: 0, y: 0, scale: 1 });
  const imgRef = useRef<HTMLImageElement>(null);
  
  // Reset style when src changes
  useEffect(() => {
    setStyle({ x: 0, y: 0, scale: 1 });
  }, [src]);

  useGesture({
    onPinch: ({ offset: [s] }) => {
      setStyle(prev => ({ ...prev, scale: s }));
    },
    onDrag: ({ movement: [mx, my], offset: [ox, oy], active, pinching, cancel }) => {
      if (pinching) return;

      if (style.scale > 1.1) {
        // Pan logic (only if zoomed in)
        setStyle(prev => ({ ...prev, x: ox, y: oy }));
      } else {
        // Swipe logic (only if not zoomed)
        if (active) {
            // Visual feedback for swipe (horizontal only)
            setStyle(prev => ({ ...prev, x: mx, y: 0 }));
        } else {
            // Snap back
            setStyle(prev => ({ ...prev, x: 0, y: 0 }));

            // Threshold for swipe
            const threshold = 50;
            // Left swipe (mx < 0) -> Next
            if (mx < -threshold) onNext();
            // Right swipe (mx > 0) -> Prev
            else if (mx > threshold) onPrev();
            // Up swipe (my < 0) -> Info
            else if (my < -threshold) onInfo();
        }
      }
    }
  }, {
    target: imgRef,
    pinch: { scaleBounds: { min: 1, max: 4 }, modifierKey: null },
    drag: { from: () => [style.x, style.y] }
  });

  return (
    <div className="w-full h-full overflow-hidden flex items-center justify-center bg-black touch-none">
        <img 
            ref={imgRef}
            src={src} 
            alt={alt} 
            className="max-w-full max-h-full object-contain touch-none select-none"
            style={{ 
                transform: `translate(${style.x}px, ${style.y}px) scale(${style.scale})`,
                // Use hardware acceleration
                willChange: 'transform',
                // Smooth snap back when not zooming/panning
                transition: (!style.scale || style.scale === 1) ? 'transform 0.2s ease-out' : 'none',
            }}
            draggable={false}
        />
    </div>
  );
};

export default GalleryImageViewer;
