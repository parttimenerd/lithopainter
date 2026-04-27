import { useState } from 'react';
import type { LithopaneConfig } from '../types';
import { DEFAULT_CONFIG } from '../types';
import ThresholdEditor from './ThresholdEditor';

interface Props {
  config: LithopaneConfig;
  onChange: (config: LithopaneConfig) => void;
  computedThresholds?: number[];
}

function Section({ title, defaultOpen = true, onReset, children }: { title: string; defaultOpen?: boolean; onReset?: () => void; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="control-section">
      <div
        className="control-section__header"
        role="button"
        tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open); } }}
      >
        <span className={`control-section__arrow ${open ? 'control-section__arrow--open' : ''}`}>▸</span>
        {title}
        {onReset && (
          <button
            className="control-section__reset"
            title="Reset to defaults"
            onClick={(e) => { e.stopPropagation(); onReset(); }}
          >
            ↺
          </button>
        )}
      </div>
      {open && <div className="control-section__body">{children}</div>}
    </div>
  );
}

export default function ControlPanel({ config, onChange, computedThresholds }: Props) {
  const set = <K extends keyof LithopaneConfig>(key: K, value: LithopaneConfig[K]) => {
    onChange({ ...config, [key]: value });
  };

  /** Safe numeric setter — ignores NaN from empty/invalid inputs. */
  const setNum = (key: keyof LithopaneConfig, raw: string, min?: number) => {
    const v = +raw;
    if (!Number.isFinite(v)) return;
    set(key, min != null ? Math.max(v, min) : v);
  };

  const D = DEFAULT_CONFIG;

  const resetImageAdj = () => onChange({ ...config,
    brightness: D.brightness, contrast: D.contrast, gamma: D.gamma,
    shadows: D.shadows, highlights: D.highlights, edgeEnhance: D.edgeEnhance,
    localContrast: D.localContrast, edgeFeather: D.edgeFeather,
    ditherMethod: D.ditherMethod, dithering: D.dithering,
    adaptiveSegmentation: D.adaptiveSegmentation,
  });

  const resetAdvanced = () => onChange({ ...config,
    layerThresholds: D.layerThresholds, autoThresholds: D.autoThresholds,
    autoLevels: D.autoLevels, mirror: D.mirror,
  });

  const resetBg = () => onChange({ ...config,
    bgModel: D.bgModel, reserveLayerForBg: D.reserveLayerForBg,
    autoRemoveBgOnFreeze: D.autoRemoveBgOnFreeze,
  });

  const resetPrint = () => onChange({ ...config,
    diameterMm: D.diameterMm, nozzleWidthMm: D.nozzleWidthMm,
    numLayers: D.numLayers, layerHeightMm: D.layerHeightMm,
    baseLayerHeightMm: D.baseLayerHeightMm, lightIntensity: D.lightIntensity,
    absorptionCoefficient: D.absorptionCoefficient, arachneOptimize: D.arachneOptimize,
  });

  const resetNotches = () => onChange({ ...config,
    numNotches: D.numNotches, notchRadiusMm: D.notchRadiusMm, notchHeightMm: D.notchHeightMm,
  });

  return (
    <div className="control-panel">
      <Section title="Image Adjustments" onReset={resetImageAdj}>
        <div className="control-section__grid">
          <div className="control-panel__group">
            <label>Brightness: {config.brightness > 0 ? '+' : ''}{config.brightness.toFixed(2)}</label>
            <input id="slider-brightness" type="range" min={-1} max={1} step={0.05} value={config.brightness} onChange={(e) => set('brightness', +e.target.value)} />
          </div>
          <div className="control-panel__group">
            <label>Contrast: {config.contrast > 0 ? '+' : ''}{config.contrast.toFixed(2)}</label>
            <input id="slider-contrast" type="range" min={-1} max={1} step={0.05} value={config.contrast} onChange={(e) => set('contrast', +e.target.value)} />
          </div>
          <div className="control-panel__group">
            <label>Gamma: {config.gamma.toFixed(2)}</label>
            <input id="slider-gamma" type="range" min={0.2} max={5.0} step={0.05} value={config.gamma} onChange={(e) => set('gamma', +e.target.value)} />
          </div>
          <div className="control-panel__group">
            <label>Shadows: {config.shadows > 0 ? '+' : ''}{config.shadows.toFixed(2)}</label>
            <input id="slider-shadows" type="range" min={-1} max={1} step={0.05} value={config.shadows} onChange={(e) => set('shadows', +e.target.value)} />
          </div>
          <div className="control-panel__group">
            <label>Highlights: {config.highlights > 0 ? '+' : ''}{config.highlights.toFixed(2)}</label>
            <input id="slider-highlights" type="range" min={-1} max={1} step={0.05} value={config.highlights} onChange={(e) => set('highlights', +e.target.value)} />
          </div>
          <div className="control-panel__group">
            <label>Edge Enhance: {config.edgeEnhance.toFixed(1)}</label>
            <input id="slider-edge" type="range" min={0} max={10} step={0.1} value={config.edgeEnhance} onChange={(e) => set('edgeEnhance', +e.target.value)} />
          </div>
          <div className="control-panel__group">
            <label>Local Contrast: {config.localContrast.toFixed(1)}</label>
            <input id="slider-local" type="range" min={0} max={2} step={0.1} value={config.localContrast} onChange={(e) => set('localContrast', +e.target.value)} />
          </div>
          <div className="control-panel__group">
            <label>Edge Feather: {config.edgeFeather.toFixed(2)}</label>
            <input id="slider-feather" type="range" min={0} max={0.5} step={0.01} value={config.edgeFeather} onChange={(e) => set('edgeFeather', +e.target.value)} />
          </div>
          <div className="control-panel__group">
            <label>Dither Method</label>
            <select value={config.ditherMethod} onChange={(e) => set('ditherMethod', e.target.value as LithopaneConfig['ditherMethod'])}>
              <option value="bayer">Bayer (Ordered)</option>
              <option value="blue-noise">Blue Noise</option>
              <option value="floyd-steinberg">Floyd-Steinberg</option>
              <option value="atkinson">Atkinson</option>
              <option value="jarvis-judice-ninke">Jarvis-Judice-Ninke</option>
              <option value="stucki">Stucki</option>
              <option value="none">None</option>
            </select>
          </div>
          <div className="control-panel__group">
            <label>Dithering: {config.dithering.toFixed(2)}</label>
            <input id="slider-dithering" type="range" min={0} max={1} step={0.05} value={config.dithering} onChange={(e) => set('dithering', +e.target.value)} disabled={config.ditherMethod === 'none'} />
          </div>
          <div className="control-panel__group">
            <label>Adaptive: {config.adaptiveSegmentation.toFixed(2)}</label>
            <input id="slider-adaptive" type="range" min={0} max={1} step={0.05} value={config.adaptiveSegmentation} onChange={(e) => set('adaptiveSegmentation', +e.target.value)} />
          </div>
        </div>
      </Section>

      <Section title="Advanced Image Adjustments" defaultOpen={false} onReset={resetAdvanced}>
        <div className="control-section__grid">
          <ThresholdEditor
            numLayers={config.numLayers}
            thresholds={config.layerThresholds}
            autoThresholds={config.autoThresholds}
            computedThresholds={computedThresholds}
            onChange={(t) => set('layerThresholds', t)}
            onAutoChange={(auto, thresholds) => {
              const update: Partial<LithopaneConfig> = { autoThresholds: auto };
              if (thresholds !== undefined) update.layerThresholds = thresholds;
              onChange({ ...config, ...update });
            }}
          />
        </div>
        <div className="control-section__toggles">
          <label className="toggle"><input type="checkbox" checked={config.autoLevels} onChange={(e) => set('autoLevels', e.target.checked)} /> Auto Levels</label>
          <label className="toggle"><input type="checkbox" checked={config.mirror} onChange={(e) => set('mirror', e.target.checked)} /> Mirror</label>
        </div>
      </Section>

      <Section title="Background Removal" defaultOpen={false} onReset={resetBg}>
        <div className="control-section__grid">
          <div className="control-panel__group control-panel__group--full">
            <label>Model</label>
            <select value={config.bgModel} onChange={(e) => set('bgModel', e.target.value as LithopaneConfig['bgModel'])}>
              <option value="u2netp">U2NetP (fast, 4MB)</option>
              <option value="u2net">U2Net (accurate, 176MB)</option>
              <option value="isnet_general_use">ISNet General</option>
              <option value="isnet_anime">ISNet Anime</option>
              <option value="silueta">Silueta</option>
              <option value="u2net_human_seg">U2Net Human Seg</option>
            </select>
          </div>
        </div>
        <div className="control-section__toggles">
          <label className="toggle"><input type="checkbox" checked={config.reserveLayerForBg} onChange={(e) => set('reserveLayerForBg', e.target.checked)} /> Reserve lowest layer for BG</label>
          <label className="toggle"><input type="checkbox" checked={config.autoRemoveBgOnFreeze} onChange={(e) => set('autoRemoveBgOnFreeze', e.target.checked)} /> Auto remove BG on freeze</label>
        </div>
      </Section>

      <Section title="Print Settings" onReset={resetPrint}>
        <div className="control-section__grid">
          <div className="control-panel__group">
            <label>Diameter (mm)</label>
            <input type="number" min={10} max={200} step={5} value={config.diameterMm} onChange={(e) => setNum('diameterMm', e.target.value, 5)} />
          </div>
          <div className="control-panel__group">
            <label>Nozzle (mm)</label>
            <input type="number" min={0.2} max={1.0} step={0.1} value={config.nozzleWidthMm} onChange={(e) => setNum('nozzleWidthMm', e.target.value, 0.1)} />
          </div>
          <div className="control-panel__group">
            <label>Layers: {config.numLayers}</label>
            <input id="slider-layers" type="range" min={1} max={8} value={config.numLayers} onChange={(e) => {
              const n = +e.target.value;
              // Reset custom thresholds when layer count changes (different number of cutpoints)
              onChange({ ...config, numLayers: n, layerThresholds: [] });
            }} />
          </div>
          <div className="control-panel__group">
            <label>Layer Height (mm)</label>
            <input type="number" min={0.1} max={0.5} step={0.01} value={config.layerHeightMm} onChange={(e) => setNum('layerHeightMm', e.target.value, 0.04)} />
          </div>
          <div className="control-panel__group control-panel__group--full">
            <label>Initial Layer (mm): {config.baseLayerHeightMm === 0 ? `auto (${config.layerHeightMm})` : config.baseLayerHeightMm}</label>
            <input type="number" min={0} max={1.0} step={0.01} value={config.baseLayerHeightMm} onChange={(e) => setNum('baseLayerHeightMm', e.target.value, 0)} />
          </div>
          <div className="control-panel__group control-panel__group--full">
            <label>Light Intensity: {config.lightIntensity.toFixed(1)}</label>
            <input id="slider-light" type="range" min={0.5} max={5.0} step={0.1} value={config.lightIntensity} onChange={(e) => set('lightIntensity', +e.target.value)} />
          </div>
          <div className="control-panel__group control-panel__group--full">
            <label>Absorption (mm⁻¹): {config.absorptionCoefficient.toFixed(1)}</label>
            <input id="slider-absorption" type="range" min={1} max={20} step={0.5} value={config.absorptionCoefficient} onChange={(e) => set('absorptionCoefficient', +e.target.value)} />
          </div>
        </div>
        <div className="control-section__toggles">
          <label className="toggle"><input type="checkbox" checked={config.arachneOptimize} onChange={(e) => set('arachneOptimize', e.target.checked)} /> Optimize for Arachne</label>
        </div>
      </Section>

      <Section title="Notches" defaultOpen={false} onReset={resetNotches}>
        <div className="control-section__grid">
          <div className="control-panel__group">
            <label>Count: {config.numNotches}</label>
            <input id="slider-notches" type="range" min={0} max={20} value={config.numNotches} onChange={(e) => set('numNotches', +e.target.value)} />
          </div>
          <div className="control-panel__group">
            <label>Radius (mm)</label>
            <input type="number" min={0.5} max={5} step={0.5} value={config.notchRadiusMm} onChange={(e) => setNum('notchRadiusMm', e.target.value, 0.5)} />
          </div>
          <div className="control-panel__group control-panel__group--full">
            <label>Height (mm)</label>
            <input type="number" min={0.5} max={10} step={0.5} value={config.notchHeightMm} onChange={(e) => setNum('notchHeightMm', e.target.value, 0.5)} />
          </div>
        </div>
      </Section>


    </div>
  );
}
