import type { SourceMode } from '../types';

import WebcamView from './WebcamView';
import ImageUpload from './ImageUpload';
import ControlPanel from './ControlPanel';
import type { LithopaneConfig } from '../types';
import type { useCircleCrop } from '../hooks/useCircleCrop';

interface Props {
  mode: SourceMode;
  setMode: (m: SourceMode) => void;
  config: LithopaneConfig;
  setConfig: (c: LithopaneConfig) => void;
  crop: ReturnType<typeof useCircleCrop>;
  onFrame: (canvas: HTMLCanvasElement) => void;
  onCapture: (canvas: HTMLCanvasElement) => void;
  onCaptureWithBg: (canvas: HTMLCanvasElement) => void;
  frozen: boolean;
  setFrozen: (v: boolean) => void;
}

export default function SourcePanel({
  mode,
  setMode,
  config,
  setConfig,
  crop,
  onFrame,
  onCapture,
  onCaptureWithBg,
  frozen,
  setFrozen,
}: Props) {
  return (
    <div className="source-panel">
      <div className="source-panel__header">
        <button
          className={`source-panel__tab ${mode === 'webcam' ? 'source-panel__tab--active' : ''}`}
          onClick={() => setMode('webcam')}
        >
          📷 Webcam
        </button>
        <button
          className={`source-panel__tab ${mode === 'upload' ? 'source-panel__tab--active' : ''}`}
          onClick={() => setMode('upload')}
        >
          📁 Upload
        </button>
      </div>

      <div className="source-panel__content">
        {mode === 'webcam' ? (
          <WebcamView
            onFrame={onFrame}
            onCapture={onCapture}
            onCaptureWithBg={onCaptureWithBg}
            crop={crop}
            frozen={frozen}
            setFrozen={setFrozen}
            continuousMode={config.continuousMode}
          />
        ) : (
          <ImageUpload
            onImageReady={onCapture}
            onImageReadyWithBg={onCaptureWithBg}
            crop={crop}
          />
        )}
      </div>

      <ControlPanel config={config} onChange={setConfig} />
    </div>
  );
}
