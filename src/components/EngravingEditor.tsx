interface Props {
  text: string;
  fontSize: number;
  angle: number;
  layers: number;
  diameterMm: number;
  onChange: (updates: { engravingText?: string; engravingFontSize?: number; engravingAngle?: number; engravingLayers?: number }) => void;
}

export default function EngravingEditor({ text, fontSize, angle, onChange }: Props) {
  return (
    <div className="engraving-editor">
      <div className="engraving-editor__controls">
        <div className="control-panel__group control-panel__group--full">
          <label>Text</label>
          <input
            type="text"
            value={text}
            onChange={(e) => onChange({ engravingText: e.target.value })}
            placeholder="e.g. fablab"
            maxLength={60}
            className="engraving-editor__input"
          />
        </div>
        <div className="control-panel__group">
          <label>Font Size (mm): {fontSize.toFixed(1)}</label>
          <input type="range" min={1} max={8} step={0.5} value={fontSize} onChange={(e) => onChange({ engravingFontSize: +e.target.value })} />
        </div>
        <div className="control-panel__group">
          <label>Angle: {Math.round(angle)}°</label>
          <input type="range" min={0} max={360} step={1} value={angle} onChange={(e) => onChange({ engravingAngle: +e.target.value })} />
        </div>
      </div>
    </div>
  );
}
