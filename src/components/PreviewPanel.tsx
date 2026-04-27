import { useState, useEffect } from 'react';
import * as THREE from 'three';
import LithopaneScene from '../three/LithopaneScene';
import { exportSTL } from '../three/stlExport';
import type { ProcessingState } from '../types';
import type { LithopaneGeometry } from '../three/LithopaneMesh';
import HeightmapPreview from './HeightmapPreview';

interface Props {
  lithoGeo: LithopaneGeometry | null;
  maxThickness: number;
  baseLayerHeightMm: number;
  layerHeightMm: number;
  lightIntensity: number;
  absorptionCoefficient: number;
  processingState: ProcessingState;
  showHeightmap: boolean;
  heightmapData: { heightmap: Float32Array; resolution: number } | null;
  onExport: () => void;
}

export default function PreviewPanel({
  lithoGeo,
  maxThickness,
  baseLayerHeightMm,
  layerHeightMm,
  lightIntensity,
  absorptionCoefficient,
  processingState,
  showHeightmap,
  heightmapData,
  onExport,
}: Props) {
  const handleExport = () => {
    onExport();
  };

  const [errorDismissed, setErrorDismissed] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showNotches, setShowNotches] = useState(false);

  // Reset dismiss when a new status arrives
  useEffect(() => {
    if (processingState.status !== 'error') setErrorDismissed(false);
  }, [processingState.status]);

  return (
    <div className="preview-panel">
      {showHeightmap && heightmapData ? (
        <HeightmapPreview heightmap={heightmapData.heightmap} resolution={heightmapData.resolution} heatmap={true} />
      ) : (
        <LithopaneScene lithoGeo={lithoGeo} maxThickness={maxThickness} baseLayerHeightMm={baseLayerHeightMm} layerHeightMm={layerHeightMm} lightIntensity={lightIntensity} absorptionCoefficient={absorptionCoefficient} showNotches={showNotches} />
      )}

      {processingState.status !== 'idle' && processingState.status !== 'done' &&
        !(processingState.status === 'error' && errorDismissed) && (
        <div style={{
          position: 'absolute', top: 12, left: 12, right: 12,
        }}>
          <div style={{ fontSize: 12, color: '#e94560', marginBottom: 4, display: 'flex', alignItems: 'center' }}>
            <span style={{ flex: 1 }}>
              {processingState.status === 'processing' && 'Processing image...'}
              {processingState.status === 'removing-bg' && 'Removing background...'}
              {processingState.status === 'generating-mesh' && 'Generating mesh...'}
              {processingState.status === 'error' && `Error: ${processingState.error}`}
            </span>
            {processingState.status === 'error' && (
              <button
                onClick={() => setErrorDismissed(true)}
                style={{ background: 'none', border: 'none', color: '#e94560', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}
              >
                ✕
              </button>
            )}
          </div>
          {processingState.progress > 0 && processingState.progress < 1 && (
            <div className="progress-bar">
              <div
                className="progress-bar__fill"
                style={{ width: `${processingState.progress * 100}%` }}
              />
            </div>
          )}
        </div>
      )}

      <div className="preview-panel__toolbar">
        <span className="preview-panel__status">
          {lithoGeo
            ? `${(lithoGeo.body.attributes.position.count).toLocaleString()} vertices`
            : 'Waiting for image...'}
          {' · '}
          <a href="https://github.com/parttimenerd/lithopainter" target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        </span>
        <label className="preview-panel__toggle">
          <input
            type="checkbox"
            checked={showNotches}
            onChange={(e) => setShowNotches(e.target.checked)}
          />
          Notches
        </label>
        <button
          className="btn btn--primary"
          onClick={handleExport}
          disabled={!lithoGeo || (processingState.status !== 'idle' && processingState.status !== 'done')}
        >
          ⬇ Export STL
        </button>
        <button
          className="btn btn--sm"
          onClick={() => setShowShortcuts(!showShortcuts)}
          title="Keyboard shortcuts"
        >
          ?
        </button>
      </div>
      {showShortcuts && (
        <div className="shortcuts-legend">
          <div><kbd>⌘/Ctrl+E</kbd> Export STL</div>
          <div><kbd>⌘/Ctrl+Z</kbd> Undo</div>
          <div><kbd>⌘/Ctrl+Shift+Z</kbd> Redo</div>
          <div><kbd>R</kbd> Reset adjustments</div>
          <div><kbd>M</kbd> Toggle mirror</div>
          <div><kbd>B</kbd> Toggle BG removal</div>
          <div><kbd>1</kbd> / <kbd>2</kbd> Webcam / Upload</div>
          <div><kbd>Space</kbd> Freeze / unfreeze</div>
          <div><kbd>F</kbd> Detect face</div>
          <div><kbd>T</kbd> / <kbd>Shift+T</kbd> Track face</div>
          <div><kbd>Scroll</kbd> Resize crop circle</div>
        </div>
      )}
    </div>
  );
}
