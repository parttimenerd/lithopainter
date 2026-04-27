import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';

/**
 * Export a BufferGeometry as binary STL and trigger download.
 */
export function exportSTL(geometry: THREE.BufferGeometry, filename = 'lithopane.stl') {
  const mesh = new THREE.Mesh(geometry);
  const exporter = new STLExporter();
  const buffer = exporter.parse(mesh, { binary: true });

  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
