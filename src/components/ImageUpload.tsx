import { useRef, useState, useCallback, useEffect, type DragEvent } from 'react';
import { useCircleCrop } from '../hooks/useCircleCrop';
import CircleCropOverlay from './CircleCropOverlay';

interface Props {
  onImageReady: (canvas: HTMLCanvasElement) => void;
  onImageReadyWithBg: (canvas: HTMLCanvasElement) => void;
  crop: ReturnType<typeof useCircleCrop>;
}

export default function ImageUpload({ onImageReady, onImageReadyWithBg, crop }: Props) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const imageUrlRef = useRef<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const imgRef = useRef<HTMLImageElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadedImgRef = useRef<HTMLImageElement | null>(null);
  const [imageAR, setImageAR] = useState(1);

  const triggerGenerate = useCallback(() => {
    const img = loadedImgRef.current;
    if (!img || !img.complete || img.naturalWidth === 0) return;
    const cropped = crop.extractCircle(img);
    onImageReady(cropped);
  }, [crop, onImageReady]);

  const triggerGenerateWithBg = useCallback(() => {
    const img = loadedImgRef.current;
    if (!img || !img.complete || img.naturalWidth === 0) return;
    // Pass FULL image — bg removal needs the whole image, cropping happens after
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = img.naturalWidth;
    fullCanvas.height = img.naturalHeight;
    const ctx = fullCanvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    onImageReadyWithBg(fullCanvas);
  }, [onImageReadyWithBg]);

  const loadImage = useCallback(
    (src: string) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        loadedImgRef.current = img;
        // Revoke old object URL if any
        if (imageUrlRef.current && imageUrlRef.current.startsWith('blob:')) URL.revokeObjectURL(imageUrlRef.current);
        imageUrlRef.current = src;
        setImageUrl(src);
        setImageAR(img.naturalWidth / img.naturalHeight);
        // Auto-generate on first load
        const cropped = crop.extractCircle(img);
        onImageReady(cropped);
      };
      img.onerror = () => {
        // Retry without crossOrigin for same-origin URLs
        const img2 = new Image();
        img2.onload = () => {
          loadedImgRef.current = img2;
          setImageUrl(src);
          setImageAR(img2.naturalWidth / img2.naturalHeight);
          const cropped = crop.extractCircle(img2);
          onImageReady(cropped);
        };
        img2.src = src;
      };
      img.src = src;
    },
    [crop, onImageReady]
  );

  const handleFile = useCallback(
    (file: File) => {
      const url = URL.createObjectURL(file);
      loadImage(url);
    },
    [loadImage]
  );

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('image/')) {
      handleFile(file);
    }
  };

  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) handleFile(file);
        }
      }
    },
    [handleFile]
  );

  // Listen for paste events
  useEffect(() => {
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  const handleUrlLoad = () => {
    if (urlInput.trim()) {
      loadImage(urlInput.trim());
    }
  };

  // Re-extract when crop changes
  const handleCropChange = () => {
    const img = loadedImgRef.current;
    if (img && img.complete && img.naturalWidth > 0 && imageUrl) {
      const cropped = crop.extractCircle(img);
      onImageReady(cropped);
    }
  };

  return (
    <div className="image-upload">
      <div
        className={`image-upload__dropzone ${dragging ? 'image-upload__dropzone--active' : ''} ${imageUrl ? 'image-upload__dropzone--has-image' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => !imageUrl && fileInputRef.current?.click()}
      >
        {imageUrl ? (
          <>
            <img
              ref={imgRef}
              src={imageUrl}
              alt="Source"
              onLoad={handleCropChange}
            />
            <CircleCropOverlay
              crop={crop.crop}
              sourceAspectRatio={imageAR}
              onPointerDown={crop.onPointerDown}
              onPointerMove={crop.onPointerMove}
              onPointerUp={crop.onPointerUp}
            />
          </>
        ) : (
          <>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📁</div>
            <div style={{ fontSize: 14, color: '#888' }}>
              Drop image here, click to browse, or paste
            </div>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>

      <div className="image-upload__url">
        <input
          type="text"
          placeholder="Or enter image URL..."
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleUrlLoad()}
        />
        <button className="btn btn--sm" onClick={handleUrlLoad}>
          Load
        </button>
        {imageUrl && (
          <>
            <button className="btn btn--sm btn--primary" onClick={triggerGenerate}>
              ⟳ Generate
            </button>
            <button className="btn btn--sm btn--accent" onClick={triggerGenerateWithBg}>
              ✂ Remove BG
            </button>
            <button
              className="btn btn--sm"
              onClick={() => {
                if (imageUrlRef.current && imageUrlRef.current.startsWith('blob:')) URL.revokeObjectURL(imageUrlRef.current);
                imageUrlRef.current = null;
                setImageUrl(null);
                setUrlInput('');
                loadedImgRef.current = null;
              }}
            >
              Clear
            </button>
          </>
        )}
      </div>
    </div>
  );
}
