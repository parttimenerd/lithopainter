import type { LithopaneConfig } from '../types';

interface Props {
  config: LithopaneConfig;
  onChange: (config: LithopaneConfig) => void;
}

export default function ControlPanel({ config, onChange }: Props) {
  const set = <K extends keyof LithopaneConfig>(key: K, value: LithopaneConfig[K]) => {
    onChange({ ...config, [key]: value });
  };

  return (
    <div className="control-panel">
      <div className="control-panel__group">
        <label>Brightness: {config.brightness > 0 ? '+' : ''}{config.brightness.toFixed(2)}</label>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.05}
          value={config.brightness}
          onChange={(e) => set('brightness', +e.target.value)}
        />
      </div>

      <div className="control-panel__group">
        <label>Contrast: {config.contrast > 0 ? '+' : ''}{config.contrast.toFixed(2)}</label>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.05}
          value={config.contrast}
          onChange={(e) => set('contrast', +e.target.value)}
        />
      </div>

      <div className="control-panel__group">
        <label>Gamma: {config.gamma.toFixed(2)}</label>
        <input
          type="range"
          min={0.2}
          max={5.0}
          step={0.05}
          value={config.gamma}
          onChange={(e) => set('gamma', +e.target.value)}
        />
      </div>

      <div className="control-panel__group">
        <label>Shadows: {config.shadows > 0 ? '+' : ''}{config.shadows.toFixed(2)}</label>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.05}
          value={config.shadows}
          onChange={(e) => set('shadows', +e.target.value)}
        />
      </div>

      <div className="control-panel__group">
        <label>Highlights: {config.highlights > 0 ? '+' : ''}{config.highlights.toFixed(2)}</label>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.05}
          value={config.highlights}
          onChange={(e) => set('highlights', +e.target.value)}
        />
      </div>

      <div className="control-panel__group">
        <label>Edge Enhance: {config.edgeEnhance.toFixed(1)}</label>
        <input
          type="range"
          min={0}
          max={3}
          step={0.1}
          value={config.edgeEnhance}
          onChange={(e) => set('edgeEnhance', +e.target.value)}
        />
      </div>

      <div className="control-panel__group">
        <label>Local Contrast: {config.localContrast.toFixed(1)}</label>
        <input
          type="range"
          min={0}
          max={2}
          step={0.1}
          value={config.localContrast}
          onChange={(e) => set('localContrast', +e.target.value)}
        />
      </div>

      <div className="control-panel__group">
        <label>Edge Feather: {config.edgeFeather.toFixed(2)}</label>
        <input
          type="range"
          min={0}
          max={0.5}
          step={0.01}
          value={config.edgeFeather}
          onChange={(e) => set('edgeFeather', +e.target.value)}
        />
      </div>

      <div className="control-panel__group">
        <label className="toggle">
          <input
            type="checkbox"
            checked={config.autoLevels}
            onChange={(e) => set('autoLevels', e.target.checked)}
          />
          Auto Levels
        </label>
      </div>

      <div className="control-panel__group">
        <label className="toggle">
          <input
            type="checkbox"
            checked={config.mirror}
            onChange={(e) => set('mirror', e.target.checked)}
          />
          Mirror Image
        </label>
      </div>

      <div className="control-panel__group">
        <label className="toggle">
          <input
            type="checkbox"
            checked={config.backgroundRemoval}
            onChange={(e) => set('backgroundRemoval', e.target.checked)}
          />
          BG Removal
        </label>
      </div>

      <div className="control-panel__group">
        <label>BG Model</label>
        <select
          value={config.bgModel}
          onChange={(e) => set('bgModel', e.target.value as LithopaneConfig['bgModel'])}
          disabled={!config.backgroundRemoval}
        >
          <option value="u2netp">U2NetP (fast, 4MB)</option>
          <option value="u2net">U2Net (accurate, 176MB)</option>
          <option value="isnet_general_use">ISNet General</option>
          <option value="isnet_anime">ISNet Anime</option>
          <option value="silueta">Silueta</option>
          <option value="u2net_human_seg">U2Net Human Seg</option>
        </select>
      </div>

      <div className="control-panel__group">
        <label className="toggle">
          <input
            type="checkbox"
            checked={config.continuousMode}
            onChange={(e) => set('continuousMode', e.target.checked)}
          />
          Live Mode
        </label>
      </div>

      <div className="control-panel__group">
        <label>Layers: {config.numLayers}</label>
        <input
          type="range"
          min={1}
          max={8}
          value={config.numLayers}
          onChange={(e) => set('numLayers', +e.target.value)}
        />
      </div>

      <div className="control-panel__group">
        <label>Nozzle Width (mm)</label>
        <input
          type="number"
          min={0.2}
          max={1.0}
          step={0.1}
          value={config.nozzleWidthMm}
          onChange={(e) => set('nozzleWidthMm', +e.target.value)}
        />
      </div>

      <div className="control-panel__group">
        <label>Notches: {config.numNotches}</label>
        <input
          type="range"
          min={0}
          max={6}
          value={config.numNotches}
          onChange={(e) => set('numNotches', +e.target.value)}
        />
      </div>

      <div className="control-panel__group">
        <label>Notch Radius (mm)</label>
        <input
          type="number"
          min={0.5}
          max={5}
          step={0.5}
          value={config.notchRadiusMm}
          onChange={(e) => set('notchRadiusMm', +e.target.value)}
        />
      </div>

      <div className="control-panel__group">
        <label>Notch Height (mm)</label>
        <input
          type="number"
          min={0.5}
          max={10}
          step={0.5}
          value={config.notchHeightMm}
          onChange={(e) => set('notchHeightMm', +e.target.value)}
        />
      </div>

      <div className="control-panel__group">
        <label>Diameter (mm)</label>
        <input
          type="number"
          min={10}
          max={200}
          step={5}
          value={config.diameterMm}
          onChange={(e) => set('diameterMm', +e.target.value)}
        />
      </div>

      <div className="control-panel__group">
        <label>Layer Height (mm)</label>
        <input
          type="number"
          min={0.1}
          max={0.5}
          step={0.01}
          value={config.layerHeightMm}
          onChange={(e) => set('layerHeightMm', +e.target.value)}
        />
      </div>

      <div className="control-panel__group">
        <label>Initial Layer (mm): {config.baseLayerHeightMm === 0 ? `auto (${config.layerHeightMm})` : config.baseLayerHeightMm}</label>
        <input
          type="number"
          min={0}
          max={1.0}
          step={0.01}
          value={config.baseLayerHeightMm}
          onChange={(e) => set('baseLayerHeightMm', +e.target.value)}
        />
      </div>
    </div>
  );
}
