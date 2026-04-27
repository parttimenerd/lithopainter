import { useState, useCallback, useEffect } from 'react';
import type { DownloadHistoryEntry, LithopaneConfig } from '../types';

const STORAGE_KEY = 'lithopane-download-history';
const MAX_ENTRIES = 20;

function loadHistory(): DownloadHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: DownloadHistoryEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch { /* quota */ }
}

export function useDownloadHistory() {
  const [history, setHistory] = useState<DownloadHistoryEntry[]>(loadHistory);

  const addEntry = useCallback((entry: Omit<DownloadHistoryEntry, 'id' | 'timestamp'>) => {
    const newEntry: DownloadHistoryEntry = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };
    setHistory((prev) => {
      const updated = [newEntry, ...prev].slice(0, MAX_ENTRIES);
      saveHistory(updated);
      return updated;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* */ }
  }, []);

  return { history, addEntry, clearHistory };
}

/** Generate a small thumbnail data URL from a heightmap. */
export function heightmapToThumbnail(
  heightmap: Float32Array,
  resolution: number,
  targetSize = 64
): string {
  const canvas = document.createElement('canvas');
  canvas.width = resolution;
  canvas.height = resolution;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(resolution, resolution);
  const data = imageData.data;

  let min = Infinity, max = -Infinity;
  for (let i = 0; i < heightmap.length; i++) {
    if (heightmap[i] > 0) {
      if (heightmap[i] < min) min = heightmap[i];
      if (heightmap[i] > max) max = heightmap[i];
    }
  }
  if (!isFinite(min)) min = 0;
  if (!isFinite(max)) max = 1;
  const range = max - min || 1;

  for (let i = 0; i < heightmap.length; i++) {
    const px = i * 4;
    if (heightmap[i] <= 0) {
      data[px] = data[px + 1] = data[px + 2] = 0;
      data[px + 3] = 0;
      continue;
    }
    const v = Math.round(((heightmap[i] - min) / range) * 255);
    data[px] = data[px + 1] = data[px + 2] = v;
    data[px + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);

  // Downscale to thumbnail
  const thumb = document.createElement('canvas');
  thumb.width = targetSize;
  thumb.height = targetSize;
  thumb.getContext('2d')!.drawImage(canvas, 0, 0, targetSize, targetSize);
  return thumb.toDataURL('image/png');
}

interface HistoryPanelProps {
  history: DownloadHistoryEntry[];
  onClear: () => void;
}

export default function DownloadHistory({ history, onClear }: HistoryPanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (history.length === 0) return null;

  return (
    <div className="download-history">
      <div
        className="download-history__header"
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded); } }}
      >
        <span className={`control-section__arrow ${expanded ? 'control-section__arrow--open' : ''}`}>▸</span>
        Download History ({history.length})
        <button
          className="control-section__reset"
          title="Clear history"
          onClick={(e) => { e.stopPropagation(); onClear(); }}
          style={{ opacity: 0.7 }}
        >
          ✕
        </button>
      </div>
      {expanded && (
        <div className="download-history__list">
          {history.map((entry) => (
            <div key={entry.id} className="download-history__entry">
              <img
                src={entry.thumbnail}
                alt="Thumbnail"
                className="download-history__thumb"
              />
              <div className="download-history__info">
                <div className="download-history__name">{entry.filename}</div>
                <div className="download-history__time">
                  {new Date(entry.timestamp).toLocaleString()}
                </div>
                {entry.config && (
                  <div className="download-history__meta">
                    {entry.config.diameterMm}mm · {entry.config.numLayers}L
                    {entry.config.backgroundRemoval ? ' · BG' : ''}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
