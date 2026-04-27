import * as THREE from 'three';
import LithopaneScene from '../three/LithopaneScene';
import { exportSTL } from '../three/stlExport';
import type { ProcessingState } from '../types';

interface Props {
  geometry: THREE.BufferGeometry | null;
  maxThickness: number;
  layerHeightMm: number;
  processingState: ProcessingState;
}

export default function PreviewPanel({
  geometry,
  maxThickness,
  layerHeightMm,
  processingState,
}: Props) {
  const handleExport = () => {
    if (geometry) exportSTL(geometry);
  };

  return (
    <div className="preview-panel">
      <LithopaneScene geometry={geometry} maxThickness={maxThickness} layerHeightMm={layerHeightMm} />

      {processingState.status !== 'idle' && processingState.status !== 'done' && (
        <div style={{
          position: 'absolute', top: 12, left: 12, right: 12,
        }}>
          <div style={{ fontSize: 12, color: '#e94560', marginBottom: 4 }}>
            {processingState.status === 'processing' && 'Processing image...'}
            {processingState.status === 'removing-bg' && 'Removing background...'}
            {processingState.status === 'generating-mesh' && 'Generating mesh...'}
            {processingState.status === 'error' && `Error: ${processingState.error}`}
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
          {geometry
            ? `${(geometry.attributes.position.count).toLocaleString()} vertices`
            : 'Waiting for image...'}
          {' · '}
          <a href="https://github.com/parttimenerd/lithopainter" target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        </span>
        <button
          className="btn btn--primary"
          onClick={handleExport}
          disabled={!geometry}
        >
          ⬇ Export STL
        </button>
      </div>
    </div>
  );
}
